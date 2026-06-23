"""Public HTTP API.

Every endpoint that touches user data declares
`user: AuthUser = Depends(get_current_user)` and scopes its queries by
`user.id`. The verified `user_id` is the only identity ever trusted Ã¢â‚¬â€
client-supplied user_ids are ignored.

Files (Excel sheets, design images) live in Cloudflare R2. Normal dashboard
image views go through authenticated API proxy URLs; upload automation can
still request short-lived signed URLs when it needs direct browser access.
"""
from __future__ import annotations

import hmac
import hashlib
import json
import logging
import mimetypes
import threading
from contextlib import contextmanager
import httpx
from pathlib import Path
from typing import Any, Optional

logger = logging.getLogger("podpilot.routes")

from fastapi import APIRouter, Depends, File, Form, Header, HTTPException, Query, UploadFile, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from app.core.auth import AuthUser, get_current_user
from app.core.config import (
    SUPPORTED_MARKETPLACES,
    EMAIL_BLOCK_DISPOSABLE,
    EMAIL_VERIFICATION_PROVIDER,
    EMAIL_VERIFICATION_API_KEY,
    EMAIL_REQUIRE_MX_CHECK,
)
from app.schemas.job import (
    DesignCreateIn,
    DesignStatusUpdateIn,
    DesignUpdateIn,
    DesignsImportConfirmIn,
    UploadJobCreateIn,
    UploadJobUpdateIn,
    UploadLogIn,
    design_to_response,
)
from app.services import device_session_service, rate_limiter, r2_service, supabase_service, subscription_service
from app.services.ai_copyright_service import (
    AICopyrightImageTooLarge,
    AICopyrightRiskError,
    MAX_INLINE_IMAGE_BASE64_CHARS,
    check_copyright_risk,
)
from app.services.ai_listing_service import AIListingError, generate_listing_content
from app.services.excel_parser import ExcelParserError, parse_excel_designs
from app.services.logging_utils import error_type as safe_error_type, safe_r2_key, short_id, short_user_id


router = APIRouter()

MAX_IMAGE_UPLOAD_BYTES = 25 * 1024 * 1024
MAX_EXCEL_UPLOAD_BYTES = 15 * 1024 * 1024
MAX_BATCH_UPLOAD_BYTES = 200 * 1024 * 1024
UPLOAD_READ_CHUNK_BYTES = 1024 * 1024
UPLOAD_SESSION_SIGNED_URL_TTL_SECONDS = 60 * 60
FILE_PROXY_CACHE_CONTROL = "private, max-age=300"
FILE_PROXY_CHUNK_BYTES = 1024 * 1024

ALLOWED_IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp"}
ALLOWED_IMAGE_CONTENT_TYPES = {"image/png", "image/jpeg", "image/webp"}
IMAGE_CONTENT_TYPE_BY_EXTENSION = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
}


class AIListingContentIn(BaseModel):
    design_id: str = Field(min_length=1)
    platform: str = "redbubble"
    current_metadata: dict[str, Any] = Field(default_factory=dict)


class DesignBatchDeleteIn(BaseModel):
    design_ids: list[str] = Field(default_factory=list)


class UploadSessionCreateIn(BaseModel):
    design_ids: list[str] = Field(default_factory=list)


class UploadSessionItemStatusIn(BaseModel):
    status: str = Field(pattern="^(queued|preparing|ready|uploading|uploaded|failed|skipped)$")
    error_message: Optional[str] = Field(default=None, max_length=4000)


class AICopyrightCheckIn(BaseModel):
    platform: str = "redbubble"
    design_id: Optional[str] = None
    title: str = Field(default="", max_length=500)
    description: str = Field(default="", max_length=4000)
    main_tag: str = Field(default="", max_length=500)
    primary_tag: str = Field(default="", max_length=500)
    supporting_tags: list[str] | str = Field(default_factory=list)
    detected_trademark_terms: list[str] | str = Field(default_factory=list)
    image_url: Optional[str] = None
    image_r2_key: Optional[str] = None
    image_base64: Optional[str] = Field(
        default=None,
        max_length=MAX_INLINE_IMAGE_BASE64_CHARS + 128,
    )


class DeviceRegisterIn(BaseModel):
    device_id: str = Field(min_length=1, max_length=128)
    device_label: Optional[str] = Field(default=None, max_length=200)


# Ã¢â€â‚¬Ã¢â€â‚¬ Helpers Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

def _validate_marketplace(marketplace: str) -> str:
    if marketplace not in SUPPORTED_MARKETPLACES:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported marketplace '{marketplace}'. "
                   f"Use one of: {sorted(SUPPORTED_MARKETPLACES)}.",
        )
    return marketplace


def _require_marketplace_access(user_id: str, marketplace: str) -> None:
    subscription_service.require_platform_access(user_id, marketplace)


def _require_active_subscription(user_id: str) -> None:
    access = subscription_service.get_subscription_access(user_id)
    if not access.get("can_upload"):
        raise HTTPException(
            status_code=403,
            detail=subscription_service.SUBSCRIPTION_REQUIRED_DETAIL,
        )


def _require_trademark_access(user_id: str) -> None:
    rate_limiter.enforce_user_limit(user_id, rate_limiter.TRADEMARK_CHECK)
    _require_active_subscription(user_id)


_AI_GENERATION_LOCK = threading.Lock()
_ACTIVE_AI_GENERATION_USERS: set[str] = set()


@contextmanager
def _ai_generation_slot(user_id: str):
    """Allow at most one active provider-backed AI generation per user."""
    key = str(user_id or "").strip()
    with _AI_GENERATION_LOCK:
        if key in _ACTIVE_AI_GENERATION_USERS:
            logger.info(
                "ai_generation_rejected_concurrent user=%s",
                short_user_id(user_id),
            )
            raise HTTPException(
                status_code=429,
                detail="An AI generation is already running for this account. Please wait for it to finish.",
            )
        _ACTIVE_AI_GENERATION_USERS.add(key)
    try:
        yield
    finally:
        with _AI_GENERATION_LOCK:
            _ACTIVE_AI_GENERATION_USERS.discard(key)


def _reserve_ai_token(user_id: str) -> dict[str, Any]:
    return subscription_service.reserve_ai_token(user_id)


def _refund_ai_token(user_id: str, reservation: dict[str, Any], *, reason: str) -> None:
    try:
        subscription_service.refund_ai_token_reservation(user_id, reservation)
    except Exception as refund_error:
        logger.error(
            "ai_token_refund_failed user=%s reason=%s error_type=%s",
            short_user_id(user_id),
            reason,
            safe_error_type(refund_error),
        )


def _allowed_marketplaces_for_user(user_id: str) -> list[str]:
    access = subscription_service.get_user_platform_access(user_id)
    return [
        marketplace
        for marketplace in sorted(SUPPORTED_MARKETPLACES)
        if bool(access.get(marketplace))
    ]


def _safe_name(filename: str) -> str:
    return Path(filename or "upload").name.replace("/", "_").replace("\\", "_") or "upload"


def _safe_r2_key_for_log(key: Any) -> str:
    if not key:
        return "r2_key=(none)"
    key_text = str(key)
    basename = Path(key_text).name or "(object)"
    digest = hashlib.sha256(key_text.encode("utf-8")).hexdigest()[:10]
    return f"r2_key={basename} r2_key_hash={digest}"


def _safe_error_type(error: Exception) -> str:
    return type(error).__name__


def _megabytes(size: int) -> int:
    return size // (1024 * 1024)


def _normalized_content_type(file: UploadFile) -> str:
    return (file.content_type or "").split(";", 1)[0].strip().lower()


async def _read_upload_limited(file: UploadFile, *, max_bytes: int, label: str) -> bytes:
    chunks: list[bytes] = []
    total = 0
    while True:
        chunk = await file.read(UPLOAD_READ_CHUNK_BYTES)
        if not chunk:
            break
        total += len(chunk)
        if total > max_bytes:
            raise HTTPException(
                status_code=400,
                detail=f"{label} exceeds {_megabytes(max_bytes)}MB limit.",
            )
        chunks.append(chunk)
    return b"".join(chunks)


async def _read_validated_excel_upload(file: UploadFile) -> bytes:
    if Path(file.filename or "").suffix.lower() != ".xlsx":
        raise HTTPException(status_code=400, detail="Upload a .xlsx Excel file.")
    contents = await _read_upload_limited(
        file,
        max_bytes=MAX_EXCEL_UPLOAD_BYTES,
        label="Excel file",
    )
    if not contents:
        raise HTTPException(status_code=400, detail="Excel file is empty.")
    if not contents.startswith(b"PK"):
        raise HTTPException(status_code=400, detail="Invalid .xlsx Excel file.")
    return contents


async def _read_validated_image_upload(file: UploadFile) -> tuple[bytes, str]:
    extension = Path(file.filename or "").suffix.lower()
    allowed_extensions = {".png", ".jpg", ".jpeg"}
    if extension not in allowed_extensions:
        raise HTTPException(
            status_code=400,
            detail="Unsupported file type. Please upload PNG or JPEG designs only.",
        )

    content_type = _normalized_content_type(file)
    allowed_content_types = {"image/png", "image/jpeg"}
    if content_type and content_type not in allowed_content_types:
        raise HTTPException(
            status_code=400,
            detail="Unsupported file type. Please upload PNG or JPEG designs only.",
        )

    contents = await _read_upload_limited(
        file,
        max_bytes=MAX_IMAGE_UPLOAD_BYTES,
        label="Image file",
    )
    if not contents:
        raise HTTPException(status_code=400, detail="Image file is empty.")

    try:
        width, height, image_format = r2_service.validate_image_bytes(contents)
    except r2_service.ImageValidationError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error

    if image_format not in {"PNG", "JPEG"}:
        raise HTTPException(
            status_code=400,
            detail="Unsupported file type. Please upload PNG or JPEG designs only.",
        )

    return contents, content_type or IMAGE_CONTENT_TYPE_BY_EXTENSION[extension]


def _add_to_batch_total(total_bytes: int, added_bytes: int) -> int:
    next_total = total_bytes + added_bytes
    if next_total > MAX_BATCH_UPLOAD_BYTES:
        raise HTTPException(
            status_code=400,
            detail=f"Batch upload exceeds {_megabytes(MAX_BATCH_UPLOAD_BYTES)}MB limit.",
        )
    return next_total


def _verify_cleanup_secret(
    *,
    configured_secret: str,
    provided_secret: Optional[str],
    log_prefix: str,
) -> None:
    if not configured_secret:
        logger.error("%s ADMIN_CLEANUP_SECRET is not configured on the server.", log_prefix)
        raise HTTPException(
            status_code=500,
            detail="ADMIN_CLEANUP_SECRET is not configured on the server."
        )

    if not provided_secret or not hmac.compare_digest(
        str(provided_secret),
        str(configured_secret),
    ):
        logger.warning("%s Access forbidden: invalid or missing X-Cleanup-Secret.", log_prefix)
        raise HTTPException(
            status_code=403,
            detail="Invalid or missing cleanup secret."
        )

    logger.info("%s cleanup secret accepted", log_prefix)


def _require_live_cleanup_confirmation(
    *,
    dry_run: bool,
    confirm: bool,
    log_prefix: str,
) -> None:
    if not dry_run and not confirm:
        logger.warning("%s live cleanup rejected: confirm=true missing", log_prefix)
        raise HTTPException(status_code=400, detail="Live cleanup requires confirm=true")


def _design_file_proxy_url(row: dict[str, Any], kind: str) -> str:
    design_id = str(row.get("id") or "").strip()
    if not design_id:
        return ""
    return f"/api/designs/{design_id}/{kind}"


def _design_with_file_urls(row: dict) -> dict:
    image_key = row.get("image_r2_key")
    thumbnail_key = row.get("thumbnail_r2_key")

    response = design_to_response(
        row,
        image_url=_design_file_proxy_url(row, "image") if image_key else None,
        thumbnail_url=_design_file_proxy_url(row, "thumbnail") if thumbnail_key else None,
    )
    marketplace = row.get("marketplace") or "redbubble"
    response["upload_ready"] = _is_upload_ready(row, marketplace)
    response["mime_type"] = _guess_design_mime_type(row)
    for key_name in ("image_r2_key", "thumbnail_r2_key", "excel_r2_key", "ai_preview_r2_key", "image_key"):
        response.pop(key_name, None)
    return response


def _r2_body_iterator(body: Any):
    try:
        while True:
            chunk = body.read(FILE_PROXY_CHUNK_BYTES)
            if not chunk:
                break
            yield chunk
    finally:
        close = getattr(body, "close", None)
        if callable(close):
            close()


