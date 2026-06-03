var DEBUG = false;
var debugLog = (...args) => {
  if (DEBUG) console.log(...args);
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

// ─── PodPilot background service worker ───────────────────────────────────────
// MV3 service workers can't use ES modules, so we ship auth.js as a plain
// script and import it via importScripts(). The auth helpers expose
// PodPilotAuth on `self`, which we use here to make authenticated calls
// against the PodPilot backend.
try {
  importScripts("auth.js");
} catch (error) {
  console.error("[PodPilot] auth.js failed to load:", error);
}

const QUEUE_DELAY_MS = 3000;
const CONTENT_RESPONSE_TIMEOUT_MS = 180000;
const TAB_LOAD_TIMEOUT_MS = 60000;
const ALLOWED_EXTERNAL_ORIGINS = new Set([
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "https://podpilot.space",
  "https://www.podpilot.space",
]);
const DEFAULT_STATE = {
  designsLibrary: [],
  queue: [],
  currentIndex: 0,
  status: "idle",
  marketplace: "redbubble",
  uploadTabId: null,
  uploadTabMarketplace: "",
  lastError: "",
  updatedAt: null,
  currentJobId: "",
  completionNotifiedJobId: "",
  completedDesignIds: {},
  failedDesignIds: {},
  terminalHandled: {},
  processingDesignId: null,
  currentDesignId: null,
  processingStartedForCurrentDesign: false,
  imageInjectedForCurrentDesign: false,
  hasNavigatedForCurrentDesign: false,
  successCount: 0,
  failedCount: 0
};

const DEFAULT_UPLOAD_SETTINGS = {
  runUploadsInBackground: true,
};

const STORAGE_KEY_PROGRESS = "progressLog";
const BG_PLATFORM_ACCESS_STORAGE_KEY = "podpilot_platform_access";
const progressLogStore = (chrome.storage && chrome.storage.session) ? chrome.storage.session : chrome.storage.local;

let isProcessing = false;
let resultWaiter = null;
let queueCompletionFired = false;
let lastNotifiedJobId = null;
let creatingOffscreenPromise = null;
let preferredUploadTab = null;

const NOTIFICATION_ICON_URL = chrome.runtime.getURL("icons/icon128.png");

function isAllowedExternalSender(sender) {
  const senderUrl = typeof sender?.url === "string" ? sender.url : "";
  if (!senderUrl) return false;
  try {
    const parsed = new URL(senderUrl);
    return ALLOWED_EXTERNAL_ORIGINS.has(parsed.origin);
  } catch (_) {
    return false;
  }
}

async function ensureOffscreenDocument() {
  if (!chrome.offscreen) return false;
  try {
    if (typeof chrome.offscreen.hasDocument === "function") {
      const has = await chrome.offscreen.hasDocument();
      if (has) return true;
    }
  } catch (_) { /* ignore — fall through to create */ }

  if (creatingOffscreenPromise) {
    await creatingOffscreenPromise;
    return true;
  }

  creatingOffscreenPromise = chrome.offscreen.createDocument({
    url: chrome.runtime.getURL("offscreen.html"),
    reasons: ["AUDIO_PLAYBACK"],
    justification: "Play upload-complete success sound (cha-ching.mp3).",
  }).catch((error) => {
    // "Only a single offscreen document may be created" → already exists, fine.
    if (!String(error?.message || error).includes("Only a single")) {
      console.warn("[PodPilot] could not create offscreen document:", error?.message || error);
    }
  }).finally(() => {
    creatingOffscreenPromise = null;
  });

  await creatingOffscreenPromise;
  return true;
}

async function playUploadSoundOnce() {
  debugLog("[PodPilot] cha-ching sound requested");
  try {
    await ensureOffscreenDocument();
    chrome.runtime.sendMessage(
      { target: "offscreen", type: "PLAY_UPLOAD_SOUND" },
      () => { void chrome.runtime.lastError; }
    );
  } catch (error) {
    console.warn("[PodPilot] cha-ching dispatch failed:", error?.message || error);
  }
}

function showDesktopNotification({ marketplace, summary }) {
  if (!chrome.notifications?.create) return;
  const total = Number.isFinite(summary?.total) ? summary.total : 0;
  const success = Number.isFinite(summary?.success) ? summary.success : 0;
  const failed = Number.isFinite(summary?.failed) ? summary.failed : Math.max(0, total - success);
  const platformLabel = marketplace === "teepublic" ? "TeePublic" : "Redbubble";
  const opts = {
    type: "basic",
    iconUrl: NOTIFICATION_ICON_URL,
    title: "PodPilot Upload Complete",
    message: `${platformLabel} upload finished. ${success} uploaded, ${failed} failed.`,
    priority: 2,
  };
  try {
    chrome.notifications.create(`podpilot-upload-${Date.now()}`, opts, () => {
      if (chrome.runtime.lastError) {
        console.warn("[PodPilot] notification error:", chrome.runtime.lastError.message);
        return;
      }
      debugLog("[PodPilot] desktop notification shown");
    });
  } catch (error) {
    console.warn("[PodPilot] notification failed:", error?.message || error);
  }
}

async function notifyUploadComplete({ marketplace, summary, jobId }) {
  debugLog("[PodPilot] upload complete notification requested", { marketplace, jobId, summary });
  
  const state = await getQueueState();
  const activeJobId = jobId || state.currentJobId;
  
  if (activeJobId && state.completionNotifiedJobId === activeJobId) {
    debugLog("[PodPilot] notification skipped duplicate job", activeJobId);
    return;
  }
  
  if (activeJobId) {
    await setQueueState({ completionNotifiedJobId: activeJobId });
  }

  showDesktopNotification({ marketplace, summary });
  await playUploadSoundOnce();
}

async function broadcastQueueComplete() {
  if (queueCompletionFired) return;
  queueCompletionFired = true;

  const state = await getQueueState();
  const queue = Array.isArray(state.queue) ? state.queue : [];
  const total = queue.length;
  const success = queue.filter((d) => d.status === "done").length;
  const failed = total - success;
  const successRate = total === 0 ? 0 : Math.round((success / total) * 100);
  const finishedAt = new Date().toISOString();
  const marketplace = queue[0]?.marketplace || state.marketplace || "redbubble";
  const summary = {
    total,
    success,
    failed,
    successRate,
    finishedAt,
    marketplace,
  };

  debugLog("[PodPilot] queue_complete broadcast:", summary);

  await setQueueState({
    status: "idle",
    lastCompletion: summary,
    updatedAt: finishedAt
  });

  try {
    chrome.runtime.sendMessage(
      { action: "queue_complete", summary },
      () => { void chrome.runtime.lastError; }
    );
  } catch (_) { /* popup may not be open */ }

  // Notify both Redbubble + TeePublic open tabs so the in-page completion
  // modal renders regardless of which marketplace ran.
  const tabUrlPatterns = [
    "https://www.redbubble.com/*",
    "https://www.teepublic.com/*",
  ];
  for (const pattern of tabUrlPatterns) {
    try {
      chrome.tabs.query({ url: pattern }, (tabs) => {
        (tabs || []).forEach((tab) => {
          if (!tab?.id) return;
          try {
            chrome.tabs.sendMessage(
              tab.id,
              { action: "queue_complete", summary },
              () => { void chrome.runtime.lastError; }
            );
          } catch (_) { /* ignore */ }
        });
      });
    } catch (_) { /* tabs API may be unavailable */ }
  }

  // Desktop notification + sound (works even when the user is on another tab).
  await notifyUploadComplete({
    marketplace,
    summary,
    jobId: state.currentJobId || finishedAt,
  });
}

// ─── PodPilot Search Context Menu ───────────────────────────────────────────
function setupContextMenus() {
  chrome.contextMenus.removeAll(() => {
    if (chrome.runtime.lastError) {
      console.warn("[PodPilot] removeAll failed:", chrome.runtime.lastError.message);
    }

    // Parent Menu (Only visible on text selection)
    chrome.contextMenus.create({
      id: "podpilot_search_parent",
      title: "PodPilot Search",
      contexts: ["selection"]
    });

    // Redbubble Submenu
    chrome.contextMenus.create({
      id: "podpilot_search_redbubble",
      parentId: "podpilot_search_parent",
      title: "Redbubble",
      contexts: ["selection"]
    });

    chrome.contextMenus.create({
      id: "podpilot_search_redbubble_shirt",
      parentId: "podpilot_search_redbubble",
      title: 'Add "shirt" automatically',
      contexts: ["selection"]
    });

    chrome.contextMenus.create({
      id: "podpilot_search_redbubble_direct",
      parentId: "podpilot_search_redbubble",
      title: "Search directly",
      contexts: ["selection"]
    });

    // TeePublic Submenu
    chrome.contextMenus.create({
      id: "podpilot_search_teepublic",
      parentId: "podpilot_search_parent",
      title: "TeePublic",
      contexts: ["selection"]
    });

    chrome.contextMenus.create({
      id: "podpilot_search_teepublic_shirt",
      parentId: "podpilot_search_teepublic",
      title: 'Add "shirt" automatically',
      contexts: ["selection"]
    });

    chrome.contextMenus.create({
      id: "podpilot_search_teepublic_direct",
      parentId: "podpilot_search_teepublic",
      title: "Search directly",
      contexts: ["selection"]
    });
  });
}

// Context Menu click listener
chrome.contextMenus.onClicked.addListener((info, tab) => {
  const selectedText = info.selectionText;
  if (!selectedText) return;

  const query = selectedText.trim();
  let url = "";

  switch (info.menuItemId) {
    case "podpilot_search_redbubble_direct":
      url = `https://www.redbubble.com/shop/?query=${encodeURIComponent(query)}`;
      break;
    case "podpilot_search_redbubble_shirt":
      url = `https://www.redbubble.com/shop/?query=${encodeURIComponent(query + " shirt")}`;
      break;
    case "podpilot_search_teepublic_direct":
      url = `https://www.teepublic.com/t-shirts?query=${encodeURIComponent(query)}`;
      break;
    case "podpilot_search_teepublic_shirt":
      url = `https://www.teepublic.com/t-shirts?query=${encodeURIComponent(query + " shirt")}`;
      break;
    default:
      return;
  }

  if (url) {
    chrome.tabs.create({ url });
  }
});

chrome.runtime.onInstalled.addListener(async (details) => {
  const state = await getQueueState();
  await setQueueState({ ...DEFAULT_STATE, ...state, status: state.status || "idle" });
  setupContextMenus();

  if (details && details.reason === "install") {
    chrome.tabs.create({ url: "https://podpilot.space/thank-you" });
  }
});

// External messages come from the dashboard tab (frontend/src/App.jsx).
chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
  if (!isAllowedExternalSender(sender)) {
    sendResponse({ ok: false, error: "External sender is not allowed." });
    return false;
  }

  if (message && message.type === "PODPILOT_AUTH_SESSION") {
    (async () => {
      try {
        const session = await self.PodPilotAuth?.adoptSession({
          access_token: message.access_token,
          refresh_token: message.refresh_token,
          expires_at: message.expires_at,
          user: message.user || null,
        });

        if (session) {
          chrome.runtime.sendMessage({ action: "session_adopted", session });
        }

        sendResponse({ ok: true });
      } catch (error) {
        console.warn("[PodPilot] could not adopt external Google session:", error?.message || error);
        sendResponse({ ok: false, error: error.message });
      }
    })();
    return true;
  }

  handleControlMessage(message, sender)
    .then((response) => sendResponse(response))
    .catch((error) => sendResponse({ ok: false, error: error.message }));
  return true;
});

