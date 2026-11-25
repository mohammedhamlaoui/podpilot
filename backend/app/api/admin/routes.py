"""PodPilot Admin HQ routes.

All routes except the session exchange are protected by the dedicated Owner
session dependency. No endpoint accepts a role, Owner ID, or privilege flag
from the browser.
"""
from __future__ import annotations

import hashlib
from datetime import datetime, timezone
from typing import Any, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
import httpx

from app.core import config
from app.core.auth import AuthUser, get_current_user
from app.services import admin_affiliate_service, admin_data_service, platform_settings_service, r2_service, supabase_service
from app.services.logging_utils import request_id
from .auth import (
    AdminPrincipal,
    _active_principal,
    _audit,
    create_admin_session,
    require_capability,
    require_owner,
    require_recent_auth,
    revoke_current_session,
)


router = APIRouter(prefix="/api/admin", tags=["Admin HQ"])


@router.get("/owner-eligibility")
def owner_eligibility(user: AuthUser = Depends(get_current_user)) -> dict[str, Any]:
    """Check the server allowlist before offering MFA enrollment."""
    principal = _active_principal(user.id)
    return {"owner": True, "email": principal.get("email") or user.email}


class AccountAction(BaseModel):
    reason: str = Field(min_length=4, max_length=1000)


class UserNote(BaseModel):
    text: str = Field(min_length=4, max_length=1000)


class SettingsPatch(BaseModel):
    value: bool | str | int | float | dict[str, Any]
    reason: str = Field(min_length=4, max_length=1000)
    expected_version: int = Field(ge=1)


class AcknowledgeNotification(BaseModel):
    acknowledged: bool = True


def _page_size(value: int) -> int:
    return max(1, min(100, value))


def _record_user_action(actor_id: str, user_id: str, action: str, reason: str, *, previous_state: Optional[dict] = None, new_state: Optional[dict] = None) -> None:
    """Fail closed for support notes and device actions that promise an audit trail."""
    try:
        supabase_service.admin_client().table("admin_audit_logs").insert({
            "actor_user_id": actor_id,
            "action": action,
            "target_type": "user",
            "target_id": user_id,
            "reason": reason,
            "previous_state": previous_state,
            "new_state": new_state,
            "success": True,
            "request_id": request_id(),
        }).execute()
    except Exception as exc:
        raise HTTPException(status_code=503, detail="Admin audit storage is unavailable.") from exc


@router.post("/session")
def exchange_owner_session(
    response: Response,
    user: AuthUser = Depends(get_current_user),
) -> dict[str, Any]:
    return create_admin_session(response, user)


@router.get("/session")
def current_owner_session(owner: AdminPrincipal = Depends(require_owner)) -> dict[str, Any]:
    return {
        "owner": {"id": owner.user_id, "email": owner.email, "role": owner.role},
        "auth_level": owner.auth_level,
        "authenticated_at": owner.authenticated_at.isoformat(),
        "capabilities": sorted(owner.capabilities),
    }


@router.delete("/session")
def logout_owner_session(response: Response, owner: AdminPrincipal = Depends(require_owner)) -> dict[str, bool]:
    return revoke_current_session(response, owner)


@router.get("/overview")
def admin_overview(
    days: Optional[int] = Query(default=30, ge=1, le=3650),
    _owner: AdminPrincipal = Depends(require_capability("overview.read")),
) -> dict[str, Any]:
    return admin_data_service.overview(days)


@router.get("/health/integrations")
def admin_integration_health(
    _owner: AdminPrincipal = Depends(require_capability("overview.read")),
) -> dict[str, Any]:
    return {"items": admin_data_service.integration_health()}


@router.get("/users")
def admin_users(
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=100),
    search: str = Query("", max_length=120),
    status: str = Query("", max_length=20),
    _owner: AdminPrincipal = Depends(require_capability("users.read")),
) -> dict[str, Any]:
    return admin_data_service.list_users(page=page, page_size=_page_size(page_size), search=search, status=status)


@router.get("/users/{user_id}")
def admin_user_detail(
    user_id: str,
    _owner: AdminPrincipal = Depends(require_capability("users.read")),
) -> dict[str, Any]:
    return admin_data_service.user_detail(user_id)