def _stream_design_file(design_id: str, user: AuthUser, *, kind: str) -> StreamingResponse:
    design = supabase_service.get_design_for_user(design_id, user.id)
    if design is None:
        raise HTTPException(status_code=404, detail="Design not found.")
    _require_marketplace_access(user.id, design.get("marketplace") or "redbubble")

    column = "thumbnail_r2_key" if kind == "thumbnail" else "image_r2_key"
    key = str(design.get(column) or "").strip()
    if not key:
        raise HTTPException(status_code=404, detail="File not found.")

    try:
        obj = r2_service.get_object_stream(key)
    except r2_service.R2NotFound as error:
        raise HTTPException(status_code=404, detail="File not found.") from error
    except r2_service.R2Error as error:
        logger.warning(
            "design_file_proxy_failed user=%s design_id=%s kind=%s key=%s error_type=%s",
            short_user_id(user.id),
            short_id(design_id),
            kind,
            safe_r2_key(key),
            safe_error_type(error),
        )
        raise HTTPException(status_code=502, detail="Could not load file.") from error

    headers = {"Cache-Control": FILE_PROXY_CACHE_CONTROL}
    content_length = obj.get("content_length")
    if content_length is not None:
        headers["Content-Length"] = str(content_length)

    return StreamingResponse(
        _r2_body_iterator(obj["body"]),
        media_type=obj.get("content_type") or _guess_design_mime_type(design),
        headers=headers,
    )


def _guess_design_mime_type(row: dict[str, Any]) -> str:
    filename = str(row.get("filename") or row.get("image_r2_key") or "")
    guessed, _ = mimetypes.guess_type(filename)
    if guessed in ALLOWED_IMAGE_CONTENT_TYPES:
        return guessed
    key_guess, _ = mimetypes.guess_type(str(row.get("image_r2_key") or ""))
    if key_guess in ALLOWED_IMAGE_CONTENT_TYPES:
        return key_guess
    return "image/png"


def _normalize_design_filename(row: dict[str, Any]) -> str:
    filename = _safe_name(str(row.get("filename") or "design.png")).strip()
    if Path(filename).suffix.lower() in ALLOWED_IMAGE_EXTENSIONS:
        return filename
    image_key_name = Path(str(row.get("image_r2_key") or "")).name
    if image_key_name and Path(image_key_name).suffix.lower() in ALLOWED_IMAGE_EXTENSIONS:
        return _safe_name(image_key_name)
    return f"{Path(filename).stem or 'design'}.png"


def _is_upload_ready(row: dict[str, Any], marketplace: str) -> bool:
    if not row.get("image_r2_key") or not row.get("thumbnail_r2_key"):
        return False
    if not _normalize_design_filename(row):
        return False
    if not str(row.get("title") or "").strip():
        return False
    if not str(row.get("description") or "").strip():
        return False
    if not str(row.get("primary_tag") or "").strip():
        return False
    if marketplace == "redbubble" and not str(row.get("copy_link") or "").strip():
        return False
    return True


def _design_to_upload_queue_item(row: dict[str, Any], marketplace: str) -> dict[str, Any]:
    image_key = str(row.get("image_r2_key") or "").strip()
    thumbnail_key = str(row.get("thumbnail_r2_key") or "").strip()
    image_url = ""
    thumbnail_url = ""
    if image_key:
        image_url = r2_service.signed_get_url(
            image_key,
            ttl_seconds=UPLOAD_SESSION_SIGNED_URL_TTL_SECONDS,
        )
    if thumbnail_key:
        thumbnail_url = r2_service.signed_get_url(
            thumbnail_key,
            ttl_seconds=UPLOAD_SESSION_SIGNED_URL_TTL_SECONDS,
        )

    primary_tag = str(row.get("primary_tag") or "").strip()
    supporting_tags = row.get("supporting_tags") or []
    if isinstance(supporting_tags, list):
        supporting_tags_out = ", ".join(str(tag) for tag in supporting_tags if tag)
    else:
        supporting_tags_out = str(supporting_tags or "")

    upload_ready = _is_upload_ready(row, marketplace)
    filename = _normalize_design_filename(row)
    return {
        "design_id": str(row.get("id") or ""),
        "id": str(row.get("id") or ""),
        "title": str(row.get("title") or "").strip(),
        "description": str(row.get("description") or "").strip(),
        "main_tag": primary_tag,
        "primary_tag": primary_tag,
        "supporting_tags": supporting_tags_out,
        "filename": filename,
        "mime_type": _guess_design_mime_type({**row, "filename": filename}),
        "image_key": image_key,
        "image_r2_key": image_key,
        "image_path": image_key,
        "image_url": image_url,
        "upload_url": image_url,
        "thumbnail_url": thumbnail_url,
        "thumbnail_r2_key": thumbnail_key or None,
        "copy_link": str(row.get("copy_link") or "").strip(),
        "adult_content": bool(row.get("adult_content")),
        "color_settings": row.get("color_settings") or {},
        "product_settings": row.get("product_settings") or {},
        "marketplace": marketplace,
        "upload_ready": upload_ready,
        "status": "ready" if upload_ready else "preparing",
        "updated_at": row.get("updated_at"),
    }


def _prepared_queue_for_user(
    *,
    user_id: str,
    marketplace: str,
    design_ids: Optional[list[str]] = None,
) -> list[dict[str, Any]]:
    if design_ids:
        rows = []
        for design_id in design_ids:
            row = supabase_service.get_design_for_user(str(design_id), user_id)
            if row is None:
                raise HTTPException(status_code=404, detail=f"Design not found: {design_id}")
            if (row.get("marketplace") or "redbubble") != marketplace:
                raise HTTPException(status_code=400, detail="Design does not belong to this platform.")
            rows.append(row)
    else:
        rows = supabase_service.list_designs_for_user(
            user_id,
            marketplace=marketplace,
            statuses=("pending", "uploading"),
        )
    return [_design_to_upload_queue_item(row, marketplace) for row in rows]


# Ã¢â€â‚¬Ã¢â€â‚¬ Health Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

@router.get("/")
def health_check() -> dict:
    return {"status": "ok", "service": "PodPilot API"}


@router.get("/healthz")
def healthz() -> dict:
    return {"ok": True, "service": "PodPilot API"}


@router.get("/healthz/schema")
def schema_health() -> dict:
    """Report whether optional Supabase columns are present.

    Used by the frontend (and operators) to detect when the
    color_settings / product_settings migration hasn't been applied.
    Saves involving those columns will fail with a 500 until it is.
    """
    present = supabase_service._probe_optional_columns()
    return {
        "designs.color_settings": present,
        "designs.product_settings": present,
        "ok": present,
        "migration_file": "docs/migration_color_product_settings.sql",
    }


@router.get("/me")
def whoami(user: AuthUser = Depends(get_current_user)) -> dict:
    """Echo the authenticated user. The Chrome extension calls this to
    verify a stored access token without revealing any other data.
    """
    return {"user_id": user.id, "email": user.email}


@router.get("/api/device/status")
def get_device_status(
    request: Request,
    user: AuthUser = Depends(get_current_user),
    x_podpilot_device_id: Optional[str] = Header(default=None, alias="X-PodPilot-Device-Id"),
) -> dict:
    return device_session_service.get_device_status(user.id, x_podpilot_device_id)


@router.post("/api/device/register")
def register_device(
    payload: DeviceRegisterIn,
    request: Request,
    user: AuthUser = Depends(get_current_user),
) -> dict:
    return device_session_service.register_device(
        user.id,
        payload.device_id,
        device_label=payload.device_label,
        user_agent=request.headers.get("user-agent"),
    )


@router.post("/api/device/switch")
def switch_device(
    payload: DeviceRegisterIn,
    request: Request,
    user: AuthUser = Depends(get_current_user),
) -> dict:
    return device_session_service.switch_device(
        user.id,
        payload.device_id,
        device_label=payload.device_label,
        user_agent=request.headers.get("user-agent"),
    )


@router.post("/api/device/heartbeat")
def heartbeat_device(
    payload: DeviceRegisterIn,
    user: AuthUser = Depends(get_current_user),
) -> dict:
    return device_session_service.heartbeat_device(user.id, payload.device_id)


@router.post("/api/device/logout")
def logout_device(
    payload: DeviceRegisterIn,
    user: AuthUser = Depends(get_current_user),
) -> dict:
    return device_session_service.revoke_device(user.id, payload.device_id)


# Ã¢â€â‚¬Ã¢â€â‚¬ Excel preview + confirm Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

@router.post("/designs/import/preview")
async def preview_excel_import(
    file: UploadFile = File(...),
    marketplace: str = Form("redbubble"),
    user: AuthUser = Depends(get_current_user),
) -> dict:
    """Parse an .xlsx, store it in R2, and return parsed rows for review.

    Nothing is written to the `designs` table yet Ã¢â‚¬â€ that happens via
    /designs/import/confirm once the user clicks "Import" in the UI.
    """
    rate_limiter.enforce_user_limit(user.id, rate_limiter.EXCEL_IMPORT)
    marketplace = _validate_marketplace(marketplace)
    _require_marketplace_access(user.id, marketplace)
    logger.info(
        "excel_import_preview_started user=%s marketplace=%s filename=%s",
        short_user_id(user.id),
        marketplace,
        _safe_name(file.filename or "sheet.xlsx"),
    )
    contents = await _read_validated_excel_upload(file)
    try:
        parsed = parse_excel_designs(contents)
    except ExcelParserError as error:
        logger.warning(
            "excel_import_preview_failed user=%s marketplace=%s error_type=%s",
            short_user_id(user.id),
            marketplace,
            safe_error_type(error),
        )
        raise HTTPException(status_code=400, detail=str(error)) from error

    import_id = r2_service.new_import_id()
    excel_key = r2_service.import_excel_key(user.id, import_id, file.filename or "sheet.xlsx")
    try:
        r2_service.upload_bytes(
            excel_key,
            contents,
            content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        )
    except r2_service.R2Error as error:
        logger.warning(
            "excel_import_preview_failed user=%s marketplace=%s error_type=%s",
            short_user_id(user.id),
            marketplace,
            safe_error_type(error),
        )
        raise HTTPException(status_code=502, detail="R2 upload failed.") from error

    upload_job = supabase_service.insert_upload_job(
        user_id=user.id,
        marketplace=marketplace,
        total_designs=len(parsed),
        status="pending",
    )
    job_id = upload_job.get("id")
    logger.info(
        "excel_import_preview_succeeded user=%s marketplace=%s rows=%d job_id=%s excel_key=%s",
        short_user_id(user.id),
        marketplace,
        len(parsed),
        short_id(job_id),
        safe_r2_key(excel_key),
    )

    return {
        "marketplace": marketplace,
        "excel_r2_key": excel_key,
        "import_id": import_id,
        "upload_job_id": str(job_id) if job_id else None,
        "count": len(parsed),
        "designs": [
            {
                "filename": row["filename"],
                "title": row["title"],
                "description": row["description"],
                "primary_tag": row.get("main_tag", ""),
                "main_tag": row.get("main_tag", ""),
                "supporting_tags": row["supporting_tags"],
                "copy_link": row["copy_link"],
                "source_row": row["source_row"],
                "status": "pending",
            }
            for row in parsed
        ],
    }


@router.post("/designs/import/confirm")
def confirm_excel_import(
    payload: DesignsImportConfirmIn,
    user: AuthUser = Depends(get_current_user),
) -> dict:
    rate_limiter.enforce_user_limit(user.id, rate_limiter.EXCEL_IMPORT)
    payload.marketplace = _validate_marketplace(payload.marketplace)
    _require_marketplace_access(user.id, payload.marketplace)
    logger.info(
        "excel_import_confirm_started user=%s marketplace=%s designs=%d job_id=%s",
        short_user_id(user.id),
        payload.marketplace,
        len(payload.designs or []),
        short_id(payload.upload_job_id),
    )
    if not payload.designs:
        raise HTTPException(status_code=400, detail="Confirm at least one design.")

    rows = []
    for design in payload.designs:
        row = design.to_db_row(user_id=user.id)
        row["marketplace"] = payload.marketplace
        if payload.excel_r2_key:
            row["excel_r2_key"] = payload.excel_r2_key
        rows.append(row)

    inserted = supabase_service.insert_designs(rows)

    if payload.upload_job_id:
        supabase_service.update_upload_job(
            payload.upload_job_id,
            user.id,
            {"total_designs": len(inserted)},
        )

    logger.info(
        "excel_import_confirm_succeeded user=%s marketplace=%s inserted=%d job_id=%s",
        short_user_id(user.id),
        payload.marketplace,
        len(inserted),
        short_id(payload.upload_job_id),
    )
    return {
        "count": len(inserted),
        "marketplace": payload.marketplace,
        "designs": [_design_with_file_urls(row) for row in inserted],
    }


# Ã¢â€â‚¬Ã¢â€â‚¬ Combined Excel + images upload (matches the frontend Import page) Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

