"""Billing and upload access endpoints."""
from __future__ import annotations

import logging
from typing import Optional

import httpx
from pydantic import BaseModel
from fastapi import APIRouter, Depends, Header, HTTPException, Request

from app.core import config
from app.core.auth import AuthUser, get_current_user
from app.services import rate_limiter, subscription_service
from app.services.logging_utils import error_type as safe_error_type, request_id, short_id, short_user_id


router = APIRouter()
logger = logging.getLogger("podpilot.billing")


PADDLE_API_BASES = {
    "sandbox": "https://sandbox-api.paddle.com",
    "production": "https://api.paddle.com",
}


def _paddle_api_base() -> str:
    env = (config.PADDLE_ENVIRONMENT or "sandbox").lower()
    return PADDLE_API_BASES.get(env, PADDLE_API_BASES["sandbox"])


def _normalize_paddle_api_key(raw: str) -> str:
    """Strip whitespace, surrounding quotes, and a stray "Bearer " prefix.

    The Paddle .env value should be the raw API key only. We are defensive
    here so a copy/paste mistake doesn't break checkout.
    """
    if not raw:
        return ""
    value = str(raw).strip()
    # Strip a single matching pair of surrounding quotes.
    if len(value) >= 2 and value[0] == value[-1] and value[0] in {'"', "'"}:
        value = value[1:-1].strip()
    # Strip a stray "Bearer " prefix (case-insensitive).
    if value.lower().startswith("bearer "):
        value = value[len("Bearer "):].strip()
    return value


class UsageIncrementIn(BaseModel):
    amount: int = 1


class StartTrialIn(BaseModel):
    plan_key: Optional[str] = None


def _extract_forwarded_ip(value: Optional[str]) -> Optional[str]:
    if not value:
        return None
    first = str(value).split(",", 1)[0].strip()
    return first or None


def _request_ip(request: Request) -> Optional[str]:
    # Prefer proxy-provided client IP headers used by common managed edges,
    # then fall back to the direct ASGI client host.
    headers = request.headers
    return (
        _extract_forwarded_ip(headers.get("cf-connecting-ip"))
        or _extract_forwarded_ip(headers.get("true-client-ip"))
        or _extract_forwarded_ip(headers.get("x-forwarded-for"))
        or (request.client.host if request.client else None)
    )


def fetch_paddle_transactions(paddle_customer_id: str) -> list[dict]:
    api_key = _normalize_paddle_api_key(config.PADDLE_API_KEY)
    if not api_key:
        return []

    url = f"{_paddle_api_base()}/transactions"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Accept": "application/json",
    }
    params = {
        "customer_id": paddle_customer_id,
        "status": "completed",
    }

    try:
        with httpx.Client(timeout=10.0) as client:
            response = client.get(url, headers=headers, params=params)

        if response.status_code >= 400:
            logger.warning(
                "[Paddle] list transactions returned status %s",
                response.status_code,
            )
            return []

        payload = response.json() or {}
        data = payload.get("data") or []

        history = []
        for txn in data:
            totals = txn.get("details", {}).get("totals", {})
            grand_total = totals.get("grand_total", "0")

            try:
                val = float(grand_total) / 100.0
            except (ValueError, TypeError):
                val = 0.0

            price_id = ""
            items = txn.get("items", [])
            if isinstance(items, list) and items:
                price_id = items[0].get("price", {}).get("id") or items[0].get("price_id") or ""

            plan_key = config.paddle_plan_for_price_id(price_id) if price_id else ""
            plan_names = {
                "redbubble": "Redbubble Plan",
                "teepublic": "TeePublic Plan",
                "all_platforms": "All Platforms Plan",
            }
            plan_name = plan_names.get(plan_key, "PodPilot Subscription")

            history.append({
                "id": txn.get("id"),
                "date": txn.get("billed_at") or txn.get("created_at"),
                "plan": plan_name,
                "value": val,
                "currency": txn.get("currency_code") or "USD",
                "status": str(txn.get("status") or "Paid").capitalize(),
                "receipt_url": txn.get("receipt_url"),
            })
        return history
    except Exception as e:
        logger.error("[Paddle] failed to list transactions error_type=%s", safe_error_type(e))
        return []


