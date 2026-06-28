"""Signed CDN URL generation for private design images."""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import re
import time
from typing import Any, Optional
from urllib.parse import urlencode

from app.core.config import CDN_BASE_URL, CDN_SIGNING_SECRET, CDN_URL_TTL_SECONDS


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode("ascii").rstrip("=")


def _version_for_design(row: dict[str, Any], object_key: str) -> str:
    updated_at = str(row.get("updated_at") or row.get("created_at") or "").strip()
    digest = hashlib.sha256(f"{object_key}|{updated_at}".encode("utf-8")).hexdigest()
    return digest[:20]


SUPPORTED_CDN_MARKETPLACES = {"redbubble", "teepublic"}
ENCODED_TRAVERSAL_RE = re.compile(r"%(?:2e|2f|5c)", re.IGNORECASE)


def _parse_design_image_key(key: str) -> Optional[dict[str, str]]:
    if not key or key.startswith("/") or "\\" in key or "\0" in key:
        return None
    if ENCODED_TRAVERSAL_RE.search(key):
        return None
    parts = key.split("/")
    if any(part in {"", ".", ".."} for part in parts):
        return None
    if len(parts) != 5 or parts[0] != "users":
        return None
    marketplace = parts[2]
    if marketplace not in SUPPORTED_CDN_MARKETPLACES:
        return None
    return {
        "user_id": parts[1],
        "marketplace": marketplace,
        "design_id": parts[3],
        "filename": parts[4],
    }


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
    if not CDN_BASE_URL or not CDN_SIGNING_SECRET:
        return ""

    design_id = str(row.get("id") or row.get("design_id") or "").strip()
    object_key = str(row.get(key_name) or "").strip()
    key_parts = _parse_design_image_key(object_key)
    marketplace = str(row.get("marketplace") or "").strip()
    if not design_id or not key_parts or key_parts["design_id"] != design_id:
        return ""
    if not marketplace or key_parts["marketplace"] != marketplace:
        return ""

    ttl = ttl_seconds if ttl_seconds is not None else CDN_URL_TTL_SECONDS
    expires = int(time.time()) + max(1, int(ttl or 0))
    version = _version_for_design(row, object_key)
    payload = {
        "design_id": design_id,
        "exp": expires,
        "key": object_key,
        "marketplace": marketplace,
        "v": version,
    }
    token = _b64url(json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8"))
    signature = hmac.new(
        CDN_SIGNING_SECRET.encode("utf-8"),
        token.encode("ascii"),
        hashlib.sha256,
    ).hexdigest()
    query = urlencode({"token": token, "sig": signature, "v": version})
    return f"{CDN_BASE_URL}/designs/{design_id}/image?{query}"
