"""Subscription and upload-usage access control.

The backend is the source of truth for whether a user may start or continue
uploading. This module uses the Supabase service-role client and always scopes
reads/writes by the authenticated user_id provided by app.core.auth.
"""
from __future__ import annotations

import hashlib
import hmac
import ipaddress
import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from fastapi import HTTPException

from app.core import config
from app.services import supabase_service
from app.services.logging_utils import error_type as safe_error_type, request_id, short_user_id


logger = logging.getLogger("podpilot.billing")

SUBSCRIPTION_TABLE = "subscriptions"
UPLOAD_USAGE_TABLE = "upload_usage"
TRIAL_USAGE_TABLE = "trial_usage"
CHECKOUT_INTENT_TABLE = "paddle_checkout_intents"

ACTIVE_UPLOAD_STATUSES = {"trialing", "active"}
CANCELED_STATUS = "canceled"
LOCKED_SUBSCRIPTION_STATUSES = {"canceled", "cancelled", "paused", "past_due", "deleted", "inactive"}

PAST_DUE_WARNING_MESSAGE = (
    "Payment failed. Please update your payment method to avoid losing access."
)
PAST_DUE_LOCKED_MESSAGE = (
    "Your subscription is past due. Update your payment method to continue using PodPilot."
)

PLAN_LIMITS = {
    "redbubble": None,
    "teepublic": None,
    "all_platforms": None,
}

DAILY_AI_TOKENS = {
    "redbubble": 30,
    "teepublic": 30,
    "all_platforms": 75,
}

PLATFORM_ACCESS_BY_PLAN = {
    "redbubble": {"redbubble": True, "teepublic": False},
    "teepublic": {"redbubble": False, "teepublic": True},
    "all_platforms": {"redbubble": True, "teepublic": True},
}

PLAN_LABELS = {
    "redbubble": "Redbubble Plan",
    "teepublic": "TeePublic Plan",
    "all_platforms": "All Platforms Plan",
}

# Public catalog amounts used only to describe a subscription whose Paddle
# price id has already been persisted by the webhook. Paddle remains the
# authority for charging; this mapping never creates or changes a checkout.
LEGACY_PLAN_BILLING_CATALOG = {
    ("redbubble", "monthly"): {"amount": 4.99, "monthly_equivalent": 4.99},
    ("redbubble", "annual"): {"amount": 49.90, "monthly_equivalent": 4.16},
    ("teepublic", "monthly"): {"amount": 4.99, "monthly_equivalent": 4.99},
    ("teepublic", "annual"): {"amount": 49.90, "monthly_equivalent": 4.16},
    ("all_platforms", "monthly"): {"amount": 6.99, "monthly_equivalent": 6.99},
    ("all_platforms", "annual"): {"amount": 69.90, "monthly_equivalent": 5.83},
}

RELAUNCH_PLAN_BILLING_CATALOG = {
    ("redbubble", "monthly"): {"amount": 8.99, "monthly_equivalent": 8.99},
    ("redbubble", "annual"): {"amount": 89.90, "monthly_equivalent": 89.90 / 12},
    ("teepublic", "monthly"): {"amount": 8.99, "monthly_equivalent": 8.99},
    ("teepublic", "annual"): {"amount": 89.90, "monthly_equivalent": 89.90 / 12},
    ("all_platforms", "monthly"): {"amount": 10.99, "monthly_equivalent": 10.99},
    ("all_platforms", "annual"): {"amount": 109.90, "monthly_equivalent": 109.90 / 12},
}

SUBSCRIPTION_REQUIRED_DETAIL = "Subscription required. Choose a plan to use this feature."
PLATFORM_LOCKED_DETAIL = "This platform is locked for your current plan. Please upgrade."
TRIAL_ALREADY_USED_DETAIL = "Free trial already used. Please choose a paid plan to continue."
AI_TOKENS_EXHAUSTED_CODE = "AI_TOKENS_EXHAUSTED"
AI_TOKENS_EXHAUSTED_MESSAGE = "You're out of AI tokens."

TRIAL_ELIGIBLE = "eligible"
TRIAL_ALREADY_USED = "trial_already_used"
DEVICE_TRIAL_USED = "device_trial_used"
DEVICE_OR_NETWORK_TRIAL_USED = DEVICE_TRIAL_USED  # Backwards-compatible import alias.
ADMIN_TRIAL_OVERRIDE = "admin_override"
ACTIVE_SUBSCRIPTION_EXISTS = "active_subscription_exists"
SUBSCRIPTION_HISTORY_EXISTS = "subscription_history_exists"
COMPLETED_TRANSACTION_EXISTS = "completed_transaction_exists"
CHECKOUT_INTENT_REUSE_MINUTES = 10


def normalize_plan(plan: Optional[str]) -> str:
    value = str(plan or "").strip().lower()
    if value in {"all-platforms", "all_platforms"}:
        return "all_platforms"
    if value.endswith("_paid"):
        return normalize_plan(value[:-5])
    if value.endswith("_annual"):
        return normalize_plan(value[:-7])
    return value


def get_current_month_key() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m")


def get_plan_limit(plan: str) -> Optional[int]:
    return PLAN_LIMITS.get(normalize_plan(plan))


def _money_display(amount: float) -> str:
    return f"${amount:,.2f}"


def get_subscription_billing_details(subscription: dict[str, Any]) -> dict[str, Any]:
    """Return display-safe billing metadata derived from a persisted row."""
    plan = normalize_plan(subscription.get("plan"))
    paddle_price_id = _as_iso(subscription.get("paddle_price_id")) or ""
    mapped_plan = config.paddle_plan_for_price_id(paddle_price_id)
    if mapped_plan in PLAN_LIMITS:
        plan = mapped_plan

    billing_cycle = config.paddle_billing_cycle_for_price_id(paddle_price_id)
    if not billing_cycle:
        stored_cycle = str(subscription.get("billing_cycle") or "").strip().lower()
        if stored_cycle in {"monthly", "annual"}:
            billing_cycle = stored_cycle

    current_price_ids = {
        ("redbubble", "monthly"): config.PADDLE_REDBUBBLE_MONTHLY_PRICE_ID,
        ("redbubble", "annual"): config.PADDLE_REDBUBBLE_ANNUAL_PRICE_ID,
        ("teepublic", "monthly"): config.PADDLE_TEEPUBLIC_MONTHLY_PRICE_ID,
        ("teepublic", "annual"): config.PADDLE_TEEPUBLIC_ANNUAL_PRICE_ID,
        ("all_platforms", "monthly"): config.PADDLE_ALL_PLATFORMS_MONTHLY_PRICE_ID,
        ("all_platforms", "annual"): config.PADDLE_ALL_PLATFORMS_ANNUAL_PRICE_ID,
    }
    key = (plan, billing_cycle)
    if paddle_price_id and paddle_price_id == current_price_ids.get(key):
        catalog = RELAUNCH_PLAN_BILLING_CATALOG.get(key)
    elif paddle_price_id and paddle_price_id in {
        config.LEGACY_SUBSCRIPTION_PRICES.get(key),
        config.PADDLE_REDBUBBLE_MONTHLY_TRIAL_PRICE_ID,
        config.PADDLE_TEEPUBLIC_MONTHLY_TRIAL_PRICE_ID,
        config.PADDLE_ALL_PLATFORMS_MONTHLY_TRIAL_PRICE_ID,
        config.PADDLE_REDBUBBLE_ANNUAL_TRIAL_PRICE_ID,
        config.PADDLE_TEEPUBLIC_ANNUAL_TRIAL_PRICE_ID,
        config.PADDLE_ALL_PLATFORMS_ANNUAL_TRIAL_PRICE_ID,
    }:
        catalog = LEGACY_PLAN_BILLING_CATALOG.get(key)
    else:
        # An unmapped historical ID must not be displayed at today's list price.
        catalog = None
    details: dict[str, Any] = {
        "plan": plan or None,
        "plan_label": PLAN_LABELS.get(plan, "Pending plan details"),
        "billing_cycle": billing_cycle or None,
        "paddle_price_id": paddle_price_id or None,
        "currency": "USD" if catalog else None,
        "price": catalog["amount"] if catalog else None,
        "price_display": None,
        "monthly_equivalent_display": None,
    }
    if catalog:
        amount = float(catalog["amount"])
        monthly_equivalent = float(catalog["monthly_equivalent"])
        details["price_display"] = (
            f"{_money_display(amount)} annually"
            if billing_cycle == "annual"
            else f"{_money_display(amount)} / month"
        )
        details["monthly_equivalent_display"] = f"{_money_display(monthly_equivalent)} / month"
    return details


