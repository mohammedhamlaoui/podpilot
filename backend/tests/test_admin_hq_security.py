import sys
import types
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

if "app.services.supabase_service" not in sys.modules:
    supabase_stub = types.ModuleType("app.services.supabase_service")
    supabase_stub.admin_client = MagicMock()
    sys.modules["app.services.supabase_service"] = supabase_stub

from fastapi import HTTPException
from starlette.requests import Request

from app.api.admin import auth as admin_auth


def request(method="GET", origin=None):
    headers = []
    if origin:
        headers.append((b"origin", origin.encode()))
    return Request({"type": "http", "method": method, "path": "/api/admin/overview", "headers": headers, "query_string": b"", "server": ("test", 80), "client": ("127.0.0.1", 1), "scheme": "http"})


def session_row(**patch_values):
    now = datetime.now(timezone.utc)
    row = {
        "id": "session-1",
        "user_id": "00000000-0000-0000-0000-000000000001",
        "csrf_hash": admin_auth._hash_token("csrf-token"),
        "auth_level": "aal2",
        "authenticated_at": now.isoformat(),
        "last_seen_at": now.isoformat(),
        "expires_at": (now + timedelta(hours=1)).isoformat(),
        "revoked_at": None,
    }
    row.update(patch_values)
    return row


class OwnerSessionAuthorizationTests(unittest.TestCase):
    def test_missing_admin_cookie_is_unauthorized(self):
        with self.assertRaises(HTTPException) as raised:
            admin_auth.require_owner(request(), admin_token=None, csrf_token=None)
        self.assertEqual(raised.exception.status_code, 401)

    def test_expired_session_is_unauthorized(self):
        expired = session_row(expires_at=(datetime.now(timezone.utc) - timedelta(seconds=1)).isoformat())
        with patch.object(admin_auth, "_table_row", return_value=expired):
            with self.assertRaises(HTTPException) as raised:
                admin_auth.require_owner(request(), admin_token="token", csrf_token=None)
        self.assertEqual(raised.exception.status_code, 401)

    def test_aal1_session_is_denied_when_mfa_required(self):
        with patch.object(admin_auth, "_table_row", return_value=session_row(auth_level="aal1")):
            with self.assertRaises(HTTPException) as raised:
                admin_auth.require_owner(request(), admin_token="token", csrf_token=None)
        self.assertEqual(raised.exception.status_code, 403)

    def test_state_change_requires_exact_origin(self):
        with patch.object(admin_auth, "_table_row", return_value=session_row()):
            with self.assertRaises(HTTPException) as raised:
                admin_auth.require_owner(request("POST", "https://attacker.example"), admin_token="token", csrf_token="csrf-token")
        self.assertEqual(raised.exception.status_code, 403)

    def test_state_change_requires_bound_csrf_token(self):
        with patch.object(admin_auth, "_table_row", return_value=session_row()):
            with self.assertRaises(HTTPException) as raised:
                admin_auth.require_owner(request("POST", admin_auth.config.ADMIN_APP_ORIGIN), admin_token="token", csrf_token="wrong")
        self.assertEqual(raised.exception.status_code, 403)

    def test_active_owner_session_is_accepted(self):
        rows = [session_row(), {"user_id": "00000000-0000-0000-0000-000000000001", "email": "owner@example.com", "role": "owner", "status": "active"}]
        with patch.object(admin_auth, "_table_row", side_effect=rows), patch.object(admin_auth.supabase_service, "admin_client") as client:
            client.return_value.table.return_value.update.return_value.eq.return_value.execute.return_value = MagicMock(data=[])
            owner = admin_auth.require_owner(request(), admin_token="token", csrf_token=None)
        self.assertEqual(owner.role, "owner")
        self.assertIn("users.read", owner.capabilities)


class AdminMigrationTests(unittest.TestCase):
    def test_admin_tables_are_not_granted_to_browser_roles(self):
        sql = Path("docs/migration_admin_hq_foundation.sql").read_text(encoding="utf-8")
        self.assertIn("revoke all on public.admin_principals", sql)
        self.assertIn("public.admin_audit_logs", sql)
        self.assertIn("from anon, authenticated", sql)


if __name__ == "__main__":
    unittest.main()
