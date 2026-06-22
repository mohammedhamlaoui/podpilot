from __future__ import annotations

from typing import Any, Optional


def build_status_timestamp_patch(
    status: str,
    *,
    now: str,
    existing_uploaded_at: Optional[Any] = None,
) -> dict[str, Any]:
    patch: dict[str, Any] = {"status": status, "updated_at": now}
    if status == "uploaded" and not existing_uploaded_at:
        patch["uploaded_at"] = now
    return patch