@router.get("/users/{user_id}/records/{kind}")
def admin_user_records(
    user_id: str,
    kind: str,
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=50),
    search: str = Query("", max_length=120),
    status: str = Query("", max_length=30),
    owner: AdminPrincipal = Depends(require_capability("users.read")),
) -> dict[str, Any]:
    extra_capability = "billing.read" if kind in {"subscriptions", "transactions"} else "refunds.read" if kind == "refunds" else "designs.read" if kind == "designs" else "uploads.read" if kind in {"uploads", "upload-logs"} else "ai.read" if kind == "ai" else "security.read" if kind in {"activity", "notes"} else None
    if extra_capability and extra_capability not in owner.capabilities:
        raise HTTPException(status_code=403, detail="This Owner session cannot access these records.")
    try:
        return admin_data_service.user_records(user_id, kind, page=page, page_size=page_size, search=search, status=status)
    except HTTPException:
        raise
    except Exception as exc:
        return {"items": [], "page": page, "page_size": page_size, "total": 0, "pages": 1, "status": "unavailable", "reason": type(exc).__name__}


@router.post("/users/{user_id}/notes")
def add_user_note(
    user_id: str,
    note: UserNote,
    owner: AdminPrincipal = Depends(require_capability("users.notes.write")),
) -> dict[str, Any]:
    try:
        result = supabase_service.admin_client().auth.admin.get_user_by_id(user_id)
        if not (getattr(result, "user", None) or result):
            raise HTTPException(status_code=404, detail="User not found.")
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=404, detail="User not found.") from exc
    text = note.text.strip()
    if len(text) < 4:
        raise HTTPException(status_code=422, detail="Write at least four characters.")
    _record_user_action(owner.user_id, user_id, "user_note_added", text)
    return {"ok": True}


@router.post("/users/{user_id}/devices/{device_row_id}/revoke")
def revoke_user_upload_device(
    user_id: str,
    device_row_id: str,
    action: AccountAction,
    owner: AdminPrincipal = Depends(require_capability("users.sessions.revoke")),
) -> dict[str, Any]:
    require_recent_auth(owner)
    client = supabase_service.admin_client()
    rows = list((client.table("user_active_devices").select("id,device_label,revoked_at").eq("id", device_row_id).eq("user_id", user_id).limit(1).execute()).data or [])
    if not rows:
        raise HTTPException(status_code=404, detail="Upload device not found for this customer.")
    if rows[0].get("revoked_at"):
        return {"ok": True, "already_revoked": True}
    _record_user_action(owner.user_id, user_id, "user_upload_device_revoke_requested", action.reason, previous_state={"device_row_id": device_row_id, "revoked_at": None})
    revoked_at = datetime.now(timezone.utc).isoformat()
    try:
        updated = client.table("user_active_devices").update({"revoked_at": revoked_at}).eq("id", device_row_id).eq("user_id", user_id).is_("revoked_at", "null").execute()
    except Exception as exc:
        raise HTTPException(status_code=503, detail="Could not disconnect the upload device.") from exc
    if not updated.data:
        raise HTTPException(status_code=409, detail="The upload device was already disconnected. Refresh its status.")
    try:
        _record_user_action(owner.user_id, user_id, "user_upload_device_revoked", action.reason, previous_state={"device_row_id": device_row_id, "revoked_at": None}, new_state={"device_row_id": device_row_id, "revoked_at": revoked_at})
    except HTTPException as exc:
        raise HTTPException(status_code=503, detail="The device was disconnected, but its completion audit could not be saved. Refresh the device list.") from exc
    return {"ok": True, "revoked_at": revoked_at}


def _set_account_status(user_id: str, status_value: str, action: AccountAction, owner: AdminPrincipal) -> dict[str, Any]:
    require_recent_auth(owner)
    if user_id == owner.user_id:
        raise HTTPException(status_code=409, detail="The Owner account cannot be suspended from Admin HQ.")
    client = supabase_service.admin_client()
    previous_rows = list((client.table("user_account_controls").select("status,reason,changed_at").eq("user_id", user_id).limit(1).execute()).data or [])
    previous = dict(previous_rows[0]) if previous_rows else {"status": "active"}
    payload = {"user_id": user_id, "status": status_value, "reason": action.reason, "changed_by": owner.user_id, "changed_at": datetime.now(timezone.utc).isoformat()}
    client.table("user_account_controls").upsert(payload, on_conflict="user_id").execute()
    _audit(owner.user_id, f"user_{status_value}", target_type="user", target_id=user_id, reason=action.reason, previous_state=previous, new_state={"status": status_value})
    return {"user_id": user_id, "status": status_value, "changed_at": payload["changed_at"]}


