import asyncio
import os
import sys
import unittest
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from pathlib import Path
from types import SimpleNamespace
import types
from unittest.mock import MagicMock, patch


sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
if "app.services.supabase_service" not in sys.modules:
    supabase_stub = types.ModuleType("app.services.supabase_service")
    supabase_stub.admin_client = MagicMock()
    sys.modules["app.services.supabase_service"] = supabase_stub

from fastapi import HTTPException
from starlette.requests import Request

from app.api import paddle_webhook
from app.services import affiliate_service


class FakeRpc:
    def __init__(self, data=None, error=None):
        self.data = data
        self.error = error

    def execute(self):
        if self.error:
            raise self.error
        return SimpleNamespace(data=self.data)


class RpcClient:
    def __init__(self, responses=None):
        self.responses = responses or {}
        self.calls = []

    def rpc(self, name, params):
        self.calls.append((name, params))
        response = self.responses.get(name)
        if callable(response):
            response = response(params)
        if isinstance(response, Exception):
            return FakeRpc(error=response)
        return FakeRpc(response)


class Query:
    def __init__(self, data):
        self.data = data

    def select(self, *_args, **_kwargs): return self
    def eq(self, *_args, **_kwargs): return self
    def limit(self, *_args, **_kwargs): return self
    def order(self, *_args, **_kwargs): return self
    def execute(self): return SimpleNamespace(data=self.data)


class CommissionClient(RpcClient):
    def __init__(self, previous):
        super().__init__()
        self.previous = previous

    def table(self, _name):
        return Query([{"id": "prior"}] if self.previous else [])

    def rpc(self, name, params):
        self.calls.append((name, params))
        return FakeRpc([{**params, "transaction_type": params["p_transaction_type"]}])


class AffiliateAccountTests(unittest.TestCase):
    def test_affiliate_joining_is_idempotent(self):
        account = {"id": "a1", "user_id": "u1", "referral_code": "ABCDEF123456", "status": "active"}
        client = RpcClient({"affiliate_join": [account]})
        with patch.object(affiliate_service, "_client", return_value=client):
            result = affiliate_service.join("u1")
        self.assertEqual(result["referral_code"], "ABCDEF123456")
        self.assertEqual(result["referral_url"], "https://podpilot.space/?ref=ABCDEF123456")
        self.assertEqual(client.calls[0][1]["p_user_id"], "u1")

    def test_valid_referral_attribution(self):
        now = datetime.now(timezone.utc)
        client = RpcClient({"affiliate_attribute": [{"id": "r1", "referral_code": "ABCDEF123456"}]})
        with (
            patch.object(affiliate_service.config, "AFFILIATE_ATTRIBUTION_SECRET", "test-secret"),
            patch.object(affiliate_service, "_client", return_value=client),
        ):
            token = affiliate_service.create_attribution_token("ABCDEF123456", issued_at=now)
            result = affiliate_service.attribute("buyer", token, "first_party_cookie")
        self.assertTrue(result["attributed"])
        self.assertEqual(client.calls[0][1]["p_referred_user_id"], "buyer")

    def test_expired_referral_cookie(self):
        with patch.object(affiliate_service.config, "AFFILIATE_ATTRIBUTION_SECRET", "test-secret"):
            token = affiliate_service.create_attribution_token(
                "ABCDEF123456", issued_at=datetime.now(timezone.utc) - timedelta(days=31)
            )
            with self.assertRaises(HTTPException) as raised:
                affiliate_service.decode_attribution_token(token)
        self.assertEqual(raised.exception.status_code, 400)

    def test_invalid_code_rejected_before_lookup(self):
        self.assertEqual(affiliate_service.normalize_referral_code("../bad"), "")
        with self.assertRaises(HTTPException) as raised:
            affiliate_service.public_validate("../bad")
        self.assertEqual(raised.exception.status_code, 404)

    def test_self_referral_is_rejected(self):
        client = RpcClient({"affiliate_attribute": Exception("SELF_REFERRAL")})
        with (
            patch.object(affiliate_service.config, "AFFILIATE_ATTRIBUTION_SECRET", "test-secret"),
            patch.object(affiliate_service, "_client", return_value=client),
        ):
            token = affiliate_service.create_attribution_token("ABCDEF123456")
            with self.assertRaises(HTTPException) as raised:
                affiliate_service.attribute("affiliate-user", token, "cookie")
        self.assertIn("cannot refer yourself", raised.exception.detail)

    def test_duplicate_attribution_returns_permanent_existing_referral(self):
        existing = {"id": "existing", "referral_code": "ORIGINAL1234"}
        client = RpcClient({"affiliate_attribute": [existing]})
        with (
            patch.object(affiliate_service.config, "AFFILIATE_ATTRIBUTION_SECRET", "test-secret"),
            patch.object(affiliate_service, "_client", return_value=client),
        ):
            token = affiliate_service.create_attribution_token("NEWCODE12345")
            result = affiliate_service.attribute("buyer", token, "cookie")
        self.assertEqual(result["referral_code"], "ORIGINAL1234")


