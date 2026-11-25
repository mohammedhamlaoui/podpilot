        # PodPilot Backend Infrastructure & Free VPS Audit

**Audit type:** read-only repository and local-runtime audit
**Repository snapshot:** working tree inspected 2026-11-23
**Scope:** `backend/`, `frontend/`, `extension/`, `workers/`, deployment examples, tests, and checked-in documentation.
**Production state:** not verified. No production credentials were printed or used for load testing.

## Executive verdict

**YELLOW — technically suitable for Oracle Always Free at the current scale, with operational limits.**

PodPilot’s current backend can run on an Oracle Ampere A1 ARM64 VM without paying for compute **if the tenancy is eligible, the selected shape is within the currently documented Always Free quota, and capacity is available in the chosen region**. The repository’s declared Python dependencies resolved successfully as ARM64 binary wheels for CPython 3.13 in a safe local `pip download` check.

The recommended free shape is **2 OCPU / 12 GB RAM**, which is the current Oracle documentation equivalent for the A1 Always Free allowance. A 1 OCPU / 2 GB VM may boot the API but is too tight for concurrent image processing, Excel imports, and AI requests. A 1 OCPU / 4 GB VM is usable for low traffic with strict concurrency, but has little burst headroom. A 2 OCPU / 8 GB VM is a sensible paid or quota-constrained target; 2 OCPU / 12 GB is the safer free-tier target.

This is not a claim that Oracle will provision the VM: Always Free capacity can be unavailable, quotas vary by tenancy/region, and Oracle billing eligibility must be checked in the account console. Oracle’s current Always Free page documents 1,500 A1 OCPU-hours and 9,000 GB-hours per month, equivalent to 2 OCPUs and 12 GB memory for Always Free tenancies: [Oracle Always Free resources](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm).

## 1. Current architecture

| Component | Verified implementation | Runs on the VPS? |
|---|---|---:|
| Customer web app | React 18 + Vite in `frontend/` | No; static frontend hosting/dev server |
| API | FastAPI 0.115.6 + Uvicorn 0.34 in `backend/app/` | Yes |
| Identity and metadata | Supabase Auth + Supabase Postgres via `supabase-py` | No; external managed service |
| Object storage | Private Cloudflare R2 via boto3/S3-compatible API | No; external managed service |
| Private asset delivery | Cloudflare Worker in `workers/cdn/`, signed URL validation | No; external edge service |
| Payments | Paddle checkout, customer portal, webhooks, subscriptions and credit packs | No; external provider, webhook enters API |
| AI | Gemini and OpenRouter HTTP APIs | No; external providers, request orchestration on API |
| Marketplace automation | Chrome Manifest V3 extension, content scripts and user browser session | No; extension/browser performs marketplace actions |
| Cleanup | Python cleanup script plus systemd timer example | Timer and script run on VPS |
| Reverse proxy/TLS | Caddy example proxies `api.podpilot.space` to `127.0.0.1:8000` | Yes, recommended |

The API is effectively stateless between requests. It validates Supabase bearer tokens, scopes database operations by verified user ID, reads/writes R2 objects, creates image previews/thumbnails, parses Excel, calls AI providers, handles Paddle webhooks, manages upload-job state, serves signed/private assets, and exposes admin/cleanup routes. The browser extension owns the Redbubble/TeePublic interaction; the backend records queue/session/status state and does not replace that browser automation with server-side marketplace automation.

## 2. Resource requirements

These are engineering estimates derived from the code paths and upload limits, not production telemetry.

| Resource | Low traffic / safe minimum | Recommended single-instance target | Reason |
|---|---:|---:|---|
| CPU | 1 vCPU | 2 vCPU/OCPU | API I/O is light; Pillow resize, Excel parsing and concurrent AI request preparation can use CPU |
| RAM | 2 GB (development/very low concurrency) | 8–12 GB | OS, Caddy, Python, Pillow buffers, concurrent uploads and headroom |
| Disk | 20 GB | 40–80 GB | OS, Python environment, logs, releases, swap; user media is in R2 |
| Network | 100 Mbps is adequate initially | 250 Mbps+ preferred | Images are uploaded/downloaded through API/R2; actual monthly transfer depends on user volume |
| Swap | 1–2 GB | 2–4 GB | Safety valve only; swap is not a substitute for RAM |