// Internal messages come from popup.js / content.js.
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleControlMessage(message, sender)
    .then((response) => sendResponse(response))
    .catch((error) => sendResponse({ ok: false, error: error.message }));
  return true;
});

async function handleControlMessage(message, sender = null) {
  if (!message || typeof message.action !== "string") {
    return { ok: false, error: "Invalid extension message." };
  }

  // The dashboard hands us its current Supabase session along with most
  // messages so the extension stays signed in without a separate login.
  if (message.access_token) {
    const authTimer = debugTimerStart("auth/session check duration", {
      action: message.action,
      hasRefreshToken: Boolean(message.refresh_token),
      hasUser: Boolean(message.user),
    });
    try {
      await self.PodPilotAuth?.adoptSession({
        access_token: message.access_token,
        refresh_token: message.refresh_token,
        expires_at: message.expires_at,
        user: message.user || null,
      });
      debugTimerEnd(authTimer, { ok: true });
    } catch (error) {
      debugTimerEnd(authTimer, { ok: false });
      console.warn("[PodPilot] could not adopt dashboard session:", error?.message || error);
    }
  }

  switch (message.action) {
    case "start_teepublic_queue":
      return startTeePublicQueue(Array.isArray(message.designs) ? message.designs : []);

    case "tp_tab_ready":
      await handleTpTabReady(message, sender);
      return { ok: true };

    case "tp_upload_stage":
      await setTpUploadState({
        ...(message.state || {}),
        stage: message.stage,
        imageInjected: message.imageInjected,
      });
      return { ok: true };

    case "start_queue":
      return startQueue(Array.isArray(message.designs) ? message.designs : []);

    case "start_queue_instant":
      startQueueInstant(message).catch((error) => {
        console.error("[PodPilot] instant upload start failed:", error?.message || error);
        showUploadStartError(error?.message || "Upload could not start.");
      });
      return { ok: true, starting: true };

    case "save_designs":
      return saveDesigns(Array.isArray(message.designs) ? message.designs : []);

    case "start_selected_queue":
      return startSelectedQueue(Array.isArray(message.designIds) ? message.designIds : []);

    case "pause_queue": {
      const state = await getQueueState();
      const marketplace = state.marketplace || state.queue?.[0]?.marketplace || "redbubble";
      const platformAccess = await verifyPlatformAccessBeforeQueue(marketplace);
      if (!platformAccess.ok) {
        return blockQueueForPlatformAccess(marketplace, platformAccess);
      }
      const access = await verifyUploadAccessBeforeQueue();
      if (!access.ok) {
        const message = access.blocked ? buildBlockedMessage(access.summary) : "Could not verify subscription.";
        showBillingBlockNotice({ title: "Upload blocked", message });
        return { ok: false, blocked: Boolean(access.blocked), error: message, summary: access.summary };
      }
      return pauseQueue();
    }

    case "start_existing_queue":
      return startExistingQueue();

    case "resume_queue": {
      const state = await getQueueState();
      if (state.status !== "paused") {
        return { ok: false, error: "Queue is not paused." };
      }
      const marketplace = state.marketplace || state.queue[0]?.marketplace || "redbubble";
      const platformAccess = await verifyPlatformAccessBeforeQueue(marketplace);
      if (!platformAccess.ok) {
        return blockQueueForPlatformAccess(marketplace, platformAccess);
      }
      const access = await verifyUploadAccessBeforeQueue();
      if (!access.ok) {
        const message = access.blocked ? buildBlockedMessage(access.summary) : "Could not verify subscription.";
        showBillingBlockNotice({ title: "Upload blocked", message });
        return { ok: false, blocked: Boolean(access.blocked), error: message, summary: access.summary };
      }
      await setQueueState({ status: "running", lastError: "" });
      if (marketplace === "teepublic") processTpNext();
      else processNext();
      return { ok: true, state: await getQueueState() };
    }

    case "stop_queue":
      return stopQueue();

    case "get_status":
      return { ok: true, state: await getQueueState() };

    case "clear_local_state":
      return clearLocalState();

    case "upload_result":
      await handleUploadResult(message);
      return { ok: true };

    case "stage_update":
      await appendProgressLog(message.design_id, {
        stage: message.stage,
        status: message.status,
        error_message: message.error_message || ""
      }).catch((err) => {
        console.warn("appendProgressLog (stage_update) failed:", err?.message || err);
      });
      return { ok: true };

    case "download_redbubble_design":
      return downloadRedbubbleDesign(message);

    case "fetch_redbubble_image":
      return fetchRedbubbleImage(message);

    default:
      return { ok: false, error: `Unknown action: ${message.action}` };
  }
}

// ─── Redbubble clean-design downloader ──────────────────────────────────────
//
// The content-redbubble-downloader.js script asks us to save a 1500×1500
// "sticker" render of a design (closest mockup-free version Redbubble's CDN
// exposes). We hand it off to chrome.downloads with a sane filename so the
// user lands a clean .jpg in their default Downloads folder.

async function downloadRedbubbleDesign(message) {
  const imageUrl = String(message?.imageUrl || "").trim();
  const rawName = String(message?.filename || "").trim();

  if (!imageUrl) {
    return { ok: false, error: "Missing image URL." };
  }
  // Allow data: URLs so we can save the watermark-cleaned image bytes the
  // content script produced. Otherwise enforce that the URL is a Redbubble
  // CDN address — we never want this handler to download arbitrary URLs.
  const isDataUrl = /^data:image\//i.test(imageUrl);
  if (!isDataUrl) {
    try {
      const parsed = new URL(imageUrl);
      if (parsed.protocol !== "https:" || !/redbubble\.net$/i.test(parsed.hostname)) {
        return { ok: false, error: "Refusing to download a non-Redbubble URL." };
      }
    } catch (_) {
      return { ok: false, error: "Invalid image URL." };
    }
  }

  const filename = sanitizeRedbubbleFilename(rawName) ||
    `redbubble-design-${Date.now()}.jpg`;

  return new Promise((resolve) => {
    try {
      chrome.downloads.download(
        {
          url: imageUrl,
          filename,
          saveAs: false,
          conflictAction: "uniquify",
        },
        (downloadId) => {
          if (chrome.runtime.lastError) {
            resolve({ ok: false, error: chrome.runtime.lastError.message });
            return;
          }
          if (typeof downloadId !== "number") {
            resolve({ ok: false, error: "Download did not start." });
            return;
          }
          resolve({ ok: true, downloadId, filename });
        }
      );
    } catch (err) {
      resolve({ ok: false, error: err?.message || String(err) });
    }
  });
}

// Fetch a Redbubble CDN image and hand the bytes back to the caller as a
// data URL. The content script can then decode the bytes onto a <canvas>
// for watermark removal without tripping cross-origin canvas tainting.
async function fetchRedbubbleImage(message) {
  const imageUrl = String(message?.imageUrl || "").trim();
  if (!imageUrl) return { ok: false, error: "Missing image URL." };
  try {
    const parsed = new URL(imageUrl);
    if (parsed.protocol !== "https:" || !/redbubble\.net$/i.test(parsed.hostname)) {
      return { ok: false, error: "Refusing to fetch a non-Redbubble URL." };
    }
  } catch (_) {
    return { ok: false, error: "Invalid image URL." };
  }

  try {
    const response = await fetch(imageUrl, { credentials: "omit" });
    if (!response.ok) {
      return {
        ok: false,
        error: `Image fetch failed: ${response.status} ${response.statusText}`,
      };
    }
    const mimeType = response.headers.get("Content-Type") || "image/jpeg";
    const arrayBuffer = await response.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    let binary = "";
    const chunkSize = 8192;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
    }
    return {
      ok: true,
      dataUrl: `data:${mimeType};base64,${btoa(binary)}`,
      mimeType,
    };
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  }
}

function sanitizeRedbubbleFilename(name) {
  if (!name) return "";
  // Strip anything Chrome would reject in a filename. Keep the extension.
  const cleaned = name
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 180);
  if (!cleaned) return "";
  return /\.(jpe?g|png|webp)$/i.test(cleaned) ? cleaned : `${cleaned}.jpg`;
}

// ─── Progress log persistence ────────────────────────────────────────────────

async function getProgressLog() {
  const stored = await progressLogStore.get(STORAGE_KEY_PROGRESS);
  return stored[STORAGE_KEY_PROGRESS] || {};
}

async function appendProgressLog(designId, entry) {
  if (designId === undefined || designId === null) return [];
  const all = await getProgressLog();
  const id = String(designId);
  const list = Array.isArray(all[id]) ? all[id] : [];
  list.push({ ...entry, at: new Date().toISOString() });
  all[id] = list;
  await progressLogStore.set({ [STORAGE_KEY_PROGRESS]: all });
  try {
    chrome.runtime.sendMessage(
      { action: "progress_log_updated", design_id: id, log: list },
      () => { void chrome.runtime.lastError; }
    );
  } catch (_) { /* popup not open */ }
  return list;
}

// ─── Queue control ───────────────────────────────────────────────────────────

/**
 * Verify subscription/usage before any queue starts. Returns
 *   { ok: true, summary }                — proceed
 *   { ok: false, blocked: true, summary } — backend said can_upload=false
 *   { ok: false, blocked: false, error } — verification failed (network/auth)
 *
 * Never starts the queue itself. The caller decides what to do with the
 * answer (start the queue, or surface a notification).
 */
async function verifyUploadAccessBeforeQueue() {
  try {
    const summary = await self.PodPilotAuth.checkUploadAccess();
    if (!summary || summary.can_upload === false) {
      return { ok: false, blocked: true, summary };
    }
    return { ok: true, summary };
  } catch (error) {
    console.warn("[Billing] access check failed:", error?.message || error);
    return { ok: false, blocked: false, error };
  }
}

function platformLabel(marketplace = "redbubble") {
  return marketplace === "teepublic" ? "TeePublic" : "Redbubble";
}

function platformLockedMessage(marketplace = "redbubble") {
  if (!marketplace) return "You do not have an active trial or subscription. Open PodPilot to start.";
  return `${platformLabel(marketplace)} is locked for your current plan. Upgrade to continue.`;
}

