import sys
import types
import unittest
from unittest.mock import patch

from fastapi import HTTPException

sys.modules.setdefault("app.services.supabase_service", types.ModuleType("supabase_service"))

from app.services import subscription_service


class TrialRetirementTests(unittest.TestCase):
    def test_eligibility_is_always_closed_even_for_new_user(self):
        result = subscription_service.check_trial_eligibility(
            user_id="user-1",
            email="person@example.com",
            device_id="device-a",
            ip_address="203.0.113.10",
        )
        self.assertFalse(result["eligible"])

    def test_legacy_trial_reservation_is_gone(self):
        with self.assertRaises(HTTPException) as raised:
            subscription_service.reserve_trial_start(
                user_id="user-1",
                email="person@example.com",
                device_id="device-a",
                ip_address="203.0.113.10",
            )
        self.assertEqual(raised.exception.status_code, 410)

    def test_unpaid_historical_trial_intent_cannot_activate(self):
        intent = {"intent_type": "subscription", "user_id": "user-1", "selected_price_id": "pri_trial", "status": "opened"}
        with (
            patch.object(subscription_service, "get_checkout_intent", return_value=intent),
            patch.object(subscription_service.config, "paddle_price_has_trial", return_value=True),
        ):
            allowed, _, reason = subscription_service.validate_checkout_intent_for_webhook(
                checkout_intent_id="intent-1", user_id="user-1", selected_price_id="pri_trial", intent_type="subscription"
            )
        self.assertFalse(allowed)
        self.assertEqual(reason, "trial_retired")


if __name__ == "__main__":
    unittest.main()
