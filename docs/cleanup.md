# Administrative Storage Cleanup Endpoints

PodPilot features two protected admin endpoints to safely purge old temporary workspaces, database rows, and orphaned objects from Cloudflare R2 storage.

---

## 1. Design Workspaces Cleanup Endpoint

- **Endpoint**: `POST /api/admin/cleanup-old-designs`
- **Purpose**: Periodically clean up old temporary uploaded designs and workspaces.
- **Scope**: Deletes expired records from `public.designs` (and related `upload_logs` & Cloudflare R2 objects like the original high-resolution design image, thumbnail image, parsed Excel file, and AI preview image when present). It **never** touches user credentials, user profiles, AI token balances, ai_usage analytics, or subscriptions.
- **Retention rule**: Files are eligible for deletion 24 hours after import/upload creation time. Editing a design does not extend retention. Actual deletion may happen shortly after the 24-hour deadline depending on the cleanup timer.

### Security
This endpoint is protected against unauthorized access:
1. **Secret configuration**: The server must define the `ADMIN_CLEANUP_SECRET` environment variable. If missing, it returns `500 Internal Server Error`.
2. **Access validation**: Every request must provide the `X-Cleanup-Secret` header matching the server's secret:
   ```http
   X-Cleanup-Secret: <ADMIN_CLEANUP_SECRET>
   ```
   If wrong or missing, returns `403 Forbidden`.
3. **Live cleanup confirmation**: Live deletion requests must set `dry_run=false&confirm=true`. Dry runs do not require `confirm=true`.

Use your own long random secret for `ADMIN_CLEANUP_SECRET`. Do not use example strings or commit real secrets to documentation, scripts, or source control.

### Query Parameters

| Parameter | Type | Default | Description |
|---|---|---|---|
| `dry_run` | `boolean` | `true` | When `true`, reports eligible files without actual deletion. Set to `false` for live deletion. |
| `cutoff_hours` | `integer` | `24` | Legacy cutoff in hours for designs without `cleanup_at`. Newer rows use `cleanup_at <= now()`. Allow `0` for testing. |
| `confirm` | `boolean` | `false` | Required as `true` only when `dry_run=false`; otherwise live cleanup returns `400 Bad Request`. |

### Behavior and Responses

#### Dry Run Mode (`dry_run=true`)
**Example Request**:
```bash
curl -X POST "http://localhost:8000/api/admin/cleanup-old-designs?dry_run=true&cutoff_hours=24" \
  -H "X-Cleanup-Secret: <ADMIN_CLEANUP_SECRET>"
```
**Example Response**:
```json
{
  "dry_run": true,
  "cutoff_hours": 24,
  "eligible_count": 1,
  "designs": [
    {
      "id": "7ac984e1-2a62-4217-bfd1-21c607ecab29",
      "title": "Retro Sun",
      "user_id": "c1f728fb-4720-410a-81a9-9fb2526fa17c",
      "image_r2_key": "users/c1f728fb-4720-410a-81a9-9fb2526fa17c/redbubble/7ac984e1-2a62-4217-bfd1-21c607ecab29/retro_sun.png",
      "thumbnail_r2_key": "users/c1f728fb-4720-410a-81a9-9fb2526fa17c/redbubble/7ac984e1-2a62-4217-bfd1-21c607ecab29/thumbnails/retro_sun.webp",
      "excel_r2_key": "users/c1f728fb-4720-410a-81a9-9fb2526fa17c/imports/a98dcba27/sheet.xlsx",
      "ai_preview_r2_key": "users/c1f728fb-4720-410a-81a9-9fb2526fa17c/redbubble/7ac984e1-2a62-4217-bfd1-21c607ecab29/ai-preview.webp"
    }
  ]
}
```

#### Live Deletion Mode (`dry_run=false`)
Deletes R2 images, thumbnails, excel sheets, AI preview images, related `upload_logs`, and finally the design row from `public.designs`. Live deletion requires `confirm=true`. If an R2 delete fails for a design, the database row is kept and the failure is logged so the next cleanup run can retry safely. Missing R2 objects are treated as already gone.

**Example Request**:
```bash
curl -X POST "http://localhost:8000/api/admin/cleanup-old-designs?dry_run=false&confirm=true&cutoff_hours=24" \
  -H "X-Cleanup-Secret: <ADMIN_CLEANUP_SECRET>"
```

