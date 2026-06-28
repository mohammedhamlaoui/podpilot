"""OpenRouter AI listing content generation using Reka Edge."""
import base64
import json
import mimetypes
import re
from typing import Any, Optional
import httpx

import app.core.config as config
from app.services.logging_utils import error_type as safe_error_type


class OpenRouterListingError(Exception):
    """Exception raised when OpenRouter listing generation fails."""


def _stringify(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, list):
        return ", ".join(str(item).strip() for item in value if str(item).strip())
    return str(value).strip()


def _metadata_snapshot(design: dict[str, Any], current_metadata: Optional[dict[str, Any]]) -> dict[str, str]:
    current = current_metadata or {}
    return {
        "filename": _stringify(current.get("filename") or design.get("filename")),
        "title": _stringify(current.get("title") or design.get("title")),
        "description": _stringify(current.get("description") or design.get("description")),
        "main_tag": _stringify(
            current.get("main_tag")
            or current.get("primary_tag")
            or design.get("primary_tag")
            or design.get("main_tag")
        ),
        "supporting_tags": _stringify(current.get("supporting_tags") or design.get("supporting_tags")),
    }


def _build_prompt(platform: str, metadata: dict[str, str], has_image: bool) -> str:
    context = "\n".join(f"- {key}: {value or '(blank)'}" for key, value in metadata.items())
    image_line = (
        "Use the attached design image as the primary source of truth."
        if has_image
        else "No image is available, so infer cautiously from filename and current metadata."
    )
    return f"""
SYSTEM INSTRUCTIONS:
You are an expert print-on-demand listing writer for Redbubble and TeePublic.
Your job is to analyze the image and create accurate, safe, human-written marketplace metadata.
Describe only what is actually visible in the image.
Do not invent brands, characters, celebrities, locations, styles, cultures, movies, games, or copyrighted names.
Do not use trademarked terms.
Do not use generic filler like "beautiful design", "perfect for everyone", or "unique design" unless the image clearly supports it.
Write natural metadata that sounds like a real human seller.
If the design is black and white line art, mention "line art" naturally.
If the background is transparent or contains a checkerboard grid, do not describe the checkerboard as part of the design.
Never use filename numbers (like "27"), "Untitled", "Image 1", or random uploaded file names in the title/tags. Describe the visible design, not the filename.

USER REQUEST:
Analyze this design image and return marketplace metadata.
Platform: {platform}
{image_line}

Current design context:
{context}

Return ONLY valid JSON with this exact shape:
{{
  "title": "short natural title, max 60 characters",
  "description": "3 to 4 short visible-content sentences",
  "primary_tag": "1 to 2 word marketplace tag",
  "supporting_tags": ["tag1", "tag2", "tag3", "tag4", "tag5", "tag6", "tag7", "tag8"]
}}

Rules:
- Title must describe the main subject clearly.
- Description should be 3 to 4 short sentences or lines when possible.
- Description must mention visible subject, style, colors, mood, and likely buyer/use case only when supported by the image.
- Primary tag must be 1 to 2 words maximum. Do not use a long hyphenated phrase.
- Good primary tag examples: kitchen decor, tea lover, floral mug, coffee art.
- Supporting tags must be 8 to 12 relevant buyer-search terms, minimum 7.
- No duplicate tags.
- No empty tags.
- No made-up words.
- No copyrighted names.
- No celebrity/brand/team/movie/game references.
- Avoid vague words like "art", "design", "cool", "awesome" unless useful.
- If the image is abstract, describe shapes, colors, mood, and style accurately.
- If unsure, stay simple and literal.

Examples of highly relevant listings:

Example 1: Black and white line art cup image
{{
  "title": "Floral Teacup Line Art",
  "description": "A simple black line drawing of a patterned teacup and saucer. The delicate floral details give it a cozy tea-time mood. This works well for tea lovers, kitchen decor fans, or anyone who likes minimal drinkware art.",
  "primary_tag": "tea lover",
  "supporting_tags": ["line art", "tea cup", "saucer", "floral pattern", "black and white", "minimal", "cozy", "drinkware", "kitchen decor"]
}}

Example 2: Cute animal line art
{{
  "title": "Cute Sleeping Fox Line Art",
  "description": "A black and white line drawing of a sleeping fox curled into a soft circle. The simple style feels calm, cute, and gentle. It is a good fit for fox lovers, woodland decor, or cozy nursery-inspired gifts.",
  "primary_tag": "fox art",
  "supporting_tags": ["sleeping fox", "line art", "minimalist fox", "woodland creature", "cute animal", "black and white", "minimal", "nursery art", "cozy fox"]
}}

Example 3: Abstract pattern
{{
  "title": "Retro Teal and Mustard Waves",
  "description": "An abstract pattern with flowing wavy lines in teal, mustard yellow, and cream. The rounded shapes create a retro mid-century mood. It suits buyers looking for colorful pattern art, decor accents, or groovy everyday accessories.",
  "primary_tag": "retro pattern",
  "supporting_tags": ["mid century modern", "wavy lines", "retro pattern", "teal and mustard", "geometric", "seamless pattern", "70s aesthetic", "groovy waves", "abstract decor"]
}}

Example 4: Flower/bouquet
{{
  "title": "Wildflower Bouquet Watercolor",
  "description": "A vibrant watercolor bouquet with lavender, daisies, eucalyptus stems, and soft colorful petals. The painting feels fresh, botanical, and cheerful. It is a natural fit for flower lovers, garden gifts, or spring-inspired decor.",
  "primary_tag": "floral art",
  "supporting_tags": ["watercolor bouquet", "floral art", "lavender", "daisies", "eucalyptus", "flower painting", "botanical art", "colorful flowers", "garden gift"]
}}

Example 5: Text-only design
{{
  "title": "Inspirational Keep Going Quote",
  "description": "A bold typography design featuring the motivational quote Keep Going in clean black lettering. The simple text layout feels positive, direct, and encouraging. It works well for buyers who like inspirational quotes, daily motivation, or uplifting gifts.",
  "primary_tag": "motivational quote",
  "supporting_tags": ["motivational quote", "typography", "keep going", "bold text", "minimalist quote", "black lettering", "positive vibes", "encouragement", "uplifting gift"]
}}
""".strip()


