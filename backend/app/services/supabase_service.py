"""Supabase database access via the service-role client.

Tables used (probed live, treat this as the source of truth — the
SQL definition lives in `docs/SUPABASE_SCHEMA.sql`):

  designs         id, user_id, marketplace, filename, title, description,
                  primary_tag, supporting_tags, copy_link, image_r2_key,
                  excel_r2_key, status, error_message, adult_content,
                  uploaded_at, created_at, updated_at

  upload_jobs     id, user_id, marketplace, status, total_designs,
                  uploaded_count, failed_count, created_at, updated_at

  upload_logs     id, user_id, design_id, job_id, level, message, created_at

Service-role bypasses RLS so the backend can read/write any row, but
EVERY query is still scoped by `user_id` from the verified bearer token.
RLS is enabled in Supabase as a defense-in-depth backstop.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Iterable, Optional

from fastapi import HTTPException
from supabase import Client, create_client

from app.core.config import (
    SUPABASE_ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY,
    SUPABASE_URL,
)
from app.services.logging_utils import error_type as safe_error_type, short_id, short_user_id
from app.services.design_status import build_status_timestamp_patch


logger = logging.getLogger("podpilot.supabase")

_admin: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)


def admin_client() -> Client:
    return _admin


def anon_client() -> Client:
    return create_client(SUPABASE_URL, SUPABASE_ANON_KEY)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _normalize_tags(value: Any) -> list[str]:
    """Coerce comma-separated strings or already-array values to text[]."""
    if value is None:
        return []
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()]
    if isinstance(value, str):
        return [tag.strip() for tag in value.split(",") if tag.strip()]
    return [str(value).strip()] if str(value).strip() else []


# ── Canonical key map for product / color settings ────────────────────────
# The frontend writes canonical keys, but legacy data (or paste from older
# versions) may still hold variants like `bag`/`bags`, `wall_art`/`wallArt`.
# We normalize on every write so the database never accumulates mixed forms.

_CANONICAL_PRODUCT_KEYS = {
    "tshirt", "hoodie", "tank", "crewneck",
    "longsleevetshirt", "baseballtee",
    "kids", "kidshoodie", "kidslongsleevetshirt",
    "shorts", "bags", "hats",
    "stickers", "cases", "mugs", "wallArt",
    "pillows", "totes", "tapestries", "pins", "magnets", "socks",
}

_KEY_ALIASES = {
    "bag": "bags",
    "hat": "hats",
    "case": "cases",
    "mug": "mugs",
    "pillow": "pillows",
    "tote": "totes",
    "tapestry": "tapestries",
    "pin": "pins",
    "magnet": "magnets",
    "sticker": "stickers",
    "short": "shorts",
    "sock": "socks",
    "wallart": "wallArt",
    "longsleeve": "longsleevetshirt",
    "kidslongsleeve": "kidslongsleevetshirt",
}


def _canonical_key(raw: Any) -> str:
    s = str(raw or "").lower().replace("_", "").replace("-", "").replace(" ", "")
    if not s:
        return ""
    if s in _CANONICAL_PRODUCT_KEYS:
        return s
    if s in _KEY_ALIASES:
        return _KEY_ALIASES[s]
    # Try to recover wallArt casing
    if s == "wallart":
        return "wallArt"
    return s


def _canonicalize_settings(settings: Any) -> dict[str, Any]:
    if not isinstance(settings, dict):
        return {}
    out: dict[str, Any] = {}
    for k, v in settings.items():
        ck = _canonical_key(k)
        if ck:
            out[ck] = v
    return out


# ── designs ────────────────────────────────────────────────────────────────

DESIGN_TABLE = "designs"
DESIGN_RETENTION_HOURS = 480

# Columns the API may write. Anything else from the user is dropped to keep
# us schema-safe even if the React layer sends extra keys.
_DESIGN_WRITABLE = {
    "user_id",
    "marketplace",
    "filename",
    "title",
    "description",
    "primary_tag",
    "supporting_tags",
    "copy_link",
    "image_r2_key",
    "thumbnail_r2_key",
    "excel_r2_key",
    "ai_preview_r2_key",
    "status",
    "error_message",
    "adult_content",
    "uploaded_at",
    "cleanup_at",
    "color_settings",
    "product_settings",
}

# Columns that may not exist yet (require migration). If a write fails
# because of these, we now error LOUDLY instead of silently dropping the
# data — the previous behavior caused settings to disappear after refresh.
_OPTIONAL_COLUMNS = {"color_settings", "product_settings"}
_R2_KEY_COLUMNS = {"image_r2_key", "thumbnail_r2_key", "excel_r2_key", "ai_preview_r2_key"}
_DESIGN_IMAGE_VERSION_COLUMNS = {"image_r2_key", "thumbnail_r2_key"}

# Detected at first write — set to the columns that actually exist.
_verified_writable: Optional[set] = None
_optional_columns_present: Optional[bool] = None
_ai_preview_column_present: Optional[bool] = None
_cleanup_at_column_present: Optional[bool] = None
_cleanup_runs_table_present: Optional[bool] = None


def _probe_optional_columns() -> bool:
    """Return True if color_settings / product_settings columns exist.

    Logs a one-time warning if they're missing so the operator knows to
    run docs/migration_color_product_settings.sql in Supabase.
    """
    global _optional_columns_present
    if _optional_columns_present is not None:
        return _optional_columns_present
    try:
        cols = ",".join(_OPTIONAL_COLUMNS)
        _admin.table(DESIGN_TABLE).select(cols).limit(0).execute()
        _optional_columns_present = True
        logger.info("designs.color_settings and designs.product_settings are present.")
    except Exception as exc:
        _optional_columns_present = False
        logger.error(
            "designs.color_settings / designs.product_settings are MISSING. "
            "Run docs/migration_color_product_settings.sql in the Supabase SQL "
            "editor. Saves that include these fields will be REJECTED until "
            "the migration is applied. Underlying error: %s",
            exc,
        )
    return _optional_columns_present


def _probe_ai_preview_column() -> bool:
    """Return True if ai_preview_r2_key exists in designs table.

    Bypasses crashing if migration hasn't been applied yet.
    """
    global _ai_preview_column_present
    if _ai_preview_column_present is not None:
        return _ai_preview_column_present
    try:
        _admin.table(DESIGN_TABLE).select("ai_preview_r2_key").limit(0).execute()
        _ai_preview_column_present = True
        logger.info("designs.ai_preview_r2_key is present.")
    except Exception as exc:
        _ai_preview_column_present = False
        logger.warning(
            "designs.ai_preview_r2_key is MISSING. "
            "Run docs/migration_add_ai_preview_key.sql in the Supabase SQL "
            "editor. Saves/updates that include this field will drop it silently "
            "to prevent crashes. Underlying error: %s",
            exc,
        )
    return _ai_preview_column_present


def _probe_cleanup_at_column() -> bool:
    """Return True if cleanup_at exists in designs table."""
    global _cleanup_at_column_present
    if _cleanup_at_column_present is not None:
        return _cleanup_at_column_present
    try:
        _admin.table(DESIGN_TABLE).select("cleanup_at").limit(0).execute()
        _cleanup_at_column_present = True
        logger.info("designs.cleanup_at is present.")
    except Exception as exc:
        _cleanup_at_column_present = False
        logger.warning(
            "designs.cleanup_at is MISSING. "
            "Run docs/migration_schema_hardening.sql in the Supabase SQL "
            "editor. Design cleanup will be skipped until this column exists. "
            "Underlying error: %s",
            exc,
        )
    return _cleanup_at_column_present


def _probe_cleanup_runs_table() -> bool:
    """Return True if cleanup_runs exists for best-effort summary records."""
    global _cleanup_runs_table_present
    if _cleanup_runs_table_present is not None:
        return _cleanup_runs_table_present
    try:
        _admin.table("cleanup_runs").select("id").limit(0).execute()
        _cleanup_runs_table_present = True
        logger.info("cleanup_runs table is present.")
    except Exception as exc:
        _cleanup_runs_table_present = False
        logger.warning(
            "cleanup_runs table is MISSING. Cleanup summary recording skipped. "
            "Run docs/migration_schema_hardening.sql to enable it. "
            "Underlying error: %s",
            exc,
        )
    return _cleanup_runs_table_present


def _get_writable() -> set:
    """Return the set of columns we can actually write to."""
    global _verified_writable
    if _verified_writable is not None:
        return _verified_writable
    
    writable = set(_DESIGN_WRITABLE)
    if not _probe_optional_columns():
        writable = writable - _OPTIONAL_COLUMNS
    if not _probe_ai_preview_column():
        writable = writable - {"ai_preview_r2_key"}
    if not _probe_cleanup_at_column():
        writable = writable - {"cleanup_at"}
        
    _verified_writable = writable
    return _verified_writable


def _scrub_design(row: dict[str, Any], *, fail_loud: bool = False) -> dict[str, Any]:
    """Filter incoming row to writable columns only.

    If `fail_loud` is True and the caller tried to set color_settings or
    product_settings on a database that doesn't have those columns, raise
    a 500 with a clear migration-needed message instead of silently
    dropping the data.
    """
    writable = _get_writable()
    out: dict[str, Any] = {}
    dropped_optional: list[str] = []
    for k, v in row.items():
        if k in writable:
            # Canonicalize key names inside settings dicts on the way in.
            if k in {"color_settings", "product_settings"}:
                out[k] = _canonicalize_settings(v)
            else:
                out[k] = v
        elif k in _OPTIONAL_COLUMNS and v is not None:
            dropped_optional.append(k)

    if dropped_optional and fail_loud:
        raise HTTPException(
            status_code=500,
            detail=(
                "Cannot save "
                + ", ".join(dropped_optional)
                + " — the Supabase `designs` table is missing those columns. "
                "Run docs/migration_color_product_settings.sql in the Supabase "
                "SQL editor and try again."
            ),
        )

    if "supporting_tags" in out:
        out["supporting_tags"] = _normalize_tags(out["supporting_tags"])
    return out


def _validate_user_r2_keys(row: dict[str, Any], user_id: str) -> None:
    """Ensure stored R2 keys stay inside the authenticated user's namespace."""
    prefix = f"users/{user_id}/"
    for column in _R2_KEY_COLUMNS:
        key = row.get(column)
        if not key:
            continue
        if not str(key).startswith(prefix):
            logger.warning(
                "[R2] rejected cross-user key for user=%s column=%s",
                short_user_id(user_id),
                column,
            )
            raise HTTPException(
                status_code=403,
                detail="R2 key does not belong to the authenticated user.",
            )


