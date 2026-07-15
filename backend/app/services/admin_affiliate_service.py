"""Admin-only affiliate reporting and workflow helpers.

Every caller is protected by ``require_admin`` at the API boundary. Database
writes use locked SECURITY DEFINER RPCs so status transitions and audit rows
commit atomically. This module never returns raw payout settings or full Paddle
transaction identifiers.
"""
from __future__ import annotations

import json
from datetime import date, datetime, time, timezone
from decimal import Decimal
from math import ceil
from typing import Any, Optional

from fastapi import HTTPException

from app.services import affiliate_service, supabase_service


ALLOWED_ACCOUNT_STATUSES = {"active", "suspended"}
ALLOWED_COMMISSION_STATUSES = {"pending", "available", "paid", "reversed"}
ALLOWED_PAYOUT_STATUSES = {"requested", "approved", "paid", "rejected"}
ALLOWED_PLANS = {"redbubble", "teepublic", "all_platforms"}
ALLOWED_TRANSACTION_TYPES = {"initial", "renewal"}


def _client():
    return supabase_service.admin_client()


def _rows(response: Any) -> list[dict[str, Any]]:
    data = getattr(response, "data", None)
    if isinstance(data, list):
        return [dict(row) for row in data if isinstance(row, dict)]
    if isinstance(data, dict):
        return [dict(data)]
    return []


def _one(response: Any) -> Optional[dict[str, Any]]:
    rows = _rows(response)
    return rows[0] if rows else None


def _money(value: Any) -> float:
    try:
        return float(Decimal(str(value or 0)).quantize(Decimal("0.01")))
    except Exception:
        return 0.0


def _mask_identifier(value: Any, *, leading: int = 4, trailing: int = 4) -> str:
    text = str(value or "").strip()
    if not text:
        return "—"
    if len(text) <= leading + trailing:
        return f"{text[:1]}••••"
    return f"{text[:leading]}…{text[-trailing:]}"


def _date_bounds(value_from: Optional[date], value_to: Optional[date]) -> tuple[Optional[str], Optional[str]]:
    if value_from and value_to and value_from > value_to:
        raise HTTPException(status_code=400, detail="The start date must be on or before the end date.")
    start = datetime.combine(value_from, time.min, tzinfo=timezone.utc).isoformat() if value_from else None
    end = datetime.combine(value_to, time.max, tzinfo=timezone.utc).isoformat() if value_to else None
    return start, end


def _page_payload(items: list[dict[str, Any]], *, page: int, page_size: int, total: int) -> dict[str, Any]:
    return {
        "items": items,
        "page": page,
        "page_size": page_size,
        "total": total,
        "pages": max(1, ceil(total / page_size)) if page_size else 1,
    }


def _user_attr(user: Any, key: str, default: Any = None) -> Any:
    if isinstance(user, dict):
        return user.get(key, default)
    return getattr(user, key, default)


def _identity_from_auth_user(user: Any, fallback_user_id: str) -> dict[str, str]:
    user_id = str(_user_attr(user, "id", fallback_user_id) or fallback_user_id)
    email = str(_user_attr(user, "email", "") or "").strip()
    metadata = _user_attr(user, "user_metadata", {}) or {}
    if not isinstance(metadata, dict):
        metadata = {}
    full_name = " ".join(str(metadata.get("full_name") or metadata.get("name") or "").split())[:120]
    masked_email = affiliate_service.mask_email(email) if email else "PodPilot user"
    return {
        "display_name": full_name or masked_email,
        "masked_email": masked_email,
        "safe_user_id": _mask_identifier(user_id, leading=6, trailing=4),
    }


def _identity_for_user(user_id: str, cache: Optional[dict[str, dict[str, str]]] = None) -> dict[str, str]:
    clean_id = str(user_id or "")
    if cache is not None and clean_id in cache:
        return cache[clean_id]
    try:
        result = _client().auth.admin.get_user_by_id(clean_id)
        user = getattr(result, "user", None) or result
        identity = _identity_from_auth_user(user, clean_id)
    except Exception:
        identity = {
            "display_name": f"Affiliate {_mask_identifier(clean_id, leading=6, trailing=4)}",
            "masked_email": "PodPilot user",
            "safe_user_id": _mask_identifier(clean_id, leading=6, trailing=4),
        }
    if cache is not None:
        cache[clean_id] = identity
    return identity