async function verifyPlatformAccessBeforeQueue(marketplace = "redbubble") {
  const platform = marketplace === "teepublic" ? "teepublic" : "redbubble";
  const timer = debugTimerStart("platform access fetch/check duration", { marketplace: platform });
  try {
    if (typeof self.PodPilotAuth?.refreshPlatformAccess !== "function") {
      throw new Error("Extension auth helper is stale. Reload the PodPilot extension and try again.");
    }
    const access = await self.PodPilotAuth.refreshPlatformAccess();
    debugLog("[PlatformAccess] final access decision", {
      marketplace: platform,
      allowed: access?.[platform] === true,
      redbubble: access?.redbubble === true,
      teepublic: access?.teepublic === true,
      has_active_plan: access?.has_active_plan === true,
      plan: access?.plan || null,
    });
    if (!access || access[platform] !== true) {
      const hasActivePlan = access?.has_active_plan === true;
      debugTimerEnd(timer, { ok: false, blocked: true });
      return {
        ok: false,
        blocked: true,
        reason: "platform_locked",
        access,
        error: hasActivePlan
          ? platformLockedMessage(platform)
          : "You do not have an active trial or subscription. Open PodPilot to start.",
      };
    }
    debugTimerEnd(timer, { ok: true });
    return { ok: true, access };
  } catch (error) {
    debugTimerEnd(timer, { ok: false, blocked: false });
    console.warn("[Billing] platform access check failed:", error?.message || error);
    debugLog("[PlatformAccess] final access decision", {
      marketplace: platform,
      allowed: false,
      reason: "platform_access_unverified",
      error: error?.message || String(error),
    });
    return {
      ok: false,
      blocked: false,
      reason: "platform_access_unverified",
      error: error?.message || "Could not verify your plan. Please sign in again or check backend connection.",
    };
  }
}

async function blockQueueForPlatformAccess(marketplace, platformAccess) {
  const message = platformAccess?.error || platformLockedMessage(marketplace);
  preferredUploadTab = null;
  await setQueueState({
    status: "idle",
    uploadTabId: null,
    uploadTabMarketplace: "",
    lastError: message,
    updatedAt: new Date().toISOString(),
  });
  showBillingBlockNotice({
    title: platformAccess?.blocked ? "Platform locked" : "Could not verify platform access",
    message,
  });
  return {
    ok: false,
    blocked: Boolean(platformAccess?.blocked),
    reason: platformAccess?.reason || "platform_access_unverified",
    error: message,
  };
}

function buildBlockedMessage(summary) {
  if (!summary?.has_subscription || String(summary?.status || "").toLowerCase() === "inactive") {
    return "You do not have an active trial or subscription. Open PodPilot to start.";
  }
  const platform = summary?.plan ? ` plan=${summary.plan}` : "";
  const reason = summary?.reason || "Your current plan does not allow more uploads right now.";
  const used = Number.isFinite(summary?.uploaded_count) ? summary.uploaded_count : null;
  const limit = Number.isFinite(summary?.monthly_upload_limit) ? summary.monthly_upload_limit : null;
  const usage =
    used !== null && limit !== null
      ? ` Used ${used} / ${limit} this period.`
      : "";
  return `Upload blocked${platform}. ${reason}${usage}`.trim();
}

/**
 * Show a desktop notification + popup toast when an upload is blocked or the
 * verification request itself failed. Reuses the existing notification icon.
 */
function showBillingBlockNotice({ title, message }) {
  try {
    if (chrome.notifications?.create) {
      chrome.notifications.create(`podpilot-billing-${Date.now()}`, {
        type: "basic",
        iconUrl: NOTIFICATION_ICON_URL,
        title,
        message,
        priority: 2,
      }, () => { void chrome.runtime.lastError; });
    }
  } catch (_) { /* ignore */ }

  // The popup may or may not be open; use the upload-toast channel so the
  // existing UI surfaces it as a banner if it is.
  try {
    chrome.runtime.sendMessage(
      { action: "billing_block", title, message },
      () => { void chrome.runtime.lastError; }
    );
  } catch (_) { /* popup not open */ }
}

function showUploadStartError(message) {
  showBillingBlockNotice({
    title: "Upload could not start",
    message: message || "Upload could not start.",
  });
}

function getDesignId(design, index = 0) {
  return String(design?.id || design?.design_id || `${design?.filename || "design"}-${index}`);
}

function getSelectedDesignsFromPayload(message) {
  const marketplace = message.marketplace || "redbubble";
  const selectedSet = new Set((Array.isArray(message.designIds) ? message.designIds : []).map((id) => String(id)));
  const source = Array.isArray(message.designsLibrary) && message.designsLibrary.length
    ? message.designsLibrary
    : (Array.isArray(message.designs) ? message.designs : []);

  return source.filter((design, index) => {
    if ((design.marketplace || marketplace) !== marketplace) return false;
    return selectedSet.size === 0 || selectedSet.has(getDesignId(design, index));
  });
}

async function createUploadJobForQueue(marketplace, queue) {
  try {
    await self.PodPilotAuth.apiFetch("/upload-jobs", {
      method: "POST",
      body: JSON.stringify({
        marketplace,
        design_ids: queue.map((design) => design.id || design.design_id).filter(Boolean),
        total_designs: queue.length,
      }),
    });
    debugLog("[PodPilot] Queue prepared: upload job recorded", { marketplace, total: queue.length });
  } catch (error) {
    if (error instanceof self.PodPilotAuth.ApiAuthError) {
      try { chrome.runtime.sendMessage({ action: "auth_required" }, () => { void chrome.runtime.lastError; }); } catch (_) {}
      throw new Error("Session expired. Please sign in again.");
    }
    console.warn("[PodPilot] upload-jobs request failed:", error?.message || error);
  }
}

async function startQueueInstant(message) {
  const startedAt = Date.now();
  const marketplace = message.marketplace || "redbubble";
  if (marketplace === "teepublic") {
    const tpState = await getTpUploadState();
    const storedTabIsPublished = await isStoredTpTabOnPublishedPage(tpState);
    if (TP_TERMINAL_STAGES.has(tpState?.stage) || storedTabIsPublished) {
      debugLog("[PodPilot-TP] Clearing terminal TeePublic upload state before fresh start", {
        stage: tpState?.stage || "",
        storedTabIsPublished,
      });
      await clearTpUploadState();
    } else if (await shouldTreatTpStateAsActiveUpload(tpState)) {
      debugLog("[PodPilot-TP] TeePublic navigation skipped: upload already in progress", {
        reason: "startQueueInstant",
        stage: tpState.stage || "",
        imageInjected: tpState.imageInjected === true,
      });
      return { ok: true, alreadyRunning: true };
    } else if (tpState?.active) {
      debugLog("[PodPilot-TP] Clearing stale TeePublic upload state before fresh start", {
        stage: tpState.stage || "",
        imageInjected: tpState.imageInjected === true,
      });
      await clearTpUploadState();
    }
  }
  const queueTimer = debugTimerStart("queue/designs fetch duration", {
    marketplace,
    requestedCount: Array.isArray(message.designIds) ? message.designIds.length : 0,
    libraryCount: Array.isArray(message.designsLibrary) ? message.designsLibrary.length : 0,
  });
  const rawDesigns = getSelectedDesignsFromPayload(message);
  debugTimerEnd(queueTimer, { selectedCount: rawDesigns.length });
  if (!rawDesigns.length) throw new Error("Select at least one design to upload.");

  const platformAccess = await verifyPlatformAccessBeforeQueue(marketplace);
  if (!platformAccess.ok) {
    await blockQueueForPlatformAccess(marketplace, platformAccess);
    throw new Error(platformAccess.error || platformLockedMessage(marketplace));
  }

  const uploadAccess = await verifyUploadAccessBeforeQueue();
  if (!uploadAccess.ok) {
    const message = uploadAccess.blocked
      ? buildBlockedMessage(uploadAccess.summary)
      : "Could not verify subscription. Please try again.";
    showBillingBlockNotice({
      title: uploadAccess.blocked ? "Upload blocked" : "Could not verify subscription",
      message,
    });
    throw new Error(message);
  }

  debugLog("[PodPilot] Starting upload", { marketplace, selected: rawDesigns.length });

  const normalizeTimer = debugTimerStart("queue/designs normalize duration", {
    marketplace,
    selectedCount: rawDesigns.length,
  });
  const queue = marketplace === "teepublic"
    ? rawDesigns.map((design, index) => normalizeTpQueueDesign(design, index))
    : rawDesigns.map((design, index) => normalizeQueueDesign(design, index));
  debugTimerEnd(normalizeTimer, { queuedCount: queue.length });

  const invalid = marketplace === "teepublic"
    ? queue.find((design) => !design.image_url && !design.image_r2_key)
    : queue.find((design) => (!design.image_url && !design.image_r2_key) || !design.copy_link);
  if (invalid) {
    const need = marketplace === "teepublic" ? "an original image URL." : "an original image URL and copy_link.";
    throw new Error(`Design ${invalid.filename || invalid.id} needs ${need}`);
  }
  debugLog("[PodPilot Timing] selected design ready", {
    marketplace,
    designId: queue[0]?.id || queue[0]?.design_id || "",
  });

  if (marketplace === "teepublic") {
    primeTpImagePayload(queue[0]);
  }

  const jobId = "job-" + Date.now();
  const initialUrl = marketplace === "teepublic" ? TP_UPLOAD_URL : getDuplicateUrl(queue[0].copy_link);
  if (marketplace === "teepublic") {
    await setTpUploadState({
      active: true,
      platform: "teepublic",
      designId: queue[0]?.id || queue[0]?.design_id || "",
      queueId: jobId,
      currentIndex: 0,
      stage: "navigating",
      imageInjected: false,
      startedAt: new Date().toISOString(),
    });
  }
  await setQueueState({
    queue,
    currentIndex: 0,
    status: "starting",
    lastError: "",
    marketplace,
    uploadTabId: null,
    uploadTabMarketplace: marketplace,
    updatedAt: new Date().toISOString(),
    currentJobId: jobId,
  });

  debugLog("[PodPilot] Queue prepared", {
    marketplace,
    total: queue.length,
    uploadUsesOriginalImageUrl: queue.every((design) => Boolean(design.image_url)),
    elapsedMs: Date.now() - startedAt,
  });

  debugLog("[PodPilot] Navigating", { marketplace, url: initialUrl, elapsedMs: Date.now() - startedAt });
  const uploadSettings = normalizeUploadSettings(message.uploadSettings || {});
  await setUploadSettings(uploadSettings);
  const initialNavTimer = debugTimerStart("tab open/navigation duration", {
    marketplace,
    mode: "initial-open",
    cacheBust: marketplace === "redbubble",
  });
  const tab = await openUploadTab(initialUrl, {
    marketplace,
    cacheBust: marketplace === "redbubble",
    focus: true,
  });
  if (marketplace === "teepublic") {
    await setTpUploadState({
      uploadTabId: tab.id,
      initialNavigationStarted: true,
    });
  }
  debugTimerEnd(initialNavTimer, { tabId: tab.id });
  preferredUploadTab = { id: tab.id, marketplace, designId: queue[0]?.id || queue[0]?.design_id || "" };

  try {
    await createUploadJobForQueue(marketplace, queue);
    const access = await verifyUploadAccessBeforeQueue();
    if (!access.ok) {
      preferredUploadTab = null;
      await setQueueState({
        status: "idle",
        uploadTabId: null,
        uploadTabMarketplace: "",
        lastError: access.blocked ? buildBlockedMessage(access.summary) : "Could not verify subscription.",
        updatedAt: new Date().toISOString(),
      });

      if (access.blocked) {
        showBillingBlockNotice({ title: "Upload blocked", message: buildBlockedMessage(access.summary) });
      } else {
        showBillingBlockNotice({
          title: "Could not verify subscription",
          message: "Could not verify subscription. Please try again.",
        });
      }
      return;
    }

    const latest = await getQueueState();
    if (latest.status !== "starting") {
      debugLog("[PodPilot] Upload start deferred or canceled before automation began.", { status: latest.status });
      if (latest.status === "idle") preferredUploadTab = null;
      return;
    }

    await setQueueState({ status: "running", lastError: "", updatedAt: new Date().toISOString() });
    debugLog("[PodPilot] Upload running", {
      marketplace,
      total: queue.length,
      startLatencyMs: Date.now() - startedAt,
    });
    if (marketplace === "teepublic") processTpNext();
    else processNext();
  } catch (error) {
    preferredUploadTab = null;
    if (marketplace === "teepublic") {
      const tpState = await getTpUploadState().catch(() => null);
      if (!isTpUploadNavigationLocked(tpState)) await clearTpUploadState();
    }
    await setQueueState({
      status: "idle",
      uploadTabId: null,
      uploadTabMarketplace: "",
      lastError: error?.message || "Upload preparation failed.",
      updatedAt: new Date().toISOString(),
    });
    showUploadStartError(error?.message || "Upload preparation failed.");
  }
}