### Memory and CPU drivers

The code caps an individual image upload at 25 MB, Excel at 15 MB, and a batch at 200 MB (`backend/app/api/routes.py`). Image validation and Pillow operations materialize byte buffers and decoded pixel data; a large image can occupy substantially more RAM than its compressed file size. R2 also returns object bytes into memory for preview/thumbnail generation. AI services accept up to approximately 15 MB inline image input and create resized/base64 payloads. Excel uses `openpyxl` in read-only mode, which helps but still has per-workbook and row/object overhead.

The most memory-sensitive case is several simultaneous image uploads or AI image checks. A practical planning envelope is:

- Idle API process: approximately **120–160 MB private memory** in the local run observed below.
- Normal light traffic: **250–600 MB** for one Uvicorn process, depending on active request payloads.
- One large image/preview operation: transiently **100–400+ MB** above idle depending on pixel dimensions and format.
- Several concurrent large operations: **1–3 GB** transient use is plausible; this is an estimate, not measured production behavior.
- Caddy, system services and OS: reserve **350–700 MB**.

The code protects against decompression bombs and limits dimensions in `r2_service.py`, which lowers worst-case risk, but it does not create a bounded worker queue for image/Pillow work. Several synchronous CPU-heavy operations occur inside request handlers, so one Uvicorn worker can experience event-loop contention during image/Excel processing.

### Capacity estimate (assumptions)

Assuming 2 OCPU, 8–12 GB RAM, one Uvicorn worker, external Supabase/R2/AI services, mostly metadata requests, and no more than 1–2 concurrent large image operations:

- **20–50 concurrent light API requests** is a reasonable starting target.
- **5–15 concurrent image/Excel-heavy requests** is a safer planning range.
- AI calls are mostly network-bound, but provider latency and payload encoding can hold request resources for 30–180 seconds.

These are capacity planning ranges, not benchmark results. A real target requires representative load tests with synthetic images and mocked external services.

## 3. Local evidence and tests

The local services were already running during the audit and were inspected without production writes:

| Check | Result |
|---|---|
| `GET http://127.0.0.1:8000/healthz` | HTTP 200 |
| Backend process | Python/Uvicorn, one process observed |
| Backend private memory | ~119 MiB at the sampled idle point |
| Backend CPU | 0% in three one-second samples |
| ARM64 dependency resolution | `pip download --only-binary` for CPython 3.13/aarch64: **69 wheels, success** |
| Backend pytest suite | **Not run**: `pytest` is not installed in `backend/.venv` |
| Production load test | Not run; prohibited from using production credentials/services |

The local memory sample is a point-in-time idle observation after startup, including the repository’s startup Supabase schema probe. It is not a peak measurement. The two Vite development servers were also running and consumed roughly 160–175 MB private memory each; that is development tooling and is not part of the production API footprint.

## 4. Oracle Ampere A1 compatibility

### Python and native dependencies

The declared requirements are:

`fastapi`, `uvicorn[standard]`, `pydantic`, `pydantic-settings`, `python-multipart`, `python-dotenv`, `openpyxl`, `aiofiles`, `supabase`, `boto3`, `PyJWT[crypto]`, `httpx`, and `Pillow`.

A safe package-resolution check for `manylinux2014_aarch64`, CPython 3.13, binary-only packages completed successfully for all dependencies pulled by the requirements. This verifies package availability from the index at audit time; it does not verify every runtime behavior on an Oracle VM.

Potential ARM considerations:

- Use Ubuntu 24.04 ARM64 and Python 3.13, matching the repository documentation. Do not assume Python 3.14 wheels are available for all native dependencies.
- Pillow and cryptography have ARM64 wheels in the tested resolution path; keep build-essential and image libraries available as a fallback.
- No Dockerfile is checked in. A native venv/systemd deployment is simpler and avoids an unverified multi-architecture image pipeline.
- Browser extension code does not run on the server and has no ARM server dependency.

### Shape assessment

