# PodPilot — technical and product handoff

This document is a repository-grounded briefing for another AI or developer. Read it together with the code before changing behavior. Snapshot: local checkout of `mohammedhamlaoui/podpilot`, branch `codex/new-feature`, reviewed 2026-11-22. It describes implemented code and checked-in documentation; it does not verify the live Supabase, Paddle, Cloudflare, or production server state.

## 1. Product and scope

PodPilot is a print-on-demand SaaS for preparing design listings and automating uploads. The currently supported marketplaces are **Redbubble and TeePublic**. Amazon Merch is mentioned as future/optional in `PRODUCT.md`, not an active upload flow. A user imports design images and listing metadata, edits and queues designs in the dashboard, and uses a Chrome extension to upload through their own marketplace browser session. The app also has subscription/access control, AI listing help, trademark/copyright checks, affiliate features, and administration/cleanup endpoints.

Core product guidance in `PRODUCT.md`: preserve auth, uploads, billing, webhook, subscription, queue, extension, and schema behavior when making unrelated changes. Design guidance in `DESIGN.md`: restrained, light dashboard, purple `#7C3AED`, clear hierarchy, and the existing animated auth logo.

## 2. Architecture and trust boundaries

| Part | Technology and role | Main location |
| --- | --- | --- |
| Web app | React 18 + Vite 6 dashboard, public pages, auth, design editor, billing UI | `frontend/` |
| API | FastAPI + Uvicorn; auth checks, design/job APIs, billing, affiliate, AI and R2 access | `backend/app/` |
| Identity/database | Supabase Auth and Postgres; backend verifies bearer tokens against `/auth/v1/user` | `backend/app/core/auth.py`, `backend/app/services/supabase_service.py` |
| Object storage | Private Cloudflare R2 bucket for design images, thumbnails, Excel and AI preview objects | `backend/app/services/r2_service.py` |
| CDN | Cloudflare Worker validates signed URLs before reading private R2 objects | `workers/cdn/` |
| Browser automation | Manifest V3 Chrome extension, background worker, popup, content scripts for both marketplaces | `extension/` |
| Payments | Paddle subscriptions, checkout, customer portal, webhooks, AI credit packs | `backend/app/api/billing.py`, `paddle_webhook.py` |
| AI | Gemini and OpenRouter integrations for listing/copyright related features | `backend/app/services/ai_*`, `openrouter_service.py` |

The browser receives the public Supabase URL/key, a user's own access token, and signed file URLs. `SUPABASE_SERVICE_ROLE_KEY`, R2 credentials, Paddle API/webhook secrets, CDN signing secret, and admin secrets belong only on the backend. Backend database queries must remain scoped to the verified user ID even though the service-role client bypasses RLS. See `docs/MULTI_USER_SETUP.md`.

## 3. Repository map

- `frontend/src/App.jsx`: main app routing/state; `components/`: dashboard, Redbubble/TeePublic imports/editors/queues, billing, public/affiliate/admin pages; `api/client.js`: HTTP client; `auth/` and `lib/supabaseClient.js`: sign-in/session integration; `config/paddle.js`: browser Paddle configuration.
- `backend/app/main.py`: FastAPI app, CORS, security headers, router registration, startup schema probe. `api/routes.py`: core design, queue, AI, device, trademark and admin endpoints. `api/billing.py`, `api/paddle_webhook.py`, `api/affiliate.py`: separate feature routers. `core/config.py`: environment variables. `core/auth.py`: request authentication. `services/`: Supabase, R2, Excel parser, image previews, subscriptions, AI, rate limiting, etc.
- `extension/manifest.json`: permissions, host allowlist, content-script injection. `background.js`: service-worker automation coordination; `content.js`: Redbubble; `content-teepublic.js`: TeePublic; `popup.js`/`popup.html`: extension UI; `auth.js`: Supabase and API communication; `offscreen.js`: offscreen work.
- `workers/cdn/src/index.js`: signed CDN delivery; `workers/cdn/wrangler.jsonc`: Worker config.
- `docs/SUPABASE_SCHEMA.sql`: base SQL schema. `docs/migration_*.sql`: incremental schema changes. `docs/BACKEND_DEPLOYMENT.md`, `MULTI_USER_SETUP.md`, `AUTO_DELETE_CLEANUP.md`: operations/setup.
- `backend/tests/`: backend tests and diagnostics; `backend/scripts/`: cleanup/Paddle diagnostics. `frontend/scripts/build.mjs`: production build script.