@router.post("/designs/import")
async def import_excel_with_images(
    file: UploadFile = File(...),
    images: list[UploadFile] = File(default=[]),
    marketplace: str = Form("redbubble"),
    user: AuthUser = Depends(get_current_user),
) -> dict:
    """One-shot import: upload xlsx + images, persist designs, link images
    by filename. Returns the created designs with signed image URLs.

    The frontend Import page uses this so the user only has to click
    "Import" once.
    """
    rate_limiter.enforce_user_limit(user.id, rate_limiter.EXCEL_IMPORT)
    marketplace = _validate_marketplace(marketplace)
    _require_marketplace_access(user.id, marketplace)
    logger.info(
        "excel_image_import_started user=%s marketplace=%s image_count=%d filename=%s",
        short_user_id(user.id),
        marketplace,
        len(images or []),
        _safe_name(file.filename or "sheet.xlsx"),
    )
    contents = await _read_validated_excel_upload(file)
    try:
        parsed = parse_excel_designs(contents)
    except ExcelParserError as error:
        logger.warning(
            "excel_image_import_failed user=%s marketplace=%s error_type=%s",
            short_user_id(user.id),
            marketplace,
            safe_error_type(error),
        )
        raise HTTPException(status_code=400, detail=str(error)) from error
    batch_total = _add_to_batch_total(0, len(contents))

    # Excel Ã¢â€ â€™ R2
    import_id = r2_service.new_import_id()
    excel_key = r2_service.import_excel_key(user.id, import_id, file.filename or "sheet.xlsx")
    try:
        r2_service.upload_bytes(
            excel_key,
            contents,
            content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        )
    except r2_service.R2Error as error:
        raise HTTPException(status_code=502, detail="R2 upload failed.") from error

    # Build a {lowercase_filename: bytes/extension} map of the uploaded images.
    image_blobs: dict[str, tuple[bytes, str, str]] = {}
    for image in images or []:
        ext = Path(image.filename or "").suffix.lower()
        blob, content_type = await _read_validated_image_upload(image)
        batch_total = _add_to_batch_total(batch_total, len(blob))
        key_name = (image.filename or "").strip().lower()
        image_blobs[key_name] = (blob, ext, content_type)

    # Build design rows, uploading each image to R2 under the design's
    # eventual id slot.
    pending_uploads: list[tuple[str, bytes, str]] = []
    rows: list[dict] = []
    for raw in parsed:
        # Pre-allocate a stable design id slot so the R2 key matches the
        # row we'll insert (Supabase will generate the actual UUID, but
        # the slot id keeps each design's images namespaced uniquely).
        slot_id = r2_service.new_design_id()
        row = {
            "user_id": user.id,
            "marketplace": marketplace,
            "filename": raw["filename"],
            "title": raw["title"],
            "description": raw["description"],
            "primary_tag": raw.get("main_tag", ""),
            "supporting_tags": raw["supporting_tags"],
            "copy_link": raw.get("copy_link", ""),
            "excel_r2_key": excel_key,
            "status": "pending",
        }
        if "adult_content" in raw:
            row["adult_content"] = bool(raw["adult_content"])

        # Match an uploaded image by filename (case-insensitive). If the
        # exact filename isn't there, try the base name without extension.
        target = raw["filename"].strip().lower()
        match = image_blobs.get(target)
        if match is None:
            base = Path(target).stem
            for k in image_blobs:
                if Path(k).stem == base:
                    match = image_blobs[k]
                    break

        if match is not None:
            blob, ext, content_type = match
            image_key = r2_service.design_image_key(
                user_id=user.id,
                marketplace=marketplace,
                design_id=slot_id,
                filename=raw["filename"] or f"image{ext}",
            )
            pending_uploads.append((image_key, blob, content_type or "image/png"))
            row["image_r2_key"] = image_key

            # Generate and upload thumbnail
            try:
                thumbnail_key = r2_service.design_thumbnail_key(
                    user_id=user.id,
                    marketplace=marketplace,
                    design_id=slot_id,
                    filename=raw["filename"] or f"image{ext}",
                )
                thumbnail_blob = r2_service.generate_thumbnail_bytes(blob)
                pending_uploads.append((thumbnail_key, thumbnail_blob, "image/webp"))
                row["thumbnail_r2_key"] = thumbnail_key
            except Exception as thumbnail_err:
                logger.warning(
                    "thumbnail_generation_failed route=excel_image_import user=%s error_type=%s",
                    short_user_id(user.id),
                    safe_error_type(thumbnail_err),
                )

        rows.append(row)

    for key, blob, content_type in pending_uploads:
        try:
            r2_service.upload_bytes(key, blob, content_type=content_type)
        except r2_service.R2Error as error:
            logger.warning(
                "excel_image_import_failed user=%s marketplace=%s key=%s error_type=%s",
                short_user_id(user.id),
                marketplace,
                safe_r2_key(key),
                safe_error_type(error),
            )
            raise HTTPException(status_code=502, detail="R2 upload failed.") from error

    inserted = supabase_service.insert_designs(rows)
    job = supabase_service.insert_upload_job(
        user_id=user.id,
        marketplace=marketplace,
        total_designs=len(inserted),
        status="pending",
    )
    logger.info(
        "excel_image_import_succeeded user=%s marketplace=%s inserted=%d images=%d job_id=%s",
        short_user_id(user.id),
        marketplace,
        len(inserted),
        len(images or []),
        short_id(job.get("id") if job else None),
    )

    return {
        "count": len(inserted),
        "marketplace": marketplace,
        "excel_r2_key": excel_key,
        "upload_job_id": str(job.get("id")) if job and job.get("id") else None,
        "designs": [_design_with_file_urls(row) for row in inserted],
    }


# Ã¢â€â‚¬Ã¢â€â‚¬ Manual single-design create / edit Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

def _generate_thumbnail_for_design(
    user_id: str,
    design_id: str,
    marketplace: str,
    filename: str,
    image_key: str,
) -> Optional[dict[str, Any]]:
    try:
        logger.info(
            "thumbnail_generation_started route=create_design user=%s design_id=%s image_key=%s",
            short_user_id(user_id),
            short_id(design_id),
            safe_r2_key(image_key),
        )
        image_bytes = r2_service.get_object_bytes(image_key)
        thumbnail_bytes = r2_service.generate_thumbnail_bytes(image_bytes)

        new_thumb_key = r2_service.design_thumbnail_key(
            user_id=user_id,
            marketplace=marketplace,
            design_id=design_id,
            filename=filename,
        )

        r2_service.upload_bytes(
            new_thumb_key,
            thumbnail_bytes,
            content_type="image/webp",
        )

        updated = supabase_service.update_design(
            design_id,
            user_id,
            {"thumbnail_r2_key": new_thumb_key}
        )
        if updated:
            logger.info(
                "thumbnail_generation_succeeded route=create_design user=%s design_id=%s thumbnail_key=%s bytes=%d",
                short_user_id(user_id),
                short_id(design_id),
                safe_r2_key(new_thumb_key),
                len(thumbnail_bytes),
            )
            return updated
        else:
            logger.warning("thumbnail_db_update_missing design_id=%s", short_id(design_id))
    except Exception as error:
        logger.warning(
            "thumbnail_generation_failed route=create_design design_id=%s error_type=%s",
            short_id(design_id),
            safe_error_type(error),
        )
    return None


@router.post("/designs")
def create_design(
    payload: DesignCreateIn,
    user: AuthUser = Depends(get_current_user),
) -> dict:
    payload.marketplace = _validate_marketplace(payload.marketplace)
    _require_marketplace_access(user.id, payload.marketplace)
    row = payload.to_db_row(user_id=user.id)
    inserted = supabase_service.insert_designs([row])
    if not inserted:
        raise HTTPException(status_code=500, detail="Could not create design.")

    design_row = inserted[0]
    design_id = design_row.get("id")
    image_key = design_row.get("image_r2_key")
    thumbnail_key = design_row.get("thumbnail_r2_key")

    has_thumb_in_payload = "thumbnail_r2_key" in row and bool(row["thumbnail_r2_key"])
    logger.info(
        "design_create_succeeded user=%s design_id=%s marketplace=%s has_image=%s has_thumbnail=%s",
        short_user_id(user.id),
        short_id(design_id),
        design_row.get("marketplace") or payload.marketplace,
        bool(image_key),
        bool(has_thumb_in_payload or thumbnail_key),
    )

    if image_key and not thumbnail_key:
        updated = _generate_thumbnail_for_design(
            user_id=user.id,
            design_id=str(design_id),
            marketplace=design_row.get("marketplace") or "redbubble",
            filename=design_row.get("filename") or "image.png",
            image_key=image_key,
        )
        if updated:
            design_row = updated

    return _design_with_file_urls(design_row)


@router.patch("/designs/{design_id}")
def update_design_endpoint(
    design_id: str,
    payload: DesignUpdateIn,
    user: AuthUser = Depends(get_current_user),
) -> dict:
    patch = payload.to_patch()
    if not patch:
        raise HTTPException(status_code=400, detail="No fields to update.")
    existing = supabase_service.get_design_for_user(design_id, user.id)
    if existing is None:
        raise HTTPException(status_code=404, detail="Design not found.")
    _require_marketplace_access(user.id, existing.get("marketplace") or "redbubble")

    updated = supabase_service.update_design(design_id, user.id, patch)
    return _design_with_file_urls(updated or existing)


@router.post("/designs/batch-update")
def batch_update_designs(
    payload: list[dict],
    user: AuthUser = Depends(get_current_user),
) -> dict:
    """Update multiple designs at once (used by "Save All Designs").

    Each item in the list must have an `id` field plus any fields from
    DesignUpdateIn. Returns the count of successfully updated rows.
    """
    updated_count = 0
    results = []
    for item in payload:
        design_id = item.get("id")
        if not design_id:
            continue
        # Build a patch from the allowed fields.
        try:
            update_in = DesignUpdateIn(**{k: v for k, v in item.items() if k != "id"})
        except Exception:
            continue
        patch = update_in.to_patch()
        if not patch:
            continue
        existing = supabase_service.get_design_for_user(str(design_id), user.id)
        if existing is None:
            continue
        _require_marketplace_access(user.id, existing.get("marketplace") or "redbubble")
        updated = supabase_service.update_design(str(design_id), user.id, patch)
        if updated:
            updated_count += 1
            results.append(_design_with_file_urls(updated))
        else:
            results.append(_design_with_file_urls(existing))
    return {"updated": updated_count, "designs": results}


def _delete_design_for_user_result(design_id: str, user: AuthUser) -> dict[str, Any]:
    delete_logger = logging.getLogger("podpilot.delete")
    result: dict[str, Any] = {
        "design_id": design_id,
        "success": False,
        "deleted_storage": False,
        "deleted_db": False,
    }

    design = supabase_service.get_design_for_user(design_id, user.id)
    if design is None:
        result["reason"] = "Design not found."
        delete_logger.info("[Delete] failed design_id=%s reason=%s", short_id(design_id), result["reason"])
        return result

    try:
        _require_marketplace_access(user.id, design.get("marketplace") or "redbubble")
    except HTTPException as error:
        result["reason"] = str(error.detail)
        delete_logger.info("[Delete] failed design_id=%s reason=%s", short_id(design_id), result["reason"])
        return result

    deleted_r2_keys: list[str] = []
    missing_r2_keys: list[str] = []
    storage_warnings: list[str] = []

    for key_name in ("image_r2_key", "thumbnail_r2_key", "excel_r2_key", "ai_preview_r2_key"):
        key = design.get(key_name)
        if not key:
            continue
        try:
            existed = r2_service.delete_object(key)
            if existed:
                deleted_r2_keys.append(key)
            else:
                missing_r2_keys.append(key)
                delete_logger.info("[Delete] storage missing but ignored design_id=%s", short_id(design_id))
        except r2_service.R2Error as err:
            storage_warnings.append(_safe_error_type(err))
            delete_logger.warning(
                "[Delete] storage delete failed but db delete will continue design_id=%s key=%s error_type=%s",
                short_id(design_id),
                _safe_r2_key_for_log(key),
                _safe_error_type(err),
            )

    deleted_logs = 0
    try:
        logs = supabase_service.list_upload_logs_for_user(
            user.id, design_id=design_id, limit=1000
        )
        if logs:
            admin = supabase_service.admin_client()
            log_ids = [str(log["id"]) for log in logs if log.get("id")]
            if log_ids:
                admin.table("upload_logs").delete().in_("id", log_ids).execute()
                deleted_logs = len(log_ids)
    except Exception as err:
        delete_logger.warning("upload_logs cleanup failed design_id=%s error_type=%s", short_id(design_id), safe_error_type(err))

    try:
        deleted_count = supabase_service.delete_designs_for_user([design_id], user.id)
    except Exception as err:
        result["reason"] = f"Database delete failed: {_safe_error_type(err)}"
        delete_logger.info("[Delete] failed design_id=%s reason=%s", short_id(design_id), result["reason"])
        return result

    if deleted_count == 0:
        result["reason"] = "Design not found in database."
        delete_logger.info("[Delete] failed design_id=%s reason=%s", short_id(design_id), result["reason"])
        return result

    result.update({
        "success": True,
        "deleted_storage": bool(deleted_r2_keys),
        "deleted_db": True,
        "deleted_design_id": design_id,
        "deleted_r2_keys": deleted_r2_keys,
        "missing_r2_keys": missing_r2_keys,
        "deleted_logs": deleted_logs,
    })
    if storage_warnings:
        result["storage_warnings"] = storage_warnings
    delete_logger.info("[Delete] db deleted design_id=%s", short_id(design_id))
    return result


