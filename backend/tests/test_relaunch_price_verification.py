import sys
import types
import unittest
from unittest.mock import MagicMock, patch

from fastapi import HTTPException

sys.modules.setdefault("app.services.supabase_service", types.ModuleType("supabase_service"))

from app.api import billing


class RelaunchPriceVerificationTests(unittest.TestCase):
    def _response(self, *, amount="899", trial=None):
        result = MagicMock()
        result.json.return_value = {"data": {
            "id": "pri_redbubble",
            "status": "active",
            "unit_price": {"amount": amount, "currency_code": "USD"},
            "billing_cycle": {"interval": "month", "frequency": 1},
            "trial_period": trial,
        }}
        return result

    def test_checkout_accepts_verified_non_trial_price(self):
        with (
            patch.object(billing.config, "PADDLE_API_KEY", "test_key"),
            patch.object(billing.httpx, "Client") as client,
        ):
            client.return_value.__enter__.return_value.get.return_value = self._response()
            billing._verify_relaunch_subscription_price("pri_redbubble", "redbubble", "monthly")

    def test_checkout_rejects_wrong_amount_or_trial(self):
        for response in (self._response(amount="499"), self._response(trial={"interval": "day", "frequency": 7})):
            with (
                patch.object(billing.config, "PADDLE_API_KEY", "test_key"),
                patch.object(billing.httpx, "Client") as client,
            ):
                client.return_value.__enter__.return_value.get.return_value = response
                with self.assertRaises(HTTPException) as raised:
                    billing._verify_relaunch_subscription_price("pri_redbubble", "redbubble", "monthly")
                self.assertEqual(raised.exception.status_code, 503)


if __name__ == "__main__":
    unittest.main()