def _parse_json_response(text: str) -> dict[str, Any]:
    raw = (text or "").strip()
    if raw.startswith("```"):
        raw = raw.strip("`").strip()
        if raw.lower().startswith("json"):
            raw = raw[4:].strip()

    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        start = raw.find("{")
        end = raw.rfind("}")
        if start == -1 or end == -1 or end <= start:
            raise OpenRouterListingError("AI returned an unreadable response.")
        try:
            data = json.loads(raw[start : end + 1])
        except json.JSONDecodeError as error:
            raise OpenRouterListingError("AI returned invalid JSON.") from error

    if not isinstance(data, dict):
        raise OpenRouterListingError("AI returned an unexpected response.")
    return data


def _safe_trim(text: str, max_len: int) -> str:
    """Trim a string safely at word boundaries under the max_len limit."""
    text = text.strip()
    if len(text) <= max_len:
        return text
    truncated = text[:max_len]
    last_space = truncated.rfind(" ")
    if last_space != -1:
        result = truncated[:last_space].rstrip(",.!? ")
        if result:
            return result
    return truncated


def _shorten_primary_tag(tag: str) -> str:
    """Keep a model-provided primary tag to a gentle 1-2 word marketplace phrase."""
    cleaned = re.sub(r"[_\-]+", " ", tag.lower()).strip()
    for delimiter in [",", ";", "/", "\\", "|"]:
        if delimiter in cleaned:
            parts = [part.strip() for part in cleaned.split(delimiter) if part.strip()]
            cleaned = parts[0] if parts else ""
    words = re.findall(r"[a-z0-9]+", cleaned)
    return " ".join(words[:2])


