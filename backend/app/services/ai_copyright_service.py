"""AI copyright and IP risk checks for POD design metadata."""
from __future__ import annotations

import base64
import json
import mimetypes
import re
from typing import Any, Optional
from urllib.parse import quote

import httpx

from app.core.config import AI_MODEL, AI_PROVIDER, GEMINI_API_KEY


class AICopyrightRiskError(Exception):
    """Safe user-facing error for AI copyright risk checks."""


class AICopyrightImageTooLarge(AICopyrightRiskError):
    """Raised when inline image data exceeds the API size limit."""


MAX_INLINE_IMAGE_BYTES = 15 * 1024 * 1024
MAX_INLINE_IMAGE_BASE64_CHARS = (MAX_INLINE_IMAGE_BYTES * 4 + 2) // 3
ALLOWED_IMAGE_MIME_TYPES = {"image/png", "image/jpeg", "image/webp"}
VALID_RESULTS = {"SAFE", "NOT_SAFE", "NEEDS_REVIEW"}

KNOWN_IP_TERMS = {
    "nike": "brand",
    "adidas": "brand",
    "disney": "brand",
    "mickey mouse": "character",
    "star wars": "movie",
    "marvel": "brand",
    "pokemon": "character",
    "pokémon": "character",
    "batman": "character",
    "superman": "character",
    "harry potter": "character",
    "hello kitty": "character",
    "coca cola": "brand",
    "coca-cola": "brand",
    "fortnite": "game",
    "minecraft": "game",
    "naruto": "anime",
    "dragon ball": "anime",
    "one piece": "anime",
}


def _stringify(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, list):
        return ", ".join(str(item).strip() for item in value if str(item).strip())
    return str(value).strip()


def _listify(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()]
    return [item.strip() for item in str(value).split(",") if item.strip()]


def _detect_known_ip_terms(*values: Any) -> list[dict[str, str]]:
    text = " ".join(_stringify(value) for value in values).lower()
    found: list[dict[str, str]] = []
    for term, category in KNOWN_IP_TERMS.items():
        pattern = r"(?<![a-z0-9])" + re.escape(term.lower()) + r"(?![a-z0-9])"
        if re.search(pattern, text):
            found.append({"term": term, "category": category})
    return found


def _build_prompt(metadata: dict[str, Any], has_image: bool) -> str:
    supporting_tags = ", ".join(_listify(metadata.get("supporting_tags")))
    trademark_terms = ", ".join(_listify(metadata.get("detected_trademark_terms"))) or "(none)"
    image_line = (
        "Use the attached design image as the primary source of truth."
        if has_image
        else "No image is attached, so judge from metadata only and be cautious."
    )

    return f"""
You are PodPilot's AI copyright and IP risk checker for print-on-demand designs.
This is an informational risk check, not legal advice.

{image_line}

Design context:
- Platform: {_stringify(metadata.get("platform"))}
- Title: {_stringify(metadata.get("title")) or "(blank)"}
- Description: {_stringify(metadata.get("description")) or "(blank)"}
- Main or primary tag: {_stringify(metadata.get("main_tag") or metadata.get("primary_tag")) or "(blank)"}
- Supporting tags: {supporting_tags or "(blank)"}
- Detected trademark terms from prior checks: {trademark_terms}

Classify the risk as one of:
- SAFE: no obvious brand, character, celebrity, logo, slogan, fan-art, sports team, movie, anime, game, or protected IP risk.
- NOT_SAFE: clearly references famous IP, a brand, character, celebrity, logo, sports team, show, movie, game, anime, or protected slogan.
- NEEDS_REVIEW: uncertain, generic but possibly brand-like, parody/fan-art style, or could be confused with protected IP.

Return NOT_SAFE if the design clearly references famous IP such as Nike, Adidas, Disney, Mickey Mouse, Star Wars, Marvel, Pokemon, Batman, Superman, Harry Potter, Hello Kitty, Coca Cola, Fortnite, Minecraft, Naruto, Dragon Ball, One Piece, or similar protected brands/characters.
Return SAFE only when no obvious copyright, trademark, character, celebrity, logo, or protected IP risk is detected.
Do not claim legal certainty.
Return JSON only, with no markdown.

Return exactly this JSON shape:
{{
  "result": "SAFE",
  "score": 0,
  "reason": "Short plain-English reason.",
  "risky_terms": ["term"],
  "matched_categories": ["brand"],
  "recommendation": "Short recommended action."
}}
""".strip()


async def _download_image(image_url: str, filename: str = "") -> Optional[tuple[bytes, str]]:
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

    content_type = (response.headers.get("content-type") or "").split(";", 1)[0].strip().lower()
    if content_type not in ALLOWED_IMAGE_MIME_TYPES:
        guessed, _ = mimetypes.guess_type(filename or "")
        content_type = guessed if guessed in ALLOWED_IMAGE_MIME_TYPES else "image/png"
    return content, content_type