def _auth_directory() -> dict[str, dict[str, str]]:
    """Build a server-side identity directory for masked email/name search."""
    directory: dict[str, dict[str, str]] = {}
    try:
        for page in range(1, 11):
            result = _client().auth.admin.list_users(page=page, per_page=1000)
            users = result if isinstance(result, list) else getattr(result, "users", [])
            users = list(users or [])
            for user in users:
                user_id = str(_user_attr(user, "id", "") or "")
                if user_id:
                    directory[user_id] = _identity_from_auth_user(user, user_id)
            if len(users) < 1000:
                break
    except Exception:
        return directory
    return directory


def _safe_payout_method(account_or_snapshot: Any) -> dict[str, Any]:
    value = account_or_snapshot
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except (TypeError, ValueError, json.JSONDecodeError):
            value = {}
    if not isinstance(value, dict):
        value = {}
    method = str(value.get("method") or value.get("payout_method") or "").strip().lower()
    email = value.get("email") or value.get("payout_email")
    account_name = value.get("account_name")
    iban = value.get("iban")
    swift = value.get("swift_code")
    if method == "paypal":
        masked_email = affiliate_service.mask_email(email) if email else None
        return {"method": "paypal", "label": "PayPal", "summary": masked_email or "Not provided", "paypal_email": masked_email}
    if method == "bank_transfer":
        masked_iban = affiliate_service.mask_secret(iban, visible=4)
        masked_swift = affiliate_service.mask_secret(swift, visible=3)
        masked_name = affiliate_service.mask_secret(account_name, visible=2)
        return {
            "method": "bank_transfer",
            "label": "Bank transfer",
            "summary": masked_iban or "Not provided",
            "account_name": masked_name,
            "iban": masked_iban,
            "swift_code": masked_swift,
        }
    return {"method": None, "label": "Not configured", "summary": "No payout method"}


def _account_payout_method(account: dict[str, Any]) -> dict[str, Any]:
    return _safe_payout_method({
        "payout_method": account.get("payout_method"),
        "payout_email": account.get("payout_email"),
        "account_name": account.get("account_name"),
        "iban": account.get("iban"),
        "swift_code": account.get("swift_code"),
    })


def _related(table: str, columns: str, affiliate_ids: list[str]) -> list[dict[str, Any]]:
    if not affiliate_ids:
        return []
    return _rows(_client().table(table).select(columns).in_("affiliate_id", affiliate_ids).execute())


def _metrics_by_affiliate(affiliate_ids: list[str]) -> dict[str, dict[str, Any]]:
    metrics: dict[str, dict[str, Any]] = {
        affiliate_id: {
            "clicks": 0,
            "signups": 0,
            "paid_users": set(),
            "pending": 0.0,
            "available_gross": 0.0,
            "total_earned": 0.0,
            "reserved": 0.0,
            "total_paid": 0.0,
            "adjustments": 0.0,
        }
        for affiliate_id in affiliate_ids
    }
    for row in _related("affiliate_clicks", "affiliate_id", affiliate_ids):
        if row.get("affiliate_id") in metrics:
            metrics[row["affiliate_id"]]["clicks"] += 1
    for row in _related("affiliate_referrals", "affiliate_id,referred_user_id", affiliate_ids):
        if row.get("affiliate_id") in metrics:
            metrics[row["affiliate_id"]]["signups"] += 1
    for row in _related("affiliate_commissions", "affiliate_id,referred_user_id,commission_amount,status", affiliate_ids):
        affiliate_id = row.get("affiliate_id")
        if affiliate_id not in metrics:
            continue
        status = str(row.get("status") or "")
        amount = _money(row.get("commission_amount"))
        if status == "pending":
            metrics[affiliate_id]["pending"] += amount
        elif status == "available":
            metrics[affiliate_id]["available_gross"] += amount
        if status != "reversed":
            metrics[affiliate_id]["total_earned"] += amount
            if row.get("referred_user_id"):
                metrics[affiliate_id]["paid_users"].add(row["referred_user_id"])
    for row in _related("affiliate_payout_requests", "affiliate_id,amount,status", affiliate_ids):
        affiliate_id = row.get("affiliate_id")
        if affiliate_id not in metrics:
            continue
        amount = _money(row.get("amount"))
        if row.get("status") in {"requested", "approved"}:
            metrics[affiliate_id]["reserved"] += amount
        elif row.get("status") == "paid":
            metrics[affiliate_id]["total_paid"] += amount
    for row in _related("affiliate_balance_adjustments", "affiliate_id,amount", affiliate_ids):
        if row.get("affiliate_id") in metrics:
            metrics[row["affiliate_id"]]["adjustments"] += _money(row.get("amount"))
    return metrics