@router.post("/designs/batch-delete")
def batch_delete_designs(
    payload: DesignBatchDeleteIn,
    user: AuthUser = Depends(get_current_user),
) -> dict:
    delete_logger = logging.getLogger("podpilot.delete")
    design_ids: list[str] = []
    seen = set()
    for raw_id in payload.design_ids:
        design_id = str(raw_id or "").strip()
        if not design_id or design_id in seen:
            continue
        seen.add(design_id)
        design_ids.append(design_id)

    delete_logger.info("[Delete] start total=%d", len(design_ids))
    results = []
    for design_id in design_ids:
        try:
            result = _delete_design_for_user_result(design_id, user)
        except Exception as err:
            reason = _safe_error_type(err)
            delete_logger.info("[Delete] failed design_id=%s reason=%s", short_id(design_id), reason)
            result = {
                "design_id": design_id,
                "success": False,
                "deleted_storage": False,
                "deleted_db": False,
                "reason": reason,
            }
        results.append(result)

    deleted = sum(1 for result in results if result.get("success"))
    failed = len(results) - deleted
    return {
        "total": len(results),
        "deleted": deleted,
        "failed": failed,
        "results": results,
    }


@router.delete("/designs/{design_id}")
def delete_design(
    design_id: str,
    user: AuthUser = Depends(get_current_user),
) -> dict:
    """Delete a design, its R2 files, and related logs/jobs.

    Returns a detailed response showing exactly what was deleted so the
    frontend and developer can verify the cleanup was complete.
    """
    result = _delete_design_for_user_result(design_id, user)
    if not result.get("success"):
        status_code = 404 if "not found" in str(result.get("reason") or "").lower() else 403
        raise HTTPException(status_code=status_code, detail=result.get("reason") or "Design delete failed.")
    return result

    import logging
    logger = logging.getLogger("podpilot.delete")

    design = supabase_service.get_design_for_user(design_id, user.id)
    if design is None:
        raise HTTPException(status_code=404, detail="Design not found.")
    _require_marketplace_access(user.id, design.get("marketplace") or "redbubble")

    logger.info(
        "DELETE design_id=%s user_id=%s image=%s excel=%s",
        short_id(design_id), short_user_id(user.id),
        _safe_r2_key_for_log(design.get("image_r2_key")),
        _safe_r2_key_for_log(design.get("excel_r2_key")),
    )

    deleted_r2_keys = []
    missing_r2_keys = []

    # Delete image from R2.
    image_key = design.get("image_r2_key")
    if image_key:
        try:
            existed = r2_service.delete_object(image_key)
            if existed:
                deleted_r2_keys.append(image_key)
                logger.info("R2 DELETE OK (existed): %s", _safe_r2_key_for_log(image_key))
            else:
                missing_r2_keys.append(image_key)
                logger.warning("R2 object NOT FOUND (already gone): %s", _safe_r2_key_for_log(image_key))
        except r2_service.R2Error as err:
            missing_r2_keys.append(image_key)
            logger.warning(
                "R2 DELETE FAILED: %s error_type=%s",
                _safe_r2_key_for_log(image_key),
                _safe_error_type(err),
            )
    else:
        logger.warning("No image_r2_key for design %s; nothing to delete from R2", design_id)
        missing_r2_keys.append("(no image_r2_key in DB)")

    # Delete thumbnail from R2.
    thumbnail_key = design.get("thumbnail_r2_key")
    if thumbnail_key:
        try:
            existed = r2_service.delete_object(thumbnail_key)
            if existed:
                deleted_r2_keys.append(thumbnail_key)
                logger.info("R2 DELETE OK (existed thumbnail): %s", _safe_r2_key_for_log(thumbnail_key))
            else:
                missing_r2_keys.append(thumbnail_key)
                logger.warning("R2 thumbnail NOT FOUND (already gone): %s", _safe_r2_key_for_log(thumbnail_key))
        except r2_service.R2Error as err:
            missing_r2_keys.append(thumbnail_key)
            logger.warning(
                "R2 DELETE FAILED (thumbnail): %s error_type=%s",
                _safe_r2_key_for_log(thumbnail_key),
                _safe_error_type(err),
            )

    # Delete excel from R2.
    excel_key = design.get("excel_r2_key")
    if excel_key:
        try:
            existed = r2_service.delete_object(excel_key)
            if existed:
                deleted_r2_keys.append(excel_key)
                logger.info("R2 DELETE OK (existed): %s", _safe_r2_key_for_log(excel_key))
            else:
                missing_r2_keys.append(excel_key)
                logger.warning("R2 excel NOT FOUND (already gone): %s", _safe_r2_key_for_log(excel_key))
        except r2_service.R2Error as err:
            missing_r2_keys.append(excel_key)
            logger.warning(
                "R2 DELETE FAILED: %s error_type=%s",
                _safe_r2_key_for_log(excel_key),
                _safe_error_type(err),
            )

    # Delete related upload logs.
    deleted_logs = 0
    try:
        logs = supabase_service.list_upload_logs_for_user(
            user.id, design_id=design_id, limit=1000
        )
        if logs:
            admin = supabase_service.admin_client()
            log_ids = [str(log["id"]) for log in logs if log.get("id")]
            if log_ids:
                admin.table("upload_logs").delete().in_("id", log_ids).execute()
                deleted_logs = len(log_ids)
                logger.info("Deleted %d upload_logs for design %s", deleted_logs, short_id(design_id))
    except Exception as err:
        logger.warning("upload_logs cleanup failed design_id=%s error_type=%s", short_id(design_id), safe_error_type(err))

    # Ã¢â€â‚¬Ã¢â€â‚¬ Delete the design row from Supabase Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
    deleted_count = supabase_service.delete_designs_for_user([design_id], user.id)
    logger.info("DB DELETE result: %d rows for design %s", deleted_count, short_id(design_id))

    if deleted_count == 0:
        raise HTTPException(status_code=404, detail="Design not found in database.")

    return {
        "success": True,
        "deleted_design_id": design_id,
        "deleted_r2_keys": deleted_r2_keys,
        "missing_r2_keys": missing_r2_keys,
        "deleted_logs": deleted_logs,
    }


# Ã¢â€â‚¬Ã¢â€â‚¬ Image upload Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

@router.post("/designs/{design_id}/image")
async def upload_design_image(
    design_id: str,
    file: UploadFile = File(...),
    user: AuthUser = Depends(get_current_user),
) -> dict:
    """Attach (or replace) the image for an existing design."""
    rate_limiter.enforce_user_limit(user.id, rate_limiter.IMAGE_UPLOAD)
    logger.info(
        "image_upload_started user=%s design_id=%s filename=%s",
        short_user_id(user.id),
        short_id(design_id),
        _safe_name(file.filename or "image.png"),
    )
    design = supabase_service.get_design_for_user(design_id, user.id)
    if design is None:
        raise HTTPException(status_code=404, detail="Design not found.")
    _require_marketplace_access(user.id, design.get("marketplace") or "redbubble")

    extension = Path(file.filename or "").suffix.lower()
    contents, content_type = await _read_validated_image_upload(file)

    image_key = r2_service.design_image_key(
        user_id=user.id,
        marketplace=design.get("marketplace") or "redbubble",
        design_id=str(design_id),
        filename=file.filename or "image.png",
    )
    thumbnail_key = r2_service.design_thumbnail_key(
        user_id=user.id,
        marketplace=design.get("marketplace") or "redbubble",
        design_id=str(design_id),
        filename=file.filename or "image.png",
    )
    try:
        r2_service.upload_bytes(
            image_key,
            contents,
            content_type=content_type,
        )
    except r2_service.R2Error as error:
        logger.warning(
            "image_upload_failed user=%s design_id=%s key=%s error_type=%s",
            short_user_id(user.id),
            short_id(design_id),
            safe_r2_key(image_key),
            safe_error_type(error),
        )
        raise HTTPException(status_code=502, detail="R2 upload failed.") from error

    # Generate and upload thumbnail
    try:
        thumbnail_bytes = r2_service.generate_thumbnail_bytes(contents)
        r2_service.upload_bytes(
            thumbnail_key,
            thumbnail_bytes,
            content_type="image/webp",
        )
    except Exception as error:
        logger.warning(
            "thumbnail_generation_failed route=upload_design_image design_id=%s error_type=%s",
            short_id(design_id),
            safe_error_type(error),
        )
        thumbnail_key = None

    update_payload = {"image_r2_key": image_key}
    if thumbnail_key:
        update_payload["thumbnail_r2_key"] = thumbnail_key

    updated = supabase_service.update_design(
        design_id, user.id, update_payload
    )
    logger.info(
        "image_upload_succeeded user=%s design_id=%s image_key=%s thumbnail_key=%s bytes=%d",
        short_user_id(user.id),
        short_id(design_id),
        safe_r2_key(image_key),
        safe_r2_key(thumbnail_key),
        len(contents),
    )
    return _design_with_file_urls(updated or {**design, "image_r2_key": image_key})


@router.post("/designs/import/images")
async def upload_design_images_bulk(
    files: list[UploadFile] = File(...),
    marketplace: str = Form("redbubble"),
    user: AuthUser = Depends(get_current_user),
) -> dict:
    """Upload multiple images that aren't yet attached to designs.

    Returns `{filename, image_r2_key, image_url}` per file. The frontend
    can match these to parsed-Excel rows by filename, then submit them via
    /designs/import/confirm.
    """
    rate_limiter.enforce_user_limit(user.id, rate_limiter.IMAGE_UPLOAD)
    marketplace = _validate_marketplace(marketplace)
    _require_marketplace_access(user.id, marketplace)
    logger.info(
        "bulk_image_upload_started user=%s marketplace=%s file_count=%d",
        short_user_id(user.id),
        marketplace,
        len(files or []),
    )
    if not files:
        raise HTTPException(status_code=400, detail="Upload at least one image.")

    results = []
    batch_total = 0
    for image in files:
        extension = Path(image.filename or "").suffix.lower()
        contents, content_type = await _read_validated_image_upload(image)
        batch_total = _add_to_batch_total(batch_total, len(contents))
        slot_id = r2_service.new_design_id()
        image_key = r2_service.design_image_key(
            user_id=user.id,
            marketplace=marketplace,
            design_id=slot_id,
            filename=image.filename or f"image{extension}",
        )
        try:
            r2_service.upload_bytes(
                image_key,
                contents,
                content_type=content_type,
            )
        except r2_service.R2Error as error:
            logger.warning(
                "bulk_image_upload_failed user=%s marketplace=%s key=%s error_type=%s",
                short_user_id(user.id),
                marketplace,
                safe_r2_key(image_key),
                safe_error_type(error),
            )
            raise HTTPException(status_code=502, detail="R2 upload failed.") from error

        file_dict = {
            "original_name": image.filename,
            "filename": image.filename,
            "image_r2_key": image_key,
            "image_url": "",
            "size": len(contents),
            "stored_name": _safe_name(image.filename or ""),
            # Thumbnails are generated by the create-design background task
            # once the imported image is attached to its final design row.
            "thumbnail_r2_key": None,
            "thumbnail_url": None,
        }

        results.append(file_dict)

    logger.info(
        "bulk_image_upload_succeeded user=%s marketplace=%s file_count=%d bytes=%d",
        short_user_id(user.id),
        marketplace,
        len(results),
        batch_total,
    )
    return {"count": len(results), "files": results}


# Ã¢â€â‚¬Ã¢â€â‚¬ List / read designs Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

@router.get("/designs")
def list_designs(
    marketplace: Optional[str] = Query(default=None),
    user: AuthUser = Depends(get_current_user),
) -> dict:
    rate_limiter.enforce_user_limit(user.id, rate_limiter.EXPENSIVE_LIST)
    if marketplace is not None:
        marketplace = _validate_marketplace(marketplace)
        rows = supabase_service.list_designs_for_user(user.id, marketplace)
    else:
        rows = supabase_service.list_designs_for_user(user.id)
    return {
        "count": len(rows),
        "designs": [_design_with_file_urls(row) for row in rows],
    }


@router.get("/designs/{design_id}")
def get_design(
    design_id: str,
    user: AuthUser = Depends(get_current_user),
) -> dict:
    row = supabase_service.get_design_for_user(design_id, user.id)
    if row is None:
        raise HTTPException(status_code=404, detail="Design not found.")
    return _design_with_file_urls(row)


@router.get("/api/designs/{design_id}/image")
@router.get("/designs/{design_id}/image")
def get_design_image(
    design_id: str,
    user: AuthUser = Depends(get_current_user),
) -> StreamingResponse:
    return _stream_design_file(design_id, user, kind="image")


@router.get("/api/designs/{design_id}/thumbnail")
@router.get("/designs/{design_id}/thumbnail")
def get_design_thumbnail(
    design_id: str,
    user: AuthUser = Depends(get_current_user),
) -> StreamingResponse:
    return _stream_design_file(design_id, user, kind="thumbnail")


@router.get("/designs/{design_id}/image-url")
def get_design_image_url(
    design_id: str,
    user: AuthUser = Depends(get_current_user),
) -> dict:
    """Mint a fresh signed GET URL for the design image. The Chrome
    extension calls this right before each upload so the URL covers the
    entire Redbubble upload step.
    """
    design = supabase_service.get_design_for_user(design_id, user.id)
    if design is None:
        raise HTTPException(status_code=404, detail="Design not found.")
    _require_marketplace_access(user.id, design.get("marketplace") or "redbubble")
    image_key = design.get("image_r2_key")
    if not image_key:
        raise HTTPException(status_code=404, detail="Design has no image.")
    try:
        url = r2_service.signed_get_url(image_key)
    except r2_service.R2Error as error:
        logger.warning(
            "design_image_url_sign_failed user=%s design_id=%s key=%s error_type=%s",
            short_user_id(user.id),
            short_id(design_id),
            safe_r2_key(image_key),
            safe_error_type(error),
        )
        raise HTTPException(status_code=502, detail="Could not prepare image URL.") from error
    return {
        "design_id": str(design_id),
        "image_r2_key": image_key,
        "image_url": url,
    }


