import sys
import types
import unittest
from unittest.mock import MagicMock, patch

sys.modules.setdefault("app.services.supabase_service", types.ModuleType("supabase_service"))

from app.api import paddle_webhook


class RelaunchRefundTests(unittest.TestCase):
    def test_full_initial_refund_cancels_paddle_subscription(self):
        db = MagicMock()
        db.table.return_value.select.return_value.eq.return_value.limit.return_value.execute.return_value.data = [{
            "intent_type": "subscription",
            "paddle_subscription_id": "sub_first",
        }]
        current = MagicMock()
        current.json.return_value = {"data": {"status": "active"}}
        with (
            patch.object(paddle_webhook.supabase_service, "admin_client", return_value=db, create=True),
            patch.object(paddle_webhook.config, "PADDLE_API_KEY", "test_key"),
            patch.object(paddle_webhook.httpx, "Client") as client,
        ):
            session = client.return_value.__enter__.return_value
            session.get.return_value = current
            session.post.return_value = MagicMock()
            paddle_webhook._cancel_fully_refunded_subscription("txn_first")
            self.assertEqual(session.post.call_args.kwargs["json"], {"effective_from": "immediately"})

    def test_partial_refund_does_not_cancel_subscription(self):
        with (
            patch.object(paddle_webhook.affiliate_service, "reverse_commission", return_value=None),
            patch.object(paddle_webhook, "_cancel_fully_refunded_subscription") as cancel,
        ):
            paddle_webhook._handle_adjustment_event("adjustment.updated", {
                "status": "approved", "action": "refund", "type": "partial", "transaction_id": "txn_partial",
            })
        cancel.assert_not_called()


if __name__ == "__main__":
    unittest.main()
