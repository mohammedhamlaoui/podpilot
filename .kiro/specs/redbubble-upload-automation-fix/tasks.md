# Implementation Plan

## Overview

This plan ships the Redbubble single-design upload fix in small, independently verifiable steps in the exact order requested by the user. Every step references the precise files and functions from `design.md`, the numbered requirements from `bugfix.md` (1.x defects, 2.x expected, 3.x preservation), and a concrete verification you can run before moving on. No source code is modified by this document.

Scope guardrails (apply to every task below):
- Redbubble single-design path only. TeePublic, login/profile/reset-password, sticker-color UI, AI/trademark UI, Excel columns, image upload/serving, and `/jobs`/`/jobs/create` request and response shapes are not touched.
- No new Selenium path; `backend/app/services/redbubble_service.py` stays uninvoked.
- No database schema or migration changes; the new endpoint accepts and echoes `redbubble_work_id`/`stage`/`error_message` without adding columns.
- Manifest `content_scripts.matches` and `host_permissions` stay byte-identical.

## Task Dependency Graph

The user's explicit instruction is: ship in this exact order, small safe steps, not one huge rewrite. Each task is therefore its own wave so the next task only starts after the previous one has been verified.

```json
{
  "waves": [
    { "wave": 1, "tasks": ["1"] },
    { "wave": 2, "tasks": ["2"] },
    { "wave": 3, "tasks": ["3"] },
    { "wave": 4, "tasks": ["4"] },
    { "wave": 5, "tasks": ["5"] },
    { "wave": 6, "tasks": ["6"] },
    { "wave": 7, "tasks": ["7"] },
    { "wave": 8, "tasks": ["8"] },
    { "wave": 9, "tasks": ["9"] },
    { "wave": 10, "tasks": ["10"] }
  ]
}
```

ASCII view of the dependencies (informational):

```
1 (POST /designs/{id}/status)
        \
         \------------------------------\
2 (getDuplicateUrl + ?auto=1) -----\     \
                                    \     \
3 (single content.js injection) ---- 4 (FSM + progressLog)
                                            \
                                             5 (image upload stage)
                                              \
                                               6 (metadata + clear_tags)
                                                \
                                                 7 (agreement + save_click)
                                                  \
                                                   8 (strict /studio/promote/{id})
                                                    \
                                                     9 (postDesignStatus + popup log)
                                                      \
                                                       10 (manual one-design gate
                                                            + regression smoke)
```

Read order rules:
- Task 1 is independent of the extension changes and unblocks task 9.
- Tasks 2 and 3 are logically independent of each other but both unblock task 4.
- Tasks 5 → 8 are stage-by-stage refinements of the FSM introduced in task 4 and must land in upload-flow order so each stage's verification has a predecessor stage that already works.
- Task 9 closes the loop (extension → backend) and lights up the popup stage log.
- Task 10 is the manual acceptance gate and the preservation regression smoke; do not skip it and do not run it before task 9 lands.

## Tasks

- [x] 1. Add backend `POST /designs/{design_id}/status` endpoint
  - Add `DesignStatusUpdateIn` to `backend/app/schemas/job.py` with the exact fields from `design.md` §"1. Backend: backend/app/schemas/job.py" (`status: Literal["done","error","in_progress"]`, optional `stage` literal of the eight stage names, optional `error_message` ≤ 2000 chars, optional `redbubble_work_id` ≤ 64 chars, optional `updated_at`). Do not touch `DesignIn` or `JobCreateIn`.
  - Add the route `POST /designs/{design_id}/status` in `backend/app/api/routes.py` per `design.md` §"2. Backend: backend/app/api/routes.py": load `Design` by id (404 if missing), set `design.status = payload.status`, commit, return `_design_to_dict(design)` plus echoed `stage`, `error_message`, `redbubble_work_id`, and `updated_at` (default `datetime.now(timezone.utc).isoformat()`).
  - Same auth posture as `/jobs/create` (no new auth requirement, no new dependency). Do not add columns; `redbubble_work_id`/`stage`/`error_message` are accepted and echoed only.
  - Verification (run before moving to task 2):
    - Start the backend; `POST http://localhost:8000/designs/<existing_id>/status` with body `{"status":"done","redbubble_work_id":"12345"}` returns 200, the response includes `status:"done"` and echoes `redbubble_work_id:"12345"`, and `SELECT status FROM designs WHERE id=<existing_id>` returns `done`.
    - `POST` with an unknown id returns 404. `POST` with `status:"weird"` returns 422. `POST` with a 3000-char `error_message` returns 422.
    - `GET /jobs` and `POST /jobs/create` responses are byte-identical to a snapshot taken before this task.
  - _Bug_Condition: isBugCondition(input) — terminalStatusReachesBackend(input) is false today because no endpoint exists_
  - _Expected_Behavior: backend `Design.status` transitions to `done` or `error` for the corresponding `design_id` and is reflected on next dashboard poll_
  - _Preservation: 3.1 Excel parsing, 3.2 image serving, 3.3 `/jobs` and `/jobs/create` shapes, 3.9 dead Selenium service stays uninvoked_
  - _Requirements: 1.9, 2.9, 2.10, 3.3_

