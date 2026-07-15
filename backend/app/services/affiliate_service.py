"""Affiliate program domain logic.

Financial state changes use Supabase SECURITY DEFINER RPCs from
``migration_affiliate_system.sql``. API responses are user-scoped here even
though the backend client has service-role access.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import re
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any, Optional
from urllib.parse import urlsplit

from fastapi import HTTPException

from app.core import config
from app.services import supabase_service


AFFILIATE_URL = "https://podpilot.space/?ref={code}"
ATTRIBUTION_SECONDS = 30 * 24 * 60 * 60
CODE_RE = re.compile(r"^[A-Z0-9]{8,24}$")
EMAIL_RE = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")
IBAN_RE = re.compile(r"^[A-Z0-9]{15,34}$")
SWIFT_RE = re.compile(r"^[A-Z0-9]{8}(?:[A-Z0-9]{3})?$")


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


def normalize_referral_code(value: Any) -> str:
    code = str(value or "").strip().upper()
    return code if CODE_RE.fullmatch(code) else ""


def sanitize_landing_path(value: Any) -> str:
    raw = str(value or "/").strip()[:300] or "/"
    parsed = urlsplit(raw)
    if parsed.scheme or parsed.netloc or not raw.startswith("/") or raw.startswith("//"):
        return "/"
    path = parsed.path or "/"
    query = f"?{parsed.query}" if parsed.query else ""
    return (path + query)[:300]


def sanitize_referrer_origin(value: Any) -> Optional[str]:
    raw = str(value or "").strip()[:500]
    if not raw:
        return None
    parsed = urlsplit(raw)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        return None
    port = f":{parsed.port}" if parsed.port else ""
    return f"{parsed.scheme}://{parsed.hostname}{port}"[:255]


def hash_analytics(value: Any) -> Optional[str]:
    raw = str(value or "").strip()
    salt = config.AFFILIATE_ANALYTICS_SALT
    if not raw or not salt:
        return None
    return hashlib.sha256(f"{salt}:{raw}".encode("utf-8")).hexdigest()[:32]


def mask_email(value: Any) -> str:
    email = str(value or "").strip()
    if "@" not in email:
        return "PodPilot customer"
    local, domain = email.rsplit("@", 1)
    visible = local[:1] if local else "*"
    return f"{visible}{'*' * max(3, min(len(local) - 1, 8))}@{domain}"


def mask_secret(value: Any, *, visible: int = 4) -> Optional[str]:
    text = str(value or "").strip()
    if not text:
        return None
    if len(text) <= visible:
        return "•" * len(text)
    return f"{'•' * min(8, len(text) - visible)}{text[-visible:]}"


def _attribution_secret() -> bytes:
    secret = config.AFFILIATE_ATTRIBUTION_SECRET
    if not secret:
        raise HTTPException(status_code=503, detail="Affiliate attribution is not configured.")
    return secret.encode("utf-8")


def create_attribution_token(code: str, *, issued_at: Optional[datetime] = None) -> str:
    normalized = normalize_referral_code(code)
    if not normalized:
        raise ValueError("invalid referral code")
    timestamp = int((issued_at or datetime.now(timezone.utc)).timestamp())
    payload = json.dumps({"code": normalized, "iat": timestamp}, separators=(",", ":")).encode("utf-8")
    encoded = base64.urlsafe_b64encode(payload).rstrip(b"=")
    signature = hmac.new(_attribution_secret(), encoded, hashlib.sha256).digest()
    return f"{encoded.decode()}.{base64.urlsafe_b64encode(signature).rstrip(b'=').decode()}"


def decode_attribution_token(token: str, *, now: Optional[datetime] = None) -> tuple[str, datetime]:
    try:
        encoded, supplied = str(token or "").split(".", 1)
        expected = hmac.new(_attribution_secret(), encoded.encode(), hashlib.sha256).digest()
        supplied_bytes = base64.urlsafe_b64decode(supplied + "=" * (-len(supplied) % 4))
        if not hmac.compare_digest(expected, supplied_bytes):
            raise ValueError
        payload = json.loads(base64.urlsafe_b64decode(encoded + "=" * (-len(encoded) % 4)))
        code = normalize_referral_code(payload.get("code"))
        issued_at = datetime.fromtimestamp(int(payload.get("iat")), tz=timezone.utc)
    except (ValueError, TypeError, KeyError, json.JSONDecodeError, OverflowError) as error:
        raise HTTPException(status_code=400, detail="Invalid referral attribution.") from error
    current = now or datetime.now(timezone.utc)
    age = (current - issued_at).total_seconds()
    if not code or age < -300 or age > ATTRIBUTION_SECONDS:
        raise HTTPException(status_code=400, detail="Referral attribution has expired.")
    return code, issued_at


def get_account_for_user(user_id: str) -> Optional[dict[str, Any]]:
    response = _client().table("affiliate_accounts").select("*").eq("user_id", user_id).limit(1).execute()
    return _one(response)


def public_validate(code: str) -> dict[str, Any]:
    normalized = normalize_referral_code(code)
    if not normalized:
        raise HTTPException(status_code=404, detail="Referral code not found.")
    response = (
        _client().table("affiliate_accounts").select("referral_code")
        .eq("referral_code", normalized).eq("status", "active").limit(1).execute()
    )
    account = _one(response)
    if not account:
        raise HTTPException(status_code=404, detail="Referral code not found.")
    return {
        "valid": True,
        "referral_code": normalized,
        "attribution_token": create_attribution_token(normalized),
        "expires_in_seconds": ATTRIBUTION_SECONDS,
    }


def track_click(*, code: str, visitor_id: str, landing_path: str, referrer: Any, user_agent: Any, ip: Any) -> None:
    normalized = normalize_referral_code(code)
    visitor = str(visitor_id or "").strip()[:128]
    if not normalized or len(visitor) < 8:
        raise HTTPException(status_code=400, detail="Invalid click data.")
    account = _one(
        _client().table("affiliate_accounts").select("id,referral_code")
        .eq("referral_code", normalized).eq("status", "active").limit(1).execute()
    )
    if not account:
        raise HTTPException(status_code=404, detail="Referral code not found.")
    _client().table("affiliate_clicks").insert({
        "affiliate_id": account["id"],
        "referral_code": normalized,
        "anonymous_visitor_id": visitor,
        "landing_path": sanitize_landing_path(landing_path),
        "referrer_origin": sanitize_referrer_origin(referrer),
        "user_agent_hash": hash_analytics(user_agent),
        "ip_hash": hash_analytics(ip),
    }).execute()


def join(user_id: str) -> dict[str, Any]:
    account = _one(_client().rpc("affiliate_join", {"p_user_id": user_id}).execute())
    if not account:
        raise HTTPException(status_code=500, detail="Could not create affiliate account.")
    return affiliate_profile(account)


def affiliate_profile(account: dict[str, Any]) -> dict[str, Any]:
    code = str(account.get("referral_code") or "")
    return {
        "id": account.get("id"),
        "status": account.get("status"),
        "referral_code": code,
        "referral_url": AFFILIATE_URL.format(code=code),
        "payout_method": account.get("payout_method"),
        "payout_email": mask_email(account.get("payout_email")) if account.get("payout_email") else None,
        "account_name": mask_secret(account.get("account_name"), visible=2),
        "iban": mask_secret(account.get("iban")),
        "swift_code": mask_secret(account.get("swift_code")),
        "payment_settings_complete": _settings_complete(account),
        "created_at": account.get("created_at"),
    }


def _settings_complete(account: dict[str, Any]) -> bool:
    method = account.get("payout_method")
    if method == "paypal":
        return bool(account.get("payout_email"))
    if method == "bank_transfer":
        return all(account.get(key) for key in ("account_name", "iban", "swift_code"))
    return False


def attribute(user_id: str, token: str, source: str) -> dict[str, Any]:
    code, first_visit = decode_attribution_token(token)
    try:
        referral = _one(_client().rpc("affiliate_attribute", {
            "p_referred_user_id": user_id,
            "p_referral_code": code,
            "p_first_visit_at": first_visit.isoformat(),
            "p_source": str(source or "first_party")[:50],
        }).execute())
    except Exception as error:
        message = str(error)
        if "SELF_REFERRAL" in message:
            raise HTTPException(status_code=400, detail="You cannot refer yourself.") from error
        if "EXPIRED_ATTRIBUTION" in message:
            raise HTTPException(status_code=400, detail="Referral attribution has expired.") from error
        if "INVALID_REFERRAL_CODE" in message:
            raise HTTPException(status_code=404, detail="Referral code not found.") from error
        raise
    return {"attributed": bool(referral), "referral_code": referral.get("referral_code") if referral else code}


def get_attached_referral(user_id: str) -> Optional[dict[str, Any]]:
    return _one(
        _client().table("affiliate_referrals").select("affiliate_id,referral_code,attributed_at")
        .eq("referred_user_id", user_id).limit(1).execute()
    )


def update_payment_settings(user_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    account = get_account_for_user(user_id)
    if not account:
        raise HTTPException(status_code=404, detail="Join the affiliate program first.")
    method = str(payload.get("payout_method") or "").strip().lower()
    update: dict[str, Any] = {
        "payout_method": method,
        "payout_email": None,
        "account_name": None,
        "iban": None,
        "swift_code": None,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    if method == "paypal":
        email = str(payload.get("payout_email") or "").strip().lower()[:254]
        if not EMAIL_RE.fullmatch(email):
            raise HTTPException(status_code=400, detail="Enter a valid PayPal email.")
        update["payout_email"] = email
    elif method == "bank_transfer":
        name = " ".join(str(payload.get("account_name") or "").strip().split())[:120]
        iban = re.sub(r"\s+", "", str(payload.get("iban") or "").upper())
        swift = re.sub(r"\s+", "", str(payload.get("swift_code") or "").upper())
        if len(name) < 2 or not IBAN_RE.fullmatch(iban) or not SWIFT_RE.fullmatch(swift):
            raise HTTPException(status_code=400, detail="Enter valid bank transfer details.")
        update.update({"account_name": name, "iban": iban, "swift_code": swift})
    else:
        raise HTTPException(status_code=400, detail="Choose PayPal or bank transfer.")
    result = _one(_client().table("affiliate_accounts").update(update).eq("id", account["id"]).execute())
    return affiliate_profile(result or {**account, **update})


def _money(value: Any) -> float:
    try:
        return float(Decimal(str(value or 0)).quantize(Decimal("0.01")))
    except Exception:
        return 0.0


def _customer_label(user_id: str) -> str:
    try:
        result = _client().auth.admin.get_user_by_id(user_id)
        user = getattr(result, "user", None)
        return mask_email(getattr(user, "email", None))
    except Exception:
        return f"Customer {str(user_id)[:6]}••"


def dashboard(user_id: str) -> dict[str, Any]:
    account = get_account_for_user(user_id)
    if not account:
        return {"joined": False}
    affiliate_id = account["id"]
    _client().rpc("affiliate_release_commissions", {"p_affiliate_id": affiliate_id}).execute()
    commissions = _rows(
        _client().table("affiliate_commissions").select("*")
        .eq("affiliate_id", affiliate_id).order("created_at", desc=True).execute()
    )
    referrals = _rows(
        _client().table("affiliate_referrals").select("*")
        .eq("affiliate_id", affiliate_id).order("created_at", desc=True).execute()
    )
    payouts = _rows(
        _client().table("affiliate_payout_requests").select("id,amount,currency,status,requested_at,reviewed_at,paid_at,admin_note")
        .eq("affiliate_id", affiliate_id).order("requested_at", desc=True).execute()
    )
    clicks = _rows(
        _client().table("affiliate_clicks").select("id,landing_path,referrer_origin,created_at")
        .eq("affiliate_id", affiliate_id).order("created_at", desc=True).execute()
    )
    adjustments = _rows(
        _client().table("affiliate_balance_adjustments").select("amount")
        .eq("affiliate_id", affiliate_id).execute()
    )
    labels = {row["referred_user_id"]: _customer_label(row["referred_user_id"]) for row in referrals}
    pending = sum(_money(row["commission_amount"]) for row in commissions if row["status"] == "pending")
    available_gross = sum(_money(row["commission_amount"]) for row in commissions if row["status"] == "available")
    debt = sum(_money(row["amount"]) for row in adjustments)
    reserved = sum(_money(row["amount"]) for row in payouts if row["status"] in {"requested", "approved"})
    available = max(available_gross + debt - reserved, 0)
    total_earnings = sum(_money(row["commission_amount"]) for row in commissions if row["status"] != "reversed")
    total_paid = sum(_money(row["amount"]) for row in payouts if row["status"] == "paid")
    paid_users = {row["referred_user_id"] for row in commissions if row["status"] != "reversed"}
    click_count = len(clicks)
    signup_count = len(referrals)
    return {
        "joined": True,
        "profile": affiliate_profile(account),
        "balances": {
            "current": round(pending + available, 2),
            "pending": round(pending, 2),
            "available": round(available, 2),
            "reserved": round(reserved, 2),
            "total_earnings": round(total_earnings, 2),
            "total_paid": round(total_paid, 2),
        },
        "metrics": {
            "clicks": click_count,
            "signups": signup_count,
            "paid_referrals": len(paid_users),
            "conversion_rate": round((signup_count / click_count * 100) if click_count else 0, 1),
        },
        "commissions": [{**row, "referred_customer": labels.get(row["referred_user_id"], "PodPilot customer")} for row in commissions],
        "referrals": [{
            "id": row["id"],
            "customer": labels.get(row["referred_user_id"], "PodPilot customer"),
            "attributed_at": row["attributed_at"],
            "has_paid": row["referred_user_id"] in paid_users,
        } for row in referrals],
        "clicks": clicks,
        "payouts": payouts,
    }


def request_payout(user_id: str, amount: Decimal) -> dict[str, Any]:
    try:
        result = _one(_client().rpc("affiliate_request_payout", {
            "p_user_id": user_id,
            "p_amount": str(amount),
        }).execute())
    except Exception as error:
        message = str(error)
        mapping = {
            "PAYOUT_MINIMUM": "The minimum payout is $20.",
            "INSUFFICIENT_AVAILABLE_BALANCE": "Amount exceeds your available balance.",
            "OPEN_PAYOUT_EXISTS": "You already have a payout under review.",
            "PAYOUT_SETTINGS_REQUIRED": "Complete your payment settings first.",
            "INVALID_PAYOUT_INCREMENT": "Payout amount must use complete $2 commission increments.",
        }
        for code, detail in mapping.items():
            if code in message:
                raise HTTPException(status_code=409 if code == "OPEN_PAYOUT_EXISTS" else 400, detail=detail) from error
        raise
    if not result:
        raise HTTPException(status_code=500, detail="Could not create payout request.")
    result.pop("payout_method_snapshot", None)
    return result


def admin_payouts(status: Optional[str] = None) -> list[dict[str, Any]]:
    query = _client().table("affiliate_payout_requests").select("*").order("requested_at", desc=True)
    if status:
        query = query.eq("status", status)
    return _rows(query.execute())


def admin_commissions(status: Optional[str] = None) -> list[dict[str, Any]]:
    query = _client().table("affiliate_commissions").select("*").order("created_at", desc=True)
    if status:
        query = query.eq("status", status)
    return _rows(query.execute())


def review_payout(request_id: str, admin_user_id: str, status: str, note: Optional[str]) -> dict[str, Any]:
    try:
        result = _one(_client().rpc("affiliate_review_payout", {
            "p_request_id": request_id,
            "p_admin_user_id": admin_user_id,
            "p_status": status,
            "p_note": note,
        }).execute())
    except Exception as error:
        if "INVALID_PAYOUT_TRANSITION" in str(error):
            raise HTTPException(status_code=409, detail="Invalid payout status transition.") from error
        raise
    if not result:
        raise HTTPException(status_code=404, detail="Payout request not found.")
    return result


def create_commission_for_transaction(
    *, user_id: str, transaction_id: str, subscription_id: Optional[str], plan: str,
    gross_amount: Decimal, completed_at: datetime,
) -> Optional[dict[str, Any]]:
    previous = []
    if subscription_id:
        previous = _rows(
            _client().table("affiliate_commissions").select("id")
            .eq("paddle_subscription_id", subscription_id).limit(1).execute()
        )
    transaction_type = "renewal" if previous else "initial"
    return _one(_client().rpc("affiliate_create_commission", {
        "p_referred_user_id": user_id,
        "p_transaction_id": transaction_id,
        "p_subscription_id": subscription_id,
        "p_plan": plan,
        "p_transaction_type": transaction_type,
        "p_gross_amount": str(gross_amount),
        "p_completed_at": completed_at.isoformat(),
    }).execute())


def reverse_commission(transaction_id: str, reason: str) -> Optional[dict[str, Any]]:
    return _one(_client().rpc("affiliate_reverse_commission", {
        "p_transaction_id": transaction_id,
        "p_reason": reason[:200],
    }).execute())