def _is_forbidden_tag(tag: str) -> bool:
    """Check if a tag is empty, numeric, too long, or contains forbidden keywords."""
    tag_lower = tag.lower().strip()
    if not tag_lower:
        return True
    if tag_lower.isdigit():
        return True
    if len(tag_lower) > 30:
        return True
    
    forbidden_keywords = [
        "copyright", "trademark", "registered", "patent", "untitled", "image", "file",
        "upload", "redbubble", "teepublic", "podpilot", "placeholder", "logo", "watermark",
        "designed by", "created by", "unknown", "©", "®", "™"
    ]
    for keyword in forbidden_keywords:
        if keyword in tag_lower:
            return True
            
    return False


def _clean_and_normalize_metadata(
    data: dict[str, Any], platform: str
) -> dict[str, Any]:
    """Normalize model output gently while preserving safe user-facing metadata."""
    title = _stringify(data.get("title"))
    description = _stringify(data.get("description"))
    main_tag = _stringify(data.get("main_tag") or data.get("primary_tag"))
    
    # Extract raw supporting tags list
    tags_val = data.get("supporting_tags") or data.get("tags") or []
    if isinstance(tags_val, str):
        raw_tags = [t.strip() for t in tags_val.split(",") if t.strip()]
    elif isinstance(tags_val, list):
        raw_tags = [_stringify(t) for t in tags_val if _stringify(t)]
    else:
        raw_tags = []

    # 1. Clean main tag: keep the best short 1-2 word phrase the model provided.
    main_tag_cleaned = _shorten_primary_tag(main_tag)
            
    if _is_forbidden_tag(main_tag_cleaned):
        salvaged = False
        for tag in raw_tags:
            candidate = _shorten_primary_tag(tag)
            if not _is_forbidden_tag(candidate):
                main_tag_cleaned = candidate
                salvaged = True
                break
        if not salvaged:
            raise OpenRouterListingError("Main tag is empty or invalid.")

    # 2. Clean supporting tags
    seen = set()
    # Supporting tags should not repeat the main tag exactly.
    seen.add(main_tag_cleaned)
    
    cleaned_tags = []
    for tag in raw_tags:
        cleaned_tag = re.sub(r"\s+", " ", str(tag).replace("#", "").lower()).strip(" ,;")
        if _is_forbidden_tag(cleaned_tag):
            continue
        if cleaned_tag in seen:
            continue
        seen.add(cleaned_tag)
        cleaned_tags.append(cleaned_tag)
        
    is_teepublic = (platform or "").lower().strip() == "teepublic"
    if is_teepublic:
        cleaned_tags = cleaned_tags[:15]
    else:
        cleaned_tags = cleaned_tags[:50]

    if not cleaned_tags:
        raise OpenRouterListingError("No valid supporting tags were returned.")

    title_trimmed = _safe_trim(title, 60)
    description_trimmed = _safe_trim(description, 420)

    if not title_trimmed or not description_trimmed:
        raise OpenRouterListingError("Title or description is missing or invalid.")

    return {
        "title": title_trimmed,
        "description": description_trimmed,
        "main_tag": main_tag_cleaned,
        "primary_tag": main_tag_cleaned,
        "tags": cleaned_tags,
        "supporting_tags": ", ".join(cleaned_tags),
    }