- [x] 2. Fix duplicate/copy_link URL canonicalization and add `?auto=1`
  - Replace `getDuplicateUrl(copyLink)` in `extension/background.js` per `design.md` §"4. Extension: extension/background.js" item 1.
  - Accept three input formats and canonicalize all of them to `https://www.redbubble.com/portfolio/images/{id}/duplicate?auto=1` (preserving any other query params already on the URL):
    - `https://www.redbubble.com/portfolio/images/{id}/duplicate` (already canonical, must be a no-op except for `?auto=1`),
    - `https://www.redbubble.com/portfolio/images/{id}` with optional slug suffix,
    - `https://www.redbubble.com/people/{user}/works/{id}-{slug}`.
  - Reject non-Redbubble hosts (`copy_link must be a Redbubble URL.`) and unrecognized paths (`Unrecognized Redbubble copy_link: …`).
  - Do not change `host_permissions` or `content_scripts.matches`.
  - Verification (run before moving to task 3):
    - In a temporary `chrome://extensions` service-worker console, call `getDuplicateUrl` on each of the three input formats and on `https://example.com/foo`; the three valid forms each return the canonical `/portfolio/images/{id}/duplicate?auto=1`, and the non-Redbubble URL throws.
    - Pass `https://www.redbubble.com/portfolio/images/12345/duplicate?_cb=abc` and confirm the result is `…/portfolio/images/12345/duplicate?_cb=abc&auto=1` (other query params preserved).
  - _Bug_Condition: isBugCondition(input) — `copyLinkPointsAtRedbubbleWork` and `terminalStatusReachesBackend` cannot succeed when the URL is rejected at navigation time_
  - _Expected_Behavior: extension navigates the new tab to the canonical duplicate URL with `?auto=1` for all three accepted formats_
  - _Preservation: 3.6 manifest match patterns, 3.8 already-canonical `/duplicate` copy_links keep working_
  - _Requirements: 1.3, 1.4, 2.3, 2.4, 3.8_

- [x] 3. Remove duplicate content-script injection and add one-shot `content.js` guard
  - In `extension/background.js`, delete the `chrome.scripting.executeScript({ files: ['content.js'] })` call from `injectContentScript` per `design.md` §"4." item 2. Replace its call site with a `waitForContentScriptReady(tabId)` helper (item 3) that polls the tab with `{ action: "ping" }` until the content script answers, with a 30 s timeout that emits a `stage:"navigate"` error.
  - In `extension/content.js`, add the window-level guard at the top of the IIFE per `design.md` §"5." item 1: rename `window.__rbUploaderInjected` to `window.__rbAutomationBooted`, log and exit if already true, otherwise set it and register the `chrome.runtime.onMessage` listener exactly once.
  - Manifest stays unchanged; rely solely on the manifest `content_scripts` registration.
  - Verification (run before moving to task 4):
    - Reload the extension, navigate to a duplicate URL with `?auto=1`. In DevTools → Console, confirm `window.__rbAutomationBooted === true` and that the boot log line appears exactly once.
    - Manually re-trigger an injection (or reload the page) and confirm the second boot is short-circuited with the "already booted" log line.
    - From the extension's service worker, send `{ action: "ping" }` to the duplicate tab and confirm exactly one response arrives.
  - _Bug_Condition: isBugCondition(input) — the listener race makes `prepare_duplicate_form`/`fill_duplicate_form` non-deterministic_
  - _Expected_Behavior: exactly one `content.js` instance is active per tab regardless of injection path_
  - _Preservation: 3.6 manifest match patterns, 3.7 no auto interaction outside an active upload_
  - _Requirements: 1.2, 2.2, 3.6_

