"""Small rate limiting layer for expensive API paths.

The active backend is in-memory because Redis is not a current dependency.
The public functions keep Redis integration contained to this module later.
"""
from __future__ import annotations

from collections import defaultdict, deque
from dataclasses import dataclass
import hashlib
import logging
import threading
import time
from typing import Optional

from fastapi import HTTPException, Request

from app.core import config

logger = logging.getLogger("podpilot.rate_limit")

RATE_LIMIT_DETAIL = "Too many requests. Please try again in a moment."


@dataclass(frozen=True)
class RateLimit:
    scope: str
    limit: int
    window_seconds: int = 60


class InMemoryRateLimiter:
    """Sliding-window limiter for one process.

    This is safe for local/dev and single-instance deployments. Multi-instance
    production should swap this store for Redis using the same public helpers.
    """

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._hits: dict[str, deque[float]] = defaultdict(deque)

    def allow(self, key: str, *, limit: int, window_seconds: int) -> bool:
        if limit <= 0 or window_seconds <= 0:
            return True

        now = time.time()
        oldest_allowed = now - window_seconds
        with self._lock:
            hits = self._hits[key]
            while hits and hits[0] <= oldest_allowed:
                hits.popleft()
            if len(hits) >= limit:
                return False
            hits.append(now)
            return True


_memory_limiter = InMemoryRateLimiter()
_warned_memory_backend = False


def _rate_limits_enabled() -> bool:
    return config.RATE_LIMIT_ENABLED


def _backend_name() -> str:
    return (config.RATE_LIMIT_BACKEND or "memory").lower().strip()


def _redis_configured() -> bool:
    return bool((config.REDIS_URL or "").strip())


def _warn_if_memory_backend() -> None:
    global _warned_memory_backend
    if _warned_memory_backend:
        return
    _warned_memory_backend = True
    if _backend_name() != "memory" or _redis_configured():
        logger.warning(
            "Redis rate limiting is configured but not installed; using in-memory limits."
        )
    else:
        logger.info("Using in-memory rate limiting backend.")


def _hit(key: str, rate_limit: RateLimit) -> None:
    if not _rate_limits_enabled():
        return

    _warn_if_memory_backend()
    allowed = _memory_limiter.allow(
        key,
        limit=rate_limit.limit,
        window_seconds=rate_limit.window_seconds,
    )
    if not allowed:
        key_hash = hashlib.sha256(key.encode("utf-8")).hexdigest()[:12]
        logger.warning(
            "rate_limit_exceeded scope=%s limit=%s window_seconds=%s key_hash=%s",
            rate_limit.scope,
            rate_limit.limit,
            rate_limit.window_seconds,
            key_hash,
        )
        raise HTTPException(status_code=429, detail=RATE_LIMIT_DETAIL)


def client_ip(request: Request) -> str:
    headers = request.headers
    for header_name in (
        "cf-connecting-ip",
        "true-client-ip",
        "x-forwarded-for",
        "x-real-ip",
    ):
        raw = headers.get(header_name)
        if raw:
            value = raw.split(",", 1)[0].strip()
            if value:
                return value
    if request.client and request.client.host:
        return request.client.host
    return "unknown"


def enforce_user_limit(user_id: str, rate_limit: RateLimit) -> None:
    identifier = str(user_id or "anonymous").strip() or "anonymous"
    _hit(f"user:{identifier}:{rate_limit.scope}", rate_limit)


def enforce_ip_limit(request: Request, rate_limit: RateLimit) -> None:
    _hit(f"ip:{client_ip(request)}:{rate_limit.scope}", rate_limit)


AI_GENERATE = RateLimit("ai_generate", 10)
TRADEMARK_CHECK = RateLimit("trademark_check", 20)
IMAGE_UPLOAD = RateLimit("image_upload", 30)
EXCEL_IMPORT = RateLimit("excel_import", 10)
PUBLIC_AUTH = RateLimit("public_auth", 5)
CHECKOUT = RateLimit("checkout", 20)
TRIAL = RateLimit("trial", 10)
EXPENSIVE_LIST = RateLimit("expensive_list", 60)
BILLING_READ = RateLimit("billing_read", 60)
