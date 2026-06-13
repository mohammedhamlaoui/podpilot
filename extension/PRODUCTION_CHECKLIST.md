# PodPilot Chrome Extension Production Checklist

## Production API

- Production backend API base: `https://api.podpilot.space`
- The packaged production extension must not use localhost API URLs.
- Backend API calls should include the user `Authorization: Bearer <token>` only for authenticated PodPilot endpoints.
- Never place Supabase service-role keys, Paddle keys, webhook secrets, R2 secrets, or backend secrets in the extension.

## Permissions

Current required permissions:

- `storage`: stores the user session, platform access cache, design cache, upload settings, and queue state.
- `tabs`, `scripting`, `activeTab`: opens and controls Redbubble/TeePublic upload tabs.
- `notifications`: shows upload completion or blocked-upload notices.
- `offscreen`: plays the upload-complete sound from the extension package.
- `contextMenus`: provides PodPilot marketplace search shortcuts.

Current host permissions:

- `https://api.podpilot.space/*` for PodPilot backend calls.
- `https://okmcvbopiwjuusdiqnas.supabase.co/*` for Supabase public auth calls.
- `https://www.redbubble.com/*` and `https://*.redbubble.net/*` for Redbubble upload automation and image assets.
- `https://www.teepublic.com/*` for TeePublic upload automation.
- `https://*.r2.cloudflarestorage.com/*` for private/signed design image assets.

Do not add `<all_urls>`.

## Install Unpacked For Testing

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select the repository `extension/` folder.
5. Copy the extension ID shown by Chrome.

## Backend CORS

After installing the unpacked or production extension, add its origin to the server environment:

```text
chrome-extension://<EXTENSION_ID>
```

Add it to the backend CORS/allowed origins configuration in `/etc/podpilot/backend.env`, then restart the backend service. Do not use `*` for authenticated extension requests.

## Test Steps

1. Open the extension popup and sign in.
2. Confirm the account menu shows the signed-in email only.
3. Confirm cached designs render immediately after reopening the popup.
4. Click refresh and confirm backend errors include a request ID when available.
5. Test a user without the Redbubble plan: Redbubble should show as locked, not broken.
6. Test a user without the TeePublic plan: TeePublic should show as locked, not broken.
7. Start a Redbubble upload with complete image/listing data.
8. Start a TeePublic upload with complete image/listing data.
9. Confirm missing image/listing data produces a clear per-item error and does not start automation.
10. Confirm backend logs show no `/api/device/*` calls from the extension.