- [x] 4. Add `content.js` FSM and per-design `progressLog` wiring (no behavioral fixes yet)
  - In `extension/content.js`, add the `?auto=1` gate at boot per `design.md` §"5." item 2: parse `URLSearchParams`, set `isAutomationMode`, and call `showUploadOverlay("Preparing Redbubble upload...", 0)` immediately when in automation mode. Manual page visits without `?auto=1` must not trigger any form filling.
  - Replace the inline orchestration in the `fill_duplicate_form` handler with the explicit FSM from §"5." item 3: `queued → navigate → inject_image → wait_image_ready → fill_metadata → clear_tags → agreement → save_click → wait_success → done | error`. On every transition, emit `chrome.runtime.sendMessage({ action: "stage_update", design_id, stage, status: "in_progress" })`; on stage success, the same with `status:"done"`; on stage failure, `{ action:"upload_result", design_id, status:"error", stage, error_message }`. Do not yet change the per-stage logic — only wire the emit points around the existing functions.
  - In `extension/background.js`, extend `handleUploadResult` per §"4." item 4 to accept `stage`, `error_message`, `redbubble_work_id`. Add the per-design `progressLog` map (§"4." item 6) keyed by `design_id`, persisted under the `progressLog` key in `chrome.storage.session` (feature-detect and fall back to `chrome.storage.local`), and broadcast `{ action: "progress_log_updated", design_id, log }` on every update. Do not call `postDesignStatus` yet — that is task 9.
  - Verification (run before moving to task 5):
    - Open a duplicate URL with `?auto=1` from the extension; the overlay renders within 500 ms of `document_start`.
    - Open the same URL manually in the address bar (no `?auto=1`); no overlay renders, no form filling occurs.
    - In the service worker, listen for `stage_update` messages and confirm at least one is emitted as the existing flow walks through the page.
    - Inspect `chrome.storage.session.get('progressLog')` and confirm an entry array is appended for the active `design_id`.
  - _Bug_Condition: isBugCondition(input) — popupAndDashboardReflectThatStatus(input) cannot show per-stage progression today_
  - _Expected_Behavior: the popup and dashboard SHALL show a per-design progress log; manual page visits SHALL NOT auto-trigger_
  - _Preservation: 3.4 popup control IDs, 3.5 TeePublic/login/profile/sticker UI, 3.7 no auto interaction outside an active upload, 3.10 sequential one-at-a-time retry-once queue policy_
  - _Requirements: 1.10, 1.11, 2.10, 2.11, 3.7_

- [x] 5. Fix image upload via fetch → Blob → File → DataTransfer
  - In `extension/content.js`, harden the `inject_image` and `wait_image_ready` stages per `design.md` §"5." item 4 sub-bullets. The image flow must: `fetch` the local image URL through the existing backend `/api/image` endpoint (no new endpoint), read it as `Blob`, wrap it in a `File` with the original filename and MIME, build a `DataTransfer`, assign `dataTransfer.files` to the duplicate page's file input (`SEL_FILE_INPUT`), and dispatch the `change` event. Emit `stage:"inject_image"` errors with `File input "${SEL_FILE_INPUT}" not found on page` or whatever `injectImageFile` throws.
  - For `wait_image_ready`: keep the existing 90 s `waitForImageUploadComplete` timeout and emit a named `wait_image_ready` stage error if it times out without an upload-complete signal.
  - Do not change `/upload/images` or `/api/image` server-side; do not add a new image endpoint.
  - Verification (run before moving to task 6):
    - Start an upload with `?auto=1`; the duplicate page's preview replaces the source preview within ~30 s.
    - Temporarily block the file input (e.g., delete it from the DOM via DevTools before the message arrives) and confirm the row reports `stage:"inject_image"` with the named error and the queue does not advance to `fill_metadata`.
    - Confirm `/api/image?path=<known image>` still returns the same bytes as before this task (snapshot diff).
  - _Bug_Condition: isBugCondition(input) — without a successful image stage no published work can exist_
  - _Expected_Behavior: image upload completes or surfaces a stage-named error before metadata fill_
  - _Preservation: 3.2 `/upload/images` storage layout and `/api/image` resolution order_
  - _Requirements: 2.1, 2.10, 2.11, 3.2_

