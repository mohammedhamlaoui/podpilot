"""Fail-closed Owner authentication for PodPilot Admin HQ."""
from __future__ import annotations

import hashlib
import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import Cookie, Depends, Header, HTTPException, Request, Response, status

from app.core import config
from app.core.auth import AuthUser, get_current_user
from app.services import supabase_service
from app.services.logging_utils import request_id


ADMIN_COOKIE_NAME = "__Host-podpilot_admin" if config.ADMIN_COOKIE_SECURE else "podpilot_admin"


@dataclass(frozen=True)
class AdminPrincipal:
    user_id: str
    email: Optional[str]
    role: str
    capabilities: frozenset[str]
    session_id: str
    auth_level: str
    authenticated_at: datetime


OWNER_CAPABILITIES = frozenset({
    "overview.read", "users.read", "users.suspend", "users.sessions.revoke", "users.notes.write",
    "billing.read", "refunds.read", "designs.read", "designs.delete",
    "uploads.read", "ai.read", "affiliates.read", "affiliates.manage",
    "analytics.read", "settings.read", "settings.write", "security.read",
    "sessions.revoke", "search.read", "notifications.read",
})


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _parse_time(value: object) -> Optional[datetime]:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
    except (TypeError, ValueError):
        return None


def _table_row(table: str, **equals: str) -> Optional[dict]:
    try:
        query = supabase_service.admin_client().table(table).select("*")
        for key, value in equals.items():
            query = query.eq(key, value)
        result = query.limit(1).execute()
    except Exception as exc:
        # A missing admin migration must deny access, never fall back to the
        # generic app_metadata admin role.
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Admin security storage is unavailable.",
        ) from exc
    rows = list(result.data or [])
    return dict(rows[0]) if rows else None


def _active_principal(user_id: str) -> dict:
    row = _table_row("admin_principals", user_id=user_id)
    if not row or row.get("status") != "active" or row.get("role") != "owner":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Owner access required.")
    return row


def _origin_guard(request: Request) -> None:
    if request.method in {"GET", "HEAD", "OPTIONS"}:
        return
    origin = (request.headers.get("origin") or "").rstrip("/")
    if origin != config.ADMIN_APP_ORIGIN:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Invalid request origin.")


def _audit(actor_id: str, action: str, *, target_type: str = "admin_session", target_id: str = "", success: bool = True, reason: str = "", previous_state: Optional[dict] = None, new_state: Optional[dict] = None) -> None:
    try:
        supabase_service.admin_client().table("admin_audit_logs").insert({
            "actor_user_id": actor_id,
            "action": action,
            "target_type": target_type,
            "target_id": target_id or None,
            "reason": reason[:1000] or None,
            "previous_state": previous_state,
            "new_state": new_state,
            "success": success,
            "request_id": request_id(),
        }).execute()
    except Exception:
        # Authentication must not become available merely because auditing is
        # unavailable. Session creation calls this only after schema checks.
        if action == "admin_session_created":
            raise HTTPException(status_code=503, detail="Admin audit storage is unavailable.")


def _security_event(event_type: str, *, user_id: Optional[str] = None, severity: str = "info", metadata: Optional[dict] = None) -> None:
    try:
        supabase_service.admin_client().table("admin_security_events").insert({
            "user_id": user_id,
            "event_type": event_type,
            "severity": severity,
            "request_id": request_id(),
            "metadata": metadata or {},
        }).execute()
    except Exception:
        # Security telemetry is best effort; authoritative authorization still
        # fails closed through admin_principals/admin_sessions.
        pass


