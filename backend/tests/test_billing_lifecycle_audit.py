"""Local lifecycle regression tests; no real customers, payments or database writes."""
import sys
import types
import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock, patch
sys.modules.setdefault("app.services.supabase_service", types.ModuleType("supabase_service"))
from app.services import subscription_service as service


class LifecycleAuditTests(unittest.TestCase):
    def setUp(self):
        self.now = datetime.now(timezone.utc)

    def fields(self, **overrides):
        row = {"status": "past_due", "current_period_ends_at": (self.now + timedelta(days=28)).isoformat(),
               "paddle_event_at": (self.now - timedelta(days=2)).isoformat(), "updated_at": self.now.isoformat()}
        row.update(overrides)
        with patch.object(service.config, "PAST_DUE_GRACE_DAYS", 3):
            return service._payment_access_fields(row, now=self.now)

    def test_credit_mutation_does_not_restart_past_due_grace(self):
        result = self.fields(past_due_since=(self.now - timedelta(days=4)).isoformat())
        self.assertFalse(result["access_allowed"])
        self.assertTrue(result["payment_recovery_required"])

    def test_existing_event_timestamp_is_preferred_to_mutable_updated_at(self):
        self.assertFalse(self.fields(paddle_event_at=(self.now - timedelta(days=4)).isoformat())["access_allowed"])

    def test_grace_boundary_and_future_start_fail_closed(self):
        self.assertTrue(self.fields(past_due_since=(self.now - timedelta(days=2)).isoformat())["access_allowed"])
        for date in (self.now - timedelta(days=3), self.now + timedelta(days=1)):
            self.assertFalse(self.fields(past_due_since=date.isoformat())["access_allowed"])

    def summary(self, row):
        with patch.object(service, "get_user_subscription", return_value=row), \
             patch.object(service, "get_user_monthly_usage", return_value={"uploaded_count": 0}), \
             patch.object(service, "get_user_daily_ai_usage", return_value={"used_count": 0}):
            return service.get_subscription_access("fixture")

    def test_scheduled_and_immediate_cancellation_keep_correct_benefits(self):
        base = {"plan": "redbubble", "status": "active", "ai_tokens": 55,
                "current_period_ends_at": (self.now + timedelta(days=20)).isoformat(), "cancel_at_period_end": True}
        scheduled = self.summary(base)
        self.assertTrue(scheduled["can_upload"])
        self.assertEqual(scheduled["daily_ai_tokens"], 30)
        self.assertIsNone(scheduled["next_payment_date"])
        immediate = self.summary({**base, "status": "canceled"})
        self.assertFalse(immediate["can_upload"])
        self.assertEqual(immediate["daily_ai_tokens"], 0)
        self.assertEqual(immediate["ai_tokens"], 55)
        self.assertIsNone(immediate["next_payment_date"])

    def test_recovery_restores_benefits_without_resetting_purchased_credits(self):
        active = self.summary({"plan": "all_platforms", "status": "active", "ai_tokens": 987,
            "current_period_ends_at": (self.now + timedelta(days=25)).isoformat()})
        self.assertTrue(active["can_upload"])
        self.assertFalse(active["is_past_due"])
        self.assertEqual(active["daily_ai_tokens"], 75)
        self.assertEqual(active["ai_tokens"], 987)

    def test_grace_daily_allowance_is_not_replaced_by_purchased_tokens(self):
        with patch.object(service, "get_subscription_access", return_value={"status": "past_due",
            "has_subscription": True, "has_active_subscription": True, "daily_ai_tokens": 30, "ai_tokens": 1000}), \
             patch.object(service, "get_user_daily_ai_usage", return_value={"used_count": 0}):
            self.assertEqual(service.check_ai_token_availability("fixture"), ("daily", 1030))

    def test_backend_passes_configured_grace_to_atomic_rpc(self):
        db = MagicMock(); db.rpc.return_value.execute.return_value.data = [{"token_source": "daily"}]
        with patch.object(service.supabase_service, "admin_client", return_value=db, create=True), \
             patch.object(service.config, "PAST_DUE_GRACE_DAYS", 7):
            service.consume_ai_token_atomic("fixture")
        db.rpc.assert_called_once_with("consume_ai_token_atomic", {"p_user_id": "fixture", "p_grace_days": 7})

    def test_provider_failure_refund_uses_atomic_increment(self):
        db = MagicMock()
        with patch.object(service.supabase_service, "admin_client", return_value=db, create=True), \
             patch.object(service, "get_user_subscription") as read:
            service.refund_ai_token_reservation("fixture", {"token_source": "extra", "_reservation_day_key": "2026-11-28"})
        read.assert_not_called()
        db.table.assert_not_called()
        db.rpc.assert_called_once_with("refund_ai_token_reservation_atomic",
            {"p_user_id": "fixture", "p_source": "extra", "p_day_key": "2026-11-28"})


if __name__ == "__main__": unittest.main()
