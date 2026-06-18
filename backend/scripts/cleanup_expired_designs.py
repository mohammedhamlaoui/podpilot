"""Dry-run-first cleanup for expired PodPilot design files.

This script is intended for the production VPS systemd timer. It deletes
expired rows from Supabase and referenced files from Cloudflare R2 only when
called with --execute. The default mode is a safe dry run.

It never prints secrets. Missing environment in dry-run mode is reported as
"not_configured" and exits successfully so local validation can run without
production credentials.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

try:
    from dotenv import load_dotenv
except Exception:  # pragma: no cover - dependency exists in normal backend env
    load_dotenv = None


BACKEND_DIR = Path(__file__).resolve().parents[1]
DEFAULT_SERVER_ENV = Path("/etc/podpilot/backend.env")
DEFAULT_RETENTION_HOURS = 24
R2_COLUMNS = ("image_r2_key", "thumbnail_r2_key", "excel_r2_key", "ai_preview_r2_key")
REQUIRED_ENV = (
    "SUPABASE_URL",
    "SUPABASE_ANON_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "R2_ACCOUNT_ID",
    "R2_ACCESS_KEY_ID",
    "R2_SECRET_ACCESS_KEY",
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Clean expired PodPilot design rows and R2 files.")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--dry-run", action="store_true", help="Scan only. This is the default.")
    mode.add_argument("--execute", action="store_true", help="Actually delete expired rows and R2 files.")
    parser.add_argument(
        "--retention-hours",
        type=int,
        default=DEFAULT_RETENTION_HOURS,
        help="Legacy created_at cutoff for rows without cleanup_at. Default: 24.",
    )
    parser.add_argument("--batch-size", type=int, default=200, help="Maximum expired designs to process.")
    parser.add_argument("--env-file", default="", help="Optional env file path to load before backend config.")
    parser.add_argument("--json", action="store_true", help="Print machine-readable JSON summary.")
    return parser.parse_args()


def load_env_files(extra_env_file: str | None) -> list[str]:
    loaded: list[str] = []
    candidates: list[Path] = []
    if extra_env_file:
        candidates.append(Path(extra_env_file))
    env_from_var = os.environ.get("PODPILOT_BACKEND_ENV_FILE")
    if env_from_var:
        candidates.append(Path(env_from_var))
    candidates.extend([DEFAULT_SERVER_ENV, BACKEND_DIR / ".env"])

    if load_dotenv is None:
        return loaded

    seen: set[Path] = set()
    for candidate in candidates:
        path = candidate.expanduser()
        if path in seen or not path.exists():
            continue
        seen.add(path)
        load_dotenv(path, override=False)
        loaded.append(str(path))
    return loaded


def missing_required_env() -> list[str]:
    return [name for name in REQUIRED_ENV if not os.environ.get(name, "").strip()]


def safe_id(value: Any) -> str:
    text = str(value or "")
    if len(text) <= 12:
        return text
    return f"{text[:8]}...{text[-4:]}"


def safe_key(value: Any) -> str:
    text = str(value or "")
    if not text:
        return ""
    parts = text.split("/")
    if len(parts) >= 4 and parts[0] == "users":
        parts[1] = safe_id(parts[1])
        if len(parts) >= 4:
            parts[3] = safe_id(parts[3])
    safe = "/".join(parts)
    if len(safe) > 140:
        return f"{safe[:80]}...{safe[-40:]}"
    return safe


def parse_datetime(value: Any) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def hours_between(start: datetime | None, end: datetime) -> float | None:
    if start is None:
        return None
    return round(max(0.0, (end - start).total_seconds() / 3600), 2)


def collect_r2_keys(design: dict[str, Any]) -> list[str]:
    keys: list[str] = []
    seen: set[str] = set()
    for column in R2_COLUMNS:
        key = str(design.get(column) or "").strip()
        if key and key not in seen:
            seen.add(key)
            keys.append(key)
    return keys


def print_summary(summary: dict[str, Any], *, as_json: bool) -> None:
    if as_json:
        print(json.dumps(summary, indent=2, sort_keys=True))
        return

    print(f"status={summary['status']}")
    print(f"mode={summary['mode']}")
    print(f"retention_hours={summary['retention_hours']}")
    print(f"scanned_count={summary['scanned_count']}")
    print(f"expired_count={summary['expired_count']}")
    print(f"db_rows_deleted={summary['db_rows_deleted']}")
    print(f"r2_objects_deleted={summary['r2_objects_deleted']}")
    print(f"r2_objects_missing={summary['r2_objects_missing']}")
    print(f"storage_failures={summary['storage_failures']}")
    print(f"db_failures={summary['db_failures']}")
    if summary.get("message"):
        print(f"message={summary['message']}")
    for design in summary.get("expired_designs", []):
        print(
            "expired_design "
            f"id={design['id']} "
            f"created_at={design.get('created_at') or '-'} "
            f"cleanup_at={design.get('cleanup_at') or '-'} "
            f"age_hours={design.get('age_hours')} "
            f"expired={design.get('expired')} "
            f"r2_key_count={design.get('r2_key_count', 0)}"
        )


def main() -> int:
    args = parse_args()
    execute = bool(args.execute)
    retention_hours = max(1, int(args.retention_hours or DEFAULT_RETENTION_HOURS))
    batch_size = max(1, int(args.batch_size or 1))
    loaded_env_files = load_env_files(args.env_file)
    missing = missing_required_env()

    base_summary: dict[str, Any] = {
        "status": "ok",
        "mode": "execute" if execute else "dry_run",
        "retention_hours": retention_hours,
        "batch_size": batch_size,
        "loaded_env_files": loaded_env_files,
        "scanned_count": 0,
        "expired_count": 0,
        "db_rows_deleted": 0,
        "r2_objects_deleted": 0,
        "r2_objects_missing": 0,
        "storage_failures": 0,
        "db_failures": 0,
        "failures": [],
        "expired_designs": [],
        "message": "",
    }

    if missing:
        base_summary.update(
            {
                "status": "not_configured",
                "message": "Missing required backend environment variables: " + ", ".join(missing),
            }
        )
        print_summary(base_summary, as_json=args.json)
        return 0 if not execute else 2

    if str(BACKEND_DIR) not in sys.path:
        sys.path.insert(0, str(BACKEND_DIR))

    try:
        from app.services import r2_service, supabase_service  # noqa: WPS433
    except ModuleNotFoundError as exc:
        base_summary.update(
            {
                "status": "dependency_missing",
                "message": f"Missing Python dependency: {exc.name}. Install backend/requirements.txt in the backend venv.",
            }
        )
        print_summary(base_summary, as_json=args.json)
        return 0 if not execute else 2

    now = datetime.now(timezone.utc)
    cutoff_time = now - timedelta(hours=retention_hours)
    expired_designs = supabase_service.list_old_designs(cutoff_time)[:batch_size]
    base_summary["scanned_count"] = len(expired_designs)
    base_summary["expired_count"] = len(expired_designs)

    for design in expired_designs:
        design_id = str(design.get("id") or "")
        if not design_id:
            continue
        keys = collect_r2_keys(design)
        created_at = parse_datetime(design.get("created_at"))
        cleanup_at = parse_datetime(design.get("cleanup_at"))
        expires_at = cleanup_at or (created_at + timedelta(hours=retention_hours) if created_at else None)
        is_expired = bool(expires_at and expires_at <= now)
        base_summary["expired_designs"].append(
            {
                "id": safe_id(design_id),
                "user_id": safe_id(design.get("user_id")),
                "created_at": design.get("created_at"),
                "cleanup_at": design.get("cleanup_at"),
                "age_hours": hours_between(created_at, now),
                "expired": is_expired,
                "r2_key_count": len(keys),
                "r2_keys": [safe_key(key) for key in keys],
            }
        )
        if not execute:
            continue

        if not is_expired:
            base_summary["db_failures"] += 1
            base_summary["failures"].append(
                {
                    "design_id": safe_id(design_id),
                    "operation": "retention_guard",
                    "error_type": "NotExpired",
                }
            )
            continue

        storage_failed = False
        for key in keys:
            try:
                if r2_service.delete_object(key):
                    base_summary["r2_objects_deleted"] += 1
                else:
                    base_summary["r2_objects_missing"] += 1
            except Exception as exc:  # noqa: BLE001 - keep cleanup moving
                storage_failed = True
                base_summary["storage_failures"] += 1
                base_summary["failures"].append(
                    {
                        "design_id": safe_id(design_id),
                        "operation": "r2_delete",
                        "key": safe_key(key),
                        "error_type": type(exc).__name__,
                    }
                )

        if storage_failed:
            base_summary["db_failures"] += 1
            base_summary["failures"].append(
                {
                    "design_id": safe_id(design_id),
                    "operation": "db_delete",
                    "error_type": "SkippedAfterStorageFailure",
                }
            )
            continue

        try:
            admin = supabase_service.admin_client()
            admin.table("upload_logs").delete().eq("design_id", design_id).execute()
            deleted = supabase_service.delete_designs_admin([design_id])
            base_summary["db_rows_deleted"] += int(deleted or 0)
            if not deleted:
                base_summary["db_failures"] += 1
                base_summary["failures"].append(
                    {
                        "design_id": safe_id(design_id),
                        "operation": "db_delete",
                        "error_type": "NoRowsDeleted",
                    }
                )
        except Exception as exc:  # noqa: BLE001 - continue batch
            base_summary["db_failures"] += 1
            base_summary["failures"].append(
                {
                    "design_id": safe_id(design_id),
                    "operation": "db_delete",
                    "error_type": type(exc).__name__,
                    "storage_delete_attempted": bool(keys),
                    "storage_delete_had_failure": storage_failed,
                }
            )

    print_summary(base_summary, as_json=args.json)
    return 1 if execute and (base_summary["storage_failures"] or base_summary["db_failures"]) else 0


if __name__ == "__main__":
    raise SystemExit(main())