def _raise_supabase_error(action: str, error: Exception) -> None:
    raise HTTPException(
        status_code=500,
        detail=f"Supabase query failed while {action}.",
    ) from error


def _raise_ai_tokens_exhausted(
    *,
    message: str = AI_TOKENS_EXHAUSTED_MESSAGE,
    available_credits: int = 0,
    required_credits: int = 1,
) -> None:
    raise HTTPException(
        status_code=402,
        detail={
            "code": AI_TOKENS_EXHAUSTED_CODE,
            "message": AI_TOKENS_EXHAUSTED_MESSAGE,
            "reason": message,
            "available_credits": max(0, int(available_credits or 0)),
            "required_credits": max(1, int(required_credits or 1)),
        },
    )


def _log_optional_read_fallback(action: str, error: Exception, *, user_id: Optional[str] = None) -> None:
    logger.warning(
        "[BillingFallback] request_id=%s operation=%s user_present=%s user=%s error_type=%s code=%s message=%s",
        request_id(),
        action,
        bool(user_id),
        short_user_id(user_id),
        safe_error_type(error),
        _supabase_error_code(error),
        _safe_error_message(error),
    )


def _supabase_error_code(error: Exception) -> str:
    for name in ("code", "error_code"):
        value = getattr(error, name, None)
        if value:
            return str(value)
    payload = getattr(error, "args", None)
    if payload and isinstance(payload[0], dict):
        value = payload[0].get("code")
        if value:
            return str(value)
    return "unknown"


def _safe_error_message(error: Exception) -> str:
    for name in ("message", "details"):
        value = getattr(error, name, None)
        if value:
            return str(value).replace("\n", " ")[:240]
    payload = getattr(error, "args", None)
    if payload and isinstance(payload[0], dict):
        for key in ("message", "details", "hint"):
            value = payload[0].get(key)
            if value:
                return str(value).replace("\n", " ")[:240]
    return str(error).replace("\n", " ")[:240]


def _log_checkout_intent_error(action: str, error: Exception, *, user_id: Optional[str] = None) -> None:
    logger.error(
        "[CheckoutIntent] table=%s operation=%s user_present=%s user=%s error_type=%s code=%s message=%s",
        CHECKOUT_INTENT_TABLE,
        action,
        bool(user_id),
        short_user_id(user_id),
        safe_error_type(error),
        _supabase_error_code(error),
        _safe_error_message(error),
    )


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _utc_now_iso() -> str:
    return _utc_now().isoformat()


def _parse_datetime(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None
    try:
        normalized = str(value).replace("Z", "+00:00")
        parsed = datetime.fromisoformat(normalized)
        if parsed.tzinfo is None:
            return parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc)
    except ValueError:
        logger.warning("[Billing] invalid timestamp from Supabase: %s", value)
        return None


def _table_missing(error: Exception, table: str) -> bool:
    message = str(error).lower()
    code = _supabase_error_code(error).lower()
    return (
        table in message
        and (
            "does not exist" in message
            or "42p01" in message
            or "undefined_table" in message
            or "could not find the table" in message
            or "pgrst205" in message
            or code in {"42p01", "pgrst205"}
        )
    )


def _column_missing(error: Exception) -> bool:
    message = str(error).lower()
    code = _supabase_error_code(error).lower()
    return (
        "column" in message
        and (
            "does not exist" in message
            or "undefined_column" in message
            or "pgrst204" in message
            or code in {"42703", "pgrst204"}
        )
    )


def _permission_denied(error: Exception) -> bool:
    message = str(error).lower()
    code = _supabase_error_code(error).lower()
    return (
        "permission denied" in message
        or "rls" in message
        or "row-level security" in message
        or code == "42501"
    )


def _raise_checkout_intents_missing(error: Exception, action: str) -> None:
    raise HTTPException(
        status_code=503,
        detail=(
            "The paddle_checkout_intents table is missing. Run "
            "docs/migration_paddle_checkout_intents.sql in Supabase first."
        ),
    ) from error


def _raise_checkout_intent_error(action: str, error: Exception, *, user_id: Optional[str] = None) -> None:
    _log_checkout_intent_error(action, error, user_id=user_id)
    if _table_missing(error, CHECKOUT_INTENT_TABLE):
        _raise_checkout_intents_missing(error, action)
    if _column_missing(error):
        raise HTTPException(
            status_code=503,
            detail=(
                "The paddle_checkout_intents table schema is missing a required column. "
                "Run docs/migration_paddle_checkout_intents.sql in Supabase first."
            ),
        ) from error
    if _permission_denied(error):
        raise HTTPException(
            status_code=503,
            detail=(
                "The backend cannot access paddle_checkout_intents. "
                "Check the Supabase service role key and RLS policies."
            ),
        ) from error
    raise HTTPException(
        status_code=500,
        detail=f"Supabase query failed while {action}.",
    ) from error


def _as_iso(value: Any) -> Optional[str]:
    return str(value) if value else None


def _is_recent_intent(row: dict[str, Any], *, now: Optional[datetime] = None) -> bool:
    created = _parse_datetime(_as_iso(row.get("created_at")))
    if created is None:
        return False
    return created >= (now or _utc_now()) - timedelta(minutes=CHECKOUT_INTENT_REUSE_MINUTES)


def _checkout_idempotency_key(
    *,
    intent_type: str,
    plan_key: Optional[str],
    billing_interval: Optional[str],
    credit_pack_id: Optional[str],
    selected_price_id: str,
    now: Optional[datetime] = None,
) -> str:
    window = CHECKOUT_INTENT_REUSE_MINUTES * 60
    stamp = int((now or _utc_now()).timestamp()) // window
    raw = "|".join([
        str(intent_type or "").strip().lower(),
        str(plan_key or "").strip().lower(),
        str(billing_interval or "").strip().lower(),
        str(credit_pack_id or "").strip().lower(),
        str(selected_price_id or "").strip(),
        str(stamp),
    ])
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _normalize_email(email: Optional[str]) -> str:
    return str(email or "").strip().lower()


def _normalize_signal(value: Optional[str]) -> str:
    return str(value or "").strip()


def _normalize_ip(ip_value: Optional[str]) -> str:
    value = _normalize_signal(ip_value)
    if not value:
        return ""
    try:
        return str(ipaddress.ip_address(value))
    except ValueError:
        logger.warning("[Billing] could not canonicalize request IP for trial check")
        return value


