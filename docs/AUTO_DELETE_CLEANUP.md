# PodPilot Auto-Delete Cleanup

PodPilot design uploads are temporary. Files are eligible for deletion exactly 12 hours after import/upload creation time. Cleanup must run on the backend or server infrastructure, not in the frontend or Chrome extension.

Example: if a user imports a design at 10:00, the design's `cleanup_at` deadline is 22:00. Actual deletion may happen shortly after 22:00 depending on the cleanup timer. Editing metadata, saving listings, changing colors/products, opening the editor, or updating upload status does not extend retention.

## What Exists Now

- Uploaded design metadata is stored in Supabase table `public.designs`.
- Stored file references are R2 object keys on `public.designs`:
  - `image_r2_key`
  - `thumbnail_r2_key`
  - `excel_r2_key`
  - `ai_preview_r2_key` when the AI preview migration exists
- Uploaded file bytes are stored in Cloudflare R2 under keys shaped like:
  - `users/{user_id}/{marketplace}/{design_id}/{filename}`
  - `users/{user_id}/{marketplace}/{design_id}/thumbnails/{filename}.webp`
  - `users/{user_id}/imports/{import_id}/{filename}`
- The backend writes `cleanup_at = created_at + 12 hours` once for new design rows when `designs.cleanup_at` exists.
- Older rows without `cleanup_at` fall back to `created_at <= now() - 12 hours`.
- `updated_at` is not used for retention.
- Existing admin endpoints are protected by `ADMIN_CLEANUP_SECRET`:
  - `POST /api/admin/cleanup-old-designs`
  - `POST /api/admin/cleanup-orphan-r2-objects`
- Existing deletion uses the R2 S3-compatible `delete_object` call through `backend/app/services/r2_service.py`.
- Existing manual user delete removes R2 image, thumbnail, Excel file, related `upload_logs`, and the design row.

## What Was Missing Or Risky

- Before this change, existing cleanup docs and the GitHub Actions workflow defaulted to `cutoff_hours=24`, which conflicted with the 12-hour product goal for legacy rows. They now use 12-hour examples/defaults.
- The admin endpoint is request-triggered. It is useful, but it is not a VPS-native scheduled cleanup by itself.
- FastAPI `BackgroundTasks` are not used for periodic cleanup and would not be reliable for this job anyway.
- No APScheduler, FastAPI startup loop, systemd timer, cron entry, Cloudflare Worker, or R2 lifecycle rule is configured in the deployment files.
- Existing design cleanup now deletes `image_r2_key`, `thumbnail_r2_key`, `excel_r2_key`, and `ai_preview_r2_key` when present.
- Supabase Storage is not used by the current backend storage path. If Supabase Storage is added later, deletion must use the Supabase Storage API, not SQL-only row deletion.
- Queue/job data is not fully deleted by the current cleanup. `upload_logs` are deleted by design ID; `upload_jobs` are job summaries and are not per-design cleanup records.

## Risk

Without a real production scheduler, expired files can remain in R2 and expired rows can remain in Supabase until a human or external workflow calls the admin endpoint. This increases storage cost, retention risk, and confusion in upload queues.

## Recommended Production Approach

Use Option A: backend cleanup script plus a systemd timer on the Hetzner VPS.

This keeps cleanup close to the backend runtime, uses the same `/etc/podpilot/backend.env` secrets already used by the backend service, avoids public scheduled endpoints, and can be inspected with `journalctl`.

The timer example runs every 30 minutes. Timer frequency does not change the retention rule: rows are eligible only when `cleanup_at <= now()`, so a 10:00 import becomes eligible at 22:00 and is deleted on the first cleanup run after that time.

R2 lifecycle rules can be added later as a second safety net, but lifecycle rules alone cannot delete Supabase database rows.

## Cleanup Script

Script:

```bash
backend/scripts/cleanup_expired_designs.py
```

Default mode is dry-run. It does not delete database rows or R2 objects unless `--execute` is passed.

Dry-run locally or on the server:

```bash
cd /opt/podpilot/current
backend/.venv/bin/python backend/scripts/cleanup_expired_designs.py --dry-run
```

Dry-run with JSON:

```bash
cd /opt/podpilot/current
backend/.venv/bin/python backend/scripts/cleanup_expired_designs.py --dry-run --json
```

Execute cleanup:

```bash
cd /opt/podpilot/current
backend/.venv/bin/python backend/scripts/cleanup_expired_designs.py --execute --retention-hours 12 --batch-size 200
```

The script reports:

- scanned count
- expired count
- DB rows deleted
- R2 objects deleted
- missing R2 objects
- storage failures
- DB failures
- safe per-design timing: masked design ID, `created_at`, `cleanup_at`, `age_hours`, `expired`, and R2 key count

It masks user IDs and R2 keys in output and never prints Supabase keys, R2 secrets, Paddle secrets, or tokens.

## Systemd Timer Setup

Copy the examples:

```bash
sudo cp /opt/podpilot/current/deploy/podpilot-cleanup.service.example /etc/systemd/system/podpilot-cleanup.service
sudo cp /opt/podpilot/current/deploy/podpilot-cleanup.timer.example /etc/systemd/system/podpilot-cleanup.timer
```

Reload systemd:

```bash
sudo systemctl daemon-reload
```

Test a dry-run first by temporarily editing `/etc/systemd/system/podpilot-cleanup.service` and replacing `--execute` with `--dry-run`, then run:

```bash
sudo systemctl start podpilot-cleanup.service
sudo journalctl -u podpilot-cleanup.service --no-pager -n 100
```

When dry-run looks correct, restore `--execute` and enable the timer:

```bash
sudo systemctl enable --now podpilot-cleanup.timer
systemctl list-timers podpilot-cleanup.timer
```

View cleanup logs:

```bash
sudo journalctl -u podpilot-cleanup.service --since "24 hours ago"
```

## Affected Tables And Buckets

Tables:

- `public.designs`: expired rows are deleted.
- `public.upload_logs`: rows matching deleted `design_id` are deleted.
- `public.cleanup_runs`: existing admin endpoint writes optional summaries when the table exists; the script prints logs instead.

Required cleanup deadline column:

```sql
ALTER TABLE public.designs
ADD COLUMN IF NOT EXISTS cleanup_at timestamptz;

UPDATE public.designs
SET cleanup_at = created_at + interval '12 hours'
WHERE cleanup_at IS NULL
  AND created_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS designs_cleanup_at_idx
ON public.designs (cleanup_at);
```

The same SQL is available in `docs/migration_design_cleanup_at_12h.sql`.

R2 bucket:

- Uses `R2_BUCKET_NAME` from `/etc/podpilot/backend.env`.
- Deletes only object keys referenced by expired `public.designs` rows.
- Expected prefixes are under `users/`.

Supabase Storage:

- No current backend code path stores design files in Supabase Storage.
- No Supabase Storage buckets are affected by this cleanup.

## Verification Checklist

1. Run dry-run and confirm expired candidates look expected.
2. Confirm output does not print secrets.
3. Run execute manually once.
4. Confirm rows are removed from `public.designs`.
5. Confirm related `upload_logs` are removed.
6. Confirm referenced R2 objects are gone.
7. Enable the timer.
8. Check `journalctl` after the next timer run.

Confirm that editing a design does not change `cleanup_at`.