@router.get("/api/me/subscription")
def get_my_subscription(user: AuthUser = Depends(get_current_user)) -> dict:
    rate_limiter.enforce_user_limit(user.id, rate_limiter.BILLING_READ)
    access = subscription_service.get_subscription_access(user.id)
    logger.info(
        "[BillingEndpoint] request_id=%s endpoint=/api/me/subscription user_present=true user=%s degraded=%s has_active=%s",
        request_id(),
        short_user_id(user.id),
        bool(access.get("degraded")),
        bool(access.get("has_active_subscription")),
    )
    paddle_customer_id = access.get("paddle_customer_id")
    if paddle_customer_id:
        access["payment_history"] = fetch_paddle_transactions(paddle_customer_id)
    else:
        access["payment_history"] = []
    return access


@router.get("/api/me/platform-access")
def get_my_platform_access(user: AuthUser = Depends(get_current_user)) -> dict:
    rate_limiter.enforce_user_limit(user.id, rate_limiter.BILLING_READ)
    access = subscription_service.get_user_platform_access(user.id)
    logger.info(
        "[BillingEndpoint] request_id=%s endpoint=/api/me/platform-access user_present=true user=%s degraded=%s has_active=%s plan=%s status=%s current_period_ends_at=%s cancel_at_period_end=%s decision=%s",
        request_id(),
        short_user_id(user.id),
        bool(access.get("degraded")),
        bool(access.get("has_active_plan")),
        access.get("plan") or "-",
        access.get("status") or "-",
        access.get("current_period_ends_at") or "-",
        bool(access.get("cancel_at_period_end")),
        "unlocked" if access.get("has_active_plan") else "locked",
    )
    return access


@router.post("/api/billing/check-upload-access")
def check_upload_access(user: AuthUser = Depends(get_current_user)) -> dict:
    rate_limiter.enforce_user_limit(user.id, rate_limiter.BILLING_READ)
    access = subscription_service.get_subscription_access(user.id)
    logger.info(
        "[BillingEndpoint] request_id=%s endpoint=/api/billing/check-upload-access user_present=true user=%s status=%s plan=%s current_period_ends_at=%s cancel_at_period_end=%s can_upload=%s reason=%s",
        request_id(),
        short_user_id(user.id),
        access.get("status") or "-",
        access.get("plan") or "-",
        access.get("current_period_ends_at") or "-",
        bool(access.get("cancel_at_period_end")),
        bool(access.get("can_upload")),
        access.get("reason") or "-",
    )
    return access


@router.post("/api/usage/increment-upload")
def increment_upload_usage(
    payload: UsageIncrementIn,
    user: AuthUser = Depends(get_current_user),
) -> dict:
    access = subscription_service.get_subscription_access(user.id)
    if not access.get("can_upload"):
        raise HTTPException(
            status_code=403,
            detail=subscription_service.SUBSCRIPTION_REQUIRED_DETAIL,
        )
    return subscription_service.increment_upload_usage(user.id, payload.amount)


