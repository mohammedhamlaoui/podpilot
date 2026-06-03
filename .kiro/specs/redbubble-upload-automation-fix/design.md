# Redbubble Upload Automation Fix - Bugfix Design

## Overview

The Redbubble single-design upload path does not reliably take a design from "Start Upload" through to a published `/studio/promote/{id}` page with a clean status reflected in the popup, the dashboard, and the backend. The defect is a cluster of related issues across the Chrome extension and the FastAPI backend: a duplicate-injection race between the manifest's `content_scripts` and `chrome.scripting.executeScript`, an over-restrictive duplicate-URL builder, a missing `?auto=1` automation signal, an unreliable success detector, a `beforeunload`-as-success fallback that mismarks failed uploads, brittle agreement-checkbox selection, incomplete tag-chip clearing, and the absence of any backend endpoint to receive per-design results.

The fix is targeted and localized: it tightens the success/error decision in `content.js`, normalizes copy_link handling and removes the duplicate injection in `background.js`, adds a single new backend endpoint (`POST /designs/{id}/status`) that the extension calls when an upload reaches a terminal state, and surfaces an extension-local stage log in the popup. No Excel columns change, no schema is restructured, no TeePublic code is touched, and no third-party code is copied. The Redbubble-only contract is preserved by working entirely inside the existing `extension/*` files and a small additive change to `backend/app/api/routes.py` and `backend/app/schemas/job.py`.

## Glossary

- **Bug_Condition (C)**: The condition that triggers the bug — a single Redbubble design X is started from the dashboard queue (Start Upload or popup Upload (n)) with a non-empty `copy_link` pointing at a Redbubble work owned by the signed-in user, a matched local image (`image_url` or absolute `image_path`), and non-empty `title`, `description`, `main_tag`, `supporting_tags`, while signed in to Redbubble in the active Chrome profile.
- **Property (P)**: The desired behavior when C(X) holds — the Redbubble duplicate page is driven through every stage to a `/studio/promote/{id}` redirect, the design is marked `done` in the extension queue and in the backend `Design.status`, the captured `redbubble_work_id` is persisted, and the popup and dashboard reflect that result.
- **Preservation**: Existing behavior that must remain unchanged by the fix — Excel parsing, image upload/serving, job creation/listing, popup chrome (search/filter/select/buttons), the TeePublic surface, login/profile/reset-password flows, the manifest match patterns, sticker-color UI, the dead Selenium service, and the sequential one-at-a-time retry-once queue policy in `processNext`.
- **Stage**: A named step of the in-page automation, one of: `navigate`, `inject_image`, `wait_image_ready`, `fill_metadata`, `clear_tags`, `agreement`, `save_click`, `wait_success`.
- **redbubble_work_id**: The numeric `{id}` captured from `https://www.redbubble.com/studio/promote/{id}`. This id is the unique identifier Redbubble assigns to a saved work and is the only authoritative success signal.
- **handleUploadFlow**: The orchestration function inside `extension/content.js` (currently inline inside the `chrome.runtime.onMessage` listener for `fill_duplicate_form`) that walks through all stages.
- **getDuplicateUrl**: The function in `extension/background.js` that builds the canonical Redbubble duplicate URL from a stored `copy_link`.
- **waitForSuccess**: The function in `extension/content.js` that today polls for navigation away from `/duplicate` and which the bugfix replaces with a strict `/studio/promote/\d+` matcher.
- **__rbAutomationBooted**: The window-level guard flag set by `content.js` on first execution to prevent double-running of the automation.

## Bug Details

### Bug Condition

The bug manifests when a user clicks Start Upload (dashboard) or Upload (n) (popup) for a single Redbubble design that has all the required fields and a valid Redbubble work copy_link, while signed in to Redbubble. The system today fails to deliver a deterministic terminal status because of a chain of defects: duplicate content-script injection, missing duplicate-URL formats, missing `?auto=1` signal, brittle success/agreement detection, a `beforeunload`-as-success path that lies, and no backend endpoint to receive results. Any one of these can cause a real failure to be reported as `done`, a real success to be reported as `error`, or no terminal status at all.

**Formal Specification:**
```
FUNCTION isBugCondition(input)
  INPUT: input of type RedbubbleUploadAttempt
    where input has fields:
      design_id            : integer
      copy_link            : string
      image_url_or_path    : string
      title                : string
      description          : string
      main_tag             : string
      supporting_tags      : string
      user_signed_in       : boolean
      origin               : enum { dashboard_start, popup_upload_n }
  OUTPUT: boolean

  RETURN input.copy_link != ""
         AND copyLinkPointsAtRedbubbleWork(input.copy_link)
         AND input.image_url_or_path != ""
         AND input.title != ""
         AND input.description != ""
         AND input.main_tag != ""
         AND input.supporting_tags != ""
         AND input.user_signed_in == true
         AND input.origin IN { dashboard_start, popup_upload_n }
         AND NOT (
              terminalStatusReachesBackend(input)
              AND backendStatusMatchesActualRedbubbleOutcome(input)
              AND popupAndDashboardReflectThatStatus(input)
         )
END FUNCTION
```

### Examples

