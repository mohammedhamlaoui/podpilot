# Paddle LIVE production acceptance — 2026-11-28

Decision: **READY for new LIVE checkout; customer checkout is enabled.**
No real payment was submitted, no customer was charged, and no real refund was issued.
Live paid subscription plan changes remain an explicit verification limit below.

## Deployed releases

- API: `podpilot-api:billing-8522cab13e58c4c1`.
- API image: `sha256:a2a5b4ecd5fd6e4474f33990cf3bf3df2fc56772e03e7975f06030bd04ca253e`.
- Backend overlay source baseline: `aafecde193264efb1c30d90def3ac34e33104198`.
  The release overlays only billing, webhook and config files on the prior working image,
  preserving the already deployed storage/CDN code. The repository base alone must not
  replace the running image because unrelated storage work is outside this billing branch.
- Frontend commit: `1ac3219833d65394ac4368c096ed2fc4ff932289`.
- Cloudflare Pages production deployment: `047be964-5b41-4c73-9ba6-89b7cb10d77d`.
- Frontend LIVE public client token corrected in the existing Pages build environment.
  No API key or webhook secret is bundled into the frontend.
- Default Paddle payment link: `https://podpilot.space/checkout`; domain shown as Checkout approved.
- Main website/API DNS, firewall, CDN Worker, storage pointers and storage configuration were not changed.

## Catalog reconciliation

The final LIVE API scan covered active and archived products/prices, with pagination exhausted:
4 active products, 8 active prices, 1 archived price. Nothing was created or duplicated.
Exact Product IDs, Price IDs, USD amounts and billing cycles are in
`PADDLE_LIVE_CATALOG_VERIFIED_20261128.json`.

| Offer | Monthly | Annual / one-time |
| --- | --- | --- |
| Redbubble | $8.99 | $89.90/year |
| TeePublic | $8.99 | $89.90/year |
| Redbubble + TeePublic | $10.99 | $109.90/year |
| 1,000 AI credits | — | $4.99 once |
| 10,000 AI credits | — | $39.99 once |

The bundle annual interval was originally month/1. The owner corrected it to year/1;
this was independently verified through the LIVE API and actual Paddle checkout.
The archived 500-credit price is not offered. The old checkout-page-only 250-credit
configuration was replaced with the two supported packages.

## Security and database changes

Rotated secret configured in `/etc/podpilot/billing-live.env`, root-owned mode 0600.
Old destination is deactivated; new destination is
`ntfset_01m8fnb5j96g677wq6mdacvdsm`.
Endpoint is `https://api.podpilot.space/api/paddle/webhook`.
Raw request-body HMAC, timestamp tolerance, duplicate deliveries, owner binding,
transaction uniqueness, subscription ordering and proportional approved refunds are enforced.
Public/browser roles cannot execute fulfillment RPCs or access webhook/credit ledgers.

Applied transactionally to the existing Supabase database:

1. `migration_paddle_live_fulfillment.sql`: atomic event claims and fulfillment/refund
   RPCs; subscription event metadata; credit adjustment ledger and restricted privileges.
2. `migration_paddle_credit_plan_compatibility.sql`: credit-only cold insert uses
   existing required `starter` / `inactive` values, without granting subscription access.
3. `migration_paddle_billing_cycle.sql`: nullable monthly/annual metadata column and constraint.

The canonical fulfillment migration includes the compatibility fixes. Do not reapply
these migrations merely to redeploy. No existing plans, users or AI balances were reset.

## Actual production verification

| Check | Result |
| --- | --- |
| SSH after Wi-Fi switch | Authentication succeeded using existing username/key |
| Website and API HTTPS health | HTTP 200; API Docker healthy |
| Oracle mount retained | `/srv/podpilot-data`, `/dev/sdb`, ext4, 146.6G filesystem, about 139G available |
| Actual Paddle notification simulator | HTTP 200 for `transaction.billed`, simulation `ntfsim_01m8fp412rkn6bqqbxr0k69jpt` |
| Missing / invalid / expired signatures | HTTP 401 |
| Valid new-secret signature, missing event ID | HTTP 400, proving signature accepted and event validation enforced |
| Old-secret signature | HTTP 401 in earlier acceptance check |
| Production lifecycle / credits / refunds canaries | 38/38 + 20/20 + 15/15 assertions passed |
| Concurrent duplicate production deliveries | 20 HTTP 200 responses; one 10,000-credit grant |
| Owned Paddle portal endpoint and returned HTTPS URL | HTTP 200 |
| Real browser checkout forms | All 6 subscription prices and both one-time prices loaded Paddle card forms |
| Actual pricing-page credit buttons | Correct $4.99 and $39.99 Paddle forms |
| Payment-link `_ptxn` flow | Existing $39.99 transaction preserved; no new offer substituted |
| Invalid payment link | Rejected without opening checkout |
| Checkout after general enable | All 8 authenticated resolver HTTP requests returned 200 without allowlisting |
| Unauthenticated checkout | HTTP 401 |
| Final configuration | `PADDLE_CHECKOUT_ENABLED=true`; empty `PADDLE_CANARY_USER_IDS` |