def _parse_db_datetime(value: Any) -> Optional[datetime]:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _cleanup_at_for_row(row: dict[str, Any]) -> str:
    created_at = _parse_db_datetime(row.get("created_at")) or datetime.now(timezone.utc)
    return (created_at + timedelta(hours=DESIGN_RETENTION_HOURS)).isoformat()


def _ensure_cleanup_at_for_designs(rows: list[dict[str, Any]]) -> None:
    """Set the fixed 20-day cleanup deadline once for new/legacy rows.

    The deadline is derived from the row's original created_at/import time.
    Normal metadata/image/status updates must not recalculate it, because
    editing a design should never extend retention.
    """
    if not rows or not _probe_cleanup_at_column():
        return
    for row in rows:
        if row.get("cleanup_at"):
            continue
        design_id = row.get("id")
        if not design_id:
            continue
        cleanup_at = _cleanup_at_for_row(row)
        try:
            _admin.table(DESIGN_TABLE).update({"cleanup_at": cleanup_at}).eq("id", design_id).execute()
            row["cleanup_at"] = cleanup_at
        except Exception as exc:
            logger.warning("failed to set cleanup_at design_id=%s error_type=%s", short_id(design_id), safe_error_type(exc))


def insert_designs(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    if not rows:
        return []
    payload = [_scrub_design(row) for row in rows]
    for row in payload:
        user_id = row.get("user_id")
        if user_id:
            _validate_user_r2_keys(row, str(user_id))
    response = _admin.table(DESIGN_TABLE).insert(payload).execute()
    inserted = [dict(row) for row in list(response.data or [])]
    _ensure_cleanup_at_for_designs(inserted)
    return inserted


def list_designs_for_user(
    user_id: str,
    marketplace: Optional[str] = None,
    statuses: Optional[Iterable[str]] = None,
) -> list[dict[str, Any]]:
    query = (
        _admin.table(DESIGN_TABLE)
        .select("*")
        .eq("user_id", user_id)
        .order("created_at", desc=True)
    )
    if marketplace:
        query = query.eq("marketplace", marketplace)
    if statuses:
        query = query.in_("status", list(statuses))
    response = query.execute()
    return list(response.data or [])


def get_design_for_user(design_id: str, user_id: str) -> Optional[dict[str, Any]]:
    response = (
        _admin.table(DESIGN_TABLE)
        .select("*")
        .eq("id", design_id)
        .eq("user_id", user_id)
        .limit(1)
        .execute()
    )
    rows = list(response.data or [])
    return rows[0] if rows else None


def update_design(
    design_id: str,
    user_id: str,
    patch: dict[str, Any],
) -> Optional[dict[str, Any]]:
    # Saves: fail loudly if the user is trying to persist color/product
    # settings on a DB without the migration applied. This prevents the
    # silent-data-loss bug where the API returned 200 but the values
    # never reached the database.
    payload = _scrub_design(patch, fail_loud=True)
    if not payload:
        return None
    if any(column in payload for column in _DESIGN_IMAGE_VERSION_COLUMNS):
        payload["updated_at"] = _now()
    _validate_user_r2_keys(payload, user_id)
    response = (
        _admin.table(DESIGN_TABLE)
        .update(payload)
        .eq("id", design_id)
        .eq("user_id", user_id)
        .execute()
    )
    rows = list(response.data or [])
    return rows[0] if rows else None


def update_design_status(
    design_id: str,
    user_id: str,
    *,
    status: str,
    error_message: Optional[str] = None,
    image_r2_key: Optional[str] = None,
    excel_r2_key: Optional[str] = None,
    extra: Optional[dict[str, Any]] = None,
) -> Optional[dict[str, Any]]:
    now = _now()
    existing_uploaded_at = None
    if status == "uploaded":
        existing = get_design_for_user(design_id, user_id)
        existing_uploaded_at = existing.get("uploaded_at") if existing else None
    patch = build_status_timestamp_patch(
        status,
        now=now,
        existing_uploaded_at=existing_uploaded_at,
    )
    if error_message is not None:
        patch["error_message"] = error_message
    if image_r2_key is not None:
        patch["image_r2_key"] = image_r2_key
    if excel_r2_key is not None:
        patch["excel_r2_key"] = excel_r2_key
    if extra:
        patch.update(extra)
    updated = update_design(design_id, user_id, patch)
    if status == "uploaded" and updated and not updated.get("cleanup_at"):
        _ensure_cleanup_at_for_designs([updated])
    return updated


def delete_designs_for_user(design_ids: Iterable[str], user_id: str) -> int:
    ids = [str(i) for i in design_ids if i]
    if not ids:
        return 0
    response = (
        _admin.table(DESIGN_TABLE)
        .delete()
        .eq("user_id", user_id)
        .in_("id", ids)
        .execute()
    )
    return len(list(response.data or []))


def _select_cleanup_columns() -> str:
    cols = "id, title, user_id, image_r2_key, thumbnail_r2_key, excel_r2_key, created_at"
    if _probe_cleanup_at_column():
        cols += ", cleanup_at"
    if _probe_ai_preview_column():
        cols += ", ai_preview_r2_key"
    return cols


def list_old_designs(cutoff_time: datetime) -> list[dict[str, Any]]:
    """List designs eligible for cleanup.

    Rows are eligible only when cleanup_at is set and has passed. updated_at is
    never used for retention, so normal edits do not extend the 20-day window.
    """
    cols = _select_cleanup_columns()
    if _probe_cleanup_at_column():
        now_iso = datetime.now(timezone.utc).isoformat()
        response = (
            _admin.table(DESIGN_TABLE)
            .select(cols)
            .lte("cleanup_at", now_iso)
            .execute()
        )
        return list(response.data or [])

    logger.warning("design cleanup skipped because designs.cleanup_at is missing")
    return []


def insert_cleanup_run_summary(
    *,
    dry_run: bool,
    cutoff_at: datetime,
    status: str,
    deleted_count: int = 0,
    failed_count: int = 0,
) -> Optional[dict[str, Any]]:
    """Best-effort cleanup run ledger insert.

    Missing cleanup_runs should never block cleanup itself.
    """
    if not _probe_cleanup_runs_table():
        return None
    payload = {
        "dry_run": dry_run,
        "cutoff_at": cutoff_at.isoformat(),
        "status": status,
        "deleted_count": int(deleted_count or 0),
        "failed_count": int(failed_count or 0),
        "finished_at": datetime.now(timezone.utc).isoformat(),
    }
    try:
        response = _admin.table("cleanup_runs").insert(payload).execute()
        rows = list(response.data or [])
        return dict(rows[0]) if rows else payload
    except Exception as exc:
        logger.warning("cleanup_runs insert failed; cleanup will continue error_type=%s", safe_error_type(exc))
        return None


def delete_designs_admin(design_ids: Iterable[str]) -> int:
    """Delete design rows for administrative administrative cleanup bypassing user scoping."""
    ids = [str(i) for i in design_ids if i]
    if not ids:
        return 0
    response = (
        _admin.table(DESIGN_TABLE)
        .delete()
        .in_("id", ids)
        .execute()
    )
    return len(list(response.data or []))


def get_all_referenced_r2_keys() -> set[str]:
    """Retrieve all non-null R2 keys referenced by the designs table."""
    cols = ["image_r2_key", "thumbnail_r2_key", "excel_r2_key"]
    if _probe_ai_preview_column():
        cols.append("ai_preview_r2_key")
        
    select_cols = ",".join(cols)
    response = (
        _admin.table(DESIGN_TABLE)
        .select(select_cols)
        .execute()
    )
    keys = set()
    for row in (response.data or []):
        for col in cols:
            val = row.get(col)
            if val:
                keys.add(val.strip())
    return keys




# ── upload_jobs ────────────────────────────────────────────────────────────

JOB_TABLE = "upload_jobs"

_JOB_WRITABLE = {
    "user_id",
    "marketplace",
    "status",
    "total_designs",
    "uploaded_count",
    "failed_count",
}


def _scrub_job(row: dict[str, Any]) -> dict[str, Any]:
    return {k: v for k, v in row.items() if k in _JOB_WRITABLE}


def insert_upload_job(
    user_id: str,
    marketplace: str,
    *,
    total_designs: int = 0,
    status: str = "pending",
) -> dict[str, Any]:
    payload = _scrub_job({
        "user_id": user_id,
        "marketplace": marketplace,
        "total_designs": total_designs,
        "status": status,
    })
    response = _admin.table(JOB_TABLE).insert(payload).execute()
    rows = list(response.data or [])
    return rows[0] if rows else payload


def list_upload_jobs_for_user(
    user_id: str,
    marketplace: Optional[str] = None,
    statuses: Optional[Iterable[str]] = None,
) -> list[dict[str, Any]]:
    query = (
        _admin.table(JOB_TABLE)
        .select("*")
        .eq("user_id", user_id)
        .order("created_at", desc=True)
    )
    if marketplace:
        query = query.eq("marketplace", marketplace)
    if statuses:
        query = query.in_("status", list(statuses))
    response = query.execute()
    return list(response.data or [])


def get_upload_job_for_user(job_id: str, user_id: str) -> Optional[dict[str, Any]]:
    response = (
        _admin.table(JOB_TABLE)
        .select("*")
        .eq("id", job_id)
        .eq("user_id", user_id)
        .limit(1)
        .execute()
    )
    rows = list(response.data or [])
    return rows[0] if rows else None


def update_upload_job(
    job_id: str,
    user_id: str,
    patch: dict[str, Any],
) -> Optional[dict[str, Any]]:
    payload = _scrub_job(patch)
    if not payload:
        return None
    response = (
        _admin.table(JOB_TABLE)
        .update(payload)
        .eq("id", job_id)
        .eq("user_id", user_id)
        .execute()
    )
    rows = list(response.data or [])
    return rows[0] if rows else None


# ── upload_logs ────────────────────────────────────────────────────────────

LOG_TABLE = "upload_logs"

_LOG_WRITABLE = {
    "user_id",
    "design_id",
    "job_id",
    "level",
    "message",
}


def insert_upload_log(
    user_id: str,
    *,
    design_id: Optional[str] = None,
    job_id: Optional[str] = None,
    level: str = "info",
    message: str = "",
) -> dict[str, Any]:
    payload = {k: v for k, v in {
        "user_id": user_id,
        "design_id": design_id,
        "job_id": job_id,
        "level": level,
        "message": message,
    }.items() if k in _LOG_WRITABLE}
    response = _admin.table(LOG_TABLE).insert(payload).execute()
    rows = list(response.data or [])
    return rows[0] if rows else payload


def list_upload_logs_for_user(
    user_id: str,
    design_id: Optional[str] = None,
    job_id: Optional[str] = None,
    limit: int = 200,
) -> list[dict[str, Any]]:
    query = (
        _admin.table(LOG_TABLE)
        .select("*")
        .eq("user_id", user_id)
        .order("created_at", desc=True)
        .limit(limit)
    )
    if design_id:
        query = query.eq("design_id", design_id)
    if job_id:
        query = query.eq("job_id", job_id)
    response = query.execute()
    return list(response.data or [])
