const fs = require('fs');

const targetFile = 'c:\\Users\\dynast\\Desktop\\chofi bntk\\my project autmation\\extension\\content-teepublic.js';

if (!fs.existsSync(targetFile)) {
  console.error("Target file does not exist.");
  process.exit(1);
}

let content = fs.readFileSync(targetFile, 'utf-8').replace(/\r\n/g, '\n');

// 1. Inject logSafeDiagnostics and __podpilotDebugTeePublicInputs below sleep utility
const sleepStr = '  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }';
const sleepIndex = content.indexOf(sleepStr);
if (sleepIndex === -1) {
  console.error("Could not find sleep utility marker.");
  process.exit(1);
}

const diagnosticsCode = `
  function logSafeDiagnostics() {
    try {
      const inputs = Array.from(document.querySelectorAll('input'));
      console.log(\`[TP Diagnostics] Total input elements found: \${inputs.length}\`);
      inputs.forEach((input, index) => {
        const isHidden = input.type === 'hidden' || window.getComputedStyle(input).display === 'none' || window.getComputedStyle(input).visibility === 'hidden';
        console.log(\`[TP Diagnostics] Input #\${index}: type="\${input.type || ''}" name="\${input.name || ''}" id="\${input.id || ''}" isHidden=\${isHidden}\`);
      });
      const hasUploadText = document.body.innerText.includes("Upload A Design");
      const hasDropText = document.body.innerText.includes("Drop one file here");
      console.log(\`[TP Diagnostics] Page contains "Upload A Design": \${hasUploadText}\`);
      console.log(\`[TP Diagnostics] Page contains "Drop one file here": \${hasDropText}\`);
      const safeUrl = location.href.replace(/(\\?|&)(Signature|AWSAccessKeyId|Expires)=[^&]+/g, '$1$2=REDACTED');
      console.log(\`[TP Diagnostics] Current Page URL: \${safeUrl}\`);
    } catch (e) {
      console.error(\`[TP Diagnostics] Failed to gather diagnostics:\`, e);
    }
  }
  window.__podpilotDebugTeePublicInputs = logSafeDiagnostics;
`;

// Insert diagnosticsCode right below sleepStr
content = content.slice(0, sleepIndex + sleepStr.length) + diagnosticsCode + content.slice(sleepIndex + sleepStr.length);

// 2. Re-implement getTpUploadReadyState
const readyStateStart = '  function getTpUploadReadyState() {';
const readyStateStartIndex = content.indexOf(readyStateStart);
if (readyStateStartIndex === -1) {
  console.error("Could not find getTpUploadReadyState start marker.");
  process.exit(1);
}

// Find the closing brace of getTpUploadReadyState (it ends with return { ... }; })
const readyStateEndToken = '    };\n  }';
const readyStateEndIndex = content.indexOf(readyStateEndToken, readyStateStartIndex);
if (readyStateEndIndex === -1) {
  console.error("Could not find getTpUploadReadyState end marker.");
  process.exit(1);
}

const newReadyStateCode = `  function getTpUploadReadyState() {
    const fileInputReady = Boolean(findTeePublicFileInput());
    const titleReady = Boolean(document.querySelector('input[name="design[design_title]"]'));
    const hasDropzoneText = document.body.innerText.includes("Upload A Design") || document.body.innerText.includes("Drop one file here");
    
    if (hasDropzoneText && !fileInputReady) {
      console.log("[TP Ready] dropzone visible but file input not found yet");
    }
    
    return {
      ok: true,
      page: 'teepublic',
      ready: fileInputReady || titleReady || hasDropzoneText,
      fileInputReady,
      titleReady,
    };
  }`;

content = content.slice(0, readyStateStartIndex) + newReadyStateCode + content.slice(readyStateEndIndex + readyStateEndToken.length);

// 3. Re-implement waitForTpUploadReady
const waitReadyStart = '  function waitForTpUploadReady(timeoutMs = 30000) {';
const waitReadyStartIndex = content.indexOf(waitReadyStart);
if (waitReadyStartIndex === -1) {
  console.error("Could not find waitForTpUploadReady start marker.");
  process.exit(1);
}

const waitReadyEndToken = '      observer.observe(document.documentElement || document.body, {\n        childList: true,\n        subtree: true,\n      });\n    });\n  }';
const waitReadyEndIndex = content.indexOf(waitReadyEndToken, waitReadyStartIndex);
if (waitReadyEndIndex === -1) {
  console.error("Could not find waitForTpUploadReady end marker.");
  process.exit(1);
}