Evidence files in `paddle-acceptance-evidence/` distinguish production HTTP tests from
local tests. Lifecycle, refunds and credit fulfillment were exercised using signed
synthetic fixtures against the actual production backend/database, not real paid events.
The Paddle-generated billed simulation was acknowledged as intentionally ignored; it
proves transport and real Paddle signing, not credit fulfillment. An additional completed
simulation definition was created but was not run; it is not counted as passing evidence.

Local verification also passed: 25 Python tests, 13 embedded PostgreSQL SQL test groups,
payment-link SDK regression assertions, frontend production build and `git diff --check`.
The embedded PostgreSQL queued test is single-connection; the 20 concurrent production
HTTP deliveries provide the separate production duplicate-delivery evidence.

## Resolved failures and cleanup

Resolved: stale frontend client token causing price-not-found; missing default payment
URL; wrong bundle annual interval; missing billing_cycle column; credit-only NOT NULL
plan insert; obsolete 250-credit checkout-page configuration; transaction links overriding
existing transactions. An initial host-local health probe targeted an unpublished port;
Docker health and the actual public API both verified recovery. No service health failure
was observed after the recreated API became healthy.

Sixteen UI-generated unpaid canary transactions were canceled, the exact canary Paddle
customer was archived, and disposable auth users and checkout intents were removed.
The final enabled-mode resolver canary was also cleaned. No paid transaction was canceled.
No customer files were deleted. Webhook audit rows were retained. The temporary local
magic-link launcher was stopped, and the server canary allowlist was cleared.

Protected evidence remains in `/var/backups/podpilot/billing-20261127T233316Z/`:
root-only targeted snapshots, `ui-canary-before-cleanup.json`, `ui-closeout-report.json`,
and `customer-enable-report.json`. Comparison against the pre-rollout snapshot found:

| Original table | Original rows | Missing | Modified original rows |
| --- | ---: | ---: | ---: |
| subscriptions | 21 | 0 | 0 |
| paddle_checkout_intents | 219 | 0 | 0 |
| paddle_webhook_events | 325 | 0 | 0 |
| paddle_token_credits | 0 | 0 | 0 |

Additional webhook audit records are expected; they were not purged.

## Limits and operational follow-up

No real card charge, paid renewal, bank settlement, real refund, or existing paid-customer
upgrade/downgrade was executed. Those cannot be claimed as production payment successes.
Subscription price changes and status synchronization passed synthetic production canaries;
custom in-app paid upgrade/downgrade endpoints were not deployed. Manage existing paid
subscriptions through the Paddle portal/dashboard and verify that account's permitted
plan-change settings before promising in-app self-service plan switching.

Monitor Paddle delivery failures and backend webhook errors after the first genuine
customer purchase. Keep webhook delivery active even when disabling new checkout.

## Rollback

Prefer disabling new checkout while keeping secure webhook processing and additive schema:

1. Set `PADDLE_CHECKOUT_ENABLED=false` and leave `PADDLE_CANARY_USER_IDS=` empty in the
   protected billing environment. The pre-enable root-only environment copy is
   `/etc/podpilot/billing-live.env.before-customer-enable`.
2. Recreate only `api` with all four existing Compose files:
   `compose.oracle.yml`, `compose.cdn-release.yml`, `compose.oracle-first.yml`,
   `compose.billing-live.yml` under `/opt/podpilot/deploy/`, using
   `up -d --no-deps --no-build --force-recreate api`.
3. Verify Docker health, public `/healthz`, authenticated checkout HTTP 503, and continued
   signed webhook acceptance. Do not restore the exposed old webhook secret.
4. If code rollback is essential, previous API image is `podpilot-api:04433d1cbf6b62e9`;
   keep new checkout disabled and assess older fulfillment behavior before using it.
   Prefer the current tested webhook image plus the checkout kill switch.
5. Pages keeps previous deployments, including corrected-token deployment
   `94dcebb1-c37b-4ba8-9a94-7fd577ef94a8`; frontend rollback may restore known credit-page
   and payment-link limitations. No DNS, Worker or database rollback is required.

Never remove additive schema, existing customer records or storage data during rollback.
