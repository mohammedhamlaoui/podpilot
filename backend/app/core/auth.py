"""Supabase JWT verification.

Every protected endpoint declares `user: AuthUser = Depends(get_current_user)`.
The dependency:
  1. Reads the bearer token from Authorization.
  2. Calls Supabase Auth (`/auth/v1/user`) with the token + anon apikey.
     Supabase validates signature, expiry, audience and returns the user
     record on success or 401 on failure.
  3. Returns an AuthUser dataclass with `id` (UUID string) and `email`.

The user_id from this dependency is the only authoritative identity used
for scoping every database query and every R2 path. It MUST come from the
verified token, never from a request body or query string.
"""
from dataclasses import dataclass
from typing import Any, Optional

import base64
import httpx
import json
import logging
import time
from fastapi import Depends, Header, HTTPException, status, Request

from app.core.config import SUPABASE_ANON_KEY, SUPABASE_URL
from app.services.logging_utils import request_id

logger = logging.getLogger("podpilot.auth")


@dataclass(frozen=True)
class AuthUser:
    id: str
    email: Optional[str]
    access_token: str
    app_metadata: Optional[dict[str, Any]] = None
    auth_level: str = "aal1"
    session_id: Optional[str] = None


_AUTH_USER_ENDPOINT = f"{SUPABASE_URL}/auth/v1/user"


def _extract_bearer(authorization: Optional[str], path: str) -> str:
    if not authorization:
        logger.warning("[AUTH] request_id=%s missing Authorization header endpoint=%s", request_id(), path)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Please sign in again.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    if not authorization.lower().startswith("bearer "):
        logger.warning("[AUTH] request_id=%s malformed Authorization header endpoint=%s", request_id(), path)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Please sign in again.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    token = authorization[7:].strip()
    if not token:
        logger.warning("[AUTH] request_id=%s missing bearer token endpoint=%s", request_id(), path)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Please sign in again.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return token


async def get_current_user(
    request: Request,
    authorization: Optional[str] = Header(default=None),
) -> AuthUser:
    """FastAPI dependency: returns the authenticated Supabase user.

    Raises 401 if the Authorization header is missing, malformed, or rejected
    by Supabase.
    """
    path = request.url.path
    token = _extract_bearer(authorization, path)

    start_time = time.perf_counter()
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(
                _AUTH_USER_ENDPOINT,
                headers={
                    "apikey": SUPABASE_ANON_KEY,
                    "Authorization": f"Bearer {token}",
                },
            )
        auth_ms = int((time.perf_counter() - start_time) * 1000)
        logger.info("[AUTH TIMING] request_id=%s endpoint=%s auth_ms=%s", request_id(), path, auth_ms)
    except httpx.HTTPError as error:
        error_type = type(error).__name__
        logger.error("[AUTH ERROR] request_id=%s endpoint=%s error_type=%s", request_id(), path, error_type)
        if path == "/api/me/platform-access":
            logger.error("[ACCESS ERROR] request_id=%s endpoint=/api/me/platform-access error_type=%s", request_id(), error_type)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Authentication service is temporarily unavailable. Please try again.",
        ) from error

    if response.status_code != 200:
        logger.warning(
            "[AUTH] request_id=%s invalid or expired token endpoint=%s supabase_status=%s",
            request_id(),
            path,
            response.status_code,
        )
        logger.error("[AUTH ERROR] request_id=%s endpoint=%s error_type=Non200Response", request_id(), path)
        if path == "/api/me/platform-access":
            logger.error("[ACCESS ERROR] request_id=%s endpoint=/api/me/platform-access error_type=Non200Response", request_id())
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Please sign in again.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    payload = response.json() or {}
    user_id = payload.get("id")
    email = payload.get("email")
    if not user_id:
        logger.error("[AUTH ERROR] request_id=%s endpoint=%s error_type=MissingUserId", request_id(), path)
        if path == "/api/me/platform-access":
            logger.error("[ACCESS ERROR] request_id=%s endpoint=/api/me/platform-access error_type=MissingUserId", request_id())
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Please sign in again.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    app_metadata = payload.get("app_metadata")
    # Account controls are optional until the additive Admin HQ migration is
    # installed. Once present, a suspended/restricted customer is denied at
    # the shared authentication boundary, so no customer endpoint can bypass
    # the administrative decision.
    try:
        from app.services import supabase_service
        control = (
            supabase_service.admin_client()
            .table("user_account_controls")
            .select("status")
            .eq("user_id", str(user_id))
            .limit(1)
            .execute()
        )
        control_rows = list(control.data or [])
        account_status = str(control_rows[0].get("status") or "active") if control_rows else "active"
        if account_status in {"suspended", "restricted"}:
            logger.warning("[AUTH] request_id=%s blocked account user=%s status=%s", request_id(), str(user_id)[:8], account_status)
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="This account is currently restricted.")
    except HTTPException:
        raise
    except Exception:
        # Preserve customer availability before the additive migration exists.
        pass
    # Supabase has already authenticated the bearer token above. Decode only
    # the non-secret assurance/session claims after that verification succeeds;
    # never use an unverified claim to establish the user identity.
    try:
        encoded_payload = token.split(".", 2)[1]
        encoded_payload += "=" * (-len(encoded_payload) % 4)
        claims = json.loads(base64.urlsafe_b64decode(encoded_payload).decode("utf-8"))
        if not isinstance(claims, dict):
            claims = {}
    except (IndexError, ValueError, TypeError, json.JSONDecodeError):
        claims = {}
    return AuthUser(
        id=str(user_id),
        email=email,
        access_token=token,
        app_metadata=app_metadata if isinstance(app_metadata, dict) else {},
        auth_level=str(claims.get("aal") or "aal1"),
        session_id=str(claims.get("session_id") or "") or None,
    )


async def require_admin(
    user: AuthUser = Depends(get_current_user),
) -> AuthUser:
    """Require a server-verified admin role from Supabase app_metadata.

    Supabase users cannot edit app_metadata themselves; only trusted server
    operations can assign it. Frontend flags and user_metadata are ignored.
    """
    metadata = user.app_metadata or {}
    if metadata.get("role") != "admin":
        logger.warning(
            "[AUTH] request_id=%s admin access denied user=%s",
            request_id(),
            str(user.id)[:8],
        )
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required.")
    return user


# Convenience alias for routes.
CurrentUser = Depends(get_current_user)