@router.post("/users/{user_id}/suspend")
def suspend_user(user_id: str, action: AccountAction, owner: AdminPrincipal = Depends(require_capability("users.suspend"))) -> dict[str, Any]:
    return _set_account_status(user_id, "suspended", action, owner)


@router.post("/users/{user_id}/reactivate")
def reactivate_user(user_id: str, action: AccountAction, owner: AdminPrincipal = Depends(require_capability("users.suspend"))) -> dict[str, Any]:
    return _set_account_status(user_id, "active", action, owner)


@router.post("/users/{user_id}/revoke-sessions")
def revoke_user_sessions(user_id: str, action: AccountAction, owner: AdminPrincipal = Depends(require_capability("users.sessions.revoke"))) -> dict[str, Any]:
    require_recent_auth(owner)
    if user_id == owner.user_id:
        raise HTTPException(status_code=409, detail="Use the Admin session control to revoke the active Owner session.")
    try:
        # Use the GoTrue admin logout endpoint; customer tokens never transit
        # through Admin HQ or appear in the audit record.
        with httpx.Client(timeout=10.0) as client:
            result = client.post(
                f"{config.SUPABASE_URL}/auth/v1/admin/users/{user_id}/logout",
                headers={
                    "apikey": config.SUPABASE_SERVICE_ROLE_KEY,
                    "Authorization": f"Bearer {config.SUPABASE_SERVICE_ROLE_KEY}",
                },
            )
            result.raise_for_status()
    except Exception as exc:
        raise HTTPException(status_code=502, detail="Could not revoke customer sessions.") from exc
    _audit(owner.user_id, "user_sessions_revoked", target_type="user", target_id=user_id, reason=action.reason)
    return {"ok": True, "user_id": user_id}


@router.post("/users/{user_id}/send-recovery")
def send_user_recovery(user_id: str, action: AccountAction, owner: AdminPrincipal = Depends(require_capability("users.sessions.revoke"))) -> dict[str, Any]:
    require_recent_auth(owner)
    try:
        result = supabase_service.admin_client().auth.admin.get_user_by_id(user_id)
        target = getattr(result, "user", None) or result
        email = target.get("email") if isinstance(target, dict) else getattr(target, "email", None)
        if not email:
            raise HTTPException(status_code=409, detail="The customer account has no recovery email.")
        with httpx.Client(timeout=10.0) as client:
            recovery = client.post(
                f"{config.SUPABASE_URL}/auth/v1/recover?redirect_to={config.PUBLIC_APP_URL}/reset-password",
                headers={"apikey": config.SUPABASE_ANON_KEY, "Content-Type": "application/json"},
                json={"email": str(email)},
            )
            recovery.raise_for_status()
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=502, detail="Could not initiate account recovery.") from exc
    _audit(owner.user_id, "user_recovery_requested", target_type="user", target_id=user_id, reason=action.reason)
    return {"ok": True, "user_id": user_id, "message": "Recovery instructions were requested for the customer's verified email."}


@router.get("/billing/subscriptions")
def admin_subscriptions(
    page: int = Query(1, ge=1), page_size: int = Query(25, ge=1, le=100),
    status: str = "", plan: str = "", user_id: str = "",
    _owner: AdminPrincipal = Depends(require_capability("billing.read")),
) -> dict[str, Any]:
    return admin_data_service.list_subscriptions(page=page, page_size=page_size, status=status, plan=plan, user_id=user_id)


@router.get("/billing/transactions")
def admin_transactions(
    page: int = Query(1, ge=1), page_size: int = Query(25, ge=1, le=100), status: str = "",
    _owner: AdminPrincipal = Depends(require_capability("billing.read")),
) -> dict[str, Any]:
    try:
        return admin_data_service.list_table("billing_transactions", "paddle_transaction_id,customer_user_id,paddle_customer_id,paddle_subscription_id,status,currency_code,gross_amount_minor,tax_amount_minor,fee_amount_minor,occurred_at,updated_at", page=page, page_size=page_size, filters={"status": status}, order="occurred_at")
    except Exception as exc:
        return {"items": [], "page": page, "page_size": page_size, "total": 0, "pages": 1, "status": "unavailable", "reason": type(exc).__name__}