- [x] 6. Fix metadata filling and old-tag clearing
  - In `extension/content.js`, harden the `fill_metadata` and `clear_tags` stages per `design.md` §"5." item 4 (`fill_metadata` failure criteria) and item 8 (final assertion in `clearTagEditorRobust`).
  - `fill_metadata`: locate `#work_title_en` and `#work_description_en` within `FORM_WAIT_MS` (15 s), call `forceSetValue` to update the React-controlled value, and emit a stage error if either field is not found or the value is not committed.
  - `clear_tags`: keep the existing 5 passes, then run a final assertion that counts chips inside the editor root (`findTagEditorRoot`) using `[class*="TagEditor_pill"], [class*="pill"], [class*="chip"]`. If non-zero, run one more pass; if still non-zero, throw `clear_tags: residual chips after 6 passes` so the FSM emits a named stage error. Apply the assertion to both the main-tag and supporting-tags editors.
  - Do not change Excel column handling or `excel_parser.parse_excel_designs`.
  - Verification (run before moving to task 7):
    - Pick a source design with 4+ tags. Start an upload with `?auto=1`; before tags are committed, both editors are observed empty (DevTools → 0 chip nodes), and after commit only the new `main_tag` and `supporting_tags` are present.
    - Force the assertion to fail by manually re-injecting a chip mid-clear via DevTools; confirm the row reports `stage:"clear_tags"` with the residual-chips message.
    - Confirm `/upload/excel` parsing remains identical (snapshot diff with the same `.xlsx`).
  - _Bug_Condition: isBugCondition(input) — Example 4 (carryover tags)_
  - _Expected_Behavior: every existing chip is removed before new tags are committed; both editors verified empty before injection_
  - _Preservation: 3.1 Excel parsing and `/upload/excel` columns_
  - _Requirements: 1.5, 2.5, 2.10, 3.1_

- [x] 7. Fix rights-and-terms checkbox and publish click
  - In `extension/content.js`, replace the `checkAgreementCheckbox` fallback `allCheckboxes[allCheckboxes.length - 1]` per `design.md` §"5." item 7. Locate the checkbox by stable signals only: input attributes (`name`/`id` containing `rights`, `terms`, or `agreement`) or surrounding label text matching the agreement copy. If the labelled lookup fails, throw `agreement: rights-and-terms checkbox not found` so the FSM emits a named stage error. Do not tick any other checkbox.
  - Harden `save_click` per §"5." item 4: after agreement, poll `getSaveButton` for up to `SAVE_POLL_MS` (30 s); if it stays null or disabled, emit a `save_click` stage error.
  - Verification (run before moving to task 8):
    - On the duplicate page, open DevTools and add a fake unrelated `<input type="checkbox">` near the agreement region. Run the upload; confirm only the rights-and-terms checkbox is ticked and the fake one is left alone.
    - Temporarily delete every input matching the rights/terms/agreement signals; confirm the row reports `stage:"agreement"` with the named error and the queue does not advance to `save_click`.
    - Disable the save button via DevTools after agreement; confirm the row reports `stage:"save_click"` with a clear reason.
  - _Bug_Condition: isBugCondition(input) — Example 5 (wrong checkbox)_
  - _Expected_Behavior: agreement located by stable signal; named stage error if absent; save click only when button is enabled_
  - _Preservation: 3.4 popup controls and 3.10 sequential queue policy unchanged_
  - _Requirements: 1.6, 2.6, 2.10_

