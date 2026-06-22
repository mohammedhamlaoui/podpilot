import os
import sys
import unittest
from pathlib import Path


BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))

for name in (
    "SUPABASE_URL",
    "SUPABASE_ANON_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "R2_ACCOUNT_ID",
    "R2_ACCESS_KEY_ID",
    "R2_SECRET_ACCESS_KEY",
):
    os.environ.setdefault(name, f"test-{name.lower()}")

from app.services.design_status import build_status_timestamp_patch  # noqa: E402


class DesignStatusUpdateTests(unittest.TestCase):
    def test_uploaded_sets_timestamps_when_first_confirmed(self):
        payload = build_status_timestamp_patch(
            "uploaded",
            now="2026-06-22T10:00:00+00:00",
            existing_uploaded_at=None,
        )
        self.assertEqual(payload["status"], "uploaded")
        self.assertTrue(payload["uploaded_at"])
        self.assertEqual(payload["updated_at"], payload["uploaded_at"])

    def test_repeated_uploaded_preserves_original_uploaded_at(self):
        payload = build_status_timestamp_patch(
            "uploaded",
            now="2026-06-22T10:00:00+00:00",
            existing_uploaded_at="2026-06-20T10:00:00+00:00",
        )
        self.assertNotIn("uploaded_at", payload)
        self.assertTrue(payload["updated_at"])

    def test_failed_status_does_not_set_uploaded_at(self):
        payload = build_status_timestamp_patch(
            "failed",
            now="2026-06-22T10:00:00+00:00",
        )
        self.assertEqual(payload["status"], "failed")
        self.assertNotIn("uploaded_at", payload)
        self.assertTrue(payload["updated_at"])


if __name__ == "__main__":
    unittest.main()