class AffiliateCommissionTests(unittest.TestCase):
    def _subscription_data(self, *, status="completed", total="1200"):
        return {
            "id": "txn_1",
            "status": status,
            "subscription_id": "sub_1",
            "customer_id": "ctm_1",
            "currency_code": "USD",
            "billed_at": "2026-01-01T12:00:00Z",
            "details": {"totals": {"grand_total": total}},
            "items": [{"price": {"id": "pri_subscription"}}],
            "custom_data": {"user_id": "buyer", "checkout_intent_id": "intent_1"},
        }

    def test_completed_initial_subscription_payment_creates_two_dollar_commission(self):
        create = MagicMock(return_value={"id": "c1", "transaction_type": "initial"})
        with (
            patch.object(paddle_webhook.config, "paddle_plan_for_price_id", return_value="redbubble"),
            patch.object(paddle_webhook.config, "paddle_price_has_trial", return_value=False),
            patch.object(paddle_webhook.subscription_service, "validate_checkout_intent_for_webhook", return_value=(True, {"id": "intent_1", "user_id": "buyer"}, "valid")),
            patch.object(paddle_webhook.subscription_service, "mark_checkout_intent_paid"),
            patch.object(paddle_webhook, "_resolve_transaction_user", return_value="buyer"),
            patch.object(paddle_webhook.affiliate_service, "create_commission_for_transaction", create),
        ):
            paddle_webhook._handle_transaction_event("evt_1", "transaction.completed", self._subscription_data())
        self.assertEqual(create.call_count, 1)
        self.assertEqual(create.call_args.kwargs["gross_amount"], Decimal("12.00"))
        self.assertEqual(create.call_args.kwargs["plan"], "redbubble")

    def test_completed_renewal_is_labeled_from_existing_subscription_commission(self):
        client = CommissionClient(previous=True)
        with patch.object(affiliate_service, "_client", return_value=client):
            result = affiliate_service.create_commission_for_transaction(
                user_id="buyer", transaction_id="txn_renew", subscription_id="sub_1",
                plan="teepublic", gross_amount=Decimal("9.00"),
                completed_at=datetime.now(timezone.utc),
            )
        self.assertEqual(result["transaction_type"], "renewal")

    def test_initial_payment_is_labeled_without_previous_commission(self):
        client = CommissionClient(previous=False)
        with patch.object(affiliate_service, "_client", return_value=client):
            result = affiliate_service.create_commission_for_transaction(
                user_id="buyer", transaction_id="txn_initial", subscription_id="sub_1",
                plan="all_platforms", gross_amount=Decimal("19.00"),
                completed_at=datetime.now(timezone.utc),
            )
        self.assertEqual(result["transaction_type"], "initial")

    def test_ai_credit_purchase_is_excluded(self):
        create = MagicMock()
        data = self._subscription_data()
        data["custom_data"] = {}
        with (
            patch.object(paddle_webhook.config, "paddle_plan_for_price_id", return_value="tokens_250"),
            patch.object(paddle_webhook.config, "AI_TOKEN_PACKS", {"tokens_250": (250, "pri_subscription")}),
            patch.object(paddle_webhook.affiliate_service, "create_commission_for_transaction", create),
        ):
            paddle_webhook._handle_transaction_event("evt_credit", "transaction.completed", data)
        create.assert_not_called()

    def test_failed_or_past_due_transaction_is_excluded(self):
        create = MagicMock()
        with (
            patch.object(paddle_webhook.config, "paddle_plan_for_price_id", return_value="redbubble"),
            patch.object(paddle_webhook.config, "paddle_price_has_trial", return_value=False),
            patch.object(paddle_webhook.subscription_service, "validate_checkout_intent_for_webhook", return_value=(True, {"id": "intent_1", "user_id": "buyer"}, "valid")),
            patch.object(paddle_webhook.subscription_service, "mark_checkout_intent_paid"),
            patch.object(paddle_webhook, "_resolve_transaction_user", return_value="buyer"),
            patch.object(paddle_webhook.affiliate_service, "create_commission_for_transaction", create),
        ):
            paddle_webhook._handle_transaction_event("evt_failed", "transaction.completed", self._subscription_data(status="past_due"))
        create.assert_not_called()

    def test_duplicate_transaction_is_database_idempotent(self):
        sql = Path("docs/migration_affiliate_system.sql").read_text(encoding="utf-8")
        self.assertIn("paddle_transaction_id text not null unique", sql)
        self.assertIn("on conflict (paddle_transaction_id) do nothing", sql)

    def test_refund_reversal(self):
        reverse = MagicMock(return_value={"id": "c1"})
        with patch.object(paddle_webhook.affiliate_service, "reverse_commission", reverse):
            paddle_webhook._handle_adjustment_event("adjustment.updated", {"status": "approved", "action": "refund", "transaction_id": "txn_1"})
        reverse.assert_called_once_with("txn_1", "refund")

    def test_chargeback_reversal(self):
        reverse = MagicMock(return_value={"id": "c1"})
        with patch.object(paddle_webhook.affiliate_service, "reverse_commission", reverse):
            paddle_webhook._handle_adjustment_event("adjustment.updated", {"status": "approved", "action": "chargeback", "transaction_id": "txn_1"})
        reverse.assert_called_once_with("txn_1", "chargeback")


