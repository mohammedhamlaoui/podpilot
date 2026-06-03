"""Billing and upload access endpoints."""
from __future__ import annotations

import logging
from typing import Optional

import httpx
from pydantic import BaseModel
from fastapi import APIRouter, Depends, Header, HTTPException, Request

from app.core import config
from app.core.auth import AuthUser, get_current_user
from app.services import subscription_service


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


def _api_key_prefix(key: str) -> str:
    """Return a short prefix safe to log (never the full secret)."""
    if not key:
        return "(empty)"
    return key[: min(8, len(key))]


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
                "[Paddle] list transactions returned status %s: %s",
                response.status_code,
                response.text,
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
        logger.error("[Paddle] failed to list transactions: %s", e)
        return []


@router.get("/api/me/subscription")
def get_my_subscription(user: AuthUser = Depends(get_current_user)) -> dict:
    access = subscription_service.get_subscription_access(user.id)
    paddle_customer_id = access.get("paddle_customer_id")
    if paddle_customer_id:
        access["payment_history"] = fetch_paddle_transactions(paddle_customer_id)
    else:
        access["payment_history"] = []
    return access


@router.get("/api/me/platform-access")
def get_my_platform_access(user: AuthUser = Depends(get_current_user)) -> dict:
    return subscription_service.get_user_platform_access(user.id)


@router.post("/api/billing/check-upload-access")
def check_upload_access(user: AuthUser = Depends(get_current_user)) -> dict:
    return subscription_service.get_subscription_access(user.id)


@router.post("/api/usage/increment-upload")
def increment_upload_usage(
    payload: UsageIncrementIn,
    user: AuthUser = Depends(get_current_user),
) -> dict:
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
            elif internal_reason in (subscription_service.TRIAL_ALREADY_USED, subscription_service.DEVICE_OR_NETWORK_TRIAL_USED):
                reason = "already_used_trial"
            else:
                reason = "unknown"
                
        logger.info(f"[TRIAL ELIGIBILITY] user_id={short_uid} result={{'eligible': {eligible}, 'reason': '{reason}'}}")
        return {
            "eligible": eligible,
            "reason": reason
        }
    except HTTPException as ex:
        # Check if it's a configuration issue (like trial_usage table missing or TRIAL_HASH_SALT missing)
        logger.error(f"[TRIAL ELIGIBILITY ERROR] error_type=HTTPException status_code={ex.status_code} detail={ex.detail}")
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
        logger.error(f"[TRIAL ELIGIBILITY ERROR] error_type=RuntimeError detail={str(ex)}")
        return {
            "eligible": False,
            "reason": "unknown"
        }
    except Exception as ex:
        logger.error(f"[TRIAL ELIGIBILITY ERROR] error_type={type(ex).__name__} detail={str(ex)}")
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
            user.id,
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
        "[Paddle] creating customer portal session customer=%s subscription=%s",
        paddle_customer_id,
        paddle_subscription_id or "(none)",
    )
    logger.info(
        "[Paddle] api key configured=true key_prefix=%s",
        _api_key_prefix(api_key),
    )

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.post(url, headers=headers, json=body)
    except httpx.HTTPError as error:
        logger.error("[Billing] portal request failed: %s", error)
        raise HTTPException(
            status_code=502,
            detail="Could not reach Paddle to open billing portal.",
        ) from error

    logger.info("[Paddle] portal response status=%s", response.status_code)

    if response.status_code in (401, 403):
        body_text = response.text or ""
        try:
            error_code = (response.json() or {}).get("error", {}).get("code")
        except ValueError:
            error_code = None
        logger.error(
            "[Paddle] portal error status=%s code=%s body=%s",
            response.status_code,
            error_code or "(none)",
            body_text[:500],
        )
        raise HTTPException(
            status_code=502,
            detail=(
                "Paddle authentication failed. Check PADDLE_API_KEY "
                "formatting and permissions."
            ),
        )

    if response.status_code >= 400:
        body_text = response.text or ""
        try:
            error_code = (response.json() or {}).get("error", {}).get("code")
        except ValueError:
            error_code = None
        logger.error(
            "[Paddle] portal error status=%s code=%s body=%s",
            response.status_code,
            error_code or "(none)",
            body_text[:500],
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
            "[Paddle] portal session response missing URL data=%s",
            data,
        )
        raise HTTPException(
            status_code=502,
            detail="Paddle did not return a portal URL.",
        )

    logger.info(
        "[Paddle] portal session created customer=%s",
        paddle_customer_id,
    )
    return {
        "url": overview_url,
        "expires_at": data.get("expires_at"),
    }


class CheckoutRequest(BaseModel):
    plan_key: str
    billing_cycle: str = "monthly"


@router.post("/api/billing/checkout")
def get_checkout_price_id(
    payload: CheckoutRequest,
    user: AuthUser = Depends(get_current_user),
) -> dict:
    plan = (payload.plan_key or "").strip().lower()
    cycle = (payload.billing_cycle or "monthly").strip().lower()

    if plan in {"growth", "all-platforms"}:
        plan = "all_platforms"

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

    resolved_id = ""
    if plan == "redbubble":
        if cycle == "annual":
            resolved_id = config.PADDLE_REDBUBBLE_ANNUAL_PRICE_ID
        else:
            resolved_id = config.PADDLE_REDBUBBLE_MONTHLY_PRICE_ID or config.PADDLE_REDBUBBLE_PRICE_ID
    elif plan == "teepublic":
        if cycle == "annual":
            resolved_id = config.PADDLE_TEEPUBLIC_ANNUAL_PRICE_ID
        else:
            resolved_id = config.PADDLE_TEEPUBLIC_MONTHLY_PRICE_ID or config.PADDLE_TEEPUBLIC_PRICE_ID
    elif plan == "all_platforms":
        if cycle == "annual":
            resolved_id = config.PADDLE_ALL_PLATFORMS_ANNUAL_PRICE_ID
        else:
            resolved_id = config.PADDLE_ALL_PLATFORMS_MONTHLY_PRICE_ID or config.PADDLE_ALL_PLATFORMS_PRICE_ID

    if cycle == "annual" and not resolved_id:
        raise HTTPException(
            status_code=400,
            detail="Annual billing is not configured yet",
        )

    if not resolved_id:
        raise HTTPException(
            status_code=400,
            detail=f"Price not configured for plan '{payload.plan_key}' ({cycle})",
        )

    return {"price_id": resolved_id}
