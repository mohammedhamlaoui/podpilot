"""Upload-control device lock for PodPilot automation sessions."""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from fastapi import HTTPException, status

from app.services import supabase_service
from app.services.logging_utils import error_type as safe_error_type, short_user_id


logger = logging.getLogger("podpilot.devices")

DEVICE_TABLE = "user_active_devices"
DEVICE_TIMEOUT_MINUTES = 30
DEVICE_ALREADY_ACTIVE_CODE = "device_already_active"
DEVICE_SESSION_REVOKED_CODE = "device_session_revoked"
DEVICE_REQUIRED_CODE = "device_session_required"
DEVICE_ALREADY_ACTIVE_MESSAGE = "PodPilot is already connected to another browser for upload automation."
DEVICE_SESSION_REVOKED_MESSAGE = "This upload session was disconnected because upload control was switched to another device."
DEVICE_REQUIRED_MESSAGE = "Upload control requires this device to be registered."


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _now_iso() -> str:
    return _now().isoformat()


def _parse_datetime(value: Any) -> Optional[datetime]:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _clean_text(value: Optional[str], max_length: int = 500) -> Optional[str]:
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    return text[:max_length]


def _device_error(status_code: int, code: str, message: str) -> HTTPException:
    return HTTPException(
        status_code=status_code,
        detail={
            "code": code,
            "message": message,
        },
    )


def _is_stale(row: dict[str, Any], timeout_minutes: int = DEVICE_TIMEOUT_MINUTES) -> bool:
    last_seen = _parse_datetime(row.get("last_seen_at")) or _parse_datetime(row.get("created_at"))
    if not last_seen:
        return True
    return last_seen <= (_now() - timedelta(minutes=timeout_minutes))


def _active_devices_for_user(user_id: str) -> list[dict[str, Any]]:
    response = (
        supabase_service.admin_client()
        .table(DEVICE_TABLE)
        .select("*")
        .eq("user_id", user_id)
        .is_("revoked_at", "null")
        .order("last_seen_at", desc=True)
        .execute()
    )
    return [dict(row) for row in list(response.data or [])]


def _active_device_for_user(user_id: str) -> Optional[dict[str, Any]]:
    rows = _active_devices_for_user(user_id)
    return rows[0] if rows else None


def _revoke_active_devices(user_id: str, *, except_device_id: Optional[str] = None) -> None:
    rows = _active_devices_for_user(user_id)
    now = _now_iso()
    for row in rows:
        device_id = str(row.get("device_id") or "")
        if except_device_id and device_id == except_device_id:
            continue
        row_id = row.get("id")
        query = (
            supabase_service.admin_client()
            .table(DEVICE_TABLE)
            .update({"revoked_at": now})
        )
        if row_id:
            query = query.eq("id", row_id)
        else:
            query = query.eq("user_id", user_id).eq("device_id", device_id).is_("revoked_at", "null")
        query.execute()


def _upsert_current_device(
    user_id: str,
    device_id: str,
    *,
    device_label: Optional[str] = None,
    user_agent: Optional[str] = None,
) -> dict[str, Any]:
    now = _now_iso()
    active = _active_device_for_user(user_id)
    payload = {
        "last_seen_at": now,
        "device_label": _clean_text(device_label, 200),
        "user_agent": _clean_text(user_agent, 500),
    }
    if active and str(active.get("device_id") or "") == device_id:
        response = (
            supabase_service.admin_client()
            .table(DEVICE_TABLE)
            .update({k: v for k, v in payload.items() if v is not None})
            .eq("id", active.get("id"))
            .execute()
        )
        rows = list(response.data or [])
        return dict(rows[0]) if rows else {**active, **payload}

    insert_payload = {
        "user_id": user_id,
        "device_id": device_id,
        "device_label": payload["device_label"],
        "user_agent": payload["user_agent"],
        "last_seen_at": now,
    }
    response = (
        supabase_service.admin_client()
        .table(DEVICE_TABLE)
        .insert({k: v for k, v in insert_payload.items() if v is not None})
        .execute()
    )
    rows = list(response.data or [])
    return dict(rows[0]) if rows else insert_payload


def normalize_device_id(device_id: Optional[str]) -> str:
    value = str(device_id or "").strip()
    if not value or len(value) > 128:
        raise _device_error(status.HTTP_400_BAD_REQUEST, DEVICE_REQUIRED_CODE, DEVICE_REQUIRED_MESSAGE)
    return value