@router.get("/api/billing/trial-eligibility")
def get_trial_eligibility(
    request: Request,
    user: AuthUser = Depends(get_current_user),
    x_podpilot_device_id: Optional[str] = Header(
        default=None,
        alias="X-PodPilot-Device-Id",
    ),
) -> dict:
    rate_limiter.enforce_user_limit(user.id, rate_limiter.TRIAL)
    rate_limiter.enforce_ip_limit(request, rate_limiter.TRIAL)
    short_uid = str(user.id)[:8]
    try:
        res = subscription_service.check_trial_eligibility(
            user_id=user.id,
            email=user.email,
            device_id=x_podpilot_device_id,
            ip_address=_request_ip(request),
            user_agent=request.headers.get("user-agent"),
        )
        
        eligible = res.get("eligible", False)
        internal_reason = res.get("reason", "unknown")
        trial_used = internal_reason in {
            subscription_service.TRIAL_ALREADY_USED,
            subscription_service.DEVICE_TRIAL_USED,
        }
        
        # Map internal reason to user-friendly response reasons
        if eligible:
            reason = "admin_override" if internal_reason == subscription_service.ADMIN_TRIAL_OVERRIDE else "new_user"
        else:
            if internal_reason == subscription_service.ACTIVE_SUBSCRIPTION_EXISTS:
                reason = "active_subscription"
            elif internal_reason in (
                subscription_service.TRIAL_ALREADY_USED,
                subscription_service.DEVICE_TRIAL_USED,
                subscription_service.SUBSCRIPTION_HISTORY_EXISTS,
                subscription_service.COMPLETED_TRANSACTION_EXISTS,
            ):
                reason = "already_used_trial"
            else:
                reason = "unknown"
                
        logger.info(
            "[TRIAL ELIGIBILITY] request_id=%s endpoint=/api/billing/trial-eligibility user=%s eligible=%s reason=%s source=%s",
            request_id(),
            short_user_id(user.id),
            eligible,
            reason,
            res.get("source") or "unknown",
        )
        return {
            "eligible": eligible,
            "trial_eligible": eligible,
            "trial_used": trial_used,
            "display_cta": "trial" if eligible else "subscribe",
            "reason": reason,
            "source": res.get("source") or "unknown",
        }
    except HTTPException as ex:
        # Check if it's a configuration issue (like trial_usage table missing or TRIAL_HASH_SALT missing)
        logger.warning(
            "[TRIAL ELIGIBILITY ERROR] request_id=%s endpoint=/api/billing/trial-eligibility user=%s error_type=HTTPException status_code=%s detail=%s",
            request_id(),
            short_user_id(user.id),
            ex.status_code,
            str(ex.detail)[:200],
        )
        if ex.status_code >= 500:
            # Trial eligibility failures must not accidentally grant a trial.
            return {
                "eligible": False,
                "trial_eligible": False,
                "trial_used": False,
                "display_cta": "subscribe",
                "reason": "eligibility_unavailable",
                "source": "fallback_optional_read_failure",
                "fallback": True,
            }
        raise ex
    except RuntimeError as ex:
        # Catch RuntimeError from missing TRIAL_HASH_SALT in production
        logger.warning(
            "[TRIAL ELIGIBILITY ERROR] request_id=%s endpoint=/api/billing/trial-eligibility user=%s error_type=%s",
            request_id(),
            short_user_id(user.id),
            safe_error_type(ex),
        )
        return {
            "eligible": False,
            "trial_eligible": False,
            "trial_used": False,
            "display_cta": "subscribe",
            "reason": "eligibility_unavailable",
            "source": "fallback_optional_read_failure",
            "fallback": True,
        }
    except Exception as ex:
        logger.warning(
            "[TRIAL ELIGIBILITY ERROR] request_id=%s endpoint=/api/billing/trial-eligibility user=%s error_type=%s",
            request_id(),
            short_user_id(user.id),
            safe_error_type(ex),
        )
        return {
            "eligible": False,
            "trial_eligible": False,
            "trial_used": False,
            "display_cta": "subscribe",
            "reason": "eligibility_unavailable",
            "source": "fallback_optional_read_failure",
            "fallback": True,
        }



@router.post("/api/billing/start-trial")
def start_trial(
    payload: StartTrialIn,
    request: Request,
    user: AuthUser = Depends(get_current_user),
    x_podpilot_device_id: Optional[str] = Header(
        default=None,
        alias="X-PodPilot-Device-Id",
    ),
) -> dict:
    rate_limiter.enforce_user_limit(user.id, rate_limiter.TRIAL)
    rate_limiter.enforce_ip_limit(request, rate_limiter.TRIAL)
    if not (x_podpilot_device_id or "").strip():
        raise HTTPException(
            status_code=400,
            detail="Could not verify this device. Refresh the page and try again.",
        )
    return subscription_service.reserve_trial_start(
        user_id=user.id,
        email=user.email,
        device_id=x_podpilot_device_id,
        ip_address=_request_ip(request),
        user_agent=request.headers.get("user-agent"),
        plan_key=payload.plan_key,
    )