async def generate_listing_openrouter(
    *,
    design: dict[str, Any],
    platform: str,
    current_metadata: Optional[dict[str, Any]] = None,
    image_url: str = "",
    image_bytes: Optional[bytes] = None,
    image_mime_type: str = "",
) -> dict[str, Any]:
    if not config.OPENROUTER_API_KEY:
        raise OpenRouterListingError("OpenRouter API key is not configured.")

    import logging
    logger = logging.getLogger("podpilot.ai")
    metadata = _metadata_snapshot(design, current_metadata)
    image_payload_base64 = ""
    mime_type = ""

    if image_bytes:
        mime_type = (image_mime_type or "").split(";", 1)[0].strip()
        if mime_type not in {"image/png", "image/jpeg", "image/webp"}:
            guessed, _ = mimetypes.guess_type(metadata.get("filename", ""))
            mime_type = guessed if guessed in {"image/png", "image/jpeg", "image/webp"} else "image/png"
        image_payload_base64 = f"data:{mime_type};base64,{base64.b64encode(image_bytes).decode('ascii')}"
    elif image_url:
        image_payload_base64 = image_url

    prompt_str = _build_prompt(platform, metadata, bool(image_payload_base64))

    content_list: list[dict[str, Any]] = [{"type": "text", "text": prompt_str}]
    if image_payload_base64:
        content_list.append({
            "type": "image_url",
            "image_url": {
                "url": image_payload_base64
            }
        })

    payload = {
        "model": config.OPENROUTER_MODEL or "rekaai/reka-edge",
        "messages": [
            {
                "role": "user",
                "content": content_list
            }
        ],
        "temperature": 0.2,
        "max_tokens": 1024
    }

    headers = {
        "Authorization": f"Bearer {config.OPENROUTER_API_KEY}",
        "Content-Type": "application/json",
        "HTTP-Referer": "https://podpilot.space",
        "X-Title": "PodPilot"
    }

    if config.DEBUG:
        logger.debug("openrouter_request model=%s has_image=%s", payload["model"], bool(image_payload_base64))

    try:
        # First attempt
        try:
            async with httpx.AsyncClient(timeout=60.0) as client:
                response = await client.post(
                    "https://openrouter.ai/api/v1/chat/completions",
                    json=payload,
                    headers=headers
                )
            if response.status_code >= 400:
                if response.status_code == 401:
                    raise OpenRouterListingError("AI provider authentication failed. Check OpenRouter API key.")
                raise OpenRouterListingError(f"OpenRouter API returned status code {response.status_code}")
            
            data = response.json()
            content = data["choices"][0]["message"]["content"]
            if config.DEBUG:
                logger.debug("openrouter_response_received chars=%d", len(content or ""))
            parsed = _parse_json_response(content)
            normalized = _clean_and_normalize_metadata(parsed, platform)
        except Exception as first_error:
            if isinstance(first_error, OpenRouterListingError) and "AI provider authentication failed" in str(first_error):
                raise first_error
            # Retry once
            logger.warning(
                "openrouter_retry error_type=%s",
                safe_error_type(first_error),
            )
            
            correction_text = f"\n\nYour previous response was invalid. Please correct it to strictly follow the JSON schema and requirements.\nError details: {first_error}\nOriginal prompt instructions must still be followed."
            retry_prompt_str = prompt_str + correction_text
            
            retry_content_list: list[dict[str, Any]] = [{"type": "text", "text": retry_prompt_str}]
            if image_payload_base64:
                retry_content_list.append({
                    "type": "image_url",
                    "image_url": {
                        "url": image_payload_base64
                    }
                })
            
            retry_payload = {
                "model": config.OPENROUTER_MODEL or "rekaai/reka-edge",
                "messages": [
                    {
                        "role": "user",
                        "content": retry_content_list
                    }
                ],
                "temperature": 0.2,
                "max_tokens": 1024
            }
            
            async with httpx.AsyncClient(timeout=60.0) as client:
                response = await client.post(
                    "https://openrouter.ai/api/v1/chat/completions",
                    json=retry_payload,
                    headers=headers
                )
            if response.status_code >= 400:
                raise OpenRouterListingError(f"OpenRouter retry API returned status code {response.status_code}")
            
            data = response.json()
            content = data["choices"][0]["message"]["content"]
            if config.DEBUG:
                logger.debug("openrouter_retry_response_received chars=%d", len(content or ""))
            parsed = _parse_json_response(content)
            normalized = _clean_and_normalize_metadata(parsed, platform)
    except Exception as final_error:
        if isinstance(final_error, OpenRouterListingError):
            raise final_error
        raise OpenRouterListingError(f"OpenRouter generation failed: {final_error}") from final_error

    return normalized
