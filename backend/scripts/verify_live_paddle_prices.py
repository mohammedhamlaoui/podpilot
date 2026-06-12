"""Verify configured Paddle price IDs against the Paddle Billing API.

This is an operator/admin diagnostic script, not a public API endpoint.

It loads environment variables from the process, `/etc/podpilot/backend.env`,
or `backend/.env`, then checks every configured subscription and AI credit
price with `GET /prices/{price_id}`.

Safe output only:
    variable name, price ID, found status, HTTP status, product id/name,
    billing interval, and trial period.

It never prints Paddle API keys, webhook secrets, client tokens, Supabase
keys, or other secrets.
"""
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path
from typing import Any

import httpx
from dotenv import load_dotenv


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SERVER_ENV = Path("/etc/podpilot/backend.env")
PADDLE_API_BASES = {
    "sandbox": "https://sandbox-api.paddle.com",
    "production": "https://api.paddle.com",
}

PRICE_ENV_NAMES = [
    "PADDLE_REDBUBBLE_MONTHLY_TRIAL_PRICE_ID",
    "PADDLE_REDBUBBLE_MONTHLY_PRICE_ID",
    "PADDLE_REDBUBBLE_ANNUAL_TRIAL_PRICE_ID",
    "PADDLE_REDBUBBLE_ANNUAL_PRICE_ID",
    "PADDLE_TEEPUBLIC_MONTHLY_TRIAL_PRICE_ID",
    "PADDLE_TEEPUBLIC_MONTHLY_PRICE_ID",
    "PADDLE_TEEPUBLIC_ANNUAL_TRIAL_PRICE_ID",
    "PADDLE_TEEPUBLIC_ANNUAL_PRICE_ID",
    "PADDLE_ALL_PLATFORMS_MONTHLY_TRIAL_PRICE_ID",
    "PADDLE_ALL_PLATFORMS_MONTHLY_PRICE_ID",
    "PADDLE_ALL_PLATFORMS_ANNUAL_TRIAL_PRICE_ID",
    "PADDLE_ALL_PLATFORMS_ANNUAL_PRICE_ID",
    "PADDLE_AI_TOKENS_250_PRICE_ID",
    "PADDLE_AI_TOKENS_500_PRICE_ID",
    "PADDLE_AI_TOKENS_1000_PRICE_ID",
    "PADDLE_AI_TOKENS_2500_PRICE_ID",
    "PADDLE_AI_TOKENS_5000_PRICE_ID",
    "PADDLE_AI_TOKENS_10000_PRICE_ID",
]


def normalize_api_key(raw: str) -> str:
    value = str(raw or "").strip()
    if len(value) >= 2 and value[0] == value[-1] and value[0] in {'"', "'"}:
        value = value[1:-1].strip()
    if value.lower().startswith("bearer "):
        value = value[len("Bearer "):].strip()
    return value


def load_env_files(extra_env_file: str | None) -> list[Path]:
    loaded: list[Path] = []
    candidates: list[Path] = []
    if extra_env_file:
        candidates.append(Path(extra_env_file))
    env_from_var = os.environ.get("PODPILOT_BACKEND_ENV_FILE")
    if env_from_var:
        candidates.append(Path(env_from_var))
    candidates.extend([DEFAULT_SERVER_ENV, ROOT / ".env"])

    seen: set[Path] = set()
    for path in candidates:
        resolved = path.expanduser()
        if resolved in seen or not resolved.exists():
            continue
        seen.add(resolved)
        load_dotenv(resolved, override=False)
        loaded.append(resolved)
    return loaded


def api_base_for_environment(environment: str) -> str:
    normalized = str(environment or "sandbox").strip().lower()
    return PADDLE_API_BASES.get(normalized, PADDLE_API_BASES["sandbox"])


def interval_text(period: Any) -> str:
    if not isinstance(period, dict):
        return "none"
    interval = period.get("interval")
    frequency = period.get("frequency")
    if not interval or not frequency:
        return "none"
    return f"{frequency} {interval}"


def product_name(data: dict[str, Any], included: list[dict[str, Any]]) -> tuple[str, str]:
    product_id = str(data.get("product_id") or "")
    name = "-"
    for item in included:
        if item.get("type") == "product" and item.get("id") == product_id:
            name = str(item.get("name") or "-")
            break
    return product_id or "-", name


def check_price(client: httpx.Client, api_base: str, env_name: str, price_id: str) -> tuple[bool, int]:
    value = str(price_id or "").strip()
    if not value:
        print(f"{env_name}: price_id=missing found=no status=missing product=- name=- billing=none trial=none")
        return False, 0
    if not value.startswith("pri_"):
        print(f"{env_name}: price_id={value} found=no status=invalid-format product=- name=- billing=none trial=none")
        return False, 0

    response = client.get(f"{api_base}/prices/{value}", params={"include": "product"})
    status = response.status_code
    if status != 200:
        print(f"{env_name}: price_id={value} found=no status={status} product=- name=- billing=none trial=none")
        return False, status

    payload = response.json()
    data = payload.get("data") or {}
    included = payload.get("included") or []
    product_id, name = product_name(data, included)
    billing = interval_text(data.get("billing_cycle"))
    trial = interval_text(data.get("trial_period"))
    price_status = str(data.get("status") or "-")
    print(
        f"{env_name}: price_id={value} found=yes status={price_status} "
        f"product={product_id} name={name} billing={billing} trial={trial}"
    )
    return True, status


def main() -> int:
    parser = argparse.ArgumentParser(description="Verify configured Paddle prices with the Paddle API.")
    parser.add_argument("--env-file", help="Optional env file path. Defaults also check /etc/podpilot/backend.env and backend/.env.")
    parser.add_argument("--environment", choices=["sandbox", "production"], help="Override PADDLE_ENVIRONMENT for this check.")
    args = parser.parse_args()

    loaded = load_env_files(args.env_file)
    environment = args.environment or os.environ.get("PADDLE_ENVIRONMENT", "sandbox")
    api_base = api_base_for_environment(environment)
    api_key = normalize_api_key(os.environ.get("PADDLE_API_KEY", ""))
    if not api_key:
        print("PADDLE_API_KEY is missing. Add it to the server env file before running this diagnostic.")
        return 2

    print("Loaded env files: " + (", ".join(str(path) for path in loaded) if loaded else "process environment only"))
    print(f"Paddle environment: {environment}")
    print(f"Paddle API base: {api_base}")

    headers = {"Authorization": f"Bearer {api_key}", "Accept": "application/json"}
    failures = 0
    with httpx.Client(headers=headers, timeout=20.0) as client:
        for env_name in PRICE_ENV_NAMES:
            found, _ = check_price(client, api_base, env_name, os.environ.get(env_name, ""))
            if not found:
                failures += 1

    if failures:
        print(f"Result: {failures} configured price value(s) were missing or not found.")
        return 1
    print("Result: all configured Paddle price IDs were found.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