@router.post("/api/billing/customer-portal")
async def create_customer_portal_session(
    user: AuthUser = Depends(get_current_user),
) -> dict:
    """Create a Paddle customer-portal session for the current user.

    Sessions are short-lived; we never cache the URL. PADDLE_API_KEY is read
    from backend env only — it never leaves the server.
    """
    rate_limiter.enforce_user_limit(user.id, rate_limiter.CHECKOUT)
    api_key = _normalize_paddle_api_key(config.PADDLE_API_KEY)
    if not api_key:
        logger.error("[Billing] PADDLE_API_KEY not configured")
        raise HTTPException(
            status_code=503,
            detail="Billing portal is not configured.",
        )

    subscription = subscription_service.get_user_subscription(user.id)
    paddle_customer_id: Optional[str] = (
        (subscription or {}).get("paddle_customer_id") if subscription else None
    )
    if not paddle_customer_id:
        logger.info(
            "[Billing] portal request rejected: no paddle_customer_id user=%s",
            short_user_id(user.id),
        )
        raise HTTPException(
            status_code=400,
            detail="No Paddle customer found for this account.",
        )

    paddle_subscription_id: Optional[str] = (subscription or {}).get(
        "paddle_subscription_id"
    )
    body = {}
    if paddle_subscription_id:
        body["subscription_ids"] = [paddle_subscription_id]

    url = f"{_paddle_api_base()}/customers/{paddle_customer_id}/portal-sessions"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "Accept": "application/json",
    }

    logger.info(
        "[Paddle] creating customer portal session user=%s customer=%s subscription=%s",
        short_user_id(user.id),
        short_id(paddle_customer_id),
        short_id(paddle_subscription_id),
    )

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.post(url, headers=headers, json=body)
    except httpx.HTTPError as error:
        logger.error("[Billing] portal request failed user=%s error_type=%s", short_user_id(user.id), safe_error_type(error))
        raise HTTPException(
            status_code=502,
            detail="Could not reach Paddle to open billing portal.",
        ) from error

    logger.info("[Paddle] portal response status=%s", response.status_code)

    if response.status_code in (401, 403):
        try:
            error_code = (response.json() or {}).get("error", {}).get("code")
        except ValueError:
            error_code = None
        logger.error(
            "[Paddle] portal error user=%s status=%s code=%s",
            short_user_id(user.id),
            response.status_code,
            error_code or "(none)",
        )
        raise HTTPException(
            status_code=502,
            detail=(
                "Paddle authentication failed. Check PADDLE_API_KEY "
                "formatting and permissions."
            ),
        )

    if response.status_code >= 400:
        try:
            error_code = (response.json() or {}).get("error", {}).get("code")
        except ValueError:
            error_code = None
        logger.error(
            "[Paddle] portal error user=%s status=%s code=%s",
            short_user_id(user.id),
            response.status_code,
            error_code or "(none)",
        )
        raise HTTPException(
            status_code=502,
            detail="Paddle rejected the billing portal request.",
        )

    payload = response.json() or {}
    data = payload.get("data") or {}
    urls = data.get("urls") or {}
    # Preferred path: data.urls.general.overview
    overview_url = ((urls.get("general") or {}).get("overview")) or None
    # Defensive fallbacks if Paddle ever changes the shape.
    if not overview_url:
        for key in ("overview", "manage", "subscription"):
            value = urls.get(key)
            if isinstance(value, str) and value:
                overview_url = value
                break
    if not overview_url:
        logger.error(
            "[Paddle] portal session response missing URL user=%s customer=%s",
            short_user_id(user.id),
            short_id(paddle_customer_id),
        )
        raise HTTPException(
            status_code=502,
            detail="Paddle did not return a portal URL.",
        )

    logger.info(
        "[Paddle] portal session created user=%s customer=%s",
        short_user_id(user.id),
        short_id(paddle_customer_id),
    )
    return {
        "url": overview_url,
        "expires_at": data.get("expires_at"),
    }


class CheckoutRequest(BaseModel):
    plan_key: Optional[str] = None
    billing_cycle: str = "monthly"
    intent_type: str = "subscription"
    credit_pack_id: Optional[str] = None


TRIAL_DAYS = 7


def _normalize_checkout_plan(plan_key: str) -> str:
    plan = (plan_key or "").strip().lower()
    if plan == "all-platforms":
        return "all_platforms"
    return plan


def _normalize_billing_cycle(billing_cycle: str) -> str:
    return (billing_cycle or "monthly").strip().lower()


def _normalize_credit_pack_id(credit_pack_id: Optional[str]) -> str:
    value = str(credit_pack_id or "").strip().lower()
    if value.startswith("ai_credits_"):
        return "tokens_" + value.removeprefix("ai_credits_")
    return value


