# Administrative Storage Cleanup Endpoints

PodPilot features two protected admin endpoints to safely purge old temporary workspaces, database rows, and orphaned objects from Cloudflare R2 storage.

---

## 1. Design Workspaces Cleanup Endpoint

- **Endpoint**: `POST /api/admin/cleanup-old-designs`
- **Purpose**: Periodically clean up old temporary uploaded designs and workspaces.
- **Scope**: Deletes older records from `public.designs` (and related `upload_logs` & Cloudflare R2 objects like the original high-resolution design image, thumbnail image, and parsed Excel file). It **never** touches user credentials, user profiles, AI token balances, ai_usage analytics, or subscriptions.

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
| `cutoff_hours` | `integer` | `24` | Cutoff in hours. Designs created before `now() - cutoff_hours` are selected. Allow `0` for testing. |
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
      "excel_r2_key": "users/c1f728fb-4720-410a-81a9-9fb2526fa17c/imports/a98dcba27/sheet.xlsx"
    }
  ]
}
```

#### Live Deletion Mode (`dry_run=false`)
Deletes R2 images, thumbnails, excel sheets, related `upload_logs`, and finally the design row from `public.designs`. Live deletion requires `confirm=true`.

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
- **Scope**: Scans and deletes orphan keys under the `users/` prefix that do not match any row's `image_r2_key`, `thumbnail_r2_key`, or `excel_r2_key`. It **never** touches anything outside `users/` and acts with absolute safety.

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

## 3. Nightly Scheduled Automation

To automate maintenance without manual triggers, configure one of the scheduling systems below.

### Option A: GitHub Actions (Recommended for Cloud Deployments)

A workflow file is pre-configured at `.github/workflows/cleanup.yml`. It runs every night at midnight UTC.

#### Setup Instructions:
1. Navigate to your GitHub repository -> **Settings** -> **Secrets and variables** -> **Actions**.
2. Add the following **Repository Secrets**:
   - `PODPILOT_API_URL`: Your hosted production backend base URL (e.g. `https://api.podpilot.com`). Do not append a trailing slash.
   - `ADMIN_CLEANUP_SECRET`: Your own long random secret matching the `ADMIN_CLEANUP_SECRET` configured in your backend `.env` file.
3. Enable Actions under the **Actions** tab of your repository if they are not already enabled.

*Note: You can also manually trigger this action at any time from your GitHub repository under the **Actions** tab (select **Nightly Storage Cleanup** -> **Run workflow**), which allows custom parameters for testing.*

---

### Option B: Local Linux / macOS Cron Task

For local servers or self-hosted deployments inside private networks:

1. Open your system's crontab editor:
   ```bash
   crontab -e
   ```
2. Append the following entry to trigger the cleanup every night at midnight local time:
   ```text
   0 0 * * * curl -s -X POST "http://localhost:8000/api/admin/cleanup-old-designs?dry_run=false&confirm=true&cutoff_hours=24" -H "X-Cleanup-Secret: <ADMIN_CLEANUP_SECRET>" && curl -s -X POST "http://localhost:8000/api/admin/cleanup-orphan-r2-objects?dry_run=false&confirm=true" -H "X-Cleanup-Secret: <ADMIN_CLEANUP_SECRET>" >> /var/log/podpilot-cleanup.log 2>&1
   ```

---

### Option C: Local Windows Task Scheduler (PowerShell)

For Windows local development environments:

1. Create a script file called `cleanup.ps1`:
   ```powershell
   $headers = @{
       "X-Cleanup-Secret" = "<ADMIN_CLEANUP_SECRET>"
   }
   # 1. Clean old design workspaces
   Invoke-RestMethod -Uri "http://localhost:8000/api/admin/cleanup-old-designs?dry_run=false&confirm=true&cutoff_hours=24" -Method Post -Headers $headers
   # 2. Clean orphaned R2 assets
   Invoke-RestMethod -Uri "http://localhost:8000/api/admin/cleanup-orphan-r2-objects?dry_run=false&confirm=true" -Method Post -Headers $headers
   ```
2. Register a task using Windows Task Scheduler to run daily, pointing to:
   ```text
   powershell.exe -ExecutionPolicy Bypass -File "C:\path\to\cleanup.ps1"
   ```