# Ã¢â€â‚¬Ã¢â€â‚¬ Status updates from the Chrome extension Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

@router.post("/api/ai/listing-content")
async def generate_ai_listing_content(
    payload: AIListingContentIn,
    user: AuthUser = Depends(get_current_user),
) -> dict:
    """Generate listing metadata for an owned design using backend-only AI keys."""
    rate_limiter.enforce_user_limit(user.id, rate_limiter.AI_GENERATE)
    platform = _validate_marketplace(payload.platform)
    _require_marketplace_access(user.id, platform)
    logger.info(
        "ai_listing_request_started user=%s design_id=%s platform=%s",
        short_user_id(user.id),
        short_id(payload.design_id),
        platform,
    )
    design = supabase_service.get_design_for_user(payload.design_id, user.id)
    if design is None:
        raise HTTPException(status_code=404, detail="Design not found.")

    design_marketplace = design.get("marketplace") or platform
    if design_marketplace != platform:
        raise HTTPException(status_code=400, detail="Design does not belong to this platform.")

    with _ai_generation_slot(user.id):
        import time
        from app.services.image_preview_service import ensure_ai_preview_for_design

        # Lazily ensure/get preview
        start_preview = time.perf_counter()
        image_url, image_source, generated = await ensure_ai_preview_for_design(user.id, design)
        preview_gen_ms = int((time.perf_counter() - start_preview) * 1000) if generated else 0

        # Log timing of preview generation safely
        logger.info(f"[AI TIMING] preview_generation_ms={preview_gen_ms}")
        logger.info(f"[AI TIMING] image_source={image_source}")

        reservation = _reserve_ai_token(user.id)
        try:
            result = await generate_listing_content(
                design=design,
                platform=platform,
                current_metadata=payload.current_metadata,
                image_url=image_url,
            )
        except AIListingError as error:
            _refund_ai_token(user.id, reservation, reason="listing_content_failed")
            logger.warning(
                "ai_listing_request_failed user=%s design_id=%s platform=%s error_type=%s",
                short_user_id(user.id),
                short_id(payload.design_id),
                platform,
                safe_error_type(error),
            )
            raise HTTPException(status_code=503, detail=str(error)) from error

        logger.info(
            "ai_listing_request_succeeded user=%s design_id=%s platform=%s image_source=%s token_source=%s",
            short_user_id(user.id),
            short_id(payload.design_id),
            platform,
            image_source,
            reservation.get("token_source"),
        )
        return result


@router.post("/api/ai/listing-content/draft")
async def generate_ai_listing_content_draft(
    platform: str = Form("redbubble"),
    current_metadata: str = Form("{}"),
    file: UploadFile | None = File(default=None),
    user: AuthUser = Depends(get_current_user),
) -> dict:
    """Generate listing metadata for an unsaved create draft.

    This never writes a file or creates a design row. The authenticated user
    dependency keeps the feature behind the same account boundary as saved
    design generation.
    """
    rate_limiter.enforce_user_limit(user.id, rate_limiter.AI_GENERATE)
    platform = _validate_marketplace(platform)
    _require_marketplace_access(user.id, platform)
    logger.info(
        "ai_listing_draft_started user=%s platform=%s has_file=%s",
        short_user_id(user.id),
        platform,
        file is not None,
    )
    try:
        metadata = json.loads(current_metadata or "{}")
    except json.JSONDecodeError as error:
        raise HTTPException(status_code=400, detail="Invalid current metadata.") from error
    if not isinstance(metadata, dict):
        raise HTTPException(status_code=400, detail="Invalid current metadata.")

    image_bytes = None
    image_mime_type = ""
    if file is not None:
        image_bytes, image_mime_type = await _read_validated_image_upload(file)
        if file.filename and not metadata.get("filename"):
            metadata["filename"] = file.filename

    with _ai_generation_slot(user.id):
        reservation = _reserve_ai_token(user.id)
        try:
            result = await generate_listing_content(
                design={"filename": metadata.get("filename", ""), "marketplace": platform},
                platform=platform,
                current_metadata=metadata,
                image_bytes=image_bytes,
                image_mime_type=image_mime_type,
            )
        except AIListingError as error:
            _refund_ai_token(user.id, reservation, reason="listing_draft_failed")
            logger.warning(
                "ai_listing_draft_failed user=%s platform=%s error_type=%s",
                short_user_id(user.id),
                platform,
                safe_error_type(error),
            )
            raise HTTPException(status_code=503, detail=str(error)) from error

        logger.info(
            "ai_listing_draft_succeeded user=%s platform=%s token_source=%s",
            short_user_id(user.id),
            platform,
            reservation.get("token_source"),
        )
        return result


def _normalize_tags_for_ai(value: list[str] | str) -> list[str]:
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()]
    return [tag.strip() for tag in str(value or "").split(",") if tag.strip()]


@router.post("/api/ai/copyright-check")
async def ai_copyright_check(
    payload: AICopyrightCheckIn,
    user: AuthUser = Depends(get_current_user),
) -> dict:
    """Run an informational AI copyright/IP risk check for a design."""
    rate_limiter.enforce_user_limit(user.id, rate_limiter.AI_GENERATE)
    platform = _validate_marketplace(payload.platform)
    _require_marketplace_access(user.id, platform)
    logger.info(
        "ai_copyright_check_started user=%s design_id=%s platform=%s has_image_key=%s has_inline_image=%s",
        short_user_id(user.id),
        short_id(payload.design_id),
        platform,
        bool(payload.image_r2_key),
        bool(payload.image_base64),
    )

    design: dict[str, Any] = {}
    image_url = ""
    image_r2_key = (payload.image_r2_key or "").strip()

    if payload.design_id:
        existing = supabase_service.get_design_for_user(payload.design_id, user.id)
        if existing is None:
            raise HTTPException(status_code=404, detail="Design not found.")
        design = dict(existing)
        design_marketplace = design.get("marketplace") or platform
        if design_marketplace != platform:
            raise HTTPException(status_code=400, detail="Design does not belong to this platform.")
        image_r2_key = image_r2_key or str(design.get("image_r2_key") or "")

    if image_r2_key:
        user_prefix = f"users/{user.id}/"
        if not image_r2_key.startswith(user_prefix):
            raise HTTPException(
                status_code=403,
                detail="R2 key does not belong to the authenticated user.",
            )
        try:
            image_url = r2_service.signed_get_url(image_r2_key)
        except r2_service.R2Error:
            image_url = ""

    metadata = {
        "platform": platform,
        "filename": design.get("filename") or "",
        "title": payload.title or design.get("title") or "",
        "description": payload.description or design.get("description") or "",
        "main_tag": payload.main_tag or payload.primary_tag or design.get("primary_tag") or design.get("main_tag") or "",
        "primary_tag": payload.primary_tag or payload.main_tag or design.get("primary_tag") or design.get("main_tag") or "",
        "supporting_tags": _normalize_tags_for_ai(payload.supporting_tags or design.get("supporting_tags") or []),
        "detected_trademark_terms": _normalize_tags_for_ai(payload.detected_trademark_terms),
    }

    with _ai_generation_slot(user.id):
        reservation = _reserve_ai_token(user.id)
        try:
            result = await check_copyright_risk(
                metadata=metadata,
                image_url=image_url,
                image_base64=payload.image_base64 or "",
            )
        except AICopyrightImageTooLarge as error:
            _refund_ai_token(user.id, reservation, reason="copyright_check_image_too_large")
            logger.warning(
                "ai_copyright_check_rejected_oversized_image user=%s design_id=%s platform=%s",
                short_user_id(user.id),
                short_id(payload.design_id),
                platform,
            )
            raise HTTPException(status_code=413, detail=str(error)) from error
        except AICopyrightRiskError as error:
            _refund_ai_token(user.id, reservation, reason="copyright_check_failed")
            logger.warning(
                "ai_copyright_check_failed user=%s design_id=%s platform=%s error_type=%s",
                short_user_id(user.id),
                short_id(payload.design_id),
                platform,
                safe_error_type(error),
            )
            raise HTTPException(status_code=503, detail=str(error)) from error

        logger.info(
            "ai_copyright_check_succeeded user=%s design_id=%s platform=%s risk_status=%s token_source=%s",
            short_user_id(user.id),
            short_id(payload.design_id),
            platform,
            result.get("status") or result.get("risk_level") or "unknown",
            reservation.get("token_source") or "unknown",
        )
        return {
            **result,
            "tokens_remaining": {
                "daily_remaining": int(reservation.get("remaining_daily", 0) or 0),
                "extra_tokens": int(reservation.get("remaining_extra", 0) or 0),
            },
            "disclaimer": "AI risk check is informational only. Review carefully before publishing.",
        }


@router.post("/designs/{design_id}/status")
def update_design_status_endpoint(
    design_id: str,
    payload: DesignStatusUpdateIn,
    user: AuthUser = Depends(get_current_user),
) -> dict:
    design = supabase_service.get_design_for_user(design_id, user.id)
    if design is None:
        raise HTTPException(status_code=404, detail="Design not found.")
    _require_marketplace_access(user.id, design.get("marketplace") or "redbubble")

    extra: dict = {}
    if payload.error_message is not None:
        extra["error_message"] = payload.error_message
    elif payload.status == "uploaded":
        extra["error_message"] = None

    updated = supabase_service.update_design_status(
        design_id,
        user.id,
        status=payload.status,
        extra=extra,
    )

    # Append a log line so the user can see history. The DB column is
    # `level` + `message`; we encode stage / redbubble_work_id into the
    # message JSON so no schema change is needed.
    level = "error" if payload.status == "failed" else "info"
    log_message = json.dumps({
        "status": payload.status,
        "stage": payload.stage,
        "error_message": payload.error_message,
        "redbubble_work_id": payload.redbubble_work_id,
    })
    supabase_service.insert_upload_log(
        user_id=user.id,
        design_id=str(design_id),
        level=level,
        message=log_message,
    )

    return _design_with_file_urls(updated or design)


# Ã¢â€â‚¬Ã¢â€â‚¬ Upload jobs Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

@router.post("/upload-jobs")
def create_upload_job(
    payload: UploadJobCreateIn,
    user: AuthUser = Depends(get_current_user),
) -> dict:
    payload.marketplace = _validate_marketplace(payload.marketplace)
    _require_marketplace_access(user.id, payload.marketplace)
    owned_design_ids: list[str] = []
    for design_id in payload.design_ids:
        owned = supabase_service.get_design_for_user(str(design_id), user.id)
        if owned is None:
            raise HTTPException(status_code=404, detail="Design not found.")
        if (owned.get("marketplace") or "redbubble") != payload.marketplace:
            raise HTTPException(status_code=400, detail="Design does not belong to this platform.")
        owned_design_ids.append(str(design_id))

    job = supabase_service.insert_upload_job(
        user_id=user.id,
        marketplace=payload.marketplace,
        total_designs=payload.total_designs,
        status="pending",
    )

    for design_id in owned_design_ids:
        # Mark each chosen design as queued for upload (idempotent).
        supabase_service.update_design_status(
            design_id,
            user.id,
            status="pending",
        )

    return {"upload_job": job}


@router.patch("/upload-jobs/{job_id}")
def patch_upload_job(
    job_id: str,
    payload: UploadJobUpdateIn,
    user: AuthUser = Depends(get_current_user),
) -> dict:
    patch = payload.to_patch()
    if not patch:
        raise HTTPException(status_code=400, detail="No fields to update.")
    existing = supabase_service.get_upload_job_for_user(job_id, user.id)
    if existing is None:
        raise HTTPException(status_code=404, detail="Upload job not found.")
    _require_marketplace_access(user.id, existing.get("marketplace") or "redbubble")
    updated = supabase_service.update_upload_job(job_id, user.id, patch)
    if updated is None:
        raise HTTPException(status_code=404, detail="Upload job not found.")
    return updated


@router.get("/upload-jobs")
def list_upload_jobs(
    marketplace: Optional[str] = Query(default=None),
    only_pending: bool = Query(default=False),
    user: AuthUser = Depends(get_current_user),
) -> dict:
    rate_limiter.enforce_user_limit(user.id, rate_limiter.EXPENSIVE_LIST)
    if marketplace is not None:
        marketplace = _validate_marketplace(marketplace)
        _require_marketplace_access(user.id, marketplace)
    elif not _allowed_marketplaces_for_user(user.id):
        return {"count": 0, "upload_jobs": []}
    statuses = ["pending", "running"] if only_pending else None
    if marketplace is not None:
        jobs = supabase_service.list_upload_jobs_for_user(
            user.id, marketplace=marketplace, statuses=statuses,
        )
    else:
        jobs = []
        for allowed_marketplace in _allowed_marketplaces_for_user(user.id):
            jobs.extend(supabase_service.list_upload_jobs_for_user(
                user.id, marketplace=allowed_marketplace, statuses=statuses,
            ))
    return {"count": len(jobs), "upload_jobs": jobs}