def _resolve_subscription_price_id(*, plan: str, cycle: str, trial: bool) -> str:
    price_map = {
        ("redbubble", "monthly", True): config.PADDLE_REDBUBBLE_MONTHLY_TRIAL_PRICE_ID,
        ("redbubble", "monthly", False): config.PADDLE_REDBUBBLE_MONTHLY_PRICE_ID,
        ("redbubble", "annual", True): config.PADDLE_REDBUBBLE_ANNUAL_TRIAL_PRICE_ID,
        ("redbubble", "annual", False): config.PADDLE_REDBUBBLE_ANNUAL_PRICE_ID,
        ("teepublic", "monthly", True): config.PADDLE_TEEPUBLIC_MONTHLY_TRIAL_PRICE_ID,
        ("teepublic", "monthly", False): config.PADDLE_TEEPUBLIC_MONTHLY_PRICE_ID,
        ("teepublic", "annual", True): config.PADDLE_TEEPUBLIC_ANNUAL_TRIAL_PRICE_ID,
        ("teepublic", "annual", False): config.PADDLE_TEEPUBLIC_ANNUAL_PRICE_ID,
        ("all_platforms", "monthly", True): config.PADDLE_ALL_PLATFORMS_MONTHLY_TRIAL_PRICE_ID,
        ("all_platforms", "monthly", False): config.PADDLE_ALL_PLATFORMS_MONTHLY_PRICE_ID,
        ("all_platforms", "annual", True): config.PADDLE_ALL_PLATFORMS_ANNUAL_TRIAL_PRICE_ID,
        ("all_platforms", "annual", False): config.PADDLE_ALL_PLATFORMS_ANNUAL_PRICE_ID,
    }
    return (price_map.get((plan, cycle, trial)) or "").strip()


def _subscription_price_env_name(*, plan: str, cycle: str, trial: bool) -> str:
    plan_prefix = {
        "redbubble": "REDBUBBLE",
        "teepublic": "TEEPUBLIC",
        "all_platforms": "ALL_PLATFORMS",
    }.get(plan, "")
    cycle_part = "ANNUAL" if cycle == "annual" else "MONTHLY"
    trial_part = "_TRIAL" if trial else ""
    if not plan_prefix:
        return "UNKNOWN_PADDLE_PRICE_ID"
    return f"PADDLE_{plan_prefix}_{cycle_part}{trial_part}_PRICE_ID"


def _checkout_price_suffix(price_id: str) -> str:
    value = str(price_id or "").strip()
    return value[-8:] if len(value) > 8 else value or "missing"


def _resolve_credit_pack_price_id(credit_pack_id: str) -> str:
    pack = config.AI_TOKEN_PACKS.get(credit_pack_id)
    if not pack:
        return ""
    return (pack[1] or "").strip()


def _credit_pack_price_env_name(credit_pack_id: str) -> str:
    suffix = str(credit_pack_id or "").strip().lower().removeprefix("tokens_")
    return f"PADDLE_AI_TOKENS_{suffix}_PRICE_ID" if suffix else "PADDLE_AI_TOKENS_PRICE_ID"


def _validate_checkout_price_id(*, price_id: str, env_name: str, intent_type: str, plan: str = "", cycle: str = "") -> None:
    value = str(price_id or "").strip()
    if value.startswith("pri_"):
        return
    logger.error(
        "[Checkout] request_id=%s invalid Paddle price config intent=%s plan=%s billing=%s env_var=%s present=%s price_suffix=%s",
        request_id(),
        intent_type,
        plan or "-",
        cycle or "-",
        env_name,
        bool(value),
        _checkout_price_suffix(value),
    )
    raise HTTPException(
        status_code=500,
        detail=f"Checkout configuration error. {env_name} must be set to a valid Paddle price ID.",
    )