| Shape | Technical assessment | Verdict |
|---|---|---|
| 1 OCPU / 2 GB | Boots API, but OS + Caddy + Python + burst buffers leave little headroom; high risk during uploads/AI | Not recommended for production |
| 1 OCPU / 4 GB | Suitable for low-volume API with serialized heavy work and conservative limits | Possible, limited |
| 2 OCPU / 8 GB | Good small production target; enough CPU/RAM for normal single-instance traffic | Recommended if paid/quota constrained |
| 2 OCPU / 12 GB | Current documented Oracle Always Free equivalent; comfortable headroom for this architecture | Best free target |
| 4 OCPU / 24 GB | Legacy/community references conflict with current Oracle documentation; do not assume free eligibility | Treat as unverified/possibly chargeable |

## 5. Production readiness findings

### Positive findings

- A systemd service example uses a non-root `podpilot` user, `Restart=always`, `NoNewPrivileges=true`, `PrivateTmp=true`, and loopback binding.
- Caddy provides TLS termination and reverse proxying.
- `/healthz` exists, request IDs and security headers are added, and startup checks probe optional schema columns.
- Upload limits, image dimension/decompression-bomb checks, signed R2 URLs, user-scoped queries, Paddle webhook verification, and cleanup dry-run/confirmation safeguards are present.
- Cleanup is designed as an external systemd timer every 30 minutes with a 480-hour (20-day) retention window. It is configured only if the example units are actually installed and enabled; repository files alone do not prove production scheduling.

### Risks and gaps

1. **No production state verification.** Supabase schema, Paddle catalog/webhook state, R2 credentials, DNS, systemd status, backups, and real traffic are not verifiable from this checkout.
2. **Single process / no HA.** The service example starts one Uvicorn process and has no health-based failover or second instance. A restart is recoverable, but there is downtime during it.
3. **Blocking work in request paths.** Pillow and some Excel/storage work are synchronous. One worker can be held by a large operation. Multiple workers improve concurrency but multiply memory.
4. **In-memory rate limiting.** `rate_limiter.py` explicitly uses an in-memory store because Redis is not a current dependency. It resets on restart and is not shared across workers/instances. This is acceptable for one low-volume instance but weakens distributed protection.
5. **No built-in background job queue.** The only durable periodic work found is the external cleanup timer. Upload work is coordinated by the extension; there is no general Redis/Celery worker to absorb expensive server tasks.
6. **Logging/rotation is external.** The service uses journald through systemd examples, but no repository-level retention/rotation policy was verified. Configure journald limits and alerting on the VPS.
7. **Backups are external.** Supabase and R2 are external services, but no complete, repository-enforced backup/restore job was verified. Confirm Supabase PITR/backups, R2 versioning/retention, and an independent export policy.
8. **Cleanup depends on deployment.** The 20-day behavior is implemented in the script and unit examples, but only an operator check of `systemctl status podpilot-cleanup.timer` can prove it is active.
9. **Billing has legacy compatibility variables.** The code preserves historical/trial price mappings for interpretation. Live checkout configuration must be checked in Paddle; this audit did not verify live prices.
10. **Admin surface is high impact.** Admin APIs use privileged service-role access and require strict owner authorization, CORS, MFA/reauthentication, and audit monitoring in production. No conclusion about live admin deployment is made here.

## 6. Recommended production layout

For the current architecture, use:

```text
Cloudflare DNS/CDN
        │
        ├── podpilot.space → static frontend hosting
        └── api.podpilot.space → Caddy → 127.0.0.1:8000
                                      │
                                      └── one FastAPI/Uvicorn service
                                          + systemd restart policy
                                          + cleanup timer

FastAPI → Supabase Auth/Postgres
        → Cloudflare R2 (private objects)
        → Paddle / Gemini / OpenRouter (outbound HTTPS)
Chrome extension ↔ FastAPI for queue/status; extension performs marketplace browser actions
```

On a free Oracle VM, start with one Uvicorn worker, Caddy, 2–4 GB swap, journald limits, and strict upload concurrency. Move CPU-heavy image generation to a bounded thread/process executor or a separate worker before increasing Uvicorn workers. If traffic grows, add Redis-backed rate limiting and a queue, then scale horizontally behind a load balancer.

## 7. Cost comparison

Exact prices change by region, VAT, IPv4 policy and billing date. The values below are the lowest practical configurations found in current provider material and should be rechecked at purchase time.