- **Example 1 (false success on unload)**: User clicks Start Upload, the duplicate page errors at the agreement step, the user closes the tab; `waitForSuccess`'s `beforeunload` handler sends `status: "success"` for that `design_id` and the queue advances. Expected: backend `Design.status = "error"` with `stage = "agreement"`; actual: extension marks `done`, backend stays `pending`.
- **Example 2 (rejected valid copy_link)**: `copy_link = "https://www.redbubble.com/people/alice/works/12345-cool-shirt"`. `getDuplicateUrl` throws `"copy_link must point to a Redbubble duplicate URL."` Expected: navigate to `https://www.redbubble.com/portfolio/images/12345/duplicate?auto=1`.
- **Example 3 (double injection)**: The manifest's `content_scripts` autoinjects on `*/duplicate*`, then `background.js` calls `chrome.scripting.executeScript({ files: ['content.js'] })`. Two registrations of the message listener fire on a single `fill_duplicate_form` and the form is filled twice (or fights itself).
- **Example 4 (carryover tags)**: Source work had tags `["sold", "vintage", "tee"]`. `clearTagEditorRobust` clears the editor only partially; the published work keeps `vintage` even though the new `main_tag` and `supporting_tags` say nothing about it.
- **Example 5 (wrong checkbox)**: Redbubble adds a "Subscribe to newsletter" checkbox after the rights-and-terms one; `allCheckboxes[allCheckboxes.length - 1]` ticks the newsletter checkbox, leaving `#submit-work` disabled. Expected: agreement checkbox is selected by stable signal and the save button enables.
- **Example 6 (no backend status)**: Upload finishes, popup says `done`, user restarts Chrome. The dashboard shows the design back as `pending` because the backend never received the result. Expected: backend `Design.status = "done"` and `redbubble_work_id` is stored.
- **Edge case (bfcache restore)**: User navigates back to the duplicate page after a real failure; `!url.includes('/duplicate')` previously briefly held during navigation transitions, but the new strict regex `^https://www\.redbubble\.com/studio/promote/\d+` rejects that and only succeeds on a real promote URL.

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- Excel parsing via `excel_parser.parse_excel_designs` and the `/upload/excel` endpoint stay byte-identical, including the `filename, title, description, main_tag, supporting_tags, copy_link` columns.
- `/upload/images` storage layout (`backend/uploads/images/{uuid}-{filename}`) and `/api/image?path=...` resolution order (absolute → exact filename → uuid-prefixed) stay byte-identical.
- `/jobs` and `/jobs/create` request and response shapes stay byte-identical; the new status endpoint is additive.
- Popup controls (search, filter, select-all, Upload (n), Refresh, Pause/Resume, Stop, Connect to dashboard) keep the same DOM IDs and message actions.
- TeePublic dashboard pages, TeePublic import, TeePublic queue, login page, reset-password page, profile page, sticker-color UI, AI/trademark buttons stay untouched.
- Manifest `content_scripts.matches` stays `["https://www.redbubble.com/portfolio/images/*/duplicate*", "https://www.redbubble.com/portfolio/images/new*"]` so non-duplicate Redbubble pages are not interacted with.
- The dead Selenium code in `backend/app/services/redbubble_service.py` stays uninvoked; the bugfix does not introduce a Selenium path.
- The sequential one-at-a-time retry-once-then-fail queue model in `background.js` `processNext` stays the same; the fix only tightens the success/error decision feeding into it.

**Scope:**
All inputs that do NOT match C(X) must be completely unaffected. This includes:
- TeePublic queue runs and TeePublic content scripts (separate code path, not touched).
- Excel uploads, image uploads, job creation, job listing (backend write path is the same).
- Manual edits in DesignManager (frontend state only, not touched).
- Login, profile, and reset-password flows (frontend, not touched).
- Any Redbubble URL that is not `*/duplicate*` or `*/new*` (manifest match patterns unchanged).
- Designs uploaded via a `copy_link` that already points at `/portfolio/images/{id}/duplicate` (the canonicalizer is a no-op for those).

The actual expected correct behavior for C(X) is defined in the Correctness Properties section (Property 1).

## Hypothesized Root Cause

Based on the bug description and a read of `extension/background.js`, `extension/content.js`, `extension/manifest.json`, and `backend/app/api/routes.py`, the most likely root causes are:

1. **Duplicate content-script injection causing listener races**:
   - The manifest auto-injects `content.js` on `*/duplicate*` and `*/new*`.
   - `background.js` `injectContentScript` then calls `chrome.scripting.executeScript({ files: ['content.js'] })` even after a guard check, and the guard relies on `window.__rbUploaderInjected` which the content script sets only after registering its message listener.
   - On a fast load, the manifest copy boots first, the executeScript copy still loads, and either two listeners fire or one runs against a half-initialized DOM. Removing the programmatic injection and relying solely on the manifest registration eliminates the race.

2. **Over-restrictive `copy_link` parsing**:
   - `getDuplicateUrl` only succeeds if the path already contains `/duplicate` or matches `/portfolio/images/{id}`.
   - It rejects the `/people/{user}/works/{id}-{slug}` format that Redbubble exposes in the user's dashboard, which is the most common shape users paste into the Excel sheet.

3. **Unreliable success detection**:
   - `waitForSuccess` treats any URL that does not include `/duplicate` as success, which catches bfcache restores, Redbubble error redirects, and the cache-buster reload.
   - The `beforeunload` handler reports `success` on any unload (manual close, navigation back, Chrome bfcache eviction).
   - Both paths can mark a failed upload as `done`. The fix replaces them with a strict regex match against `^https://www\.redbubble\.com/studio/promote/(\d+)` and drops the `beforeunload`-as-success path entirely.

