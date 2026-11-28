"""Local billing safety tests; external payments and customer changes are mocked."""
import sys
import types
import unittest
from unittest.mock import patch
from fastapi import FastAPI
from fastapi.testclient import TestClient
sys.modules.setdefault("app.services.supabase_service", types.ModuleType("supabase_service"))
from app.api import billing
from app.core.auth import AuthUser, get_current_user


class BillingSafetyTests(unittest.TestCase):
    def setUp(self):
        self.user = AuthUser("test-owner", "test@example.invalid", "synthetic")
        app=FastAPI()
        app.include_router(billing.router)
        app.dependency_overrides[get_current_user]=lambda: self.user
        self.client=TestClient(app)


    def test_only_explicit_canary_user_bypasses_disabled_checkout(self):
        with patch.object(billing.config,"PADDLE_CHECKOUT_ENABLED",False), \
             patch.object(billing.config,"PADDLE_CANARY_USER_IDS",{"test-owner"}):
            billing._require_checkout_enabled("test-owner")
            with self.assertRaises(billing.HTTPException):
                billing._require_checkout_enabled("other-user")

    def test_disabled_checkout_rejects_plans_and_credit_purchases(self):
        with patch.object(billing.config,"PADDLE_CHECKOUT_ENABLED",False), \
             patch.object(billing.config,"PADDLE_CANARY_USER_IDS",set()), \
             patch.object(billing.subscription_service,"create_or_reuse_checkout_intent") as create:
            for body in ({"plan_key":"redbubble"},{"intent_type":"ai_credits","credit_pack_id":"tokens_1000"}):
                self.assertEqual(self.client.post('/api/billing/checkout',json=body).status_code,503)
            create.assert_not_called()

    def test_existing_subscription_cannot_open_duplicate_checkout(self):
        with patch.object(billing.config,"PADDLE_CHECKOUT_ENABLED",True), \
             patch.object(billing.rate_limiter,"enforce_user_limit"), \
             patch.object(billing.subscription_service,"get_user_subscription",return_value={"paddle_subscription_id":"sub_existing","status":"active"}), \
             patch.object(billing.subscription_service,"create_or_reuse_checkout_intent") as create:
            self.assertEqual(self.client.post('/api/billing/checkout',json={"plan_key":"redbubble"}).status_code,409)
            create.assert_not_called()

    def test_retired_credit_packs_are_rejected_before_external_calls(self):
        with patch.object(billing.config,"PADDLE_CHECKOUT_ENABLED",True), \
             patch.object(billing.rate_limiter,"enforce_user_limit"), \
             patch.object(billing,"_verify_credit_pack_price") as verify:
            for pack in ("tokens_250","tokens_500","tokens_2500","tokens_5000"):
                result=self.client.post('/api/billing/checkout',json={"intent_type":"ai_credits","credit_pack_id":pack})
                self.assertEqual(result.status_code,400)
            verify.assert_not_called()



    def test_portal_uses_persisted_user_binding_and_not_request_identity(self):
        with patch.object(billing.rate_limiter,"enforce_user_limit"), \
             patch.object(billing.config,"PADDLE_API_KEY","synthetic"), \
             patch.object(billing.subscription_service,"get_user_subscription",return_value={}) as subscription, \
             patch.object(billing.httpx,"AsyncClient") as external:
            self.assertEqual(self.client.post('/api/billing/customer-portal',json={"user_id":"other-user","customer_id":"ctm_other"}).status_code,400)
            subscription.assert_called_once_with("test-owner")
            external.assert_not_called()


if __name__=='__main__':unittest.main()
