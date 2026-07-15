"""Affiliate/referral HTTP API."""
from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import Literal, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request
from pydantic import BaseModel, Field

from app.core.auth import AuthUser, get_current_user, require_admin
from app.services import admin_affiliate_service, affiliate_service, rate_limiter


router = APIRouter()


class TrackClickIn(BaseModel):
    referral_code: str = Field(min_length=1, max_length=32)
    anonymous_visitor_id: str = Field(min_length=8, max_length=128)
    landing_path: str = Field(default="/", max_length=500)
    referrer: Optional[str] = Field(default=None, max_length=500)


class AttributeIn(BaseModel):
    attribution_token: str = Field(min_length=20, max_length=1000)
    attribution_source: str = Field(default="first_party", max_length=50)


class PaymentSettingsIn(BaseModel):
    payout_method: Literal["paypal", "bank_transfer"]
    payout_email: Optional[str] = Field(default=None, max_length=254)
    account_name: Optional[str] = Field(default=None, max_length=120)
    iban: Optional[str] = Field(default=None, max_length=50)
    swift_code: Optional[str] = Field(default=None, max_length=20)


class PayoutRequestIn(BaseModel):
    amount: Decimal = Field(gt=0, decimal_places=2, max_digits=12)


class PayoutReviewIn(BaseModel):
    status: Literal["approved", "paid", "rejected"]
    admin_note: Optional[str] = Field(default=None, max_length=1000)


class AffiliateStatusIn(BaseModel):
    status: Literal["active", "suspended"]
    admin_note: Optional[str] = Field(default=None, max_length=1000)


@router.get("/api/affiliate/validate")
def validate_referral(request: Request, code: str = Query(min_length=1, max_length=32)) -> dict:
    rate_limiter.enforce_ip_limit(request, rate_limiter.AFFILIATE_PUBLIC)
    return affiliate_service.public_validate(code)


@router.post("/api/affiliate/track-click", status_code=202)
def track_click(payload: TrackClickIn, request: Request) -> dict:
    rate_limiter.enforce_ip_limit(request, rate_limiter.AFFILIATE_PUBLIC)
    affiliate_service.track_click(
        code=payload.referral_code,
        visitor_id=payload.anonymous_visitor_id,
        landing_path=payload.landing_path,
        referrer=payload.referrer,
        user_agent=request.headers.get("user-agent"),
        ip=rate_limiter.client_ip(request),
    )
    return {"accepted": True}


@router.get("/api/affiliate/me")
def affiliate_me(user: AuthUser = Depends(get_current_user)) -> dict:
    account = affiliate_service.get_account_for_user(user.id)
    return {"joined": bool(account), "profile": affiliate_service.affiliate_profile(account) if account else None}


@router.post("/api/affiliate/join")
def join_affiliate(request: Request, user: AuthUser = Depends(get_current_user)) -> dict:
    rate_limiter.enforce_user_limit(user.id, rate_limiter.AFFILIATE_WRITE)
    return {"joined": True, "profile": affiliate_service.join(user.id)}


@router.post("/api/affiliate/attribute")
def attribute_referral(payload: AttributeIn, request: Request, user: AuthUser = Depends(get_current_user)) -> dict:
    rate_limiter.enforce_user_limit(user.id, rate_limiter.AFFILIATE_WRITE)
    return affiliate_service.attribute(user.id, payload.attribution_token, payload.attribution_source)


@router.get("/api/affiliate/dashboard")
def affiliate_dashboard(user: AuthUser = Depends(get_current_user)) -> dict:
    return affiliate_service.dashboard(user.id)


@router.get("/api/affiliate/commissions")
def affiliate_commissions(user: AuthUser = Depends(get_current_user)) -> dict:
    data = affiliate_service.dashboard(user.id)
    return {"commissions": data.get("commissions", [])}


@router.get("/api/affiliate/referrals")
def affiliate_referrals(user: AuthUser = Depends(get_current_user)) -> dict:
    data = affiliate_service.dashboard(user.id)
    return {"referrals": data.get("referrals", [])}


@router.get("/api/affiliate/clicks")
def affiliate_clicks(user: AuthUser = Depends(get_current_user)) -> dict:
    data = affiliate_service.dashboard(user.id)
    return {"clicks": data.get("clicks", [])}