@router.post("/api/billing/checkout")
def get_checkout_price_id(
    payload: CheckoutRequest,
    request: Request,
    user: AuthUser = Depends(get_current_user),
    x_podpilot_device_id: Optional[str] = Header(
        default=None,
        alias="X-PodPilot-Device-Id",
    ),
) -> dict:
    rate_limiter.enforce_user_limit(user.id, rate_limiter.CHECKOUT)
    intent_type = str(payload.intent_type or "subscription").strip().lower()
    if intent_type not in {"subscription", "ai_credits"}:
        raise HTTPException(status_code=400, detail="Invalid checkout intent type.")

    plan = _normalize_checkout_plan(payload.plan_key or "")
    cycle = _normalize_billing_cycle(payload.billing_cycle)
    credit_pack_id = _normalize_credit_pack_id(payload.credit_pack_id)

    if intent_type == "ai_credits":
        if credit_pack_id not in config.AI_TOKEN_PACKS:
            raise HTTPException(
                status_code=400,
                detail=f"Unknown credit pack: '{payload.credit_pack_id}'",
            )
        resolved_id = _resolve_credit_pack_price_id(credit_pack_id)
        _validate_checkout_price_id(
            price_id=resolved_id,
            env_name=_credit_pack_price_env_name(credit_pack_id),
            intent_type="ai_credits",
            plan=credit_pack_id,
        )
        intent, reused = subscription_service.create_or_reuse_checkout_intent(
            user_id=user.id,
            intent_type="ai_credits",
            credit_pack_id=credit_pack_id,
            selected_price_id=resolved_id,
        )
        return {
            "intent_type": "ai_credits",
            "credit_pack_id": credit_pack_id,
            "trial_eligible": False,
            "eligible": False,
            "selected_price_id": resolved_id,
            "price_id": resolved_id,
            "button_label": "Buy credits",
            "trial_days": 0,
            "checkout_intent_id": intent.get("id"),
            "checkout_intent_status": intent.get("status") or "opened",
            "idempotency_key": intent.get("idempotency_key"),
            "reused_checkout_intent": reused,
        }

    if plan not in {"redbubble", "teepublic", "all_platforms"}:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown plan: '{payload.plan_key}'",
        )

    if cycle not in {"monthly", "annual"}:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid billing cycle: '{payload.billing_cycle}'",
        )

    eligibility = {"eligible": False, "reason": "unknown", "source": "unknown"}
    try:
        eligibility = subscription_service.check_trial_eligibility(
            user_id=user.id,
            email=user.email,
            device_id=x_podpilot_device_id,
            ip_address=_request_ip(request),
            user_agent=request.headers.get("user-agent"),
        )
    except Exception as error:
        logger.warning(
            "[Billing] request_id=%s endpoint=/api/billing/checkout checkout eligibility fallback user=%s plan=%s billing=%s error_type=%s fallback_reason=optional_trial_read_failure",
            request_id(),
            short_user_id(user.id),
            plan,
            cycle,
            safe_error_type(error),
        )
        eligibility = {
            "eligible": False,
            "reason": "eligibility_unavailable",
            "source": "fallback_optional_read_failure",
            "fallback": True,
        }

    trial_eligible = bool(eligibility.get("eligible") is True)
    resolved_id = _resolve_subscription_price_id(plan=plan, cycle=cycle, trial=trial_eligible)
    if trial_eligible and not resolved_id:
        raise HTTPException(
            status_code=500,
            detail=f"Trial price not configured for plan '{payload.plan_key}' ({cycle})",
        )

    if not resolved_id:
        trial_eligible = False
        resolved_id = _resolve_subscription_price_id(plan=plan, cycle=cycle, trial=False)

    _validate_checkout_price_id(
        price_id=resolved_id,
        env_name=_subscription_price_env_name(plan=plan, cycle=cycle, trial=trial_eligible),
        intent_type="subscription",
        plan=plan,
        cycle=cycle,
    )

    logger.info(
        "[Checkout] request_id=%s endpoint=/api/billing/checkout user_present=true user=%s plan=%s billing=%s trial_eligible=%s source=%s fallback=%s price_suffix=%s",
        request_id(),
        short_user_id(user.id),
        plan,
        cycle,
        trial_eligible,
        eligibility.get("source") or "unknown",
        bool(eligibility.get("fallback")),
        _checkout_price_suffix(resolved_id),
    )

    intent, reused = subscription_service.create_or_reuse_checkout_intent(
        user_id=user.id,
        intent_type="subscription",
        plan_key=plan,
        billing_interval=cycle,
        selected_price_id=resolved_id,
        device_id=x_podpilot_device_id,
        ip_address=_request_ip(request),
        user_agent=request.headers.get("user-agent"),
    )

    button_label = "Start 7-day free trial" if trial_eligible else "Subscribe now"
    return {
        "intent_type": "subscription",
        "plan_key": plan,
        "billing_interval": cycle,
        "trial_eligible": trial_eligible,
        "eligible": trial_eligible,
        "trial_used": eligibility.get("reason") in {
            subscription_service.TRIAL_ALREADY_USED,
            subscription_service.DEVICE_TRIAL_USED,
        },
        "display_cta": "trial" if trial_eligible else "subscribe",
        "eligibility_reason": eligibility.get("reason") or "unknown",
        "eligibility_source": eligibility.get("source") or "unknown",
        "selected_price_id": resolved_id,
        "price_id": resolved_id,
        "button_label": button_label,
        "trial_days": TRIAL_DAYS if trial_eligible else 0,
        "checkout_intent_id": intent.get("id"),
        "checkout_intent_status": intent.get("status") or "opened",
        "idempotency_key": intent.get("idempotency_key"),
        "reused_checkout_intent": reused,
    }