| Provider | Minimum sensible shape for PodPilot | Indicative price | Notes |
|---|---|---:|---|
| Oracle Always Free | A1 ARM64, 2 OCPU / 12 GB total free allowance | $0 compute | Best cost; quota/capacity/account eligibility risk; current Oracle docs no longer support assuming 4/24 GB for every Always Free tenancy |
| Hetzner Cloud | CX23, 2 vCPU / 4 GB | about €5.49/month in Germany/Finland after 2026 adjustment | Official Hetzner adjustment table lists CX23 at €5.49; [Hetzner pricing adjustment](https://docs.hetzner.com/general/infrastructure-and-availability/price-adjustment/) |
| OVHcloud VPS | VPS-1 / entry VPS, at least 2 GB; prefer 4 GB tier | roughly $4.54–$6.49/month depending region/promotion | OVH’s public page exposes the VPS family but exact configuration/region price must be selected; [OVH VPS](https://us.ovhcloud.com/vps/) |
| Netcup | VPS 500 class, 2 vCPU / 4 GB | roughly €5–€7/month depending current generation/term | Current plan and VAT vary; verify on [Netcup VPS](https://www.netcup.com/en/server/vps?rdt_cid=5097047960940883806) |

The cheapest reliable answer is Oracle Always Free if provisioning succeeds and the operator accepts single-VM availability risk. The cheapest predictable paid alternative is generally a 2-vCPU/4-GB Hetzner or comparable Netcup/OVH plan. A paid VPS provides clearer capacity and support expectations, but it does not by itself add high availability or backups.

## 8. Load-testing plan (safe and local)

The existing tests are unit/integration-style Python tests, but the current virtualenv lacks `pytest`, so they were not executed. A safe follow-up benchmark should:

1. Install test tooling in an isolated development environment, never production.
2. Mock Supabase, R2, Paddle, Gemini, OpenRouter and trademark HTTP calls.
3. Generate synthetic JPEG/PNG files at 1 MB, 10 MB and 25 MB and synthetic Excel files.
4. Measure `/healthz`, authenticated metadata reads, thumbnail generation, Excel preview, and AI request setup separately.
5. Run controlled concurrency at 1, 2, 5, 10 and 20 clients; record p50/p95/p99 latency, RSS, CPU, error rate and file descriptors.
6. Repeat with one and two Uvicorn workers to establish whether extra workers improve throughput without exhausting RAM.

Do not benchmark against live Supabase, R2, Paddle or AI credentials. The repository’s current code makes a mock-based test essential because external latency otherwise dominates the result.

## 9. Action list before a real deployment

- Confirm Oracle tenancy quota and region capacity; set a budget alert even for a free-eligible account.
- Provision Ubuntu 24.04 ARM64 and verify the exact shape is marked free/within quota.
- Install the systemd service and cleanup timer, then verify both with `systemctl`.
- Configure Caddy, DNS, TLS, firewall, journald retention and monitoring.
- Keep `/etc/podpilot/backend.env` mode 600; never commit or print it.
- Install `pytest` in the test environment and run the full backend suite.
- Execute mocked image/Excel/concurrency benchmarks and set request/upload concurrency limits from evidence.
- Verify Supabase backup/PITR, R2 recovery/versioning, Paddle webhook delivery, and health alerts.
- Replace in-memory rate limiting with Redis before multi-worker or multi-instance deployment.
- Recheck all production Paddle prices and trial settings with the existing verification scripts.

## Final answer to the key question

**Can PodPilot run its current backend reliably on Oracle Cloud Always Free without paying anything?**

**Yes, conditionally.** The implementation is compatible with ARM64 and the documented 2 OCPU/12 GB Always Free allocation is enough for a small, single-instance PodPilot deployment. It should be classified **YELLOW**, because reliability depends on Oracle capacity/quota, the cleanup timer and backups being installed correctly, conservative concurrency for image/Excel work, and acceptance of single-VM downtime. It is not evidence of unlimited capacity or production readiness at high traffic. For a predictable paid baseline, use at least 2 vCPU and 4 GB RAM; 2 vCPU/8 GB is the stronger small-production choice.
