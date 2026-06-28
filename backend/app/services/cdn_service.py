"""Signed CDN URL generation for private design images."""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import logging
import re
import time
from typing import Any, Optional
from urllib.parse import urlencode

from app.core.config import CDN_BASE_URL, CDN_SIGNING_SECRET, CDN_URL_TTL_SECONDS

logger = logging.getLogger(__name__)


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode("ascii").rstrip("=")


def _version_for_design(row: dict[str, Any], object_key: str) -> str:
    updated_at = str(row.get("updated_at") or row.get("created_at") or "").strip()
    digest = hashlib.sha256(f"{object_key}|{updated_at}".encode("utf-8")).hexdigest()
    return digest[:20]


SUPPORTED_CDN_MARKETPLACES = {"redbubble", "teepublic"}
ENCODED_TRAVERSAL_RE = re.compile(r"%(?:2e|2f|5c)", re.IGNORECASE)
RESERVED_CDN_KEY_SEGMENTS = {"imports", "tmp", "temp", "backup", "backups", "thumbnails"}


def _parse_design_asset_key(key: str, *, asset_type: str) -> Optional[dict[str, str]]:
    if not key or key.startswith("/") or "\\" in key or "\0" in key:
        return None
    if ENCODED_TRAVERSAL_RE.search(key):
        return None
    parts = key.split("/")
    if any(part in {"", ".", ".."} for part in parts):
        return None
    if parts[0] != "users":
        return None
    if len(parts) < 5:
        return None
    user_id = parts[1]
    marketplace = parts[2]
    if not user_id or marketplace not in SUPPORTED_CDN_MARKETPLACES:
        return None

    if asset_type == "image":
        if len(parts) != 5:
            return None
        object_id = parts[3]
        filename = parts[4]
        if object_id.lower() in RESERVED_CDN_KEY_SEGMENTS or not filename:
            return None
        return {
            "asset_type": "image",
            "filename": filename,
            "marketplace": marketplace,
            "object_id": object_id,
            "user_id": user_id,
        }

    if asset_type == "thumbnail":
        if len(parts) != 6 or parts[4] != "thumbnails":
            return None
        design_id = parts[3]
        filename = parts[5]
        if design_id.lower() in RESERVED_CDN_KEY_SEGMENTS or not filename:
            return None
        return {
            "asset_type": "thumbnail",
            "design_id": design_id,
            "filename": filename,
            "marketplace": marketplace,
            "user_id": user_id,
        }

    return None


def _asset_type_for_key_name(key_name: str) -> str:
    return "thumbnail" if key_name == "thumbnail_r2_key" else "image"


def _log_omit(design_id: str, reason: str) -> None:
    logger.info("[PodPilot][CDN] omit cdn_image_url designId=%s reason=%s", design_id or "unknown", reason)


def sign_design_image_url(
    row: dict[str, Any],
    *,
    key_name: str = "image_r2_key",
    ttl_seconds: Optional[int] = None,
) -> str:
    """Return a signed CDN URL for a design image, or "" if CDN is disabled.

    Callers must only pass rows that were already scoped to the authenticated
    user. This helper refuses empty/unsafe object keys and never exposes raw R2
    URLs.
    """
    design_id = str(row.get("id") or row.get("design_id") or "").strip()
    if not CDN_BASE_URL or not CDN_SIGNING_SECRET:
        _log_omit(design_id, "signing_disabled")
        return ""

    object_key = str(row.get(key_name) or "").strip()
    if not object_key:
        _log_omit(design_id, "missing_key")
        return ""

    asset_type = _asset_type_for_key_name(key_name)
    key_parts = _parse_design_asset_key(object_key, asset_type=asset_type)
    marketplace = str(row.get("marketplace") or "").strip()
    user_id = str(row.get("user_id") or "").strip()
    if not design_id or not user_id or not key_parts:
        _log_omit(design_id, "invalid_key_shape")
        return ""
    if key_parts["user_id"] != user_id or not marketplace or key_parts["marketplace"] != marketplace:
        _log_omit(design_id, "invalid_key_shape")
        return ""
    if asset_type == "thumbnail" and key_parts.get("design_id") != design_id:
        _log_omit(design_id, "invalid_key_shape")
        return ""

    try:
        ttl = ttl_seconds if ttl_seconds is not None else CDN_URL_TTL_SECONDS
        expires = int(time.time()) + max(1, int(ttl or 0))
        version = _version_for_design(row, object_key)
        payload = {
            "asset_type": asset_type,
            "design_id": design_id,
            "exp": expires,
            "key": object_key,
            "marketplace": marketplace,
            "user_id": user_id,
            "v": version,
        }
        token = _b64url(json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8"))
        signature = hmac.new(
            CDN_SIGNING_SECRET.encode("utf-8"),
            token.encode("ascii"),
            hashlib.sha256,
        ).hexdigest()
        query = urlencode({"token": token, "sig": signature, "v": version})
        logger.info("[PodPilot][CDN] signed cdn_image_url designId=%s asset=%s key=%s", design_id, asset_type, object_key)
        return f"{CDN_BASE_URL}/designs/{design_id}/{asset_type}?{query}"
    except Exception:
        logger.exception("[PodPilot][CDN] omit cdn_image_url designId=%s reason=sign_error", design_id or "unknown")
        return ""