@router.patch("/api/affiliate/payment-settings")
def payment_settings(payload: PaymentSettingsIn, request: Request, user: AuthUser = Depends(get_current_user)) -> dict:
    rate_limiter.enforce_user_limit(user.id, rate_limiter.AFFILIATE_WRITE)
    return {"profile": affiliate_service.update_payment_settings(user.id, payload.model_dump())}


@router.post("/api/affiliate/payout-requests")
def payout_request(payload: PayoutRequestIn, request: Request, user: AuthUser = Depends(get_current_user)) -> dict:
    rate_limiter.enforce_user_limit(user.id, rate_limiter.AFFILIATE_WRITE)
    return {"payout_request": affiliate_service.request_payout(user.id, payload.amount)}


@router.get("/api/admin/affiliate/overview")
def admin_affiliate_overview(_admin: AuthUser = Depends(require_admin)) -> dict:
    return admin_affiliate_service.overview()


@router.get("/api/admin/affiliate/accounts")
def admin_affiliate_accounts(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=25, ge=10, le=100),
    search: Optional[str] = Query(default=None, max_length=120),
    status: Optional[str] = Query(default=None),
    date_from: Optional[date] = Query(default=None),
    date_to: Optional[date] = Query(default=None),
    _admin: AuthUser = Depends(require_admin),
) -> dict:
    return admin_affiliate_service.list_accounts(
        page=page, page_size=page_size, search=search, status=status,
        date_from=date_from, date_to=date_to,
    )


@router.get("/api/admin/affiliate/accounts/{affiliate_id}")
def admin_affiliate_account_detail(
    affiliate_id: UUID,
    _admin: AuthUser = Depends(require_admin),
) -> dict:
    return admin_affiliate_service.account_detail(str(affiliate_id))


@router.patch("/api/admin/affiliate/accounts/{affiliate_id}/status")
def admin_affiliate_account_status(
    affiliate_id: UUID,
    payload: AffiliateStatusIn,
    admin: AuthUser = Depends(require_admin),
) -> dict:
    return {
        "account": admin_affiliate_service.set_account_status(
            str(affiliate_id), admin.id, payload.status, payload.admin_note,
        )
    }


@router.get("/api/admin/affiliate/activity")
def admin_affiliate_activity(_admin: AuthUser = Depends(require_admin)) -> dict:
    return admin_affiliate_service.activity()


@router.get("/api/admin/affiliate/payout-requests")
def admin_payout_requests(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=25, ge=10, le=100),
    status: Optional[str] = Query(default=None),
    affiliate_id: Optional[UUID] = Query(default=None),
    search: Optional[str] = Query(default=None, max_length=120),
    date_from: Optional[date] = Query(default=None),
    date_to: Optional[date] = Query(default=None),
    _admin: AuthUser = Depends(require_admin),
) -> dict:
    data = admin_affiliate_service.list_payouts(
        page=page, page_size=page_size, status=status, affiliate_id=str(affiliate_id) if affiliate_id else None,
        search=search, date_from=date_from, date_to=date_to,
    )
    return {**data, "payout_requests": data["items"]}


@router.patch("/api/admin/affiliate/payout-requests/{request_id}")
def admin_review_payout(
    request_id: UUID,
    payload: PayoutReviewIn,
    admin: AuthUser = Depends(require_admin),
) -> dict:
    return {
        "payout_request": admin_affiliate_service.review_payout(
            str(request_id), admin.id, payload.status, payload.admin_note,
        )
    }


@router.get("/api/admin/affiliate/commissions")
def admin_affiliate_commissions(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=25, ge=10, le=100),
    status: Optional[str] = Query(default=None),
    affiliate_id: Optional[UUID] = Query(default=None),
    plan: Optional[str] = Query(default=None),
    transaction_type: Optional[str] = Query(default=None),
    search: Optional[str] = Query(default=None, max_length=120),
    date_from: Optional[date] = Query(default=None),
    date_to: Optional[date] = Query(default=None),
    _admin: AuthUser = Depends(require_admin),
) -> dict:
    data = admin_affiliate_service.list_commissions(
        page=page, page_size=page_size, status=status, affiliate_id=str(affiliate_id) if affiliate_id else None,
        plan=plan, transaction_type=transaction_type, search=search,
        date_from=date_from, date_to=date_to,
    )
    return {**data, "commissions": data["items"]}
