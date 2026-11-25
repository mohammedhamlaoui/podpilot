"""Read-only deployment checks; prints statuses, never credentials or records."""

import sys

import boto3
import requests

from app.core import config


def check_supabase() -> bool:
    try:
        response = requests.get(
            f"{config.SUPABASE_URL}/rest/v1/designs",
            params={"select": "id", "limit": "0"},
            headers={
                "apikey": config.SUPABASE_SERVICE_ROLE_KEY,
                "Authorization": f"Bearer {config.SUPABASE_SERVICE_ROLE_KEY}",
            },
            timeout=10,
        )
        print(f"SUPABASE_HTTP={response.status_code}")
        return response.ok
    except requests.RequestException as exc:
        print(f"SUPABASE_ERROR={type(exc).__name__}")
        return False


def check_r2() -> bool:
    try:
        client = boto3.client(
            "s3",
            endpoint_url=config.R2_ENDPOINT,
            aws_access_key_id=config.R2_ACCESS_KEY_ID,
            aws_secret_access_key=config.R2_SECRET_ACCESS_KEY,
            region_name="auto",
        )
        client.head_bucket(Bucket=config.R2_BUCKET_NAME)
        print("R2_BUCKET_ACCESS=ok")
        return True
    except Exception as exc:
        print(f"R2_BUCKET_ERROR={type(exc).__name__}")
        return False


if __name__ == "__main__":
    results = (check_supabase(), check_r2())
    print(f"PADDLE_CONFIGURED={bool(config.PADDLE_API_KEY and config.PADDLE_WEBHOOK_SECRET)}")
    print(f"AI_CONFIGURED={bool(config.GEMINI_API_KEY or config.OPENROUTER_API_KEY)}")
    print(f"CDN_SIGNING_CONFIGURED={bool(config.CDN_SIGNING_SECRET)}")
    sys.exit(0 if all(results) else 1)