- [x] 8. Add strict `/studio/promote/{id}` success detection
  - In `extension/content.js`, replace the body of `waitForSuccess` per `design.md` §"5." item 5. Use `const SUCCESS_RE = /^https:\/\/www\.redbubble\.com\/studio\/promote\/(\d+)/;` and only emit `{ action:"upload_result", status:"success", design_id, redbubble_work_id }` when `window.location.href.match(SUCCESS_RE)` succeeds (capture group 1 = `redbubble_work_id`).
  - During the polling window also detect a Redbubble error banner via `[role="alert"], .field_with_errors, .errors`; on a visible match, emit `{ status:"error", stage:"wait_success", error_message }` (truncate to 300 chars).
  - Drop the `beforeunload`-as-success path entirely per §"5." item 6: remove the `window.addEventListener('beforeunload', onUnload, …)` block. Tab close, back navigation, and bfcache restores must not produce a `success` message.
  - Verification (run before moving to task 9):
    - Drive a successful upload; the URL transitions to `https://www.redbubble.com/studio/promote/<id>` and a `success` message is sent with the matching `redbubble_work_id`.
    - During the agreement stage, manually close the duplicate tab; confirm no `success` message is sent and the popup row does not flip to `done`.
    - From DevTools, programmatically navigate the duplicate tab to `https://www.redbubble.com/people/<user>` (a non-`/studio/promote/` URL); confirm `waitForSuccess` does not emit `success`.
    - Trigger a Redbubble validation error (e.g., blank title temporarily); confirm a `stage:"wait_success"` error message is emitted instead of `success`.
  - _Bug_Condition: isBugCondition(input) — Example 1 (false success on unload), Edge case (bfcache restore)_
  - _Expected_Behavior: success only on `^https://www.redbubble.com/studio/promote/\d+`; `beforeunload` never reports success; queue advance is gated on a terminal value_
  - _Preservation: 3.10 sequential one-at-a-time retry-once queue policy_
  - _Requirements: 1.7, 1.8, 2.7, 2.8, 2.12_

- [x] 9. Wire terminal status to backend (`postDesignStatus`) and surface popup stage log
  - In `extension/background.js`, add `postDesignStatus(designId, payload)` per `design.md` §"4." item 5 with `API_BASE = "http://localhost:8000"`, retry policy (3 attempts, 2 s linear backoff, retry only on network error or `5xx`/`408`/`429`, never retry other 4xx), and a console warning on persistent failure. Persistent backend failure must not flip the extension queue state.
  - Hook the call into `handleUploadResult` only on terminal status:
    - `status:"success"` → `postDesignStatus(designId, { status:"done", redbubble_work_id, updated_at })`.
    - `status:"error"` → `postDesignStatus(designId, { status:"error", stage, error_message, updated_at })`.
    - Intermediate `stage_update` messages must NOT call the backend.
  - In `extension/popup.js`, subscribe to `progress_log_updated` and `stage_update` per `design.md` §"6." and render a stage list below the existing rows for the design currently at `state.currentIndex`. Existing controls (`searchInput`, `filterSelect`, `selectAllInput`, `uploadSelectedButton`, `refreshButton`, `startButton`, `pauseButton`, `stopButton`, `connectButton`) keep their IDs and event handlers untouched.
  - Frontend `QueueManager.jsx` is not structurally changed; it continues to poll `/jobs`.
  - Verification (run before moving to task 10):
    - Drive a successful upload; observe a single `POST /designs/<id>/status` call with `status:"done"` and the captured `redbubble_work_id`. `SELECT id, status FROM designs WHERE id = <id>` returns `done` after Chrome restart. Within one `/jobs` poll cycle (≤ 5 s) the dashboard row shows `done`.
    - Drive a failed upload (e.g., bad `copy_link`); observe `POST /designs/<id>/status` with `status:"error"`, the failing `stage`, and a non-empty `error_message`. Backend row shows `error`. Dashboard reflects it on next poll.
    - Stop the backend mid-flight; confirm `postDesignStatus` retries 3 times then logs a warning, the popup still shows the terminal status, and the extension queue does not regress.
    - Open the popup and confirm the per-design stage list renders the sequence `queued → navigate → … → done|error` for the active design, and that the existing chrome controls still respond.
  - _Bug_Condition: isBugCondition(input) — terminalStatusReachesBackend(input) AND popupAndDashboardReflectThatStatus(input) are both false today_
  - _Expected_Behavior: terminal status (success or error with stage) is persisted to the backend and rendered in the popup stage log; existing popup controls unchanged_
  - _Preservation: 3.3 `/jobs` and `/jobs/create` shapes, 3.4 popup control IDs and actions, 3.10 sequential queue policy_
  - _Requirements: 1.9, 1.10, 1.11, 1.12, 2.9, 2.10, 2.11, 2.12, 3.3, 3.4_