@router.get("/upload-jobs/pending")
def list_pending_designs_for_extension(
    marketplace: Optional[str] = Query(default=None),
    user: AuthUser = Depends(get_current_user),
) -> dict:
    """Return every design the extension should upload now.

    The Chrome extension popup calls this right after login, then again
    each time it finishes a row, so it always has the freshest queue.
    """
    rate_limiter.enforce_user_limit(user.id, rate_limiter.EXPENSIVE_LIST)
    if marketplace is not None:
        marketplace = _validate_marketplace(marketplace)
        _require_marketplace_access(user.id, marketplace)
        rows = supabase_service.list_designs_for_user(
            user.id,
            marketplace=marketplace,
            statuses=("pending", "uploading"),
        )
    else:
        rows = []
        for allowed_marketplace in _allowed_marketplaces_for_user(user.id):
            rows.extend(supabase_service.list_designs_for_user(
                user.id,
                marketplace=allowed_marketplace,
                statuses=("pending", "uploading"),
            ))
    return {
        "count": len(rows),
        "designs": [_design_with_file_urls(row) for row in rows],
    }


# Ã¢â€â‚¬Ã¢â€â‚¬ Upload logs Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

@router.get("/api/upload-queue/{marketplace}")
def get_prepared_upload_queue(
    marketplace: str,
    user: AuthUser = Depends(get_current_user),
) -> dict:
    rate_limiter.enforce_user_limit(user.id, rate_limiter.EXPENSIVE_LIST)
    marketplace = _validate_marketplace(marketplace)
    _require_marketplace_access(user.id, marketplace)
    try:
        items = _prepared_queue_for_user(user_id=user.id, marketplace=marketplace)
    except r2_service.R2Error as error:
        raise HTTPException(status_code=502, detail="Could not prepare upload URLs.") from error
    return {"marketplace": marketplace, "count": len(items), "items": items}


@router.post("/api/upload-sessions/{marketplace}")
def create_upload_session(
    marketplace: str,
    payload: UploadSessionCreateIn,
    user: AuthUser = Depends(get_current_user),
) -> dict:
    rate_limiter.enforce_user_limit(user.id, rate_limiter.EXPENSIVE_LIST)
    marketplace = _validate_marketplace(marketplace)
    _require_marketplace_access(user.id, marketplace)
    design_ids = [str(design_id).strip() for design_id in payload.design_ids if str(design_id).strip()]
    if not design_ids:
        raise HTTPException(status_code=400, detail="Provide at least one design id.")
    try:
        items = _prepared_queue_for_user(
            user_id=user.id,
            marketplace=marketplace,
            design_ids=design_ids,
        )
    except r2_service.R2Error as error:
        raise HTTPException(status_code=502, detail="Could not prepare upload URLs.") from error

    job = supabase_service.insert_upload_job(
        user_id=user.id,
        marketplace=marketplace,
        total_designs=len(items),
        status="pending",
    )
    session_id = str(job.get("id") or "")
    for item in items:
        if item.get("upload_ready"):
            supabase_service.update_design_status(item["design_id"], user.id, status="pending")
        supabase_service.insert_upload_log(
            user.id,
            design_id=item["design_id"],
            job_id=session_id or None,
            level="info" if item.get("upload_ready") else "warn",
            message="ready" if item.get("upload_ready") else "preparing",
        )

    return {"session_id": session_id, "marketplace": marketplace, "items": items}


@router.post("/api/upload-sessions/{session_id}/items/{design_id}/status")
def update_upload_session_item_status(
    session_id: str,
    design_id: str,
    payload: UploadSessionItemStatusIn,
    user: AuthUser = Depends(get_current_user),
) -> dict:
    job = supabase_service.get_upload_job_for_user(session_id, user.id)
    if job is None:
        raise HTTPException(status_code=404, detail="Upload session not found.")
    marketplace = job.get("marketplace") or "redbubble"
    _require_marketplace_access(user.id, marketplace)
    design = supabase_service.get_design_for_user(design_id, user.id)
    if design is None:
        raise HTTPException(status_code=404, detail="Design not found.")
    if (design.get("marketplace") or "redbubble") != marketplace:
        raise HTTPException(status_code=400, detail="Design does not belong to this upload session.")

    design_status = {
        "queued": "pending",
        "preparing": "pending",
        "ready": "pending",
        "uploading": "uploading",
        "uploaded": "uploaded",
        "failed": "failed",
        "skipped": "failed",
    }[payload.status]
    updated = supabase_service.update_design_status(
        design_id,
        user.id,
        status=design_status,
        error_message=payload.error_message or (payload.status if payload.status in {"failed", "skipped"} else ""),
    )
    supabase_service.insert_upload_log(
        user.id,
        design_id=design_id,
        job_id=session_id,
        level="error" if payload.status == "failed" else "info",
        message=payload.status,
    )
    if payload.status in {"uploaded", "failed", "skipped"}:
        current_uploaded = int(job.get("uploaded_count") or 0)
        current_failed = int(job.get("failed_count") or 0)
        patch: dict[str, Any] = {"status": "running"}
        next_uploaded = current_uploaded
        next_failed = current_failed
        if payload.status == "uploaded":
            next_uploaded += 1
            patch["uploaded_count"] = next_uploaded
        else:
            next_failed += 1
            patch["failed_count"] = next_failed
        if next_uploaded + next_failed >= int(job.get("total_designs") or 0):
            patch["status"] = "completed"
        supabase_service.update_upload_job(session_id, user.id, patch)
    elif payload.status == "uploading":
        supabase_service.update_upload_job(session_id, user.id, {"status": "running"})

    return {
        "session_id": session_id,
        "design_id": design_id,
        "status": payload.status,
        "design": _design_with_file_urls(updated or design),
    }


@router.post("/upload-logs")
def create_upload_log(
    payload: UploadLogIn,
    user: AuthUser = Depends(get_current_user),
) -> dict:
    if payload.design_id:
        owned = supabase_service.get_design_for_user(payload.design_id, user.id)
        if owned is None:
            raise HTTPException(status_code=404, detail="Design not found.")

    log = supabase_service.insert_upload_log(
        user_id=user.id,
        design_id=payload.design_id,
        job_id=payload.job_id,
        level=payload.level,
        message=payload.message,
    )
    return log


@router.get("/upload-logs")
def list_upload_logs(
    design_id: Optional[str] = Query(default=None),
    job_id: Optional[str] = Query(default=None),
    limit: int = Query(default=200, ge=1, le=1000),
    user: AuthUser = Depends(get_current_user),
) -> dict:
    rate_limiter.enforce_user_limit(user.id, rate_limiter.EXPENSIVE_LIST)
    logs = supabase_service.list_upload_logs_for_user(
        user.id, design_id=design_id, job_id=job_id, limit=limit,
    )
    return {"count": len(logs), "logs": logs}



# Ã¢â€â‚¬Ã¢â€â‚¬ Trademark check Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

from app.schemas.job import TrademarkBuildTermsIn, TrademarkCheckIn  # noqa: E402
from app.services import trademark_service  # noqa: E402


@router.get("/api/trademark/check")
async def trademark_check_phrase(
    phrase: str = Query(..., min_length=1, max_length=120),
    user: AuthUser = Depends(get_current_user),
) -> dict:
    """Check one exact phrase through the backend-only TMHunt adapter."""
    _require_trademark_access(user.id)
    try:
        return await trademark_service.check_phrase(phrase)
    except trademark_service.TrademarkRateLimitError as exc:
        raise HTTPException(status_code=429, detail=str(exc)) from exc
    except trademark_service.TrademarkLookupError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.post("/trademark/check")
async def trademark_check(
    payload: TrademarkCheckIn,
    user: AuthUser = Depends(get_current_user),
) -> dict:
    """Check a list of free-form terms against the USPTO trademark database.

    Returns matches, the list of terms actually checked (after stop-word
    filtering and dedup), and any per-term errors. Never fakes data Ã¢â‚¬â€ if
    the live USPTO call fails, the error is surfaced in `errors`.
    """
    _require_trademark_access(user.id)
    if not payload.terms:
        raise HTTPException(status_code=400, detail="Provide at least one term to check.")
    return await trademark_service.check_terms(payload.terms)


@router.post("/trademark/check-design")
async def trademark_check_design(
    payload: TrademarkBuildTermsIn,
    user: AuthUser = Depends(get_current_user),
) -> dict:
    """Build a sensible term list from a single design's metadata and check it.

    Frontend convenience: pass the title/primary_tag/supporting_tags/
    description and the backend handles term extraction and USPTO query.
    """
    _require_trademark_access(user.id)
    primary = payload.primary_tag or payload.main_tag or ""
    terms = trademark_service.split_terms(
        title=payload.title or "",
        primary_tag=primary,
        supporting_tags=payload.supporting_tags or "",
        description=payload.description or "",
    )
    if not terms:
        return {"matches": [], "checked_terms": [], "errors": []}
    return await trademark_service.check_terms(terms)


@router.post("/api/admin/cleanup-old-designs")
def cleanup_old_designs(
    dry_run: bool = Query(default=True),
    cutoff_hours: int = Query(default=168),
    confirm: bool = Query(default=False),
    x_cleanup_secret: Optional[str] = Header(default=None, alias="X-Cleanup-Secret"),
) -> dict:
    """Safely cleanup old design workspaces and temporary files from DB and Cloudflare R2."""
    from datetime import datetime, timezone, timedelta
    from app.core.config import ADMIN_CLEANUP_SECRET

    _verify_cleanup_secret(
        configured_secret=ADMIN_CLEANUP_SECRET,
        provided_secret=x_cleanup_secret,
        log_prefix="[Cleanup]",
    )
    _require_live_cleanup_confirmation(
        dry_run=dry_run,
        confirm=confirm,
        log_prefix="[Cleanup]",
    )

    # Log started
    logger.info("[Cleanup] started dry_run=%s confirm=%s cutoff_hours=%d", dry_run, confirm, cutoff_hours)

    # Calculate reporting cutoff time. Eligibility is based on cleanup_at <= now().
    cutoff_time = datetime.now(timezone.utc) - timedelta(hours=cutoff_hours)

    # Retrieve designs whose cleanup_at deadline has passed
    eligible_designs = supabase_service.list_old_designs(cutoff_time)
    eligible_count = len(eligible_designs)

    # Log found designs
    logger.info("[Cleanup] found %d designs", eligible_count)

    if dry_run:
        cleanup_run = supabase_service.insert_cleanup_run_summary(
            dry_run=True,
            cutoff_at=cutoff_time,
            status="completed",
            deleted_count=0,
            failed_count=0,
        )
        # Dry run: return candidate list without deleting anything
        return {
            "dry_run": True,
            "cutoff_hours": cutoff_hours,
            "eligible_count": eligible_count,
            "cleanup_run_id": str(cleanup_run.get("id")) if cleanup_run and cleanup_run.get("id") else None,
            "designs": [
                {
                    "id": d.get("id"),
                    "title": d.get("title") or "",
                    "user_id": d.get("user_id"),
                    "image_r2_key": d.get("image_r2_key"),
                    "thumbnail_r2_key": d.get("thumbnail_r2_key"),
                    "excel_r2_key": d.get("excel_r2_key"),
                    "ai_preview_r2_key": d.get("ai_preview_r2_key"),
                }
                for d in eligible_designs
            ],
        }

    # Real run: perform actual deletion
    deleted_count = 0
    failed_count = 0
    deleted_design_ids = []
    deleted_r2_keys = []
    warnings = []

    # Use a set to track already deleted/attempted R2 keys in this batch (specifically for shared excel sheets)
    attempted_r2_keys = set()

    for design in eligible_designs:
        design_id = design.get("id")
        user_id = design.get("user_id")
        title = design.get("title") or ""
        storage_failed = False
        if not design_id:
            continue

        try:
            # 1. Delete image R2 key if present
            image_key = design.get("image_r2_key")
            if image_key:
                if image_key not in attempted_r2_keys:
                    attempted_r2_keys.add(image_key)
                    try:
                        existed = r2_service.delete_object(image_key)
                        if existed:
                            deleted_r2_keys.append(image_key)
                            logger.info("[Cleanup] deleted R2 key %s", _safe_r2_key_for_log(image_key))
                        else:
                            logger.info("[Cleanup] R2 key not found (already gone): %s", _safe_r2_key_for_log(image_key))
                    except Exception as err:
                        warnings.append(f"Failed to delete image R2 key {image_key} for design {design_id}: {err}")
                        storage_failed = True
                        logger.warning(
                            "[Cleanup] R2 DELETE FAILED: %s error_type=%s",
                            _safe_r2_key_for_log(image_key),
                            _safe_error_type(err),
                        )
                else:
                    logger.info("[Cleanup] R2 key already handled in this batch: %s", _safe_r2_key_for_log(image_key))

            # 2. Delete thumbnail R2 key if present
            thumbnail_key = design.get("thumbnail_r2_key")
            if thumbnail_key:
                if thumbnail_key not in attempted_r2_keys:
                    attempted_r2_keys.add(thumbnail_key)
                    try:
                        existed = r2_service.delete_object(thumbnail_key)
                        if existed:
                            deleted_r2_keys.append(thumbnail_key)
                            logger.info("[Cleanup] deleted R2 key %s", _safe_r2_key_for_log(thumbnail_key))
                        else:
                            logger.info("[Cleanup] R2 thumbnail key not found (already gone): %s", _safe_r2_key_for_log(thumbnail_key))
                    except Exception as err:
                        warnings.append(f"Failed to delete thumbnail R2 key {thumbnail_key} for design {design_id}: {err}")
                        storage_failed = True
                        logger.warning(
                            "[Cleanup] R2 DELETE FAILED (thumbnail): %s error_type=%s",
                            _safe_r2_key_for_log(thumbnail_key),
                            _safe_error_type(err),
                        )
                else:
                    logger.info("[Cleanup] R2 key already handled in this batch: %s", _safe_r2_key_for_log(thumbnail_key))

            # 3. Delete excel R2 key if present
            excel_key = design.get("excel_r2_key")
            if excel_key:
                if excel_key not in attempted_r2_keys:
                    attempted_r2_keys.add(excel_key)
                    try:
                        existed = r2_service.delete_object(excel_key)
                        if existed:
                            deleted_r2_keys.append(excel_key)
                            logger.info("[Cleanup] deleted R2 key %s", _safe_r2_key_for_log(excel_key))
                        else:
                            logger.info("[Cleanup] R2 excel key not found (already gone): %s", _safe_r2_key_for_log(excel_key))
                    except Exception as err:
                        warnings.append(f"Failed to delete excel R2 key {excel_key} for design {design_id}: {err}")
                        storage_failed = True
                        logger.warning(
                            "[Cleanup] R2 DELETE FAILED: %s error_type=%s",
                            _safe_r2_key_for_log(excel_key),
                            _safe_error_type(err),
                        )
                else:
                    logger.info("[Cleanup] R2 key already handled in this batch: %s", _safe_r2_key_for_log(excel_key))

            # 4. Delete AI preview R2 key if present
            ai_preview_key = design.get("ai_preview_r2_key")
            if ai_preview_key:
                if ai_preview_key not in attempted_r2_keys:
                    attempted_r2_keys.add(ai_preview_key)
                    try:
                        existed = r2_service.delete_object(ai_preview_key)
                        if existed:
                            deleted_r2_keys.append(ai_preview_key)
                            logger.info("[Cleanup] deleted R2 key %s", _safe_r2_key_for_log(ai_preview_key))
                        else:
                            logger.info("[Cleanup] R2 AI preview key not found (already gone): %s", _safe_r2_key_for_log(ai_preview_key))
                    except Exception as err:
                        warnings.append(f"Failed to delete AI preview R2 key {ai_preview_key} for design {design_id}: {err}")
                        storage_failed = True
                        logger.warning(
                            "[Cleanup] R2 DELETE FAILED (AI preview): %s error_type=%s",
                            _safe_r2_key_for_log(ai_preview_key),
                            _safe_error_type(err),
                        )
                else:
                    logger.info("[Cleanup] R2 key already handled in this batch: %s", _safe_r2_key_for_log(ai_preview_key))

            if storage_failed:
                failed_count += 1
                warnings.append(f"Skipped database delete for design {design_id} because one or more R2 deletes failed.")
                logger.warning("[Cleanup] skipped db delete after R2 failure design_id=%s", short_id(design_id))
                continue

            # 5. Delete related upload logs
            try:
                admin_client = supabase_service.admin_client()
                admin_client.table("upload_logs").delete().eq("design_id", design_id).execute()
                logger.info("[Cleanup] deleted upload_logs for design_id=%s", design_id)
            except Exception as err:
                warnings.append(f"Failed to delete upload_logs for design {design_id}: {err}")
                logger.warning("[Cleanup] upload_logs cleanup failed design_id=%s error_type=%s", short_id(design_id), safe_error_type(err))

            # 6. Delete design row from database
            rows_deleted = supabase_service.delete_designs_admin([design_id])
            if rows_deleted > 0:
                deleted_design_ids.append(design_id)
                deleted_count += 1
                logger.info("[Cleanup] deleted design_id=%s", design_id)
            else:
                failed_count += 1
                warnings.append(f"Design {design_id} not found in database during deletion step.")
                logger.warning("[Cleanup] Design %s not found in database during deletion step.", design_id)

        except Exception as err:
            failed_count += 1
            warnings.append(f"Unexpected error cleaning up design {design_id}: {err}")
