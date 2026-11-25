# PodPilot Admin HQ deployment runbook

PodPilot Admin HQ is a separate React/Vite application in `admin-frontend/`.
It is designed for `https://admin.podpilot.space` and uses the existing FastAPI
service at `https://api.podpilot.space`. No production change is performed by
this repository work alone.

## Security gates before deployment

Do not expose the Admin HQ publicly until every item below is complete:

1. Back up the production database and review
   `docs/migration_admin_hq_foundation.sql` in a staging Supabase project.
2. Apply the additive migration in staging, run the backend tests, and verify
   that `anon` and `authenticated` have no grants on the admin tables.
3. Insert the single Owner principal manually using the Owner's immutable
   Supabase Auth UUID. Do not authorize by email or user-editable metadata:

   ```sql
   insert into public.admin_principals (user_id, role, status, capabilities)
   values ('OWNER_SUPABASE_AUTH_UUID', 'owner', 'active', array[]::text[]);
   ```

4. Enroll and verify a Supabase TOTP factor for that Owner. The API refuses an
   Admin session when the access token is not at authentication assurance level
   `aal2` while `ADMIN_REQUIRE_MFA=true`.
5. Configure exact production origins and secure cookies. Never use wildcard
   CORS for the Admin HQ.
6. Confirm that Supabase Auth allows `https://admin.podpilot.space` as an
   authorized redirect/site origin. The current UI does not use email-link login,
   but recovery and future OAuth flows must still be restricted correctly.
7. Validate the CSP at the actual host. The included `public/_headers` file is
   suitable for Cloudflare Pages; translate the same policy if another host is
   used.

## Backend environment

Add these values to the API service's protected environment:

```dotenv
ALLOWED_ORIGINS=https://podpilot.space,https://admin.podpilot.space
ADMIN_APP_ORIGIN=https://admin.podpilot.space
ADMIN_REQUIRE_MFA=true
ADMIN_SESSION_IDLE_MINUTES=20
ADMIN_SESSION_ABSOLUTE_HOURS=8
ADMIN_REAUTH_MAX_AGE_SECONDS=300
ADMIN_COOKIE_SECURE=true
PUBLIC_APP_URL=https://podpilot.space
```

The backend keeps all service-role, Paddle, R2, CDN-signing, and AI credentials.
No privileged credential belongs in `admin-frontend` or a browser-visible host.

## Frontend environment and build

Create the host's environment from `admin-frontend/.env.example`:

```dotenv
VITE_API_BASE_URL=https://api.podpilot.space
VITE_SUPABASE_URL=https://PROJECT_REF.supabase.co
VITE_SUPABASE_ANON_KEY=PUBLIC_SUPABASE_ANON_KEY
```

The anon key is public by design; RLS and the backend Owner session remain the
security boundaries. Then build:

```powershell
cd admin-frontend
npm ci
npm run build
```

Publish only `admin-frontend/dist`. The `_redirects` file provides SPA fallback,
and `_headers` provides security and cache headers on Cloudflare Pages.

## DNS and TLS

Recommended hosting is a separate Cloudflare Pages project connected only to
`admin-frontend`, with the custom domain `admin.podpilot.space`. Create the DNS
record through the Pages custom-domain flow so Cloudflare provisions TLS. Do not
point the admin hostname at the customer frontend deployment.

## Staged rollout

1. Deploy the backend containing `/api/admin/*` with the admin hostname absent
   from public DNS.
2. Apply the reviewed migration and Owner principal in staging, then production.
3. Deploy the Admin frontend to a temporary protected preview URL and run the
   smoke checks below.
4. Add `admin.podpilot.space`, verify TLS/CSP/CORS, then restrict or remove the
   preview URL.
5. Monitor `admin_security_events`, `admin_audit_logs`, API error rates, and
   Paddle webhook freshness.

Rollback is independent: remove/disable the Admin Pages custom domain, revoke
all rows in `admin_sessions`, and roll back the API release. The additive tables
may remain for audit preservation; do not drop them during an incident.

## Production smoke checks

- An unauthenticated `/api/admin/session` request returns 401.
- A normal customer account cannot exchange an Owner session.
- An Owner at `aal1` is required to complete MFA.
- An Owner at `aal2` receives the HttpOnly, Secure, SameSite=Strict session
  cookie and can load Overview.
- A state-changing request without the bound CSRF token is rejected.
- A state-changing request from any Origin other than the exact Admin hostname
  is rejected.
- User, design, subscription, upload, affiliate, and AI tables show real rows or
  an explicit unavailable/empty state.
- Financial metrics remain unavailable until the Paddle-backed ledger is
  populated; they must never silently display fabricated zeros.
- Session revocation and logout immediately prevent subsequent access.
- Every sensitive action writes an audit record containing actor, target,
  reason, request ID, result, and safe before/after state.

## Operational limitations that remain deliberate

- Live Paddle catalog and provider billing invoices are not verified without
  production credentials. Financial source-of-truth stays in Paddle.
- Hard design deletion remains disabled until reference checks, recovery, and
  storage cleanup have been verified against production-shaped staging data.
- Provider cost metrics remain unavailable unless a versioned rate card or
  provider invoice feed is configured.
- `RATE_LIMIT_BACKEND=redis` should be used in multi-instance production. A
  process-local memory limiter is not a distributed security control.