- [ ] 10. **Property 1: Bug Condition** / **Property 2: Preservation** — Manual one-design acceptance gate
  - This task is the user's primary acceptance gate and mirrors `design.md` §"Test Plan: One Design First". Do not declare the bugfix done until every check below passes. Run it exactly once, end-to-end, against a live Redbubble session in the active Chrome profile that has the unpacked extension loaded.

  - [ ] 10.1 **Property 1: Expected Behavior** — Happy-path single design end-to-end
    - **IMPORTANT**: Re-run the same upload flow from tasks 2–9 as one continuous run; do not fix anything mid-run.
    - Sign in to Redbubble in the active Chrome profile.
    - In the dashboard, pick one design row that has all of: `copy_link` in `/people/{user}/works/{id}-{slug}` form, a matched local image (preview renders), and non-empty `title`, `description`, `main_tag`, `supporting_tags`.
    - Click **Start Upload** for that single row.
    - **EXPECTED OUTCOME** (every bullet must hold):
      - A new tab opens at `https://www.redbubble.com/portfolio/images/{id}/duplicate?auto=1`.
      - The PodPilot overlay appears within 500 ms of `document_start`.
      - The image preview replaces the source image within ~30 s.
      - Title, description, main tag, and supporting tags fill in. No stale chips remain in either tag editor.
      - Only the rights-and-terms checkbox is ticked.
      - Save button enables and is clicked.
      - URL transitions to `https://www.redbubble.com/studio/promote/{id}`.
      - Popup shows the per-stage progression for this design and ends on `done`.
      - Within one `/jobs` poll cycle (≤ 5 s) QueueManager shows `done` for that row.
      - `SELECT id, status FROM designs WHERE id = <id>` returns `status = "done"`.
      - The `POST /designs/{id}/status` body included `status:"done"` and a `redbubble_work_id` matching the URL's `{id}`.
    - _Bug_Condition: isBugCondition(input) per design.md_
    - _Expected_Behavior: Property 1 from design.md (Correctness Properties)_
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 2.10, 2.11, 2.12_

  - [ ] 10.2 **Property 1: Expected Behavior** — Negative-path staged error
    - Pick a design row and manually edit its `copy_link` in the dashboard to an obviously bad value (e.g., `https://www.redbubble.com/people/whatever/oops`). Click **Start Upload**.
    - **EXPECTED OUTCOME**:
      - Popup shows a staged error such as `navigate: Unrecognized Redbubble copy_link: …` for that row.
      - `POST /designs/{id}/status` body includes `status:"error"`, `stage:"navigate"`, and a non-empty `error_message`.
      - `SELECT status FROM designs WHERE id = <id>` returns `error`.
      - Dashboard shows `error` after the next `/jobs` poll.
      - The queue does NOT advance on `beforeunload`; closing the tab manually mid-stage produces an `error` (not `done`).
    - _Requirements: 1.3, 1.7, 1.8, 1.10, 2.7, 2.8, 2.10, 2.12_

  - [ ] 10.3 **Property 2: Preservation** — Regression smoke for non-bug surfaces
    - Run each item below. Every one must behave exactly as it did before this bugfix. Snapshot diffs are the strongest signal; visual confirmation is acceptable for UI-only flows.
    - **TeePublic queue**: run a TeePublic queue with one design and confirm it completes against TeePublic exactly as today (no extension-side interference; `content_scripts.matches` unchanged). _Requirements: 3.5, 3.6_
    - **Excel parsing (3.1)**: upload a fresh `.xlsx` via `/upload/excel`. Diff the response (`count`, `file` modulo uuid, `designs` shape) against a snapshot taken before this bugfix; assert byte-identical. _Requirements: 3.1_
    - **Image serving (3.2)**: `GET /api/image?path=<exact filename>`, `GET /api/image?path=<absolute path>`, and `GET /api/image?path=<bare name with uuid prefix in IMAGE_UPLOAD_DIR>`. Diff bytes and headers against a pre-fix snapshot for each. _Requirements: 3.2_
    - **Job create/list (3.3)**: `POST /jobs/create` with an identical payload and `GET /jobs`. Diff JSON against a pre-fix snapshot. The new `POST /designs/{id}/status` endpoint must be additive only. _Requirements: 3.3_
    - **Popup chrome (3.4)**: open the popup, confirm `searchInput`, `filterSelect`, `selectAllInput`, `uploadSelectedButton`, `refreshButton`, `startButton`, `pauseButton`, `stopButton`, `connectButton` are present with the same IDs and that each fires the same `chrome.runtime.sendMessage` action as before. _Requirements: 3.4_
    - **Non-Redbubble surfaces (3.5)**: visit login, profile, reset-password, sticker-color UI, and the AI/trademark buttons; confirm they render and behave as today. _Requirements: 3.5_
    - **Manifest match preservation (3.6)**: navigate to a non-duplicate Redbubble URL (e.g., `https://www.redbubble.com/people/<user>`); confirm `content.js` does not boot (`window.__rbAutomationBooted` is unset and no overlay renders). _Requirements: 3.6_
    - **No auto interaction outside an active upload (3.7)**: open `https://www.redbubble.com/portfolio/images/<id>/duplicate` manually (no `?auto=1`); confirm no form filling, no save click, no checkbox tick. _Requirements: 3.7_
    - **Already-canonical `/duplicate` copy_link (3.8)**: pass `https://www.redbubble.com/portfolio/images/12345/duplicate` through the new `getDuplicateUrl`; confirm the result is `https://www.redbubble.com/portfolio/images/12345/duplicate?auto=1` (only `?auto=1` added; no other change). _Requirements: 3.8_
    - **Selenium service stays dead (3.9)**: `grep -R "redbubble_service" backend/app/api` and confirm no new import was introduced; the dead Selenium code remains uninvoked. _Requirements: 3.9_
    - **Sequential queue policy (3.10)**: queue two designs, force the first to error mid-stage; confirm the queue moves on only after a terminal value (no `beforeunload`-driven advance), and that retry-once-then-fail behavior in `processNext` is unchanged. _Requirements: 3.10_
    - _Preservation: Property 2 from design.md (Correctness Properties)_

  - [ ] 10.4 Checkpoint — final sign-off
    - All checks in 10.1, 10.2, and 10.3 pass.
    - If any check fails, stop and ask before proceeding; do not patch incrementally past a failure on the acceptance gate.
    - Once green, the bugfix is ready to ship.

