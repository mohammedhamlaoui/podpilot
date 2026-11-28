"""Synthetic local tests: no Paddle requests and no production database access."""
import hashlib
import hmac
import json
import sys
import time
import types
import unittest
from unittest.mock import MagicMock, patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

sys.modules.setdefault("app.services.supabase_service", types.ModuleType("supabase_service"))
from app.api import paddle_webhook as webhook


class PaddleWebhookTests(unittest.TestCase):
    def setUp(self):
        app = FastAPI()
        app.include_router(webhook.router)
        self.client = TestClient(app)
        self.secret = "synthetic-webhook-secret"
        self.patches = [
            patch.object(webhook.config, "PADDLE_WEBHOOK_SECRET", self.secret),
            patch.object(webhook, "_claim_webhook_event", return_value=True),
            patch.object(webhook, "_mark_webhook_event"),
            patch.object(webhook, "_mirror_admin_financial_event"),
            patch.object(webhook, "_handle_subscription_event"),
            patch.object(webhook, "_handle_transaction_event"),
            patch.object(webhook, "_handle_adjustment_event"),
        ]
        self.mocks = [p.start() for p in self.patches]
        for p in self.patches:
            self.addCleanup(p.stop)

    def send(self, event=None, *, raw=None, timestamp=None, signature=None):
        raw = raw if raw is not None else json.dumps(event or {
            "event_id": "evt_test", "event_type": "transaction.completed", "data": {},
            "occurred_at": "2026-11-28T00:00:00Z",
        }).encode()
        ts = str(int(time.time()) if timestamp is None else timestamp)
        digest = hmac.new(self.secret.encode(), ts.encode() + b":" + raw, hashlib.sha256).hexdigest()
        headers = {"Paddle-Signature": signature if signature is not None else f"ts={ts};h1={digest}"}
        return self.client.post("/api/paddle/webhook", content=raw, headers=headers)

    def test_valid_raw_body_signature(self):
        self.assertEqual(self.send().status_code, 200)

    def test_missing_signature(self):
        self.assertEqual(self.client.post("/api/paddle/webhook", json={}).status_code, 401)
        self.mocks[1].assert_not_called()

    def test_secret_missing_fails_closed(self):
        with patch.object(webhook.config, "PADDLE_WEBHOOK_SECRET", ""):
            self.assertEqual(self.send().status_code, 503)
        self.mocks[1].assert_not_called()

    def test_invalid_signature_and_modified_body(self):
        self.assertEqual(self.send(signature=f"ts={int(time.time())};h1={'0'*64}").status_code, 401)
        raw = b'{ "event_id": "evt_1" }'
        ts = str(int(time.time()))
        digest = hmac.new(self.secret.encode(), ts.encode() + b":" + raw, hashlib.sha256).hexdigest()
        self.assertEqual(self.send(raw=raw+b" ", signature=f"ts={ts};h1={digest}").status_code, 401)

    def test_expired_and_future_signatures(self):
        for timestamp in (int(time.time())-301, int(time.time())+301):
            self.assertEqual(self.send(timestamp=timestamp).status_code, 401)
        self.mocks[1].assert_not_called()

    def test_rotated_signatures(self):
        raw = b'{"event_id":"evt_rotated","event_type":"customer.updated"}'
        ts = str(int(time.time()))
        digest = hmac.new(self.secret.encode(), ts.encode()+b":"+raw, hashlib.sha256).hexdigest()
        self.assertEqual(self.send(raw=raw, signature=f"ts={ts};h1={digest};h1={'0'*64}").status_code, 200)

    def test_invalid_json_and_missing_event_identity(self):
        for raw in (b'not json', b'[]', b'{}'):
            self.assertEqual(self.send(raw=raw).status_code, 400)
        self.mocks[1].assert_not_called()

    def test_every_supported_handler_dispatch(self):
        for event_type in webhook.KNOWN_EVENT_TYPES:
            with self.subTest(event_type=event_type):
                for mock in self.mocks[3:]:
                    mock.reset_mock()
                event = {"event_id": "evt_dispatch", "event_type": event_type, "data": {"id": "synthetic"},
                         "occurred_at": "2026-11-28T00:00:00Z"}
                self.assertEqual(self.send(event).status_code, 200)
                if event_type.startswith("subscription."):
                    self.mocks[4].assert_called_once_with(event_type, event["data"], event_id="evt_dispatch", occurred_at=event["occurred_at"])
                elif event_type.startswith("adjustment."):
                    self.mocks[6].assert_called_once()
                elif event_type != "transaction.payment_failed":
                    self.mocks[5].assert_called_once()
                else:
                    self.mocks[5].assert_not_called()
                self.mocks[2].assert_called_with("evt_dispatch", "processed")

    def test_customer_events_are_explicitly_ignored(self):
        for event_type in ("customer.created", "customer.updated"):
            result = self.send({"event_id":"evt_customer", "event_type":event_type, "data":{}})
            self.assertEqual(result.json(), {"ok": True, "ignored": True})
        self.mocks[3].assert_not_called()

    def test_duplicate_does_not_fulfill_twice(self):
        self.mocks[1].side_effect = [True, False]
        self.assertEqual(self.send().status_code, 200)
        self.assertTrue(self.send().json()["duplicate"])
        self.mocks[5].assert_called_once()

    def test_failure_then_successful_retry(self):
        self.mocks[5].side_effect = [RuntimeError("synthetic database failure"), None]
        self.assertEqual(self.send().status_code, 500)
        self.mocks[2].assert_called_with("evt_test", "failed", last_error="synthetic database failure")
        self.assertEqual(self.send().status_code, 200)
        self.mocks[2].assert_called_with("evt_test", "processed")


