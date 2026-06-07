"""Billing and upload access endpoints."""
from __future__ import annotations

import logging
from typing import Optional

import httpx
from pydantic import BaseModel
from fastapi import APIRouter, Depends, Header, HTTPException, Request

from app.core import config
from app.core.auth import AuthUser, get_current_user
from app.services import device_session_service, rate_limiter, subscription_service
from app.services.logging_utils import error_type as safe_error_type, short_id, short_user_id


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


def _is_extension_client(client_header: Optional[str]) -> bool:
    return str(client_header or "").strip().lower() in {"extension", "upload", "upload-control"}


def _require_upload_device(user: AuthUser, device_id: Optional[str]) -> None:
    device_session_service.validate_device(user.id, device_id)


def _require_upload_device_if_extension(
    user: AuthUser,
    device_id: Optional[str],
    client_header: Optional[str],
) -> None:
    if _is_extension_client(client_header):
        _require_upload_device(user, device_id)


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
                "growth": "All Platforms Plan",
                "starter": "Starter Plan",
                "pro": "Pro Plan",
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
    paddle_customer_id = access.get("paddle_customer_id")
    if paddle_customer_id:
        access["payment_history"] = fetch_paddle_transactions(paddle_customer_id)
    else:
        access["payment_history"] = []
    return access


@router.get("/api/me/platform-access")
def get_my_platform_access(
    user: AuthUser = Depends(get_current_user),
    x_podpilot_device_id: Optional[str] = Header(default=None, alias="X-PodPilot-Device-Id"),
    x_podpilot_client: Optional[str] = Header(default=None, alias="X-PodPilot-Client"),
) -> dict:
    _require_upload_device_if_extension(user, x_podpilot_device_id, x_podpilot_client)
    rate_limiter.enforce_user_limit(user.id, rate_limiter.BILLING_READ)
    return subscription_service.get_user_platform_access(user.id)


@router.post("/api/billing/check-upload-access")
def check_upload_access(
    user: AuthUser = Depends(get_current_user),
    x_podpilot_device_id: Optional[str] = Header(default=None, alias="X-PodPilot-Device-Id"),
) -> dict:
    _require_upload_device(user, x_podpilot_device_id)
    rate_limiter.enforce_user_limit(user.id, rate_limiter.BILLING_READ)
    return subscription_service.get_subscription_access(user.id)


@router.post("/api/usage/increment-upload")
def increment_upload_usage(
    payload: UsageIncrementIn,
    user: AuthUser = Depends(get_current_user),
    x_podpilot_device_id: Optional[str] = Header(default=None, alias="X-PodPilot-Device-Id"),
) -> dict:
    _require_upload_device(user, x_podpilot_device_id)
    access = subscription_service.get_subscription_access(user.id)
    status = str(access.get("status") or "").lower()
    if not access.get("has_subscription") or status not in {"trialing", "active"}:
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
        
        # Map internal reason to user-friendly response reasons
        if eligible:
            reason = "new_user"
        else:
            if internal_reason == subscription_service.ACTIVE_SUBSCRIPTION_EXISTS:
                reason = "active_subscription"
            elif internal_reason in (
                subscription_service.TRIAL_ALREADY_USED,
                subscription_service.DEVICE_OR_NETWORK_TRIAL_USED,
                subscription_service.SUBSCRIPTION_HISTORY_EXISTS,
            ):
                reason = "already_used_trial"
            else:
                reason = "unknown"
                
        logger.info(
            "[TRIAL ELIGIBILITY] user=%s eligible=%s reason=%s",
            short_user_id(user.id),
            eligible,
            reason,
        )
        return {
            "eligible": eligible,
            "reason": reason
        }
    except HTTPException as ex:
        # Check if it's a configuration issue (like trial_usage table missing or TRIAL_HASH_SALT missing)
        logger.warning(
            "[TRIAL ELIGIBILITY ERROR] user=%s error_type=HTTPException status_code=%s",
            short_user_id(user.id),
            ex.status_code,
        )
        if ex.status_code == 503:
            # Table missing migration or salt missing: return clean unknown ineligible response instead of blocking 503
            return {
                "eligible": False,
                "reason": "unknown"
            }
        # Otherwise re-raise true Supabase connection failures or other HTTPExceptions
        raise ex
    except RuntimeError as ex:
        # Catch RuntimeError from missing TRIAL_HASH_SALT in production
        logger.warning(
            "[TRIAL ELIGIBILITY ERROR] user=%s error_type=%s",
            short_user_id(user.id),
            safe_error_type(ex),
        )
        return {
            "eligible": False,
            "reason": "unknown"
        }
    except Exception as ex:
        logger.error(
            "[TRIAL ELIGIBILITY ERROR] user=%s error_type=%s",
            short_user_id(user.id),
            safe_error_type(ex),
        )
        # Check if it is a Postgrest or database outage, raise 503
        raise HTTPException(
            status_code=503,
            detail="Supabase or backend service is temporarily unavailable."
        ) from ex



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