def _public_metrics(raw: dict[str, Any]) -> dict[str, Any]:
    available = max(raw["available_gross"] + raw["adjustments"] - raw["reserved"], 0)
    clicks = int(raw["clicks"])
    signups = int(raw["signups"])
    return {
        "clicks": clicks,
        "signups": signups,
        "paid_customers": len(raw["paid_users"]),
        "conversion_rate": round((signups / clicks * 100) if clicks else 0, 1),
        "pending_balance": round(raw["pending"], 2),
        "available_balance": round(available, 2),
        "reserved_balance": round(raw["reserved"], 2),
        "total_earned": round(raw["total_earned"], 2),
        "total_paid": round(raw["total_paid"], 2),
    }


def _safe_account(account: dict[str, Any], raw_metrics: dict[str, Any], identities: dict[str, dict[str, str]]) -> dict[str, Any]:
    identity = _identity_for_user(str(account.get("user_id") or ""), identities)
    code = str(account.get("referral_code") or "")
    return {
        "id": account.get("id"),
        **identity,
        "referral_code": code,
        "referral_url": affiliate_service.AFFILIATE_URL.format(code=code),
        "joined_at": account.get("created_at"),
        "updated_at": account.get("updated_at"),
        "status": account.get("status"),
        "payout_method": _account_payout_method(account),
        **_public_metrics(raw_metrics),
    }


def overview() -> dict[str, Any]:
    _client().rpc("affiliate_release_commissions", {"p_affiliate_id": None}).execute()
    accounts = _rows(_client().table("affiliate_accounts").select("id,status").execute())
    clicks = _rows(_client().table("affiliate_clicks").select("id").execute())
    referrals = _rows(_client().table("affiliate_referrals").select("id,referred_user_id").execute())
    commissions = _rows(
        _client().table("affiliate_commissions")
        .select("referred_user_id,commission_amount,status").execute()
    )
    payouts = _rows(_client().table("affiliate_payout_requests").select("amount,status").execute())
    commission_totals = {status: 0.0 for status in ALLOWED_COMMISSION_STATUSES}
    paid_users: set[str] = set()
    for row in commissions:
        status = str(row.get("status") or "")
        if status in commission_totals:
            commission_totals[status] += _money(row.get("commission_amount"))
        if status != "reversed" and row.get("referred_user_id"):
            paid_users.add(str(row["referred_user_id"]))
    outstanding = [row for row in payouts if row.get("status") in {"requested", "approved"}]
    return {
        "total_affiliates": len(accounts),
        "active_affiliates": sum(1 for row in accounts if row.get("status") == "active"),
        "total_clicks": len(clicks),
        "total_signups": len(referrals),
        "total_paid_referrals": len(paid_users),
        "commissions": {key: round(value, 2) for key, value in commission_totals.items()},
        "outstanding_payout_requests": len(outstanding),
        "outstanding_payout_amount": round(sum(_money(row.get("amount")) for row in outstanding), 2),
        "currency": "USD",
    }