4. **Brittle agreement-checkbox selection**:
   - `checkAgreementCheckbox` falls back to `allCheckboxes[allCheckboxes.length - 1]` when the labelled lookup fails, so any new or reordered checkbox on Redbubble breaks the flow silently.
   - The fix tightens the lookup to stable signals (input attributes containing `rights`/`terms`/`agreement`, or surrounding label text) and fails with a named error if none is found.

5. **Incomplete tag-chip clearing**:
   - `clearTagEditorRobust` does up to 5 passes but does not verify that the editor is empty before injecting new tags, so leftover chips can persist.
   - The fix adds a final assertion that the editor's chip count is zero, with one extra pass and a stage-scoped error if not.

6. **Missing `?auto=1` in-page signal**:
   - `content.js` has no way to know it is running under automation, so the overlay is rendered only after `fill_duplicate_form` arrives, leaving a visible flash.
   - Adding `?auto=1` to the navigation lets the content script render the overlay at `document_start` and reject manual page visits.

7. **No backend status endpoint**:
   - Today there is no `POST /designs/{id}/status`. The extension's terminal status lives only in `chrome.storage.local` and is lost on browser restart.
   - Adding the endpoint and calling it from `background.js` on `upload_result` closes the loop with the dashboard.

## Correctness Properties

Property 1: Bug Condition - End-to-End Single Redbubble Upload Reaches Terminal Status

_For any_ input where the bug condition holds (isBugCondition returns true), the fixed system SHALL drive the Redbubble duplicate page through every stage, SHALL detect a URL match against `/^https:\/\/www\.redbubble\.com\/studio\/promote\/(\d+)/`, SHALL capture the matched group as `redbubble_work_id`, SHALL call `POST /designs/{id}/status` with `status: "done"` and `redbubble_work_id`, SHALL mark the design `done` in the extension queue, and SHALL render `done` and the per-stage log in the popup; or, on any stage failure, SHALL call `POST /designs/{id}/status` with `status: "error"`, the failing `stage`, and an `error_message`, and SHALL surface that same staged error in the popup and dashboard.

**Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 2.10, 2.11, 2.12**

Property 2: Preservation - Non-Bug Inputs and Surfaces Are Unchanged

_For any_ input where the bug condition does NOT hold (isBugCondition returns false), the fixed code SHALL produce exactly the same observable behavior as the original code, preserving Excel parsing, image upload and serving, job creation and listing, popup chrome controls and IDs, TeePublic flows, login/profile/reset-password flows, manifest match patterns for non-duplicate Redbubble pages, sticker-color UI, the dead Selenium service's non-invocation, and the sequential one-at-a-time retry-once queue policy.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10**

## Fix Implementation

### Changes Required

Assuming the root cause analysis is correct, the changes are localized to seven files. No source code is rewritten; existing functions are replaced or extended in place.

---

#### 1. Backend: `backend/app/schemas/job.py`

**Function/Section**: New Pydantic model.

**Specific Changes**:
1. **Add `DesignStatusUpdateIn`**: a new model with the exact request shape consumed by `POST /designs/{id}/status`.

```python
from typing import Literal, Optional
from datetime import datetime
from pydantic import BaseModel, Field

class DesignStatusUpdateIn(BaseModel):
    status: Literal["done", "error", "in_progress"]
    stage: Optional[Literal[
        "navigate",
        "inject_image",
        "wait_image_ready",
        "fill_metadata",
        "clear_tags",
        "agreement",
        "save_click",
        "wait_success",
    ]] = None
    error_message: Optional[str] = Field(default=None, max_length=2000)
    redbubble_work_id: Optional[str] = Field(default=None, max_length=64)
    updated_at: Optional[datetime] = None
```

2. **Existing `DesignIn` and `JobCreateIn` are not touched.** No column or field is renamed, removed, or re-typed.

---

#### 2. Backend: `backend/app/api/routes.py`

**Function/Section**: New endpoint added below the existing handlers; helpers reused.

**Specific Changes**:
1. **Add `POST /designs/{design_id}/status`**:
   - Path parameter `design_id: int`, type-matched to `Design.id` and to the id used elsewhere in `_design_to_dict`.
   - Body: `DesignStatusUpdateIn`.
   - Auth posture: same as the rest of `/api` today (no new auth requirement; same FastAPI dependency surface as `/jobs/create`).

```python
from app.schemas.job import DesignStatusUpdateIn
from datetime import datetime, timezone

@router.post("/designs/{design_id}/status")
def update_design_status(
    design_id: int,
    payload: DesignStatusUpdateIn,
    db: Session = Depends(get_db),
) -> dict:
    design = db.get(Design, design_id)
    if design is None:
        raise HTTPException(status_code=404, detail=f"Design {design_id} not found.")

    design.status = payload.status
    # error_message, stage, redbubble_work_id are accepted by the schema and
    # will be persisted in a follow-up if/when columns are added; for this
    # bugfix we do not change the table schema. They are echoed back in the
    # response so the extension can confirm receipt.
    db.commit()
    db.refresh(design)

    response = _design_to_dict(design)
    response["stage"] = payload.stage
    response["error_message"] = payload.error_message
    response["redbubble_work_id"] = payload.redbubble_work_id
    response["updated_at"] = (payload.updated_at or datetime.now(timezone.utc)).isoformat()
    return response
```

   - **Success response**: `200` with the existing `_design_to_dict(design)` shape plus the four echoed fields (`stage`, `error_message`, `redbubble_work_id`, `updated_at`). The base shape used by `/jobs` and `/jobs/create` is unchanged.
   - **Error responses**: `404` if `design_id` is not found; `422` automatically from FastAPI if the body fails Pydantic validation.
   - **No schema/database restructure**: `Design` columns stay exactly as they are. `redbubble_work_id`, `stage`, and `error_message` are accepted and echoed for now; persisting them is out of scope for this bugfix and is called out in Risks.