## 4. User journeys

1. **Auth:** user signs up/logs in via Supabase. Frontend stores/refreshes session and attaches bearer token to API calls. Backend checks the token with Supabase Auth and uses the returned user ID for protected operations.
2. **Import:** user uploads an Excel metadata file, previews parsed rows, confirms import, and uploads/matches image files. Core routes include `/designs/import/preview`, `/designs/import/confirm`, `/designs/import/images`; `excel_parser.py` and R2/Supabase services handle data and objects.
3. **Manage designs:** dashboard lists designs, shows thumbnails, edits metadata/colors/products, copies designs between marketplaces, deletes them, and manages upload statuses. Redbubble and TeePublic have separate UI paths and editing/queue components.
4. **Upload:** dashboard/extension obtain a marketplace queue and record upload sessions/item status. Content scripts operate on marketplace pages in the user's logged-in browser. Jobs and logs are persisted by the API. Never assume backend alone uploads to a marketplace.
5. **Subscriptions:** platform access and upload use are checked by backend endpoints. Paddle checkout/portal and signed webhook events manage plan state; AI token packs are separate one-time prices. The extension also verifies plan access.
6. **AI/checks:** OpenRouter/Gemini support listing generation/drafts and copyright risk checks. MarkerAPI can power trademark checks if configured. Missing provider credentials affect these features, not basic API import.
7. **Affiliate:** referral validation, click/attribution, affiliate dashboard/commission/payout endpoints, plus admin review endpoints.
8. **Retention:** designs are intended to be kept **20 days** from creation, using `designs.cleanup_at`; edits/status changes do not extend the deadline. Cleanup requires a real scheduler. See `docs/AUTO_DELETE_CLEANUP.md` and `docs/migration_design_cleanup_at_20d.sql` before changing retention.

## 5. API overview

`backend/app/main.py` registers the four routers. Representative endpoints (check route code for exact payloads and authorization):

| Area | Endpoints |
| --- | --- |
| Health | `/`, `/healthz`, `/healthz/schema` |
| User/devices | `/me`, `/api/device/status`, `/api/device/register`, `/api/device/switch`, `/api/device/heartbeat`, `/api/device/logout` |
| Designs | `/designs/import/preview`, `/designs/import/confirm`, `/designs/import/images`, `/designs`, `/designs/{design_id}`, `/designs/{design_id}/image`, `/designs/{design_id}/thumbnail`, batch update/delete, copy-to-marketplace |
| Uploads | `/upload-jobs`, `/upload-jobs/pending`, `/api/upload-queue/{marketplace}`, `/api/upload-sessions/{marketplace}`, `/api/upload-sessions/{session_id}/items/{design_id}/status`, `/upload-logs` |
| AI/trademark | `/api/ai/listing-content`, `/api/ai/listing-content/draft`, `/api/ai/copyright-check`, `/api/trademark/check`, `/trademark/check-design` |
| Billing | `/api/me/subscription`, `/api/me/platform-access`, `/api/billing/check-upload-access`, `/api/usage/increment-upload`, trial/checkout/portal endpoints, `/api/paddle/webhook` |
| Affiliate/admin | `/api/affiliate/*`, `/api/admin/affiliate/*`, cleanup admin endpoints |

When `DEBUG=false` (default), FastAPI `/docs`, `/redoc`, and `/openapi.json` are disabled. `/healthz` is available independently. Some route definitions in `routes.py` occur more than once; inspect the final registered behavior before refactoring them.

## 6. Data model and files

The base schema in `docs/SUPABASE_SCHEMA.sql` creates `designs`, `upload_jobs`, `upload_logs`, `subscriptions`, `upload_usage`, `ai_usage`, `paddle_webhook_events`, `paddle_token_credits`, `paddle_checkout_intents`, and `trial_usage`, with RLS enabled. Later migrations add/modify fields and tables (device sessions, affiliate data, colors/products, thumbnails, AI previews/tokens, cleanup timestamps, indexes). **Do not treat the base SQL file alone as a complete final production schema.** Check all migrations and the actual target database before applying changes.

R2 contains private user assets. Backend issues signed access or proxies image/thumbnail delivery. The CDN signing setup is optional at import time but required for the signed CDN delivery path. Manual/automatic deletion must account for design image, thumbnail, Excel, AI preview R2 keys, related logs, and DB rows.

## 7. Configuration and credentials

