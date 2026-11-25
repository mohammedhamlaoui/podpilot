import unittest
import sys
import types
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

# These unit tests exercise pure billing metadata helpers and do not require a
# Supabase client. Keep the backend test runnable without optional SDK installs.
sys.modules.setdefault("app.services.supabase_service", types.ModuleType("supabase_service"))

from app.services import subscription_service
from app.services.subscription_service import get_subscription_billing_details


class SubscriptionBillingDetailsTests(unittest.TestCase):
    @staticmethod
    def _access_for(subscription):
        with (
            patch.object(subscription_service, "get_user_subscription", return_value=subscription),
            patch.object(subscription_service, "get_user_monthly_usage", return_value={"uploaded_count": 0}),
            patch.object(subscription_service, "get_user_daily_ai_usage", return_value={"used_count": 1}),
        ):
            return subscription_service.get_subscription_access("user-1")

    @staticmethod
    def _platform_access_for(subscription):
        with patch.object(subscription_service, "get_user_subscription", return_value=subscription):
            return subscription_service.get_user_platform_access("user-1")

    def test_annual_trial_price_id_resolves_cycle_and_catalog_price(self):
        with patch(
            "app.core.config.PADDLE_ALL_PLATFORMS_ANNUAL_TRIAL_PRICE_ID",
            "pri_all_annual_trial",
        ):
            details = get_subscription_billing_details({
                "plan": "all_platforms",
                "paddle_price_id": "pri_all_annual_trial",
            })

        self.assertEqual(details["plan_label"], "All Platforms Plan")
        self.assertEqual(details["billing_cycle"], "annual")
        self.assertEqual(details["price_display"], "$69.90 annually")
        self.assertEqual(details["monthly_equivalent_display"], "$5.83 / month")

    def test_monthly_price_id_resolves_monthly_price(self):
        with patch(
            "app.core.config.PADDLE_REDBUBBLE_MONTHLY_PRICE_ID",
            "pri_redbubble_monthly",
        ):
            details = get_subscription_billing_details({
                "plan": "redbubble",
                "paddle_price_id": "pri_redbubble_monthly",
            })

        self.assertEqual(details["billing_cycle"], "monthly")
        self.assertEqual(details["price_display"], "$8.99 / month")

    def test_legacy_paid_price_keeps_original_amount(self):
        with patch.dict(subscription_service.config.LEGACY_SUBSCRIPTION_PRICES, {("redbubble", "monthly"): "pri_old_redbubble"}):
            details = get_subscription_billing_details({
                "plan": "redbubble",
                "paddle_price_id": "pri_old_redbubble",
            })
        self.assertEqual(details["price_display"], "$4.99 / month")

    def test_stored_cycle_is_used_when_price_id_is_unmapped(self):
        details = get_subscription_billing_details({
            "plan": "teepublic",
            "billing_cycle": "annual",
            "paddle_price_id": "pri_legacy_unmapped",
        })

        self.assertEqual(details["billing_cycle"], "annual")
        self.assertIsNone(details["price_display"])
        self.assertIsNone(details["monthly_equivalent_display"])

    def test_trialing_all_platforms_annual_response_is_complete(self):
        with patch(
            "app.core.config.PADDLE_ALL_PLATFORMS_ANNUAL_TRIAL_PRICE_ID",
            "pri_all_annual_trial",
        ):
            access = self._access_for({
                "plan": "all_platforms",
                "status": "trialing",
                "paddle_price_id": "pri_all_annual_trial",
                "paddle_subscription_id": "sub_1",
                "trial_ends_at": "2099-06-27T00:00:00+00:00",
                "current_period_ends_at": "2099-06-27T00:00:00+00:00",
                "cancel_at_period_end": False,
                "ai_tokens": 4,
            })

        self.assertEqual(access["billing_cycle"], "annual")
        self.assertEqual(access["price_display"], "$69.90 annually")
        self.assertEqual(access["status"], "trialing")
        self.assertEqual(access["next_payment_date"], "2099-06-27T00:00:00+00:00")
        self.assertEqual(access["platform_access"], ["redbubble", "teepublic"])
        self.assertEqual(access["daily_ai_tokens_limit"], 75)
        self.assertEqual(access["extra_ai_tokens"], 4)

    def test_active_redbubble_monthly_response_is_complete(self):
        with patch(
            "app.core.config.PADDLE_REDBUBBLE_MONTHLY_PRICE_ID",
            "pri_redbubble_monthly",
        ):
            access = self._access_for({
                "plan": "redbubble",
                "status": "active",
                "paddle_price_id": "pri_redbubble_monthly",
                "paddle_subscription_id": "sub_2",
                "current_period_ends_at": "2099-07-01T00:00:00+00:00",
                "cancel_at_period_end": False,
            })

        self.assertEqual(access["billing_cycle"], "monthly")
        self.assertEqual(access["price_display"], "$8.99 / month")
        self.assertEqual(access["renewal_behavior"], "renews_automatically")
        self.assertEqual(access["platform_access"], ["redbubble"])

    def test_cancel_at_period_end_preserves_access_and_reports_renewal(self):
        access = self._access_for({
            "plan": "teepublic",
            "status": "active",
            "billing_cycle": "monthly",
            "paddle_subscription_id": "sub_3",
            "current_period_ends_at": "2099-07-01T00:00:00+00:00",
            "cancel_at_period_end": True,
        })

        self.assertTrue(access["has_active_subscription"])
        self.assertEqual(access["renewal_behavior"], "ends_at_period_close")
        self.assertEqual(access["platform_access"], ["teepublic"])

    def test_no_subscription_response_remains_locked(self):
        access = self._access_for(None)

        self.assertFalse(access["has_subscription"])
        self.assertFalse(access["has_active_subscription"])
        self.assertFalse(access["can_upload"])

    def test_past_due_within_grace_keeps_plan_access_and_warns(self):
        period_end = datetime.now(timezone.utc) - timedelta(days=1)
        subscription = {
            "plan": "all_platforms",
            "status": "past_due",
            "paddle_subscription_id": "sub_past_due_grace",
            "current_period_ends_at": period_end.isoformat(),
        }

        access = self._access_for(subscription)
        platform_access = self._platform_access_for(subscription)

        self.assertTrue(access["has_active_subscription"])
        self.assertTrue(access["can_upload"])
        self.assertTrue(access["is_past_due"])
        self.assertTrue(access["past_due_grace_active"])
        self.assertFalse(access["payment_recovery_required"])
        self.assertEqual(access["platform_access"], ["redbubble", "teepublic"])
        self.assertTrue(platform_access["redbubble"])
        self.assertTrue(platform_access["teepublic"])

    def test_past_due_after_grace_locks_paid_access(self):
        period_end = datetime.now(timezone.utc) - timedelta(days=4)
        subscription = {
            "plan": "redbubble",
            "status": "past_due",
            "paddle_subscription_id": "sub_past_due_locked",
            "current_period_ends_at": period_end.isoformat(),
        }

        access = self._access_for(subscription)
        platform_access = self._platform_access_for(subscription)

        self.assertFalse(access["has_active_subscription"])
        self.assertFalse(access["can_upload"])
        self.assertFalse(access["past_due_grace_active"])
        self.assertTrue(access["payment_recovery_required"])
        self.assertEqual(access["platform_access"], [])
        self.assertFalse(platform_access["redbubble"])
        self.assertIn("Update your payment method", access["payment_recovery_message"])

    def test_canceled_subscription_stays_locked(self):
        subscription = {
            "plan": "teepublic",
            "status": "canceled",
            "paddle_subscription_id": "sub_canceled",
            "current_period_ends_at": (datetime.now(timezone.utc) + timedelta(days=10)).isoformat(),
        }

        access = self._access_for(subscription)

        self.assertFalse(access["has_active_subscription"])
        self.assertFalse(access["can_upload"])
        self.assertFalse(access["is_past_due"])


if __name__ == "__main__":
    unittest.main()
