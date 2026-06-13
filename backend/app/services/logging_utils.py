"""Helpers for production-safe application logs."""
from __future__ import annotations

import hashlib
from contextvars import ContextVar
from pathlib import Path
from typing import Any


_request_id_var: ContextVar[str] = ContextVar("podpilot_request_id", default="-")


def set_request_id(request_id: str):
    return _request_id_var.set(str(request_id or "-"))


def reset_request_id(token) -> None:
    _request_id_var.reset(token)


def request_id() -> str:
    return _request_id_var.get()


def short_user_id(user_id: Any) -> str:
    value = str(user_id or "").strip()
    if not value:
        return "unknown"
    digest = hashlib.sha256(value.encode("utf-8")).hexdigest()
    return digest[:12]


def short_id(value: Any) -> str:
    text = str(value or "").strip()
    if not text:
        return "unknown"
    if len(text) <= 12:
        return text
    return f"{text[:8]}...{text[-4:]}"


def safe_r2_key(key: Any) -> str:
    text = str(key or "").strip()
    if not text:
        return "(none)"
    parts = [part for part in text.split("/") if part]
    filename = Path(parts[-1]).name if parts else "(unknown)"
    category = "object"
    if "imports" in parts:
        category = "import"
    elif "previews" in parts:
        category = "preview"
    elif "thumbnails" in parts:
        category = "thumbnail"
    elif len(parts) >= 4 and parts[0] == "users":
        category = "design"
    return f"{category}:{filename}"


def error_type(error: BaseException | type[BaseException] | Any) -> str:
    if isinstance(error, type):
        return error.__name__
    return type(error).__name__


def safe_status(value: Any) -> str:
    return str(value or "unknown").strip().lower()[:40] or "unknown"