async function startQueue(designs) {
  if (designs.length === 0) {
    throw new Error("Start queue requires at least one design.");
  }

  // Route TeePublic designs to the TeePublic pipeline
  const marketplace = designs[0]?.marketplace || "redbubble";
  if (marketplace === "teepublic") {
    return startTeePublicQueue(designs);
  }

  // ── Subscription / usage gate ─────────────────────────────────────────────
  const platformAccess = await verifyPlatformAccessBeforeQueue("redbubble");
  if (!platformAccess.ok) {
    return blockQueueForPlatformAccess("redbubble", platformAccess);
  }

  const access = await verifyUploadAccessBeforeQueue();
  if (!access.ok) {
    if (access.blocked) {
      const message = buildBlockedMessage(access.summary);
      showBillingBlockNotice({ title: "Upload blocked", message });
      return { ok: false, blocked: true, reason: access.summary?.reason || "blocked", summary: access.summary };
    }
    showBillingBlockNotice({
      title: "Could not verify subscription",
      message: "Could not verify subscription. Please try again.",
    });
    return { ok: false, blocked: false, error: access.error?.message || "verification failed" };
  }

  const queue = designs.map((design, index) => normalizeQueueDesign(design, index));

  const invalid = queue.find((d) => (!d.image_url && !d.image_r2_key) || !d.copy_link);
  if (invalid) {
    throw new Error(`Design ${invalid.filename || invalid.id} needs an image and copy_link.`);
  }

  const jobId = "job-" + Date.now();
  await setTpUploadState({
    active: true,
    platform: "teepublic",
    designId: queue[0]?.id || queue[0]?.design_id || "",
    queueId: jobId,
    currentIndex: 0,
    stage: "navigating",
    imageInjected: false,
    startedAt: new Date().toISOString(),
  });
  await setQueueState({
    queue,
    currentIndex: 0,
    status: "running",
    lastError: "",
    marketplace: "redbubble",
    uploadTabId: null,
    uploadTabMarketplace: "redbubble",
    updatedAt: new Date().toISOString(),
    currentJobId: jobId
  });

  processNext();
  return { ok: true, state: await getQueueState() };
}

async function saveDesigns(designs) {
  const designsLibrary = designs.map((design, index) => normalizeQueueDesign(design, index));
  const state = await getQueueState();
  const patch = {
    designsLibrary,
    lastError: "",
    updatedAt: new Date().toISOString()
  };

  if (state.status === "idle") {
    patch.queue = designsLibrary.map((design) => ({ ...design, status: "pending", error: "" }));
    patch.currentIndex = 0;
  }

  await setQueueState(patch);
  return { ok: true, state: await getQueueState() };
}

async function startSelectedQueue(designIds) {
  const state = await getQueueState();
  const source = state.designsLibrary.length > 0 ? state.designsLibrary : state.queue;
  const selectedSet = new Set(designIds.map((id) => String(id)));
  const selectedDesigns = source.filter((design) => selectedSet.has(String(design.id || design.design_id)));

  if (selectedDesigns.length === 0) {
    return { ok: false, error: "Select at least one design to upload." };
  }

  return startQueue(selectedDesigns);
}

function normalizeQueueDesign(design, index) {
  return {
    ...design,
    id: design.id || design.design_id || `${design.filename || "design"}-${index}`,
    design_id: String(design.id || design.design_id || `${design.filename || "design"}-${index}`),
    filename: String(design.filename || "").trim(),
    image_url: String(design.image_url || "").trim(),
    upload_url: String(design.image_url || "").trim(),
    preview_url: String(design.thumbnail_url || design.image_url || "").trim(),
    thumbnail_url: String(design.thumbnail_url || "").trim(),
    image_r2_key: String(design.image_r2_key || "").trim(),
    title: String(design.title || "").trim(),
    description: String(design.description || "").trim(),
    main_tag: String(design.main_tag || design.primary_tag || "").trim(),
    primary_tag: String(design.primary_tag || design.main_tag || "").trim(),
    supporting_tags: String(design.supporting_tags || "").trim(),
    copy_link: String(design.copy_link || "").trim(),
    marketplace: design.marketplace || "redbubble",
    status: "pending",
    retryCount: 0,
    error: ""
  };
}

async function pauseQueue() {
  const state = await getQueueState();
  if (!["running", "starting"].includes(state.status)) {
    return { ok: false, error: "Only a running queue can be paused." };
  }
  await setQueueState({ status: "paused", updatedAt: new Date().toISOString() });
  return { ok: true, state: await getQueueState() };
}

async function startExistingQueue() {
  const state = await getQueueState();
  if (state.queue.length === 0) {
    return { ok: false, error: "No queued designs are available to start." };
  }

  const queue = state.queue.map((design, index) =>
    index >= state.currentIndex && design.status !== "done"
      ? { ...design, status: "pending", error: "" }
      : design
  );

  const jobId = "job-" + Date.now();
  await setQueueState({
    queue,
    status: "running",
    lastError: "",
    updatedAt: new Date().toISOString(),
    currentJobId: jobId
  });
  const marketplace = state.marketplace || queue[0]?.marketplace || "redbubble";
  const platformAccess = await verifyPlatformAccessBeforeQueue(marketplace);
  if (!platformAccess.ok) {
    return blockQueueForPlatformAccess(marketplace, platformAccess);
  }
  const uploadAccess = await verifyUploadAccessBeforeQueue();
  if (!uploadAccess.ok) {
    const message = uploadAccess.blocked
      ? buildBlockedMessage(uploadAccess.summary)
      : "Could not verify subscription. Please try again.";
    await setQueueState({
      status: "idle",
      lastError: message,
      updatedAt: new Date().toISOString(),
    });
    showBillingBlockNotice({
      title: uploadAccess.blocked ? "Upload blocked" : "Could not verify subscription",
      message,
    });
    return {
      ok: false,
      blocked: Boolean(uploadAccess.blocked),
      error: message,
      summary: uploadAccess.summary,
    };
  }
  if (marketplace === "teepublic") processTpNext();
  else processNext();
  return { ok: true, state: await getQueueState() };
}

async function stopQueue() {
  const state = await getQueueState();
  preferredUploadTab = null;
  if ((state.marketplace || state.queue[0]?.marketplace) === "teepublic") {
    await clearTpUploadState();
  }
  const queue = state.queue.map((design, index) =>
    index >= state.currentIndex && ["pending", "uploading"].includes(design.status)
      ? { ...design, status: "error", error: "Stopped by user" }
      : design
  );

  if (resultWaiter) {
    resultWaiter.resolve({ status: "error", error: "Queue stopped by user" });
    resultWaiter = null;
  }

  await setQueueState({
    queue,
    status: "idle",
    uploadTabId: null,
    uploadTabMarketplace: "",
    lastError: "Queue stopped by user",
    updatedAt: new Date().toISOString()
  });
  isProcessing = false;
  return { ok: true, state: await getQueueState() };
}

async function clearLocalState() {
  preferredUploadTab = null;
  await chrome.storage.local.set(DEFAULT_STATE);
  await chrome.storage.local.remove(BG_PLATFORM_ACCESS_STORAGE_KEY);
  await clearTpUploadState();
  isProcessing = false;
  if (resultWaiter) {
    resultWaiter.resolve({ status: "error", error: "Signed out" });
    resultWaiter = null;
  }
  return { ok: true };
}

// ─── Per-design upload pipeline ─────────────────────────────────────────────

async function processNext() {
  if (isProcessing) {
    debugLog("⚠️ Already processing, skipping duplicate processNext() call");
    return;
  }
  isProcessing = true;
  queueCompletionFired = false;

  try {
    while (true) {
      const state = await getQueueState();
      if (state.status !== "running") break;

      if (state.currentIndex >= state.queue.length) {
        await broadcastQueueComplete();
        break;
      }

      const design = state.queue[state.currentIndex];
      await updateDesignAt(state.currentIndex, {
        status: "uploading",
        error: "",
        startedAt: new Date().toISOString()
      });

      // Tell the backend the design is now being uploaded so the website
      // shows it in real-time.
      postDesignStatus(design.id, { status: "uploading" }).catch(() => {});

      const result = await uploadDesign(design);
      const isLastDesign = state.currentIndex >= state.queue.length - 1;

      if (result.status === "success") {
        await updateDesignAt(state.currentIndex, {
          status: "done",
          error: "",
          redbubble_work_id: result.redbubble_work_id || "",
          finishedAt: new Date().toISOString()
        });
        postDesignStatus(design.id, {
          status: "uploaded",
          redbubble_work_id: result.redbubble_work_id || undefined,
        }).catch(() => {});
        // Bill one upload for this successful design. Errors here must NOT
        // affect the queue — the helper already swallows + retries once.
        try {
          await self.PodPilotAuth.incrementUploadUsage(1);
        } catch (billingError) {
          console.warn("[Billing] failed to increment usage:", billingError?.message || billingError);
        }
        await setQueueState({
          currentIndex: state.currentIndex + 1,
          lastError: "",
          updatedAt: new Date().toISOString()
        });
        if (isLastDesign) {
          await broadcastQueueComplete();
          break;
        }
        await delay(QUEUE_DELAY_MS);
        continue;
      }

      const latest = await getQueueState();
      const latestDesign = latest.queue[latest.currentIndex] || design;
      if (!result.terminal && (latestDesign.retryCount || 0) < 2 && latest.status === "running") {
        await updateDesignAt(latest.currentIndex, {
          status: "pending",
          retryCount: (latestDesign.retryCount || 0) + 1,
          error: result.error || "Upload failed, retrying once"
        });
        await delay(QUEUE_DELAY_MS);
        continue;
      }

      await updateDesignAt(latest.currentIndex, {
        status: "error",
        error: result.error || "Upload failed after retry",
        finishedAt: new Date().toISOString()
      });
      postDesignStatus(latestDesign.id || design.id, {
        status: "failed",
        error_message: result.error || "Upload failed after retry",
      }).catch(() => {});
      await setQueueState({
        currentIndex: latest.currentIndex + 1,
        lastError: result.error || "Upload failed after retry",
        updatedAt: new Date().toISOString()
      });
      const isLastAfterError = latest.currentIndex >= latest.queue.length - 1;
      if (isLastAfterError) {
        await broadcastQueueComplete();
        break;
      }
      await delay(QUEUE_DELAY_MS);
    }
  } finally {
    isProcessing = false;
  }
}