class AffiliatePayoutAndSecurityTests(unittest.TestCase):
    def test_pending_to_available_transition_is_atomic(self):
        sql = Path("docs/migration_affiliate_system.sql").read_text(encoding="utf-8")
        self.assertIn("status = 'available'", sql)
        self.assertIn("status = 'pending' and hold_until <= now()", sql)

    def test_payout_minimum(self):
        client = RpcClient({"affiliate_request_payout": Exception("PAYOUT_MINIMUM")})
        with patch.object(affiliate_service, "_client", return_value=client):
            with self.assertRaises(HTTPException) as raised:
                affiliate_service.request_payout("u1", Decimal("18.00"))
        self.assertEqual(raised.exception.status_code, 400)

    def test_duplicate_payout_request(self):
        client = RpcClient({"affiliate_request_payout": Exception("OPEN_PAYOUT_EXISTS")})
        with patch.object(affiliate_service, "_client", return_value=client):
            with self.assertRaises(HTTPException) as raised:
                affiliate_service.request_payout("u1", Decimal("20.00"))
        self.assertEqual(raised.exception.status_code, 409)

    def test_payout_rejection_releases_reservation_and_is_audited(self):
        sql = Path("docs/migration_affiliate_system.sql").read_text(encoding="utf-8")
        self.assertIn("status in ('requested','approved')", sql)
        self.assertIn("affiliate_payout_audit_logs", sql)
        self.assertIn("to_status", sql)

    def test_rls_access_isolation(self):
        sql = Path("docs/migration_affiliate_system.sql").read_text(encoding="utf-8")
        for table in ("affiliate_accounts", "affiliate_referrals", "affiliate_clicks", "affiliate_commissions", "affiliate_payout_requests"):
            self.assertIn(f"alter table public.{table} enable row level security", sql)
        self.assertIn("auth.uid() = user_id", sql)
        self.assertIn("revoke all on public.affiliate_accounts", sql)


if __name__ == "__main__":
    unittest.main()
