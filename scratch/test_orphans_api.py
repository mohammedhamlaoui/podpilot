import os
import sys

# Add backend directory to sys.path so we can import the app
backend_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "backend"))
sys.path.insert(0, backend_dir)

from fastapi.testclient import TestClient
from app.main import app
import app.core.config as config

client = TestClient(app)

def test_missing_or_wrong_header():
    print("Testing missing or wrong header...")
    config.ADMIN_CLEANUP_SECRET = "super_secret_token"
    
    # 1. No header
    response = client.post("/api/admin/cleanup-orphan-r2-objects?dry_run=true")
    print(f"No header - Status: {response.status_code}, JSON: {response.json()}")
    assert response.status_code == 403
    
    # 2. Wrong header
    response = client.post(
        "/api/admin/cleanup-orphan-r2-objects?dry_run=true",
        headers={"X-Cleanup-Secret": "wrong_token"}
    )
    print(f"Wrong header - Status: {response.status_code}, JSON: {response.json()}")
    assert response.status_code == 403
    print("PASS: Missing or wrong header handled correctly with 403 error!")

def test_successful_dry_run():
    print("\nTesting successful dry run for orphans...")
    config.ADMIN_CLEANUP_SECRET = "super_secret_token"
    
    response = client.post(
        "/api/admin/cleanup-orphan-r2-objects?dry_run=true",
        headers={"X-Cleanup-Secret": "super_secret_token"}
    )
    print(f"Status: {response.status_code}")
    print(f"JSON response preview: {response.json()}")
    assert response.status_code == 200
    res_json = response.json()
    assert res_json["dry_run"] is True
    assert "scanned_count" in res_json
    assert "referenced_count" in res_json
    assert "orphan_count" in res_json
    assert "orphan_keys" in res_json
    print("PASS: Successful orphans dry run returned 200 and valid JSON schema!")

if __name__ == "__main__":
    try:
        test_missing_or_wrong_header()
        test_successful_dry_run()
        print("\nAll Orphan API tests PASSED successfully!")
    except Exception as e:
        print(f"\nTest failed: {e}")
        sys.exit(1)