class PaddleFulfillmentTests(unittest.TestCase):
    def setUp(self):
        self.db = MagicMock()
        self.patcher = patch.object(webhook.supabase_service, "admin_client", return_value=self.db, create=True)
        self.patcher.start()
        self.addCleanup(self.patcher.stop)

    def test_credit_fulfillment_uses_atomic_rpc(self):
        data = {"id":"txn_test", "status":"completed", "items":[{"price":{"id":"pri_test"},"quantity":1}],
                "custom_data":{"user_id":"user_test", "checkout_intent_id":"intent_test"},
                "details":{"totals":{"total":"499"}}}
        with patch.object(webhook.config, "paddle_plan_for_price_id", return_value="tokens_1000"), \
             patch.object(webhook.subscription_service, "validate_checkout_intent_for_webhook", return_value=(True, {}, "valid")):
            webhook._handle_transaction_event("evt_test", "transaction.completed", data)
        self.db.rpc.assert_called_once_with("paddle_credit_purchase", {
            "p_transaction":"txn_test", "p_event":"evt_test", "p_user":"user_test", "p_tokens":1000,
            "p_intent":"intent_test", "p_price":"pri_test", "p_amount":499})

    def test_paid_is_not_premature_credit_fulfillment(self):
        with patch.object(webhook.config, "paddle_plan_for_price_id", return_value="tokens_1000"):
            webhook._handle_transaction_event("evt_test", "transaction.paid", {"items":[{"price":{"id":"pri_test"}}]})
        self.db.rpc.assert_not_called()

    def test_renewal_and_plan_change_use_persisted_owner(self):
        for status in ("active", "past_due", "paused", "canceled"):
            with self.subTest(status=status), \
                 patch.object(webhook.config, "paddle_plan_for_price_id", return_value="teepublic"), \
                 patch.object(webhook.config, "paddle_billing_cycle_for_price_id", return_value="annual"), \
                 patch.object(webhook, "_subscription_column_exists", return_value=True), \
                 patch.object(webhook, "_find_existing_row", return_value={"user_id":"owner", "paddle_subscription_id":"sub_test", "paddle_customer_id":"ctm_test"}), \
                 patch.object(webhook.subscription_service, "validate_checkout_intent_for_webhook") as validate:
                webhook._handle_subscription_event("subscription.updated", {
                    "id":"sub_test", "customer_id":"ctm_test", "status":status,
                    "items":[{"price":{"id":"pri_new_annual"}}],
                    "current_billing_period":{"starts_at":"2026-11-28T00:00:00Z", "ends_at":"2027-11-28T00:00:00Z"}},
                    event_id="evt_renewal", occurred_at="2026-11-28T00:00:00Z")
                validate.assert_not_called()
                payload=self.db.rpc.call_args.args[1]["p_payload"]
                self.assertEqual(payload["user_id"], "owner")
                self.assertEqual(payload["status"], status)
                self.assertEqual(payload["billing_cycle"], "annual")
                self.assertNotIn("ai_tokens", payload)

    def test_cross_user_subscription_rejected(self):
        with patch.object(webhook.config, "paddle_plan_for_price_id", return_value="redbubble"), \
             patch.object(webhook, "_find_existing_row", return_value={"user_id":"owner", "paddle_subscription_id":"sub_test"}):
            with self.assertRaises(webhook.HTTPException) as raised:
                webhook._handle_subscription_event("subscription.updated", {"id":"sub_test", "items":[{"price":{"id":"pri_test"}}], "custom_data":{"user_id":"attacker"}})
            self.assertEqual(raised.exception.status_code, 422)
        self.db.rpc.assert_not_called()

    def test_unapproved_refund_has_no_effect(self):
        for status in ("pending_approval", "rejected"):
            webhook._handle_adjustment_event("adjustment.updated", {"id":"adj_test", "status":status, "action":"refund", "transaction_id":"txn_test"})
        self.db.rpc.assert_not_called()


if __name__ == "__main__":
    unittest.main()