## Notes

- **Out-of-scope follow-ups (intentionally not in this bugfix)**: persisting `redbubble_work_id` as a `Design` column, adding a JS test runner for the extension, surfacing `redbubble_work_id` as a link in `QueueManager.jsx`. These are tracked in `design.md` §"Risks and Mitigations" and §"7. Frontend: frontend/src/components/QueueManager.jsx".
- **Rollback**: each task is small enough to revert in isolation. The full rollback strategy is documented in `design.md` §"Rollback Plan"; reverting the diff for a given task restores the prior behavior because no migration runs and no schema changes.
- **Why no test framework setup task**: the project does not currently ship a JS test runner for the extension, and adding one is explicitly called out as a follow-up in `design.md` §"Unit Tests". Verification per task is done via console/devtools and curl/SQL checks against the local backend, which is sufficient for the user's "ship one design first" gate.
- **Verification artifacts**: before starting task 1, capture pre-fix snapshots of `GET /jobs`, `POST /jobs/create` (with a known payload), `POST /upload/excel` (with a known `.xlsx`), and `GET /api/image?path=<known>` so the preservation diffs in tasks 5, 6, and 10.3 have something to compare against.
- **Single-design constraint**: every verification step in this plan assumes one design at a time. Multi-design queue verification is intentionally limited to the sequential-policy check in 10.3 to keep the gate small.