def _trial_hash(value: Optional[str]) -> Optional[str]:
    normalized = _normalize_signal(value)
    if not normalized:
        return None
    salt = _normalize_signal(config.TRIAL_HASH_SALT)
    if not salt:
        env = (config.PADDLE_ENVIRONMENT or "sandbox").lower()
        if env == "sandbox":
            logger.warning("[Billing] WARNING: TRIAL_HASH_SALT is missing in sandbox environment. Using development fallback salt.")
            salt = "podpilot_dev_fallback_salt_2026"
        else:
            raise RuntimeError("TRIAL_HASH_SALT is missing in production")
    return hmac.new(
        salt.encode("utf-8"),
        normalized.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()


def _trial_hashes(
    *,
    email: Optional[str],
    device_id: Optional[str],
    ip_address: Optional[str],
    user_agent: Optional[str],
) -> dict[str, Optional[str]]:
    return {
        "email_hash": _trial_hash(_normalize_email(email)),
        "device_id_hash": _trial_hash(device_id),
        "ip_hash": _trial_hash(_normalize_ip(ip_address)),
        "user_agent_hash": _trial_hash(user_agent),
    }


def _trial_usage_table_missing(error: Exception) -> bool:
    message = str(error).lower()
    return (
        TRIAL_USAGE_TABLE in message
        and (
            "does not exist" in message
            or "42p01" in message
            or "undefined_table" in message
            or "could not find the table" in message
            or "pgrst205" in message
        )
    )



def _raise_trial_usage_missing(error: Exception) -> None:
    raise HTTPException(
        status_code=503,
        detail=(
            "The trial_usage table is missing. Run "
            "docs/migration_trial_usage.sql in Supabase first."
        ),
    ) from error


def _response_data_rows(response: Any, *, operation: str) -> list[dict[str, Any]]:
    response_type = type(response).__name__
    try:
        data = response.get("data") if isinstance(response, dict) else getattr(response, "data", None)
    except Exception as error:
        logger.warning(
            "[TrialUsageRead] operation=%s response_type=%s data_length=unknown exception_source=response_shape error_type=%s",
            operation,
            response_type,
            safe_error_type(error),
        )
        return []

    if data is None:
        logger.info(
            "[TrialUsageRead] operation=%s response_type=%s data_length=0",
            operation,
            response_type,
        )
        return []
    if isinstance(data, list):
        rows = [dict(row) for row in data if isinstance(row, dict)]
        logger.info(
            "[TrialUsageRead] operation=%s response_type=%s data_length=%s",
            operation,
            response_type,
            len(rows),
        )
        return rows
    if isinstance(data, dict):
        logger.info(
            "[TrialUsageRead] operation=%s response_type=%s data_length=1",
            operation,
            response_type,
        )
        return [dict(data)]

    logger.warning(
        "[TrialUsageRead] operation=%s response_type=%s data_length=unknown exception_source=response_shape data_type=%s",
        operation,
        response_type,
        type(data).__name__,
    )
    return []


def _log_trial_usage_read_exception(operation: str, error: Exception, *, column: str = "") -> None:
    status = getattr(error, "status_code", None) or getattr(error, "status", None)
    source = "http_status" if status else "response_shape"
    logger.warning(
        "[TrialUsageRead] operation=%s column=%s response_type=exception data_length=unknown exception_source=%s status=%s error_type=%s code=%s message=%s",
        operation,
        column or "-",
        source,
        status or "-",
        safe_error_type(error),
        _supabase_error_code(error),
        _safe_error_message(error),
    )


def _first_trial_usage_match(column: str, value: Optional[str]) -> Optional[dict[str, Any]]:
    if not value:
        return None
    operation = f"read_by_{column}"
    try:
        response = (
            supabase_service.admin_client()
            .table(TRIAL_USAGE_TABLE)
            .select("id,user_id,trial_started_at,plan_key")
            .eq(column, value)
            .order("created_at", desc=True)
            .limit(1)
            .execute()
        )
    except Exception as error:
        if _trial_usage_table_missing(error):
            logger.warning(
                "[TrialUsageRead] operation=%s column=%s response_type=exception data_length=unknown exception_source=http_status status=503 error_type=%s code=%s message=%s",
                operation,
                column,
                safe_error_type(error),
                _supabase_error_code(error),
                _safe_error_message(error),
            )
            return None
        _log_trial_usage_read_exception(operation, error, column=column)
        return None
    rows = _response_data_rows(response, operation=operation)
    return rows[0] if rows else None


def _first_ip_trial_usage_match(ip_hash: Optional[str]) -> Optional[dict[str, Any]]:
    if not ip_hash:
        return None
    operation = "read_by_ip_hash"
    try:
        query = (
            supabase_service.admin_client()
            .table(TRIAL_USAGE_TABLE)
            .select("id,user_id,trial_started_at,plan_key")
            .eq("ip_hash", ip_hash)
            .order("created_at", desc=True)
            .limit(1)
        )
        lookback_days = int(getattr(config, "TRIAL_IP_LOOKBACK_DAYS", 0) or 0)
        if lookback_days > 0:
            from datetime import timedelta

            cutoff = datetime.now(timezone.utc) - timedelta(days=lookback_days)
            query = query.gte("created_at", cutoff.isoformat())
        response = query.execute()
    except Exception as error:
        if _trial_usage_table_missing(error):
            logger.warning(
                "[TrialUsageRead] operation=%s column=ip_hash response_type=exception data_length=unknown exception_source=http_status status=503 error_type=%s code=%s message=%s",
                operation,
                safe_error_type(error),
                _supabase_error_code(error),
                _safe_error_message(error),
            )
            return None
        _log_trial_usage_read_exception(operation, error, column="ip_hash")
        return None
    rows = _response_data_rows(response, operation=operation)
    return rows[0] if rows else None


def _first_subscription_match(column: str, value: Optional[str]) -> Optional[dict[str, Any]]:
    if not value:
        return None
    try:
        response = (
            supabase_service.admin_client()
            .table(SUBSCRIPTION_TABLE)
            .select("*")
            .eq(column, value)
            .order("created_at", desc=True)
            .limit(1)
            .execute()
        )
    except Exception as error:
        _raise_supabase_error("reading subscription history", error)
    rows = list(response.data or [])
    return rows[0] if rows else None


def _subscription_used_trial(subscription: Optional[dict[str, Any]]) -> bool:
    if not subscription:
        return False
    status = str(subscription.get("status") or "").lower()
    if status == "trialing":
        return True
    return bool(subscription.get("trial_starts_at") or subscription.get("trial_ends_at"))


def _subscription_allow_trial_again(subscription: Optional[dict[str, Any]]) -> bool:
    # Optional admin override. Add the column with docs/migration_trial_usage.sql.
    return bool((subscription or {}).get("allow_trial_again") is True)


def _trial_response(eligible: bool, reason: str) -> dict[str, Any]:
    source = "none"
    if reason == ACTIVE_SUBSCRIPTION_EXISTS:
        source = "subscription"
    elif reason == SUBSCRIPTION_HISTORY_EXISTS:
        source = "subscription_history"
    elif reason == COMPLETED_TRANSACTION_EXISTS:
        source = "completed_transaction"
    elif reason == TRIAL_ALREADY_USED:
        source = "confirmed_trial_redemption"
    elif reason == DEVICE_TRIAL_USED:
        source = "device_trial_redemption"
    elif reason == ADMIN_TRIAL_OVERRIDE:
        source = "admin_override"
    return {
        "eligible": eligible,
        "reason": reason,
        "source": source,
        "can_start_trial": eligible,
    }


def _log_trial_decision(user_id: Optional[str], result: dict[str, Any]) -> None:
    logger.info(
        "[TrialEligibility] request_id=%s user_present=%s user=%s eligible=%s reason=%s source=%s",
        request_id(),
        bool(user_id),
        short_user_id(user_id),
        result.get("eligible"),
        result.get("reason"),
        result.get("source"),
    )


def _subscription_sort_value(row: dict[str, Any]) -> str:
    return _as_iso(row.get("updated_at")) or _as_iso(row.get("created_at")) or ""


def _is_valid_paddle_subscription_row(row: dict[str, Any]) -> bool:
    status = str(row.get("status") or "").lower()
    return status in ACTIVE_UPLOAD_STATUSES and bool(_as_iso(row.get("paddle_subscription_id")))


def _is_subscription_billing_row(row: dict[str, Any]) -> bool:
    """Return true for real Paddle subscription rows, not AI credit/stat rows."""
    plan = normalize_plan(row.get("plan"))
    if plan not in PLAN_LIMITS:
        return False
    return bool(
        _as_iso(row.get("paddle_subscription_id"))
        or _as_iso(row.get("paddle_customer_id"))
        or _as_iso(row.get("paddle_price_id"))
        or _as_iso(row.get("trial_starts_at"))
        or _as_iso(row.get("trial_ends_at"))
    )


def get_user_subscription_history(user_id: str, *, limit: int = 20) -> list[dict[str, Any]]:
    try:
        response = (
            supabase_service.admin_client()
            .table(SUBSCRIPTION_TABLE)
            .select("*")
            .eq("user_id", user_id)
            .order("updated_at", desc=True)
            .order("created_at", desc=True)
            .limit(limit)
            .execute()
        )
    except Exception as error:
        _raise_supabase_error("reading subscription", error)

    rows = [dict(row) for row in list(response.data or [])]
    return rows


def get_user_subscription(user_id: str) -> Optional[dict[str, Any]]:
    rows = get_user_subscription_history(user_id)
    if not rows:
        return None

    billing_rows = [row for row in rows if _is_subscription_billing_row(row)]
    if billing_rows:
        return sorted(billing_rows, key=_subscription_sort_value, reverse=True)[0]

    return rows[0]


def get_checkout_intent(intent_id: Optional[str]) -> Optional[dict[str, Any]]:
    intent_id = str(intent_id or "").strip()
    if not intent_id:
        return None
    try:
        response = (
            supabase_service.admin_client()
            .table(CHECKOUT_INTENT_TABLE)
            .select("*")
            .eq("id", intent_id)
            .limit(1)
            .execute()
        )
    except Exception as error:
        _raise_checkout_intent_error("reading checkout intent", error)
    rows = [dict(row) for row in list(response.data or [])]
    return rows[0] if rows else None


def get_recent_checkout_intent(
    *,
    user_id: str,
    intent_type: str,
    plan_key: Optional[str],
    billing_interval: Optional[str],
    credit_pack_id: Optional[str],
    selected_price_id: str,
) -> Optional[dict[str, Any]]:
    cutoff = _utc_now() - timedelta(minutes=CHECKOUT_INTENT_REUSE_MINUTES)
    try:
        query = (
            supabase_service.admin_client()
            .table(CHECKOUT_INTENT_TABLE)
            .select("*")
            .eq("user_id", user_id)
            .eq("intent_type", intent_type)
            .eq("selected_price_id", selected_price_id)
            .in_("status", ["pending", "opened"])
            .gte("created_at", cutoff.isoformat())
            .order("created_at", desc=True)
            .limit(1)
        )
        if plan_key:
            query = query.eq("plan_key", plan_key)
        if billing_interval:
            query = query.eq("billing_interval", billing_interval)
        if credit_pack_id:
            query = query.eq("credit_pack_id", credit_pack_id)
        response = query.execute()
    except Exception as error:
        _raise_checkout_intent_error("reading recent checkout intent", error, user_id=user_id)
    rows = [dict(row) for row in list(response.data or [])]
    return rows[0] if rows else None


def get_latest_paid_subscription_intent(user_id: str) -> Optional[dict[str, Any]]:
    """Return a webhook-confirmed subscription checkout intent for this user."""
    try:
        response = (
            supabase_service.admin_client()
            .table(CHECKOUT_INTENT_TABLE)
            .select("id,user_id,intent_type,status,plan_key,billing_interval,selected_price_id,paddle_transaction_id,paddle_subscription_id,updated_at")
            .eq("user_id", user_id)
            .eq("intent_type", "subscription")
            .eq("status", "paid")
            .order("updated_at", desc=True)
            .limit(1)
            .execute()
        )
    except Exception as error:
        _raise_checkout_intent_error("reading paid subscription checkout intent", error, user_id=user_id)
    rows = [dict(row) for row in list(response.data or [])]
    return rows[0] if rows else None


def create_or_reuse_checkout_intent(
    *,
    user_id: str,
    intent_type: str,
    selected_price_id: str,
    plan_key: Optional[str] = None,
    billing_interval: Optional[str] = None,
    credit_pack_id: Optional[str] = None,
    device_id: Optional[str] = None,
    ip_address: Optional[str] = None,
    user_agent: Optional[str] = None,
) -> tuple[dict[str, Any], bool]:
    intent_type = str(intent_type or "").strip().lower()
    selected_price_id = str(selected_price_id or "").strip()
    plan_key = normalize_plan(plan_key) or None
    billing_interval = str(billing_interval or "").strip().lower() or None
    credit_pack_id = str(credit_pack_id or "").strip().lower() or None
    if intent_type not in {"subscription", "ai_credits"}:
        raise HTTPException(status_code=400, detail="Invalid checkout intent type.")
    if not selected_price_id:
        raise HTTPException(status_code=400, detail="Checkout price is missing.")

    recent = None
    try:
        recent = get_recent_checkout_intent(
            user_id=user_id,
            intent_type=intent_type,
            plan_key=plan_key,
            billing_interval=billing_interval,
            credit_pack_id=credit_pack_id,
            selected_price_id=selected_price_id,
        )
    except HTTPException as error:
        logger.warning(
            "[CheckoutIntent] recent intent lookup skipped table=%s user=%s intent_type=%s plan=%s billing=%s credit_pack=%s status=%s detail=%s",
            CHECKOUT_INTENT_TABLE,
            short_user_id(user_id),
            intent_type,
            plan_key or "(none)",
            billing_interval or "(none)",
            credit_pack_id or "(none)",
            error.status_code,
            str(error.detail)[:200],
        )
    if recent:
        return recent, True

    key = _checkout_idempotency_key(
        intent_type=intent_type,
        plan_key=plan_key,
        billing_interval=billing_interval,
        credit_pack_id=credit_pack_id,
        selected_price_id=selected_price_id,
    )
    now = _utc_now_iso()
    payload = {
        "user_id": user_id,
        "intent_type": intent_type,
        "plan_key": plan_key,
        "billing_interval": billing_interval,
        "credit_pack_id": credit_pack_id,
        "selected_price_id": selected_price_id,
        "status": "opened",
        "idempotency_key": key,
        "created_at": now,
        "updated_at": now,
    }
    if intent_type == "subscription":
        signal_hashes = _trial_hashes(
            email=None,
            device_id=device_id,
            ip_address=ip_address,
            user_agent=user_agent,
        )
        payload.update({
            "device_id_hash": signal_hashes["device_id_hash"],
            "ip_hash": signal_hashes["ip_hash"],
            "user_agent_hash": signal_hashes["user_agent_hash"],
        })
    try:
        response = (
            supabase_service.admin_client()
            .table(CHECKOUT_INTENT_TABLE)
            .insert({k: v for k, v in payload.items() if v is not None})
            .execute()
        )
        rows = [dict(row) for row in list(response.data or [])]
        return (rows[0] if rows else payload), False
    except Exception as error:
        existing = None
        try:
            response = (
                supabase_service.admin_client()
                .table(CHECKOUT_INTENT_TABLE)
                .select("*")
                .eq("user_id", user_id)
                .eq("idempotency_key", key)
                .limit(1)
                .execute()
            )
            rows = [dict(row) for row in list(response.data or [])]
            existing = rows[0] if rows else None
        except Exception as lookup_error:
            _log_checkout_intent_error("reading checkout intent after insert failure", lookup_error, user_id=user_id)
            existing = None
        if existing and str(existing.get("status") or "").lower() in {"pending", "opened"} and _is_recent_intent(existing):
            return existing, True
        if existing and str(existing.get("status") or "").lower() == "paid":
            raise HTTPException(status_code=409, detail="This checkout has already been completed.")
        _raise_checkout_intent_error("creating checkout intent", error, user_id=user_id)


def mark_checkout_intent_paid(
    *,
    intent_id: str,
    paddle_transaction_id: Optional[str] = None,
    paddle_subscription_id: Optional[str] = None,
) -> None:
    update = {
        "status": "paid",
        "updated_at": _utc_now_iso(),
    }
    if paddle_transaction_id:
        update["paddle_transaction_id"] = paddle_transaction_id
    if paddle_subscription_id:
        update["paddle_subscription_id"] = paddle_subscription_id
    try:
        (
            supabase_service.admin_client()
            .table(CHECKOUT_INTENT_TABLE)
            .update(update)
            .eq("id", intent_id)
            .execute()
        )
    except Exception as error:
        _raise_checkout_intent_error("marking checkout intent paid", error)


def validate_checkout_intent_for_webhook(
    *,
    checkout_intent_id: Optional[str],
    user_id: Optional[str],
    selected_price_id: Optional[str],
    intent_type: str,
) -> tuple[bool, Optional[dict[str, Any]], str]:
    intent = get_checkout_intent(checkout_intent_id)
    if not intent:
        return False, None, "missing_checkout_intent"
    if str(intent.get("intent_type") or "").lower() != str(intent_type or "").lower():
        return False, intent, "intent_type_mismatch"
    if not user_id:
        return False, intent, "missing_user_id"
    if str(intent.get("user_id") or "") != str(user_id):
        return False, intent, "user_mismatch"
    if str(intent.get("selected_price_id") or "") != str(selected_price_id or ""):
        return False, intent, "price_mismatch"
    if intent_type == "subscription" and config.paddle_price_has_trial(selected_price_id or "") and str(intent.get("status") or "").lower() != "paid":
        return False, intent, "trial_retired"
    if str(intent.get("status") or "").lower() == "paid":
        return False, intent, "already_paid"
    return True, intent, "ok"


def check_trial_eligibility(
    *,
    user_id: str,
    email: Optional[str],
    device_id: Optional[str],
    ip_address: Optional[str],
    user_agent: Optional[str] = None,
) -> dict[str, Any]:
    """Compatibility helper: no account may acquire a new free trial."""
    return _trial_response(False, "trial_retired")


def record_trial_usage(
    *,
    user_id: str,
    email: Optional[str],
    device_id: Optional[str],
    ip_address: Optional[str],
    user_agent: Optional[str] = None,
    plan_key: Optional[str] = None,
) -> dict[str, Any]:
    subscription = get_user_subscription(user_id)
    hashes = _trial_hashes(
        email=email,
        device_id=device_id,
        ip_address=ip_address,
        user_agent=user_agent,
    )
    payload = {
        "user_id": user_id,
        "email_hash": hashes["email_hash"],
        "paddle_customer_id": _as_iso((subscription or {}).get("paddle_customer_id")),
        "device_id_hash": hashes["device_id_hash"],
        "ip_hash": hashes["ip_hash"],
        "user_agent_hash": hashes["user_agent_hash"],
        "plan_key": (plan_key or "").strip().lower() or None,
    }
    try:
        response = (
            supabase_service.admin_client()
            .table(TRIAL_USAGE_TABLE)
            .insert(payload)
            .execute()
        )
    except Exception as error:
        if _trial_usage_table_missing(error):
            _raise_trial_usage_missing(error)
        _raise_supabase_error("recording trial usage", error)
    rows = list(response.data or [])
    return rows[0] if rows else payload


def reserve_trial_start(
    *,
    user_id: str,
    email: Optional[str],
    device_id: Optional[str],
    ip_address: Optional[str],
    user_agent: Optional[str] = None,
    plan_key: Optional[str] = None,
) -> dict[str, Any]:
    """Compatibility helper: trial acquisition is permanently disabled."""
    raise HTTPException(status_code=410, detail="Free trials are no longer offered.")


def attach_paddle_customer_to_trial_usage(
    *,
    user_id: Optional[str],
    email: Optional[str],
    paddle_customer_id: Optional[str],
) -> None:
    """Best-effort webhook helper: attach Paddle customer id to prior trial rows."""
    customer = _as_iso(paddle_customer_id)
    if not customer:
        return
    try:
        query = supabase_service.admin_client().table(TRIAL_USAGE_TABLE).update({
            "paddle_customer_id": customer,
        })
        if user_id:
            query.eq("user_id", user_id).execute()
            return
        email_hash = _trial_hash(_normalize_email(email))
        if email_hash:
            query.eq("email_hash", email_hash).execute()
    except Exception as error:
        if _trial_usage_table_missing(error):
            logger.warning(
                "[Billing] trial_usage table missing; cannot attach Paddle customer id"
            )
            return
        logger.warning("[Billing] failed to attach Paddle customer to trial usage error_type=%s", safe_error_type(error))


def mark_trial_usage_from_paddle(
    *,
    user_id: Optional[str],
    email: Optional[str],
    paddle_customer_id: Optional[str],
    plan_key: Optional[str] = None,
    device_id_hash: Optional[str] = None,
    ip_hash: Optional[str] = None,
    user_agent_hash: Optional[str] = None,
) -> None:
    """Best-effort webhook marker for trials created directly by Paddle.

    Checkout should normally create a marker before the webhook arrives, but
    webhooks are the durable subscription source of truth. If a trialing
    subscription arrives without a pre-existing marker, create one scoped to
    the authenticated user and/or Paddle customer id.
    """
    customer = _as_iso(paddle_customer_id)
    email_hash: Optional[str] = None
    try:
        email_hash = _trial_hash(_normalize_email(email))
    except Exception as error:
        logger.warning(
            "[Billing] could not hash email for Paddle trial marker user=%s error_type=%s",
            short_user_id(user_id),
            safe_error_type(error),
        )

    try:
        existing = None
        if user_id:
            existing = _first_trial_usage_match("user_id", user_id)
        if not existing and customer:
            existing = _first_trial_usage_match("paddle_customer_id", customer)
        if not existing and email_hash:
            existing = _first_trial_usage_match("email_hash", email_hash)

        if existing:
            updates = {}
            if customer and not existing.get("paddle_customer_id"):
                updates["paddle_customer_id"] = customer
            if device_id_hash and not existing.get("device_id_hash"):
                updates["device_id_hash"] = device_id_hash
            if ip_hash and not existing.get("ip_hash"):
                updates["ip_hash"] = ip_hash
            if user_agent_hash and not existing.get("user_agent_hash"):
                updates["user_agent_hash"] = user_agent_hash
            if updates:
                (
                    supabase_service.admin_client()
                    .table(TRIAL_USAGE_TABLE)
                    .update(updates)
                    .eq("id", existing.get("id"))
                    .execute()
                )
            _consume_trial_override(user_id)
            return

        if not (user_id or customer or email_hash):
            return

        payload = {
            "user_id": user_id,
            "email_hash": email_hash,
            "paddle_customer_id": customer,
            "device_id_hash": device_id_hash,
            "ip_hash": ip_hash,
            "user_agent_hash": user_agent_hash,
            "plan_key": (plan_key or "").strip().lower() or None,
            "trial_used_at": _utc_now_iso(),
        }
        (
            supabase_service.admin_client()
            .table(TRIAL_USAGE_TABLE)
            .insert({k: v for k, v in payload.items() if v is not None})
            .execute()
        )
        _consume_trial_override(user_id)
    except Exception as error:
        if _trial_usage_table_missing(error):
            logger.warning("[Billing] trial_usage table missing; cannot mark Paddle trial usage")
            return
        logger.warning(
            "[Billing] failed to mark Paddle trial usage user=%s error_type=%s",
            short_user_id(user_id),
            safe_error_type(error),
        )


def _consume_trial_override(user_id: Optional[str]) -> None:
    """Make the per-user admin exception one-time after Paddle confirms a trial."""
    if not user_id:
        return
    try:
        (
            supabase_service.admin_client()
            .table(SUBSCRIPTION_TABLE)
            .update({"allow_trial_again": False})
            .eq("user_id", user_id)
            .execute()
        )
    except Exception as error:
        logger.warning(
            "[Billing] failed to consume trial override user=%s error_type=%s",
            short_user_id(user_id),
            safe_error_type(error),
        )


def get_user_monthly_usage(user_id: str) -> dict[str, Any]:
    month_key = get_current_month_key()
    try:
        response = (
            supabase_service.admin_client()
            .table(UPLOAD_USAGE_TABLE)
            .select("*")
            .eq("user_id", user_id)
            .eq("month_key", month_key)
            .limit(1)
            .execute()
        )
    except Exception as error:
        _raise_supabase_error("reading monthly upload usage", error)

    rows = list(response.data or [])
    if rows:
        row = dict(rows[0])
        row["_exists"] = True
        return row
    return {
        "user_id": user_id,
        "month_key": month_key,
        "uploaded_count": 0,
        "_exists": False,
    }


def _is_subscription_current(status: str, current_period_ends_at: Optional[str]) -> bool:
    """Return true only for live Paddle access.

    A scheduled cancellation remains `active`/`trialing` until Paddle moves it
    to `canceled`, so `cancel_at_period_end=true` does not lock by itself. Once
    status is canceled/paused/expired, or the stored period end has passed, the
    backend locks access even if a webhook is delayed.
    """
    normalized_status = (status or "inactive").lower()
    if normalized_status not in ACTIVE_UPLOAD_STATUSES:
        return False

    period_end = _parse_datetime(current_period_ends_at)
    if period_end is None:
        return False
    return period_end > datetime.now(timezone.utc)


def _payment_access_fields(
    subscription: Optional[dict[str, Any]],
    *,
    now: Optional[datetime] = None,
) -> dict[str, Any]:
    """Return payment recovery metadata and whether plan access is allowed.

    Paddle moves a renewal to ``past_due`` at the billing-period boundary, so
    ``current_period_ends_at`` is the preferred grace-period start. Older rows
    without that value fall back to the webhook-maintained ``updated_at``.
    Past-due rows with no usable timestamp are locked instead of receiving an
    unbounded grace period.
    """
    current_time = now or datetime.now(timezone.utc)
    status = str((subscription or {}).get("status") or "inactive").lower()
    grace_days = config.PAST_DUE_GRACE_DAYS
    is_past_due = status == "past_due"
    grace_start: Optional[datetime] = None
    lock_after: Optional[datetime] = None

    if is_past_due:
        period_end = _parse_datetime((subscription or {}).get("current_period_ends_at"))
        updated_at = _parse_datetime((subscription or {}).get("updated_at"))
        if period_end is not None and period_end <= current_time:
            grace_start = period_end
        elif updated_at is not None:
            grace_start = updated_at
        if grace_start is not None:
            lock_after = grace_start + timedelta(days=grace_days)

    grace_active = bool(is_past_due and lock_after is not None and current_time < lock_after)
    active_or_trialing = _is_subscription_current(
        status,
        _as_iso((subscription or {}).get("current_period_ends_at")),
    )
    access_allowed = active_or_trialing or grace_active
    recovery_required = bool(is_past_due and not grace_active)
    message = None
    if is_past_due:
        message = PAST_DUE_WARNING_MESSAGE if grace_active else PAST_DUE_LOCKED_MESSAGE

    return {
        "subscription_status": status,
        "payment_status": status,
        "is_past_due": is_past_due,
        "past_due_grace_active": grace_active,
        "past_due_grace_days": grace_days,
        "past_due_lock_after": lock_after.isoformat() if lock_after else None,
        "payment_recovery_required": recovery_required,
        "payment_recovery_message": message,
        "access_allowed": access_allowed,
    }


def get_subscription_access(user_id: str) -> dict[str, Any]:
    try:
        subscription = get_user_subscription(user_id)
    except Exception as error:
        _log_optional_read_fallback("reading subscription access", error, user_id=user_id)
        payment_fields = _payment_access_fields({"status": "unknown"})
        payment_fields.pop("access_allowed", None)
        return {
            "subscription_loaded": False,
            "degraded": True,
            "has_subscription": False,
            "has_active_subscription": False,
            "trial_active": False,
            "plan": None,
            "status": "unknown",
            **payment_fields,
            "monthly_upload_limit": None,
            "uploaded_count": 0,
            "remaining_uploads": None,
            "can_upload": False,
            "reason": "Subscription data is temporarily unavailable.",
            "trial_ends_at": None,
            "current_period_ends_at": None,
            "current_period_end": None,
            "cancel_at_period_end": False,
            "paddle_customer_id": None,
            "paddle_subscription_id": None,
            "ai_tokens": 0,
            "daily_ai_tokens": 0,
            "daily_ai_tokens_limit": 0,
            "daily_ai_tokens_used": 0,
            "daily_ai_tokens_remaining": 0,
        }

    try:
        usage = get_user_monthly_usage(user_id)
        uploaded_count = int(usage.get("uploaded_count") or 0)
    except Exception as error:
        _log_optional_read_fallback("reading monthly upload usage for subscription access", error, user_id=user_id)
        uploaded_count = 0

    if not subscription:
        reason = "No active subscription found"
        logger.info("[Billing] request_id=%s upload blocked user=%s reason=%s", request_id(), short_user_id(user_id), reason)
        payment_fields = _payment_access_fields(None)
        payment_fields.pop("access_allowed", None)
        return {
            "subscription_loaded": True,
            "degraded": False,
            "has_subscription": False,
            "has_active_subscription": False,
            "trial_active": False,
            "plan": None,
            "status": "inactive",
            **payment_fields,
            "monthly_upload_limit": None,
            "uploaded_count": uploaded_count,
            "remaining_uploads": None,
            "can_upload": False,
            "reason": reason,
            "trial_ends_at": None,
            "current_period_ends_at": None,
            "current_period_end": None,
            "cancel_at_period_end": False,
            "paddle_customer_id": None,
            "paddle_subscription_id": None,
            "ai_tokens": 0,
            "daily_ai_tokens": 0,
            "daily_ai_tokens_limit": 0,
            "daily_ai_tokens_used": 0,
            "daily_ai_tokens_remaining": 0,
        }

    plan = normalize_plan(subscription.get("plan")) or None
    status = (subscription.get("status") or "inactive").lower()
    monthly_limit = get_plan_limit(plan or "")
    current_period_ends_at = _as_iso(subscription.get("current_period_ends_at"))
    payment_fields = _payment_access_fields(subscription)
    is_active = bool(payment_fields.pop("access_allowed"))
    remaining_uploads = (
        max(monthly_limit - uploaded_count, 0)
        if monthly_limit is not None
        else None
    )

    reason: Optional[str] = None
    if not plan:
        reason = "Unknown subscription plan"
    elif not is_active:
        if status == "past_due":
            reason = PAST_DUE_LOCKED_MESSAGE
        elif status == CANCELED_STATUS:
            reason = "Subscription canceled"
        elif status == "paused":
            reason = "Subscription paused"
        elif current_period_ends_at and _parse_datetime(current_period_ends_at) is not None:
            reason = "Subscription period has ended"
        else:
            reason = "No active subscription found"
    elif monthly_limit is not None and remaining_uploads <= 0:
        reason = "Monthly upload limit reached"

    can_upload = reason is None
    if can_upload:
        logger.info(
            "[Billing] request_id=%s subscription access checked user=%s status=%s plan=%s current_period_ends_at=%s cancel_at_period_end=%s can_upload=true",
            request_id(),
            short_user_id(user_id),
            status,
            plan or "(none)",
            current_period_ends_at or "-",
            bool(subscription.get("cancel_at_period_end") or False),
        )
    else:
        logger.info(
            "[Billing] request_id=%s upload blocked user=%s status=%s plan=%s current_period_ends_at=%s cancel_at_period_end=%s reason=%s",
            request_id(),
            short_user_id(user_id),
            status,
            plan or "(none)",
            current_period_ends_at or "-",
            bool(subscription.get("cancel_at_period_end") or False),
            reason,
        )

    trial_active = status == "trialing" and is_active

    # Resolve AI token values safely
    daily_limit = DAILY_AI_TOKENS.get(plan, 0) if (plan and is_active) else 0
    daily_tokens = daily_limit  # keep existing daily_ai_tokens field for backward compatibility
    
    ai_tokens_val = subscription.get("ai_tokens", 0) if "ai_tokens" in subscription else 0
    if ai_tokens_val is None:
        ai_tokens_val = 0

    daily_used = 0
    day_key = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    try:
        usage = get_user_daily_ai_usage(user_id, day_key)
        daily_used = int(usage.get("used_count", 0))
    except Exception as e:
        logger.warning("[Billing] failed to fetch daily AI usage for subscription display error_type=%s", safe_error_type(e))
        daily_used = 0

    daily_remaining = max(daily_limit - daily_used, 0)
    billing_details = get_subscription_billing_details(subscription)
    resolved_plan = billing_details.get("plan") or plan
    resolved_access = PLATFORM_ACCESS_BY_PLAN.get(resolved_plan or "", {}) if is_active else {}
    next_payment_date = (
        _as_iso(subscription.get("trial_ends_at")) or current_period_ends_at
        if status == "trialing"
        else current_period_ends_at
    )
    billing_status = status
    if status in ACTIVE_UPLOAD_STATUSES and not is_active:
        billing_status = "expired"

    return {
        "subscription_loaded": True,
        "degraded": False,
        "has_subscription": True,
        "has_active_subscription": is_active,
        "trial_active": trial_active,
        **billing_details,
        "status": status,
        **payment_fields,
        "billing_status": billing_status,
        "monthly_upload_limit": monthly_limit,
        "uploaded_count": uploaded_count,
        "remaining_uploads": remaining_uploads,
        "can_upload": can_upload,
        "reason": reason,
        "trial_ends_at": _as_iso(subscription.get("trial_ends_at")),
        "current_period_ends_at": current_period_ends_at,
        "current_period_end": current_period_ends_at,
        "cancel_at_period_end": bool(subscription.get("cancel_at_period_end") or False),
        "next_payment_date": next_payment_date,
        "renewal_behavior": (
            "payment_recovery"
            if status == "past_due"
            else "ends_at_period_close"
            if bool(subscription.get("cancel_at_period_end") or False)
            else "renews_automatically" if is_active else "not_renewing"
        ),
        "platform_access": [
            platform for platform in ("redbubble", "teepublic")
            if resolved_access.get(platform)
        ],
        "paddle_customer_id": _as_iso(subscription.get("paddle_customer_id")),
        "paddle_subscription_id": _as_iso(subscription.get("paddle_subscription_id")),
        "ai_tokens": ai_tokens_val,
        "extra_ai_tokens": ai_tokens_val,
        "daily_ai_tokens": daily_tokens,
        "daily_ai_tokens_limit": daily_limit,
        "daily_ai_tokens_used": daily_used,
        "daily_ai_tokens_remaining": daily_remaining,
    }


def get_user_platform_access(user_id: str) -> dict[str, Any]:
    """Return per-platform access for the current subscription state.

    This is the backend source of truth used by the website and extension.
    Unknown, inactive, expired, or period-ended subscriptions lock every
    platform by default.
    """
    try:
        subscription = get_user_subscription(user_id)
    except Exception as error:
        _log_optional_read_fallback("reading platform access subscription", error, user_id=user_id)
        payment_fields = _payment_access_fields({"status": "unknown"})
        payment_fields.pop("access_allowed", None)
        return {
            "has_active_plan": False,
            "degraded": True,
            "plan": None,
            "status": "unknown",
            **payment_fields,
            "redbubble": False,
            "teepublic": False,
            "reason": "Subscription data is temporarily unavailable.",
        }
    if not subscription:
        logger.info(
            "[Billing] request_id=%s platform access checked user=%s status=none plan=none current_period_ends_at=- cancel_at_period_end=false decision=locked reason=no_subscription",
            request_id(),
            short_user_id(user_id),
        )
        payment_fields = _payment_access_fields(None)
        payment_fields.pop("access_allowed", None)
        return {
            "has_active_plan": False,
            "degraded": False,
            "plan": None,
            "status": "inactive",
            **payment_fields,
            "current_period_ends_at": None,
            "current_period_end": None,
            "cancel_at_period_end": False,
            "redbubble": False,
            "teepublic": False,
            "reason": "No active subscription found",
        }

    plan = normalize_plan(subscription.get("plan")) or None
    status = (subscription.get("status") or "inactive").lower()
    current_period_ends_at = _as_iso(subscription.get("current_period_ends_at"))
    plan_access = PLATFORM_ACCESS_BY_PLAN.get(plan or "")
    payment_fields = _payment_access_fields(subscription)
    has_active_plan = bool(plan_access) and bool(payment_fields.pop("access_allowed"))

    if not has_active_plan:
        if plan and not plan_access:
            reason = "Unknown subscription plan"
        elif status == "past_due":
            reason = PAST_DUE_LOCKED_MESSAGE
        elif status == CANCELED_STATUS:
            reason = "Subscription canceled"
        elif status == "paused":
            reason = "Subscription paused"
        elif current_period_ends_at and _parse_datetime(current_period_ends_at) is not None:
            reason = "Subscription period has ended"
        else:
            reason = "No active subscription found"
        logger.info(
            "[Billing] request_id=%s platform access checked user=%s status=%s plan=%s current_period_ends_at=%s cancel_at_period_end=%s decision=locked reason=%s",
            request_id(),
            short_user_id(user_id),
            status,
            plan or "(none)",
            current_period_ends_at or "-",
            bool(subscription.get("cancel_at_period_end") or False),
            reason,
        )
        return {
            "has_active_plan": False,
            "degraded": False,
            "plan": plan,
            "status": status,
            **payment_fields,
            "current_period_ends_at": current_period_ends_at,
            "current_period_end": current_period_ends_at,
            "cancel_at_period_end": bool(subscription.get("cancel_at_period_end") or False),
            "redbubble": False,
            "teepublic": False,
            "reason": reason,
        }

    logger.info(
        "[Billing] request_id=%s platform access checked user=%s status=%s plan=%s current_period_ends_at=%s cancel_at_period_end=%s decision=unlocked redbubble=%s teepublic=%s",
        request_id(),
        short_user_id(user_id),
        status,
        plan or "(none)",
        current_period_ends_at or "-",
        bool(subscription.get("cancel_at_period_end") or False),
        bool(plan_access.get("redbubble")),
        bool(plan_access.get("teepublic")),
    )
    return {
        "has_active_plan": True,
        "degraded": False,
        "plan": plan,
        "status": status,
        **payment_fields,
        "current_period_ends_at": current_period_ends_at,
        "current_period_end": current_period_ends_at,
        "cancel_at_period_end": bool(subscription.get("cancel_at_period_end") or False),
        "redbubble": bool(plan_access.get("redbubble")),
        "teepublic": bool(plan_access.get("teepublic")),
    }


def require_platform_access(user_id: str, marketplace: str) -> dict[str, Any]:
    marketplace_key = (marketplace or "").lower()
    access = get_user_platform_access(user_id)
    if not bool(access.get(marketplace_key)):
        if access.get("payment_recovery_required"):
            detail = PAST_DUE_LOCKED_MESSAGE
        else:
            detail = PLATFORM_LOCKED_DETAIL if access.get("has_active_plan") else SUBSCRIPTION_REQUIRED_DETAIL
        logger.info(
            "[Billing] platform locked user=%s marketplace=%s plan=%s",
            short_user_id(user_id),
            marketplace_key,
            access.get("plan") or "(none)",
        )
        raise HTTPException(status_code=403, detail=detail)
    return access


def increment_upload_usage(user_id: str, amount: int = 1) -> dict[str, Any]:
    clamped_amount = max(1, min(int(amount or 1), 100))
    month_key = get_current_month_key()
    usage = get_user_monthly_usage(user_id)
    next_count = int(usage.get("uploaded_count") or 0) + clamped_amount

    try:
        if usage.get("_exists"):
            query = (
                supabase_service.admin_client()
                .table(UPLOAD_USAGE_TABLE)
                .update({"uploaded_count": next_count})
                .eq("user_id", user_id)
                .eq("month_key", month_key)
            )
            if usage.get("id"):
                query = query.eq("id", usage["id"])
            query.execute()
        else:
            (
                supabase_service.admin_client()
                .table(UPLOAD_USAGE_TABLE)
                .insert({
                    "user_id": user_id,
                    "month_key": month_key,
                    "uploaded_count": next_count,
                })
                .execute()
            )
    except Exception as error:
        _raise_supabase_error("incrementing monthly upload usage", error)

    logger.info(
        "[Billing] upload usage incremented user=%s amount=%s",
        short_user_id(user_id),
        clamped_amount,
    )
    return get_subscription_access(user_id)


def get_user_daily_ai_usage(user_id: str, day_key: str) -> dict[str, Any]:
    try:
        response = (
            supabase_service.admin_client()
            .table("ai_usage")
            .select("*")
            .eq("user_id", user_id)
            .eq("day_key", day_key)
            .limit(1)
            .execute()
        )
    except Exception as error:
        err_msg = str(error).lower()
        if "ai_usage" in err_msg and ("does not exist" in err_msg or "42p01" in err_msg or "undefined_table" in err_msg):
            raise HTTPException(
                status_code=503,
                detail="The daily AI usage database table 'ai_usage' is missing. Please run the SQL migration script in docs/migration_ai_usage_table.sql in Supabase first.",
            )
        _raise_supabase_error("reading daily AI usage", error)

    rows = list(response.data or [])
    if rows:
        row = dict(rows[0])
        row["_exists"] = True
        return row
    return {
        "user_id": user_id,
        "day_key": day_key,
        "used_count": 0,
        "_exists": False,
    }


def check_ai_token_availability(user_id: str) -> tuple[str, int]:
    """Check if the user has AI tokens available (either daily limit or extra tokens).
    
    Returns a tuple: (token_source, total_remaining)
    Where token_source is "daily" or "extra".
    
    If neither is available, raises a 402 AI credits exception.
    """
    access = get_subscription_access(user_id)
    
    status = (access.get("status") or "inactive").lower()
    current_period_ends_at = access.get("current_period_ends_at")
    is_active = access.get("has_subscription", False) and _is_subscription_current(status, current_period_ends_at)
    
    daily_limit = access.get("daily_ai_tokens", 0) if is_active else 0
    extra_tokens = access.get("ai_tokens", 0) or 0
    
    day_key = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    usage = get_user_daily_ai_usage(user_id, day_key)
    used_count = int(usage.get("used_count", 0))
    
    remaining_daily = max(0, daily_limit - used_count)
    
    if remaining_daily > 0:
        return "daily", remaining_daily + extra_tokens
    elif extra_tokens > 0:
        return "extra", extra_tokens
    else:
        if daily_limit > 0:
            _raise_ai_tokens_exhausted(
                message=(
                    f"You have exhausted your daily AI token allowance ({daily_limit} tokens/day) "
                    "and have no extra purchased AI tokens remaining."
                ),
                available_credits=remaining_daily + extra_tokens,
            )
        else:
            _raise_ai_tokens_exhausted(
                message="You do not have an active subscription or any extra purchased AI tokens.",
                available_credits=extra_tokens,
            )


def consume_ai_token_atomic(user_id: str) -> dict[str, Any]:
    """Atomically consume one AI token using the database RPC.

    The RPC locks the user's subscription row, then consumes a daily token
    first or an extra token second. No row means another concurrent request
    already consumed the last available token.
    """
    try:
        response = (
            supabase_service.admin_client()
            .rpc("consume_ai_token_atomic", {"p_user_id": user_id})
            .execute()
        )
    except Exception as error:
        err_msg = str(error).lower()
        if (
            "consume_ai_token_atomic" in err_msg
            and (
                "does not exist" in err_msg
                or "42883" in err_msg
                or "undefined_function" in err_msg
            )
        ):
            raise HTTPException(
                status_code=503,
                detail="The atomic AI token RPC is missing. Please run docs/migration_atomic_ai_token_consumption.sql in Supabase first.",
            ) from error
        if "ai_usage" in err_msg and ("does not exist" in err_msg or "42p01" in err_msg or "undefined_table" in err_msg):
            raise HTTPException(
                status_code=503,
                detail="The daily AI usage database table 'ai_usage' is missing. Please run the SQL migration script in docs/migration_ai_usage_table.sql in Supabase first.",
            ) from error
        _raise_supabase_error("atomically consuming AI token", error)

    rows = list(response.data or [])
    if not rows:
        _raise_ai_tokens_exhausted(
            message="You do not have any AI tokens remaining.",
            available_credits=0,
        )

    consumed = dict(rows[0])
    logger.info(
        "[Billing] AI token consumed atomically user=%s source=%s remaining_daily=%s remaining_extra=%s",
        short_user_id(user_id),
        consumed.get("token_source"),
        consumed.get("remaining_daily"),
        consumed.get("remaining_extra"),
    )
    return consumed


def reserve_ai_token(user_id: str) -> dict[str, Any]:
    """Reserve one AI token before provider work starts.

    This is intentionally a thin wrapper around the atomic consumption RPC:
    the token is consumed up front, then refunded by
    `refund_ai_token_reservation` if provider generation fails.
    """
    day_key = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    reservation = consume_ai_token_atomic(user_id)
    reservation["_reservation_day_key"] = day_key
    logger.info(
        "[Billing] AI token reserved user=%s source=%s remaining_daily=%s remaining_extra=%s",
        short_user_id(user_id),
        reservation.get("token_source"),
        reservation.get("remaining_daily"),
        reservation.get("remaining_extra"),
    )
    return reservation


def refund_ai_token_reservation(user_id: str, reservation: dict[str, Any]) -> None:
    """Refund a previously reserved AI token after provider failure.

    The API permits only one active AI generation per user in this process, so
    these read-modify-write refunds are not racing with another generation from
    the same user on the same backend worker.
    """
    token_source = str((reservation or {}).get("token_source") or "").lower()
    if token_source == "daily":
        day_key = (
            str((reservation or {}).get("_reservation_day_key") or "").strip()
            or datetime.now(timezone.utc).strftime("%Y-%m-%d")
        )
        usage = get_user_daily_ai_usage(user_id, day_key)
        current_used = int(usage.get("used_count", 0) or 0)
        next_used = max(0, current_used - 1)
        try:
            if usage.get("_exists"):
                query = (
                    supabase_service.admin_client()
                    .table("ai_usage")
                    .update({
                        "used_count": next_used,
                        "updated_at": datetime.now(timezone.utc).isoformat(),
                    })
                    .eq("user_id", user_id)
                    .eq("day_key", day_key)
                )
                if usage.get("id"):
                    query = query.eq("id", usage["id"])
                query.execute()
            else:
                logger.warning(
                    "[Billing] AI token refund skipped missing daily usage row user=%s day_key=%s",
                    short_user_id(user_id),
                    day_key,
                )
                return
        except Exception as error:
            _raise_supabase_error("refunding daily AI token", error)

        logger.info(
            "[Billing] AI token refunded user=%s source=daily used_count=%d",
            short_user_id(user_id),
            next_used,
        )
        return

    if token_source == "extra":
        subscription = get_user_subscription(user_id)
        if not subscription:
            logger.warning(
                "[Billing] AI token refund skipped missing subscription user=%s source=extra",
                short_user_id(user_id),
            )
            return
        current_tokens = int(subscription.get("ai_tokens", 0) or 0)
        next_tokens = current_tokens + 1
        try:
            (
                supabase_service.admin_client()
                .table(SUBSCRIPTION_TABLE)
                .update({
                    "ai_tokens": next_tokens,
                    "updated_at": datetime.now(timezone.utc).isoformat(),
                })
                .eq("id", subscription.get("id"))
                .eq("user_id", user_id)
                .execute()
            )
        except Exception as error:
            _raise_supabase_error("refunding extra AI token", error)

        logger.info(
            "[Billing] AI token refunded user=%s source=extra remaining_extra=%d",
            short_user_id(user_id),
            next_tokens,
        )
        return

    logger.warning(
        "[Billing] AI token refund skipped unknown source user=%s source=%s",
        short_user_id(user_id),
        token_source or "(none)",
    )


def commit_ai_token_consumption(user_id: str, token_source: str) -> None:
    """Consume exactly 1 AI token after a successful generation.
    
    If token_source is "daily", we increment the used_count in public.ai_usage for today.
    If token_source is "extra", we decrement ai_tokens in public.subscriptions by 1 (preventing negative).
    """
    if token_source == "daily":
        day_key = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        usage = get_user_daily_ai_usage(user_id, day_key)
        next_count = int(usage.get("used_count", 0)) + 1
        try:
            if usage.get("_exists"):
                query = (
                    supabase_service.admin_client()
                    .table("ai_usage")
                    .update({
                        "used_count": next_count,
                        "updated_at": datetime.now(timezone.utc).isoformat(),
                    })
                    .eq("user_id", user_id)
                    .eq("day_key", day_key)
                )
                if usage.get("id"):
                    query = query.eq("id", usage["id"])
                query.execute()
            else:
                (
                    supabase_service.admin_client()
                    .table("ai_usage")
                    .insert({
                        "user_id": user_id,
                        "day_key": day_key,
                        "used_count": next_count,
                    })
                    .execute()
                )
        except Exception as error:
            err_msg = str(error).lower()
            if "ai_usage" in err_msg and ("does not exist" in err_msg or "42p01" in err_msg or "undefined_table" in err_msg):
                raise HTTPException(
                    status_code=503,
                    detail="The daily AI usage database table 'ai_usage' is missing. Please run the SQL migration script in docs/migration_ai_usage_table.sql in Supabase first.",
                )
            _raise_supabase_error("updating daily AI usage", error)
            
        logger.info(
            "[Billing] daily AI token consumed user=%s new_used_count=%d",
            short_user_id(user_id),
            next_count,
        )

    elif token_source == "extra":
        subscription = get_user_subscription(user_id)
        if not subscription:
            raise HTTPException(
                status_code=400,
                detail="No subscription record found to deduct extra tokens from.",
            )
        current_tokens = int(subscription.get("ai_tokens", 0) or 0)
        new_tokens = max(0, current_tokens - 1)
        
        try:
            (
                supabase_service.admin_client()
                .table(SUBSCRIPTION_TABLE)
                .update({
                    "ai_tokens": new_tokens,
                    "updated_at": datetime.now(timezone.utc).isoformat(),
                })
                .eq("user_id", user_id)
                .execute()
            )
        except Exception as error:
            _raise_supabase_error("deducting extra AI tokens", error)
            
        logger.info(
            "[Billing] extra AI token consumed user=%s remaining_extra=%d",
            short_user_id(user_id),
            new_tokens,
        )