---

#### 3. Extension: `extension/manifest.json`

**Function/Section**: `host_permissions` (already present), `content_scripts` (unchanged).

**Specific Changes**:
1. **No change to `content_scripts.matches`**: stays `["https://www.redbubble.com/portfolio/images/*/duplicate*", "https://www.redbubble.com/portfolio/images/new*"]`.
2. **No change to `host_permissions`**: stays `["https://www.redbubble.com/*", "http://localhost:8000/*", "http://127.0.0.1:8000/*"]`. The extension → backend status call uses the existing `http://localhost:8000` host permission; no new origin is added.

---

#### 4. Extension: `extension/background.js`

**Function/Section**: `getDuplicateUrl`, `injectContentScript` (removed), `uploadDesign` (stage handling), `handleUploadResult` (extended), new `postDesignStatus`, new per-design `progressLog`.

**Specific Changes**:

1. **Replace `getDuplicateUrl` to accept three input formats and append `?auto=1`**:

```javascript
function getDuplicateUrl(copyLink) {
  const url = new URL(copyLink);
  if (url.hostname !== "www.redbubble.com" && url.hostname !== "redbubble.com") {
    throw new Error("copy_link must be a Redbubble URL.");
  }

  // Format A: /portfolio/images/{id}/duplicate (already canonical)
  // Format B: /portfolio/images/{id}[/...] (canonicalize)
  // Format C: /people/{user}/works/{id}-{slug} (canonicalize)
  let workId = null;
  const portfolioMatch = url.pathname.match(/^\/portfolio\/images\/(\d+)(?:\/|$)/);
  const worksMatch = url.pathname.match(/^\/people\/[^/]+\/works\/(\d+)(?:-|$)/);
  if (portfolioMatch) workId = portfolioMatch[1];
  else if (worksMatch) workId = worksMatch[1];
  else throw new Error(`Unrecognized Redbubble copy_link: ${copyLink}`);

  url.hostname = "www.redbubble.com";
  url.pathname = `/portfolio/images/${workId}/duplicate`;
  url.searchParams.set("auto", "1"); // preserves any other query params already on the URL
  return url.toString();
}
```

2. **Remove the programmatic content-script injection**: delete the call to `chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] })` and rely solely on the manifest's `content_scripts` registration. The pre-check (`window.__rbUploaderInjected === true`) becomes unnecessary because there is now exactly one injection path.

3. **Replace the `injectContentScript(tabId)` call site** with a `waitForContentScriptReady(tabId)` poll that pings the tab with `{ action: "ping" }` until the content script answers (or times out at 30s with a stage-scoped `navigate` error).

