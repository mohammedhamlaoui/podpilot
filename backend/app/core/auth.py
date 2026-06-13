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
from typing import Optional

import httpx
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

    return AuthUser(id=str(user_id), email=email, access_token=token)


# Convenience alias for routes.
CurrentUser = Depends(get_current_user)