from app.schemas.job import TrademarkBuildTermsIn, TrademarkCheckIn  # noqa: E402
from app.services import trademark_service  # noqa: E402


@router.post("/trademark/check")
async def trademark_check(
    payload: TrademarkCheckIn,
    user: AuthUser = Depends(get_current_user),
) -> dict:
    """Check a list of free-form terms against the USPTO trademark database.

    Returns matches, the list of terms actually checked (after stop-word
    filtering and dedup), and any per-term errors. Never fakes data Ã¢â‚¬â€ if
    the live USPTO call fails, the error is surfaced in `errors`.
    """
    _require_trademark_access(user.id)
    if not payload.terms:
        raise HTTPException(status_code=400, detail="Provide at least one term to check.")
    return await trademark_service.check_terms(payload.terms)


@router.post("/trademark/check-design")
async def trademark_check_design(
    payload: TrademarkBuildTermsIn,
    user: AuthUser = Depends(get_current_user),
) -> dict:
    """Build a sensible term list from a single design's metadata and check it.

    Frontend convenience: pass the title/primary_tag/supporting_tags/
    description and the backend handles term extraction and USPTO query.
    """
    _require_trademark_access(user.id)
    primary = payload.primary_tag or payload.main_tag or ""
    terms = trademark_service.split_terms(
        title=payload.title or "",
        primary_tag=primary,
        supporting_tags=payload.supporting_tags or "",
        description=payload.description or "",
    )
    if not terms:
        return {"matches": [], "checked_terms": [], "errors": []}
    return await trademark_service.check_terms(terms)


@router.post("/api/admin/cleanup-old-designs")
def cleanup_old_designs(
    dry_run: bool = Query(default=True),
    cutoff_hours: int = Query(default=168),
    confirm: bool = Query(default=False),
    x_cleanup_secret: Optional[str] = Header(default=None, alias="X-Cleanup-Secret"),
) -> dict:
    """Safely cleanup old design workspaces and temporary files from DB and Cloudflare R2."""
    from datetime import datetime, timezone, timedelta
    from app.core.config import ADMIN_CLEANUP_SECRET

    _verify_cleanup_secret(
        configured_secret=ADMIN_CLEANUP_SECRET,
        provided_secret=x_cleanup_secret,
        log_prefix="[Cleanup]",
    )
    _require_live_cleanup_confirmation(
        dry_run=dry_run,
        confirm=confirm,
        log_prefix="[Cleanup]",
    )

    # Log started
    logger.info("[Cleanup] started dry_run=%s confirm=%s cutoff_hours=%d", dry_run, confirm, cutoff_hours)

    # Calculate reporting cutoff time. Eligibility is based on cleanup_at <= now().
    cutoff_time = datetime.now(timezone.utc) - timedelta(hours=cutoff_hours)

    # Retrieve designs whose cleanup_at deadline has passed
    eligible_designs = supabase_service.list_old_designs(cutoff_time)
    eligible_count = len(eligible_designs)

    # Log found designs
    logger.info("[Cleanup] found %d designs", eligible_count)

    if dry_run:
        cleanup_run = supabase_service.insert_cleanup_run_summary(
            dry_run=True,
            cutoff_at=cutoff_time,
            status="completed",
            deleted_count=0,
            failed_count=0,
        )
        # Dry run: return candidate list without deleting anything
        return {
            "dry_run": True,
            "cutoff_hours": cutoff_hours,
            "eligible_count": eligible_count,
            "cleanup_run_id": str(cleanup_run.get("id")) if cleanup_run and cleanup_run.get("id") else None,
            "designs": [
                {
                    "id": d.get("id"),
                    "title": d.get("title") or "",
                    "user_id": d.get("user_id"),
                    "image_r2_key": d.get("image_r2_key"),
                    "thumbnail_r2_key": d.get("thumbnail_r2_key"),
                    "excel_r2_key": d.get("excel_r2_key"),
                    "ai_preview_r2_key": d.get("ai_preview_r2_key"),
                }
                for d in eligible_designs
            ],
        }

    # Real run: perform actual deletion
    deleted_count = 0
    failed_count = 0
    deleted_design_ids = []
    deleted_r2_keys = []
    warnings = []

    # Use a set to track already deleted/attempted R2 keys in this batch (specifically for shared excel sheets)
    attempted_r2_keys = set()

    for design in eligible_designs:
        design_id = design.get("id")
        user_id = design.get("user_id")
        title = design.get("title") or ""
        storage_failed = False
        if not design_id:
            continue

        try:
            # 1. Delete image R2 key if present
            image_key = design.get("image_r2_key")
            if image_key:
                if image_key not in attempted_r2_keys:
                    attempted_r2_keys.add(image_key)
                    try:
                        existed = r2_service.delete_object(image_key)
                        if existed:
                            deleted_r2_keys.append(image_key)
                            logger.info("[Cleanup] deleted R2 key %s", _safe_r2_key_for_log(image_key))
                        else:
                            logger.info("[Cleanup] R2 key not found (already gone): %s", _safe_r2_key_for_log(image_key))
                    except Exception as err:
                        warnings.append(f"Failed to delete image R2 key {image_key} for design {design_id}: {err}")
                        storage_failed = True
                        logger.warning(
                            "[Cleanup] R2 DELETE FAILED: %s error_type=%s",
                            _safe_r2_key_for_log(image_key),
                            _safe_error_type(err),
                        )
                else:
                    logger.info("[Cleanup] R2 key already handled in this batch: %s", _safe_r2_key_for_log(image_key))

            # 2. Delete thumbnail R2 key if present
            thumbnail_key = design.get("thumbnail_r2_key")
            if thumbnail_key:
                if thumbnail_key not in attempted_r2_keys:
                    attempted_r2_keys.add(thumbnail_key)
                    try:
                        existed = r2_service.delete_object(thumbnail_key)
                        if existed:
                            deleted_r2_keys.append(thumbnail_key)
                            logger.info("[Cleanup] deleted R2 key %s", _safe_r2_key_for_log(thumbnail_key))
                        else:
                            logger.info("[Cleanup] R2 thumbnail key not found (already gone): %s", _safe_r2_key_for_log(thumbnail_key))
                    except Exception as err:
                        warnings.append(f"Failed to delete thumbnail R2 key {thumbnail_key} for design {design_id}: {err}")
                        storage_failed = True
                        logger.warning(
                            "[Cleanup] R2 DELETE FAILED (thumbnail): %s error_type=%s",
                            _safe_r2_key_for_log(thumbnail_key),
                            _safe_error_type(err),
                        )
                else:
                    logger.info("[Cleanup] R2 key already handled in this batch: %s", _safe_r2_key_for_log(thumbnail_key))

            # 3. Delete excel R2 key if present
            excel_key = design.get("excel_r2_key")
            if excel_key:
                if excel_key not in attempted_r2_keys:
                    attempted_r2_keys.add(excel_key)
                    try:
                        existed = r2_service.delete_object(excel_key)
                        if existed:
                            deleted_r2_keys.append(excel_key)
                            logger.info("[Cleanup] deleted R2 key %s", _safe_r2_key_for_log(excel_key))
                        else:
                            logger.info("[Cleanup] R2 excel key not found (already gone): %s", _safe_r2_key_for_log(excel_key))
                    except Exception as err:
                        warnings.append(f"Failed to delete excel R2 key {excel_key} for design {design_id}: {err}")
                        storage_failed = True
                        logger.warning(
                            "[Cleanup] R2 DELETE FAILED: %s error_type=%s",
                            _safe_r2_key_for_log(excel_key),
                            _safe_error_type(err),
                        )
                else:
                    logger.info("[Cleanup] R2 key already handled in this batch: %s", _safe_r2_key_for_log(excel_key))

            # 4. Delete AI preview R2 key if present
            ai_preview_key = design.get("ai_preview_r2_key")
            if ai_preview_key:
                if ai_preview_key not in attempted_r2_keys:
                    attempted_r2_keys.add(ai_preview_key)
                    try:
                        existed = r2_service.delete_object(ai_preview_key)
                        if existed:
                            deleted_r2_keys.append(ai_preview_key)
                            logger.info("[Cleanup] deleted R2 key %s", _safe_r2_key_for_log(ai_preview_key))
                        else:
                            logger.info("[Cleanup] R2 AI preview key not found (already gone): %s", _safe_r2_key_for_log(ai_preview_key))
                    except Exception as err:
                        warnings.append(f"Failed to delete AI preview R2 key {ai_preview_key} for design {design_id}: {err}")
                        storage_failed = True
                        logger.warning(
                            "[Cleanup] R2 DELETE FAILED (AI preview): %s error_type=%s",
                            _safe_r2_key_for_log(ai_preview_key),
                            _safe_error_type(err),
                        )
                else:
                    logger.info("[Cleanup] R2 key already handled in this batch: %s", _safe_r2_key_for_log(ai_preview_key))

            if storage_failed:
                failed_count += 1
                warnings.append(f"Skipped database delete for design {design_id} because one or more R2 deletes failed.")
                logger.warning("[Cleanup] skipped db delete after R2 failure design_id=%s", short_id(design_id))
                continue

            # 5. Delete related upload logs
            try:
                admin_client = supabase_service.admin_client()
                admin_client.table("upload_logs").delete().eq("design_id", design_id).execute()
                logger.info("[Cleanup] deleted upload_logs for design_id=%s", design_id)
            except Exception as err:
                warnings.append(f"Failed to delete upload_logs for design {design_id}: {err}")
                logger.warning("[Cleanup] upload_logs cleanup failed design_id=%s error_type=%s", short_id(design_id), safe_error_type(err))

            # 6. Delete design row from database
            rows_deleted = supabase_service.delete_designs_admin([design_id])
            if rows_deleted > 0:
                deleted_design_ids.append(design_id)
                deleted_count += 1
                logger.info("[Cleanup] deleted design_id=%s", design_id)
            else:
                failed_count += 1
                warnings.append(f"Design {design_id} not found in database during deletion step.")
                logger.warning("[Cleanup] Design %s not found in database during deletion step.", design_id)

        except Exception as err:
            failed_count += 1
            warnings.append(f"Unexpected error cleaning up design {design_id}: {err}")
            logger.error("[Cleanup] unexpected error cleaning up design_id=%s error_type=%s", short_id(design_id), safe_error_type(err))

    # Log completed
    logger.info("[Cleanup] completed deleted_count=%d failed_count=%d", deleted_count, failed_count)
    cleanup_run = supabase_service.insert_cleanup_run_summary(
        dry_run=False,
        cutoff_at=cutoff_time,
        status="completed",
        deleted_count=deleted_count,
        failed_count=failed_count,
    )

    return {
        "dry_run": False,
        "cutoff_hours": cutoff_hours,
        "eligible_count": eligible_count,
        "deleted_count": deleted_count,
        "failed_count": failed_count,
        "cleanup_run_id": str(cleanup_run.get("id")) if cleanup_run and cleanup_run.get("id") else None,
        "deleted_design_ids": deleted_design_ids,
        "deleted_r2_keys": deleted_r2_keys,
        "warnings": warnings,
    }


