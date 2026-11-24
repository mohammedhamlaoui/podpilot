import unittest
import sys
import types
from unittest.mock import patch

from starlette.requests import Request

sys.modules.setdefault("app.services.supabase_service", types.ModuleType("supabase_service"))

from app.api import billing
from app.core.auth import AuthUser


class CheckoutTrialEnforcementTests(unittest.TestCase):
    def test_manipulated_frontend_cannot_force_trial_price(self):
        request = Request({
            "type": "http",
            "method": "POST",
            "path": "/api/billing/checkout",
            "headers": [(b"user-agent", b"Test Browser")],
            "client": ("203.0.113.10", 1234),
        })
        user = AuthUser(id="user-1", email="person@example.com", access_token="token")
        payload = billing.CheckoutRequest(plan_key="redbubble", billing_cycle="monthly")

        with (
            patch.object(billing.rate_limiter, "enforce_user_limit"),
            patch.object(billing.subscription_service, "create_or_reuse_checkout_intent", return_value=({"id": "intent-1", "status": "opened"}, False)) as create_intent,
            patch.object(billing, "_verify_relaunch_subscription_price"),
            patch.object(billing.config, "PADDLE_REDBUBBLE_MONTHLY_PRICE_ID", "pri_paid"),
        ):
            result = billing.get_checkout_price_id(
                payload=payload,
                request=request,
                user=user,
                x_podpilot_device_id="device-a",
            )

        self.assertFalse(result["trial_eligible"])
        self.assertEqual(result["selected_price_id"], "pri_paid")
        self.assertEqual(result["display_cta"], "subscribe")
        self.assertEqual(create_intent.call_args.kwargs["selected_price_id"], "pri_paid")


if __name__ == "__main__":
    unittest.main()