def list_accounts(
    *, page: int, page_size: int, search: Optional[str] = None, status: Optional[str] = None,
    date_from: Optional[date] = None, date_to: Optional[date] = None,
) -> dict[str, Any]:
    if status and status not in ALLOWED_ACCOUNT_STATUSES:
        raise HTTPException(status_code=400, detail="Invalid affiliate status filter.")
    start, end = _date_bounds(date_from, date_to)
    query = _client().table("affiliate_accounts").select("*", count="exact")
    if status:
        query = query.eq("status", status)
    if start:
        query = query.gte("created_at", start)
    if end:
        query = query.lte("created_at", end)
    term = " ".join(str(search or "").strip().split()).lower()[:120]
    identities: dict[str, dict[str, str]] = _auth_directory() if term else {}
    if term:
        accounts = _rows(query.order("created_at", desc=True).execute())
        filtered = []
        for account in accounts:
            identity = identities.get(str(account.get("user_id") or "")) or _identity_for_user(str(account.get("user_id") or ""), identities)
            haystack = " ".join((str(account.get("referral_code") or ""), identity["display_name"], identity["masked_email"])).lower()
            if term in haystack:
                filtered.append(account)
        total = len(filtered)
        accounts = filtered[(page - 1) * page_size: page * page_size]
    else:
        response = query.order("created_at", desc=True).range((page - 1) * page_size, page * page_size - 1).execute()
        accounts = _rows(response)
        count = getattr(response, "count", None)
        total = int(count) if isinstance(count, int) else len(accounts)
    affiliate_ids = [str(row.get("id")) for row in accounts if row.get("id")]
    metrics = _metrics_by_affiliate(affiliate_ids)
    items = [_safe_account(row, metrics[str(row["id"])], identities) for row in accounts if str(row.get("id")) in metrics]
    return _page_payload(items, page=page, page_size=page_size, total=total)


def _account_lookup(affiliate_ids: list[str]) -> dict[str, dict[str, Any]]:
    if not affiliate_ids:
        return {}
    rows = _rows(
        _client().table("affiliate_accounts")
        .select("id,user_id,referral_code,status,created_at,payout_method,payout_email,account_name,iban,swift_code")
        .in_("id", affiliate_ids).execute()
    )
    return {str(row["id"]): row for row in rows if row.get("id")}


def _safe_commission(row: dict[str, Any], accounts: dict[str, dict[str, Any]], identities: dict[str, dict[str, str]]) -> dict[str, Any]:
    account = accounts.get(str(row.get("affiliate_id") or ""), {})
    identity = _identity_for_user(str(account.get("user_id") or ""), identities)
    return {
        "id": row.get("id"),
        "created_at": row.get("created_at"),
        "affiliate_id": row.get("affiliate_id"),
        "affiliate": identity["display_name"],
        "referral_code": account.get("referral_code"),
        "referred_customer": affiliate_service._customer_label(str(row.get("referred_user_id") or "")),
        "plan": row.get("plan"),
        "transaction_type": row.get("transaction_type"),
        "paddle_transaction_id": _mask_identifier(row.get("paddle_transaction_id")),
        "gross_amount": _money(row.get("gross_amount")),
        "commission_amount": _money(row.get("commission_amount")),
        "currency": row.get("currency") or "USD",
        "status": row.get("status"),
        "hold_until": row.get("hold_until"),
        "reversed_at": row.get("reversed_at"),
        "reversal_reason": row.get("reversal_reason"),
    }


def list_commissions(
    *, page: int, page_size: int, status: Optional[str] = None, affiliate_id: Optional[str] = None,
    plan: Optional[str] = None, transaction_type: Optional[str] = None, search: Optional[str] = None,
    date_from: Optional[date] = None, date_to: Optional[date] = None,
) -> dict[str, Any]:
    if status and status not in ALLOWED_COMMISSION_STATUSES:
        raise HTTPException(status_code=400, detail="Invalid commission status filter.")
    if plan and plan not in ALLOWED_PLANS:
        raise HTTPException(status_code=400, detail="Invalid plan filter.")
    if transaction_type and transaction_type not in ALLOWED_TRANSACTION_TYPES:
        raise HTTPException(status_code=400, detail="Invalid transaction type filter.")
    start, end = _date_bounds(date_from, date_to)
    query = _client().table("affiliate_commissions").select("*", count="exact")
    for column, value in (("status", status), ("affiliate_id", affiliate_id), ("plan", plan), ("transaction_type", transaction_type)):
        if value:
            query = query.eq(column, value)
    if start:
        query = query.gte("created_at", start)
    if end:
        query = query.lte("created_at", end)
    term = " ".join(str(search or "").strip().split()).lower()[:120]
    if term:
        rows = _rows(query.order("created_at", desc=True).execute())
    else:
        response = query.order("created_at", desc=True).range((page - 1) * page_size, page * page_size - 1).execute()
        rows = _rows(response)
    account_ids = list({str(row.get("affiliate_id")) for row in rows if row.get("affiliate_id")})
    accounts = _account_lookup(account_ids)
    identities: dict[str, dict[str, str]] = {}
    safe_rows = [_safe_commission(row, accounts, identities) for row in rows]
    if term:
        safe_rows = [row for row in safe_rows if term in " ".join((str(row.get("affiliate") or ""), str(row.get("referral_code") or ""))).lower()]
        total = len(safe_rows)
        safe_rows = safe_rows[(page - 1) * page_size: page * page_size]
    else:
        count = getattr(response, "count", None)
        total = int(count) if isinstance(count, int) else len(safe_rows)
    return _page_payload(safe_rows, page=page, page_size=page_size, total=total)


