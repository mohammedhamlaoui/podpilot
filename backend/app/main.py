"""FastAPI application entry point."""
import logging
import uuid

from fastapi import FastAPI
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.billing import router as billing_router
from app.api.affiliate import router as affiliate_router
from app.api.paddle_webhook import router as paddle_webhook_router
from app.api.admin.routes import router as admin_router
from app.api.routes import router
from app.core.config import ALLOWED_ORIGINS, DEBUG
from app.services import logging_utils, platform_settings_service, supabase_service

# Configure logging so podpilot.delete and other loggers show in console.
logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")

app = FastAPI(
    title="PodPilot API",
    docs_url="/docs" if DEBUG else None,
    redoc_url="/redoc" if DEBUG else None,
    openapi_url="/openapi.json" if DEBUG else None,
)


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request, exc):
    for error in exc.errors():
        loc = tuple(error.get("loc") or ())
        error_type = str(error.get("type") or "")
        if "image_base64" in loc and (
            error_type.endswith("too_long") or "max_length" in error_type
        ):
            return JSONResponse(
                status_code=413,
                content={"detail": "Image is too large for AI risk check."},
            )
    return JSONResponse(status_code=422, content={"detail": jsonable_encoder(exc.errors())})


SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "geolocation=(), microphone=(), camera=()",
    "X-Frame-Options": "DENY",
}


@app.middleware("http")
async def add_request_id(request, call_next):
    incoming = request.headers.get("x-request-id")
    req_id = (incoming or uuid.uuid4().hex[:12]).strip()[:64] or uuid.uuid4().hex[:12]
    request.state.request_id = req_id
    token = logging_utils.set_request_id(req_id)
    try:
        response = await call_next(request)
    finally:
        logging_utils.reset_request_id(token)
    response.headers["X-Request-ID"] = req_id
    return response


@app.middleware("http")
async def add_security_headers(request, call_next):
    response = await call_next(request)
    for name, value in SECURITY_HEADERS.items():
        if name not in response.headers:
            response.headers[name] = value
    return response


@app.middleware("http")
async def enforce_platform_controls(request, call_next):
    path = request.url.path
    privileged_or_system = path.startswith(
        (
            "/api/admin",
            "/api/paddle/webhook",
            "/healthz",
            "/docs",
            "/openapi.json",
            "/redoc",
        )
    ) or path == "/"
    if not privileged_or_system and platform_settings_service.enabled("maintenance_mode"):
        return JSONResponse(
            status_code=503,
            content={"detail": "PodPilot is temporarily in maintenance mode."},
            headers={"Retry-After": "300"},
        )
    upload_path = path.startswith(
        ("/upload-jobs", "/upload-logs", "/api/upload-queue", "/api/upload-sessions")
    )
    if upload_path and not platform_settings_service.enabled("uploads_enabled"):
        return JSONResponse(
            status_code=503,
            content={"detail": "Upload workflows are temporarily disabled."},
            headers={"Retry-After": "300"},
        )
    if path.startswith("/api/ai/") and not platform_settings_service.enabled("ai_listing_enabled"):
        return JSONResponse(
            status_code=503,
            content={"detail": "AI features are temporarily disabled."},
            headers={"Retry-After": "300"},
        )
    return await call_next(request)

# CORS — explicit allow-list for the dashboard origins, regex for the
# Chrome extension. `allow_credentials=True` so the browser may send the
# Authorization header on cross-origin XHRs from the dashboard.
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router)
app.include_router(billing_router)
app.include_router(affiliate_router)
app.include_router(paddle_webhook_router)
app.include_router(admin_router)


@app.on_event("startup")
def _verify_schema() -> None:
    """At startup, log whether color_settings/product_settings columns
    exist in the designs table. If they don't, the operator must run
    docs/migration_color_product_settings.sql in the Supabase SQL editor.
    """
    try:
        present = supabase_service._probe_optional_columns()
        if not present:
            logging.getLogger("podpilot.startup").warning(
                "designs.color_settings / designs.product_settings missing — "
                "PATCH /designs/{id} will fail until you run "
                "docs/migration_color_product_settings.sql in Supabase."
            )
    except Exception as exc:
        logging.getLogger("podpilot.startup").warning(
            "Could not verify Supabase schema at startup: %s", exc
        )