`backend/app/core/config.py` loads `backend/.env`. Six variables are required at import/startup: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`. `R2_BUCKET_NAME` defaults to `podpilot-files`; `R2_ENDPOINT` defaults from the account ID. `ALLOWED_ORIGINS` defaults to localhost Vite origins plus public PodPilot domains. Set `DEBUG=true` locally for API docs.

Optional feature configuration:

| Feature | Key variables |
| --- | --- |
| AI | `GEMINI_API_KEY`, `AI_PROVIDER`, `AI_MODEL`, `OPENROUTER_API_KEY`, `AI_LISTING_PROVIDER`, `OPENROUTER_MODEL`, optional free fallback flags |
| Billing | `PADDLE_ENVIRONMENT`, `PADDLE_API_KEY`, `PADDLE_WEBHOOK_SECRET`, subscription and AI-token `PADDLE_*_PRICE_ID` variables |
| CDN | `CDN_BASE_URL`, `CDN_SIGNING_SECRET`, `CDN_URL_TTL_SECONDS` |
| Trademark | `TRADEMARK_API_PROVIDER=markerapi`, `MARKERAPI_USERNAME`, `MARKERAPI_PASSWORD`, optional website/base URL; legacy aliases supported |
| Other | `ADMIN_CLEANUP_SECRET`, `TRIAL_FINGERPRINT_SALT`, email verification variables, affiliate secrets/salt, rate-limit settings |

The full **production-shaped example** is `backend/.env.production.example`. Some checked-in docs reference `backend/.env.example`, but that file is absent in this checkout. Never paste real secret values into this handoff or commit `.env` files. `frontend/.env.example` is also absent in this checkout despite being referenced in docs/UI.

Frontend needs `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`; `VITE_API_BASE_URL` selects the API server (inspect `frontend/src/api/client.js` for its local/prod fallback). Paddle browser checkout uses `VITE_PADDLE_CLIENT_TOKEN`, `VITE_PADDLE_ENVIRONMENT` and browser-visible price IDs. `VITE_EXTENSION_ID` can override the baked-in ID. **Only public values go in `VITE_*`** because Vite bundles them into client JS.

The extension currently has production API/Supabase URLs and host permissions in `extension/auth.js` and `extension/manifest.json`. A local backend and frontend do **not** automatically make the extension use local endpoints; inspect and adjust its config/permissions in a development copy before local extension testing.

## 8. Local development

```powershell
# From D:\podpilot-v2\backend, after creating backend/.env:
py -3.13 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload

# In a separate terminal from D:\podpilot-v2\frontend, after creating frontend/.env:
npm install
npm run dev
```

The checked-in setup guide specifies Python 3.13. Frontend Vite commonly serves port 5173; backend CORS already includes `http://localhost:5173` and `http://127.0.0.1:5173`. Use matching Supabase project credentials, an accessible R2 bucket, and a database with required migrations. To inspect the API locally, set `DEBUG=true` and open `http://127.0.0.1:8000/docs`. The production deployment guide describes Hetzner Ubuntu, Caddy, Uvicorn on `127.0.0.1:8000`, `api.podpilot.space`, and a Paddle webhook; it is deployment guidance, not proof of current live infrastructure.

## 9. Known handoff caveats

- The repository and docs may lag live services. Confirm Supabase schema, Paddle price IDs, webhook secret, Cloudflare Worker configuration, and extension store build before production changes.
- Supabase dashboard now shows publishable/secret keys alongside legacy anon/service-role keys. The current code uses environment variable names `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY`; validate compatibility before changing credential type.
- The extension is coupled to production hosts in checked-in files. Keep production and local testing isolated.
- Design cleanup is not automatic merely because `cleanup_at` exists. The server timer/script must run; see the retention doc.
- Billing and access control span frontend, backend, Supabase schema, Paddle and extension. Change them together and test complete flows.

## 10. Best source files for a new AI

Start with `PRODUCT.md`, `DESIGN.md`, this handoff, `docs/MULTI_USER_SETUP.md`, `docs/AUTO_DELETE_CLEANUP.md`, `backend/app/core/config.py`, `backend/app/main.py`, `backend/app/api/routes.py`, `backend/app/api/billing.py`, `backend/app/api/paddle_webhook.py`, `frontend/src/App.jsx`, `frontend/src/api/client.js`, and `extension/manifest.json`. Then read the implementation files and migrations for the specific feature being changed. Ask for the target environment and requested outcome before touching production credentials or migrations.