async function uploadDesign(design) {
  try {
    let duplicateUrl;
    try {
      duplicateUrl = getDuplicateUrl(design.copy_link);
    } catch (parseError) {
      return {
        status: "error",
        error: `navigate: ${parseError.message}`,
        terminal: true
      };
    }
    const tabNavTimer = debugTimerStart("tab open/navigation duration", {
      marketplace: "redbubble",
      designId: design.id || design.design_id || "",
    });
    const tab = await getUploadTab("redbubble");

    if (isSameNavigationTarget(tab.url, duplicateUrl)) {
      await waitForTabComplete(tab.id);
    } else {
      await navigateTab(tab.id, duplicateUrl, { cacheBust: true, marketplace: "redbubble" });
    }
    debugTimerEnd(tabNavTimer, { tabId: tab.id });

    const contentReadyTimer = debugTimerStart("content script ready duration", {
      marketplace: "redbubble",
      tabId: tab.id,
    });
    await waitForContentScriptReady(tab.id);
    debugTimerEnd(contentReadyTimer, { ok: true });

    const pageReadyTimer = debugTimerStart("marketplace page ready duration", {
      marketplace: "redbubble",
      tabId: tab.id,
    });
    await sendTabMessage(tab.id, { action: "prepare_duplicate_form" });
    debugTimerEnd(pageReadyTimer, { ok: true });

    // Always re-mint a signed image URL just before downloading to make
    // sure it's valid for the entire form-fill window.
    const imageUrl = await resolveSignedImageUrl(design);
    const imagePayload = await fetchImageAsBase64(imageUrl);

    const successPromise = waitForTabSuccess(tab.id);

    const contentPromise = sendTabMessage(tab.id, {
      action: "fill_duplicate_form",
      design,
      imageBase64: imagePayload.base64,
      imageName: design.filename || imagePayload.filename,
      imageMime: imagePayload.mimeType
    }).catch((error) => {
      console.warn("Content script message ended before final response:", error.message);
      return { ok: false, error: error.message };
    });

    const firstOutcome = await Promise.race([
      successPromise,
      contentPromise.then((response) =>
        response && response.status === "success"
          ? { outcome: "success", redbubble_work_id: response.redbubble_work_id || "" }
          : "content_done"
      )
    ]);

    if (firstOutcome && firstOutcome.outcome === "success") {
      return {
        status: "success",
        error: "",
        redbubble_work_id: firstOutcome.redbubble_work_id || ""
      };
    }
    if (firstOutcome === "success") {
      return { status: "success", error: "" };
    }

    const outcome = await successPromise;
    if (outcome && outcome.outcome === "success") {
      return {
        status: "success",
        error: "",
        redbubble_work_id: outcome.redbubble_work_id || ""
      };
    }

    const contentResult = await contentPromise;
    return {
      status: "error",
      error: contentResult?.error || "Timed out waiting for /studio/promote redirect"
    };
  } catch (error) {
    return { status: "error", error: error.message };
  }
}

/**
 * Mint a fresh signed GET URL for the design's image. Falls back to
 * whatever URL came in the design payload if the backend can't be
 * reached (rare, e.g. quick offline blip).
 */
async function resolveSignedImageUrl(design) {
  if (!design?.id) {
    if (design?.upload_url || design?.image_url) return design.upload_url || design.image_url;
    throw new Error("inject_image: Design has no id and no image_url.");
  }
  const timer = debugTimerStart("image URL fetch duration", {
    marketplace: design.marketplace || "redbubble",
    designId: design.id || design.design_id || "",
    source: "signed-url",
  });
  try {
    const response = await self.PodPilotAuth.apiFetch(`/designs/${encodeURIComponent(design.id)}/image-url`);
    if (response.ok) {
      const data = await response.json();
      debugTimerEnd(timer, { ok: Boolean(data?.image_url), status: response.status });
      if (data?.image_url) return data.image_url;
    }
    debugTimerEnd(timer, { ok: false, status: response.status });
  } catch (error) {
    debugTimerEnd(timer, { ok: false });
    if (error instanceof self.PodPilotAuth.ApiAuthError) {
      // Bubble up so the popup re-prompts for login.
      try { chrome.runtime.sendMessage({ action: "auth_required" }, () => { void chrome.runtime.lastError; }); } catch (_) {}
      throw new Error("Session expired. Please sign in again.");
    }
    console.warn("[PodPilot] /image-url fetch failed:", error?.message || error);
  }
  if (design.upload_url || design.image_url) return design.upload_url || design.image_url;
  throw new Error("inject_image: No image URL available for this design.");
}

async function fetchImageAsBase64(imageUrl) {
  if (!imageUrl) {
    throw new Error("inject_image: Design image is missing from the extension queue.");
  }

  const fetchTimer = debugTimerStart("image URL fetch duration", { source: "image-bytes" });
  const response = await fetch(imageUrl);
  if (!response.ok) {
    debugTimerEnd(fetchTimer, { ok: false, status: response.status });
    throw new Error(`inject_image: image fetch failed: ${response.status} ${response.statusText}`);
  }

  const mimeType = response.headers.get("Content-Type") || "image/png";
  const arrayBuffer = await response.arrayBuffer();
  debugTimerEnd(fetchTimer, {
    ok: true,
    status: response.status,
    mimeType,
    bytes: arrayBuffer.byteLength,
  });

  const conversionTimer = debugTimerStart("image blob/file conversion duration", {
    source: "arrayBuffer-to-base64",
    mimeType,
    bytes: arrayBuffer.byteLength,
  });
  const uint8Array = new Uint8Array(arrayBuffer);

  let binary = "";
  const chunkSize = 8192;
  for (let i = 0; i < uint8Array.length; i += chunkSize) {
    binary += String.fromCharCode(...uint8Array.subarray(i, i + chunkSize));
  }
  const base64 = btoa(binary);
  debugTimerEnd(conversionTimer, { base64Length: base64.length });

  // Best-effort filename from the URL path.
  const urlPath = (() => {
    try { return new URL(imageUrl).pathname; } catch (_) { return ""; }
  })();
  const filename = urlPath.split("/").pop() || "image.png";

  return { base64, mimeType, filename };
}

function getDuplicateUrl(copyLink) {
  const url = new URL(copyLink);
  if (url.hostname !== "www.redbubble.com" && url.hostname !== "redbubble.com") {
    throw new Error("copy_link must be a Redbubble URL.");
  }

  let workId = null;
  const portfolioMatch = url.pathname.match(/^\/portfolio\/images\/(\d+)(?:[-/]|$)/);
  const worksMatch = url.pathname.match(/^\/people\/[^/]+\/works\/(\d+)(?:[-/]|$)/);
  if (portfolioMatch) {
    workId = portfolioMatch[1];
  } else if (worksMatch) {
    workId = worksMatch[1];
  } else {
    throw new Error(`Unrecognized Redbubble copy_link: ${copyLink}`);
  }

  url.hostname = "www.redbubble.com";
  url.pathname = `/portfolio/images/${workId}/duplicate`;
  url.searchParams.set("auto", "1");
  return url.toString();
}

// ─── Backend status reporting ────────────────────────────────────────────────

/**
 * Push terminal status to the backend so the dashboard reflects it.
 * Status values: "uploading" | "uploaded" | "failed".
 *
 * Failures here MUST NOT change extension queue state — the popup keeps
 * its terminal status even if the backend missed the update.
 */
async function postDesignStatus(designId, payload) {
  if (!designId) return null;
  if (!self.PodPilotAuth) return null;

  const body = JSON.stringify(payload);
  const maxAttempts = 3;
  const backoffMs = 2000;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await self.PodPilotAuth.apiFetch(
        `/designs/${encodeURIComponent(designId)}/status`,
        { method: "POST", body }
      );
      if (response.ok) return await response.json();
      if (response.status >= 400 && response.status < 500 && response.status !== 408 && response.status !== 429) {
        console.warn("[PodPilot] postDesignStatus rejected:", response.status);
        return null;
      }
    } catch (error) {
      if (error instanceof self.PodPilotAuth.ApiAuthError) {
        try { chrome.runtime.sendMessage({ action: "auth_required" }, () => { void chrome.runtime.lastError; }); } catch (_) {}
        return null;
      }
      if (attempt === maxAttempts) {
        console.warn("postDesignStatus failed after retries:", error?.message || error);
        return null;
      }
    }
    await new Promise((r) => setTimeout(r, backoffMs));
  }
  return null;
}

async function handleUploadResult(message) {
  if (message && message.design_id !== undefined) {
    if (message.status === "success") {
      try {
        await appendProgressLog(message.design_id, { stage: "wait_success", status: "done" });
        await appendProgressLog(message.design_id, {
          stage: "done",
          status: "done",
          redbubble_work_id: message.redbubble_work_id || ""
        });
      } catch (err) {
        console.warn("appendProgressLog (success) failed:", err?.message || err);
      }
      postDesignStatus(message.design_id, {
        status: "uploaded",
        redbubble_work_id: message.redbubble_work_id || undefined,
      }).catch(() => {});
    } else {
      try {
        await appendProgressLog(message.design_id, {
          stage: message.stage || "unknown",
          status: "error",
          error_message: message.error_message || message.error || ""
        });
      } catch (err) {
        console.warn("appendProgressLog (error) failed:", err?.message || err);
      }
      postDesignStatus(message.design_id, {
        status: "failed",
        stage: message.stage || undefined,
        error_message: message.error_message || message.error || undefined,
      }).catch(() => {});
    }
  }

  if (!resultWaiter) return;
  if (String(message.design_id) !== String(resultWaiter.designId)) return;

  resultWaiter.resolve({
    status: message.status === "success" ? "success" : "error",
    error: message.error_message || message.error || ""
  });
  resultWaiter = null;
}

const SUCCESS_URL_RE = /^https:\/\/www\.redbubble\.com\/studio\/promote\/(\d+)/;

function isRedbubbleSuccessUrl(url) {
  return typeof url === "string" && SUCCESS_URL_RE.test(url);
}