@router.post("/api/admin/cleanup-orphan-r2-objects")
def cleanup_orphan_r2_objects(
    dry_run: bool = Query(default=True),
    confirm: bool = Query(default=False),
    x_cleanup_secret: Optional[str] = Header(default=None, alias="X-Cleanup-Secret"),
) -> dict:
    """Scan and delete orphan Cloudflare R2 files that are no longer referenced in public.designs."""
    from app.core.config import ADMIN_CLEANUP_SECRET

    _verify_cleanup_secret(
        configured_secret=ADMIN_CLEANUP_SECRET,
        provided_secret=x_cleanup_secret,
        log_prefix="[Cleanup-Orphans]",
    )
    _require_live_cleanup_confirmation(
        dry_run=dry_run,
        confirm=confirm,
        log_prefix="[Cleanup-Orphans]",
    )

    # Log started
    logger.info("[Cleanup-Orphans] started dry_run=%s confirm=%s", dry_run, confirm)

    # 3. Retrieve all referenced R2 keys from Supabase
    try:
        referenced_keys = supabase_service.get_all_referenced_r2_keys()
    except Exception as err:
        logger.error("[Cleanup-Orphans] failed to fetch referenced keys error_type=%s", safe_error_type(err))
        raise HTTPException(
            status_code=500,
            detail=f"Failed to fetch referenced keys from database: {err}"
        )

    referenced_count = len(referenced_keys)

    # 4. List all objects in R2 under the 'users/' prefix
    try:
        all_r2_keys = r2_service.list_objects(prefix="users/")
    except Exception as err:
        logger.error("[Cleanup-Orphans] failed to list R2 objects error_type=%s", safe_error_type(err))
        raise HTTPException(
            status_code=502,
            detail=f"Cloudflare R2 list failed: {err}"
        )

    scanned_count = len(all_r2_keys)
    logger.info("[Cleanup-Orphans] scanned %d objects", scanned_count)

    # 5. Identify orphans: keys in R2 (under 'users/') that are NOT in referenced_keys
    orphan_keys = []
    for key in all_r2_keys:
        normalized_key = key.strip()
        # Double check prefix safety
        if not normalized_key.startswith("users/"):
            continue
        if normalized_key not in referenced_keys:
            orphan_keys.append(normalized_key)

    orphan_count = len(orphan_keys)
    logger.info("[Cleanup-Orphans] found %d orphan objects", orphan_count)

    if dry_run:
        # Dry run: return candidate orphans without deleting anything
        return {
            "dry_run": True,
            "scanned_count": scanned_count,
            "referenced_count": referenced_count,
            "orphan_count": orphan_count,
            "orphan_keys": orphan_keys,
        }

    # Real run: delete the identified orphans
    deleted_count = 0
    deleted_r2_keys = []
    warnings = []

    for key in orphan_keys:
        try:
            existed = r2_service.delete_object(key)
            if existed:
                deleted_r2_keys.append(key)
                deleted_count += 1
                logger.info("[Cleanup-Orphans] deleted key %s", _safe_r2_key_for_log(key))
            else:
                logger.info("[Cleanup-Orphans] key already missing: %s", _safe_r2_key_for_log(key))
        except Exception as err:
            warnings.append(f"Failed to delete orphan key {key}: {err}")
            logger.warning(
                "[Cleanup-Orphans] failed to delete key %s error_type=%s",
                _safe_r2_key_for_log(key),
                _safe_error_type(err),
            )

    logger.info("[Cleanup-Orphans] completed deleted_count=%d", deleted_count)

    return {
        "dry_run": False,
        "scanned_count": scanned_count,
        "referenced_count": referenced_count,
        "orphan_count": orphan_count,
        "deleted_count": deleted_count,
        "deleted_r2_keys": deleted_r2_keys,
        "warnings": warnings,
    }


import re

# Lazy-loaded disposable domains blocklist
_GOOD_PROVIDERS = {
    "gmail.com", "yahoo.com", "outlook.com", "icloud.com", "proton.me", "protonmail.com",
    "hotmail.com", "live.com", "aol.com", "zoho.com", "mail.com", "gmx.com", "yandex.com"
}

_HARDCODED_DISPOSABLE = {
    "mailinator.com", "guerrillamail.com", "guerrillamail.net", "10minutemail.com",
    "temp-mail.org", "tempr.email", "yopmail.com", "disposablemail.com",
    "throwawaymail.com", "getnada.com", "maildrop.cc", "sharklasers.com",
    "grr.la", "spam4.me", "moakt.com", "emailondeck.com", "fakeinbox.com",
    "trashmail.com", "dispostable.com", "mintemail.com", "mytemp.email",
    "tempail.com", "burnermail.io"
}

_disposable_domains = set()
_domains_loaded = False
_domains_lock = threading.Lock()

def _get_disposable_domains() -> set[str]:
    global _domains_loaded, _disposable_domains
    if not _domains_loaded:
        with _domains_lock:
            if not _domains_loaded:
                domains = set(_HARDCODED_DISPOSABLE)
                try:
                    file_path = Path(__file__).resolve().parents[1] / "data" / "disposable_email_domains.txt"
                    if file_path.exists():
                        with open(file_path, "r", encoding="utf-8") as f:
                            for line in f:
                                line = line.strip()
                                if line and not line.startswith("#"):
                                    domains.add(line.lower())
                    else:
                        logger.warning("disposable_email_domains.txt not found at %s", file_path)
                except Exception as err:
                    logger.error("Error loading disposable email domains file: %s", err)
                _disposable_domains = domains
                _domains_loaded = True
    return _disposable_domains


def _is_domain_blocked(domain: str) -> bool:
    blocked_set = _get_disposable_domains()
    if domain in blocked_set:
        return True
    
    parts = domain.split(".")
    for i in range(1, len(parts) - 1):
        parent = ".".join(parts[i:])
        if parent in blocked_set:
            return True
    return False


class CheckEmailIn(BaseModel):
    email: str = Field(min_length=1)


def _public_check_email_ok() -> dict:
    return {
        "ok": True,
        "message": "If an account exists, follow the next steps shown in the app.",
    }


@router.post("/api/auth/check-email")
async def check_email(payload: CheckEmailIn, request: Request) -> dict:
    rate_limiter.enforce_ip_limit(request, rate_limiter.PUBLIC_AUTH)

    # 2. Normalize email
    email = payload.email.strip().lower()
    if not email:
        raise HTTPException(status_code=400, detail="Email is required.")

    # 3. Format validation
    if not re.match(r"^[^\s@]+@[^\s@]+\.[^\s@]+$", email):
        return {
            "allowed": False,
            "reason": "invalid_email_format",
            "message": "Please enter a valid email address."
        }

    _, domain = email.split("@", 1)

    # 5. Allowlist check: bypass disposable & pattern checks if in allowlist
    if domain in _GOOD_PROVIDERS:
        logger.info("Check-email result: domain=%s, ok=True, reason=None (allowlist)", domain)
        return _public_check_email_ok()

    # 6. Obvious patterns checks (testing domains, localhost, missing dot, suspicious words)
    if "." not in domain or domain in {"localhost", "localhost.localdomain"}:
        logger.info("Check-email result: domain=%s, allowed=False, reason=invalid_email_domain (invalid/localhost)", domain)
        return {
            "allowed": False,
            "reason": "invalid_email_domain",
            "message": "This email domain cannot receive confirmation emails. Please use another address."
        }

    testing_domains = {"example.com", "test.com", "example.org", "example.net", "test.org", "test.net", "testing.com"}
    if domain in testing_domains:
        logger.info("Check-email result: domain=%s, allowed=False, reason=disposable_email (testing domain)", domain)
        return {
            "allowed": False,
            "reason": "disposable_email",
            "message": "Temporary email addresses are not allowed. Please use a real email address."
        }

    suspicious_words = [
        "tempmail", "temp-mail", "disposable", "throwaway", "burner",
        "trashmail", "guerrilla", "yopmail", "mailinator"
    ]
    if any(word in domain for word in suspicious_words):
        logger.info("Check-email result: domain=%s, allowed=False, reason=disposable_email (suspicious pattern)", domain)
        return {
            "allowed": False,
            "reason": "disposable_email",
            "message": "Temporary email addresses are not allowed. Please use a real email address."
        }

    # 7. Local Blocklist Match (Layer A & B)
    if EMAIL_BLOCK_DISPOSABLE and _is_domain_blocked(domain):
        logger.info("Check-email result: domain=%s, allowed=False, reason=disposable_email (blocklist)", domain)
        return {
            "allowed": False,
            "reason": "disposable_email",
            "message": "Temporary email addresses are not allowed. Please use a real email address."
        }

    # 8. Third-Party verification (istempmail)
    if EMAIL_VERIFICATION_PROVIDER == "istempmail" and EMAIL_VERIFICATION_API_KEY:
        try:
            api_url = f"https://www.istempmail.com/api/check/{EMAIL_VERIFICATION_API_KEY}/{domain}"
            async with httpx.AsyncClient(timeout=5.0) as client:
                api_resp = await client.get(api_url)
            if api_resp.status_code == 200:
                api_data = api_resp.json()
                if api_data.get("blocked"):
                    logger.info("Check-email result: domain=%s, allowed=False, reason=disposable_email (istempmail)", domain)
                    return {
                        "allowed": False,
                        "reason": "disposable_email",
                        "message": "Temporary email addresses are not allowed. Please use a real email address."
                    }
                if api_data.get("unresolvable"):
                    logger.info("Check-email result: domain=%s, allowed=False, reason=invalid_email_domain (istempmail unresolvable)", domain)
                    return {
                        "allowed": False,
                        "reason": "invalid_email_domain",
                        "message": "This email domain cannot receive confirmation emails. Please use another address."
                    }
            else:
                logger.warning("istempmail API returned status %s for domain %s", api_resp.status_code, domain)
        except Exception as err:
            logger.error("Error querying istempmail API for domain %s error_type=%s", domain, safe_error_type(err))

    # 9. MX record validation via Cloudflare DoH (optional)
    if EMAIL_REQUIRE_MX_CHECK:
        try:
            doh_url = "https://cloudflare-dns.com/dns-query"
            headers = {"Accept": "application/dns-json"}
            params = {"name": domain, "type": "MX"}
            async with httpx.AsyncClient(timeout=3.0) as client:
                doh_resp = await client.get(doh_url, headers=headers, params=params)
            if doh_resp.status_code == 200:
                doh_data = doh_resp.json()
                answer = doh_data.get("Answer", [])
                # MX type is 15 in DNS
                mx_records = [rec for rec in answer if rec.get("type") == 15]
                if not mx_records:
                    logger.info("Check-email result: domain=%s, allowed=False, reason=invalid_email_domain (no MX)", domain)
                    return {
                        "allowed": False,
                        "reason": "invalid_email_domain",
                        "message": "This email domain cannot receive confirmation emails. Please use another address."
                    }
            else:
                logger.warning("Cloudflare DoH returned status %s for domain %s", doh_resp.status_code, domain)
        except Exception as err:
            logger.error("Error querying Cloudflare DoH MX check for domain %s error_type=%s", domain, safe_error_type(err))

    # 10. Clean / Valid email
    logger.info("Check-email result: domain=%s, ok=True, reason=None", domain)
    return _public_check_email_ok()
