import os
import sys

# Add backend directory to sys.path so we can import the app
backend_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "backend"))
sys.path.insert(0, backend_dir)

from fastapi.testclient import TestClient
from app.main import app
import app.core.config as config

client = TestClient(app)

def test_missing_env_secret():
    print("Testing missing env secret...")
    # Force secret to be empty in configuration
    orig_secret = config.ADMIN_CLEANUP_SECRET
    config.ADMIN_CLEANUP_SECRET = ""
    try:
        response = client.post("/api/admin/cleanup-old-designs?dry_run=true&cutoff_hours=0")
        print(f"Status Code: {response.status_code}")
        print(f"Response JSON: {response.json()}")
        assert response.status_code == 500
        assert "ADMIN_CLEANUP_SECRET is not configured" in response.json()["detail"]
        print("PASS: Missing env secret handled correctly with 500 error!")
    finally:
        config.ADMIN_CLEANUP_SECRET = orig_secret

def test_missing_or_wrong_header():
    print("\nTesting missing or wrong header...")
    config.ADMIN_CLEANUP_SECRET = "super_secret_token"
    
    # 1. No header
    response = client.post("/api/admin/cleanup-old-designs?dry_run=true&cutoff_hours=0")
    print(f"No header - Status: {response.status_code}, JSON: {response.json()}")
    assert response.status_code == 403
    
    # 2. Wrong header
    response = client.post(
        "/api/admin/cleanup-old-designs?dry_run=true&cutoff_hours=0",
        headers={"X-Cleanup-Secret": "wrong_token"}
    )
    print(f"Wrong header - Status: {response.status_code}, JSON: {response.json()}")
    assert response.status_code == 403
    print("PASS: Missing or wrong header handled correctly with 403 error!")

def test_successful_dry_run():
    print("\nTesting successful dry run...")
    config.ADMIN_CLEANUP_SECRET = "super_secret_token"
    
    response = client.post(
        "/api/admin/cleanup-old-designs?dry_run=true&cutoff_hours=0",
        headers={"X-Cleanup-Secret": "super_secret_token"}
    )
    print(f"Status: {response.status_code}")
    print(f"JSON: {response.json()}")
    assert response.status_code == 200
    res_json = response.json()
    assert res_json["dry_run"] is True
    assert "eligible_count" in res_json
    assert "designs" in res_json
    print("PASS: Successful dry run returned 200 and valid JSON schema!")

if __name__ == "__main__":
    try:
        test_missing_env_secret()
        test_missing_or_wrong_header()
        test_successful_dry_run()
        print("\nAll API tests PASSED successfully!")
    except Exception as e:
        print(f"\nTest failed: {e}")
        sys.exit(1)
