"""Paddle Billing webhook handler.

Receives subscription / transaction events from Paddle and upserts the
corresponding row in `public.subscriptions`. The webhook is the single
source of truth for subscription state — checkout never writes to the
table directly from the frontend.

Signature verification follows Paddle's documented format:

    Paddle-Signature: ts=<unix>;h1=<hex_hmac_sha256>

The signed payload is:

    f"{ts}:{raw_request_body_bytes}".encode("utf-8")

with HMAC-SHA256 keyed by `PADDLE_WEBHOOK_SECRET`.

Notes:
* We always read the raw body before parsing JSON. Re-serializing JSON
  for verification is incorrect and will fail intermittently.
* When `custom_data.user_id` is missing we still return 200 so Paddle
  doesn't retry forever; we just log a clear warning.
* Status normalization is intentionally permissive — we accept Paddle's
  `trialing` / `active` / `past_due` / `paused` / `canceled` strings and
  map anything unknown to `inactive` so the access logic in
  `subscription_service` never sees an unexpected value.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import logging
from datetime import datetime, timezone
from typing import Any, Optional

from fastapi import APIRouter, HTTPException, Request

from app.core import config
from app.services import subscription_service, supabase_service
from app.services.logging_utils import error_type as safe_error_type, short_id, short_user_id


logger = logging.getLogger("podpilot.paddle")
router = APIRouter()


SUBSCRIPTION_TABLE = "subscriptions"
WEBHOOK_EVENT_TABLE = "paddle_webhook_events"
TOKEN_CREDIT_TABLE = "paddle_token_credits"
PADDLE_SIGNATURE_HEADER = "paddle-signature"
PADDLE_SIGNATURE_TOLERANCE_SECONDS = 5 * 60
_OPTIONAL_SUBSCRIPTION_COLUMNS: dict[str, bool] = {}

# Paddle Billing event names we care about. Anything else returns 200 +
# a "ignored" log line so Paddle stops retrying.
KNOWN_EVENT_TYPES = {
    "subscription.created",
    "subscription.updated",
    "subscription.canceled",
    "subscription.cancelled",  # tolerate either spelling
    "transaction.completed",
    "transaction.paid",
}

PADDLE_TO_INTERNAL_STATUS = {
    "trialing": "trialing",
    "active": "active",
    "past_due": "past_due",
    "paused": "paused",
    "canceled": "canceled",
    "cancelled": "canceled",
    "deleted": "canceled",
}


# ── Signature verification ────────────────────────────────────────────────


def _parse_signature_header(value: str) -> dict[str, str]:
    """Paddle-Signature: ts=<unix>;h1=<hex>;h2=<hex_optional>"""
    parts: dict[str, str] = {}
    for piece in (value or "").split(";"):
        piece = piece.strip()
        if not piece or "=" not in piece:
            continue
        k, _, v = piece.partition("=")
        parts[k.strip()] = v.strip()
    return parts


def _verify_paddle_signature(secret: str, raw_body: bytes, header_value: str) -> bool:
    if not secret:
        return False
    parts = _parse_signature_header(header_value)
    ts = parts.get("ts")
    candidate_hashes = [v for k, v in parts.items() if k.startswith("h") and v]
    if not ts or not candidate_hashes:
        return False
    payload = f"{ts}:".encode("utf-8") + raw_body
    expected = hmac.new(
        secret.encode("utf-8"),
        payload,
        hashlib.sha256,
    ).hexdigest()
    for h in candidate_hashes:
        if hmac.compare_digest(expected, (h or "").lower()):
            return True
    return False


def _require_fresh_signature_timestamp(header_value: str) -> None:
    parts = _parse_signature_header(header_value)
    raw_ts = parts.get("ts")
    try:
        ts = int(raw_ts or "")
    except (TypeError, ValueError) as error:
        raise HTTPException(
            status_code=401,
            detail="Invalid Paddle signature timestamp",
        ) from error

    now = int(datetime.now(timezone.utc).timestamp())
    age = abs(now - ts)
    if age > PADDLE_SIGNATURE_TOLERANCE_SECONDS:
        logger.warning("[Paddle] stale webhook signature rejected age_seconds=%s", age)
        raise HTTPException(status_code=401, detail="Stale Paddle signature")


# ── Helpers ──────────────────────────────────────────────────────────────


def _norm_status(raw: str) -> str:
    return PADDLE_TO_INTERNAL_STATUS.get((raw or "").lower(), "inactive")


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _safe_iso(value: Any) -> Optional[str]:
    if value in (None, ""):
        return None
    return str(value)


def _first_price_id(items: Any) -> Optional[str]:
    """Subscription `items` is a list of items each with a `.price.id`."""
    if not isinstance(items, list):
        return None
    for item in items:
        if not isinstance(item, dict):
            continue
        price = item.get("price") or {}
        pid = price.get("id") or price.get("price_id")
        if pid:
            return str(pid)
        # Some payloads use `price_id` directly on the item.
        if item.get("price_id"):
            return str(item.get("price_id"))
    return None


def _price_ids_from_items(data: dict[str, Any]) -> list[str]:
    price_ids: list[str] = []
    items = data.get("items") or []
    if isinstance(items, list):
        for item in items:
            if not isinstance(item, dict):
                continue
            price = item.get("price") or {}
            pid = price.get("id") or price.get("price_id") or item.get("price_id")
            if pid:
                price_ids.append(str(pid))
    if not price_ids and data.get("price_id"):
        price_ids.append(str(data["price_id"]))
    return price_ids


def _extract_user_id(custom_data: Any) -> Optional[str]:
    if not isinstance(custom_data, dict):
        return None
    val = custom_data.get("user_id") or custom_data.get("userId")
    if not val:
        return None
    return str(val).strip() or None


def _extract_checkout_intent_id(custom_data: Any) -> Optional[str]:
    if not isinstance(custom_data, dict):
        return None
    val = (
        custom_data.get("checkout_intent_id")
        or custom_data.get("checkoutIntentId")
        or custom_data.get("checkout_intent")
    )
    if not val:
        return None
    return str(val).strip() or None


def _extract_custom_data(data: dict[str, Any]) -> dict[str, Any]:
    custom = data.get("custom_data")
    if custom is None:
        custom = data.get("customData")
    if not isinstance(custom, dict):
        return {}
    return custom


def _log_custom_data_keys(custom_data: dict[str, Any]) -> None:
    keys = [str(key) for key in custom_data.keys() if key]
    logger.info("[Paddle] custom_data keys=%s", ",".join(keys) if keys else "(none)")


def _normalize_custom_plan(value: Any) -> str:
    plan = str(value or "").strip().lower()
    if plan == "all-platforms":
        return "all_platforms"
    if plan.endswith("_paid"):
        plan = plan[:-5]
    if plan.endswith("_annual"):
        plan = plan[:-7]
    if plan == "all-platforms":
        return "all_platforms"
    if plan in {"redbubble", "teepublic", "all_platforms"}:
        return plan
    return ""


def _extract_billing_cycle(custom_data: dict[str, Any]) -> Optional[str]:
    cycle = str(
        custom_data.get("billing_cycle")
        or custom_data.get("billingCycle")
        or ""
    ).strip().lower()
    if cycle in {"monthly", "annual"}:
        return cycle
    return None


def _subscription_column_exists(column: str) -> bool:
    if column in _OPTIONAL_SUBSCRIPTION_COLUMNS:
        return _OPTIONAL_SUBSCRIPTION_COLUMNS[column]
    try:
        supabase_service.admin_client().table(SUBSCRIPTION_TABLE).select(column).limit(0).execute()
        _OPTIONAL_SUBSCRIPTION_COLUMNS[column] = True
    except Exception as error:
        _OPTIONAL_SUBSCRIPTION_COLUMNS[column] = False
        logger.warning(
            "[Paddle] subscriptions.%s column unavailable; skipping write error_type=%s",
            column,
            safe_error_type(error),
        )
    return _OPTIONAL_SUBSCRIPTION_COLUMNS[column]


def _extract_transaction_id(event_type: str, data: dict[str, Any]) -> Optional[str]:
    if event_type.startswith("transaction."):
        return _safe_iso(data.get("id"))
    return _safe_iso(data.get("transaction_id"))


# ── DB upsert ────────────────────────────────────────────────────────────


def _find_existing_row(
    *,
    paddle_subscription_id: Optional[str],
    user_id: Optional[str],
) -> Optional[dict[str, Any]]:
    client = supabase_service.admin_client()
    if paddle_subscription_id:
        try:
            r = (
                client.table(SUBSCRIPTION_TABLE)
                .select("*")
                .eq("paddle_subscription_id", paddle_subscription_id)
                .limit(1)
                .execute()
            )
            rows = list(r.data or [])
            if rows:
                return dict(rows[0])
        except Exception as error:
            logger.warning(
                "[Paddle] lookup by paddle_subscription_id failed subscription=%s error_type=%s",
                short_id(paddle_subscription_id),
                safe_error_type(error),
            )
    if user_id:
        try:
            r = (
                client.table(SUBSCRIPTION_TABLE)
                .select("*")
                .eq("user_id", user_id)
                .order("updated_at", desc=True)
                .order("created_at", desc=True)
                .limit(20)
                .execute()
            )
            rows = [dict(row) for row in list(r.data or [])]
            if rows:
                valid_paddle_rows = [
                    row for row in rows
                    if str(row.get("status") or "").lower() in {"active", "trialing"}
                    and row.get("paddle_subscription_id")
                ]
                if valid_paddle_rows:
                    return valid_paddle_rows[0]
                return rows[0]
        except Exception as error:
            logger.warning("[Paddle] lookup by user failed user=%s error_type=%s", short_user_id(user_id), safe_error_type(error))
    return None


def _upsert_subscription(payload: dict[str, Any]) -> None:
    """Insert if no row exists, otherwise update by id."""
    client = supabase_service.admin_client()
    paddle_sub = payload.get("paddle_subscription_id")
    user_id = payload.get("user_id")

    existing = _find_existing_row(
        paddle_subscription_id=paddle_sub,
        user_id=user_id,
    )

    if existing:
        update = {k: v for k, v in payload.items() if v is not None or k in {
            "cancel_at_period_end",
            "status",
            "plan",
        }}
        update["updated_at"] = _utc_now_iso()
        try:
            client.table(SUBSCRIPTION_TABLE).update(update).eq(
                "id", existing["id"]
            ).execute()
        except Exception as error:
            logger.error(
                "[Paddle] update subscription failed user=%s subscription=%s status=%s error_type=%s",
                short_user_id(update.get("user_id") or existing.get("user_id")),
                short_id(update.get("paddle_subscription_id") or existing.get("paddle_subscription_id")),
                update.get("status") or existing.get("status"),
                safe_error_type(error),
            )
            raise
        logger.info(
            "[Paddle] subscription status changed user=%s subscription=%s status=%s",
            short_user_id(update.get("user_id") or existing.get("user_id")),
            short_id(update.get("paddle_subscription_id") or existing.get("paddle_subscription_id")),
            update.get("status") or existing.get("status"),
        )
        return

    if not user_id:
        logger.warning(
            "[Paddle] cannot insert new subscription without user_id "
            "(paddle_subscription_id=%s)",
            short_id(paddle_sub),
        )
        return

    insert = {k: v for k, v in payload.items() if v is not None}
    insert.setdefault("created_at", _utc_now_iso())
    insert["updated_at"] = _utc_now_iso()
    try:
        client.table(SUBSCRIPTION_TABLE).insert(insert).execute()
    except Exception as error:
        logger.error(
            "[Paddle] insert subscription failed user=%s subscription=%s status=%s error_type=%s",
            short_user_id(insert.get("user_id")),
            short_id(insert.get("paddle_subscription_id")),
            insert.get("status"),
            safe_error_type(error),
        )
        raise
    logger.info(
        "[Paddle] subscription status changed user=%s subscription=%s status=%s",
        short_user_id(insert.get("user_id")),
        short_id(insert.get("paddle_subscription_id")),
        insert.get("status"),
    )


# ── Event handlers ───────────────────────────────────────────────────────


def _get_webhook_event(event_id: str) -> Optional[dict[str, Any]]:
    client = supabase_service.admin_client()
    response = (
        client.table(WEBHOOK_EVENT_TABLE)
        .select("*")
        .eq("event_id", event_id)
        .limit(1)
        .execute()
    )
    rows = list(response.data or [])
    return dict(rows[0]) if rows else None


def _claim_webhook_event(
    *,
    event_id: str,
    event_type: str,
    notification_id: Optional[str],
    transaction_id: Optional[str],
) -> bool:
    """Return True when this delivery should be processed."""
    client = supabase_service.admin_client()
    now = _utc_now_iso()
    payload = {
        "event_id": event_id,
        "event_type": event_type or "unknown",
        "notification_id": notification_id,
        "transaction_id": transaction_id,
        "status": "processing",
        "received_at": now,
        "updated_at": now,
    }
    try:
        client.table(WEBHOOK_EVENT_TABLE).insert(payload).execute()
        return True
    except Exception as insert_error:
        try:
            existing = _get_webhook_event(event_id)
        except Exception:
            raise insert_error
        if not existing:
            raise insert_error

        status = (existing.get("status") or "").lower()
        logger.info(
            "[Paddle] duplicate webhook event ignored event_id=%s status=%s",
            short_id(event_id),
            status or "(none)",
        )
        return False


def _mark_webhook_event(
    event_id: str,
    status: str,
    *,
    last_error: Optional[str] = None,
) -> None:
    now = _utc_now_iso()
    update: dict[str, Any] = {
        "status": status,
        "updated_at": now,
        "last_error": (last_error or "")[:500] if last_error else None,
    }
    if status in {"processed", "ignored"}:
        update["processed_at"] = now
    try:
        supabase_service.admin_client().table(WEBHOOK_EVENT_TABLE).update(update).eq(
            "event_id", event_id
        ).execute()
    except Exception as error:
        logger.error(
            "[Paddle] failed to mark webhook event=%s status=%s error_type=%s",
            short_id(event_id),
            status,
            safe_error_type(error),
        )
        raise


def _get_token_credit(transaction_id: str) -> Optional[dict[str, Any]]:
    client = supabase_service.admin_client()
    response = (
        client.table(TOKEN_CREDIT_TABLE)
        .select("*")
        .eq("transaction_id", transaction_id)
        .limit(1)
        .execute()
    )
    rows = list(response.data or [])
    return dict(rows[0]) if rows else None


def _claim_token_credit(
    *,
    transaction_id: str,
    event_id: str,
    user_id: str,
    tokens: int,
) -> bool:
    """Return True when this transaction should receive token credit."""
    client = supabase_service.admin_client()
    now = _utc_now_iso()
    payload = {
        "transaction_id": transaction_id,
        "event_id": event_id,
        "user_id": user_id,
        "tokens": tokens,
        "status": "processing",
        "created_at": now,
        "updated_at": now,
    }
    try:
        client.table(TOKEN_CREDIT_TABLE).insert(payload).execute()
        return True
    except Exception as insert_error:
        try:
            existing = _get_token_credit(transaction_id)
        except Exception:
            raise insert_error
        if not existing:
            raise insert_error

        status = (existing.get("status") or "").lower()
        if status == "credited":
            logger.info(
                "[Paddle] duplicate token credit ignored transaction=%s event_id=%s",
                short_id(transaction_id),
                short_id(event_id),
            )
            return False
        if status == "processing":
            logger.warning("[Paddle] duplicate token credit still processing transaction=%s", short_id(transaction_id))
            return False

        client.table(TOKEN_CREDIT_TABLE).update({
            "event_id": event_id,
            "user_id": user_id,
            "tokens": tokens,
            "status": "processing",
            "updated_at": now,
            "last_error": None,
        }).eq("transaction_id", transaction_id).execute()
        return True


def _mark_token_credit(
    transaction_id: str,
    status: str,
    *,
    last_error: Optional[str] = None,
) -> None:
    now = _utc_now_iso()
    update: dict[str, Any] = {
        "status": status,
        "updated_at": now,
        "last_error": (last_error or "")[:500] if last_error else None,
    }
    if status == "credited":
        update["credited_at"] = now
    supabase_service.admin_client().table(TOKEN_CREDIT_TABLE).update(update).eq(
        "transaction_id", transaction_id
    ).execute()


def _handle_subscription_event(event_type: str, data: dict[str, Any]) -> None:
    paddle_subscription_id = _safe_iso(data.get("id"))
    paddle_customer_id = _safe_iso(data.get("customer_id"))
    raw_status = data.get("status") or ""
    status = _norm_status(raw_status)

    # Cancellation events sometimes arrive with status="active" but a
    # `canceled_at` field. Force canceled when the event is .canceled.
    if event_type in {"subscription.canceled", "subscription.cancelled"}:
        status = "canceled"

    custom = _extract_custom_data(data)
    _log_custom_data_keys(custom)
    user_id = _extract_user_id(custom)
    checkout_intent_id = _extract_checkout_intent_id(custom)
    custom_email = _safe_iso(custom.get("email"))

    items = data.get("items") or []
    paddle_price_id = _first_price_id(items) or _safe_iso(data.get("price_id"))
    plan = config.paddle_plan_for_price_id(paddle_price_id or "")
    if plan in {"tokens_1000", "tokens_10000"}:
        logger.info("[Paddle] subscription event with token pack price_id=%s ignored for plan mapping", short_id(paddle_price_id))
        plan = ""
    if not plan:
        logger.warning(
            "[Paddle] subscription event ignored: unknown price_id=%s subscription=%s",
            short_id(paddle_price_id),
            short_id(paddle_subscription_id),
        )
        return

    valid_intent, intent, intent_reason = subscription_service.validate_checkout_intent_for_webhook(
        checkout_intent_id=checkout_intent_id,
        user_id=user_id,
        selected_price_id=paddle_price_id,
        intent_type="subscription",
    )
    if not valid_intent and intent_reason != "already_paid":
        logger.warning(
            "[Paddle] subscription event ignored: invalid checkout intent reason=%s intent=%s user=%s price=%s",
            intent_reason,
            short_id(checkout_intent_id),
            short_user_id(user_id),
            short_id(paddle_price_id),
        )
        return
    if intent_reason == "already_paid" and event_type == "subscription.created":
        logger.info(
            "[Paddle] duplicate paid subscription.created skipped intent=%s subscription=%s",
            short_id(checkout_intent_id),
            short_id(paddle_subscription_id),
        )
        return

    logger.info(
        "[Paddle] mapped price_id=%s plan=%s",
        short_id(paddle_price_id),
        plan or "(unknown)",
    )

    if not user_id:
        logger.warning(
            "[Paddle] missing user_id in custom_data; cannot attach "
            "subscription=%s to a Supabase user",
            short_id(paddle_subscription_id),
        )
        # Still return — let _upsert_subscription try to match by
        # paddle_subscription_id (in case we created the row earlier).

    trial_starts = _safe_iso(data.get("started_at")) or _safe_iso(data.get("first_billed_at"))
    trial_ends = _safe_iso(data.get("trial_ends_at")) or _safe_iso(data.get("next_billed_at"))
    current_period = data.get("current_billing_period") or {}
    current_period_starts_at = _safe_iso(current_period.get("starts_at"))
    current_period_ends_at = _safe_iso(current_period.get("ends_at"))
    cancel_scheduled = data.get("scheduled_change") or {}
    cancel_at_period_end = bool(
        data.get("cancel_at_period_end")
        or (isinstance(cancel_scheduled, dict) and cancel_scheduled.get("action") == "cancel")
    )
    billing_anchor = (
        _safe_iso((data.get("billing_cycle") or {}).get("starts_at"))
        or _safe_iso(data.get("first_billed_at"))
        or _safe_iso(data.get("started_at"))
    )

    payload: dict[str, Any] = {
        "user_id": user_id,
        "plan": plan or None,
        "status": status,
        "paddle_customer_id": paddle_customer_id,
        "paddle_subscription_id": paddle_subscription_id,
        "paddle_price_id": paddle_price_id,
        "trial_starts_at": trial_starts,
        "trial_ends_at": trial_ends,
        "current_period_starts_at": current_period_starts_at,
        "current_period_ends_at": current_period_ends_at,
        "cancel_at_period_end": cancel_at_period_end,
        "billing_anchor": billing_anchor,
    }
    billing_cycle = _extract_billing_cycle(custom)
    if billing_cycle and _subscription_column_exists("billing_cycle"):
        payload["billing_cycle"] = billing_cycle
    # Drop None values so we don't overwrite existing valid columns with
    # nulls — except for fields we explicitly want to set even if null
    # (e.g. cancel_at_period_end, status, plan).
    _upsert_subscription(payload)
    if valid_intent and status in {"trialing", "active"}:
        try:
            subscription_service.mark_checkout_intent_paid(
                intent_id=str(intent.get("id")),
                paddle_subscription_id=paddle_subscription_id,
            )
        except Exception as error:
            logger.warning(
                "[Paddle] subscription intent paid marker failed intent=%s error_type=%s",
                short_id(checkout_intent_id),
                safe_error_type(error),
            )
    if user_id and (status == "trialing" or trial_starts or trial_ends):
        subscription_service.mark_trial_usage_from_paddle(
            user_id=user_id,
            email=custom_email,
            paddle_customer_id=paddle_customer_id,
            plan_key=plan,
        )
        subscription_service.attach_paddle_customer_to_trial_usage(
            user_id=user_id,
            email=custom_email,
            paddle_customer_id=paddle_customer_id,
        )


def _probe_ai_tokens_column() -> bool:
    """Probe if the subscriptions table has the ai_tokens column."""
    client = supabase_service.admin_client()
    try:
        client.table(SUBSCRIPTION_TABLE).select("ai_tokens").limit(0).execute()
        return True
    except Exception as e:
        logger.warning(
            "[Paddle] Database probing for 'ai_tokens' column failed. "
            "It might be missing. Run docs/migration_add_ai_tokens.sql in Supabase. "
            "error_type=%s",
            safe_error_type(e),
        )
        return False


def _handle_transaction_event(event_id: str, event_type: str, data: dict[str, Any]) -> None:
    paddle_subscription_id = _safe_iso(data.get("subscription_id"))
    paddle_customer_id = _safe_iso(data.get("customer_id"))
    transaction_id = _extract_transaction_id(event_type, data)
    custom = _extract_custom_data(data)
    _log_custom_data_keys(custom)
    user_id = _extract_user_id(custom)
    checkout_intent_id = _extract_checkout_intent_id(custom)
    custom_email = _safe_iso(custom.get("email"))
    logger.info(
        "[Paddle] %s transaction=%s subscription=%s customer=%s user=%s",
        event_type,
        short_id(transaction_id),
        short_id(paddle_subscription_id),
        short_id(paddle_customer_id),
        short_user_id(user_id),
    )
    # We deliberately do NOT increment upload_usage here. Paddle transactions
    # are payment-level events; they should not affect upload counts.

    # ── Token pack resolution and allocation ──────────────────────────────
    price_ids = _price_ids_from_items(data)

    tokens_to_add = 0
    credit_price_id: Optional[str] = None
    for pid in price_ids:
        plan_key = config.paddle_plan_for_price_id(pid)
        if not plan_key:
            logger.warning(
                "[Paddle] transaction ignored: unknown price_id=%s transaction=%s",
                short_id(pid),
                short_id(transaction_id),
            )
            return
        if plan_key == "tokens_1000":
            tokens_to_add += 1000
            credit_price_id = pid
        elif plan_key == "tokens_10000":
            tokens_to_add += 10000
            credit_price_id = pid

    if tokens_to_add > 0:
        if not user_id:
            logger.warning(
                "[Paddle] transaction.completed / transaction.paid received with token pack "
                "purchase, but user_id is missing in custom_data. Cannot credit %d tokens.",
                tokens_to_add,
            )
            return

        if not transaction_id:
            logger.warning(
                "[Paddle] token pack transaction event_id=%s is missing transaction id; skipping credit",
                short_id(event_id),
            )
            return

        valid_intent, intent, intent_reason = subscription_service.validate_checkout_intent_for_webhook(
            checkout_intent_id=checkout_intent_id,
            user_id=user_id,
            selected_price_id=credit_price_id,
            intent_type="ai_credits",
        )
        if not valid_intent:
            logger.info(
                "[Paddle] token credit skipped: checkout intent reason=%s intent=%s transaction=%s",
                intent_reason,
                short_id(checkout_intent_id),
                short_id(transaction_id),
            )
            return

        # Check if the ai_tokens column is present before updating
        if not _probe_ai_tokens_column():
            logger.warning(
                "[Paddle] PROPOSED MIGRATION REQUIRED: user=%s purchased %d tokens in transaction, "
                "but the 'ai_tokens' column does not exist in the 'subscriptions' table yet. "
                "Please run docs/migration_add_ai_tokens.sql in your Supabase SQL editor. "
                "Webhook has skipped database update but succeeded with status 200.",
                short_user_id(user_id),
                tokens_to_add,
            )
            return

        if not _claim_token_credit(
            transaction_id=transaction_id,
            event_id=event_id,
            user_id=user_id,
            tokens=tokens_to_add,
        ):
            return

        client = supabase_service.admin_client()
        try:
            existing = _find_existing_row(
                paddle_subscription_id=paddle_subscription_id,
                user_id=user_id,
            )

            if existing:
                current_tokens = existing.get("ai_tokens") or 0
                new_tokens = current_tokens + tokens_to_add
                client.table(SUBSCRIPTION_TABLE).update({
                    "ai_tokens": new_tokens,
                    "updated_at": _utc_now_iso(),
                }).eq("id", existing["id"]).execute()
                logger.info(
                    "[Paddle] successfully credited %d tokens to user=%s new_total=%d",
                    tokens_to_add,
                    short_user_id(user_id),
                    new_tokens,
                )
            else:
                # Create a new subscription row representing the token purchase
                client.table(SUBSCRIPTION_TABLE).insert({
                    "user_id": user_id,
                    "status": "active",
                    "plan": None,
                    "ai_tokens": tokens_to_add,
                    "created_at": _utc_now_iso(),
                    "updated_at": _utc_now_iso(),
                }).execute()
                logger.info(
                    "[Paddle] successfully created subscription row with %d tokens for user=%s",
                    tokens_to_add,
                    short_user_id(user_id),
                )
        except Exception as error:
            _mark_token_credit(transaction_id, "failed", last_error=str(error))
            logger.error(
                "[Paddle] failed to credit token pack user=%s transaction=%s error_type=%s",
                short_user_id(user_id),
                short_id(transaction_id),
                safe_error_type(error),
            )
            raise

        _mark_token_credit(transaction_id, "credited")
        try:
            subscription_service.mark_checkout_intent_paid(
                intent_id=str(intent.get("id")),
                paddle_transaction_id=transaction_id,
                paddle_subscription_id=paddle_subscription_id,
            )
        except Exception as error:
            logger.warning(
                "[Paddle] token credit intent paid marker failed intent=%s transaction=%s error_type=%s",
                short_id(checkout_intent_id),
                short_id(transaction_id),
                safe_error_type(error),
            )


# ── Route ────────────────────────────────────────────────────────────────


@router.post("/api/paddle/webhook")
async def paddle_webhook(request: Request) -> dict[str, Any]:
    raw_body = await request.body()
    signature = request.headers.get(PADDLE_SIGNATURE_HEADER) or request.headers.get(
        PADDLE_SIGNATURE_HEADER.title()
    )
    if not signature:
        logger.warning("[Paddle] invalid webhook signature: missing header")
        raise HTTPException(status_code=401, detail="Missing Paddle-Signature header")

    secret = config.PADDLE_WEBHOOK_SECRET or ""
    if not secret:
        logger.error(
            "[Paddle] PADDLE_WEBHOOK_SECRET is not set; refusing webhook."
        )
        raise HTTPException(status_code=503, detail="Paddle webhook secret not configured.")

    if not _verify_paddle_signature(secret, raw_body, signature):
        logger.warning("[Paddle] invalid webhook signature")
        raise HTTPException(status_code=401, detail="Invalid Paddle signature")

    _require_fresh_signature_timestamp(signature)
    logger.info("[Paddle] webhook signature verified")

    try:
        event = json.loads(raw_body.decode("utf-8") or "{}")
    except (ValueError, UnicodeDecodeError) as error:
        logger.warning("[Paddle] bad JSON body error_type=%s", safe_error_type(error))
        raise HTTPException(status_code=400, detail="Invalid JSON body") from error

    event_type = (event.get("event_type") or event.get("type") or "").lower()
    data = event.get("data") if isinstance(event.get("data"), dict) else event.get("payload") or {}
    if not isinstance(data, dict):
        data = {}

    event_id = str(event.get("event_id") or "").strip()
    notification_id = _safe_iso(event.get("notification_id"))
    transaction_id = _extract_transaction_id(event_type, data)
    if not event_id:
        logger.warning("[Paddle] webhook rejected: missing event_id type=%s", event_type or "(unknown)")
        raise HTTPException(status_code=400, detail="Missing Paddle event_id")

    logger.info(
        "[Paddle] webhook received event_id=%s type=%s transaction=%s",
        short_id(event_id),
        event_type or "(unknown)",
        short_id(transaction_id),
    )

    should_process = _claim_webhook_event(
        event_id=event_id,
        event_type=event_type,
        notification_id=notification_id,
        transaction_id=transaction_id,
    )
    if not should_process:
        return {"ok": True, "duplicate": True}

    if event_type not in KNOWN_EVENT_TYPES:
        logger.info("[Paddle] ignored event event_id=%s type=%s", short_id(event_id), event_type or "(unknown)")
        _mark_webhook_event(event_id, "ignored")
        return {"ok": True, "ignored": True}

    try:
        if event_type.startswith("subscription."):
            _handle_subscription_event(event_type, data)
        elif event_type.startswith("transaction."):
            _handle_transaction_event(event_id, event_type, data)
    except HTTPException as error:
        _mark_webhook_event(event_id, "failed", last_error=str(error.detail))
        logger.warning(
            "[Paddle] webhook failed event_id=%s type=%s status_code=%s error_type=HTTPException",
            short_id(event_id),
            event_type or "(unknown)",
            error.status_code,
        )
        raise
    except Exception as error:  # Supabase/DB errors → let Paddle retry
        _mark_webhook_event(event_id, "failed", last_error=str(error))
        logger.error(
            "[Paddle] handler failed event_id=%s type=%s error_type=%s",
            short_id(event_id),
            event_type or "(unknown)",
            safe_error_type(error),
            exc_info=config.DEBUG,
        )
        raise HTTPException(status_code=500, detail="Webhook handler failed") from error

    _mark_webhook_event(event_id, "processed")
    logger.info("[Paddle] webhook processed event_id=%s type=%s", short_id(event_id), event_type or "(unknown)")
    return {"ok": True}