const newWaitReadyCode = `  function waitForTpUploadReady(timeoutMs = 30000) {
    const initial = getTpUploadReadyState();
    if (initial.ready) {
      notifyTeePublicReady(initial);
      return Promise.resolve(initial);
    }

    return new Promise((resolve) => {
      let done = false;
      const observer = new MutationObserver(() => {
        const state = getTpUploadReadyState();
        if (state.ready) finish(state);
      });
      const timeout = setTimeout(() => {
        const state = getTpUploadReadyState();
        if (!state.ready) {
          logSafeDiagnostics();
        }
        finish(state);
      }, timeoutMs);

      function finish(state) {
        if (done) return;
        done = true;
        clearTimeout(timeout);
        observer.disconnect();
        notifyTeePublicReady(state);
        resolve(state);
      }

      observer.observe(document.documentElement || document.body, {
        childList: true,
        subtree: true,
      });
    });
  }`;

content = content.slice(0, waitReadyStartIndex) + newWaitReadyCode + content.slice(waitReadyEndIndex + waitReadyEndToken.length);

// 4. Re-implement uploadImage
const uploadImageStart = '  async function uploadImage(imageUrl) {';
const uploadImageStartIndex = content.indexOf(uploadImageStart);
if (uploadImageStartIndex === -1) {
  console.error("Could not find uploadImage start marker.");
  process.exit(1);
}

const uploadImageEndToken = '    if (!appeared) throw new Error(\'Image did not appear after upload (timeout)\');\n    debugLog(\'[PodPilot-TP] Image preview detected\');\n    return true;\n  }';
const uploadImageEndIndex = content.indexOf(uploadImageEndToken, uploadImageStartIndex);
if (uploadImageEndIndex === -1) {
  console.error("Could not find uploadImage end marker.");
  process.exit(1);
}