def create_admin_session(response: Response, user: AuthUser) -> dict:
    try:
        principal = _active_principal(user.id)
    except HTTPException:
        _security_event("owner_session_denied", user_id=user.id, severity="warning", metadata={"reason": "not_active_owner"})
        raise
    if config.ADMIN_REQUIRE_MFA and user.auth_level != "aal2":
        _security_event("owner_mfa_required", user_id=user.id, severity="warning", metadata={"auth_level": user.auth_level})
        raise HTTPException(status_code=403, detail="Multi-factor authentication is required.")

    now = _now()
    raw_token = secrets.token_urlsafe(48)
    csrf_token = secrets.token_urlsafe(32)
    expires_at = now + timedelta(hours=config.ADMIN_SESSION_ABSOLUTE_HOURS)
    session_id = secrets.token_hex(16)
    try:
        supabase_service.admin_client().table("admin_sessions").insert({
            "id": session_id,
            "user_id": user.id,
            "token_hash": _hash_token(raw_token),
            "csrf_hash": _hash_token(csrf_token),
            "auth_level": user.auth_level,
            "authenticated_at": now.isoformat(),
            "last_seen_at": now.isoformat(),
            "expires_at": expires_at.isoformat(),
        }).execute()
        _audit(user.id, "admin_session_created", target_id=session_id)
        _security_event("owner_login_succeeded", user_id=user.id, metadata={"session_id": session_id, "auth_level": user.auth_level})
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=503, detail="Admin session storage is unavailable.") from exc

    response.set_cookie(
        ADMIN_COOKIE_NAME,
        raw_token,
        max_age=config.ADMIN_SESSION_ABSOLUTE_HOURS * 3600,
        secure=config.ADMIN_COOKIE_SECURE,
        httponly=True,
        samesite="strict",
        path="/",
    )
    return {
        "owner": {"id": user.id, "email": user.email, "role": principal["role"]},
        "csrf_token": csrf_token,
        "expires_at": expires_at.isoformat(),
    }


def require_owner(
    request: Request,
    admin_token: Optional[str] = Cookie(default=None, alias=ADMIN_COOKIE_NAME),
    csrf_token: Optional[str] = Header(default=None, alias="X-CSRF-Token"),
) -> AdminPrincipal:
    if not admin_token:
        raise HTTPException(status_code=401, detail="Admin session required.")
    row = _table_row("admin_sessions", token_hash=_hash_token(admin_token))
    now = _now()
    if not row or row.get("revoked_at"):
        raise HTTPException(status_code=401, detail="Admin session is invalid.")
    expires_at = _parse_time(row.get("expires_at"))
    last_seen = _parse_time(row.get("last_seen_at"))
    if not expires_at or expires_at <= now or not last_seen or last_seen + timedelta(minutes=config.ADMIN_SESSION_IDLE_MINUTES) <= now:
        raise HTTPException(status_code=401, detail="Admin session expired.")
    if config.ADMIN_REQUIRE_MFA and row.get("auth_level") != "aal2":
        raise HTTPException(status_code=403, detail="Multi-factor authentication is required.")
    _origin_guard(request)
    if request.method not in {"GET", "HEAD", "OPTIONS"}:
        if not csrf_token or not secrets.compare_digest(_hash_token(csrf_token), str(row.get("csrf_hash") or "")):
            raise HTTPException(status_code=403, detail="Invalid CSRF token.")

    principal = _active_principal(str(row.get("user_id") or ""))
    try:
        supabase_service.admin_client().table("admin_sessions").update({"last_seen_at": now.isoformat()}).eq("id", row["id"]).execute()
    except Exception:
        pass
    return AdminPrincipal(
        user_id=str(row["user_id"]),
        email=principal.get("email"),
        role=str(principal["role"]),
        capabilities=OWNER_CAPABILITIES,
        session_id=str(row["id"]),
        auth_level=str(row["auth_level"]),
        authenticated_at=_parse_time(row.get("authenticated_at")) or last_seen,
    )


def require_capability(capability: str):
    def dependency(owner: AdminPrincipal = Depends(require_owner)) -> AdminPrincipal:
        if capability not in owner.capabilities:
            raise HTTPException(status_code=403, detail="Owner capability required.")
        return owner
    return dependency


def require_recent_auth(owner: AdminPrincipal) -> None:
    if (_now() - owner.authenticated_at).total_seconds() > config.ADMIN_REAUTH_MAX_AGE_SECONDS:
        raise HTTPException(status_code=403, detail="Recent reauthentication is required.")


def revoke_current_session(response: Response, owner: AdminPrincipal) -> dict:
    supabase_service.admin_client().table("admin_sessions").update({"revoked_at": _now().isoformat()}).eq("id", owner.session_id).execute()
    _audit(owner.user_id, "admin_session_revoked", target_id=owner.session_id)
    _security_event("owner_session_revoked", user_id=owner.user_id, metadata={"session_id": owner.session_id})
    response.delete_cookie(ADMIN_COOKIE_NAME, path="/")
    return {"ok": True}
