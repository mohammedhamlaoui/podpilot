"""Backend configuration loaded from backend/.env.

Never expose SUPABASE_SERVICE_ROLE_KEY or R2_SECRET_ACCESS_KEY outside the
backend process. They unlock every user's data and every file in R2.
"""
import os
from pathlib import Path

from dotenv import load_dotenv


BASE_DIR = Path(__file__).resolve().parents[2]

# Load backend/.env into os.environ. Silent no-op if the file is missing,
# which lets unit tests inject env vars directly.
load_dotenv(BASE_DIR / ".env", override=False)


def _require(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise RuntimeError(
            f"Missing required environment variable: {name}. "
            f"Add it to backend/.env (see backend/.env.example)."
        )
    return value


def _optional(name: str, default: str = "") -> str:
    return os.environ.get(name, default).strip() or default


# ── Supabase ────────────────────────────────────────────────────────────────
SUPABASE_URL = _require("SUPABASE_URL").rstrip("/")
SUPABASE_ANON_KEY = _require("SUPABASE_ANON_KEY")
SUPABASE_SERVICE_ROLE_KEY = _require("SUPABASE_SERVICE_ROLE_KEY")

# ── Cloudflare R2 ───────────────────────────────────────────────────────────
R2_ACCOUNT_ID = _require("R2_ACCOUNT_ID")
R2_ACCESS_KEY_ID = _require("R2_ACCESS_KEY_ID")
R2_SECRET_ACCESS_KEY = _require("R2_SECRET_ACCESS_KEY")
R2_BUCKET_NAME = _optional("R2_BUCKET_NAME", "podpilot-files")
R2_ENDPOINT = _optional(
    "R2_ENDPOINT",
    f"https://{R2_ACCOUNT_ID}.r2.cloudflarestorage.com",
)
R2_SIGNED_URL_TTL_SECONDS = int(_optional("R2_SIGNED_URL_TTL_SECONDS", "3600"))

# Rate limiting. Redis is not a current runtime dependency, so the backend
# defaults to a local in-memory limiter. Set REDIS_URL/RATE_LIMIT_BACKEND when
# a shared limiter is added behind app.services.rate_limiter.
RATE_LIMIT_ENABLED = _optional("RATE_LIMIT_ENABLED", "true").lower() == "true"
RATE_LIMIT_BACKEND = _optional("RATE_LIMIT_BACKEND", "memory").lower()
REDIS_URL = _optional("REDIS_URL", "")
DEBUG = _optional("DEBUG", "false").lower() == "true"

# ── CORS ────────────────────────────────────────────────────────────────────
_raw_origins = _optional(
    "ALLOWED_ORIGINS",
    "http://localhost:5173,http://127.0.0.1:5173,https://podpilot.space,https://www.podpilot.space",
)
ALLOWED_ORIGINS = [o.strip() for o in _raw_origins.split(",") if o.strip()]

# ── Marketplaces supported ──────────────────────────────────────────────────
SUPPORTED_MARKETPLACES = {"redbubble", "teepublic"}


# AI listing generation
AI_PROVIDER = _optional("AI_PROVIDER", "gemini").lower().strip()
GEMINI_API_KEY = _optional("GEMINI_API_KEY", "")
AI_MODEL = _optional("AI_MODEL", "gemini-2.5-flash")

# OpenRouter listing generation
OPENROUTER_API_KEY = _optional("OPENROUTER_API_KEY", "")
OPENROUTER_MODEL = _optional("OPENROUTER_MODEL", "rekaai/reka-edge")
AI_LISTING_PROVIDER = _optional("AI_LISTING_PROVIDER", "openrouter").lower().strip()
OPENROUTER_FREE_FALLBACK_MODEL = _optional(
    "OPENROUTER_FREE_FALLBACK_MODEL",
    "openrouter/free",
)
ENABLE_OPENROUTER_FREE_FALLBACK = (
    _optional("ENABLE_OPENROUTER_FREE_FALLBACK", "false").lower() == "true"
)


# ── Trademark check ────────────────────────────────────────────────────────
# Provider can be "markerapi" (recommended) or "" (disabled). When disabled
# the trademark check endpoint returns a clear "not configured" error.
#
# Accepts both the new var names (TRADEMARK_API_PROVIDER, MARKERAPI_*) and
# the legacy ones (TRADEMARK_PROVIDER, TRADEMARK_API_USERNAME/KEY/PASSWORD)
# so old .env files keep working.
TRADEMARK_PROVIDER = (
    _optional("TRADEMARK_API_PROVIDER", "")
    or _optional("TRADEMARK_PROVIDER", "")
).lower().strip()
TRADEMARK_API_USERNAME = (
    _optional("MARKERAPI_USERNAME", "")
    or _optional("TRADEMARK_API_USERNAME", "")
)
TRADEMARK_API_PASSWORD = (
    _optional("MARKERAPI_PASSWORD", "")
    or _optional("TRADEMARK_API_PASSWORD", "")
    or _optional("TRADEMARK_API_KEY", "")
)
TRADEMARK_API_KEY = TRADEMARK_API_PASSWORD  # legacy alias
TRADEMARK_API_WEBSITE = (
    _optional("MARKERAPI_WEBSITE", "")
    or _optional("TRADEMARK_API_WEBSITE", "")
)
# MarkerAPI base URL. The original markerapi.com domain 302-redirects to a
# defunct S3 bucket; the working host appears to be dev.markerapi.com.
# Override via MARKERAPI_BASE_URL in backend/.env if MarkerAPI ever moves
# the endpoint again.
MARKERAPI_BASE_URL = _optional(
    "MARKERAPI_BASE_URL",
    "https://dev.markerapi.com/api/v2",
).rstrip("/")


# ── Paddle billing ──────────────────────────────────────────────────────────
# Server-side Paddle config. PADDLE_API_KEY must NEVER be exposed to the
# frontend; the browser uses a separate client token from frontend/.env.
#
# These are intentionally optional today: the rest of the backend boots
# without Paddle. Modules that need Paddle should call
# `require_paddle_config()` so a missing var produces one clear runtime
# error instead of crashing the whole app at import time.
PADDLE_ENVIRONMENT = _optional("PADDLE_ENVIRONMENT", "sandbox")
PADDLE_API_KEY = _optional("PADDLE_API_KEY", "")
PADDLE_WEBHOOK_SECRET = _optional("PADDLE_WEBHOOK_SECRET", "")

# Paddle price IDs must be supplied through environment variables in
# production. Do not hardcode real Paddle IDs in the repository.
#
# Legacy PADDLE_*_PRICE_ID values are kept as backward-compatible aliases for
# the monthly 3-day-trial prices. Legacy PADDLE_*_PAID_PRICE_ID values are
# kept as aliases for monthly no-trial prices.
PADDLE_REDBUBBLE_PRICE_ID = _optional("PADDLE_REDBUBBLE_PRICE_ID", "")
PADDLE_TEEPUBLIC_PRICE_ID = _optional("PADDLE_TEEPUBLIC_PRICE_ID", "")
PADDLE_ALL_PLATFORMS_PRICE_ID = _optional("PADDLE_ALL_PLATFORMS_PRICE_ID", "")
PADDLE_REDBUBBLE_PAID_PRICE_ID = _optional("PADDLE_REDBUBBLE_PAID_PRICE_ID", "")
PADDLE_TEEPUBLIC_PAID_PRICE_ID = _optional("PADDLE_TEEPUBLIC_PAID_PRICE_ID", "")
PADDLE_ALL_PLATFORMS_PAID_PRICE_ID = _optional("PADDLE_ALL_PLATFORMS_PAID_PRICE_ID", "")
PADDLE_AI_TOKENS_250_PRICE_ID = _optional("PADDLE_AI_TOKENS_250_PRICE_ID", "")
PADDLE_AI_TOKENS_500_PRICE_ID = _optional("PADDLE_AI_TOKENS_500_PRICE_ID", "")
PADDLE_AI_TOKENS_1000_PRICE_ID = _optional("PADDLE_AI_TOKENS_1000_PRICE_ID", "")
PADDLE_AI_TOKENS_2500_PRICE_ID = _optional("PADDLE_AI_TOKENS_2500_PRICE_ID", "")
PADDLE_AI_TOKENS_5000_PRICE_ID = _optional("PADDLE_AI_TOKENS_5000_PRICE_ID", "")
PADDLE_AI_TOKENS_10000_PRICE_ID = _optional("PADDLE_AI_TOKENS_10000_PRICE_ID", "")
AI_TOKEN_PACKS = {
    "tokens_250": (250, PADDLE_AI_TOKENS_250_PRICE_ID),
    "tokens_500": (500, PADDLE_AI_TOKENS_500_PRICE_ID),
    "tokens_1000": (1000, PADDLE_AI_TOKENS_1000_PRICE_ID),
    "tokens_2500": (2500, PADDLE_AI_TOKENS_2500_PRICE_ID),
    "tokens_5000": (5000, PADDLE_AI_TOKENS_5000_PRICE_ID),
    "tokens_10000": (10000, PADDLE_AI_TOKENS_10000_PRICE_ID),
}

# Explicit monthly and annual subscription price IDs. The *_TRIAL_* IDs should
# point to Paddle prices with trial_period=3 days. The non-trial IDs should
# point to otherwise identical Paddle prices with trial_period=null.
PADDLE_REDBUBBLE_MONTHLY_TRIAL_PRICE_ID = _optional(
    "PADDLE_REDBUBBLE_MONTHLY_TRIAL_PRICE_ID",
    PADDLE_REDBUBBLE_PRICE_ID,
)
PADDLE_TEEPUBLIC_MONTHLY_TRIAL_PRICE_ID = _optional(
    "PADDLE_TEEPUBLIC_MONTHLY_TRIAL_PRICE_ID",
    PADDLE_TEEPUBLIC_PRICE_ID,
)
PADDLE_ALL_PLATFORMS_MONTHLY_TRIAL_PRICE_ID = _optional(
    "PADDLE_ALL_PLATFORMS_MONTHLY_TRIAL_PRICE_ID",
    PADDLE_ALL_PLATFORMS_PRICE_ID,
)
PADDLE_REDBUBBLE_MONTHLY_PRICE_ID = _optional("PADDLE_REDBUBBLE_MONTHLY_PRICE_ID", PADDLE_REDBUBBLE_PAID_PRICE_ID)
PADDLE_TEEPUBLIC_MONTHLY_PRICE_ID = _optional("PADDLE_TEEPUBLIC_MONTHLY_PRICE_ID", PADDLE_TEEPUBLIC_PAID_PRICE_ID)
PADDLE_ALL_PLATFORMS_MONTHLY_PRICE_ID = _optional("PADDLE_ALL_PLATFORMS_MONTHLY_PRICE_ID", PADDLE_ALL_PLATFORMS_PAID_PRICE_ID)

PADDLE_REDBUBBLE_ANNUAL_PRICE_ID = _optional("PADDLE_REDBUBBLE_ANNUAL_PRICE_ID", "")
PADDLE_TEEPUBLIC_ANNUAL_PRICE_ID = _optional("PADDLE_TEEPUBLIC_ANNUAL_PRICE_ID", "")
PADDLE_ALL_PLATFORMS_ANNUAL_PRICE_ID = _optional("PADDLE_ALL_PLATFORMS_ANNUAL_PRICE_ID", "")
PADDLE_REDBUBBLE_ANNUAL_TRIAL_PRICE_ID = _optional("PADDLE_REDBUBBLE_ANNUAL_TRIAL_PRICE_ID", "")
PADDLE_TEEPUBLIC_ANNUAL_TRIAL_PRICE_ID = _optional("PADDLE_TEEPUBLIC_ANNUAL_TRIAL_PRICE_ID", "")
PADDLE_ALL_PLATFORMS_ANNUAL_TRIAL_PRICE_ID = _optional("PADDLE_ALL_PLATFORMS_ANNUAL_TRIAL_PRICE_ID", "")

# Free-trial abuse prevention. TRIAL_HASH_SALT is required only on the
# trial eligibility/start-trial code paths so the backend can boot while
# operators add the migration and secret.
TRIAL_HASH_SALT = _optional("TRIAL_HASH_SALT", "")
TRIAL_IP_LOOKBACK_DAYS = int(_optional("TRIAL_IP_LOOKBACK_DAYS", "0"))

def paddle_plan_for_price_id(price_id: str) -> str:
    """Map a Paddle price id to its internal plan key (or ""). Empty
    string means "unknown plan" — caller decides how to handle it.
    """
    pid = (price_id or "").strip()
    if not pid:
        return ""
    
    # Fallback to existing price variables
    if pid == PADDLE_REDBUBBLE_PRICE_ID:
        return "redbubble"
    if pid == PADDLE_TEEPUBLIC_PRICE_ID:
        return "teepublic"
    if pid == PADDLE_ALL_PLATFORMS_PRICE_ID:
        return "all_platforms"
        
    # Explicit monthly price variables
    if PADDLE_REDBUBBLE_MONTHLY_PRICE_ID and pid == PADDLE_REDBUBBLE_MONTHLY_PRICE_ID:
        return "redbubble"
    if PADDLE_TEEPUBLIC_MONTHLY_PRICE_ID and pid == PADDLE_TEEPUBLIC_MONTHLY_PRICE_ID:
        return "teepublic"
    if PADDLE_ALL_PLATFORMS_MONTHLY_PRICE_ID and pid == PADDLE_ALL_PLATFORMS_MONTHLY_PRICE_ID:
        return "all_platforms"
    if PADDLE_REDBUBBLE_MONTHLY_TRIAL_PRICE_ID and pid == PADDLE_REDBUBBLE_MONTHLY_TRIAL_PRICE_ID:
        return "redbubble"
    if PADDLE_TEEPUBLIC_MONTHLY_TRIAL_PRICE_ID and pid == PADDLE_TEEPUBLIC_MONTHLY_TRIAL_PRICE_ID:
        return "teepublic"
    if PADDLE_ALL_PLATFORMS_MONTHLY_TRIAL_PRICE_ID and pid == PADDLE_ALL_PLATFORMS_MONTHLY_TRIAL_PRICE_ID:
        return "all_platforms"
        
    # Explicit annual price variables
    if PADDLE_REDBUBBLE_ANNUAL_PRICE_ID and pid == PADDLE_REDBUBBLE_ANNUAL_PRICE_ID:
        return "redbubble"
    if PADDLE_TEEPUBLIC_ANNUAL_PRICE_ID and pid == PADDLE_TEEPUBLIC_ANNUAL_PRICE_ID:
        return "teepublic"
    if PADDLE_ALL_PLATFORMS_ANNUAL_PRICE_ID and pid == PADDLE_ALL_PLATFORMS_ANNUAL_PRICE_ID:
        return "all_platforms"
    if PADDLE_REDBUBBLE_ANNUAL_TRIAL_PRICE_ID and pid == PADDLE_REDBUBBLE_ANNUAL_TRIAL_PRICE_ID:
        return "redbubble"
    if PADDLE_TEEPUBLIC_ANNUAL_TRIAL_PRICE_ID and pid == PADDLE_TEEPUBLIC_ANNUAL_TRIAL_PRICE_ID:
        return "teepublic"
    if PADDLE_ALL_PLATFORMS_ANNUAL_TRIAL_PRICE_ID and pid == PADDLE_ALL_PLATFORMS_ANNUAL_TRIAL_PRICE_ID:
        return "all_platforms"

    if PADDLE_REDBUBBLE_PAID_PRICE_ID and pid == PADDLE_REDBUBBLE_PAID_PRICE_ID:
        return "redbubble"
    if PADDLE_TEEPUBLIC_PAID_PRICE_ID and pid == PADDLE_TEEPUBLIC_PAID_PRICE_ID:
        return "teepublic"
    if PADDLE_ALL_PLATFORMS_PAID_PRICE_ID and pid == PADDLE_ALL_PLATFORMS_PAID_PRICE_ID:
        return "all_platforms"
    for pack_key, (_, pack_price_id) in AI_TOKEN_PACKS.items():
        if pack_price_id and pid == pack_price_id:
            return pack_key
    return ""


def paddle_price_has_trial(price_id: str) -> bool:
    """Return true when a price ID matches one of the configured trial prices."""
    pid = (price_id or "").strip()
    if not pid:
        return False
    return pid in {
        PADDLE_REDBUBBLE_MONTHLY_TRIAL_PRICE_ID,
        PADDLE_TEEPUBLIC_MONTHLY_TRIAL_PRICE_ID,
        PADDLE_ALL_PLATFORMS_MONTHLY_TRIAL_PRICE_ID,
        PADDLE_REDBUBBLE_ANNUAL_TRIAL_PRICE_ID,
        PADDLE_TEEPUBLIC_ANNUAL_TRIAL_PRICE_ID,
        PADDLE_ALL_PLATFORMS_ANNUAL_TRIAL_PRICE_ID,
    }


def _missing_paddle_keys() -> list[str]:
    return [
        name
        for name, value in [
            ("PADDLE_API_KEY", PADDLE_API_KEY),
            ("PADDLE_WEBHOOK_SECRET", PADDLE_WEBHOOK_SECRET),
        ]
        if not value
    ]


def require_paddle_config() -> None:
    """Raise a clear error if Paddle env vars are missing.

    Call this at the start of any code path that talks to Paddle. Importing
    config.py alone does not require Paddle to be set up.
    """
    missing = _missing_paddle_keys()
    if missing:
        raise RuntimeError(
            "Paddle is not configured. Missing env vars: "
            + ", ".join(missing)
            + ". Add them to backend/.env (see backend/.env.example)."
        )


def warn_if_paddle_missing(logger=None) -> None:
    """Log a one-line warning when Paddle env vars are missing.

    Safe to call from feature code that wants to degrade gracefully instead
    of raising. Passes silently when everything is configured.
    """
    missing = _missing_paddle_keys()
    if not missing:
        return
    msg = (
        "Paddle env vars not set: "
        + ", ".join(missing)
        + ". Paddle-dependent endpoints will be unavailable until you add "
        "them to backend/.env."
    )
    if logger is not None:
        try:
            logger.warning(msg)
            return
        except Exception:  # pragma: no cover — fall back to stderr
            pass
    import sys
    print(f"WARNING: {msg}", file=sys.stderr)


# ── Admin Cleanup ───────────────────────────────────────────────────────────
ADMIN_CLEANUP_SECRET = _optional("ADMIN_CLEANUP_SECRET", "")

# ── Email Quality & Anti-temp-mail Checks ──────────────────────────────────
EMAIL_BLOCK_DISPOSABLE = _optional("EMAIL_BLOCK_DISPOSABLE", "true").lower() == "true"
EMAIL_VERIFICATION_PROVIDER = _optional("EMAIL_VERIFICATION_PROVIDER", "")
EMAIL_VERIFICATION_API_KEY = _optional("EMAIL_VERIFICATION_API_KEY", "")
EMAIL_REQUIRE_MX_CHECK = _optional("EMAIL_REQUIRE_MX_CHECK", "false").lower() == "true"