def _safe_payout(row: dict[str, Any], accounts: dict[str, dict[str, Any]], identities: dict[str, dict[str, str]], metrics: dict[str, dict[str, Any]]) -> dict[str, Any]:
    affiliate_id = str(row.get("affiliate_id") or "")
    account = accounts.get(affiliate_id, {})
    identity = _identity_for_user(str(account.get("user_id") or ""), identities)
    public_metrics = _public_metrics(metrics[affiliate_id]) if affiliate_id in metrics else {"available_balance": 0.0}
    return {
        "id": row.get("id"),
        "affiliate_id": affiliate_id,
        "affiliate": identity["display_name"],
        "referral_code": account.get("referral_code"),
        "amount": _money(row.get("amount")),
        "currency": row.get("currency") or "USD",
        "status": row.get("status"),
        "payout_method": _safe_payout_method(row.get("payout_method_snapshot")),
        "available_balance": public_metrics.get("available_balance", 0.0),
        "requested_at": row.get("requested_at"),
        "reviewed_at": row.get("reviewed_at"),
        "paid_at": row.get("paid_at"),
        "admin_note": row.get("admin_note"),
    }


def list_payouts(
    *, page: int, page_size: int, status: Optional[str] = None, affiliate_id: Optional[str] = None,
    search: Optional[str] = None, date_from: Optional[date] = None, date_to: Optional[date] = None,
) -> dict[str, Any]:
    if status and status not in ALLOWED_PAYOUT_STATUSES:
        raise HTTPException(status_code=400, detail="Invalid payout status filter.")
    start, end = _date_bounds(date_from, date_to)
    query = _client().table("affiliate_payout_requests").select("*", count="exact")
    if status:
        query = query.eq("status", status)
    if affiliate_id:
        query = query.eq("affiliate_id", affiliate_id)
    if start:
        query = query.gte("requested_at", start)
    if end:
        query = query.lte("requested_at", end)
    term = " ".join(str(search or "").strip().split()).lower()[:120]
    if term:
        rows = _rows(query.order("requested_at", desc=True).execute())
    else:
        response = query.order("requested_at", desc=True).range((page - 1) * page_size, page * page_size - 1).execute()
        rows = _rows(response)
    account_ids = list({str(row.get("affiliate_id")) for row in rows if row.get("affiliate_id")})
    accounts = _account_lookup(account_ids)
    identities: dict[str, dict[str, str]] = {}
    metrics = _metrics_by_affiliate(account_ids)
    safe_rows = [_safe_payout(row, accounts, identities, metrics) for row in rows]
    if term:
        safe_rows = [row for row in safe_rows if term in " ".join((str(row.get("affiliate") or ""), str(row.get("referral_code") or ""))).lower()]
        total = len(safe_rows)
        safe_rows = safe_rows[(page - 1) * page_size: page * page_size]
    else:
        count = getattr(response, "count", None)
        total = int(count) if isinstance(count, int) else len(safe_rows)
    return _page_payload(safe_rows, page=page, page_size=page_size, total=total)