function waitForTabSuccess(tabId, timeoutMs = CONTENT_RESPONSE_TIMEOUT_MS) {
  return new Promise((resolve) => {
    let settled = false;

    function finish(outcome) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(listener);
      if (outcome === "timeout") {
        console.warn("waitForTabSuccess timed out for tab", tabId);
      }
      resolve(outcome);
    }

    function inspectUrl(url) {
      if (typeof url !== "string") return;
      const m = url.match(SUCCESS_URL_RE);
      if (m) {
        const redbubble_work_id = m[1];
        debugLog("/studio/promote detected - upload success for tab", tabId, "work_id:", redbubble_work_id);
        finish({ outcome: "success", redbubble_work_id });
      }
    }

    const timer = setTimeout(() => finish("timeout"), timeoutMs);

    function listener(updatedTabId, changeInfo, tab) {
      if (updatedTabId !== tabId) return;
      inspectUrl(changeInfo.url);
      inspectUrl(tab?.url);
    }

    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.get(tabId, (tab) => {
      if (!chrome.runtime.lastError) inspectUrl(tab?.url);
    });
  });
}

function normalizeUploadSettings(settings = {}) {
  return {
    ...DEFAULT_UPLOAD_SETTINGS,
    ...settings,
    runUploadsInBackground: settings.runUploadsInBackground !== false,
  };
}

async function getUploadSettings() {
  try {
    const stored = await chrome.storage.local.get({ uploadSettings: DEFAULT_UPLOAD_SETTINGS });
    return normalizeUploadSettings(stored.uploadSettings || {});
  } catch (_) {
    return { ...DEFAULT_UPLOAD_SETTINGS };
  }
}

async function setUploadSettings(settings = {}) {
  const normalized = normalizeUploadSettings(settings);
  await chrome.storage.local.set({ uploadSettings: normalized });
  return normalized;
}

async function rememberUploadTab(tab, marketplace) {
  if (!tab?.id) return;
  preferredUploadTab = { id: tab.id, marketplace };
  await setQueueState({
    uploadTabId: tab.id,
    uploadTabMarketplace: marketplace,
    updatedAt: new Date().toISOString(),
  });
}

async function openUploadTab(url, { marketplace = "redbubble", cacheBust = false, focus = true } = {}) {
  if (marketplace === "teepublic") {
    const blocked = await shouldBlockTpNavigation({ targetUrl: url, reason: "openUploadTab" });
    if (blocked) {
      const existing = await getUploadTab("teepublic");
      return existing;
    }
  }
  const targetUrl = cacheBust ? withCacheBust(url) : url;
  const tab = await chrome.tabs.create({ url: targetUrl, active: Boolean(focus) });
  await rememberUploadTab(tab, marketplace);
  return tab;
}

function withCacheBust(url) {
  const bustUrl = new URL(url);
  bustUrl.searchParams.set("_cb", Date.now());
  return bustUrl.toString();
}

function isSameNavigationTarget(currentUrl, targetUrl) {
  try {
    const current = new URL(currentUrl || "");
    const target = new URL(targetUrl || "");
    current.searchParams.delete("_cb");
    target.searchParams.delete("_cb");
    return current.origin === target.origin &&
      current.pathname === target.pathname &&
      current.search === target.search;
  } catch (_) {
    return false;
  }
}

async function getUploadTab(marketplace = "redbubble") {
  const state = await getQueueState();
  const candidateId = (
    preferredUploadTab?.marketplace === marketplace && preferredUploadTab?.id
  ) || (
    state.uploadTabMarketplace === marketplace && state.uploadTabId
  );
  const hadUploadTab = Boolean(candidateId || state.uploadTabId);

  if (candidateId) {
    try {
      const tab = await chrome.tabs.get(candidateId);
      if (tab?.id) {
        preferredUploadTab = { id: tab.id, marketplace };
        return tab;
      }
    } catch (_) { /* tab was closed; create a replacement below */ }
  }

  const settings = await getUploadSettings();
  const focus = !settings.runUploadsInBackground || !hadUploadTab;
  const tab = await chrome.tabs.create({ url: "about:blank", active: focus });
  await rememberUploadTab(tab, marketplace);
  debugLog("[PodPilot] Upload tab created", { marketplace, tabId: tab.id, focused: focus });
  return tab;
}

async function navigateTab(tabId, url, { cacheBust = true, marketplace = "redbubble", waitForComplete = true } = {}) {
  if (marketplace === "teepublic") {
    const blocked = await shouldBlockTpNavigation({ tabId, targetUrl: url, reason: "navigateTab" });
    if (blocked) return;
  }
  const settings = await getUploadSettings();
  const targetUrl = cacheBust ? withCacheBust(url) : url;
  const updateInfo = { url: targetUrl };
  if (!settings.runUploadsInBackground) updateInfo.active = true;
  debugLog("[PodPilot] Navigating", {
    marketplace,
    tabId,
    background: settings.runUploadsInBackground,
    focused: updateInfo.active === true,
  });
  await chrome.tabs.update(tabId, updateInfo);
  if (waitForComplete) await waitForTabComplete(tabId);
}

function waitForTabComplete(tabId) {
  return new Promise((resolve, reject) => {
    let settled = false;

    const timeoutId = setTimeout(() => {
      finish(new Error("Tab load timed out."));
    }, TAB_LOAD_TIMEOUT_MS);

    function listener(updatedTabId, changeInfo) {
      if (updatedTabId === tabId && changeInfo.status === "complete") {
        finish();
      }
    }

    function finish(error) {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      chrome.tabs.onUpdated.removeListener(listener);
      if (error) reject(error);
      else resolve();
    }

    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.get(tabId, (tab) => {
      if (!chrome.runtime.lastError && tab?.status === "complete") {
        finish();
      }
    });
  });
}

async function waitForContentScriptReady(tabId, timeoutMs = 30000, intervalMs = 500) {
  const start = Date.now();
  let lastErrorMessage = "";

  while (Date.now() - start < timeoutMs) {
    try {
      const response = await new Promise((resolve) => {
        try {
          chrome.tabs.sendMessage(tabId, { action: "ping" }, (reply) => {
            if (chrome.runtime.lastError) {
              lastErrorMessage = chrome.runtime.lastError.message || "";
              resolve(null);
              return;
            }
            resolve(reply);
          });
        } catch (err) {
          lastErrorMessage = err?.message || String(err);
          resolve(null);
        }
      });

      if (response) return response;
    } catch (err) {
      lastErrorMessage = err?.message || String(err);
    }

    await delay(intervalMs);
  }

  const detail = lastErrorMessage ? ` (last error: ${lastErrorMessage})` : "";
  throw new Error(`navigate: content script did not respond within 30s${detail}`);
}

function sendTabMessage(tabId, message) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (response && response.ok === false) {
        reject(new Error(response.error || "Content script rejected the message."));
        return;
      }
      resolve(response || { ok: true });
    });
  });
}

async function getQueueState() {
  const stored = await chrome.storage.local.get(DEFAULT_STATE);
  return {
    ...DEFAULT_STATE,
    ...stored,
    designsLibrary: Array.isArray(stored.designsLibrary) ? stored.designsLibrary : [],
    queue: Array.isArray(stored.queue) ? stored.queue : [],
    currentIndex: Number.isInteger(stored.currentIndex) ? stored.currentIndex : 0,
    status: stored.status || "idle",
    completedDesignIds: normalizeIdMap(stored.completedDesignIds),
    failedDesignIds: normalizeIdMap(stored.failedDesignIds),
    terminalHandled: normalizeIdMap(stored.terminalHandled),
    processingDesignId: stored.processingDesignId || null,
    currentDesignId: stored.currentDesignId || null,
    processingStartedForCurrentDesign: stored.processingStartedForCurrentDesign === true,
    imageInjectedForCurrentDesign: stored.imageInjectedForCurrentDesign === true,
    hasNavigatedForCurrentDesign: stored.hasNavigatedForCurrentDesign === true,
    successCount: Number.isInteger(stored.successCount) ? stored.successCount : 0,
    failedCount: Number.isInteger(stored.failedCount) ? stored.failedCount : 0
  };
}

async function setQueueState(partialState) {
  await chrome.storage.local.set({
    ...partialState,
    updatedAt: partialState.updatedAt || new Date().toISOString()
  });
}

function normalizeIdMap(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? { ...value } : {};
}

function getTpDesignId(design) {
  return String(design?.id || design?.design_id || "").trim();
}

function isTpDesignTerminal(state, designId) {
  const id = String(designId || "").trim();
  if (!id) return false;
  return Boolean(state.completedDesignIds?.[id] || state.failedDesignIds?.[id] || state.terminalHandled?.[id]);
}

function buildClearedTpPerDesignState() {
  return {
    processingDesignId: null,
    currentDesignId: null,
    processingStartedForCurrentDesign: false,
    imageInjectedForCurrentDesign: false,
    hasNavigatedForCurrentDesign: false,
  };
}



