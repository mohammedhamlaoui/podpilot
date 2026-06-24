"""OpenRouter AI listing content generation using Reka Edge."""
import base64
import hashlib
import io
import json
import mimetypes
import re
from typing import Any, Optional
import httpx
from PIL import Image, ImageOps

import app.core.config as config
from app.services.logging_utils import error_type as safe_error_type, short_id


class OpenRouterListingError(Exception):
    """Exception raised when OpenRouter listing generation fails."""


MAX_SOURCE_IMAGE_BYTES = 15 * 1024 * 1024
AI_IMAGE_MAX_SIDE = 768
AI_IMAGE_JPEG_QUALITY = 80
REJECTION_PHRASES = [
    "abstract geometric",
    "geometric shapes",
    "seedling",
    "seeds",
    "growth",
    "vase",
    "minimalist line art",
]


LISTING_JSON_SCHEMA = {
    "name": "podpilot_listing",
    "strict": True,
    "schema": {
        "type": "object",
        "properties": {
            "title": {"type": "string"},
            "description": {"type": "string"},
            "main_tag": {"type": "string"},
            "supporting_tags": {
                "type": "array",
                "items": {"type": "string"},
            },
        },
        "required": ["title", "description", "main_tag", "supporting_tags"],
        "additionalProperties": False,
    },
}


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


def _build_prompt(
    platform: str,
    metadata: dict[str, str],
    has_image: bool,
    correction_instruction: str = "",
) -> str:
    context = "\n".join(f"- {key}: {value or '(blank)'}" for key, value in metadata.items())
    image_line = (
        "Use the attached compressed design image as the primary source of truth."
        if has_image
        else "No image is available, so infer cautiously from filename and current metadata."
    )
    correction = f"\n\nCorrection request: {correction_instruction}" if correction_instruction else ""
    return f"""
You are analyzing a print-on-demand design image and writing listing metadata.

Look carefully at the actual visible image.
Describe ONLY what is clearly visible.
Do not invent themes, objects, styles, or meanings.
Do not use generic filler such as abstract geometric, minimalist, seedling, growth, modern line art, or vase unless those exact elements are clearly visible.
If the design contains ghosts, skulls, potion bottles, witches, Halloween, cute spooky elements, animals, food, quotes, or characters, mention the visible subject accurately.
If unsure, choose a broad but safe description based on visible objects only.

Platform: {platform}
{image_line}

Current design context:
{context}
{correction}

Return ONLY valid JSON with this exact shape:
{{
  "title": "...",
  "description": "...",
  "tags": "...",
  "main_keyword": "..."
}}

Rules:
- Title: short, natural, 3 to 8 words.
- Description: one short sentence.
- Tags: comma-separated, 8 to 12 relevant tags.
- Main keyword: 2 to 4 words.
- Avoid spammy repetition.
- Avoid copyrighted character names, brand names, celebrity names, or trademarked terms.
- Do not mention Redbubble or TeePublic in the listing fields.
- Do not say "geometric", "abstract", "seedling", "vase", "growth", or "minimalist" unless clearly visible.
- Use simple POD seller-friendly wording.
- Prefer concrete visible nouns over vague aesthetics.

Example:
If the image shows a cute potion bottle with ghosts and skulls, a good output is:
{{
  "title": "Cute Ghost Potion Bottle",
  "description": "A cute spooky potion bottle design filled with ghosts, skulls, stars, and pastel Halloween magic.",
  "tags": "spooky potion bottle, cute ghost, halloween potion, ghost bottle, skulls, witchy design, pastel spooky, kawaii halloween, magic bottle, cute spooky",
  "main_keyword": "spooky potion bottle"
}}
""".strip()


def _parse_json_response(text: str) -> dict[str, Any]:
    raw = (text or "").strip()
    try:
        data = json.loads(raw)
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


def _contains_rejected_generic_terms(
    data: dict[str, Any],
    metadata: dict[str, str],
) -> Optional[str]:
    response_text = " ".join(
        _stringify(data.get(field))
        for field in ("title", "description", "tags", "main_keyword", "main_tag", "supporting_tags")
    ).lower()
    context_text = " ".join(metadata.values()).lower()
    for phrase in REJECTION_PHRASES:
        phrase_words = [word for word in phrase.split() if len(word) > 2]
        supported_by_context = phrase in context_text or all(word in context_text for word in phrase_words)
        if phrase in response_text and not supported_by_context:
            return phrase
    return None


def _clean_filename_words(filename: str) -> list[str]:
    stem = re.sub(r"\.[a-z0-9]{2,5}$", "", filename.strip(), flags=re.IGNORECASE)
    stem = re.sub(r"[_\-]+", " ", stem)
    words = re.findall(r"[a-zA-Z]{3,}", stem)
    blocked = {"image", "design", "file", "upload", "untitled", "copy", "final", "print"}
    return [word.lower() for word in words if word.lower() not in blocked][:8]


