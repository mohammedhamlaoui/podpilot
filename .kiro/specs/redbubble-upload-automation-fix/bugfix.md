# Bugfix Requirements Document

## Introduction

The Redbubble upload automation does not reliably take a single design from "Start Upload" in the dashboard all the way to a published work on Redbubble with the dashboard reflecting the result. The user has set the immediate goal as: ship one Redbubble design end-to-end, reliably, before any further work. The bug spans the Chrome extension (`extension/content.js`, `extension/background.js`, `extension/manifest.json`, `extension/popup.js`) and the FastAPI backend (`backend/app/api/routes.py`, `backend/app/schemas/job.py`, `backend/app/models/job.py`) because the system today never reports the per-design upload outcome back to the backend.

This bugfix targets only the Redbubble single-design path. TeePublic, Excel columns, the AI/trademark UI, and the broader project structure are out of scope.

### Bug Condition C(X)

X is a single Redbubble design started from the dashboard queue with:
- a non-empty `copy_link` that points at a Redbubble work owned by the signed-in user,
- a matched local image (either `image_url` or absolute `image_path` resolvable through `/api/image`),
- non-empty `title`, `description`, `main_tag`, and `supporting_tags`.

C(X) holds when the user clicks **Start Upload** (or **Upload (n)** in the extension popup) for X while signed in to Redbubble in the active Chrome profile.

For every X satisfying C(X), the system must drive the Redbubble duplicate page to a `/studio/promote/{id}` redirect, mark the design `done` in both the extension queue and the backend, and surface a clear running status. ¬C(X) covers everything else (TeePublic queue, Excel parsing, image upload to backend, manual edits in DesignManager, login flow, sticker color UI, job listing) and must not regress.

## Bug Analysis

### Current Behavior (Defect)

The current automation fails or behaves incorrectly in the following observable ways when a user attempts a single Redbubble design upload end-to-end:

1.1 WHEN the user clicks Start Upload for a single design with a valid `copy_link` and a matched image THEN the upload does not reliably complete end-to-end and the user cannot tell from the dashboard or the extension popup whether Redbubble actually published the work.

1.2 WHEN `extension/background.js` opens the duplicate URL in a new tab THEN both the manifest's `content_scripts` auto-injection (`https://www.redbubble.com/portfolio/images/*/duplicate*`) and the manual `chrome.scripting.executeScript({ files: ['content.js'] })` call target the same page, creating a race in which `prepare_duplicate_form` / `fill_duplicate_form` messages can hit a content script that is still booting or that registered the message listener twice across reloads.

1.3 WHEN `extension/background.js` builds the duplicate URL via `getDuplicateUrl(copy_link)` THEN the function only accepts links that already contain `/duplicate` or that match `/portfolio/images/{id}`; valid Redbubble work links of the form `/people/{user}/works/{id}-{slug}` (the format users typically copy from their dashboard) throw `"copy_link must point to a Redbubble duplicate URL."` and the design is failed with a confusing error.

1.4 WHEN the duplicate page is opened THEN the extension does not append the user-requested `?auto=1` parameter, so the content script has no in-page signal that it was launched by the extension and cannot self-trigger or render the progress overlay before the background script's `fill_duplicate_form` message arrives.

1.5 WHEN `content.js` is processing a duplicate page that already has tags from the source work THEN `clearTagEditorRobust` does not always remove every existing tag chip before new tags are committed, so the published work can carry over old tags from the source design.

1.6 WHEN `content.js` looks for the rights-and-terms agreement checkbox THEN it falls back to `allCheckboxes[allCheckboxes.length - 1]`, which is brittle: if Redbubble adds or reorders any checkbox (mature content, newsletter, etc.) the wrong checkbox is ticked or the right one is skipped, leaving `#submit-work` disabled.

1.7 WHEN `waitForSuccess` in `content.js` polls the URL THEN the condition `!url.includes('/duplicate')` treats any navigation away from the duplicate page (including bfcache restores, the cache-buster reload, or a Redbubble error redirect) as success, which can mark a failed upload as `done`.

1.8 WHEN `waitForSuccess` registers a `beforeunload` handler THEN any unload (manual tab close, navigation back, Chrome bfcache eviction) sends `upload_result` with `status: "success"` for the current `design_id`, which can mark a non-completed upload as `done`.

1.9 WHEN the extension reports `upload_result` for a design THEN the backend `Design.status` and `Job.status` rows in `redbubble_automation.db` stay at their initial value (`pending` / `created`) because no API endpoint accepts a status update from the extension; the dashboard `QueueManager` only reflects in-memory extension state and loses the result on browser restart.

1.10 WHEN a Redbubble upload errors out (timeout, save button never enabled, validation error on the page) THEN the queue advances after at most one retry, but the `lastError` propagated to the popup and the dashboard does not include the URL, the design id, or the failure stage, making it hard to diagnose which step (image upload, metadata, agreement, save, success poll) actually failed.

1.11 WHEN `extension/popup.js` and the dashboard `QueueManager` render progress THEN they show only `Pending / Uploading / Done / Error` per row; there is no per-design progress log (image injected, metadata filled, save clicked, success detected) so a stuck upload cannot be distinguished from a slow one.

1.12 WHEN the queue tries to advance to the next design THEN `processNext` already has a guard, but because (1.7) and (1.8) can flip a failed design to `done` prematurely, the queue can move on while the previous Redbubble tab is still working, leading to interleaved tab navigations.

### Expected Behavior (Correct)

For every X satisfying C(X) the system SHALL behave as follows:

2.1 WHEN the user clicks Start Upload for a single design with a valid `copy_link` and a matched image THEN the system SHALL drive the Redbubble duplicate page through image upload, metadata fill, agreement check, and save click, then SHALL detect a `/studio/promote/{id}` redirect, SHALL mark the design `done` in the extension queue and the backend, and SHALL surface that result in both the popup and the dashboard.