async function updateDesignAt(index, patch) {
  const state = await getQueueState();
  const queue = state.queue.map((design, designIndex) =>
    designIndex === index ? { ...design, ...patch } : design
  );
  await setQueueState({ queue, updatedAt: new Date().toISOString() });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── TeePublic Queue Pipeline ─────────────────────────────────────────────────

const TP_UPLOAD_URL = "https://www.teepublic.com/design/quick_create?auto=1";
const TP_TAB_LOAD_TIMEOUT_MS = 60000;
const TP_CONTENT_TIMEOUT_MS = 300000; // 5 min per design (image upload can be slow)
const TP_UPLOAD_STATE_KEY = "podpilot_teepublic_upload_state";
const TP_NAV_LOCK_STAGES = new Set([
  "injecting_image",
  "image_injected",
  "waiting_image_processing",
  "metadata_fill",
  "publish_click",
]);
const TP_TERMINAL_STAGES = new Set([
  "success_detected",
  "done",
  "stopped",
  "error",
]);

let tpIsProcessing = false;
let tpTabReadyResolver = null;
const tpImagePayloadPromises = new Map();

async function getTpUploadState() {
  const stored = await chrome.storage.local.get({ [TP_UPLOAD_STATE_KEY]: null });
  const state = stored[TP_UPLOAD_STATE_KEY];
  if (state?.active) {
    debugLog("[PodPilot-TP] Loaded TeePublic upload state", {
      stage: state.stage || "",
      imageInjected: state.imageInjected === true,
      designId: state.designId || "",
      currentIndex: state.currentIndex,
    });
  }
  return state && typeof state === "object" ? state : null;
}

async function setTpUploadState(partialState = {}) {
  const previous = await getTpUploadState();
  const now = new Date().toISOString();
  const next = {
    ...(previous || {}),
    ...partialState,
    platform: "teepublic",
    active: partialState.active !== undefined ? partialState.active : true,
    startedAt: previous?.startedAt || partialState.startedAt || now,
    updatedAt: now,
  };
  next.completedDesignIds = normalizeIdMap(next.completedDesignIds);
  next.failedDesignIds = normalizeIdMap(next.failedDesignIds);
  next.terminalHandled = normalizeIdMap(next.terminalHandled);
  await chrome.storage.local.set({ [TP_UPLOAD_STATE_KEY]: next });
  return next;
}

async function clearTpUploadState() {
  await chrome.storage.local.remove(TP_UPLOAD_STATE_KEY);
}

function isTpUploadNavigationLocked(state) {
  if (!state?.active) return false;
  if (TP_TERMINAL_STAGES.has(state.stage)) return false;
  return state.imageInjected === true || TP_NAV_LOCK_STAGES.has(state.stage);
}

async function shouldTreatTpStateAsActiveUpload(state) {
  if (!isTpUploadNavigationLocked(state)) return false;
  const queueState = await getQueueState();
  const isTpQueue = (queueState.marketplace || queueState.queue[0]?.marketplace) === "teepublic";
  const queueActive = ["starting", "running", "paused"].includes(queueState.status);
  return isTpQueue && queueActive;
}

async function shouldBlockTpNavigation({ tabId, targetUrl, reason = "unknown" } = {}) {
  debugLog("[PodPilot-TP] TeePublic navigation requested", { tabId, reason });
  const state = await getTpUploadState();
  if (isTpUploadNavigationLocked(state)) {
    debugLog("[PodPilot-TP] TeePublic navigation skipped: upload already in progress", {
      tabId,
      reason,
      stage: state.stage || "",
      imageInjected: state.imageInjected === true,
    });
    debugLog("[PodPilot-TP] Blocked TeePublic reload after image injection", {
      tabId,
      reason,
    });
    return true;
  }
  debugLog("[PodPilot-TP] TeePublic navigation allowed: initial navigation", {
    tabId,
    reason,
    target: safeUrlForLog(targetUrl),
  });
  return false;
}

function safeUrlForLog(url) {
  try {
    const parsed = new URL(url || "");
    return `${parsed.origin}${parsed.pathname}`;
  } catch (_) {
    return "";
  }
}

function isTpPublishedUrl(url) {
  try {
    const parsed = new URL(url || "");
    if (!/(\.|^)teepublic\.com$/i.test(parsed.hostname)) return false;
    return /^\/[a-z-]+\/\d+-/.test(parsed.pathname);
  } catch (_) {
    return false;
  }
}

async function isStoredTpTabOnPublishedPage(state) {
  const tabId = state?.uploadTabId || (await getQueueState()).uploadTabId;
  if (!tabId) return false;
  try {
    const tab = await chrome.tabs.get(tabId);
    return isTpPublishedUrl(tab?.url);
  } catch (_) {
    return false;
  }
}

function getTpDesignPayloadKey(design) {
  return String(design?.id || design?.design_id || design?.filename || "");
}

function primeTpImagePayload(design) {
  const key = getTpDesignPayloadKey(design);
  if (!key || tpImagePayloadPromises.has(key)) return;
  tpImagePayloadPromises.set(key, prepareTpImagePayload(design).finally(() => {
    setTimeout(() => tpImagePayloadPromises.delete(key), 30000);
  }));
}

async function prepareTpImagePayload(design) {
  const designId = getTpDesignPayloadKey(design);
  const urlTimer = debugTimerStart("signed image URL fetched", {
    marketplace: "teepublic",
    designId,
  });
  const imageUrl = await resolveSignedImageUrl(design);
  debugTimerEnd(urlTimer, { ok: true });

  const payloadTimer = debugTimerStart("image blob/file ready", {
    marketplace: "teepublic",
    designId,
  });
  const imagePayload = await fetchImageAsBase64(imageUrl);
  debugTimerEnd(payloadTimer, {
    ok: true,
    mimeType: imagePayload.mimeType,
    base64Length: imagePayload.base64?.length || 0,
  });
  return imagePayload;
}

async function startTeePublicQueue(designs) {
  if (designs.length === 0) {
    throw new Error("Start TeePublic queue requires at least one design.");
  }

  // ── Subscription / usage gate ─────────────────────────────────────────────
  const platformAccess = await verifyPlatformAccessBeforeQueue("teepublic");
  if (!platformAccess.ok) {
    return blockQueueForPlatformAccess("teepublic", platformAccess);
  }

  const access = await verifyUploadAccessBeforeQueue();
  if (!access.ok) {
    if (access.blocked) {
      const message = buildBlockedMessage(access.summary);
      showBillingBlockNotice({ title: "Upload blocked", message });
      return { ok: false, blocked: true, reason: access.summary?.reason || "blocked", summary: access.summary };
    }
    showBillingBlockNotice({
      title: "Could not verify subscription",
      message: "Could not verify subscription. Please try again.",
    });
    return { ok: false, blocked: false, error: access.error?.message || "verification failed" };
  }

  const queue = designs.map((design, index) => normalizeTpQueueDesign(design, index));

  const invalid = queue.find((d) => !d.image_url && !d.image_r2_key);
  if (invalid) {
    throw new Error(`Design ${invalid.filename || invalid.id} needs an image URL.`);
  }

  const jobId = "job-" + Date.now();
  await setQueueState({
    queue,
    currentIndex: 0,
    status: "running",
    lastError: "",
    marketplace: "teepublic",
    uploadTabId: null,
    uploadTabMarketplace: "teepublic",
    updatedAt: new Date().toISOString(),
    currentJobId: jobId,
    completedDesignIds: {},
    failedDesignIds: {},
    terminalHandled: {},
    processingDesignId: null,
    currentDesignId: null,
    processingStartedForCurrentDesign: false,
    imageInjectedForCurrentDesign: false,
    hasNavigatedForCurrentDesign: false,
    successCount: 0,
    failedCount: 0
  });

  processTpNext();
  return { ok: true, state: await getQueueState() };
}

function normalizeTpQueueDesign(design, index) {
  return {
    ...design,
    id: design.id || design.design_id || `tp-${index}-${Date.now()}`,
    design_id: String(design.id || design.design_id || `tp-${index}-${Date.now()}`),
    filename: String(design.filename || "").trim(),
    image_url: String(design.image_url || "").trim(),
    upload_url: String(design.image_url || "").trim(),
    preview_url: String(design.thumbnail_url || design.image_url || "").trim(),
    thumbnail_url: String(design.thumbnail_url || "").trim(),
    image_r2_key: String(design.image_r2_key || "").trim(),
    title: String(design.title || "").trim(),
    description: String(design.description || "").trim(),
    primary_tag: String(design.primary_tag || design.main_tag || "").trim(),
    supporting_tags: String(design.supporting_tags || "").trim(),
    adult_content: design.adult_content || false,
    color_settings: design.color_settings || {},
    product_settings: design.product_settings || {},
    marketplace: "teepublic",
    status: "pending",
    retryCount: 0,
    error: ""
  };
}

async function processTpNext() {
  if (tpIsProcessing) {
    debugLog("[PodPilot-TP] Already processing, skipping duplicate call");
    return;
  }
  tpIsProcessing = true;
  queueCompletionFired = false;

  try {
    while (true) {
      const state = await getQueueState();
      if (state.status !== "running") break;
      if (state.currentIndex >= state.queue.length) {
        await clearTpUploadState();
        await broadcastQueueComplete();
        break;
      }

      const design = state.queue[state.currentIndex];
      const designId = getTpDesignId(design);
      if (isTpDesignTerminal(state, designId)) {
        debugLog(`[TP Batch] skipping already terminal design_id=${designId}`);
        await setQueueState({
          currentIndex: state.currentIndex + 1,
          updatedAt: new Date().toISOString(),
          ...buildClearedTpPerDesignState(),
        });
        continue;
      }

      debugLog(`[TP Batch] processing index=${state.currentIndex} design_id=${designId}`);
      await setQueueState({
        processingDesignId: designId,
        currentDesignId: designId,
        processingStartedForCurrentDesign: true,
        imageInjectedForCurrentDesign: false,
        hasNavigatedForCurrentDesign: false,
        updatedAt: new Date().toISOString(),
      });
      await updateDesignAt(state.currentIndex, {
        status: "uploading",
        error: "",
        startedAt: new Date().toISOString()
      });

      postDesignStatus(design.id, { status: "uploading" }).catch(() => {});

      const result = await uploadTpDesign(design, state.currentIndex, state.queue.length);
      const isLast = state.currentIndex >= state.queue.length - 1;

      if (result.terminal) {
        const latestTerminalState = await getQueueState();
        if (isTpDesignTerminal(latestTerminalState, designId)) {
          debugLog(`[TP Batch] skipping already terminal design_id=${designId}`);
          if (latestTerminalState.currentIndex === state.currentIndex) {
            await setQueueState({
              currentIndex: state.currentIndex + 1,
              updatedAt: new Date().toISOString(),
              ...buildClearedTpPerDesignState(),
            });
          }
          continue;
        }
      }

      if (result.status === "success") {
        const latestBeforeTerminal = await getQueueState();
        if (isTpDesignTerminal(latestBeforeTerminal, designId)) {
          debugLog(`[TP Batch] duplicate success ignored design_id=${designId}`);
          continue;
        }
        debugLog(`[TP Batch] marking complete design_id=${designId}`);
        const completedDesignIds = normalizeIdMap(latestBeforeTerminal.completedDesignIds);
        const terminalHandled = normalizeIdMap(latestBeforeTerminal.terminalHandled);
        completedDesignIds[designId] = true;
        terminalHandled[designId] = "success";
        const queue = latestBeforeTerminal.queue.map((queuedDesign, index) =>
          index === state.currentIndex
            ? {
                ...queuedDesign,
                status: "done",
                error: "",
                published_url: result.url || "",
                finishedAt: new Date().toISOString(),
              }
            : queuedDesign
        );
        await setQueueState({
          queue,
          completedDesignIds,
          terminalHandled,
          successCount: (latestBeforeTerminal.successCount || 0) + 1,
          currentIndex: state.currentIndex + 1,
          lastError: "",
          updatedAt: new Date().toISOString(),
          ...buildClearedTpPerDesignState(),
        });
        await setTpUploadState({
          active: true,
          designId,
          currentIndex: state.currentIndex + 1,
          stage: "done",
          publishClicked: true,
          imageInjected: false,
          processingDesignId: null,
          currentDesignId: null,
          processingStartedForCurrentDesign: false,
          completedDesignIds,
          failedDesignIds: latestBeforeTerminal.failedDesignIds,
          terminalHandled,
        });
        debugLog(`[TP Batch] saved state currentIndex=${state.currentIndex + 1} completed=true`);
        // Bill one upload for this successful TeePublic design.
        try {
          await self.PodPilotAuth.incrementUploadUsage(1);
        } catch (billingError) {
          console.warn("[Billing] failed to increment usage:", billingError?.message || billingError);
        }
        postDesignStatus(design.id, { status: "uploaded" }).catch(() => {});
        if (isLast) { await broadcastQueueComplete(); break; }
        debugLog(`[TP Batch] navigating quick_create for next index=${state.currentIndex + 1}`);
        await delay(QUEUE_DELAY_MS);
        continue;
      }

      // Retry once
      const latest = await getQueueState();
      const latestDesign = latest.queue[latest.currentIndex] || design;
      if (!result.terminal && (latestDesign.retryCount || 0) < 1 && latest.status === "running") {
        await updateDesignAt(latest.currentIndex, {
          status: "pending",
          retryCount: (latestDesign.retryCount || 0) + 1,
          error: result.error || "Upload failed, retrying"
        });
        await delay(QUEUE_DELAY_MS);
        continue;
      }

      // Mark failed
      const failedDesignId = getTpDesignId(latestDesign);
      const failedDesignIds = normalizeIdMap(latest.failedDesignIds);
      const terminalHandled = normalizeIdMap(latest.terminalHandled);
      failedDesignIds[failedDesignId] = true;
      terminalHandled[failedDesignId] = "failed";
      const failedQueue = latest.queue.map((queuedDesign, index) =>
        index === latest.currentIndex
          ? {
              ...queuedDesign,
              status: "error",
              error: result.error || "Upload failed",
              finishedAt: new Date().toISOString(),
            }
          : queuedDesign
      );
      await setQueueState({
        queue: failedQueue,
        failedDesignIds,
        terminalHandled,
        failedCount: (latest.failedCount || 0) + 1,
        currentIndex: latest.currentIndex + 1,
        lastError: result.error || "Upload failed",
        updatedAt: new Date().toISOString(),
        ...buildClearedTpPerDesignState(),
      });
      await setTpUploadState({
        active: true,
        designId: failedDesignId,
        currentIndex: latest.currentIndex + 1,
        stage: "error",
        imageInjected: false,
        processingDesignId: null,
        currentDesignId: null,
        processingStartedForCurrentDesign: false,
        completedDesignIds: latest.completedDesignIds,
        failedDesignIds,
        terminalHandled,
      });
      postDesignStatus(design.id, {
        status: "failed",
        error_message: result.error || "Upload failed"
      }).catch(() => {});
      if (latest.currentIndex >= latest.queue.length - 1) {
        await broadcastQueueComplete();
        break;
      }
      await delay(QUEUE_DELAY_MS);
    }
  } finally {
    tpIsProcessing = false;
  }
}

async function uploadTpDesign(design, designIndex, queueTotal) {
  try {
    const payloadKey = getTpDesignPayloadKey(design);
    const imagePayloadPromise = tpImagePayloadPromises.get(payloadKey) || prepareTpImagePayload(design);
    const queueState = await getQueueState();
    const designId = getTpDesignId(design);
    if (isTpDesignTerminal(queueState, designId)) {
      debugLog(`[TP Batch] skipping already terminal design_id=${designId}`);
      return { status: "error", terminal: true, error: "Design already terminal-handled." };
    }
    const existingTpState = await getTpUploadState();
    if (!isTpUploadNavigationLocked(existingTpState)) {
      await setTpUploadState({
        active: true,
        platform: "teepublic",
        designId,
        queueId: queueState.currentJobId || existingTpState?.queueId || "",
        currentIndex: designIndex,
        processingDesignId: designId,
        currentDesignId: designId,
        processingStartedForCurrentDesign: true,
        completedDesignIds: queueState.completedDesignIds,
        failedDesignIds: queueState.failedDesignIds,
        terminalHandled: queueState.terminalHandled,
        stage: "navigating",
        imageInjected: false,
      });
    }

    // Use the already-opened upload page from instant start when present.
    const tabNavTimer = debugTimerStart("tab open/navigation duration", {
      marketplace: "teepublic",
      designId: design.id || design.design_id || "",
    });
    const tab = await getUploadTab("teepublic");
    debugLog("[PodPilot Timing] tab opened", {
      marketplace: "teepublic",
      tabId: tab.id,
    });

    // Do not wait for a full tab load. TeePublic is ready for image
    // injection as soon as the file input or title input exists.
    const tpState = await getTpUploadState();
    const alreadyNavigatingThisUpload = tpState?.active &&
      tpState.stage === "navigating" &&
      tpState.initialNavigationStarted === true &&
      tpState.uploadTabId === tab.id &&
      (tpState.designId === (design.id || design.design_id || "") || !tpState.designId);
    if (isSameNavigationTarget(tab.url, TP_UPLOAD_URL)) {
      debugLog("[PodPilot-TP] TeePublic navigation skipped: tab already on upload page", {
        tabId: tab.id,
      });
    } else if (alreadyNavigatingThisUpload) {
      debugLog("[PodPilot-TP] TeePublic navigation skipped: initial navigation already in progress", {
        tabId: tab.id,
        current: safeUrlForLog(tab.url),
      });
    } else {
      await navigateTab(tab.id, TP_UPLOAD_URL, {
        cacheBust: false,
        marketplace: "teepublic",
        waitForComplete: false,
      });
    }
    debugTimerEnd(tabNavTimer, { tabId: tab.id });

    const contentReadyTimer = debugTimerStart("content script ready duration", {
      marketplace: "teepublic",
      tabId: tab.id,
    });
    const readyState = await waitForTpUploadPageReady(tab.id);
    debugTimerEnd(contentReadyTimer, { ok: true, ...readyState });
    await setTpUploadState({
      active: true,
      designId,
      currentIndex: designIndex,
      processingDesignId: designId,
      currentDesignId: designId,
      processingStartedForCurrentDesign: true,
      completedDesignIds: (await getQueueState()).completedDesignIds,
      failedDesignIds: (await getQueueState()).failedDesignIds,
      terminalHandled: (await getQueueState()).terminalHandled,
      stage: "page_ready",
      imageInjected: false,
    });

    const imagePayload = await imagePayloadPromise;
    const latestBeforeInjection = await getQueueState();
    if (isTpDesignTerminal(latestBeforeInjection, designId)) {
      debugLog(`[TP Batch] skipping already terminal design_id=${designId}`);
      return { status: "error", terminal: true, error: "Design already terminal-handled." };
    }

    const successPromise = waitForTpSuccessUrl(tab.id, 60000);

    const contentPromise = sendTpFillMessage(tab.id, {
      action: "tp_fill_and_publish",
      design: {
        ...design,
        image_url: "", // don't send URL to content, send base64
        imageBase64: imagePayload.base64,
      },
      designIndex,
      queueTotal,
    }).catch((error) => {
      console.warn("Content script message ended before final response:", error.message);
      return { status: "error", error: error.message };
    });

    const firstOutcome = await Promise.race([
      successPromise.then((urlResult) =>
        urlResult.success
          ? { outcome: "success", url: urlResult.url || "" }
          : { outcome: "timeout" }
      ),
      contentPromise.then((response) =>
        response && response.status === "success"
          ? { outcome: "success", url: response.url || "" }
          : { outcome: "content_done", error: response?.error || "Unknown error" }
      )
    ]);

    if (firstOutcome && firstOutcome.outcome === "success") {
      await setTpUploadState({
        active: true,
        designId,
        currentIndex: designIndex,
        stage: "success_detected",
        publishClicked: true,
        imageInjected: true,
      });
      return { status: "success", url: firstOutcome.url || "" };
    }

    const outcome = await successPromise;
    if (outcome && outcome.success) {
      await setTpUploadState({
        active: true,
        designId,
        currentIndex: designIndex,
        stage: "success_detected",
        publishClicked: true,
        imageInjected: true,
      });
      return { status: "success", url: outcome.url || "" };
    }

    const contentResult = await contentPromise;
    await setTpUploadState({
      active: true,
      designId: design.id || design.design_id || "",
      currentIndex: designIndex,
      stage: "error",
      imageInjected: false,
    });
    return { status: "error", error: contentResult?.error || "Timed out waiting for TeePublic publish confirmation" };
  } catch (error) {
    await setTpUploadState({
      active: true,
      designId: design.id || design.design_id || "",
      currentIndex: designIndex,
      stage: "error",
      imageInjected: false,
    }).catch(() => {});
    return { status: "error", error: error.message };
  }
}

async function waitForTpContentReady(tabId, timeoutMs = 30000) {
  await waitForTpUploadPageReady(tabId, timeoutMs);
}

async function waitForTpUploadPageReady(tabId, timeoutMs = 30000, intervalMs = 150) {
  const start = Date.now();
  let lastErrorMessage = "";
  while (Date.now() - start < timeoutMs) {
    try {
      const response = await new Promise((resolve) => {
        chrome.tabs.sendMessage(tabId, { action: "tp_upload_page_ready" }, (reply) => {
          if (chrome.runtime.lastError) {
            lastErrorMessage = chrome.runtime.lastError.message || "";
            resolve(null);
            return;
          }
          resolve(reply);
        });
      });
      if (response?.ok && response.ready) {
        debugLog("[PodPilot Timing] file input found", {
          marketplace: "teepublic",
          tabId,
          fileInputReady: response.fileInputReady === true,
          titleReady: response.titleReady === true,
        });
        return response;
      }
    } catch (error) {
      lastErrorMessage = error?.message || String(error);
    }
    await delay(intervalMs);
  }
  const detail = lastErrorMessage ? ` (last error: ${lastErrorMessage})` : "";
  throw new Error(`TeePublic upload page was not ready within 30s${detail}`);
}

function sendTpFillMessage(tabId, message) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      resolve({ status: "error", error: "Content script response timeout (5min)" });
    }, TP_CONTENT_TIMEOUT_MS);

    chrome.tabs.sendMessage(tabId, message, (response) => {
      clearTimeout(timeout);
      if (chrome.runtime.lastError) {
        resolve({ status: "error", error: chrome.runtime.lastError.message });
        return;
      }
      resolve(response || { status: "error", error: "No response from content script" });
    });
  });
}