def _fallback_listing(metadata: dict[str, str]) -> dict[str, Any]:
    words = _clean_filename_words(metadata.get("filename", ""))
    if words:
        title_words = words[:6]
        title = " ".join(word.capitalize() for word in title_words)
        main_keyword = " ".join(words[: min(4, len(words))])
        tags = list(dict.fromkeys(words + [main_keyword]))
    else:
        title = "Uploaded Artwork Design"
        main_keyword = "uploaded artwork"
        tags = ["uploaded artwork", "print on demand", "clean design", "seller artwork"]

    return {
        "title": title,
        "description": "A clean print-on-demand design based on the uploaded artwork.",
        "main_tag": main_keyword,
        "tags": tags[:12],
        "supporting_tags": ", ".join(tags[:12]),
        "fallback_used": True,
    }


def _clean_and_normalize_metadata(
    data: dict[str, Any], platform: str, *, metadata: Optional[dict[str, str]] = None, require_tags_array: bool = False
) -> dict[str, Any]:
    """Normalize and validate all fields, raising OpenRouterListingError on failure."""
    metadata = metadata or {}
    rejected_phrase = _contains_rejected_generic_terms(data, metadata)
    if rejected_phrase:
        raise OpenRouterListingError(f"AI listing used unsupported generic wording: {rejected_phrase}.")

    title = _stringify(data.get("title"))
    description = _stringify(data.get("description"))
    main_tag = _stringify(data.get("main_keyword") or data.get("main_tag") or data.get("primary_tag"))
    
    # Extract raw supporting tags list
    tags_val = data.get("supporting_tags")
    if tags_val is None:
        tags_val = data.get("tags") or []
    if require_tags_array and not isinstance(tags_val, list):
        raise OpenRouterListingError("Supporting tags must be an array.")
    if isinstance(tags_val, str):
        raw_tags = [t.strip() for t in tags_val.split(",") if t.strip()]
    elif isinstance(tags_val, list):
        raw_tags = [_stringify(t) for t in tags_val if _stringify(t)]
    else:
        raw_tags = []

    # 1. Clean main tag: must be one short tag only.
    main_tag_cleaned = main_tag.lower().strip()
    for delimiter in [",", ";", "/", "\\"]:
        if delimiter in main_tag_cleaned:
            parts = [p.strip() for p in main_tag_cleaned.split(delimiter) if p.strip()]
            main_tag_cleaned = parts[0] if parts else ""
            
    if _is_forbidden_tag(main_tag_cleaned):
        salvaged = False
        for tag in raw_tags:
            candidate = tag.lower().strip()
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
        cleaned_tag = tag.lower().strip()
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
    description_trimmed = _safe_trim(description, 160)

    if is_teepublic:
        sentences = [s.strip() for s in description_trimmed.split(".") if s.strip()]
        if sentences:
            description_trimmed = sentences[0] + "."

    if not title_trimmed or not description_trimmed:
        raise OpenRouterListingError("Title or description is missing or invalid.")

    return {
        "title": title_trimmed,
        "description": description_trimmed,
        "main_tag": main_tag_cleaned,
        "tags": cleaned_tags,
        "supporting_tags": ", ".join(cleaned_tags),
    }


async def _download_image(image_url: str, filename: str) -> Optional[bytes]:
    if not image_url:
        return None

    try:
        async with httpx.AsyncClient(timeout=30.0, follow_redirects=True) as client:
            response = await client.get(image_url)
    except httpx.HTTPError:
        return None

    if response.status_code >= 400:
        return None

    content_type = (response.headers.get("content-type") or "").split(";", 1)[0].strip()
    guessed, _ = mimetypes.guess_type(filename or "")
    if not content_type.startswith("image/") and not (guessed or "").startswith("image/"):
        return None

    content = response.content or b""
    if not content or len(content) > MAX_SOURCE_IMAGE_BYTES:
        return None
    return content


def _compress_image_for_ai(image_bytes: bytes) -> bytes:
    with Image.open(io.BytesIO(image_bytes)) as source:
        source.seek(0)
        image = ImageOps.exif_transpose(source)
        image.thumbnail((AI_IMAGE_MAX_SIDE, AI_IMAGE_MAX_SIDE), Image.Resampling.LANCZOS)

        if image.mode in ("RGBA", "LA") or (image.mode == "P" and "transparency" in image.info):
            rgba = image.convert("RGBA")
            background = Image.new("RGBA", rgba.size, (255, 255, 255, 255))
            flattened = Image.alpha_composite(background, rgba).convert("RGB")
        else:
            flattened = image.convert("RGB")

        output = io.BytesIO()
        flattened.save(output, format="JPEG", quality=AI_IMAGE_JPEG_QUALITY, optimize=True)
        return output.getvalue()