@router.get("/billing/refunds")
def admin_refunds(
    page: int = Query(1, ge=1), page_size: int = Query(25, ge=1, le=100), status: str = "",
    _owner: AdminPrincipal = Depends(require_capability("refunds.read")),
) -> dict[str, Any]:
    try:
        return admin_data_service.list_table("billing_adjustments", "*", page=page, page_size=page_size, filters={"status": status}, order="occurred_at")
    except Exception as exc:
        return {"items": [], "page": page, "page_size": page_size, "total": 0, "pages": 1, "status": "unavailable", "reason": type(exc).__name__}


@router.get("/designs")
def admin_designs(
    page: int = Query(1, ge=1), page_size: int = Query(25, ge=1, le=100), search: str = Query("", max_length=120),
    marketplace: str = "", status: str = "", user_id: str = "",
    _owner: AdminPrincipal = Depends(require_capability("designs.read")),
) -> dict[str, Any]:
    return admin_data_service.list_designs(page=page, page_size=page_size, search=search, marketplace=marketplace, status=status, user_id=user_id)


def _design(design_id: str) -> dict[str, Any]:
    rows = list((supabase_service.admin_client().table("designs").select("*").eq("id", design_id).limit(1).execute()).data or [])
    if not rows:
        raise HTTPException(status_code=404, detail="Design not found.")
    return dict(rows[0])


@router.get("/designs/{design_id}")
def admin_design_detail(design_id: str, _owner: AdminPrincipal = Depends(require_capability("designs.read"))) -> dict[str, Any]:
    row = _design(design_id)
    for column in ("image_r2_key", "thumbnail_r2_key", "excel_r2_key", "ai_preview_r2_key"):
        row[column] = bool(row.get(column))
    return row


@router.get("/designs/{design_id}/preview")
def admin_design_preview(
    design_id: str,
    kind: Literal["image", "thumbnail"] = "thumbnail",
    _owner: AdminPrincipal = Depends(require_capability("designs.read")),
) -> StreamingResponse:
    row = _design(design_id)
    key = str(row.get("thumbnail_r2_key" if kind == "thumbnail" else "image_r2_key") or "")
    if not key:
        raise HTTPException(status_code=404, detail="Preview is unavailable.")
    try:
        obj = r2_service.get_object_stream(key)
    except r2_service.R2NotFound as exc:
        raise HTTPException(status_code=404, detail="Preview is unavailable.") from exc
    except r2_service.R2Error as exc:
        raise HTTPException(status_code=502, detail="Storage preview failed.") from exc

    def stream():
        body = obj["body"]
        try:
            while True:
                chunk = body.read(64 * 1024)
                if not chunk:
                    break
                yield chunk
        finally:
            close = getattr(body, "close", None)
            if callable(close):
                close()
    return StreamingResponse(stream(), media_type=obj.get("content_type") or "application/octet-stream", headers={"Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff"})


@router.post("/designs/{design_id}/deletion-preview")
def admin_design_deletion_preview(design_id: str, _owner: AdminPrincipal = Depends(require_capability("designs.delete"))) -> dict[str, Any]:
    row = _design(design_id)
    keys = []
    shared = []
    client = supabase_service.admin_client()
    for column in ("image_r2_key", "thumbnail_r2_key", "excel_r2_key", "ai_preview_r2_key"):
        key = str(row.get(column) or "").strip()
        if not key:
            continue
        references = list((client.table("designs").select("id").eq(column, key).neq("id", design_id).limit(1).execute()).data or [])
        info = {"kind": column.removesuffix("_r2_key"), "fingerprint": hashlib.sha256(key.encode()).hexdigest()[:16]}
        (shared if references else keys).append(info)
    return {"design_id": design_id, "filename": row.get("filename"), "customer_user_id": row.get("user_id"), "deletable_objects": keys, "retained_shared_objects": shared, "requires_reauthentication": True, "deletion_enabled": False, "reason": "Live deletion remains disabled until recovery verification passes."}


@router.get("/uploads")
def admin_uploads(
    page: int = Query(1, ge=1), page_size: int = Query(25, ge=1, le=100), marketplace: str = "", status: str = "", user_id: str = "",
    _owner: AdminPrincipal = Depends(require_capability("uploads.read")),
) -> dict[str, Any]:
    return admin_data_service.list_uploads(page=page, page_size=page_size, marketplace=marketplace, status=status, user_id=user_id)