function waitForTpSuccessUrl(tabId, timeoutMs = 60000) {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => finish({ success: false }), timeoutMs);

    function finish(result) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(listener);
      resolve(result);
    }

    function checkUrl(url) {
      if (!url) return;
      if (url.includes('teepublic.com/account/uploads/active')) {
        finish({ success: true, url });
        return;
      }
      const match = url.match(/teepublic\.com\/([a-z-]+)\/(\d+)-/);
      if (match) {
        const productType = match[1];
        const TYPES = [
          't-shirt','hoodie','tank','tank-top','crewneck','long-sleeve','baseball-tee',
          'kids-t-shirt','kids-hoodie','kids-long-sleeve-t-shirt',
          'hat','hats','short','shorts','bag','bags','sticker','stickers','case','cases',
          'mug','mugs','wall-art','pillow','pillows','tote','totes','tapestry','tapestries',
          'pin','pins','magnet','magnets','sock','socks'
        ];
        if (TYPES.includes(productType)) {
          finish({ success: true, url });
        }
      }
    }

    function listener(updatedTabId, changeInfo, tab) {
      if (updatedTabId !== tabId) return;
      checkUrl(changeInfo.url);
      checkUrl(tab?.url);
    }

    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.get(tabId, (tab) => {
      if (!chrome.runtime.lastError) checkUrl(tab?.url);
    });
  });
}

async function handleTpTabReady(message, sender) {
  debugLog("[TP NAV] teepublicTabLoaded received");
  const tabId = sender?.tab?.id;
  const state = await getTpUploadState();
  if (state?.active && tabId) {
    debugLog("[PodPilot-TP] Resuming TeePublic upload from stage:", state.stage || "");
    chrome.tabs.sendMessage(
      tabId,
      { action: "tp_resume_upload_state", state },
      () => { void chrome.runtime.lastError; }
    );
  }
  // Content script on TeePublic page signals it's ready
  if (tpTabReadyResolver) {
    debugLog("[TP NAV] Resolving tpTabReadyResolver");
    tpTabReadyResolver();
    tpTabReadyResolver = null;
  } else {
    debugLog("[TP NAV] duplicate tabLoaded ignored/resumed");
  }
}