4. **Extend `handleUploadResult`** to:
   - Accept `stage`, `error_message`, and `redbubble_work_id` fields on the message.
   - Store the stage transitions in a per-design `progressLog` array kept in memory (rebroadcast through `chrome.runtime.sendMessage` on every update), and persist the latest snapshot to `chrome.storage.session` (or `chrome.storage.local` if `session` is unavailable on the user's Chrome version) so the popup can rehydrate after a reopen.
   - On terminal status (`done` or `error`), call `postDesignStatus(design.id, payload)`.

5. **Add `postDesignStatus(designId, payload)`**:

```javascript
const API_BASE = "http://localhost:8000"; // matches the existing /api/image base

async function postDesignStatus(designId, payload) {
  const url = `${API_BASE}/designs/${encodeURIComponent(designId)}/status`;
  const maxAttempts = 3;
  const backoffMs = 2000;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const resp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (resp.ok) return await resp.json();
      // 4xx is not retryable except 408/429
      if (resp.status >= 400 && resp.status < 500 && resp.status !== 408 && resp.status !== 429) {
        throw new Error(`status update rejected: ${resp.status}`);
      }
    } catch (err) {
      if (attempt === maxAttempts) {
        console.warn("postDesignStatus failed after retries:", err);
        // Persistent failure: log it, leave the extension queue state intact
        // so the user can see the design's terminal status in the popup even
        // though the backend did not receive it. Do not fail the queue.
        return null;
      }
    }
    await new Promise((r) => setTimeout(r, backoffMs));
  }
  return null;
}
```

   - **Where the call happens in the upload flow**:
     - On every `stage_update` message (intermediate stages), the call is **not** made — intermediate stages are extension-local only.
     - On `upload_result` with `status === "success"`: call `postDesignStatus(designId, { status: "done", redbubble_work_id, updated_at: now })`.
     - On `upload_result` with `status === "error"`: call `postDesignStatus(designId, { status: "error", stage, error_message, updated_at: now })`.
   - **URL construction**: `${API_BASE}/designs/${designId}/status` where `API_BASE` is the same constant the popup and dashboard use to talk to the backend (`http://localhost:8000`).
   - **Retry policy**: 3 attempts, 2s linear backoff, retry only on network error or `5xx`/`408`/`429`. On persistent failure: log a warning, **do not** flip the extension queue state, **do not** retry beyond 3.
   - **Auth posture**: same as `/api/image` and `/jobs` today (no header). The call is an extension → backend call, allowed by the existing `host_permissions` for `http://localhost:8000/*`.

6. **Add `progressLog` per design**: a map keyed by `design_id` that holds an array of `{ stage, status: "in_progress" | "done" | "error", at, error_message? }` entries. The map is held in `chrome.storage.session` under the key `progressLog` (in-memory mirror for fast reads, persisted on each update). Every update is broadcast via `chrome.runtime.sendMessage({ action: "progress_log_updated", design_id, log })` so the popup can re-render without polling.

---

#### 5. Extension: `extension/content.js`

**Function/Section**: top-of-file guard, `?auto=1` gate, stage state machine, `clearTagEditorRobust` final assertion, `findAgreementCheckbox` strict mode, `waitForSuccess` strict regex, removal of `beforeunload`-as-success.

**Specific Changes**:

1. **Window-level guard**:

```javascript
if (window.__rbAutomationBooted) {
  console.log('content.js already booted on this page; exiting');
} else {
  window.__rbAutomationBooted = true;
  // ... rest of the IIFE, including the single onMessage listener registration
}
```

   The existing `window.__rbUploaderInjected` flag is renamed to `window.__rbAutomationBooted` for clarity. The message listener is registered exactly once per page lifecycle.

2. **Read `?auto=1` at boot** to render the overlay immediately and gate automation:

```javascript
const params = new URLSearchParams(window.location.search);
const isAutomationMode = params.get("auto") === "1";
if (isAutomationMode) showUploadOverlay("Preparing Redbubble upload...", 0);
// Manual page visits (no ?auto=1) do not auto-trigger any form filling.
```

3. **Stage state machine**: replace the inline orchestration in the `fill_duplicate_form` handler with an explicit FSM:

```
queued → navigate → inject_image → wait_image_ready → fill_metadata → clear_tags → agreement → save_click → wait_success → done | error
```

   At every transition emit `chrome.runtime.sendMessage({ action: "stage_update", design_id, stage, status: "in_progress" })`. On stage success, emit the same with `status: "done"`. On stage failure, emit `{ action: "upload_result", design_id, status: "error", stage, error_message }`.

4. **Per-stage failure criteria with named errors**:
   - `navigate`: copy_link rejected by `getDuplicateUrl` (raised in `background.js` before content.js runs, mapped to `stage: "navigate"`); or page failed to reach `readyState: "interactive"` within `FORM_WAIT_MS` (15s).
   - `inject_image`: file input not found (`File input "${SEL_FILE_INPUT}" not found on page`) or `injectImageFile` throws.
   - `wait_image_ready`: `waitForImageUploadComplete` times out (90s) **and** no upload-complete signal is present.
   - `fill_metadata`: `#work_title_en` or `#work_description_en` not found within `FORM_WAIT_MS`, or `forceSetValue` does not update the React-controlled value.
   - `clear_tags`: after 5 passes plus the new final assertion, the chip count in the main-tag or supporting-tags editor is still > 0.
   - `agreement`: no checkbox located by stable signal (input attributes `name`/`id` containing `rights`/`terms`/`agreement` or surrounding label text matching the agreement copy).
   - `save_click`: `getSaveButton` returns null after `SAVE_POLL_MS` (30s) or the button is still disabled.
   - `wait_success`: 60s pass without the URL matching `/^https:\/\/www\.redbubble\.com\/studio\/promote\/(\d+)/` and no Redbubble error banner.

5. **Strict success criterion**: replace the body of `waitForSuccess`:

```javascript
const SUCCESS_RE = /^https:\/\/www\.redbubble\.com\/studio\/promote\/(\d+)/;
async function waitForSuccess(designId, timeoutMs = RESULT_WAIT_MS) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const m = window.location.href.match(SUCCESS_RE);
    if (m) {
      const redbubble_work_id = m[1];
      chrome.runtime.sendMessage({
        action: "upload_result",
        design_id: designId,
        status: "success",
        redbubble_work_id,
      });
      return "success";
    }
    const errorEl = document.querySelector('[role="alert"], .field_with_errors, .errors');
    if (errorEl && isVisible(errorEl)) {
      const msg = (errorEl.innerText || "").trim().slice(0, 300) || "Unknown error";
      chrome.runtime.sendMessage({
        action: "upload_result",
        design_id: designId,
        status: "error",
        stage: "wait_success",
        error_message: msg,
      });
      return "error:" + msg;
    }
    await sleep(500);
  }
  return "timeout";
}
```

6. **Drop the `beforeunload`-as-success path entirely**: the `window.addEventListener('beforeunload', onUnload, ...)` block is removed. Unloads are no longer treated as success; only the strict regex match emits `success`.

7. **Tighten `findAgreementCheckbox`**: keep the existing direct selectors and label-based search; remove the `allCheckboxes[allCheckboxes.length - 1]` fallback in `checkAgreementCheckbox`. If the labelled lookup fails, throw `new Error("agreement: rights-and-terms checkbox not found")` so the stage emits a named error.

8. **Final assertion in `clearTagEditorRobust`**: after the existing 5 passes, count the chips inside the editor's root (`findTagEditorRoot`) using `[class*="TagEditor_pill"], [class*="pill"], [class*="chip"]`. If the count is > 0, run one more pass; if still > 0, throw `new Error("clear_tags: residual chips after 6 passes")`.

---

#### 6. Extension: `extension/popup.js`

**Function/Section**: new subscriber to `progress_log_updated`, new per-design stage list rendering.

**Specific Changes**:

1. **Subscribe to runtime messages**:

```javascript
chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.action === "progress_log_updated") {
    renderStageLog(msg.design_id, msg.log);
  }
  if (msg?.action === "stage_update") {
    renderStageLog(msg.design_id, /* read from session */);
  }
});
```

2. **Render the active design's stage list** below the existing rows for the design currently at `state.currentIndex`. Existing controls (search, filter, select-all, Upload (n), Refresh, Pause/Resume, Stop, Connect) keep their IDs and event handlers untouched.

---

#### 7. Frontend: `frontend/src/components/QueueManager.jsx`

**Function/Section**: existing `/jobs` polling.

**Specific Changes**:

1. **No structural change**: the dashboard QueueManager continues to poll `/jobs` for terminal status. Because intermediate stages are extension-local (not pushed to the backend), `/jobs` continues to return the existing shape; the only new behavior is that `Design.status` now actually transitions to `done` or `error` after the backend receives the extension's `POST /designs/{id}/status` call.
2. **Optional cosmetic**: if `redbubble_work_id` is later persisted (out of scope for this bugfix; called out in Risks), QueueManager could surface a link. For this bugfix it is not added.

### Preservation Strategy: How Each 3.x Requirement Is Upheld

- **3.1 (Excel parsing)**: `excel_parser.parse_excel_designs`, `/upload/excel`, and the column list are not touched. The new endpoint is at `/designs/{id}/status` and shares no code path.
- **3.2 (Image upload/serving)**: `/upload/images`, `/api/image`, `IMAGE_UPLOAD_DIR`, and the absolute → exact filename → uuid-prefixed lookup are not touched.
- **3.3 (Job create/list)**: `JobCreateIn`, `_design_to_dict`, `_job_to_dict`, `/jobs`, and `/jobs/create` are not touched. The new schema `DesignStatusUpdateIn` is additive and isolated.
- **3.4 (Popup controls)**: existing IDs (`searchInput`, `filterSelect`, `selectAllInput`, `uploadSelectedButton`, `refreshButton`, `startButton`, `pauseButton`, `stopButton`, `connectButton`) and their actions stay. The stage log renders as an additive panel below the table.
- **3.5 (TeePublic/login/profile/sticker)**: `TeePublicQueue.jsx`, `TeePublicImport.jsx`, `TeePublicDesignManager.jsx`, `LoginPage.jsx`, `ProfilePage.jsx`, `ResetPasswordPage.jsx`, and the sticker-color UI are not opened by the bugfix.
- **3.6 (Manifest match patterns)**: `content_scripts.matches` stays exactly the same.
- **3.7 (No auto interaction outside upload)**: the new `?auto=1` gate makes manual page visits explicitly opt-out; without `?auto=1`, content.js does not auto-trigger.
- **3.8 (Existing /duplicate copy_link still works)**: the new `getDuplicateUrl` matches `^/portfolio/images/(\d+)(?:/|$)` first, which covers both the existing `/duplicate` form and the unsuffixed form.
- **3.9 (Selenium service stays dead)**: no route imports `redbubble_service` and the bugfix does not add such an import.
- **3.10 (Sequential queue policy)**: `processNext`'s while-loop, the `isProcessing` guard, and the retry-once-then-fail policy are not changed. Only the success/error decision feeding into it changes (strict regex; no `beforeunload`).

## Testing Strategy

### Validation Approach

The testing strategy follows a two-phase approach: first, surface counterexamples that demonstrate the bug on the unfixed code, then verify the fix produces the strict success criterion and preserves the unchanged behaviors. The primary test bed is one design end-to-end against a live Redbubble account, supported by Python unit tests for the new endpoint and JS unit tests for `getDuplicateUrl` and the new success regex.

### Exploratory Bug Condition Checking

**Goal**: Surface counterexamples that demonstrate the bug BEFORE implementing the fix. Confirm or refute the root cause analysis. If a counterexample disagrees with the root cause, re-hypothesize.

**Test Plan**: Run the existing extension against a live Redbubble session. Use a single design row whose `copy_link` is in `/people/{user}/works/{id}-{slug}` form. Observe each defect in turn.

**Test Cases**:
1. **Rejected copy_link**: Start Upload on a design with `copy_link = https://www.redbubble.com/people/<user>/works/<id>-<slug>`. Observe `getDuplicateUrl` throw and the row error with `"copy_link must point to a Redbubble duplicate URL."` (will fail on unfixed code).
2. **Double-injection race**: Open DevTools → Console on the duplicate tab; observe whether `content.js` registers two `chrome.runtime.onMessage` listeners (one from the manifest, one from `executeScript`). Confirm via `console.count` instrumentation in a temporary build (will fail on unfixed code, two registrations).
3. **False success on unload**: Start Upload, then close the tab during the agreement stage. Observe that the popup row flips to `done` (will fail on unfixed code).
4. **Wrong checkbox**: With Redbubble's current DOM, log every `input[type=checkbox]` and confirm whether the last one is the rights-and-terms checkbox. If Redbubble has added any other checkbox, observe the wrong one being ticked (may fail depending on current Redbubble DOM).
5. **Carryover tags**: Pick a source design with 4+ tags, fill new tags via the extension, observe whether any source tag persists on the published work (may fail on unfixed code).
6. **No backend status**: Complete a successful upload, restart Chrome, open the dashboard. Observe the row reverting to `pending` because `Design.status` was never written (will fail on unfixed code; there is no endpoint).
7. **Out-of-range/edge URL handling**: Try `copy_link = https://www.redbubble.com/portfolio/images/12345` (no `/duplicate` suffix). Observe whether the unfixed code accepts it (it does today, so this is a preservation case for the fix to keep working).

**Expected Counterexamples**:
- Test 1: extension queue marks the row `error` with the unhelpful message.
- Test 3: popup shows `done` even though Redbubble never published the work.
- Test 6: dashboard returns `pending` because `Design.status` never transitions.
- Possible causes confirmed: copy_link parser too strict; `beforeunload`-as-success; missing backend endpoint.

### Fix Checking

**Goal**: Verify that for all inputs where the bug condition holds, the fixed system produces the expected behavior (Property 1).

**Pseudocode:**
```
FOR ALL input WHERE isBugCondition(input) DO
  result := runFixedUploadFlow(input)
  ASSERT result.terminal_status IN { "done", "error" }
  ASSERT IF result.terminal_status == "done" THEN
            urlObserved matches /^https:\/\/www\.redbubble\.com\/studio\/promote\/(\d+)/
            AND backendDesignStatus(input.design_id) == "done"
            AND popupShows(input.design_id) == "done"
  ASSERT IF result.terminal_status == "error" THEN
            result.stage IN { navigate, inject_image, wait_image_ready,
                              fill_metadata, clear_tags, agreement,
                              save_click, wait_success }
            AND result.error_message != ""
            AND backendDesignStatus(input.design_id) == "error"
            AND popupShows(input.design_id) == "error"
END FOR
```

### Preservation Checking

**Goal**: Verify that for all inputs where the bug condition does NOT hold, the fixed system produces the same observable result as the original (Property 2).

**Pseudocode:**
```
FOR ALL input WHERE NOT isBugCondition(input) DO
  ASSERT originalSurface(input) == fixedSurface(input)
END FOR
```

**Testing Approach**: A mix of property-based and example-based testing.

- Property-based: generate random non-bug inputs (random Excel files via Hypothesis-style strategies, random `/upload/images` payloads, random `/jobs/create` requests) and assert response shape and content match the unfixed code byte-for-byte.
- Example-based for UI surfaces: walk through TeePublic, login, profile, reset-password, sticker-color UI, manual DesignManager edits, and confirm visually unchanged.

**Test Plan**: Snapshot the unfixed responses for `/upload/excel`, `/upload/images`, `/jobs`, `/jobs/create`, and `/api/image` for a representative input set. Run the same inputs against the fixed code and diff the responses. For frontend, run a smoke pass through every preserved screen.

**Test Cases**:
1. **Excel parse preservation**: post the same `.xlsx` to `/upload/excel` before and after; assert identical `count`, `file` (modulo uuid), and `designs` shape.
2. **Image serving preservation**: GET `/api/image?path=<exact filename>` and `/api/image?path=<absolute path>` and `/api/image?path=<bare name with uuid prefix in IMAGE_UPLOAD_DIR>`; assert identical bytes and headers.
3. **Job create/list preservation**: POST identical `JobCreateIn` payload, GET `/jobs`, diff JSON.
4. **Popup chrome preservation**: open the popup, click each control (search, filter, select-all, Upload (n), Refresh, Pause/Resume, Stop, Connect to dashboard), assert each fires the same `chrome.runtime.sendMessage` action as today.
5. **Manifest match preservation**: navigate to a non-duplicate Redbubble URL (e.g., `https://www.redbubble.com/people/<user>`), assert content.js does not boot (no `__rbAutomationBooted` flag set, no overlay).
6. **TeePublic preservation**: run a TeePublic queue end-to-end and confirm no regression.
7. **/duplicate already-canonical preservation**: pass `copy_link = https://www.redbubble.com/portfolio/images/12345/duplicate` through the new `getDuplicateUrl`; assert it returns `https://www.redbubble.com/portfolio/images/12345/duplicate?auto=1` (only the `?auto=1` is added).

### Test Plan: One Design First

This is the user's primary acceptance gate. Execute it manually exactly once before declaring the bugfix done.

**Manual Test Recipe**:
1. Sign into Redbubble in the active Chrome profile (the same profile that has the PodPilot extension loaded unpacked).
2. In the dashboard, pick one design row that has all of:
   - `copy_link` in `/people/{user}/works/{id}-{slug}` form,
   - a matched local image (image preview renders in the row),
   - non-empty `title`, `description`, `main_tag`, `supporting_tags`.
3. Click Start Upload for that single row.
4. **Observe**:
   - A new tab opens at `https://www.redbubble.com/portfolio/images/{id}/duplicate?auto=1`.
   - The PodPilot overlay appears at the top of the tab immediately (within 500ms of `document_start`).
   - The image preview replaces the source image preview within ~30s.
   - Title, description, main tag, and supporting tags fill in. No stale chips remain in either tag editor.
   - Rights-and-terms checkbox is ticked (and only that one).
   - Save button enables and is clicked.
   - URL transitions to `https://www.redbubble.com/studio/promote/{id}`.
5. **Confirm**:
   - Popup shows the per-stage progression for this design and ends on `done`.
   - Within one `/jobs` poll cycle (≤ 5s by default), QueueManager in the dashboard shows `done` for that row.
   - Backend: `SELECT id, status FROM designs WHERE id = ?` returns `status = "done"`.
   - Backend response from `POST /designs/{id}/status` echoed `redbubble_work_id` matching the URL's `{id}`.

**Negative Test**: pick a design row, manually edit its `copy_link` in the dashboard to an obviously bad value (e.g., `https://www.redbubble.com/people/whatever/oops`). Click Start Upload.
- Expect: popup shows a staged error such as `navigate: invalid copy_link` for that row; backend `Design.status = "error"`; the `POST /designs/{id}/status` body included `stage = "navigate"` and a non-empty `error_message`. Dashboard shows `error` after next `/jobs` poll.

**Regression Smoke**:
- Run a TeePublic queue with one design and confirm it still completes against TeePublic exactly as today.
- Upload a fresh `.xlsx` via `/upload/excel` and confirm parsing and persistence are identical.
- Hit `/api/image?path=<path>` for a known image and confirm the bytes match.
- Visit the login, profile, and reset-password pages and confirm they render and function as today.

### Unit Tests

- **Backend (`tests/test_design_status.py`)**:
  - `POST /designs/{id}/status` with valid body for an existing `Design.id` returns 200 and updated row.
  - `POST /designs/{id}/status` with unknown id returns 404.
  - `POST /designs/{id}/status` with bad `status` literal returns 422.
  - `POST /designs/{id}/status` with `error_message` longer than 2000 chars returns 422.
- **Extension (Jest or vitest, kept additive; no test runner needs to be introduced for this bugfix if absent — note as a follow-up)**:
  - `getDuplicateUrl` accepts all three input formats and produces the `?auto=1` URL.
  - `getDuplicateUrl` rejects non-Redbubble URLs and unrecognized paths.
  - `SUCCESS_RE` matches `https://www.redbubble.com/studio/promote/12345` and rejects `/duplicate?_cb=...` and `https://www.redbubble.com/people/x`.

### Property-Based Tests

- **Backend status endpoint contract**: generate random valid `DesignStatusUpdateIn` payloads; assert that for any payload where `status ∈ {done, error, in_progress}`, the response status code is 200 and the response body contains an updated `Design.status` field equal to the input `status`.
- **`getDuplicateUrl` round-trip**: generate random work ids and three URL shapes (canonical, unsuffixed `/portfolio/images/{id}`, `/people/{user}/works/{id}-{slug}`); assert all three normalize to the same canonical `/portfolio/images/{id}/duplicate?auto=1`.
- **Preservation property for non-bug inputs**: generate random `JobCreateIn` payloads; assert that the post-fix `/jobs/create` response equals the pre-fix snapshot.

### Integration Tests

- **One-design end-to-end (the recipe above)**: this is the primary integration test and the user's gate.
- **Negative path end-to-end**: deliberately bad `copy_link` produces a `navigate`-staged error in popup, dashboard, and backend.
- **Visual feedback**: confirm the overlay renders at `document_start` (before any DOM is filled) when `?auto=1` is present, and not at all when it is absent.

## Risks and Mitigations

- **Redbubble DOM drift**: the rights-and-terms checkbox lookup, the file input selectors, and the tag editor selectors are tied to Redbubble's current DOM. Mitigation: the new `findAgreementCheckbox` uses a layered lookup (input attributes → label text), each layer falls through with a clear log line, and a final stage-named error makes drift visible immediately rather than silently ticking the wrong checkbox.
- **Network flakiness against `localhost:8000`**: `postDesignStatus` may time out. Mitigation: 3 attempts with 2s backoff, persistent failure logged but does not flip the queue state, so the user still sees the terminal status in the popup.
- **Chrome bfcache**: navigating away and back can restore the duplicate page. Mitigation: the strict `^https://www\.redbubble\.com/studio/promote/(\d+)` regex rejects bfcache restores; the cache-buster `?_cb=` already applied by `navigateTab` is preserved.
- **`chrome.storage.session` availability**: older Chrome versions may not support it. Mitigation: feature-detect at startup and fall back to `chrome.storage.local` for the `progressLog` key.
- **`redbubble_work_id` not persisted in the table**: this bugfix accepts and echoes it but does not add a column. Risk: future analytics cannot query it. Mitigation: documented in this design as an explicit non-goal; persistence is a follow-up that can add a single nullable `redbubble_work_id` column without changing existing endpoints.
- **Manifest auto-injection on `*/new*`**: the manifest also matches `*/new*` URLs (today). The bugfix does not add automation behavior for the `new` page; the new content.js boots there with the guard set but, without `?auto=1`, does nothing. Mitigation: the `isAutomationMode` gate is checked before any DOM mutation.

## Rollback Plan

The bugfix is intentionally localized:
- Backend: one new schema (`DesignStatusUpdateIn`) and one new route (`POST /designs/{design_id}/status`). Reverting the diff removes both; no migration is needed because no column was added or changed.
- Extension: `manifest.json` is unchanged; `background.js` and `content.js` changes are confined to specific functions (`getDuplicateUrl`, the `injectContentScript` removal, `handleUploadResult`, the new `postDesignStatus` and `progressLog`, the content.js guard rename, the `?auto=1` gate, the FSM stages, the strict `waitForSuccess`, the `findAgreementCheckbox` strict mode, and the `clearTagEditorRobust` final assertion). Reverting the diff restores the original behavior.
- Frontend: `QueueManager.jsx` is not structurally changed; rollback is a no-op.
- Popup: `popup.js` gains an additive runtime-message subscriber and a stage-list render path; reverting the diff removes both without affecting the existing controls.

If the bugfix is rolled back, the user's TeePublic flow, Excel upload, image serving, job listing, login, profile, reset-password, and sticker-color UI are all unaffected because none of them were modified.