TRIAL_DAYS = 3


def _normalize_checkout_plan(plan_key: str) -> str:
    plan = (plan_key or "").strip().lower()
    if plan in {"growth", "all-platforms"}:
        return "all_platforms"
    return plan


def _normalize_billing_cycle(billing_cycle: str) -> str:
    return (billing_cycle or "monthly").strip().lower()


def _normalize_credit_pack_id(credit_pack_id: Optional[str]) -> str:
    value = str(credit_pack_id or "").strip().lower()
    aliases = {
        "ai_credits_1000": "tokens_1000",
        "ai_credits_10000": "tokens_10000",
    }
    return aliases.get(value, value)


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


def _resolve_credit_pack_price_id(credit_pack_id: str) -> str:
    price_map = {
        "tokens_1000": config.PADDLE_AI_TOKENS_1000_PRICE_ID,
        "tokens_10000": config.PADDLE_AI_TOKENS_10000_PRICE_ID,
    }
    return (price_map.get(credit_pack_id) or "").strip()


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
        resolved_id = _resolve_credit_pack_price_id(credit_pack_id)
        if not resolved_id:
            raise HTTPException(
                status_code=400,
                detail=f"Price not configured for credit pack '{payload.credit_pack_id}'",
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

    eligibility = {"eligible": False, "reason": "unknown"}
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
            "[Billing] checkout eligibility fallback user=%s plan=%s cycle=%s error_type=%s",
            short_user_id(user.id),
            plan,
            cycle,
            safe_error_type(error),
        )

    trial_eligible = bool(eligibility.get("eligible") is True)
    resolved_id = _resolve_subscription_price_id(plan=plan, cycle=cycle, trial=trial_eligible)
    if trial_eligible and not resolved_id:
        raise HTTPException(
            status_code=400,
            detail=f"Trial price not configured for plan '{payload.plan_key}' ({cycle})",
        )

    if not resolved_id:
        trial_eligible = False
        resolved_id = _resolve_subscription_price_id(plan=plan, cycle=cycle, trial=False)

    if not resolved_id:
        raise HTTPException(
            status_code=400,
            detail=f"Price not configured for plan '{payload.plan_key}' ({cycle})",
        )

    intent, reused = subscription_service.create_or_reuse_checkout_intent(
        user_id=user.id,
        intent_type="subscription",
        plan_key=plan,
        billing_interval=cycle,
        selected_price_id=resolved_id,
    )

    button_label = "Start 3-day free trial" if trial_eligible else "Subscribe now"
    return {
        "intent_type": "subscription",
        "plan_key": plan,
        "billing_interval": cycle,
        "trial_eligible": trial_eligible,
        "eligible": trial_eligible,
        "eligibility_reason": eligibility.get("reason") or "unknown",
        "selected_price_id": resolved_id,
        "price_id": resolved_id,
        "button_label": button_label,
        "trial_days": TRIAL_DAYS if trial_eligible else 0,
        "checkout_intent_id": intent.get("id"),
        "checkout_intent_status": intent.get("status") or "opened",
        "idempotency_key": intent.get("idempotency_key"),
        "reused_checkout_intent": reused,
    }