@router.get("/uploads/{job_id}")
def admin_upload_detail(job_id: str, _owner: AdminPrincipal = Depends(require_capability("uploads.read"))) -> dict[str, Any]:
    jobs = list((supabase_service.admin_client().table("upload_jobs").select("*").eq("id", job_id).limit(1).execute()).data or [])
    if not jobs:
        raise HTTPException(status_code=404, detail="Upload job not found.")
    logs = list((supabase_service.admin_client().table("upload_logs").select("id,design_id,level,message,created_at").eq("job_id", job_id).order("created_at").limit(500).execute()).data or [])
    return {"job": jobs[0], "logs": logs}


@router.get("/ai/usage")
def admin_ai_usage(
    page: int = Query(1, ge=1), page_size: int = Query(25, ge=1, le=100), provider: str = "", status: str = "", user_id: str = "",
    _owner: AdminPrincipal = Depends(require_capability("ai.read")),
) -> dict[str, Any]:
    return admin_data_service.list_ai_usage(page=page, page_size=page_size, provider=provider, status=status, user_id=user_id)


@router.get("/affiliates/overview")
def admin_affiliates_overview(_owner: AdminPrincipal = Depends(require_capability("affiliates.read"))) -> dict[str, Any]:
    return admin_data_service.affiliate_overview()


@router.get("/affiliates/accounts")
def admin_affiliate_accounts(
    page: int = Query(1, ge=1), page_size: int = Query(25, ge=1, le=100), search: str = "", status: str = "",
    _owner: AdminPrincipal = Depends(require_capability("affiliates.read")),
) -> dict[str, Any]:
    return admin_affiliate_service.list_accounts(page=page, page_size=page_size, search=search or None, status=status or None)


@router.get("/analytics")
def admin_analytics(days: Optional[int] = Query(30, ge=1, le=3650), _owner: AdminPrincipal = Depends(require_capability("analytics.read"))) -> dict[str, Any]:
    overview = admin_data_service.overview(days)
    series = admin_data_service.activity_series(days or 30)
    return {
        "period": overview["period"],
        "metrics": overview["metrics"],
        "series": series["items"],
        "series_status": series["status"],
        "series_reason": None if series["status"] == "available" else "No activity source is currently available.",
        "series_meta": {key: value for key, value in series.items() if key != "items"},
    }


@router.get("/settings")
def admin_settings(_owner: AdminPrincipal = Depends(require_capability("settings.read"))) -> dict[str, Any]:
    return admin_data_service.settings()


ALLOWED_SETTINGS = {"maintenance_mode": "boolean", "public_announcement": "string", "uploads_enabled": "boolean", "ai_listing_enabled": "boolean"}


@router.patch("/settings/{key}")
def update_admin_setting(key: str, patch: SettingsPatch, owner: AdminPrincipal = Depends(require_capability("settings.write"))) -> dict[str, Any]:
    require_recent_auth(owner)
    expected_type = ALLOWED_SETTINGS.get(key)
    if not expected_type:
        raise HTTPException(status_code=400, detail="Setting is not editable from Admin HQ.")
    valid = (expected_type == "boolean" and isinstance(patch.value, bool)) or (expected_type == "string" and isinstance(patch.value, str))
    if not valid:
        raise HTTPException(status_code=422, detail=f"Setting requires a {expected_type} value.")
    client = supabase_service.admin_client()
    existing = list((client.table("admin_settings").select("value,version").eq("key", key).limit(1).execute()).data or [])
    current = existing[0] if existing else None
    if current and int(current.get("version") or 1) != patch.expected_version:
        raise HTTPException(status_code=409, detail="Setting changed since it was loaded.")
    next_version = (int(current.get("version") or 0) + 1) if current else 1
    payload = {"key": key, "value": patch.value, "value_type": expected_type, "version": next_version, "updated_by": owner.user_id, "updated_at": datetime.now(timezone.utc).isoformat(), "is_sensitive": False}
    client.table("admin_settings").upsert(payload, on_conflict="key").execute()
    platform_settings_service.invalidate()
    client.table("admin_audit_logs").insert({"actor_user_id": owner.user_id, "action": "setting_updated", "target_type": "setting", "target_id": key, "reason": patch.reason, "previous_state": {"value": current.get("value") if current else None, "version": current.get("version") if current else None}, "new_state": {"value": patch.value, "version": next_version}, "success": True}).execute()
    return {"key": key, "value": patch.value, "version": next_version}


