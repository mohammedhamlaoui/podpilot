"""AI listing content generation for marketplace design metadata."""
from __future__ import annotations

import base64
import json
import mimetypes
import os
from typing import Any, Optional
from urllib.parse import quote

import httpx

from app.core.config import DEBUG
from app.services.logging_utils import error_type as safe_error_type, short_id

from app.core.config import (
    AI_LISTING_PROVIDER,
    OPENROUTER_API_KEY,
    OPENROUTER_MODEL,
)


class AIListingError(Exception):
    """Safe user-facing error for AI listing generation failures."""


MAX_INLINE_IMAGE_BYTES = 15 * 1024 * 1024


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
  "description": "one natural sentence, max 160 characters",
  "main_tag": "one broad searchable keyword",
  "supporting_tags": ["tag1", "tag2", "tag3", "tag4", "tag5", "tag6", "tag7", "tag8"]
}}

Rules:
- Title must describe the main subject clearly.
- Description must mention visible elements only.
- Main tag must be one simple buyer-search keyword.
- Supporting tags must be relevant buyer-search terms.
- No duplicate tags.
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
  "description": "A simple black line drawing of a patterned teacup and saucer.",
  "main_tag": "teacup",
  "supporting_tags": ["line art", "tea cup", "saucer", "floral pattern", "black and white", "minimal", "cozy", "drinkware"]
}}

Example 2: Cute animal line art
{{
  "title": "Cute Sleeping Fox Line Art",
  "description": "A minimalist black and white line drawing of a sleeping fox curled up in a circle.",
  "main_tag": "fox",
  "supporting_tags": ["sleeping fox", "line art", "minimalist fox", "woodland creature", "cute animal", "black and white", "minimal", "nursery art"]
}}

Example 3: Abstract pattern
{{
  "title": "Retro Teal and Mustard Waves",
  "description": "An abstract mid-century modern pattern featuring flowing wavy lines in teal, mustard yellow, and cream.",
  "main_tag": "abstract pattern",
  "supporting_tags": ["mid century modern", "wavy lines", "retro pattern", "teal and mustard", "geometric", "seamless pattern", "70s aesthetic", "groovy waves"]
}}

Example 4: Flower/bouquet
{{
  "title": "Wildflower Bouquet Watercolor",
  "description": "A vibrant watercolor painting of a wildflower bouquet with lavender, daisies, and eucalyptus stems.",
  "main_tag": "wildflowers",
  "supporting_tags": ["watercolor bouquet", "floral art", "lavender", "daisies", "eucalyptus", "flower painting", "botanical art", "colorful flowers"]
}}

Example 5: Text-only design
{{
  "title": "Inspirational Keep Going Quote",
  "description": "A bold typography design featuring the motivational quote Keep Going in clean black lettering.",
  "main_tag": "inspirational quote",
  "supporting_tags": ["motivational quote", "typography", "keep going", "bold text", "minimalist quote", "black lettering", "positive vibes", "encouragement"]
}}
""".strip()


async def _download_image(image_url: str, filename: str) -> Optional[tuple[bytes, str]]:
    if not image_url:
        return None

    try:
        async with httpx.AsyncClient(timeout=30.0, follow_redirects=True) as client:
            response = await client.get(image_url)
    except httpx.HTTPError:
        return None

    if response.status_code >= 400:
        return None

    content = response.content or b""
    if not content or len(content) > MAX_INLINE_IMAGE_BYTES:
        return None

    content_type = (response.headers.get("content-type") or "").split(";", 1)[0].strip()
    if not content_type.startswith("image/"):
        guessed, _ = mimetypes.guess_type(filename or "")
        content_type = guessed or "image/png"

    if content_type not in {"image/png", "image/jpeg", "image/webp"}:
        content_type = "image/png"

    return content, content_type


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
            raise AIListingError("AI returned an unreadable response.")
        try:
            data = json.loads(raw[start : end + 1])
        except json.JSONDecodeError as error:
            raise AIListingError("AI returned invalid JSON.") from error

    if not isinstance(data, dict):
        raise AIListingError("AI returned an unexpected response.")
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


def _clean_and_normalize_metadata(
    data: dict[str, Any], platform: str
) -> dict[str, str]:
    """Normalize and validate all fields, raising AIListingError on failure."""
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
            raise AIListingError("Main tag is empty or invalid.")

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
        raise AIListingError("No valid supporting tags were returned.")

    title_trimmed = _safe_trim(title, 60)
    description_trimmed = _safe_trim(description, 160)

    if is_teepublic:
        sentences = [s.strip() for s in description_trimmed.split(".") if s.strip()]
        if sentences:
            description_trimmed = sentences[0] + "."

    if not title_trimmed or not description_trimmed:
        raise AIListingError("Title or description is missing or invalid.")

    return {
        "title": title_trimmed,
        "description": description_trimmed,
        "main_tag": main_tag_cleaned,
        "supporting_tags": ", ".join(cleaned_tags),
    }


async def generate_listing_content(
    *,
    design: dict[str, Any],
    platform: str,
    current_metadata: Optional[dict[str, Any]] = None,
    image_url: str = "",
    fallback_image_url: str = "",
    image_bytes: Optional[bytes] = None,
    image_mime_type: str = "",
) -> dict[str, str]:
    import logging
    import time

    from app.services.openrouter_service import generate_listing_openrouter

    logger = logging.getLogger("podpilot.ai")
    design_id = short_id(design.get("id"))

    logger.info("[PodPilot][AI Listing] start designId=%s", design_id)
    logger.info("[PodPilot][AI Listing] provider=edge")

    if AI_LISTING_PROVIDER != "openrouter":
        raise AIListingError("AI Listing is configured to use OpenRouter/Edge only.")
    if not OPENROUTER_API_KEY:
        raise AIListingError("OpenRouter AI is not configured. Add OPENROUTER_API_KEY to backend/.env.")

    started_at = time.perf_counter()
    try:
        result = await generate_listing_openrouter(
            design=design,
            platform=platform,
            current_metadata=current_metadata,
            image_url=image_url,
            fallback_image_url=fallback_image_url,
            image_bytes=image_bytes,
            image_mime_type=image_mime_type,
            model=OPENROUTER_MODEL,
            timeout_seconds=75.0,
            structured_output=False,
            require_tags_array=False,
            provider_label="edge",
        )
    except Exception as error:
        logger.warning(
            "[PodPilot][AI Listing] failed designId=%s reason=%s duration_ms=%d",
            design_id,
            str(error)[:240],
            int((time.perf_counter() - started_at) * 1000),
        )
        raise AIListingError(f"AI listing generation failed. Error: {error}") from error

    logger.info(
        "[PodPilot][AI Listing] success designId=%s duration_ms=%d",
        design_id,
        int((time.perf_counter() - started_at) * 1000),
    )
    return {
        "title": result["title"],
        "description": result["description"],
        "main_tag": result["main_tag"],
        "primary_tag": result.get("primary_tag") or result["main_tag"],
        "supporting_tags": result["supporting_tags"],
    }
