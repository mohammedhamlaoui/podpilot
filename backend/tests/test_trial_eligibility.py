import sys
import types
import unittest
from unittest.mock import patch

sys.modules.setdefault("app.services.supabase_service", types.ModuleType("supabase_service"))

from app.services import subscription_service


class TrialEligibilityTests(unittest.TestCase):
    def _check(self, *, history=None, matches=None, paid_intent=None, device="device-a", ip="203.0.113.10"):
        matches = matches or {}

        def first_match(column, value):
            return matches.get(column)

        with (
            patch.object(subscription_service, "get_user_subscription_history", return_value=history or []),
            patch.object(subscription_service, "_first_trial_usage_match", side_effect=first_match),
            patch.object(subscription_service, "get_latest_paid_subscription_intent", return_value=paid_intent),
            patch.object(subscription_service, "_first_subscription_match", return_value=None),
            patch.object(subscription_service.config, "TRIAL_HASH_SALT", "test-only-salt"),
        ):
            return subscription_service.check_trial_eligibility(
                user_id="user-1",
                email="person@example.com",
                device_id=device,
                ip_address=ip,
                user_agent="Test Browser",
            )

    def test_new_user_and_device_are_eligible(self):
        result = self._check()
        self.assertTrue(result["eligible"])
        self.assertEqual(result["reason"], subscription_service.TRIAL_ELIGIBLE)

    def test_same_user_after_trial_is_ineligible(self):
        result = self._check(matches={"user_id": {"id": "usage-1"}})
        self.assertFalse(result["eligible"])
        self.assertEqual(result["reason"], subscription_service.TRIAL_ALREADY_USED)

    def test_new_account_on_same_device_is_ineligible(self):
        result = self._check(matches={"device_id_hash": {"id": "usage-1"}})
        self.assertFalse(result["eligible"])
        self.assertEqual(result["reason"], subscription_service.DEVICE_TRIAL_USED)

    def test_same_ip_alone_does_not_block(self):
        # IP is deliberately absent from the hard-denial match sequence.
        result = self._check(matches={"ip_hash": {"id": "usage-1"}})
        self.assertTrue(result["eligible"])

    def test_admin_override_allows_only_overridden_user(self):
        result = self._check(
            history=[{"plan": "redbubble", "status": "canceled", "allow_trial_again": True, "paddle_price_id": "pri_old"}],
            matches={"user_id": {"id": "usage-1"}, "device_id_hash": {"id": "usage-2"}},
        )
        self.assertTrue(result["eligible"])
        self.assertEqual(result["reason"], subscription_service.ADMIN_TRIAL_OVERRIDE)

    def test_active_subscription_wins_over_admin_override(self):
        result = self._check(
            history=[{
                "plan": "redbubble",
                "status": "active",
                "allow_trial_again": True,
                "paddle_price_id": "pri_live",
                "current_period_ends_at": "2099-01-01T00:00:00+00:00",
            }],
        )
        self.assertFalse(result["eligible"])
        self.assertEqual(result["reason"], subscription_service.ACTIVE_SUBSCRIPTION_EXISTS)


if __name__ == "__main__":
    unittest.main()
