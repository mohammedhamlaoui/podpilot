# PodPilot multi-user setup

PodPilot is now a multi-tenant SaaS. Each component has a clearly scoped
role and credentials never leak across the trust boundary:

| Component        | What it is                                      | Secrets it holds                          |
| ---------------- | ----------------------------------------------- | ----------------------------------------- |
| Backend (FastAPI)| Auth + DB + R2 gateway                          | `SUPABASE_SERVICE_ROLE_KEY`, R2 secrets   |
| Supabase         | Postgres for metadata + Auth                    | (managed by Supabase)                     |
| Cloudflare R2    | Object store for Excel sheets + design images   | (managed by Cloudflare)                   |
| Frontend (Vite)  | Dashboard UI, talks to backend with bearer JWT  | `VITE_SUPABASE_ANON_KEY` (public), URLs   |
| Chrome extension | Popup login + queue runner                      | Stores Supabase session in `chrome.storage.local` |

## Trust boundary rules

- The **service-role key** and **R2 secrets** live in `backend/.env` and
  nowhere else. They are never sent to a browser.
- The frontend and the extension only ever see the public Supabase URL
  and anon key, plus signed R2 URLs minted by the backend on demand.
- Every backend route that touches user data declares
  `Depends(get_current_user)`. The dependency calls Supabase
  (`/auth/v1/user`) to verify the JWT and returns the verified `user_id`.
  The user_id from the request body or query string is ignored.
- Every Supabase query is scoped by that verified `user_id`. Supabase RLS
  is enabled as defense-in-depth.

## Backend setup

1. Copy `backend/.env.example` to `backend/.env` and fill in real values.
2. `cd backend && py -3.13 -m venv .venv` (Python 3.13 — pydantic-core
   doesn't have prebuilt 3.14 wheels yet).
3. `.\.venv\Scripts\python.exe -m pip install -r requirements.txt`
4. `.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000`

Run the SQL in `docs/SUPABASE_SCHEMA.sql` in the Supabase SQL editor if
the `designs`, `upload_jobs`, `upload_logs` tables aren't already
present. Note that the live Supabase project uses `supporting_tags` as
`text[]` — the backend converts comma-separated strings to arrays
automatically.

## Frontend setup

1. Copy `frontend/.env.example` to `frontend/.env`.
2. Set `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, optionally
   `VITE_API_BASE_URL` (defaults to `http://localhost:8000`).
3. `cd frontend && npm install && npm run dev`

Every `axios` call attaches the current Supabase access token via the
request interceptor in `src/api/client.js`. If the backend returns 401,
the user is bounced to the login page on next render.

## Chrome extension setup

1. Open `chrome://extensions`, enable Developer mode, click "Load
   unpacked", and select the `extension/` folder.
2. The popup shows a sign-in form on first launch. Use the same
   email/password as the dashboard.
3. The session is stored in `chrome.storage.local` and refreshed
   automatically before the access token expires.

When you sign in on the dashboard while the extension is installed, the
dashboard hands its session to the extension (via
`chrome.runtime.sendMessage(EXTENSION_ID, { access_token, ... })`) so
you don't have to type your password twice.

## Status sync

```
website (axios + bearer)
                  └──→ backend ──→ Supabase: status='pending'

extension popup (Supabase auth)
                  └──→ backend GET /upload-jobs/pending  → list of pending designs

extension queue runs:
        before each design → POST /designs/{id}/status status='uploading'
        after success      → POST /designs/{id}/status status='uploaded'
        after failure      → POST /designs/{id}/status status='failed'

website polls listDesigns() every 5s → row flips to "Done" or "Error"
```

Both website and extension always read status from Supabase via the
backend, so they cannot diverge.

## File layout in R2

```
podpilot-files/
├── users/
│   └── {user_id}/
│       ├── redbubble/
│       │   └── {design_id}/
│       │       └── image.png
│       ├── teepublic/
│       │   └── {design_id}/
│       │       └── image.png
│       └── imports/
│           └── {import_id}/
│               └── sheet.xlsx
```

Two users can never collide on the same key because the `{user_id}`
prefix is the leading path segment.
