import sys
import os
from pathlib import Path

# Add backend directory to path
backend_path = str(Path(__file__).resolve().parents[1] / "backend")
sys.path.append(backend_path)

# Set dummy environment variables to allow config load
os.environ.setdefault("SUPABASE_URL", "https://mock.supabase.co")
os.environ.setdefault("SUPABASE_ANON_KEY", "mock-anon-key")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "mock-service-role-key")
os.environ.setdefault("R2_ACCOUNT_ID", "mock-r2-account-id")
os.environ.setdefault("R2_ACCESS_KEY_ID", "mock-r2-access-key")
os.environ.setdefault("R2_SECRET_ACCESS_KEY", "mock-r2-secret-key")

from app.api.routes import _is_domain_blocked, _check_rate_limit, _GOOD_PROVIDERS

print("GOOD PROVIDERS ALLOWLIST:")
print(_GOOD_PROVIDERS)

print("\nTESTING RATE LIMITER (Limit: 5/min):")
for i in range(1, 8):
    allowed = _check_rate_limit("127.0.0.1")
    print(f"Attempt {i}: {allowed}")

print("\nTESTING DISPOSABLE DOMAIN CHECKING:")
test_domains = [
    "gmail.com",
    "yahoo.com",
    "mailinator.com",
    "yopmail.com",
    "sub.yopmail.com",
    "mycustomcompany.com",
    "invalid",
    "burnermail.io",
    "sub.burnermail.io"
]

for dom in test_domains:
    blocked = _is_domain_blocked(dom)
    print(f"Domain: {dom} | Blocked? {blocked}")

print("\nValidation logic verification done!")
