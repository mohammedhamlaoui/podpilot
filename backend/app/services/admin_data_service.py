"""Read models for PodPilot Admin HQ.

Every function is called only after the Owner dependency has succeeded. The
service returns explicit availability metadata instead of turning missing
provider data or migrations into misleading zero values.
"""
from __future__ import annotations

from collections import Counter
from datetime import datetime, timedelta, timezone
from math import ceil
from typing import Any, Optional

import httpx
from fastapi import HTTPException

from app.core import config
from app.services import admin_affiliate_service, supabase_service


def _client():
    return supabase_service.admin_client()


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(value: Any) -> Optional[str]:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.astimezone(timezone.utc).isoformat()
    return str(value)


def _rows(response: Any) -> list[dict[str, Any]]:
    return [dict(row) for row in list(getattr(response, "data", None) or []) if isinstance(row, dict)]


def _page(items: list[dict[str, Any]], page: int, page_size: int, total: int) -> dict[str, Any]:
    return {"items": items, "page": page, "page_size": page_size, "total": total, "pages": max(1, (total + page_size - 1) // page_size)}


def _period(days: Optional[int]) -> tuple[Optional[datetime], datetime]:
    end = _now()
    return (None if not days else end - timedelta(days=days), end)


def _metric(value: Any, source: str, definition: str, *, available: bool = True, estimate: bool = False, reason: str = "") -> dict[str, Any]:
    return {
        "value": value if available else None,
        "status": "available" if available else "unavailable",
        "source": source,
        "definition": definition,
        "is_estimate": estimate,
        "reason": reason or None,
        "refreshed_at": _now().isoformat(),
    }


def _safe_count(table: str, *, column: str = "id", filters: Optional[list[tuple[str, str, Any]]] = None) -> tuple[Optional[int], Optional[str]]:
    try:
        query = _client().table(table).select(column, count="exact").limit(1)
        for operation, name, value in filters or []:
            query = getattr(query, operation)(name, value)
        response = query.execute()
        count = getattr(response, "count", None)
        return (int(count), None) if isinstance(count, int) else (None, "Exact count unavailable")
    except Exception as exc:
        return None, type(exc).__name__


def _auth_users(max_pages: int = 20) -> list[Any]:
    users: list[Any] = []
    for page in range(1, max_pages + 1):
        result = _client().auth.admin.list_users(page=page, per_page=1000)
        batch = result if isinstance(result, list) else getattr(result, "users", [])
        batch = list(batch or [])
        users.extend(batch)
        if len(batch) < 1000:
            break
    return users


def _attr(value: Any, key: str, default: Any = None) -> Any:
    return value.get(key, default) if isinstance(value, dict) else getattr(value, key, default)


def _auth_identity(user: Any) -> dict[str, Any]:
    metadata = _attr(user, "user_metadata", {}) or {}
    return {
        "id": str(_attr(user, "id", "")),
        "email": str(_attr(user, "email", "") or ""),
        "full_name": str(metadata.get("full_name") or metadata.get("name") or "").strip(),
        "registered_at": _iso(_attr(user, "created_at")),
        "last_sign_in_at": _iso(_attr(user, "last_sign_in_at")),
    }


def overview(days: Optional[int]) -> dict[str, Any]:
    start, end = _period(days)
    try:
        users = [_auth_identity(user) for user in _auth_users()]
        total_users = _metric(len(users), "supabase_auth", "All registered Supabase Auth users.")
        new_users = len([u for u in users if not start or (u["registered_at"] and datetime.fromisoformat(u["registered_at"].replace("Z", "+00:00")) >= start)])
        new_registrations = _metric(new_users, "supabase_auth", "Users registered inside the selected period.")
    except Exception as exc:
        total_users = _metric(None, "supabase_auth", "All registered Supabase Auth users.", available=False, reason=type(exc).__name__)
        new_registrations = _metric(None, "supabase_auth", "Users registered inside the selected period.", available=False, reason=type(exc).__name__)

    metrics: dict[str, Any] = {"total_users": total_users, "new_registrations": new_registrations}
    for key, table, definition, filters in [
        ("active_subscriptions", "subscriptions", "Subscriptions currently active or trialing.", [("in_", "status", ["active", "trialing"])]),
        ("designs", "designs", "All design records currently managed by PodPilot.", []),
        ("upload_jobs", "upload_jobs", "All upload jobs in the selected data store.", []),
        ("failed_uploads", "upload_jobs", "Upload jobs whose terminal status is failed.", [("eq", "status", "failed")]),
        ("ai_requests", "ai_request_usage", "Individually metered AI requests.", []),
    ]:
        count, error = _safe_count(table, filters=filters)
        metrics[key] = _metric(count, table, definition, available=error is None, reason=error or "")

    financial_reason = "Paddle transaction reconciliation has not produced a verified local financial ledger."
    for key, definition in {
        "mrr": "Monthly-normalized value of active recurring subscriptions.",
        "arr": "MRR multiplied by twelve; estimated recurring revenue.",
        "gross_revenue": "Completed Paddle customer charges in the selected period.",
        "approved_refunds": "Paddle adjustments confirmed as approved.",
        "net_revenue": "Gross completed charges minus approved refunds.",
    }.items():
        metrics[key] = _metric(None, "paddle", definition, available=False, estimate=key == "arr", reason=financial_reason)

    return {
        "period": {"days": days, "from": _iso(start), "to": _iso(end)},
        "metrics": metrics,
        "health": integration_health(),
    }


def activity_series(days: int) -> dict[str, Any]:
    """Return real, UTC-bucketed product activity without synthetic values."""
    start, end = _period(days)
    if start is None:
        start = end - timedelta(days=30)
    bucket_days = 1 if days <= 60 else 7 if days <= 365 else 30
    bucket_count = max(1, ceil(days / bucket_days))
    buckets = [
        {
            "from": (start + timedelta(days=index * bucket_days)).isoformat(),
            "to": min(end, start + timedelta(days=(index + 1) * bucket_days)).isoformat(),
            "registrations": 0,
            "designs": 0,
            "uploads": 0,
            "ai_requests": 0,
        }
        for index in range(bucket_count)
    ]

    def add(timestamp: Any, key: str) -> None:
        if not timestamp:
            return
        try:
            parsed = datetime.fromisoformat(str(timestamp).replace("Z", "+00:00"))
            if parsed.tzinfo is None:
                parsed = parsed.replace(tzinfo=timezone.utc)
        except (TypeError, ValueError):
            return
        if parsed < start or parsed > end:
            return
        seconds = bucket_days * 86400
        index = min(bucket_count - 1, max(0, int((parsed - start).total_seconds() // seconds)))
        buckets[index][key] += 1

    unavailable: dict[str, str] = {}
    try:
        for user in _auth_users():
            add(_attr(user, "created_at"), "registrations")
    except Exception as exc:
        unavailable["registrations"] = type(exc).__name__

    for table, key in (("designs", "designs"), ("upload_jobs", "uploads"), ("ai_request_usage", "ai_requests")):
        try:
            response = (
                _client()
                .table(table)
                .select("created_at")
                .gte("created_at", start.isoformat())
                .lte("created_at", end.isoformat())
                .order("created_at")
                .limit(10000)
                .execute()
            )
            for row in _rows(response):
                add(row.get("created_at"), key)
        except Exception as exc:
            unavailable[key] = type(exc).__name__

    available_keys = [key for key in ("registrations", "designs", "uploads", "ai_requests") if key not in unavailable]
    return {
        "items": buckets,
        "bucket_days": bucket_days,
        "available_keys": available_keys,
        "unavailable": unavailable,
        "status": "available" if available_keys else "unavailable",
        "source": "supabase_auth_and_postgres",
        "definition": "UTC event counts grouped by the selected period; no missing values are inferred.",
    }


def integration_health() -> list[dict[str, Any]]:
    checks: list[dict[str, Any]] = []
    for name, configured, detail in [
        ("backend", True, "Admin API is responding."),
        ("database", True, "Supabase service client is configured."),
        ("storage", bool(config.R2_ACCOUNT_ID and config.R2_BUCKET_NAME), "Private R2 configuration present."),
        ("paddle", bool(config.PADDLE_API_KEY and config.PADDLE_WEBHOOK_SECRET), "Paddle server configuration present."),
        ("openrouter", bool(config.OPENROUTER_API_KEY), "OpenRouter key configuration present."),
        ("gemini", bool(config.GEMINI_API_KEY), "Gemini key configuration present."),
    ]:
        checks.append({"name": name, "status": "configured" if configured else "unavailable", "detail": detail if configured else "Integration is not configured on this server.", "checked_at": _now().isoformat()})
    try:
        _client().table("designs").select("id").limit(1).execute()
    except Exception as exc:
        checks = [{**item, "status": "unavailable", "detail": type(exc).__name__} if item["name"] == "database" else item for item in checks]
    return checks


def list_users(*, page: int, page_size: int, search: str = "", status: str = "") -> dict[str, Any]:
    identities = [_auth_identity(user) for user in _auth_users()]
    term = search.strip().lower()[:120]
    if term:
        identities = [item for item in identities if term in f'{item["id"]} {item["email"]} {item["full_name"]}'.lower()]
    identities.sort(key=lambda row: row.get("registered_at") or "", reverse=True)
    total = len(identities)
    selected = identities[(page - 1) * page_size: page * page_size]
    ids = [row["id"] for row in selected]
    subscriptions: dict[str, dict[str, Any]] = {}
    controls: dict[str, dict[str, Any]] = {}
    design_counts: Counter[str] = Counter()
    upload_counts: Counter[str] = Counter()
    ai_counts: Counter[str] = Counter()
    if ids:
        for table, columns, destination in [
            ("subscriptions", "user_id,plan,status,current_period_ends_at", subscriptions),
            ("user_account_controls", "user_id,status,reason,changed_at", controls),
        ]:
            try:
                for row in _rows(_client().table(table).select(columns).in_("user_id", ids).execute()):
                    destination[str(row["user_id"])] = row
            except Exception:
                pass
        for table, target in [("designs", design_counts), ("upload_jobs", upload_counts), ("ai_request_usage", ai_counts)]:
            try:
                for row in _rows(_client().table(table).select("user_id").in_("user_id", ids).execute()):
                    target[str(row.get("user_id") or "")] += 1
            except Exception:
                pass
    items = []
    for identity in selected:
        uid = identity["id"]
        subscription = subscriptions.get(uid, {})
        account_status = controls.get(uid, {}).get("status") or "active"
        if status and account_status != status:
            continue
        items.append({**identity, "subscription_plan": subscription.get("plan"), "subscription_status": subscription.get("status") or "inactive", "renewal_at": subscription.get("current_period_ends_at"), "account_status": account_status, "design_count": design_counts[uid], "upload_activity": upload_counts[uid], "ai_usage": ai_counts[uid]})
    return _page(items, page, page_size, total if not status else len(items))


def user_detail(user_id: str) -> dict[str, Any]:
    try:
        result = _client().auth.admin.get_user_by_id(user_id)
        auth_user = getattr(result, "user", None) or result
        identity = _auth_identity(auth_user)
    except Exception as exc:
        raise HTTPException(status_code=404, detail="User not found.") from exc
    related: dict[str, Any] = {}
    related_status: dict[str, str] = {}
    for key, table, columns, limit in [
        ("subscriptions", "subscriptions", "*", 20),
        ("designs", "designs", "id,marketplace,filename,title,status,created_at,cleanup_at", 100),
        ("uploads", "upload_jobs", "*", 100),
        ("upload_logs", "upload_logs", "id,job_id,design_id,level,message,created_at", 100),
        ("ai_usage", "ai_usage", "*", 100),
        ("devices", "user_active_devices", "id,device_label,user_agent,created_at,last_seen_at,revoked_at", 50),
    ]:
        try:
            related[key] = _rows(_client().table(table).select(columns).eq("user_id", user_id).order("created_at" if key not in {"devices"} else "last_seen_at", desc=True).limit(limit).execute())
            related_status[key] = "available"
        except Exception:
            related[key] = []
            related_status[key] = "unavailable"
    counts = {}
    for key, table in (("designs", "designs"), ("uploads", "upload_jobs"), ("ai_usage", "ai_request_usage")):
        count, error = _safe_count(table, filters=[("eq", "user_id", user_id)])
        counts[key] = _metric(count, table, f"All {key.replace('_', ' ')} records for this customer.", available=error is None, reason=error or "")
    try:
        control_rows = _rows(_client().table("user_account_controls").select("*").eq("user_id", user_id).limit(1).execute())
        control_status = "available"
    except Exception:
        control_rows = []
        control_status = "unavailable"
    return {"identity": identity, "account_control": control_rows[0] if control_rows else {"status": "active"} if control_status == "available" else {}, "account_control_status": control_status, "counts": counts, "related_status": related_status, **related}


def list_table(table: str, columns: str, *, page: int, page_size: int, search: str = "", filters: Optional[dict[str, str]] = None, in_filters: Optional[dict[str, list[str]]] = None, order: str = "created_at") -> dict[str, Any]:
    query = _client().table(table).select(columns, count="exact")
    for key, value in (filters or {}).items():
        if value:
            query = query.eq(key, value)
    for key, values in (in_filters or {}).items():
        query = query.in_(key, values)
    if search:
        clean = search.replace("%", "").replace(",", " ").strip()[:120]
        if table == "designs":
            query = query.or_(f"title.ilike.%{clean}%,filename.ilike.%{clean}%")
        elif table == "upload_logs":
            query = query.ilike("message", f"%{clean}%")
    response = query.order(order, desc=True).range((page - 1) * page_size, page * page_size - 1).execute()
    items = _rows(response)
    count = getattr(response, "count", None)
    if not isinstance(count, int):
        return {**_page([], page, page_size, 0), "status": "unavailable", "reason": "Exact count unavailable"}
    return _page(items, page, page_size, count)


def user_records(user_id: str, kind: str, *, page: int, page_size: int, search: str = "", status: str = "") -> dict[str, Any]:
    """Owner-only, allowlisted customer records with exact pagination."""
    specs = {
        "subscriptions": ("subscriptions", "id,user_id,plan,status,billing_cycle,current_period_ends_at,updated_at,paddle_subscription_id", "user_id", "updated_at"),
        "transactions": ("billing_transactions", "paddle_transaction_id,customer_user_id,paddle_subscription_id,status,currency_code,gross_amount_minor,occurred_at", "customer_user_id", "occurred_at"),
        "designs": ("designs", "id,user_id,marketplace,filename,title,status,created_at,cleanup_at", "user_id", "created_at"),
        "uploads": ("upload_jobs", "id,user_id,marketplace,status,total_designs,uploaded_count,failed_count,created_at,updated_at", "user_id", "created_at"),
        "upload-logs": ("upload_logs", "id,user_id,job_id,design_id,level,message,created_at", "user_id", "created_at"),
        "ai": ("ai_request_usage", "id,user_id,provider,model,feature,total_tokens,status,estimated_cost_usd,created_at", "user_id", "created_at"),
        "devices": ("user_active_devices", "id,user_id,device_label,user_agent,created_at,last_seen_at,revoked_at", "user_id", "last_seen_at"),
        "activity": ("admin_audit_logs", "id,actor_user_id,action,reason,success,created_at", "target_id", "created_at"),
    }
    if kind == "notes":
        return list_table("admin_audit_logs", "id,actor_user_id,reason,created_at", page=page, page_size=page_size, filters={"target_id": user_id, "target_type": "user", "action": "user_note_added"})
    if kind == "refunds":
        transaction_ids: list[str] = []
        offset = 0
        while True:
            batch = _rows(_client().table("billing_transactions").select("paddle_transaction_id").eq("customer_user_id", user_id).range(offset, offset + 999).execute())
            transaction_ids.extend(str(row["paddle_transaction_id"]) for row in batch if row.get("paddle_transaction_id"))
            if len(batch) < 1000:
                break
            offset += 1000
            if offset >= 100000:
                raise HTTPException(status_code=503, detail="This customer's refund history is too large to enumerate safely.")
        if not transaction_ids:
            return _page([], page, page_size, 0)
        return list_table("billing_adjustments", "paddle_adjustment_id,paddle_transaction_id,action,status,currency_code,amount_minor,occurred_at", page=page, page_size=page_size, filters={"status": status}, in_filters={"paddle_transaction_id": transaction_ids}, order="occurred_at")
    if kind not in specs:
        raise HTTPException(status_code=404, detail="Record type not found.")
    table, columns, user_column, order = specs[kind]
    filters = {user_column: user_id, "status": status} if kind in {"subscriptions", "transactions", "designs", "uploads", "ai"} else {user_column: user_id}
    if kind == "activity":
        filters["target_type"] = "user"
    return list_table(table, columns, page=page, page_size=page_size, search=search if kind in {"designs", "upload-logs"} else "", filters=filters, order=order)


def list_designs(*, page: int, page_size: int, search: str, marketplace: str, status: str, user_id: str) -> dict[str, Any]:
    return list_table("designs", "id,user_id,marketplace,filename,title,description,primary_tag,supporting_tags,status,error_message,created_at,updated_at,cleanup_at,image_r2_key,thumbnail_r2_key,excel_r2_key,ai_preview_r2_key", page=page, page_size=page_size, search=search, filters={"marketplace": marketplace, "status": status, "user_id": user_id})


def list_uploads(*, page: int, page_size: int, marketplace: str, status: str, user_id: str) -> dict[str, Any]:
    return list_table("upload_jobs", "*", page=page, page_size=page_size, filters={"marketplace": marketplace, "status": status, "user_id": user_id})


def list_ai_usage(*, page: int, page_size: int, provider: str, status: str, user_id: str) -> dict[str, Any]:
    try:
        return list_table("ai_request_usage", "id,user_id,provider,model,feature,input_tokens,output_tokens,total_tokens,latency_ms,status,error_code,estimated_cost_usd,pricing_version,created_at", page=page, page_size=page_size, filters={"provider": provider, "status": status, "user_id": user_id})
    except Exception as exc:
        return {"items": [], "page": page, "page_size": page_size, "total": 0, "pages": 1, "status": "unavailable", "reason": type(exc).__name__}


def list_subscriptions(*, page: int, page_size: int, status: str, plan: str, user_id: str) -> dict[str, Any]:
    return list_table("subscriptions", "*", page=page, page_size=page_size, filters={"status": status, "plan": plan, "user_id": user_id}, order="updated_at")


def list_audit(*, page: int, page_size: int, action: str) -> dict[str, Any]:
    return list_table("admin_audit_logs", "id,actor_user_id,action,target_type,target_id,reason,previous_state,new_state,success,request_id,created_at", page=page, page_size=page_size, filters={"action": action})


def notifications(*, page: int, page_size: int) -> dict[str, Any]:
    return list_table("admin_notifications", "*", page=page, page_size=page_size)


def settings() -> dict[str, Any]:
    try:
        items = _rows(_client().table("admin_settings").select("key,value,value_type,description,version,updated_at").eq("is_sensitive", False).order("key").execute())
        return {"items": items, "status": "available"}
    except Exception as exc:
        return {"items": [], "status": "unavailable", "reason": type(exc).__name__}


def affiliate_overview() -> dict[str, Any]:
    return admin_affiliate_service.overview()
