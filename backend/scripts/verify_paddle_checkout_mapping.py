"""Print Paddle checkout mapping with fake IDs only.

Run from ``backend`` after installing requirements:

    python scripts/verify_paddle_checkout_mapping.py

The script sets fake env values before importing the billing module, so it
never needs real Paddle price IDs or secrets.
"""
from __future__ import annotations

import os
import sys
import types
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


FAKE_ENV = {
    "SUPABASE_URL": "https://example.supabase.co",
    "SUPABASE_ANON_KEY": "anon",
    "SUPABASE_SERVICE_ROLE_KEY": "service",
    "R2_ACCOUNT_ID": "account",
    "R2_ACCESS_KEY_ID": "access",
    "R2_SECRET_ACCESS_KEY": "secret",
    "PADDLE_REDBUBBLE_MONTHLY_PRICE_ID": "fake_rb_month_paid",
    "PADDLE_REDBUBBLE_ANNUAL_PRICE_ID": "fake_rb_year_paid",
    "PADDLE_TEEPUBLIC_MONTHLY_PRICE_ID": "fake_tp_month_paid",
    "PADDLE_TEEPUBLIC_ANNUAL_PRICE_ID": "fake_tp_year_paid",
    "PADDLE_ALL_PLATFORMS_MONTHLY_PRICE_ID": "fake_all_month_paid",
    "PADDLE_ALL_PLATFORMS_ANNUAL_PRICE_ID": "fake_all_year_paid",
    "PADDLE_AI_TOKENS_250_PRICE_ID": "fake_ai_250",
    "PADDLE_AI_TOKENS_500_PRICE_ID": "fake_ai_500",
    "PADDLE_AI_TOKENS_1000_PRICE_ID": "fake_ai_1000",
    "PADDLE_AI_TOKENS_2500_PRICE_ID": "fake_ai_2500",
    "PADDLE_AI_TOKENS_5000_PRICE_ID": "fake_ai_5000",
    "PADDLE_AI_TOKENS_10000_PRICE_ID": "fake_ai_10000",
}

for key, value in FAKE_ENV.items():
    os.environ[key] = value

if "dotenv" not in sys.modules:
    dotenv_stub = types.ModuleType("dotenv")
    dotenv_stub.load_dotenv = lambda *args, **kwargs: None
    sys.modules["dotenv"] = dotenv_stub

from app.core import config  # noqa: E402


def normalize_credit_pack_id(credit_pack_id: str) -> str:
    value = str(credit_pack_id or "").strip().lower()
    if value.startswith("ai_credits_"):
        return "tokens_" + value.removeprefix("ai_credits_")
    return value


def resolve_credit_pack_price_id(credit_pack_id: str) -> str:
    pack = config.AI_TOKEN_PACKS.get(credit_pack_id)
    if not pack:
        return ""
    return (pack[1] or "").strip()


def resolve_subscription_price_id(*, plan: str, cycle: str) -> str:
    price_map = {
        ("redbubble", "monthly"): config.PADDLE_REDBUBBLE_MONTHLY_PRICE_ID,
        ("redbubble", "annual"): config.PADDLE_REDBUBBLE_ANNUAL_PRICE_ID,
        ("teepublic", "monthly"): config.PADDLE_TEEPUBLIC_MONTHLY_PRICE_ID,
        ("teepublic", "annual"): config.PADDLE_TEEPUBLIC_ANNUAL_PRICE_ID,
        ("all_platforms", "monthly"): config.PADDLE_ALL_PLATFORMS_MONTHLY_PRICE_ID,
        ("all_platforms", "annual"): config.PADDLE_ALL_PLATFORMS_ANNUAL_PRICE_ID,
    }
    return (price_map.get((plan, cycle)) or "").strip()


def main() -> None:
    for plan in ("redbubble", "teepublic", "all_platforms"):
        for billing in ("monthly", "annual"):
            price = resolve_subscription_price_id(plan=plan, cycle=billing)
            print(f"{plan} {billing}: {price}")

    for pack in ("250", "500", "1000", "2500", "5000", "10000"):
        public_id = f"ai_credits_{pack}"
        normalized = normalize_credit_pack_id(public_id)
        price = resolve_credit_pack_price_id(normalized)
        print(f"{public_id} -> {normalized}: {price}")


if __name__ == "__main__":
    main()
