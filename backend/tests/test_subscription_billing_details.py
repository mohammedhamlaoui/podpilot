import unittest
import sys
import types
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
        self.assertEqual(details["price_display"], "$4.99 / month")

    def test_stored_cycle_is_used_when_price_id_is_unmapped(self):
        details = get_subscription_billing_details({
            "plan": "teepublic",
            "billing_cycle": "annual",
            "paddle_price_id": "pri_legacy_unmapped",
        })

        self.assertEqual(details["billing_cycle"], "annual")
        self.assertEqual(details["price_display"], "$49.90 annually")
        self.assertEqual(details["monthly_equivalent_display"], "$4.16 / month")

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
        self.assertEqual(access["price_display"], "$4.99 / month")
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


if __name__ == "__main__":
    unittest.main()