2.2 WHEN `extension/background.js` opens the duplicate URL in a new tab THEN exactly one instance of `content.js` SHALL be active on that tab, regardless of whether the manifest auto-inject, the programmatic injection, or both fire.

2.3 WHEN `extension/background.js` builds the duplicate URL THEN the system SHALL accept Redbubble work links in the formats `https://www.redbubble.com/portfolio/images/{id}/duplicate`, `https://www.redbubble.com/portfolio/images/{id}` (with optional slug suffix), and `https://www.redbubble.com/people/{user}/works/{id}-{slug}`, and SHALL convert each into the canonical `/portfolio/images/{id}/duplicate` URL before navigation.

2.4 WHEN the extension navigates to the duplicate URL THEN it SHALL append `?auto=1` (preserving any other required query params) so `content.js` can detect that it is in automation mode and render its progress overlay immediately.

2.5 WHEN `content.js` is on a duplicate page with pre-existing tag chips THEN it SHALL clear every existing chip in both the main-tag and supporting-tags editors before committing the new tags, and SHALL verify the editors are empty before injecting new values.

2.6 WHEN `content.js` ticks the rights-and-terms agreement THEN it SHALL locate the checkbox by stable signals (input attributes such as `name`/`id` containing `rights`/`terms`/`agreement`, or the surrounding label text), and SHALL fail clearly with a named error if no such checkbox is found rather than ticking an arbitrary last checkbox.

2.7 WHEN `waitForSuccess` checks for a successful save THEN it SHALL only treat a navigation matching the regex `^https://www\.redbubble\.com/studio/promote/\d+` as success, and SHALL ignore bfcache restores, cache-buster reloads, and the duplicate page itself.

2.8 WHEN the page fires `beforeunload` THEN the system SHALL NOT report `success` solely on unload; the success signal SHALL only be sent after the `/studio/promote/{id}` URL has been observed.

2.9 WHEN the extension reports `upload_result` for a design THEN it SHALL call a backend endpoint that updates `Design.status` to `done` or `error` (with an error message) for the corresponding `design_id`, and the dashboard SHALL reflect this status on next poll.

2.10 WHEN a Redbubble upload errors out THEN the propagated error SHALL include the failure stage (`navigate`, `inject_image`, `wait_image_ready`, `fill_metadata`, `clear_tags`, `agreement`, `save_click`, `wait_success`) and a short reason, and SHALL be visible in the popup, dashboard, and backend record.

2.11 WHEN an upload is in progress THEN the popup and dashboard SHALL show a per-design progress log (at minimum: queued, navigating, image uploaded, metadata filled, save clicked, success or error) sourced from the extension's queue state.

2.12 WHEN the queue advances to the next design THEN the previous design's status SHALL be a terminal value (`done` or `error`) confirmed by either the `/studio/promote/{id}` redirect or an explicit failure stage; the queue SHALL NOT advance on `beforeunload` alone or on a generic non-duplicate URL.

### Unchanged Behavior (Regression Prevention)

3.1 WHEN the user uploads an Excel file with the existing `filename, title, description, main_tag, supporting_tags, copy_link` columns THEN the system SHALL CONTINUE TO parse the file via `excel_parser.parse_excel_designs` and persist designs through `/upload/excel` exactly as today, with no column additions, removals, or renames.

3.2 WHEN the user uploads images via `/upload/images` THEN the system SHALL CONTINUE TO save each image under `backend/uploads/images/{uuid}-{filename}` and SHALL CONTINUE TO serve them through `/api/image?path=...` with the existing absolute-path / bare-filename / uuid-prefixed lookup order.

3.3 WHEN the user creates a job via `/jobs/create` or lists jobs via `/jobs` THEN the system SHALL CONTINUE TO accept the existing `JobCreateIn` schema and return the existing `_job_to_dict` shape; the bugfix MAY add a new field for a per-design status update endpoint but SHALL NOT change the existing response shape.

3.4 WHEN the user opens the extension popup THEN the existing controls (search, filter, select-all, Upload (n), Refresh, Pause/Resume, Stop, Connect to dashboard) SHALL CONTINUE TO function with the same actions and IDs.

3.5 WHEN the user works in the TeePublic dashboard pages, the TeePublic import, the TeePublic queue, the login page, the reset-password page, the profile page, the sticker-color UI, the AI/trademark buttons, or any other non-Redbubble surface THEN those features SHALL CONTINUE TO behave exactly as today.

3.6 WHEN the user opens a Redbubble page that is not a duplicate page or the new-image page THEN `content.js` SHALL CONTINUE TO not interact with the page (the manifest's `matches` patterns SHALL remain limited to `*/duplicate*` and `*/new*`).

3.7 WHEN the user navigates to a `redbubble.com` URL outside of an active extension upload THEN the extension SHALL CONTINUE TO leave the page alone (no automatic form filling, no automatic save click, no automatic checkbox tick).

3.8 WHEN the user uploads a design whose `copy_link` is already in `/portfolio/images/{id}/duplicate` form THEN the system SHALL CONTINUE TO accept it without modification, preserving today's working path.

3.9 WHEN the existing dead Selenium code in `backend/app/services/redbubble_service.py` is not invoked from any route THEN it SHALL CONTINUE TO not be invoked; the bugfix SHALL NOT introduce a Selenium-driven path or change how Redbubble automation is delivered (it remains the Chrome extension).

3.10 WHEN the extension queue runs through multiple designs in a session THEN the existing sequential, one-at-a-time, retry-once-then-fail policy in `background.js` `processNext` SHALL CONTINUE TO apply, with the bugfix tightening only the success/error decision, not the queueing model.