**Example Response**:
```json
{
  "dry_run": false,
  "cutoff_hours": 24,
  "eligible_count": 1,
  "deleted_count": 1,
  "failed_count": 0,
  "deleted_design_ids": ["7ac984e1-2a62-4217-bfd1-21c607ecab29"],
  "deleted_r2_keys": ["users/.../retro_sun.png", "users/.../thumbnails/retro_sun.webp"],
  "warnings": []
}
```

---

## 2. Orphan R2 Storage Objects Cleanup Endpoint

- **Endpoint**: `POST /api/admin/cleanup-orphan-r2-objects`
- **Purpose**: Cleans up files and folder leftovers in Cloudflare R2 that are no longer referenced in `public.designs`.
- **Scope**: Scans and deletes orphan keys under the `users/` prefix that do not match any row's `image_r2_key`, `thumbnail_r2_key`, `excel_r2_key`, or `ai_preview_r2_key`. It never touches anything outside `users/`.
- **Grace-period requirement**: The current endpoint does not filter candidates by object age. Treat 48 hours as the minimum operational grace period before live deletion. Run a dry-run first and independently verify that every candidate is at least 48 hours old. The GitHub workflow intentionally exposes only the dry-run orphan scan.

### Security
Matches the same configuration, header, and live cleanup confirmation requirements (`X-Cleanup-Secret` plus `confirm=true` when `dry_run=false`).

### Query Parameters

| Parameter | Type | Default | Description |
|---|---|---|---|
| `dry_run` | `boolean` | `true` | Scans and lists orphan files without deleting them when `true`. |
| `confirm` | `boolean` | `false` | Required as `true` only when `dry_run=false`; otherwise live cleanup returns `400 Bad Request`. |

### Behavior and Responses

#### Dry Run Mode (`dry_run=true`)
**Example Request**:
```bash
curl -X POST "http://localhost:8000/api/admin/cleanup-orphan-r2-objects?dry_run=true" \
  -H "X-Cleanup-Secret: <ADMIN_CLEANUP_SECRET>"
```
**Example Response**:
```json
{
  "dry_run": true,
  "scanned_count": 12,
  "referenced_count": 0,
  "orphan_count": 12,
  "orphan_keys": [
    "users/6ff5c5ae-8ad3-47e0-a91e-57dc63f13096/redbubble/59f4165fbe154c1889155755630df2c4/Mediterranean_Black -27.png",
    "users/ab4d785a-d34a-4662-860d-159d5e7f33a5/teepublic/b823140f04ac459da03abd393f859466/Tea6.png"
  ]
}
```

#### Live Deletion Mode (`dry_run=false`)
Deletes all orphaned R2 files under `users/` prefix. Live deletion requires `confirm=true`.

**Example Request**:
```bash
curl -X POST "http://localhost:8000/api/admin/cleanup-orphan-r2-objects?dry_run=false&confirm=true" \
  -H "X-Cleanup-Secret: <ADMIN_CLEANUP_SECRET>"
```

**Example Response**:
```json
{
  "dry_run": false,
  "scanned_count": 12,
  "referenced_count": 0,
  "orphan_count": 12,
  "deleted_count": 12,
  "deleted_r2_keys": [
    "users/6ff5c5ae-8ad3-47e0-a91e-57dc63f13096/redbubble/59f4165fbe154c1889155755630df2c4/Mediterranean_Black -27.png",
    "users/ab4d785a-d34a-4662-860d-159d5e7f33a5/teepublic/b823140f04ac459da03abd393f859466/Tea6.png"
  ],
  "warnings": []
}
```

---

## 3. Production Scheduling

Production cleanup is handled by the VPS systemd units `podpilot-cleanup.timer` and `podpilot-cleanup.service`. The timer runs every 30 minutes and the cleanup retention window is 24 hours. Deadlines are based on the original `created_at`; edits and saves do not extend retention.

The GitHub Actions workflow `.github/workflows/cleanup.yml` is manual-only. Its scheduled cron was removed to avoid duplicate production cleanup and repeated failures when GitHub maintenance secrets are intentionally absent.

Manual workflow defaults are deliberately conservative:

- `dry_run=true`
- `confirm=false`
- `cutoff_hours=24`
- orphan R2 scan disabled

`PODPILOT_API_URL` and `ADMIN_CLEANUP_SECRET` are needed only when an operator manually starts the workflow. The optional orphan operation is scan-only and always calls the endpoint with `dry_run=true`; it does not delete R2 objects.

Monitor the production timer and recent cleanup runs with:

```bash
systemctl status podpilot-cleanup.timer
journalctl -u podpilot-cleanup.service --since "24 hours ago"
```
