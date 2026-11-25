"""Regression checks for Owner customer workspace data and audited controls."""
import unittest
import sys
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from fastapi import HTTPException

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.api.admin import routes
from app.api.admin.auth import AdminPrincipal, OWNER_CAPABILITIES
from app.services import admin_data_service


class TableQuery:
    def __init__(self, table, selected):
        self.table = table
        self.selected = selected

    def select(self, columns, **kwargs):
        self.selected.append((self.table, columns))
        return self

    def __getattr__(self, _name):
        return lambda *args, **kwargs: self

    def execute(self):
        if self.table == "user_active_devices":
            return SimpleNamespace(data=[{"id": "device-1", "created_at": "2026-01-01"}], count=1)
        return SimpleNamespace(data=[], count=0)


class UserWorkspaceTests(unittest.TestCase):
    def owner(self):
        return AdminPrincipal("owner-id", "owner@example.com", "owner", OWNER_CAPABILITIES, "session", "aal2", datetime.now(timezone.utc))

    def test_user_detail_reads_existing_device_columns_and_exact_counts(self):
        selected = []
        client = SimpleNamespace(
            table=lambda name: TableQuery(name, selected),
            auth=SimpleNamespace(admin=SimpleNamespace(get_user_by_id=lambda _uid: SimpleNamespace(user=SimpleNamespace(id="customer-id", email="customer@example.com", user_metadata={}, created_at="2026-01-01", last_sign_in_at=None)))),
        )
        with patch.object(admin_data_service, "_client", return_value=client):
            result = admin_data_service.user_detail("customer-id")
        self.assertEqual(result["devices"][0]["id"], "device-1")
        self.assertEqual(result["related_status"]["devices"], "available")
        self.assertIn(("user_active_devices", "id,device_label,user_agent,created_at,last_seen_at,revoked_at"), selected)
        self.assertEqual(result["counts"]["designs"]["value"], 0)
        self.assertEqual(result["account_control_status"], "available")

    def test_exact_count_failure_is_unavailable(self):
        query = MagicMock()
        query.select.return_value = query
        query.limit.return_value = query
        query.execute.return_value = SimpleNamespace(data=[], count=None)
        client = MagicMock()
        client.table.return_value = query
        with patch.object(admin_data_service, "_client", return_value=client):
            count, error = admin_data_service._safe_count("designs")
        self.assertIsNone(count)
        self.assertEqual(error, "Exact count unavailable")

    def test_note_reports_audit_storage_failure(self):
        client = MagicMock()
        client.auth.admin.get_user_by_id.return_value = SimpleNamespace(user=SimpleNamespace(id="customer-id"))
        client.table.return_value.insert.return_value.execute.side_effect = RuntimeError("database down")
        with patch.object(routes.supabase_service, "admin_client", return_value=client):
            with self.assertRaises(HTTPException) as raised:
                routes.add_user_note("customer-id", routes.UserNote(text="Follow up tomorrow"), self.owner())
        self.assertEqual(raised.exception.status_code, 503)

    def test_customer_records_are_scoped_to_the_requested_user(self):
        with patch.object(admin_data_service, "list_table", return_value={"items": [], "total": 0}) as listed:
            admin_data_service.user_records("customer-id", "designs", page=2, page_size=25)
        self.assertEqual(listed.call_args.kwargs["filters"], {"user_id": "customer-id", "status": ""})

    def test_device_disconnect_does_not_update_if_audit_fails(self):
        client = MagicMock()
        devices = MagicMock()
        devices.select.return_value = devices
        devices.eq.return_value = devices
        devices.limit.return_value = devices
        devices.execute.return_value = SimpleNamespace(data=[{"id": "device-1", "revoked_at": None}])
        audit = MagicMock()
        audit.insert.return_value.execute.side_effect = RuntimeError("database down")
        client.table.side_effect = lambda name: devices if name == "user_active_devices" else audit
        with patch.object(routes.supabase_service, "admin_client", return_value=client), patch.object(routes, "require_recent_auth"):
            with self.assertRaises(HTTPException) as raised:
                routes.revoke_user_upload_device("customer-id", "device-1", routes.AccountAction(reason="Customer request"), self.owner())
        self.assertEqual(raised.exception.status_code, 503)
        devices.update.assert_not_called()


if __name__ == "__main__":
    unittest.main()