@router.get("/security/audit-logs")
def admin_audit_logs(page: int = Query(1, ge=1), page_size: int = Query(25, ge=1, le=100), action: str = "", _owner: AdminPrincipal = Depends(require_capability("security.read"))) -> dict[str, Any]:
    return admin_data_service.list_audit(page=page, page_size=page_size, action=action)


@router.get("/security/sessions")
def admin_sessions(_owner: AdminPrincipal = Depends(require_capability("security.read"))) -> dict[str, Any]:
    rows = list((supabase_service.admin_client().table("admin_sessions").select("id,user_id,auth_level,authenticated_at,last_seen_at,expires_at,revoked_at,created_at").order("created_at", desc=True).limit(100).execute()).data or [])
    return {"items": rows}


@router.post("/security/sessions/{session_id}/revoke")
def revoke_admin_session(
    session_id: str,
    action: AccountAction,
    owner: AdminPrincipal = Depends(require_capability("sessions.revoke")),
) -> dict[str, Any]:
    require_recent_auth(owner)
    client = supabase_service.admin_client()
    rows = list((client.table("admin_sessions").select("id,user_id,revoked_at").eq("id", session_id).limit(1).execute()).data or [])
    if not rows:
        raise HTTPException(status_code=404, detail="Admin session not found.")
    revoked_at = datetime.now(timezone.utc).isoformat()
    client.table("admin_sessions").update({"revoked_at": revoked_at}).eq("id", session_id).execute()
    _audit(owner.user_id, "admin_session_revoked", target_type="admin_session", target_id=session_id, reason=action.reason, previous_state={"revoked_at": rows[0].get("revoked_at")}, new_state={"revoked_at": revoked_at})
    return {"ok": True, "id": session_id, "revoked_at": revoked_at, "current_session": session_id == owner.session_id}


@router.get("/security/events")
def admin_security_events(
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=100),
    _owner: AdminPrincipal = Depends(require_capability("security.read")),
) -> dict[str, Any]:
    return admin_data_service.list_table("admin_security_events", "id,user_id,event_type,severity,request_id,metadata,created_at", page=page, page_size=page_size)


@router.get("/notifications")
def admin_notifications(page: int = Query(1, ge=1), page_size: int = Query(25, ge=1, le=100), _owner: AdminPrincipal = Depends(require_capability("notifications.read"))) -> dict[str, Any]:
    return admin_data_service.notifications(page=page, page_size=page_size)


@router.patch("/notifications/{notification_id}")
def acknowledge_notification(notification_id: str, body: AcknowledgeNotification, owner: AdminPrincipal = Depends(require_capability("notifications.read"))) -> dict[str, Any]:
    timestamp = datetime.now(timezone.utc).isoformat() if body.acknowledged else None
    response = supabase_service.admin_client().table("admin_notifications").update({"acknowledged_at": timestamp, "acknowledged_by": owner.user_id if timestamp else None}).eq("id", notification_id).execute()
    if not list(response.data or []):
        raise HTTPException(status_code=404, detail="Notification not found.")
    return {"id": notification_id, "acknowledged_at": timestamp}


@router.get("/search")
def admin_search(q: str = Query(min_length=2, max_length=120), _owner: AdminPrincipal = Depends(require_capability("search.read"))) -> dict[str, Any]:
    users = admin_data_service.list_users(page=1, page_size=8, search=q).get("items", [])
    designs = admin_data_service.list_designs(page=1, page_size=8, search=q, marketplace="", status="", user_id="").get("items", [])
    subscriptions = []
    if q.startswith(("sub_", "ctm_")):
        column = "paddle_subscription_id" if q.startswith("sub_") else "paddle_customer_id"
        try:
            subscriptions = list((supabase_service.admin_client().table("subscriptions").select("user_id,plan,status,paddle_customer_id,paddle_subscription_id").ilike(column, f"%{q}%").limit(8).execute()).data or [])
        except Exception:
            subscriptions = []
    return {"query": q, "results": {"users": users, "designs": designs, "subscriptions": subscriptions}}
