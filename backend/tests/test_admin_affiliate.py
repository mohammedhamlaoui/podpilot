import asyncio
import json
import sys
import types
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch


sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
if "app.services.supabase_service" not in sys.modules:
    supabase_stub = types.ModuleType("app.services.supabase_service")
    supabase_stub.admin_client = MagicMock()
    sys.modules["app.services.supabase_service"] = supabase_stub

from fastapi import HTTPException

from app.api import affiliate as affiliate_api
from app.core.auth import AuthUser, require_admin
from app.services import admin_affiliate_service


class FakeRpc:
    def __init__(self, data=None, error=None):
        self.data = data
        self.error = error

    def execute(self):
        if self.error:
            raise self.error
        return SimpleNamespace(data=self.data)


class RpcClient:
    def __init__(self, responses=None):
        self.responses = responses or {}
        self.calls = []

    def rpc(self, name, params):
        self.calls.append((name, params))
        response = self.responses.get(name)
        if isinstance(response, Exception):
            return FakeRpc(error=response)
        return FakeRpc(response)


def auth_user(role=None, **metadata):
    app_metadata = {**metadata}
    if role is not None:
        app_metadata["role"] = role
    return AuthUser(
        id="00000000-0000-0000-0000-000000000001",
        email="owner@podpilot.space",
        access_token="verified-token",
        app_metadata=app_metadata,
    )


class AdminAuthorizationTests(unittest.TestCase):
    def test_non_admin_receives_403(self):
        with self.assertRaises(HTTPException) as raised:
            asyncio.run(require_admin(auth_user(role="member")))
        self.assertEqual(raised.exception.status_code, 403)

    def test_legacy_frontend_admin_flags_are_not_accepted(self):
        with self.assertRaises(HTTPException) as raised:
            asyncio.run(require_admin(auth_user(is_admin=True, roles=["admin"])))
        self.assertEqual(raised.exception.status_code, 403)

    def test_verified_admin_can_fetch_overview(self):
        expected = {"total_affiliates": 4, "active_affiliates": 3}
        with patch.object(affiliate_api.admin_affiliate_service, "overview", return_value=expected):
            result = affiliate_api.admin_affiliate_overview(auth_user(role="admin"))
        self.assertEqual(result, expected)

    def test_verified_admin_can_list_affiliates(self):
        expected = {"items": [{"id": "affiliate-1"}], "total": 1, "page": 1, "page_size": 25, "pages": 1}
        with patch.object(affiliate_api.admin_affiliate_service, "list_accounts", return_value=expected) as list_accounts:
            result = affiliate_api.admin_affiliate_accounts(
                page=1, page_size=25, search=None, status=None,
                date_from=None, date_to=None, _admin=auth_user(role="admin"),
            )
        self.assertEqual(result, expected)
        list_accounts.assert_called_once()


class AdminPayoutWorkflowTests(unittest.TestCase):
    def _payout(self, status):
        return [{
            "id": "payout-1",
            "affiliate_id": "affiliate-1",
            "amount": "20.00",
            "currency": "USD",
            "status": status,
            "payout_method_snapshot": {"method": "paypal", "email": "private@example.com"},
        }]

    def test_admin_can_approve_payout(self):
        client = RpcClient({"affiliate_review_payout": self._payout("approved")})
        with patch.object(admin_affiliate_service, "_client", return_value=client):
            result = admin_affiliate_service.review_payout("payout-1", "admin-1", "approved", "Verified")
        self.assertEqual(result["status"], "approved")
        self.assertEqual(client.calls[0][1]["p_status"], "approved")

    def test_admin_can_reject_payout_with_note(self):
        client = RpcClient({"affiliate_review_payout": self._payout("rejected")})
        with patch.object(admin_affiliate_service, "_client", return_value=client):
            result = admin_affiliate_service.review_payout("payout-1", "admin-1", "rejected", "Account mismatch")
        self.assertEqual(result["status"], "rejected")
        self.assertEqual(client.calls[0][1]["p_note"], "Account mismatch")

    def test_rejection_without_note_is_rejected(self):
        with self.assertRaises(HTTPException) as raised:
            admin_affiliate_service.review_payout("payout-1", "admin-1", "rejected", "  ")
        self.assertEqual(raised.exception.status_code, 400)

    def test_admin_can_mark_approved_payout_paid(self):
        client = RpcClient({"affiliate_review_payout": self._payout("paid")})
        with patch.object(admin_affiliate_service, "_client", return_value=client):
            result = admin_affiliate_service.review_payout("payout-1", "admin-1", "paid", "Sent manually")
        self.assertEqual(result["status"], "paid")

    def test_invalid_payout_transition_is_rejected(self):
        client = RpcClient({"affiliate_review_payout": Exception("INVALID_PAYOUT_TRANSITION")})
        with patch.object(admin_affiliate_service, "_client", return_value=client):
            with self.assertRaises(HTTPException) as raised:
                admin_affiliate_service.review_payout("payout-1", "admin-1", "paid", "Duplicate")
        self.assertEqual(raised.exception.status_code, 409)


class AdminAffiliateStatusAndAuditTests(unittest.TestCase):
    def test_admin_can_suspend_affiliate(self):
        client = RpcClient({"affiliate_set_account_status": [{"id": "affiliate-1", "status": "suspended"}]})
        with patch.object(admin_affiliate_service, "_client", return_value=client):
            result = admin_affiliate_service.set_account_status("affiliate-1", "admin-1", "suspended", "Policy review")
        self.assertEqual(result["status"], "suspended")
        self.assertEqual(client.calls[0][1]["p_status"], "suspended")

    def test_admin_can_reactivate_affiliate(self):
        client = RpcClient({"affiliate_set_account_status": [{"id": "affiliate-1", "status": "active"}]})
        with patch.object(admin_affiliate_service, "_client", return_value=client):
            result = admin_affiliate_service.set_account_status("affiliate-1", "admin-1", "active", None)
        self.assertEqual(result["status"], "active")

    def test_every_admin_transition_creates_an_audit_log(self):
        sql = Path("docs/migration_admin_affiliate_dashboard.sql").read_text(encoding="utf-8")
        self.assertIn("insert into public.affiliate_admin_audit_logs", sql)
        for action in (
            "approve_payout", "reject_payout", "mark_payout_paid",
            "suspend_affiliate", "reactivate_affiliate",
        ):
            self.assertIn(action, sql)
        self.assertIn("for update", sql)
        self.assertIn("INVALID_PAYOUT_TRANSITION", sql)

    def test_sensitive_payout_fields_are_masked(self):
        safe = admin_affiliate_service._safe_payout_method({
            "method": "bank_transfer",
            "account_name": "Private Owner",
            "iban": "GB82WEST12345698765432",
            "swift_code": "DEUTDEFF500",
        })
        serialized = json.dumps(safe)
        self.assertNotIn("GB82WEST12345698765432", serialized)
        self.assertNotIn("DEUTDEFF500", serialized)
        self.assertNotIn("Private Owner", serialized)
        self.assertTrue(str(safe["iban"]).endswith("5432"))

    def test_paypal_email_is_masked(self):
        safe = admin_affiliate_service._safe_payout_method({"method": "paypal", "email": "owner@example.com"})
        self.assertNotIn("owner@example.com", json.dumps(safe))
        self.assertEqual(safe["paypal_email"], "o****@example.com")


if __name__ == "__main__":
    unittest.main()