def _safe_audit(row: dict[str, Any]) -> dict[str, Any]:
    allowed_state_keys = {"status", "amount", "currency"}
    previous = row.get("previous_state") if isinstance(row.get("previous_state"), dict) else {}
    current = row.get("new_state") if isinstance(row.get("new_state"), dict) else {}
    return {
        "id": row.get("id"),
        "action": row.get("action"),
        "target_type": row.get("target_type"),
        "target_id": _mask_identifier(row.get("target_id"), leading=6, trailing=4),
        "admin_user": _mask_identifier(row.get("admin_user_id"), leading=6, trailing=4),
        "previous_state": {key: previous.get(key) for key in allowed_state_keys if key in previous},
        "new_state": {key: current.get(key) for key in allowed_state_keys if key in current},
        "note": row.get("note"),
        "created_at": row.get("created_at"),
    }


def account_detail(affiliate_id: str) -> dict[str, Any]:
    account = _one(_client().table("affiliate_accounts").select("*").eq("id", affiliate_id).limit(1).execute())
    if not account:
        raise HTTPException(status_code=404, detail="Affiliate account not found.")
    metrics = _metrics_by_affiliate([affiliate_id])
    identities: dict[str, dict[str, str]] = {}
    commissions = _rows(
        _client().table("affiliate_commissions").select("*")
        .eq("affiliate_id", affiliate_id).order("created_at", desc=True).limit(100).execute()
    )
    referrals = _rows(
        _client().table("affiliate_referrals").select("id,referred_user_id,referral_code,attributed_at,attribution_source")
        .eq("affiliate_id", affiliate_id).order("attributed_at", desc=True).limit(100).execute()
    )
    clicks = _rows(
        _client().table("affiliate_clicks").select("id,landing_path,referrer_origin,created_at")
        .eq("affiliate_id", affiliate_id).order("created_at", desc=True).limit(100).execute()
    )
    payouts = _rows(
        _client().table("affiliate_payout_requests").select("*")
        .eq("affiliate_id", affiliate_id).order("requested_at", desc=True).limit(100).execute()
    )
    audit_target_ids = [affiliate_id, *[str(row["id"]) for row in payouts if row.get("id")]]
    audits = _rows(
        _client().table("affiliate_admin_audit_logs")
        .select("id,admin_user_id,action,target_type,target_id,previous_state,new_state,note,created_at")
        .in_("target_id", audit_target_ids).order("created_at", desc=True).limit(100).execute()
    )
    accounts = {affiliate_id: account}
    safe_commissions = [_safe_commission(row, accounts, identities) for row in commissions]
    paid_users = {row.get("referred_user_id") for row in commissions if row.get("status") != "reversed"}
    return {
        "account": _safe_account(account, metrics[affiliate_id], identities),
        "commissions": safe_commissions,
        "referrals": [{
            "id": row.get("id"),
            "customer": affiliate_service._customer_label(str(row.get("referred_user_id") or "")),
            "attributed_at": row.get("attributed_at"),
            "attribution_source": row.get("attribution_source"),
            "has_paid": row.get("referred_user_id") in paid_users,
        } for row in referrals],
        "clicks": clicks,
        "payouts": [_safe_payout(row, accounts, identities, metrics) for row in payouts],
        "audit_events": [_safe_audit(row) for row in audits],
    }


