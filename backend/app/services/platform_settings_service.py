"""Cached, fail-open reads for allowlisted operational feature settings."""
from __future__ import annotations

import threading
import time
from typing import Any

from app.services import supabase_service


DEFAULTS: dict[str, Any] = {
    "maintenance_mode": False,
    "public_announcement": "",
    "uploads_enabled": True,
    "ai_listing_enabled": True,
}
_cache = dict(DEFAULTS)
_cache_until = 0.0
_lock = threading.Lock()


def values(force: bool = False) -> dict[str, Any]:
    global _cache, _cache_until
    now = time.monotonic()
    if not force and now < _cache_until:
        return dict(_cache)
    with _lock:
        if not force and time.monotonic() < _cache_until:
            return dict(_cache)
        merged = dict(DEFAULTS)
        try:
            response = supabase_service.admin_client().table("admin_settings").select("key,value").in_("key", list(DEFAULTS)).execute()
            for row in response.data or []:
                key = str(row.get("key") or "")
                if key in DEFAULTS:
                    merged[key] = row.get("value")
        except Exception:
            # Before the additive migration, preserve current customer behavior.
            pass
        _cache = merged
        _cache_until = time.monotonic() + 30
        return dict(_cache)


def enabled(key: str) -> bool:
    return bool(values().get(key, DEFAULTS.get(key, False)))


def invalidate() -> None:
    global _cache_until
    _cache_until = 0.0
