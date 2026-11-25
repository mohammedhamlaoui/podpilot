import unittest
from unittest.mock import patch

from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from app.api import routes
from app.core.auth import AuthUser, get_current_user
from app.services import device_session_service


class UploadDeviceEnforcementTests(unittest.TestCase):
    def setUp(self):
        app = FastAPI()
        app.include_router(routes.router)
        app.dependency_overrides[get_current_user] = lambda: AuthUser(
            id="user-1", email="owner@example.com", access_token="test-token"
        )
        self.client = TestClient(app)

    def test_upload_job_rejects_missing_device_before_writing(self):
        with patch.object(device_session_service, "validate_device", side_effect=HTTPException(403, "device required")), \
                patch.object(routes.supabase_service, "insert_upload_job", create=True) as insert_job:
            response = self.client.post("/upload-jobs", json={
                "marketplace": "redbubble", "design_ids": [], "total_designs": 0
            })
        self.assertEqual(response.status_code, 403)
        insert_job.assert_not_called()

    def test_previous_device_is_rejected_after_switch(self):
        active = {"device_id": "new-device", "last_seen_at": device_session_service._now_iso()}
        with patch.object(device_session_service, "_active_device_for_user", return_value=active):
            with self.assertRaises(HTTPException) as caught:
                device_session_service.validate_device("user-1", "old-device")
        self.assertEqual(caught.exception.status_code, 403)
        self.assertEqual(caught.exception.detail["code"], device_session_service.DEVICE_SESSION_REVOKED_CODE)

    def test_current_device_can_continue_after_idle_timeout(self):
        active = {"device_id": "same-device", "last_seen_at": "2020-01-01T00:00:00+00:00"}
        with patch.object(device_session_service, "_active_device_for_user", return_value=active), \
                patch.object(device_session_service, "_upsert_current_device") as refresh_device:
            device_session_service.validate_device("user-1", "same-device")
        refresh_device.assert_called_once_with("user-1", "same-device")

    def test_parallel_registration_cannot_take_active_device(self):
        other = {"device_id": "first-device", "last_seen_at": device_session_service._now_iso()}
        with patch.object(device_session_service, "_active_device_for_user", side_effect=[None, other]), \
                patch.object(device_session_service, "_upsert_current_device", side_effect=RuntimeError("unique conflict")), \
                patch.object(device_session_service, "_revoke_active_devices") as revoke:
            with self.assertRaises(HTTPException) as caught:
                device_session_service.register_device("user-1", "second-device")
        self.assertEqual(caught.exception.status_code, 409)
        self.assertEqual(caught.exception.detail["code"], device_session_service.DEVICE_ALREADY_ACTIVE_CODE)
        revoke.assert_not_called()


if __name__ == "__main__":
    unittest.main()