async def generate_listing_openrouter(
    *,
    design: dict[str, Any],
    platform: str,
    current_metadata: Optional[dict[str, Any]] = None,
    image_url: str = "",
    image_bytes: Optional[bytes] = None,
    image_mime_type: str = "",
    model: str = "",
    timeout_seconds: float = 60.0,
    structured_output: bool = False,
    require_tags_array: bool = False,
    provider_label: str = "openrouter",
) -> dict[str, Any]:
    if not config.OPENROUTER_API_KEY:
        raise OpenRouterListingError("OpenRouter API key is not configured.")

    import logging
    logger = logging.getLogger("podpilot.ai")
    metadata = _metadata_snapshot(design, current_metadata)
    image_payload_base64 = ""
    image_source_bytes: Optional[bytes] = None

    if image_bytes:
        if len(image_bytes) <= MAX_SOURCE_IMAGE_BYTES:
            image_source_bytes = image_bytes
    elif image_url:
        image_source_bytes = await _download_image(image_url, metadata.get("filename", ""))

    if image_source_bytes:
        try:
            ai_image_bytes = _compress_image_for_ai(image_source_bytes)
            image_hash_prefix = hashlib.sha256(ai_image_bytes).hexdigest()[:12]
            image_payload_base64 = f"data:image/jpeg;base64,{base64.b64encode(ai_image_bytes).decode('ascii')}"
            logger.info(
                "[PodPilot][AI Listing] received designId=%s filename=%s imageBytes=%d imageHashPrefix=%s",
                short_id(design.get("id")),
                metadata.get("filename", ""),
                len(ai_image_bytes),
                image_hash_prefix,
            )
        except Exception as image_error:
            logger.warning(
                "openrouter_ai_image_prepare_failed design_id=%s error_type=%s",
                short_id(design.get("id")),
                safe_error_type(image_error),
            )
    else:
        logger.info(
            "[PodPilot][AI Listing] received designId=%s filename=%s imageBytes=0 imageHashPrefix=",
            short_id(design.get("id")),
            metadata.get("filename", ""),
        )

    prompt_str = _build_prompt(platform, metadata, bool(image_payload_base64))

    content_list: list[dict[str, Any]] = [{"type": "text", "text": prompt_str}]
    if image_payload_base64:
        content_list.append({
            "type": "image_url",
            "image_url": {
                "url": image_payload_base64
            }
        })

    selected_model = model or config.OPENROUTER_MODEL or "rekaai/reka-edge"
    payload = {
        "model": selected_model,
        "messages": [
            {
                "role": "user",
                "content": content_list
            }
        ],
        "temperature": 0.2,
        "max_tokens": 1024
    }
    if structured_output:
        payload["response_format"] = {
            "type": "json_schema",
            "json_schema": LISTING_JSON_SCHEMA,
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
            async with httpx.AsyncClient(timeout=timeout_seconds) as client:
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
            normalized = _clean_and_normalize_metadata(
                parsed,
                platform,
                metadata=metadata,
                require_tags_array=require_tags_array,
            )
            logger.info(
                "ai_listing_provider=%s ai_listing_model=%s",
                provider_label,
                data.get("model") or selected_model,
            )
        except Exception as first_error:
            if isinstance(first_error, OpenRouterListingError) and "AI provider authentication failed" in str(first_error):
                raise first_error
            # Retry once
            logger.warning(
                "openrouter_retry error_type=%s",
                safe_error_type(first_error),
            )
            
            retry_prompt_str = _build_prompt(
                platform,
                metadata,
                bool(image_payload_base64),
                "Your previous listing did not match the visible image. Re-analyze the image and describe only visible objects.",
            )
            
            retry_content_list: list[dict[str, Any]] = [{"type": "text", "text": retry_prompt_str}]
            if image_payload_base64:
                retry_content_list.append({
                    "type": "image_url",
                    "image_url": {
                        "url": image_payload_base64
                    }
                })
            
            retry_payload = {
                "model": selected_model,
                "messages": [
                    {
                        "role": "user",
                        "content": retry_content_list
                    }
                ],
                "temperature": 0.2,
                "max_tokens": 1024
            }
            
            # Retry without response_format so routed free models that do not
            # support structured outputs can still return repairable JSON.
            async with httpx.AsyncClient(timeout=timeout_seconds) as client:
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
            normalized = _clean_and_normalize_metadata(
                parsed,
                platform,
                metadata=metadata,
                require_tags_array=require_tags_array,
            )
            logger.info(
                "ai_listing_provider=%s ai_listing_model=%s",
                provider_label,
                data.get("model") or selected_model,
            )
    except Exception as final_error:
        logger.warning(
            "openrouter_fallback_listing design_id=%s error_type=%s",
            short_id(design.get("id")),
            safe_error_type(final_error),
        )
        normalized = _fallback_listing(metadata)

    return normalized