def parse_image_base64(image_base64: str) -> Optional[tuple[bytes, str]]:
    raw = (image_base64 or "").strip()
    if not raw:
        return None

    mime_type = "image/png"
    if raw.startswith("data:"):
        header, _, payload = raw.partition(",")
        if ";base64" not in header or not payload:
            raise AICopyrightRiskError("Invalid image data.")
        mime_type = header[5:].split(";", 1)[0].strip().lower() or mime_type
        raw = payload

    if mime_type not in ALLOWED_IMAGE_MIME_TYPES:
        raise AICopyrightRiskError("Only PNG, JPG, JPEG, or WEBP images are supported.")
    if len(raw) > MAX_INLINE_IMAGE_BASE64_CHARS:
        raise AICopyrightImageTooLarge("Image is too large for AI risk check.")

    try:
        image_bytes = base64.b64decode(raw, validate=True)
    except (ValueError, TypeError) as error:
        raise AICopyrightRiskError("Invalid image data.") from error

    if len(image_bytes) > MAX_INLINE_IMAGE_BYTES:
        raise AICopyrightImageTooLarge("Image is too large for AI risk check.")
    if not image_bytes:
        raise AICopyrightRiskError("Image is empty.")
    return image_bytes, mime_type


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
            raise AICopyrightRiskError("AI returned an unreadable response.")
        try:
            data = json.loads(raw[start : end + 1])
        except json.JSONDecodeError as error:
            raise AICopyrightRiskError("AI returned invalid JSON.") from error

    if not isinstance(data, dict):
        raise AICopyrightRiskError("AI returned an unexpected response.")
    return data


def _normalize_result(data: dict[str, Any], metadata: dict[str, Any]) -> dict[str, Any]:
    result = _stringify(data.get("result")).upper().replace(" ", "_").replace("-", "_")
    if result not in VALID_RESULTS:
        result = "NEEDS_REVIEW"

    try:
        score = int(float(data.get("score", 50)))
    except (TypeError, ValueError):
        score = 50
    score = min(100, max(0, score))

    risky_terms = _listify(data.get("risky_terms"))
    matched_categories = _listify(data.get("matched_categories"))
    known = _detect_known_ip_terms(
        metadata.get("title"),
        metadata.get("description"),
        metadata.get("main_tag"),
        metadata.get("primary_tag"),
        metadata.get("supporting_tags"),
        metadata.get("detected_trademark_terms"),
    )

    if known:
        known_terms = [item["term"] for item in known]
        known_categories = [item["category"] for item in known]
        risky_terms = sorted({*risky_terms, *known_terms}, key=str.lower)
        matched_categories = sorted({*matched_categories, *known_categories}, key=str.lower)
        result = "NOT_SAFE"
        score = max(score, 90)

    reason = _stringify(data.get("reason"))
    recommendation = _stringify(data.get("recommendation"))

    if not reason:
        if result == "SAFE":
            reason = "No obvious protected IP risk was detected in the image or metadata."
        elif result == "NOT_SAFE":
            reason = "The design appears to reference protected or famous IP."
        else:
            reason = "The design contains terms or visual cues that should be reviewed carefully."

    if not recommendation:
        if result == "SAFE":
            recommendation = "Review official sources before publishing."
        elif result == "NOT_SAFE":
            recommendation = "Do not publish until the risky references are removed or reviewed by a qualified professional."
        else:
            recommendation = "Review the flagged terms and image manually before publishing."

    return {
        "result": result,
        "score": score,
        "reason": reason[:600],
        "risky_terms": risky_terms[:20],
        "matched_categories": matched_categories[:12],
        "recommendation": recommendation[:600],
    }


async def check_copyright_risk(
    *,
    metadata: dict[str, Any],
    image_url: str = "",
    image_base64: str = "",
    image_bytes: Optional[bytes] = None,
    image_mime_type: str = "",
) -> dict[str, Any]:
    if AI_PROVIDER and AI_PROVIDER != "gemini":
        raise AICopyrightRiskError("AI risk check is configured for an unsupported provider.")
    if not GEMINI_API_KEY:
        raise AICopyrightRiskError("Gemini AI is not configured. Add GEMINI_API_KEY to backend/.env.")

    image_payload: Optional[tuple[bytes, str]] = None
    if image_bytes:
        if len(image_bytes) > MAX_INLINE_IMAGE_BYTES:
            raise AICopyrightRiskError("Image is too large for AI risk check.")
        mime_type = (image_mime_type or "").split(";", 1)[0].strip().lower()
        image_payload = (image_bytes, mime_type if mime_type in ALLOWED_IMAGE_MIME_TYPES else "image/png")
    elif image_base64:
        image_payload = parse_image_base64(image_base64)
    elif image_url:
        image_payload = await _download_image(image_url, _stringify(metadata.get("filename")))

    parts: list[dict[str, Any]] = [{"text": _build_prompt(metadata, bool(image_payload))}]
    if image_payload:
        img_bytes, mime_type = image_payload
        parts.append(
            {
                "inline_data": {
                    "mime_type": mime_type,
                    "data": base64.b64encode(img_bytes).decode("ascii"),
                }
            }
        )

    model = quote(AI_MODEL or "gemini-2.5-flash", safe="")
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
    payload = {
        "contents": [{"role": "user", "parts": parts}],
        "generationConfig": {
            "temperature": 0.18,
            "topP": 0.8,
            "response_mime_type": "application/json",
        },
    }

    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.post(url, params={"key": GEMINI_API_KEY}, json=payload)
    except httpx.HTTPError as error:
        raise AICopyrightRiskError("Could not reach Gemini AI. Try again in a moment.") from error

    if response.status_code >= 400:
        raise AICopyrightRiskError("Gemini AI could not check this design right now.")

    data = response.json()
    try:
        text = data["candidates"][0]["content"]["parts"][0]["text"]
    except (KeyError, IndexError, TypeError) as error:
        raise AICopyrightRiskError("Gemini AI returned an unexpected response.") from error

    return _normalize_result(_parse_json_response(text), metadata)