def get_device_status(user_id: str, device_id: Optional[str] = None) -> dict[str, Any]:
    active = _active_device_for_user(user_id)
    current_device_id = str(device_id or "").strip()
    if not active:
        return {
            "status": "none",
            "active": False,
            "timeout_minutes": DEVICE_TIMEOUT_MINUTES,
        }

    active_device_id = str(active.get("device_id") or "")
    stale = _is_stale(active)
    if current_device_id and active_device_id == current_device_id:
        return {
            "status": "active",
            "active": True,
            "device": active,
            "timeout_minutes": DEVICE_TIMEOUT_MINUTES,
        }
    return {
        "status": "stale" if stale else "other_active",
        "active": False,
        "has_other_active_device": not stale,
        "device": {
            "device_label": active.get("device_label"),
            "last_seen_at": active.get("last_seen_at"),
            "created_at": active.get("created_at"),
        },
        "timeout_minutes": DEVICE_TIMEOUT_MINUTES,
    }


def register_device(
    user_id: str,
    device_id: str,
    *,
    device_label: Optional[str] = None,
    user_agent: Optional[str] = None,
    force: bool = False,
) -> dict[str, Any]:
    clean_device_id = normalize_device_id(device_id)
    active = _active_device_for_user(user_id)
    if active:
        active_device_id = str(active.get("device_id") or "")
        if active_device_id == clean_device_id:
            device = _upsert_current_device(
                user_id,
                clean_device_id,
                device_label=device_label,
                user_agent=user_agent,
            )
            return {
                "status": "active",
                "device": device,
                "timeout_minutes": DEVICE_TIMEOUT_MINUTES,
            }
        if not force and not _is_stale(active):
            raise _device_error(
                status.HTTP_409_CONFLICT,
                DEVICE_ALREADY_ACTIVE_CODE,
                DEVICE_ALREADY_ACTIVE_MESSAGE,
            )
        _revoke_active_devices(user_id)

    try:
        device = _upsert_current_device(
            user_id,
            clean_device_id,
            device_label=device_label,
            user_agent=user_agent,
        )
    except Exception as exc:
        logger.warning(
            "device_register_retry user=%s error_type=%s",
            short_user_id(user_id),
            safe_error_type(exc),
        )
        active = _active_device_for_user(user_id)
        if active and str(active.get("device_id") or "") != clean_device_id and not force and not _is_stale(active):
            raise _device_error(
                status.HTTP_409_CONFLICT,
                DEVICE_ALREADY_ACTIVE_CODE,
                DEVICE_ALREADY_ACTIVE_MESSAGE,
            ) from exc
        _revoke_active_devices(user_id, except_device_id=clean_device_id)
        device = _upsert_current_device(
            user_id,
            clean_device_id,
            device_label=device_label,
            user_agent=user_agent,
        )
    return {
        "status": "active",
        "device": device,
        "timeout_minutes": DEVICE_TIMEOUT_MINUTES,
    }


def switch_device(
    user_id: str,
    device_id: str,
    *,
    device_label: Optional[str] = None,
    user_agent: Optional[str] = None,
) -> dict[str, Any]:
    return register_device(
        user_id,
        device_id,
        device_label=device_label,
        user_agent=user_agent,
        force=True,
    )


def heartbeat_device(user_id: str, device_id: str) -> dict[str, Any]:
    validate_device(user_id, device_id)
    return {"status": "active", "timeout_minutes": DEVICE_TIMEOUT_MINUTES}


def revoke_device(user_id: str, device_id: Optional[str]) -> dict[str, Any]:
    clean_device_id = str(device_id or "").strip()
    if clean_device_id:
        (
            supabase_service.admin_client()
            .table(DEVICE_TABLE)
            .update({"revoked_at": _now_iso()})
            .eq("user_id", user_id)
            .eq("device_id", clean_device_id)
            .is_("revoked_at", "null")
            .execute()
        )
    else:
        _revoke_active_devices(user_id)
    return {"status": "revoked"}


def validate_device(user_id: str, device_id: Optional[str]) -> None:
    clean_device_id = normalize_device_id(device_id)
    active = _active_device_for_user(user_id)
    if not active:
        raise _device_error(status.HTTP_403_FORBIDDEN, DEVICE_REQUIRED_CODE, DEVICE_REQUIRED_MESSAGE)
    if str(active.get("device_id") or "") != clean_device_id:
        if _is_stale(active):
            _revoke_active_devices(user_id)
            raise _device_error(status.HTTP_403_FORBIDDEN, DEVICE_REQUIRED_CODE, DEVICE_REQUIRED_MESSAGE)
        raise _device_error(
            status.HTTP_403_FORBIDDEN,
            DEVICE_SESSION_REVOKED_CODE,
            DEVICE_SESSION_REVOKED_MESSAGE,
        )
    _upsert_current_device(user_id, clean_device_id)