def activity() -> dict[str, Any]:
    accounts = _rows(_client().table("affiliate_accounts").select("id,user_id,referral_code").execute())
    account_map = {str(row["id"]): row for row in accounts if row.get("id")}
    identities: dict[str, dict[str, str]] = {}
    recent_clicks = _rows(
        _client().table("affiliate_clicks").select("id,affiliate_id,landing_path,referrer_origin,created_at")
        .order("created_at", desc=True).limit(20).execute()
    )
    recent_signups = _rows(
        _client().table("affiliate_referrals").select("id,affiliate_id,referred_user_id,attributed_at")
        .order("attributed_at", desc=True).limit(20).execute()
    )
    recent_paid = _rows(
        _client().table("affiliate_commissions").select("id,affiliate_id,referred_user_id,commission_amount,created_at,status")
        .neq("status", "reversed").order("created_at", desc=True).limit(20).execute()
    )
    affiliate_ids = list(account_map)
    metrics = _metrics_by_affiliate(affiliate_ids)

    def affiliate_label(affiliate_id: Any) -> dict[str, Any]:
        account = account_map.get(str(affiliate_id or ""), {})
        identity = _identity_for_user(str(account.get("user_id") or ""), identities)
        return {"affiliate": identity["display_name"], "referral_code": account.get("referral_code")}

    rankings = []
    for affiliate_id, account in account_map.items():
        identity = _identity_for_user(str(account.get("user_id") or ""), identities)
        public = _public_metrics(metrics[affiliate_id])
        rankings.append({
            "affiliate_id": affiliate_id,
            "affiliate": identity["display_name"],
            "referral_code": account.get("referral_code"),
            "paid_customers": public["paid_customers"],
            "total_earned": public["total_earned"],
        })
    return {
        "recent_clicks": [{**row, **affiliate_label(row.get("affiliate_id"))} for row in recent_clicks],
        "recent_signups": [{
            "id": row.get("id"),
            "attributed_at": row.get("attributed_at"),
            "customer": affiliate_service._customer_label(str(row.get("referred_user_id") or "")),
            **affiliate_label(row.get("affiliate_id")),
        } for row in recent_signups],
        "recent_paid_referrals": [{
            "id": row.get("id"),
            "created_at": row.get("created_at"),
            "customer": affiliate_service._customer_label(str(row.get("referred_user_id") or "")),
            "commission_amount": _money(row.get("commission_amount")),
            **affiliate_label(row.get("affiliate_id")),
        } for row in recent_paid],
        "top_by_paid_customers": sorted(rankings, key=lambda row: (-row["paid_customers"], -row["total_earned"]))[:8],
        "top_by_earnings": sorted(rankings, key=lambda row: (-row["total_earned"], -row["paid_customers"]))[:8],
    }


def set_account_status(affiliate_id: str, admin_user_id: str, status: str, note: Optional[str]) -> dict[str, Any]:
    clean_status = str(status or "").strip().lower()
    if clean_status not in ALLOWED_ACCOUNT_STATUSES:
        raise HTTPException(status_code=400, detail="Invalid affiliate status.")
    try:
        result = _one(_client().rpc("affiliate_set_account_status", {
            "p_affiliate_id": affiliate_id,
            "p_admin_user_id": admin_user_id,
            "p_status": clean_status,
            "p_note": str(note or "").strip()[:1000] or None,
        }).execute())
    except Exception as error:
        message = str(error)
        if "AFFILIATE_NOT_FOUND" in message:
            raise HTTPException(status_code=404, detail="Affiliate account not found.") from error
        if "INVALID_AFFILIATE_STATUS_TRANSITION" in message:
            raise HTTPException(status_code=409, detail="Affiliate is already in that status.") from error
        if "INVALID_AFFILIATE_STATUS" in message:
            raise HTTPException(status_code=400, detail="Invalid affiliate status.") from error
        raise
    if not result:
        raise HTTPException(status_code=404, detail="Affiliate account not found.")
    return {"id": result.get("id"), "status": result.get("status"), "updated_at": result.get("updated_at")}


def review_payout(request_id: str, admin_user_id: str, status: str, note: Optional[str]) -> dict[str, Any]:
    clean_status = str(status or "").strip().lower()
    clean_note = str(note or "").strip()[:1000] or None
    if clean_status not in {"approved", "paid", "rejected"}:
        raise HTTPException(status_code=400, detail="Invalid payout status.")
    if clean_status == "rejected" and not clean_note:
        raise HTTPException(status_code=400, detail="An admin note is required when rejecting a payout.")
    try:
        result = _one(_client().rpc("affiliate_review_payout", {
            "p_request_id": request_id,
            "p_admin_user_id": admin_user_id,
            "p_status": clean_status,
            "p_note": clean_note,
        }).execute())
    except Exception as error:
        message = str(error)
        if "PAYOUT_NOT_FOUND" in message:
            raise HTTPException(status_code=404, detail="Payout request not found.") from error
        if "INVALID_PAYOUT_TRANSITION" in message:
            raise HTTPException(status_code=409, detail="Invalid payout status transition.") from error
        if "ADMIN_NOTE_REQUIRED" in message:
            raise HTTPException(status_code=400, detail="An admin note is required when rejecting a payout.") from error
        raise
    if not result:
        raise HTTPException(status_code=404, detail="Payout request not found.")
    safe = dict(result)
    safe["payout_method"] = _safe_payout_method(safe.pop("payout_method_snapshot", None))
    return safe