const newUploadImageCode = `  async function uploadImage(imageUrl) {
    updateOverlay('Uploading artwork...', 'Sending design file to TeePublic', 20);
    const batchState = loadTpBatchState();
    const batchDesignId = currentDesign ? getBatchDesignId(currentDesign, batchState?.currentIndex || 0) : '';
    if (batchState?.isProcessing && batchDesignId) {
      saveTpBatchState({
        ...batchState,
        imageInjectedForCurrentDesign: true,
        imageInjectedByDesignId: {
          ...(batchState.imageInjectedByDesignId || {}),
          [batchDesignId]: true,
        },
      });
    }
    
    const hasImageUrl = Boolean(currentDesign?.image_url);
    const hasThumbnailUrl = Boolean(currentDesign?.thumbnail_url);
    console.log(\`[TP Upload] current design id=\\\"\${currentDesign?.id || ''}\\" has image_url=\${hasImageUrl} has thumbnail_url=\${hasThumbnailUrl}\`);
    console.log('[TP Upload] image injection starting');

    let file;
    const conversionTimer = debugTimerStart("image blob/file conversion duration", {
      marketplace: "teepublic",
      source: imageUrl?.startsWith('data:') ? "base64" : "remote-blob",
    });
    
    if (imageUrl.startsWith('data:')) {
      const parts = imageUrl.split(',');
      const mime = parts[0].match(/:(.*?);/)?.[1] || 'image/png';
      const binary = atob(parts[1]);
      const arr = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) arr[i] = binary.charCodeAt(i);
      file = new File([arr], 'design.png', { type: mime });
    } else {
      console.log('[TP Upload] fetching image');
      const fetchTimer = debugTimerStart("image URL fetch duration", {
        marketplace: "teepublic",
        source: "content-remote-url",
      });
      let blob;
      try {
        const resp = await fetch(imageUrl);
        if (!resp.ok) {
          throw new Error(\`Image fetch failed: \${resp.status}\`);
        }
        blob = await resp.blob();
        console.log(\`[TP Upload] image fetched blobSize=\${blob.size} blobType=\${blob.type}\`);
        debugTimerEnd(fetchTimer, {
          ok: true,
          status: resp.status,
          mimeType: blob.type || 'image/png',
          bytes: blob.size,
        });
      } catch (fetchErr) {
        console.warn('[TP Upload] fetch failed (possible CORS), trying background fetch fallback', fetchErr);
        const bgResponse = await new Promise((resolve) => {
          chrome.runtime.sendMessage({
            action: 'fetchImageAsDataUrl',
            imageUrl: imageUrl
          }, (res) => {
            if (chrome.runtime.lastError) {
              resolve({ ok: false, error: chrome.runtime.lastError.message });
            } else {
              resolve(res);
            }
          });
        });
        if (bgResponse && bgResponse.ok && bgResponse.dataUrl) {
          console.log('[TP Upload] background fetch fallback succeeded');
          const parts = bgResponse.dataUrl.split(',');
          const mime = parts[0].match(/:(.*?);/)?.[1] || bgResponse.mimeType || 'image/png';
          const binary = atob(parts[1]);
          const arr = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) arr[i] = binary.charCodeAt(i);
          blob = new Blob([arr], { type: mime });
          console.log(\`[TP Upload] image fetched blobSize=\${blob.size} blobType=\${blob.type}\`);
        } else {
          debugTimerEnd(fetchTimer, { ok: false, error: bgResponse?.error || fetchErr?.message });
          throw new Error(\`Fallback fetch failed: \${bgResponse?.error || 'Unknown error'}\`);
        }
      }
      file = new File([blob], 'design.png', { type: blob.type || 'image/png' });
    }
    debugTimerEnd(conversionTimer, { bytes: file.size, mimeType: file.type });

    const pageReadyTimer = debugTimerStart("marketplace page ready duration", {
      marketplace: "teepublic",
    });
    const input = findTeePublicFileInput();
    debugTimerEnd(pageReadyTimer, { ok: Boolean(input) });
    debugLog('[PodPilot Timing] file input found', {
      marketplace: 'teepublic',
      ok: Boolean(input),
    });
    if (!input) throw new Error('File upload input not found on page');
    console.log('[TP Upload] file input found');

    const injectionTimer = debugTimerStart("image input injection duration", {
      marketplace: "teepublic",
      bytes: file.size,
      mimeType: file.type,
    });
    debugLog('[PodPilot-TP] Image injection started');
    await setStoredTpUploadState({
      active: true,
      stage: 'injecting_image',
      imageInjected: false,
      designId: currentDesign?.id || currentDesign?.design_id || '',
    });
    
    console.log('[TP Upload] assigning file to input');
    const dt = new DataTransfer();
    dt.items.add(file);
    input.files = dt.files;

    input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    input.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
    console.log('[TP Upload] change event dispatched');
    debugTimerEnd(injectionTimer, { filesAfter: input.files?.length || 0 });
    debugLog('[PodPilot Timing] file injected', {
      marketplace: 'teepublic',
      filesAfter: input.files?.length || 0,
    });

    // Check reaction after 3 seconds; fallback to drag/drop dropzone simulator if not accepted
    await sleep(3000);
    
    function isUploadAccepted() {
      const titleInput = document.querySelector('input[name="design[design_title]"]');
      const descInput = document.querySelector('textarea[name="design[design_description]"]');
      const hasPreview = document.querySelectorAll('.mutable-preview').length > 0;
      const hasProgress = document.querySelector('.progress, .upload-progress, [class*="progress"]');
      return Boolean(titleInput || descInput || hasPreview || hasProgress);
    }

    if (!isUploadAccepted()) {
      console.log('[TP Upload] Input assignment did not trigger upload within 3s. Trying dropzone drag/drop fallback.');
      const dropzone = findTeePublicDropzone();
      if (dropzone) {
        console.log('[TP Upload] Dropzone found, simulating drop event');
        simulateDrop(dropzone, file);
      } else {
        console.warn('[TP Upload] Dropzone not found for fallback.');
      }
    } else {
      console.log('[TP Upload] Upload reaction detected from input assignment');
    }

    await setStoredTpUploadState({
      active: true,
      stage: 'waiting_image_processing',
      imageInjected: true,
      designId: currentDesign?.id || currentDesign?.design_id || '',
    });
    debugLog('[PodPilot-TP] Image injected; navigation locked');

    debugLog('[PodPilot-TP] File dispatched, waiting for preview...');
    updateOverlay('Waiting for TeePublic image processing', 'TeePublic is preparing the uploaded artwork', 35);

    const processingTimer = debugTimerStart("marketplace image processing wait duration", {
      marketplace: "teepublic",
      timeoutMs: 300000,
    });
    const appeared = await waitForImagePreview();
    debugTimerEnd(processingTimer, { ok: Boolean(appeared) });
    debugLog('[PodPilot Timing] processing detected', {
      marketplace: 'teepublic',
      ok: Boolean(appeared),
    });
    if (!appeared) throw new Error('Image did not appear after upload (timeout)');
    debugLog('[PodPilot-TP] Image preview detected');
    return true;
  }`;

content = content.slice(0, uploadImageStartIndex) + newUploadImageCode + content.slice(uploadImageEndIndex + uploadImageEndToken.length);

// 5. Add tp_log_diagnostics to runtime message listener
const pingToken = "    if (message.action === 'ping') {\n      sendResponse({ ok: true, page: 'teepublic' });\n      return;\n    }";
const pingIndex = content.indexOf(pingToken);
if (pingIndex === -1) {
  console.error("Could not find message listener ping marker.");
  process.exit(1);
}

const diagnosticsMsgCode = `
    if (message.action === 'tp_log_diagnostics') {
      logSafeDiagnostics();
      sendResponse({ ok: true });
      return;
    }
`;

content = content.slice(0, pingIndex) + diagnosticsMsgCode + content.slice(pingIndex);

// Save with Windows CRLF endings back to file
fs.writeFileSync(targetFile, content.replace(/\n/g, '\r\n'), 'utf-8');
console.log("Successfully applied all custom logic and safeguards with Windows CRLF!");
