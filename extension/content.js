var DEBUG = false;
var debugLog = (...args) => {
  if (DEBUG) console.log(...args);
};
var debugWarn = (...args) => {
  if (DEBUG) console.warn(...args);
};
var debugTimingSeq = 0;
function debugTimerStart(label, details) {
  if (!DEBUG) return null;
  const id = ++debugTimingSeq;
  const name = `[PodPilot Timing ${id}] ${label}`;
  const startedAt = performance.now();
  console.time(name);
  if (details) console.log(`${name} start`, details);
  return { name, startedAt };
}
function debugTimerEnd(timer, details) {
  if (!DEBUG || !timer) return;
  const elapsedMs = performance.now() - timer.startedAt;
  console.timeEnd(timer.name);
  console.log(`${timer.name} end`, {
    elapsedMs: Number(elapsedMs.toFixed(1)),
    ...(details || {}),
  });
}

// ✅ CONTENT.JS INJECTED — proves this file reached the page
debugLog('✅ CONTENT.JS INJECTED — URL:', window.location.href);
debugLog('📄 document.readyState at injection time:', document.readyState);

(function registerContentScript() {
  // Guard against double-injection. The manifest's content_scripts entry is
  // the single injection path; this flag prevents accidental double execution
  // (e.g., if a future change introduces another injection route).
  if (window.__rbAutomationBooted) {
    debugLog('[PodPilot] content.js already booted on this page; exiting');
    return;
  }
  window.__rbAutomationBooted = true;

  // ─── Upload Progress card constants ──────────────────────────────────────
  // Declared up front (before the ?auto=1 boot block calls
  // setUploadOverlayStage) so the lookup is never in the temporal dead zone.
  // These two `const` blocks were previously declared further down and
  // produced "Cannot access 'STAGE_COPY' before initialization".
  const STAGE_COPY = {
    default:          { text: 'Preparing upload...',                sub: 'Getting ready',                                    percent: 5  },
    queued:           { text: 'Preparing upload...',                sub: 'Setting up Redbubble form',                       percent: 5  },
    navigate:         { text: 'Preparing upload...',                sub: 'Opening Redbubble duplicate page',                 percent: 10 },
    inject_image:     { text: 'Uploading image...',                 sub: 'Sending design file to Redbubble',                 percent: 25 },
    wait_image_ready: { text: 'Uploading image...',                 sub: 'Waiting for Redbubble image processing',           percent: 50 },
    fill_metadata:    { text: 'Filling design information...',     sub: 'Title, description, and tags',                     percent: 65 },
    clear_tags:       { text: 'Filling design information...',     sub: 'Replacing tags',                                   percent: 70 },
    agreement:        { text: 'Configuring products and colors...', sub: 'Confirming rights and terms',                      percent: 80 },
    save_click:       { text: 'Publishing design...',               sub: 'Submitting to Redbubble',                          percent: 90 },
    wait_success:     { text: 'Publishing design...',               sub: 'Waiting for Redbubble redirect',                   percent: 95 },
    done:             { text: 'Upload complete',                    sub: 'Redbubble has accepted the design',                percent: 100 }
  };

  // Local mirror of the queue + terminal state for the active tab. Used by
  // every render call so the card always reflects the latest snapshot.
  const overlayState = {
    text: 'Preparing upload...',
    sub: 'Setting up Redbubble form',
    percent: 0,
    designIndex: 0,    // 0-based; rendered as designIndex + 1 / queueTotal
    queueTotal: 0,
    queueStatus: 'running',
    terminal: null,    // null | 'success' | 'error'
    errorMessage: ''
  };

  // ─── Automation-mode gate ────────────────────────────────────────────────
  // ?auto=1 is appended by background.js when navigating the duplicate URL
  // for an extension-driven upload. We use this to render the overlay
  // immediately at boot so there is no flash before fill_duplicate_form
  // arrives. Manual page visits (no ?auto=1) MUST NOT auto-trigger any form
  // filling — the existing fill_duplicate_form handler is gated on the
  // background-sent message, so nothing here invokes automation by itself.
  const params = new URLSearchParams(window.location.search);
  const isAutomationMode = params.get("auto") === "1";
  if (isAutomationMode) {
    // Render the floating PodPilot Upload Progress card immediately so the
    // user sees something before fill_duplicate_form arrives. Seed copy and
    // pull initial queue counts asynchronously.
    setUploadOverlayStage('navigate', 'in_progress');
  }

  // ─── Late-boot completion check ─────────────────────────────────────────
  // The /studio/promote/{id} page is now in content_scripts.matches, but if
  // background already broadcast queue_complete BEFORE this content script
  // booted (the broadcast races with the redirect), the page still needs
  // to surface the modal and play the sound. Pull the queue's
  // lastCompletion summary on boot and, if it landed within the last 30s,
  // render the modal immediately. The window.__podpilotChaChingPlayed and
  // queueCompletionAlreadyShown guards stop us from double-firing if the
  // live broadcast also arrives.
  try {
    chrome.runtime.sendMessage({ action: 'get_status' }, (response) => {
      if (chrome.runtime.lastError) {
        void chrome.runtime.lastError;
        return;
      }
      const summary = response?.state?.lastCompletion;
      if (!summary || !summary.finishedAt) return;
      const ageMs = Date.now() - new Date(summary.finishedAt).getTime();
      if (Number.isFinite(ageMs) && ageMs >= 0 && ageMs < 30000) {
        try {
          showQueueCompletionModal(summary);
        } catch (err) {
          debugWarn('[PodPilot] late-boot queue_complete render failed:', err?.message || err);
        }
      }
    });
  } catch (_) { /* runtime not ready, ignore */ }

  // Listen for queue control (pause/resume/stop) from storage.
  try {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName === 'local' && changes.status) {
        overlayState.queueStatus = changes.status.newValue;
        if (isAutomationMode || getOverlayCard()) {
          renderOverlay();
        }
      }
    });
  } catch (_) { /* ignore */ }

  // ─── Timings ──────────────────────────────────────────────────────────────
  const FORM_WAIT_MS     = 15000;   // max wait for #work_title_en to appear
  const IMAGE_SETTLE_MS  = 3000;    // settle time after image injection
  const TAG_DELAY_MS     = 400;     // delay between each tag commit
  const RESULT_WAIT_MS   = 60000;   // max wait for URL change / success msg
  const SAVE_POLL_MS     = 30000;   // max wait for save button to be enabled

  // ─── Confirmed selectors ───────────────────────────────────────────────────
  const SEL_TITLE         = '#work_title_en';
  const SEL_DESC          = '#work_description_en';
  const SEL_FILE_INPUT    = '#select-image-base, #select-image-single, input[type="file"][accept*="image"]';
  const SEL_MAIN_TAG      = '#main-tag-en';
  const SEL_SUPPORT_TAGS  = '#supporting-tags-en';
  const SEL_SAVE_BTN      = 'button.submit';
  const SEL_APPLY_BTN     = 'button.rb-button.red.apply-changes';

  // ─── Utilities ────────────────────────────────────────────────────────────

  async function handlePause() {
    while (overlayState.queueStatus === 'paused') {
      await new Promise(r => setTimeout(r, 500));
      // Best effort backup check: poll background status in case storage changed
      try {
        const response = await new Promise(resolve => {
          chrome.runtime.sendMessage({ action: 'get_status' }, resolve);
        });
        if (response?.state?.status) {
          overlayState.queueStatus = response.state.status;
          renderOverlay();
        }
      } catch (_) {}
    }
    if (overlayState.queueStatus === 'idle') {
      throw new Error('Upload stopped by user');
    }
  }

  async function sleep(ms) {
    await handlePause();
    await new Promise(resolve => setTimeout(resolve, ms));
    await handlePause();
  }

  function waitForDocumentReady() {
    if (document.readyState === 'complete' || document.readyState === 'interactive') {
      return Promise.resolve();
    }
    return new Promise(resolve =>
      document.addEventListener('DOMContentLoaded', resolve, { once: true })
    );
  }

  /**
   * Poll until `document.querySelector(selector)` returns a visible element
   * or timeoutMs is exceeded.
   */
  function waitForEl(selector, timeoutMs = FORM_WAIT_MS) {
    return new Promise((resolve, reject) => {
      const start = Date.now();

      function check() {
        const el = document.querySelector(selector);
        if (el && isVisible(el)) { resolve(el); return; }
        if (Date.now() - start >= timeoutMs) {
          reject(new Error(`Timed out waiting for "${selector}" (${timeoutMs}ms)`));
          return;
        }
        setTimeout(check, 250);
      }

      check();
    });
  }

  function isVisible(el) {
    if (!el) return false;
    try {
      const s = window.getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return (
        s.display !== 'none' &&
        s.visibility !== 'hidden' &&
        parseFloat(s.opacity) > 0 &&
        r.width > 0 &&
        r.height > 0
      );
    } catch (_) { return false; }
  }

  /**
   * React-aware value setter for <input> and <textarea>.
   * Bypasses React's synthetic event diffing by calling the native setter.
   */
  function forceSetValue(el, value) {
    try {
      const proto = el.tagName === 'TEXTAREA'
        ? window.HTMLTextAreaElement.prototype
        : window.HTMLInputElement.prototype;
      const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;

      el.dispatchEvent(new Event('focus', { bubbles: true }));
      if (nativeSetter) {
        nativeSetter.call(el, value);
      } else {
        el.value = value;
      }
      el.dispatchEvent(new InputEvent('input',  { bubbles: true, data: value }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.dispatchEvent(new Event('blur',   { bubbles: true }));
    } catch (err) {
      // Fallback — plain assignment
      el.value = value;
      el.dispatchEvent(new Event('input',  { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }

  async function fillAllTags(mainTag, supportingTags) {
    const supportingTagList = String(supportingTags || '')
      .split(',')
      .map(t => t.trim())
      .filter(Boolean);
    const cleanMainTag = String(mainTag || '').trim();
    const cleanSupportingTags = supportingTagList
      .filter(tag => tag.toLowerCase() !== cleanMainTag.toLowerCase())
      .slice(0, 14);
    const allTags = [cleanMainTag, ...cleanSupportingTags].filter(Boolean);
    const tagString = allTags.join(', ');
    const hiddenInput = document.querySelector('#work_tag_editor_en');

    await replaceTagEditorTags(SEL_MAIN_TAG, cleanMainTag ? [cleanMainTag] : []);
    await replaceTagEditorTags(SEL_SUPPORT_TAGS, cleanSupportingTags);

    if (hiddenInput) {
      const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;

      if (nativeSetter) {
        nativeSetter.call(hiddenInput, tagString);
      } else {
        hiddenInput.value = tagString;
      }
      hiddenInput.dispatchEvent(new Event('input', { bubbles: true }));
      hiddenInput.dispatchEvent(new Event('change', { bubbles: true }));
    }
    await sleep(500);
    debugLog('Tags set:', tagString);
  }

  async function replaceTagEditorTags(selector, tags) {
    const editor = document.querySelector(selector);
    if (!editor) {
      debugWarn(`Tag editor ${selector} was not found.`);
      return;
    }

    await clearTagEditorRobust(editor);
    await sleep(200);

    if (tags.length === 0) {
      return;
    }

    editor.focus();
    editor.click();
    const tagText = tags.map(tag => `${tag},`).join(' ');
    editor.textContent = tagText;
    editor.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      inputType: 'insertText',
      data: tagText
    }));
    await sleep(250);
    editor.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Tab',
      code: 'Tab',
      keyCode: 9,
      which: 9,
      bubbles: true,
      cancelable: true
    }));
    editor.dispatchEvent(new KeyboardEvent('keyup', {
      key: 'Tab',
      code: 'Tab',
      keyCode: 9,
      which: 9,
      bubbles: true,
      cancelable: true
    }));
    editor.dispatchEvent(new Event('change', { bubbles: true }));
    editor.blur();
    await sleep(500);
  }

  function clearTagEditor(editor) {
    const container = editor.closest('.tag-editor, .tag-input, [class*="tag"], div') || editor.parentElement;
    const removeButtons = container
      ? Array.from(container.querySelectorAll('button, [role="button"], a')).filter(button => {
          const text = String(button.textContent || button.getAttribute('aria-label') || '').toLowerCase();
          return text.includes('remove') || text.includes('delete') || text.includes('x') || text === '×';
        })
      : [];

    for (const button of removeButtons.slice(0, 30)) {
      try {
        button.click();
      } catch (_) {
        // Continue clearing remaining buttons.
      }
    }

    editor.focus();
    editor.textContent = '';
    editor.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      inputType: 'deleteContent'
    }));
    editor.dispatchEvent(new Event('change', { bubbles: true }));
  }

  async function clearTagEditorRobust(editor) {
    const root = findTagEditorRoot(editor);

    for (let pass = 0; pass < 5; pass++) {
      const removeButtons = findTagRemoveButtons(root, editor);
      if (removeButtons.length === 0) break;

      for (const button of removeButtons.slice(0, 30)) {
        try {
          button.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
          button.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
          button.click();
        } catch (_) {
          // Keep trying the remaining chip buttons.
        }
      }
      await sleep(150);
    }

    editor.focus();
    editor.click();
    editor.textContent = '';
    editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward' }));

    for (let i = 0; i < 20; i++) {
      editor.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Backspace',
        code: 'Backspace',
        keyCode: 8,
        which: 8,
        bubbles: true,
        cancelable: true
      }));
      editor.dispatchEvent(new KeyboardEvent('keyup', {
        key: 'Backspace',
        code: 'Backspace',
        keyCode: 8,
        which: 8,
        bubbles: true,
        cancelable: true
      }));
      await sleep(20);
    }

    editor.dispatchEvent(new Event('input', { bubbles: true }));
    editor.dispatchEvent(new Event('change', { bubbles: true }));
    editor.blur();

    // Final assertion: count residual chips inside the editor's root. If any
    // remain after the 5-pass clear loop and the keyboard-fallback loop, run
    // ONE more removeButtons pass and re-count. If chips still remain, throw
    // a stage-tagged error so the FSM catch maps it to clear_tags.
    const residualSelector = '[class*="TagEditor_pill"], [class*="pill"], [class*="chip"]';
    let residual = root.querySelectorAll(residualSelector).length;
    if (residual > 0) {
      const removeButtons = findTagRemoveButtons(root, editor);
      for (const button of removeButtons.slice(0, 30)) {
        try {
          button.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
          button.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
          button.click();
        } catch (_) {
          // Keep trying the remaining chip buttons.
        }
      }
      await sleep(150);
      residual = root.querySelectorAll(residualSelector).length;
      if (residual > 0) {
        throw new Error('clear_tags: residual chips after 6 passes');
      }
    }
  }

  function findTagEditorRoot(editor) {
    let node = editor;
    for (let depth = 0; node && depth < 8; depth++) {
      const pillCount = node.querySelectorAll(
        '.app-ui-components-TagEditor-TagEditor_pill_1rpJO, [class*="TagEditor_pill"], [class*="tag"][class*="pill"], [class*="pill"], [class*="chip"]'
      ).length;
      const removeCount = node.querySelectorAll(
        '.app-ui-components-TagEditor-TagEditor_delete-button_1sUPN, [class*="TagEditor_delete"], [class*="delete"], [aria-label*="remove" i], [title*="remove" i]'
      ).length;

      if (pillCount > 0 || removeCount > 0) {
        return node;
      }
      node = node.parentElement;
    }

    return editor.parentElement || editor;
  }

  function findTagRemoveButtons(root, editor) {
    if (!root) return [];

    const direct = Array.from(root.querySelectorAll(
      '.app-ui-components-TagEditor-TagEditor_delete-button_1sUPN, [class*="TagEditor_delete"], [class*="delete-button"], [class*="delete"], [class*="remove"], [class*="close"], [aria-label*="remove" i], [title*="remove" i], button, [role="button"], a, span'
    ));

    const seen = new Set();
    return direct
      .map(el => el.closest('button, [role="button"], a, [class*="TagEditor_delete"], [class*="delete"], [class*="remove"], [class*="close"]') || el)
      .filter(el => {
        if (!el || seen.has(el) || el === editor || el.contains(editor)) return false;
        seen.add(el);

        const text = String(el.textContent || '').trim().toLowerCase();
        const aria = String(el.getAttribute('aria-label') || '').toLowerCase();
        const title = String(el.getAttribute('title') || '').toLowerCase();
        const className = String(el.className || '').toLowerCase();

        return (
          className.includes('delete') ||
          className.includes('remove') ||
          className.includes('close') ||
          aria.includes('remove') ||
          aria.includes('delete') ||
          title.includes('remove') ||
          title.includes('delete') ||
          text === 'x' ||
          text === '×' ||
          text === 'Ã—'
        );
      });
  }

  /**
   * Inject the design file into Redbubble's native #select-image-base input.
   *
   * This is a faithful port of MerchGhost's v(e) helper from
   * redbubble.9b402b2d.txt: capture the existing .preview img src BEFORE
   * injection, build a real File via fetch→Blob (or base64→Blob since
   * background.js already fetched the asset), assign DataTransfer.files,
   * fire a single "change" event, then return immediately. The wait loop
   * (waitForImageUploadComplete) is the next step and uses the captured
   * previousPreviewSrc to detect when Redbubble has finished its own
   * processing and swapped the preview img.
   *
   * No visible DOM is added — the File lives in JS memory and is handed
   * directly to the file input.
   */
  async function injectImageFile(base64Data, filename, mimeType) {
    const injectionTimer = debugTimerStart("image input injection duration", {
      marketplace: "redbubble",
      hasBase64: Boolean(base64Data),
      mimeType: mimeType || "image/png",
    });
    // Strict selector — exactly what MerchGhost uses. Don't fall back to a
    // generic input[type=file] because Redbubble has multiple file inputs
    // (sticker, base, etc.) and grabbing the wrong one corrupts uploads.
    const fileInput =
      document.querySelector('#select-image-base') ||
      document.querySelector(SEL_FILE_INPUT);
    if (!fileInput) {
      throw new Error(`inject_image: File input "#select-image-base" not found on page`);
    }

    // Capture the current preview src so waitForImageUploadComplete can
    // detect the moment Redbubble swaps it for the newly-uploaded design.
    const previewBefore = document.querySelector('.preview img');
    const previousSrc = previewBefore ? previewBefore.src : '';
    const previousSrcAttr = previewBefore ? previewBefore.getAttribute('src') : '';
    // Stash on the input so waitForImageUploadComplete can read it back.
    fileInput.__podpilotPrevSrc = previousSrc;
    fileInput.__podpilotPrevSrcAttr = previousSrcAttr;

    // Decode base64 → Blob → File. The File name uses the design's filename
    // (or a `${title}.png` fallback to match MerchGhost when filename is
    // missing) and the mime type Redbubble expects for art uploads.
    const conversionTimer = debugTimerStart("image blob/file conversion duration", {
      marketplace: "redbubble",
      mimeType: mimeType || "image/png",
      base64Length: base64Data ? base64Data.length : 0,
    });
    const safeName = (filename || 'design').toString();
    const safeMime = (mimeType || 'image/png').toString();
    const byteString = atob(base64Data);
    const ab = new ArrayBuffer(byteString.length);
    const ia = new Uint8Array(ab);
    for (let i = 0; i < byteString.length; i++) ia[i] = byteString.charCodeAt(i);
    const blob = new Blob([ab], { type: safeMime });
    const file = new File([blob], safeName, { type: safeMime, lastModified: Date.now() });
    debugTimerEnd(conversionTimer, { bytes: blob.size });

    // DataTransfer is the only mechanism that lets a script populate a
    // file input. Try the direct assignment first (works on most Chromiums)
    // and fall back to defineProperty when the input is non-writable.
    const dt = new DataTransfer();
    dt.items.add(file);
    try {
      fileInput.files = dt.files;
    } catch (_) {
      Object.defineProperty(fileInput, 'files', {
        value: dt.files,
        configurable: true
      });
    }

    // Single bubbling change event — same as MerchGhost. We do NOT dispatch
    // input/click/blur on the file input because Redbubble's React
    // listener only watches "change" and extra events can re-trigger the
    // file picker on some browsers.
    fileInput.dispatchEvent(new Event('change', { bubbles: true }));
    debugTimerEnd(injectionTimer, {
      bytes: blob.size,
      filesAfter: fileInput.files?.length || 0,
    });

    debugLog('[PodPilot] file injected via #select-image-base:', {
      name: safeName,
      mime: safeMime,
      bytes: blob.size,
      filesAfter: fileInput.files?.length || 0
    });
  }

  /**
   * Backwards-compat shim. Older callers (ensureImageSelected, debug paths)
   * pass an already-built File; route it through the same DataTransfer +
   * change flow as injectImageFile so behavior stays consistent.
   */
  async function injectFileObject(file) {
    const fileInput =
      document.querySelector('#select-image-base') ||
      document.querySelector(SEL_FILE_INPUT);
    if (!fileInput) {
      throw new Error(`inject_image: File input "#select-image-base" not found on page`);
    }
    const previewBefore = document.querySelector('.preview img');
    fileInput.__podpilotPrevSrc = previewBefore ? previewBefore.src : '';
    fileInput.__podpilotPrevSrcAttr = previewBefore ? previewBefore.getAttribute('src') : '';

    const dt = new DataTransfer();
    dt.items.add(file);
    try {
      fileInput.files = dt.files;
    } catch (_) {
      Object.defineProperty(fileInput, 'files', {
        value: dt.files,
        configurable: true
      });
    }
    fileInput.dispatchEvent(new Event('change', { bubbles: true }));
  }
  function getFileInput() {
    return document.querySelector('#select-image-base') ||
      document.querySelector(SEL_FILE_INPUT) ||
      document.querySelector('input[type="file"]');
  }

  function triggerFileInputEvents() {
    const fileInput = getFileInput();
    if (!fileInput) {
      throw new Error(`File input "${SEL_FILE_INPUT}" not found on page`);
    }

    fileInput.dispatchEvent(new Event('input', { bubbles: true }));
    fileInput.dispatchEvent(new Event('change', { bubbles: true }));
    return fileInput;
  }

  async function waitForFileInputHasFile(timeoutMs = 15000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const fileInput = getFileInput();
      if (fileInput?.files?.length > 0) {
        debugLog('Image file detected in file input:', fileInput.files[0].name);
        return fileInput;
      }
      await sleep(300);
    }

    throw new Error('Image injection failed: Redbubble file input is still empty.');
  }

  async function ensureImageSelected(imageBase64, imageName, imageMime) {
    if (imageBase64 && imageName && imageMime) {
      await injectImageFile(imageBase64, imageName, imageMime);
    } else {
      triggerFileInputEvents();
    }

    await waitForFileInputHasFile();
    await sleep(IMAGE_SETTLE_MS);
  }

  function getUploadStatusText() {
    return String(document.body?.innerText || document.body?.textContent || '')
      .replace(/\s+/g, ' ')
      .toLowerCase();
  }

  function hasActiveUploadIndicator() {
    const statusText = getUploadStatusText();
    const progressEls = Array.from(document.querySelectorAll('progress, [role="progressbar"]'))
      .filter(isVisible)
      .filter(el => {
        const value = Number(el.getAttribute('value') || el.getAttribute('aria-valuenow') || 0);
        return Number.isNaN(value) || value < 100;
      });
    const circleProgressEls = Array.from(document.querySelectorAll('.circle-progress, [class*="circle-progress" i]'))
      .filter(isVisible)
      .filter(el => {
        const value = Number(el.getAttribute('data-value') || 0);
        return value > 0 && value < 100;
      });
    return (
      progressEls.length > 0 ||
      circleProgressEls.length > 0 ||
      statusText.includes('processing image') ||
      statusText.includes('please wait')
    );
  }

  function hasUploadCompleteSignal() {
    const statusText = getUploadStatusText();
    const uploadBox = document.querySelector('.single-upload.with-uploader.has-image, .single-upload.has-image');
    const workUrl = uploadBox?.getAttribute('data-work-url') || '';
    const preview = document.querySelector(
      '.single-upload-preview, .preview img, img[src*="ih1.redbubble.net"], img[src^="blob:"], img[src^="data:image"]'
    );
    const completeProgress = Array.from(document.querySelectorAll('.circle-progress, [class*="circle-progress" i]'))
      .some(el => Number(el.getAttribute('data-value') || 0) >= 100);

    return (
      statusText.includes('upload complete') ||
      statusText.includes('upload completed') ||
      statusText.includes('100%') ||
      statusText.includes('replace image') ||
      completeProgress ||
      Boolean(workUrl) ||
      Boolean(uploadBox && preview)
    );
  }

  function getPreviewSignature() {
    const uploadBox = document.querySelector('.single-upload.with-uploader, .single-upload.has-image, .single-upload');
    const workUrl = uploadBox?.getAttribute('data-work-url') || '';
    const preview = document.querySelector(
      '.preview img, .single-upload-preview img, .single-upload-preview, img[src*="ih1.redbubble.net"], img[src^="blob:"], img[src^="data:image"]'
    );
    const src = preview?.currentSrc || preview?.src || preview?.getAttribute?.('src') || '';
    const styleImage = preview?.style?.backgroundImage || '';
    const dataUrl = preview?.getAttribute?.('data-work-url') || '';
    return [workUrl, src, styleImage, dataUrl].filter(Boolean).join('|');
  }

  function getUploadProgressValue() {
    const circle = Array.from(document.querySelectorAll('.circle-progress, [class*="circle-progress" i]'))
      .map(el => Number(el.getAttribute('data-value') || 0))
      .find(value => value > 0);
    if (Number.isFinite(circle)) return Math.min(100, Math.max(0, circle));

    const bar = Array.from(document.querySelectorAll('progress, [role="progressbar"]'))
      .map(el => Number(el.getAttribute('value') || el.getAttribute('aria-valuenow') || 0))
      .find(value => value > 0);
    if (Number.isFinite(bar)) return Math.min(100, Math.max(0, bar));

    return 0;
  }

  function scrollUploadAreaIntoView() {
    const uploadArea = document.querySelector('.single-upload.with-uploader, .single-upload, .duplicate-upload, .upload-work');
    if (uploadArea) {
      uploadArea.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  // ─── Upload Progress card ────────────────────────────────────────────────
  // Floating PodPilot-branded card shown on the duplicate page from the
  // moment background.js navigates here with ?auto=1 until the user clicks
  // Close on a terminal state. Stays visible across every FSM stage so the
  // user always sees a single source of truth for what the extension is
  // doing on this tab. STAGE_COPY and overlayState are declared at the top
  // of the IIFE so the boot-time setUploadOverlayStage('navigate', ...) call
  // does not hit the temporal dead zone.

  function getOverlayCard() {
    return document.getElementById('podpilot-upload-card');
  }

  function buildOverlayCard() {
    const overlay = document.createElement('div');
    overlay.id = 'podpilot-upload-card';
    overlay.setAttribute('role', 'status');
    overlay.style.cssText = [
      'position:fixed',
      'z-index:2147483647',
      'right:24px',
      'top:24px',
      'width:340px',
      'max-width:calc(100vw - 32px)',
      'padding:18px 18px 16px',
      'border-radius:14px',
      'background:#ffffff',
      'color:#0f172a',
      'box-shadow:0 18px 48px rgba(15,23,42,.18), 0 2px 6px rgba(15,23,42,.08)',
      'border:1px solid #e2e8f0',
      'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif',
      'font-size:13px',
      'pointer-events:auto',
      'transition:border-color .2s ease'
    ].join(';');

    let logoUrl = '';
    try { logoUrl = chrome.runtime.getURL('icons/icon48.png'); } catch (_) { /* ignore */ }

    overlay.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;">
        ${logoUrl ? `<img src="${logoUrl}" alt="PodPilot" style="width:28px;height:28px;border-radius:6px;">` : ''}
        <div style="font-weight:700;font-size:15px;color:#0f172a;letter-spacing:-0.01em;">Upload Progress</div>
      </div>

      <div data-pp-text style="font-weight:600;font-size:14px;color:#0f172a;line-height:1.35;margin-bottom:4px;">Preparing upload...</div>
      <div data-pp-sub style="font-size:12px;color:#64748b;line-height:1.4;margin-bottom:12px;">Setting up Redbubble form</div>

      <div style="height:8px;border-radius:999px;background:#e2e8f0;overflow:hidden;margin-bottom:10px;">
        <div data-pp-bar style="height:100%;width:0%;border-radius:999px;background:#7C3AED;transition:width .25s ease, background-color .2s ease;"></div>
      </div>

      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:12px;">
        <span data-pp-count style="font-size:12px;color:#475569;font-weight:500;">Design 1/1</span>
        <span data-pp-status style="font-size:12px;color:#7C3AED;font-weight:600;">Status: Running</span>
      </div>

      <div data-pp-controls style="display:flex;gap:8px;flex-wrap:wrap;">
        <button data-pp-pause type="button">Pause</button>
        <button data-pp-resume type="button" style="display:none;">Resume</button>
        <button data-pp-stop type="button">Stop</button>
        <button data-pp-close type="button" style="display:none;">Close</button>
      </div>
    `;

    // Style buttons inline so we don't need a popup.css change.
    const baseBtn =
      'flex:1 1 auto;min-width:72px;padding:8px 12px;border-radius:8px;font-size:12px;font-weight:600;' +
      'cursor:pointer;border:1px solid transparent;transition:opacity .2s ease, background-color .2s ease;';
    overlay.querySelector('[data-pp-pause]').style.cssText  = baseBtn + 'background:#f1f5f9;color:#0f172a;border-color:#cbd5e1;';
    overlay.querySelector('[data-pp-resume]').style.cssText = baseBtn + 'background:#7C3AED;color:#ffffff;border-color:#7C3AED;';
    overlay.querySelector('[data-pp-stop]').style.cssText   = baseBtn + 'background:#fef2f2;color:#b91c1c;border-color:#fecaca;';
    overlay.querySelector('[data-pp-close]').style.cssText  = baseBtn + 'background:#0f172a;color:#ffffff;border-color:#0f172a;';

    overlay.querySelector('[data-pp-pause]').addEventListener('click', () => sendQueueAction('pause_queue'));
    overlay.querySelector('[data-pp-resume]').addEventListener('click', () => sendQueueAction('resume_queue'));
    overlay.querySelector('[data-pp-stop]').addEventListener('click', () => {
      if (confirm('Stop the upload queue? Designs after this one will not run.')) {
        sendQueueAction('stop_queue');
      }
    });
    overlay.querySelector('[data-pp-close]').addEventListener('click', () => {
      overlay.remove();
    });

    document.documentElement.appendChild(overlay);
    return overlay;
  }

  function sendQueueAction(action) {
    try {
      chrome.runtime.sendMessage({ action }, () => {
        // Refresh the card so the status flips to Paused/Completed/etc.
        if (chrome.runtime.lastError) {
          debugWarn('[PodPilot] sendQueueAction error:', chrome.runtime.lastError.message);
        }
        refreshOverlayFromQueue();
      });
    } catch (err) {
      debugWarn('[PodPilot] sendQueueAction failed:', err?.message || err);
    }
  }

  function refreshOverlayFromQueue() {
    try {
      chrome.runtime.sendMessage({ action: 'get_status' }, (response) => {
        if (chrome.runtime.lastError || !response?.ok) return;
        const state = response.state || {};
        overlayState.queueTotal = Array.isArray(state.queue) ? state.queue.length : 0;
        overlayState.designIndex = Number.isInteger(state.currentIndex) ? state.currentIndex : 0;
        overlayState.queueStatus = state.status || 'running';
        renderOverlay();
      });
    } catch (_) { /* extension context may be invalidated; ignore */ }
  }

  function renderOverlay() {
    const overlay = getOverlayCard() || buildOverlayCard();

    const safePercent = Math.min(100, Math.max(0, Math.round(overlayState.percent)));
    overlay.querySelector('[data-pp-text]').textContent = overlayState.text;
    overlay.querySelector('[data-pp-sub]').textContent = overlayState.sub;
    const bar = overlay.querySelector('[data-pp-bar]');
    bar.style.width = `${safePercent}%`;

    const total = Math.max(1, overlayState.queueTotal || 1);
    const human = Math.min(total, (overlayState.designIndex || 0) + 1);
    overlay.querySelector('[data-pp-count]').textContent = `Design ${human}/${total}`;

    // Status line + terminal styling.
    const statusEl = overlay.querySelector('[data-pp-status]');
    let statusLabel = 'Running';
    let statusColor = '#7C3AED';
    let borderColor = '#e2e8f0';

    if (overlayState.terminal === 'success') {
      statusLabel = 'Completed';
      statusColor = '#7C3AED';
      borderColor = '#7C3AED';
      bar.style.backgroundColor = '#7C3AED';
    } else if (overlayState.terminal === 'error') {
      statusLabel = 'Failed';
      statusColor = '#dc2626';
      borderColor = '#dc2626';
      bar.style.backgroundColor = '#dc2626';
    } else if (overlayState.queueStatus === 'paused') {
      statusLabel = 'Paused';
      statusColor = '#d97706';
      borderColor = '#fbbf24';
    } else {
      bar.style.backgroundColor = '#7C3AED';
    }
    statusEl.textContent = `Status: ${statusLabel}`;
    statusEl.style.color = statusColor;
    overlay.style.borderColor = borderColor;

    // Pause / Resume / Stop / Close visibility.
    const pauseBtn = overlay.querySelector('[data-pp-pause]');
    const resumeBtn = overlay.querySelector('[data-pp-resume]');
    const stopBtn = overlay.querySelector('[data-pp-stop]');
    const closeBtn = overlay.querySelector('[data-pp-close]');

    const isTerminal = overlayState.terminal === 'success' || overlayState.terminal === 'error';
    pauseBtn.style.display = isTerminal ? 'none' : (overlayState.queueStatus === 'paused' ? 'none' : '');
    resumeBtn.style.display = isTerminal ? 'none' : (overlayState.queueStatus === 'paused' ? '' : 'none');
    stopBtn.style.display = isTerminal ? 'none' : '';
    closeBtn.style.display = isTerminal ? '' : 'none';
    closeBtn.style.flex = isTerminal ? '1 1 100%' : baseFlexFallback();

    // Render terminal final-state copy when applicable.
    if (overlayState.terminal === 'success') {
      const total = Math.max(1, overlayState.queueTotal || 1);
      const successRate = Math.round((1 / 1) * 100); // per-tab: this design succeeded
      overlay.querySelector('[data-pp-text]').textContent = 'Upload Complete!';
      overlay.querySelector('[data-pp-sub]').textContent =
        `1 of ${total === 1 ? 1 : 1} designs uploaded successfully · ${successRate}% Success Rate`;
    } else if (overlayState.terminal === 'error') {
      overlay.querySelector('[data-pp-text]').textContent = 'Upload Failed';
      overlay.querySelector('[data-pp-sub]').textContent =
        overlayState.errorMessage ? overlayState.errorMessage.slice(0, 200) : 'Redbubble rejected this design.';
    }
  }

  function baseFlexFallback() {
    // Tiny helper so the close button stretches when alone but the original
    // `flex:1 1 auto` is preserved in the multi-button row.
    return '1 1 auto';
  }

  /**
   * Public API used by every FSM emit point. Maps a stage+status pair to
   * friendly copy and a percent, then re-renders the card.
   */
  function setUploadOverlayStage(stage, status) {
    // Tolerate unknown stages and any unexpected boot ordering: fall back
    // to STAGE_COPY.default rather than throwing on an undefined key.
    const copy = STAGE_COPY?.[stage] || STAGE_COPY?.default || {
      text: 'Preparing upload...',
      sub: 'Getting ready',
      percent: 5
    };
    overlayState.text = copy.text;
    overlayState.sub = copy.sub;
    overlayState.percent = copy.percent;
    if (overlayState.terminal) return; // never overwrite a terminal card
    renderOverlay();
    refreshOverlayFromQueue();
  }

  function setUploadOverlayTerminal(kind, errorMessage = '') {
    overlayState.terminal = kind;
    overlayState.errorMessage = errorMessage || '';
    if (kind === 'success') overlayState.percent = 100;
    renderOverlay();
    refreshOverlayFromQueue();
  }

  /**
   * Backwards-compatible legacy helper. Older call sites pass a free-form
   * message and percent (e.g. inside waitForImageUploadComplete). Keep the
   * branded card by mapping those into the sub-text only — the main status
   * copy is driven by setUploadOverlayStage.
   */
  function showUploadOverlay(message, percent = 0) {
    if (!getOverlayCard()) buildOverlayCard();
    if (typeof message === 'string' && message.length) {
      overlayState.sub = message;
    }
    if (Number.isFinite(percent)) {
      overlayState.percent = Math.max(overlayState.percent, percent);
    }
    if (overlayState.terminal) return;
    renderOverlay();
  }

  function hideUploadOverlay(/* delayMs */) {
    // Card persists across stages until the user clicks Close on a terminal
    // state. Intentionally a no-op so transient hide calls (e.g., between
    // image upload and metadata fill) don't flash the UI.
  }

  // ─── Final queue-completion modal + sound ────────────────────────────────
  // Rendered exactly once when background.js broadcasts `queue_complete`.
  // The per-design progress card stays in place until the user dismisses it;
  // this modal sits on top to summarise the whole batch (X of Y, 100% rate).
  // The cha-ching.mp3 plays once per page lifetime — fail silently if the
  // browser blocks audio (autoplay policies, missing gesture, etc.).
  let queueCompletionAlreadyShown = false;

  function playCompletionSoundOnce() {
    if (window.__podpilotChaChingPlayed) return;
    window.__podpilotChaChingPlayed = true;
    try {
      const url = chrome.runtime.getURL('assets/cha-ching.mp3');
      const audio = new Audio(url);
      audio.volume = 0.7;
      const result = audio.play();
      if (result && typeof result.catch === 'function') {
        result.catch((err) => {
          // Autoplay blocked is expected on /studio/promote/{id} (the page
          // had no user gesture) — keep silent so the extension's error
          // panel doesn't light up. The popup channel is the reliable
          // fallback path. Anything OTHER than the autoplay-block is still
          // surfaced because it would point at a real bug.
          const name = err?.name || '';
          if (name === 'NotAllowedError' || name === 'AbortError') {
            debugLog('[PodPilot] cha-ching autoplay deferred (page channel)');
            // Allow a future user gesture on this page to retry once.
            window.__podpilotChaChingPlayed = false;
            armChaChingGestureRetry();
            return;
          }
          debugWarn('[PodPilot] cha-ching playback failed (page channel):', err?.message || err);
        });
      }
      debugLog('[PodPilot] sound played (page channel)');
    } catch (err) {
      debugWarn('[PodPilot] cha-ching load failed:', err?.message || err);
    }
  }

  /**
   * If autoplay was blocked, attach a one-shot user-gesture listener so the
   * very next click/keydown on the page replays the sound. Cheap and quiet.
   */
  function armChaChingGestureRetry() {
    if (window.__podpilotChaChingArmed) return;
    window.__podpilotChaChingArmed = true;
    const fire = () => {
      window.removeEventListener('click', fire, true);
      window.removeEventListener('keydown', fire, true);
      try {
        const url = chrome.runtime.getURL('assets/cha-ching.mp3');
        const audio = new Audio(url);
        audio.volume = 0.7;
        const r = audio.play();
        if (r && typeof r.catch === 'function') {
          r.catch(() => {/* still blocked — give up quietly */});
        }
        window.__podpilotChaChingPlayed = true;
        debugLog('[PodPilot] sound played (deferred page channel)');
      } catch (_) { /* ignore */ }
    };
    window.addEventListener('click', fire, true);
    window.addEventListener('keydown', fire, true);
  }

  function showQueueCompletionModal(summary) {
    if (queueCompletionAlreadyShown) return;
    queueCompletionAlreadyShown = true;
    debugLog('[PodPilot] success overlay shown:', summary);

    // 1. Remove the active progress card if it exists
    const progressCard = getOverlayCard();
    if (progressCard) {
      progressCard.remove();
    }

    // 2. Remove any prior completion overlay so we don't duplicate
    const existing = document.getElementById('podpilot-queue-complete-modal') ||
                     document.getElementById('podpilot-rb-completion-overlay');
    if (existing) {
      existing.remove();
    }

    const total = Number(summary?.total) || 0;
    const success = Number(summary?.success) || 0;
    const rate = total > 0 ? Math.round((success / total) * 100) : 0;
    const color = rate >= 80 ? '#7C3AED' : rate >= 50 ? '#f59e0b' : '#ef4444';

    const overlay = document.createElement('div');
    overlay.id = 'podpilot-rb-completion-overlay';
    overlay.style.cssText = [
      'position:fixed',
      'top:20px',
      'right:20px',
      'width:340px',
      'padding:20px',
      'background:#fff',
      'border-radius:10px',
      'box-shadow:0 4px 24px rgba(0,0,0,0.15)',
      'z-index:99999',
      'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif',
      'text-align:center',
      'color:#1a1a1a',
      'border:1px solid #e5e7eb',
      'pointer-events:auto'
    ].join(';');

    overlay.innerHTML = `
      <div style="font-size:40px;margin-bottom:8px;">${rate >= 80 ? '🎉' : rate >= 50 ? '⚠️' : '❌'}</div>
      <div style="font-size:18px;font-weight:700;color:${color};margin-bottom:6px;">Upload Complete!</div>
      <div style="font-size:14px;color:#374151;margin-bottom:6px;">${success} of ${total} designs uploaded successfully</div>
      <div style="font-size:13px;color:#666;margin-bottom:14px;">${rate}% Success Rate</div>
      <button id="pp-rb-completion-close" style="padding:8px 20px;background:${color};color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:14px;font-weight:600;">Close</button>
    `;

    document.documentElement.appendChild(overlay);

    overlay.querySelector('#pp-rb-completion-close').addEventListener('click', () => {
      overlay.remove();
    });
  }



  /**
   * Wait until Redbubble's native upload finishes, using the same signals
   * MerchGhost relies on so the page-native overlay (95% → upload complete)
   * has time to render. The first matching signal returns:
   *
   *   1. The .preview img src changed from `previousPreviewSrc` AND it is
   *      .complete (image fully loaded, not a data: placeholder).
   *   2. .circle-progress[data-value="100"] is present.
   *   3. #work_title_title is present and not disabled.
   *   4. No spinner/loading indicator visible AND the preview img exists.
   *
   * On success: a brief settle delay so React commits the new state before
   * metadata fill begins. On timeout: throw so the FSM emits
   * stage:"wait_image_ready" — the caller (prepareImageBeforeMetadata) tags
   * it.
   */
  async function waitForImageUploadComplete(previousPreviewSrc = '', timeoutMs = 90000) {
    const timer = debugTimerStart("marketplace image processing wait duration", {
      marketplace: "redbubble",
      timeoutMs,
    });
    const start = Date.now();

    while (Date.now() - start < timeoutMs) {
      // Signal 1: preview image src changed AND fully loaded.
      const preview = document.querySelector('.preview img');
      if (preview) {
        const src = preview.src || '';
        const srcAttr = preview.getAttribute('src') || '';
        const changed =
          (src && src !== previousPreviewSrc && !src.startsWith('data:image')) ||
          (srcAttr && srcAttr !== previousPreviewSrc && !srcAttr.startsWith('data:image'));
        if (changed && preview.complete) {
          showUploadOverlay('Image upload complete.', 100);
          await sleep(500);
          debugTimerEnd(timer, { ok: true, signal: "preview-src-changed" });
          return true;
        }
      }

      // Signal 2: circle-progress reports 100%.
      const circle100 = document.querySelector('.circle-progress[data-value="100"]');
      if (circle100) {
        showUploadOverlay('Image upload complete.', 100);
        await sleep(500);
        debugTimerEnd(timer, { ok: true, signal: "circle-progress-100" });
        return true;
      }

      // Signal 3: #work_title_title (Redbubble's enabled-when-ready hook) is
      // present and not disabled.
      const titleHook = document.querySelector('#work_title_title');
      if (titleHook && !titleHook.disabled) {
        showUploadOverlay('Image upload complete.', 100);
        await sleep(500);
        debugTimerEnd(timer, { ok: true, signal: "title-hook-enabled" });
        return true;
      }

      // Signal 4: no .spinner / .loading visible AND a preview img exists.
      // Match MerchGhost EXACTLY — they use the literal class names, no
      // wildcard. Wildcard selectors trip on unrelated elements (e.g.,
      // skeleton loaders elsewhere on the page) and cause premature exits.
      const spinner = document.querySelector('.spinner');
      const loading = document.querySelector('.loading');
      if (!spinner && !loading && preview) {
        showUploadOverlay('Image upload complete.', 100);
        await sleep(500);
        debugTimerEnd(timer, { ok: true, signal: "preview-no-spinner" });
        return true;
      }

      // Surface in-flight progress on the overlay so the user can see
      // Redbubble is working (matches MerchGhost's 95% feel).
      const inFlightCircle = document.querySelector('.circle-progress[data-value]');
      const inFlightValue = inFlightCircle
        ? Number(inFlightCircle.getAttribute('data-value')) || 0
        : 0;
      if (inFlightValue > 0 && inFlightValue < 100) {
        showUploadOverlay('Waiting for Redbubble image processing...', inFlightValue);
      } else {
        const estimated = Math.min(95, 25 + Math.floor((Date.now() - start) / 1200) * 5);
        showUploadOverlay('Waiting for Redbubble image processing...', estimated);
      }

      await sleep(250);
    }

    debugTimerEnd(timer, { ok: false, signal: "timeout" });
    throw new Error('Timed out waiting for Redbubble image upload to complete.');
  }

  async function prepareImageBeforeMetadata(imageBase64, imageName, imageMime) {
    // Capture the preview <img> src BEFORE we inject the new file so the
    // wait loop can detect the moment Redbubble swaps it for the new upload.
    const previewBefore = document.querySelector('.preview img');
    const previousPreviewSrc =
      previewBefore?.src ||
      previewBefore?.getAttribute?.('src') ||
      '';
    // No scroll: MerchGhost's v(e) injects in place and lets Redbubble's
    // own preview render wherever the user already is. Forcing a scroll
    // here pushes the visible viewport away from the form fields the user
    // is watching.

    if (imageBase64 && imageName && imageMime) {
      try {
        await injectImageFile(imageBase64, imageName, imageMime);
        // Brief settle so the change event lands and Redbubble starts
        // processing — do NOT fill title/tags here yet.
        await sleep(IMAGE_SETTLE_MS);
      } catch (error) {
        // Preserve the inject_image: prefix when injectFileObject already
        // tagged the throw; otherwise add it.
        const innerMessage = error?.message || String(error);
        if (innerMessage.startsWith('inject_image:')) {
          throw error;
        }
        throw new Error(`inject_image: ${innerMessage}`);
      }
    } else {
      throw new Error('inject_image: missing image data (extension queue must send imageBase64, imageName, and imageMime)');
    }

    try {
      await waitForImageUploadComplete(previousPreviewSrc);
    } catch (error) {
      hideUploadOverlay(0);
      // Tag the timeout so the FSM emits stage:"wait_image_ready" when none
      // of the four MerchGhost-style signals fired before the deadline.
      throw new Error(`wait_image_ready: ${error.message}`);
    }

    hideUploadOverlay();
    await sleep(700);
  }

  /**
   * Find the "Save work" submit input.
   * It is an <input type="submit">, NOT a <button>.
   */
  function getSaveButton() {
    // "Save work" is an INPUT not a BUTTON
    const byId = document.querySelector('#submit-work');
    if (byId) return byId;
    const byValue = document.querySelector('input[type="submit"][value="Save work"]');
    if (byValue) return byValue;
    const byName = document.querySelector('input[name="commit"]');
    if (byName) return byName;
    return null;
  }

  /**
   * Poll until "Save work" button is present and not disabled.
   */
  async function waitForSaveButton(timeoutMs = SAVE_POLL_MS) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const btn = getSaveButton();
      if (btn && !btn.disabled && isVisible(btn)) {
        return btn;
      }
      await sleep(1000);
    }
    return null;
  }

  /**
   * Robustly click an element with full mouse event sequence.
   */
  function clickElement(el) {
    el.scrollIntoView({ block: 'center', inline: 'center' });
    el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    el.dispatchEvent(new MouseEvent('mouseup',   { bubbles: true }));
    el.click();
  }

  function getElementTextAround(el) {
    const pieces = [];
    const labelParent = el.closest('label');
    if (labelParent) pieces.push(labelParent.textContent || '');

    if (el.id && window.CSS?.escape) {
      const labelFor = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (labelFor) pieces.push(labelFor.textContent || '');
    }

    const nearby = el.closest('div, section, fieldset, li, p');
    if (nearby) pieces.push(nearby.textContent || '');

    return pieces.join(' ').replace(/\s+/g, ' ').trim().toLowerCase();
  }

  function findAgreementCheckbox() {
    const directSelectors = [
      'input[type="checkbox"][name*="rights" i]',
      'input[type="checkbox"][id*="rights" i]',
      'input[type="checkbox"][name*="agreement" i]',
      'input[type="checkbox"][id*="agreement" i]',
      'input[type="checkbox"][name*="terms" i]',
      'input[type="checkbox"][id*="terms" i]',
      'div.rights-declaration input[type="checkbox"]'
    ];

    for (const selector of directSelectors) {
      const checkbox = document.querySelector(selector);
      if (checkbox) return checkbox;
    }

    const checkboxes = Array.from(document.querySelectorAll('input[type="checkbox"]'));
    return checkboxes.find(checkbox => {
      const text = getElementTextAround(checkbox);
      return (
        text.includes('i agree to the redbubble user agreement') ||
        text.includes('right to sell products containing this artwork') ||
        text.includes('featured company') ||
        text.includes('featured person') ||
        text.includes('words or images created by someone else')
      );
    }) || null;
  }

  async function checkAgreementCheckbox() {
    const agreeCheckbox = findAgreementCheckbox();
    if (!agreeCheckbox) {
      throw new Error('agreement: rights-and-terms checkbox not found');
    }
    if (!agreeCheckbox.checked) {
      agreeCheckbox.scrollIntoView({ behavior: 'smooth', block: 'center' });
      await sleep(800);
      agreeCheckbox.click();
      await sleep(500);
      debugLog('Agreement checkbox checked:', agreeCheckbox.checked);
    }
    return agreeCheckbox;
  }
  async function closeOpenOverlays() {
    const active = document.activeElement;
    if (active && typeof active.blur === 'function') {
      active.blur();
    }

    document.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Escape',
      code: 'Escape',
      keyCode: 27,
      which: 27,
      bubbles: true,
      cancelable: true
    }));
    await sleep(300);
    document.body.click();
    await sleep(300);
  }

  async function clickSaveWorkButton() {
    const saveBtn = document.querySelector('#submit-work') ||
      document.querySelector('input[name="commit"]') ||
      [...document.querySelectorAll('input[type="submit"]')].find(el => el.value === 'Save work');

    if (saveBtn) {
      saveBtn.scrollIntoView();
      await sleep(300);
      saveBtn.click();
      debugLog('Save work clicked');
    } else {
      throw new Error('Save work button not found');
    }
  }

  /**
   * Poll for success after clicking Save work.
   *
   * Success is signalled ONLY by a strict navigation match against
   * `^https://www.redbubble.com/studio/promote/(\d+)`. The capture group is
   * the Redbubble-assigned `redbubble_work_id`, which the caller forwards to
   * background.js / the backend.
   *
   * No `beforeunload` shortcut: tab close, back navigation, and bfcache
   * restores must NOT produce success. No `.congratulations` / `[class*=success]`
   * shortcut: those classes can appear on the duplicate page itself and would
   * fire false positives.
   *
   * Returns a structured outcome object so the caller (fillDuplicateFormAndSubmit)
   * sends exactly one terminal `upload_result` message:
   *   - { outcome: 'success', redbubble_work_id }
   *   - { outcome: 'error', error_message }
   *   - { outcome: 'timeout' }
   */
  // Strict success URL: only the Redbubble post-save redirect counts.
  const SUCCESS_RE = /^https:\/\/www\.redbubble\.com\/studio\/promote\/(\d+)/;

  async function waitForSuccess(designId, timeoutMs = 60000) {
    const start = Date.now();

    while (Date.now() - start < timeoutMs) {
      // Success: strict /studio/promote/{id} match. Capture group 1 is the
      // redbubble_work_id we forward to the backend.
      const m = window.location.href.match(SUCCESS_RE);
      if (m) {
        const redbubble_work_id = m[1];
        debugLog('✅ Success detected. work_id:', redbubble_work_id);
        return { outcome: 'success', redbubble_work_id };
      }

      // Error indicator (Redbubble validation banner).
      // Require a non-trivial message (>= 4 chars) so we don't trip on
      // transient empty banners on a busy duplicate page.
      const errorEl = document.querySelector(
        '[role="alert"], .error, .errors, .field_with_errors, [class*="error" i]'
      );
      if (errorEl && isVisible(errorEl)) {
        const msg = (errorEl.innerText || '').trim().slice(0, 300);
        if (msg.length >= 4) {
          debugLog('❌ Error detected:', msg);
          return { outcome: 'error', error_message: msg };
        }
      }

      await sleep(500);
    }

    return { outcome: 'timeout' };
  }

  // ─── Debug helper ─────────────────────────────────────────────────────────

  function debugDOM(label) {
    if (!DEBUG) return;
    debugLog(`\n=== REDBUBBLE DOM DEBUG [${label}] ===`);
    debugLog('URL:', window.location.href);
    debugLog('readyState:', document.readyState);

    debugLog('\n--- ALL INPUTS ---');
    debugLog([...document.querySelectorAll('input')].map(el => ({
      id:          el.id,
      name:        el.name,
      type:        el.type,
      placeholder: el.placeholder,
      class:       el.className.slice(0, 60),
      value:       String(el.value || '').slice(0, 80),
      visible:     isVisible(el)
    })));

    debugLog('\n--- ALL TEXTAREAS ---');
    debugLog([...document.querySelectorAll('textarea')].map(el => ({
      id:          el.id,
      name:        el.name,
      placeholder: el.placeholder,
      class:       el.className.slice(0, 60),
      value:       String(el.value || '').slice(0, 80),
      visible:     isVisible(el)
    })));

    debugLog('\n--- ALL BUTTONS ---');
    debugLog([...document.querySelectorAll('button')].map(el => ({
      text:     el.innerText.trim().slice(0, 60),
      type:     el.type,
      class:    el.className.slice(0, 60),
      disabled: el.disabled,
      visible:  isVisible(el)
    })));

    debugLog('\n--- CONTENTEDITABLE ELEMENTS ---');
    debugLog([...document.querySelectorAll('[contenteditable]')].map(el => ({
      tag:         el.tagName,
      id:          el.id,
      class:       el.className.slice(0, 60),
      ariaLabel:   el.getAttribute('aria-label'),
      placeholder: el.getAttribute('placeholder'),
      text:        el.innerText.slice(0, 80),
      visible:     isVisible(el)
    })));

    // Confirm exact IDs exist
    debugLog('\n--- KEY ELEMENT CHECK ---');
    debugLog({
      '#work_title_en':       !!document.querySelector('#work_title_en'),
      '#work_description_en': !!document.querySelector('#work_description_en'),
      '#select-image-base':   !!document.querySelector('#select-image-base'),
      '#select-image-single': !!document.querySelector('#select-image-single'),
      '#main-tag-en':         !!document.querySelector('#main-tag-en'),
      '#supporting-tags-en':  !!document.querySelector('#supporting-tags-en'),
      '#work_tag_editor_en':  !!document.querySelector('#work_tag_editor_en'),
      'button.submit':        !!document.querySelector('button.submit'),
      'button.apply-changes': !!document.querySelector('button.rb-button.red.apply-changes')
    });

    debugLog(`=== END DEBUG [${label}] ===\n`);
  }

  /**
   * Audit helper — logs every PodPilot-owned DOM node so we can confirm we
   * never inject a visible design image into the page. Called once on load
   * and after upload completes. The Upload Progress card and the success
   * modal are the ONLY DOM additions PodPilot makes; nothing else (no
   * preview <img>, no helper canvas, no debug node) should ever appear.
   */
  function auditPodPilotDom(label) {
    const ids = ['podpilot-upload-card', 'podpilot-queue-complete-modal'];
    const owned = ids.map((id) => ({
      id,
      present: Boolean(document.getElementById(id))
    }));
    const strayImgs = Array.from(document.querySelectorAll('img'))
      .filter((img) => {
        // An image we added would live inside one of our containers.
        const inOurs = ids.some((id) => {
          const root = document.getElementById(id);
          return root && root.contains(img);
        });
        // We only log non-PodPilot images for visibility — we do NOT touch
        // Redbubble's native preview <img>, just want to confirm we never
        // duplicate it. inOurs === true means it's one of our icons.
        return inOurs;
      });
    debugLog(`[PodPilot] DOM audit [${label}]`, { owned, podPilotImageCount: strayImgs.length });
  }

  // ─── FSM stage emit helper ────────────────────────────────────────────────
  // Emits stage_update messages to background.js so the per-design
  // progressLog can be appended and broadcast to the popup. Wrapped in
  // try/catch because chrome.runtime.sendMessage can throw if the extension
  // context is invalidated (e.g., during reload).
  function emitStage(designId, stage, status, extra) {
    // Drive the on-page Upload Progress card alongside the message bus so
    // the user sees stage transitions without depending on the popup.
    try {
      setUploadOverlayStage(stage, status);
    } catch (err) {
      // Overlay is best-effort; never break the FSM if the DOM hiccups.
      debugWarn('setUploadOverlayStage failed:', err?.message || err);
    }
    try {
      const payload = {
        action: 'stage_update',
        design_id: designId,
        stage,
        status
      };
      if (extra && typeof extra === 'object') {
        Object.assign(payload, extra);
      }
      // No-op callback suppresses the MV3 promise rejection that fires when
      // the receiver disappears mid-run (extension reload, popup closed
      // during a broadcast). The runtime listener in background.js is the
      // primary receiver — when it isn't there we just want to drop the
      // message quietly.
      chrome.runtime.sendMessage(payload, () => {
        void chrome.runtime.lastError;
      });
    } catch (err) {
      debugWarn('emitStage failed:', err?.message || err);
    }
  }

  // ─── Main fill flow ────────────────────────────────────────────────────────

  async function fillDuplicateFormAndSubmit(design, imageBase64, imageName, imageMime) {
    const title          = String(design?.title          || '').trim();
    const description    = String(design?.description    || '').trim();
    const mainTag        = String(design?.main_tag        || '').trim();
    const supportingTags = String(design?.supporting_tags || '').trim();
    const designId       = String(design?.design_id || design?.id || design?.filename || Date.now());

    // FSM stage tracking. The catch block at the bottom uses currentStage to
    // tag the upload_result error message so background.js (and the popup)
    // can show which stage failed.
    let currentStage = 'queued';
    emitStage(designId, 'queued', 'in_progress');

    // navigate stage already happened in background.js (waitForContentScriptReady).
    // By the time fill_duplicate_form arrives, navigation has succeeded — emit
    // navigate:done immediately so the FSM trace is complete on the popup side.
    currentStage = 'navigate';
    emitStage(designId, 'navigate', 'done');

    debugLog('🚀 fillDuplicateFormAndSubmit — design_id:', designId);
    debugDOM('FILL_START');

    try {
      // Step 1: Wait for title input to be visible (max 15 s)
      debugLog('⏳ Waiting for #work_title_en...');
      const pageReadyTimer = debugTimerStart("marketplace page ready duration", {
        marketplace: "redbubble",
      });
      await waitForDocumentReady();
      const titleEl = await waitForEl(SEL_TITLE, FORM_WAIT_MS);
      debugTimerEnd(pageReadyTimer, { ok: true });

      // inject_image + wait_image_ready stages — bundled in
      // prepareImageBeforeMetadata. Emit bookend stages around the call so
      // we don't have to alter the existing function body.
      currentStage = 'inject_image';
      emitStage(designId, 'inject_image', 'in_progress');
      debugLog('Waiting for image upload to complete before filling metadata...');
      await prepareImageBeforeMetadata(imageBase64, imageName, imageMime);
      currentStage = 'wait_image_ready';
      emitStage(designId, 'wait_image_ready', 'done');
      debugLog('✅ #work_title_en found');

      // fill_metadata stage wraps the title and description writes.
      currentStage = 'fill_metadata';
      emitStage(designId, 'fill_metadata', 'in_progress');
      const metadataTimer = debugTimerStart("metadata fill duration", {
        marketplace: "redbubble",
        designId,
      });

      // Step 2: Fill title
      debugLog('✏️ Filling title:', title);
      const activeTitleEl = document.querySelector(SEL_TITLE) ||
        document.querySelector('.add-work-details__input--title') ||
        titleEl;
      forceSetValue(activeTitleEl, '');
      await sleep(100);
      forceSetValue(activeTitleEl, title);
      await sleep(300);

      // Verify the React-controlled title input committed the value. A 100ms
      // sleep gives React a chance to flush state before we read .value back.
      await sleep(100);
      if (activeTitleEl.value !== title) {
        throw new Error('fill_metadata: title input did not commit value');
      }

      // Step 3: Fill description
      debugLog('✏️ Filling description...');
      const descEl = document.querySelector(SEL_DESC) ||
        document.querySelector('.add-work-details__input--description');
      if (!descEl) throw new Error("fill_metadata: " + SEL_DESC + " not found on page");
      forceSetValue(descEl, '');
      await sleep(100);
      forceSetValue(descEl, description);
      await sleep(300);

      // Same post-write commit check for description.
      await sleep(100);
      if (descEl.value !== description) {
        throw new Error('fill_metadata: description input did not commit value');
      }

      debugTimerEnd(metadataTimer, { ok: true });
      emitStage(designId, 'fill_metadata', 'done');

      // clear_tags stage wraps the entire fillAllTags call (which internally
      // clears chips and writes new tags). Task 6 will tighten this further.
      currentStage = 'clear_tags';
      emitStage(designId, 'clear_tags', 'in_progress');

      // Step 4: Fill tags without Enter so autocomplete cannot trap the last tag.
      debugLog('Setting tags:', mainTag, supportingTags);
      await fillAllTags(mainTag, supportingTags);

      debugLog('Closing autocomplete dropdown...');
      const titleElAfterTags = document.querySelector('#work_title_en');
      if (titleElAfterTags) {
        titleElAfterTags.click();
        titleElAfterTags.focus();
        await sleep(500);
      }

      for (let i = 0; i < 3; i++) {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true }));
        await sleep(200);
      }

      document.body.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      await sleep(500);

      const dropdown = document.querySelector('[class*="suggestion"], [class*="autocomplete"], [class*="dropdown"]');
      debugLog('Dropdown still visible:', !!dropdown);

      // Removed the page-bottom auto-scroll: the agreement checkbox and the
      // save button each do their own scrollIntoView right before being
      // clicked, so the user's viewport stays where they put it. A short
      // settle keeps the original timing budget intact.
      await sleep(500);

      emitStage(designId, 'clear_tags', 'done');

      debugDOM('AFTER_FILL');

      // agreement stage wraps the legal-agreement checkbox click block.
      currentStage = 'agreement';
      emitStage(designId, 'agreement', 'in_progress');

      // Step 7: Check the legal agreement checkbox.
      // Strict-signal lookup only — no "last checkbox" fallback. If
      // findAgreementCheckbox cannot locate the rights-and-terms checkbox by
      // input attributes (name/id containing rights/terms/agreement) or
      // surrounding label text, throw a stage-tagged error so the outer FSM
      // catch maps it to stage:"agreement" instead of silently ticking an
      // arbitrary checkbox.
      const agreeCheckbox = findAgreementCheckbox();
      if (!agreeCheckbox) {
        throw new Error('agreement: rights-and-terms checkbox not found');
      }
      if (!agreeCheckbox.checked) {
        // Only scroll the checkbox into view if it's not already visible.
        // This avoids unnecessary viewport jumps the user complained about.
        const rect = agreeCheckbox.getBoundingClientRect();
        const inView = rect.top >= 0 && rect.bottom <= (window.innerHeight || document.documentElement.clientHeight);
        if (!inView) {
          agreeCheckbox.scrollIntoView({ block: 'center' });
        }
        await sleep(500);
        agreeCheckbox.click();
        await sleep(500);
        debugLog('Agreement checkbox checked:', agreeCheckbox.checked);
      }

      emitStage(designId, 'agreement', 'done');

      // save_click stage wraps the Save work button click.
      currentStage = 'save_click';
      emitStage(designId, 'save_click', 'in_progress');
      const saveTimer = debugTimerStart("final save click duration", {
        marketplace: "redbubble",
        designId,
      });

      // Step 8: Click Save work.
      // Use the existing waitForSaveButton poll so we only click when the
      // submit input is present, visible, and not disabled. If the button
      // is missing or stays disabled past SAVE_POLL_MS, throw a stage-tagged
      // error so the outer FSM catch maps it to stage:"save_click".
      const saveBtn = await waitForSaveButton(SAVE_POLL_MS);
      if (!saveBtn) {
        throw new Error('save_click: save button missing or disabled after 30s');
      }
      // Only scroll the save button into view if it's not already visible —
      // keep the user's viewport stable when the button is on screen.
      const saveRect = saveBtn.getBoundingClientRect();
      const saveInView = saveRect.top >= 0 && saveRect.bottom <= (window.innerHeight || document.documentElement.clientHeight);
      if (!saveInView) {
        saveBtn.scrollIntoView({ block: 'center' });
      }
      await sleep(300);
      saveBtn.click();
      debugLog('Save work clicked');
      debugTimerEnd(saveTimer, { ok: true });

      emitStage(designId, 'save_click', 'done');

      // wait_success stage wraps waitForSuccess.
      currentStage = 'wait_success';
      emitStage(designId, 'wait_success', 'in_progress');

      debugLog('Waiting for success redirect...');
      const outcome = await waitForSuccess(designId, RESULT_WAIT_MS);

      let status = 'success';
      let errorMsg = '';
      let redbubbleWorkId = '';
      if (outcome.outcome === 'timeout') {
        status = 'error';
        errorMsg = 'Timed out waiting for Redbubble save result';
      } else if (outcome.outcome === 'error') {
        status = 'error';
        errorMsg = outcome.error_message || 'Unknown error';
      } else if (outcome.outcome === 'success') {
        redbubbleWorkId = outcome.redbubble_work_id || '';
      }

      if (status === 'success') {
        emitStage(designId, 'wait_success', 'done');
        // Flip the on-page card into its terminal "Upload Complete!" state.
        try { setUploadOverlayTerminal('success'); } catch (_) { /* best-effort */ }
      } else {
        try { setUploadOverlayTerminal('error', errorMsg); } catch (_) { /* best-effort */ }
      }

      debugLog('📤 Upload result:', status, errorMsg, redbubbleWorkId);
      chrome.runtime.sendMessage(
        {
          action:    'upload_result',
          status,
          design_id: designId,
          stage:     status === 'error' ? currentStage : undefined,
          error_message: status === 'error' ? errorMsg : '',
          error:     errorMsg,
          redbubble_work_id: status === 'success' ? redbubbleWorkId : undefined
        },
        () => { void chrome.runtime.lastError; }
      );
      return {
        status,
        error: errorMsg,
        stage: status === 'error' ? currentStage : undefined,
        redbubble_work_id: status === 'success' ? redbubbleWorkId : undefined
      };
    } catch (err) {
      // Tag the failure with the stage we were in when the throw happened so
      // the popup/dashboard can show "stage:'fill_metadata' — <message>".
      const errorMessage = err?.message || String(err);

      // prepareImageBeforeMetadata bundles inject_image and wait_image_ready
      // into a single call, so the bookend currentStage doesn't always match
      // which half threw. Re-tag from the explicit message prefix when the
      // error carries one — that way the FSM stage label always matches the
      // actual failing stage.
      if (errorMessage.startsWith('inject_image:')) {
        currentStage = 'inject_image';
      } else if (errorMessage.startsWith('wait_image_ready:')) {
        currentStage = 'wait_image_ready';
      }

      console.error(`❌ stage "${currentStage}" failed:`, err);
      try { setUploadOverlayTerminal('error', errorMessage); } catch (_) { /* best-effort */ }
      try {
        chrome.runtime.sendMessage(
          {
            action: 'upload_result',
            design_id: designId,
            status: 'error',
            stage: currentStage,
            error_message: errorMessage,
            error: errorMessage
          },
          () => { void chrome.runtime.lastError; }
        );
      } catch (sendErr) {
        debugWarn('Failed to send upload_result:', sendErr?.message || sendErr);
      }
      throw err;
    }
  }

  // ─── Message listener ──────────────────────────────────────────────────────

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || typeof message.action !== 'string') return false;

    // Lightweight readiness probe used by background.js's
    // waitForContentScriptReady. Respond synchronously with a truthy payload
    // so the polling loop on the service-worker side can resolve.
    if (message.action === 'ping') {
      sendResponse({ ok: true });
      return false;
    }

    if (message.action === 'queue_complete') {
      // Background broadcasts this exactly once when the whole queue drains.
      // Render the green Upload Complete! modal and play cha-ching.mp3.
      try {
        showQueueCompletionModal(message.summary || {});
      } catch (err) {
        debugWarn('[PodPilot] queue_complete render failed:', err?.message || err);
      }
      sendResponse({ ok: true });
      return false;
    }

    if (message.action === 'device_session_revoked') {
      overlayState.queueStatus = 'idle';
      try {
        setUploadOverlayTerminal(
          'error',
          message.message || 'This upload session was disconnected because upload control was switched to another device.'
        );
      } catch (_) { /* overlay may not be mounted */ }
      sendResponse({ ok: true });
      return false;
    }

    if (message.action === 'fill_duplicate_form') {
      debugLog('📨 fill_duplicate_form message received');
      debugDOM('MESSAGE_RECEIVED');

      fillDuplicateFormAndSubmit(
        message.design,
        message.imageBase64 || null,
        message.imageName   || null,
        message.imageMime   || null
      )
        .then(result => sendResponse({ ok: true, ...result }))
        .catch(err => {
          // fillDuplicateFormAndSubmit's inner catch already sent an
          // upload_result tagged with the failing stage. Don't double-send;
          // just resolve the message channel for the background script.
          console.error('❌ fillDuplicateFormAndSubmit failed:', err);
          sendResponse({ ok: false, error: err.message });
        });

      return true; // keep message channel open for async response
    }

    // Legacy: prepare_duplicate_form (just signals ready)
    if (message.action === 'prepare_duplicate_form') {
      waitForEl(SEL_TITLE, FORM_WAIT_MS)
        .then(() => sendResponse({ ok: true }))
        .catch(err => sendResponse({ ok: false, error: err.message }));
      return true;
    }

    return false;
  });

  // ─── Run debug snapshots on load ──────────────────────────────────────────

  function runLoadDebug() {
    debugDOM('PAGE_LOAD');
    auditPodPilotDom('PAGE_LOAD');
    setTimeout(() => debugDOM('PAGE_LOAD+3s'), 3000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', runLoadDebug, { once: true });
  } else {
    runLoadDebug();
  }

})();
