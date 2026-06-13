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

// ─── PodPilot Extension — MerchGhost-style UI ────────────────────────────────
// Views: loading → login → dashboard
// Dashboard: Redbubble / TeePublic tabs, table with pagination, account dropdown

// ── Elements ───────────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);

const loadingView = $("loadingView");
const loginView = $("loginView");
const dashboardView = $("dashboardView");

const loginForm = $("loginForm");
const loginEmail = $("loginEmail");
const loginPassword = $("loginPassword");
const loginBtn = $("loginBtn");
const googleLoginBtn = $("googleLoginBtn");
const loginError = $("loginError");

const designCountLabel = $("designCountLabel");
const refreshBtn = $("refreshBtn");
const accountBtn = $("accountBtn");
const accountName = $("accountName");
const accountMenu = $("accountMenu");
const menuEmail = $("menuEmail");
const menuPlan = $("menuPlan");
const menuStatus = $("menuStatus");
const menuUploads = $("menuUploads");
const menuDailyTokens = $("menuDailyTokens");
const menuExtraTokens = $("menuExtraTokens");
const billingBanner = $("billingBanner");
const signOutBtn = $("signOutBtn");

const searchInput = $("searchInput");
const filterSelect = $("filterSelect");
const uploadBtn = $("uploadBtn");
const uploadBtnLabel = uploadBtn?.querySelector(".upload-btn-label");
const uploadLaunchPanel = $("uploadLaunchPanel");
const uploadLaunchTitle = $("uploadLaunchTitle");
const uploadLaunchMeta = $("uploadLaunchMeta");
const backgroundUploadToggle = $("backgroundUploadToggle");
const selectAll = $("selectAll");
const tableBody = $("tableBody");

const totalLabel = $("totalLabel");
const selectedLabel = $("selectedLabel");
const pageLabel = $("pageLabel");
const prevPage = $("prevPage");
const nextPage = $("nextPage");
const rowsPerPage = $("rowsPerPage");

// Toast elements
const ppToast = $("ppToast");
const ppToastTitle = $("ppToastTitle");
const ppToastMessage = $("ppToastMessage");
const ppToastClose = $("ppToastClose");
let ppToastTimer = null;
let uploadSettings = { runUploadsInBackground: true };

function showUploadToast(summary) {
  if (!ppToast) return;
  const total = Number.isFinite(summary?.total) ? summary.total : 0;
  const success = Number.isFinite(summary?.success) ? summary.success : 0;
  const failed = Number.isFinite(summary?.failed) ? summary.failed : Math.max(0, total - success);
  const platform = summary?.marketplace === "teepublic" ? "TeePublic" : "Redbubble";
  if (ppToastTitle) ppToastTitle.textContent = "Upload Complete";
  if (ppToastMessage) {
    ppToastMessage.textContent = `${platform}: ${success} uploaded, ${failed} failed.`;
  }
  ppToast.hidden = false;
  // Force reflow so the show animation runs.
  void ppToast.offsetWidth;
  ppToast.classList.add("is-visible");
  if (ppToastTimer) clearTimeout(ppToastTimer);
  ppToastTimer = setTimeout(hideUploadToast, 6000);
}

function hideUploadToast() {
  if (!ppToast) return;
  ppToast.classList.remove("is-visible");
  setTimeout(() => { ppToast.hidden = true; }, 200);
  if (ppToastTimer) { clearTimeout(ppToastTimer); ppToastTimer = null; }
}

// ── Hover preview ──────────────────────────────────────────────────────────
// Floating image card shown when the user hovers a row thumbnail. Uses a
// single shared element (#hoverPreview) so we never spawn one per row.
const hoverPreview = $("hoverPreview");
const hoverPreviewImg = $("hoverPreviewImg");
let hoverHideTimer = null;

function positionHoverPreview(clientX, clientY) {
  if (!hoverPreview) return;
  const margin = 12;
  const w = hoverPreview.offsetWidth || 240;
  const h = hoverPreview.offsetHeight || 240;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  // Default: to the right of the cursor, vertically centered on it.
  let left = clientX + 16;
  let top = clientY - h / 2;
  // If it would clip the right edge, flip to the left of the cursor.
  if (left + w + margin > vw) left = clientX - w - 16;
  // Clamp inside viewport.
  if (left < margin) left = margin;
  if (top < margin) top = margin;
  if (top + h + margin > vh) top = vh - h - margin;
  hoverPreview.style.left = `${Math.round(left)}px`;
  hoverPreview.style.top = `${Math.round(top)}px`;
}

function resolvePreviewUrl(imageUrl) {
  return typeof imageUrl === "function" ? imageUrl() : imageUrl;
}

function attachHoverPreview(thumbEl, imageUrl) {
  if (!thumbEl || !imageUrl || !hoverPreview || !hoverPreviewImg) return;
  thumbEl.addEventListener("mouseenter", (e) => {
    if (hoverHideTimer) { clearTimeout(hoverHideTimer); hoverHideTimer = null; }
    hoverPreview.hidden = false;
    positionHoverPreview(e.clientX, e.clientY);
    // Next frame so the transition runs.
    requestAnimationFrame(() => hoverPreview.classList.add("visible"));
    Promise.resolve(resolvePreviewUrl(imageUrl)).then((nextUrl) => {

const totalLabel = $("totalLabel");
const selectedLabel = $("selectedLabel");
const pageLabel = $("pageLabel");
const prevPage = $("prevPage");
const nextPage = $("nextPage");
const rowsPerPage = $("rowsPerPage");

// Toast elements
const ppToast = $("ppToast");
const ppToastTitle = $("ppToastTitle");
const ppToastMessage = $("ppToastMessage");
const ppToastClose = $("ppToastClose");
let ppToastTimer = null;
let uploadSettings = { runUploadsInBackground: true };

function showUploadToast(summary) {
  if (!ppToast) return;
  const total = Number.isFinite(summary?.total) ? summary.total : 0;
  const success = Number.isFinite(summary?.success) ? summary.success : 0;
  const failed = Number.isFinite(summary?.failed) ? summary.failed : Math.max(0, total - success);
  const platform = summary?.marketplace === "teepublic" ? "TeePublic" : "Redbubble";
  if (ppToastTitle) ppToastTitle.textContent = "Upload Complete";
  if (ppToastMessage) {
    ppToastMessage.textContent = `${platform}: ${success} uploaded, ${failed} failed.`;
  }
  ppToast.hidden = false;
  // Force reflow so the show animation runs.
  void ppToast.offsetWidth;
  ppToast.classList.add("is-visible");
  if (ppToastTimer) clearTimeout(ppToastTimer);
  ppToastTimer = setTimeout(hideUploadToast, 6000);
}

function hideUploadToast() {
  if (!ppToast) return;
  ppToast.classList.remove("is-visible");
  setTimeout(() => { ppToast.hidden = true; }, 200);
  if (ppToastTimer) { clearTimeout(ppToastTimer); ppToastTimer = null; }
}

// ── Hover preview ──────────────────────────────────────────────────────────
// Floating image card shown when the user hovers a row thumbnail. Uses a
// single shared element (#hoverPreview) so we never spawn one per row.
const hoverPreview = $("hoverPreview");
const hoverPreviewImg = $("hoverPreviewImg");
let hoverHideTimer = null;

function positionHoverPreview(clientX, clientY) {
  if (!hoverPreview) return;
  const margin = 12;
  const w = hoverPreview.offsetWidth || 240;
  const h = hoverPreview.offsetHeight || 240;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  // Default: to the right of the cursor, vertically centered on it.
  let left = clientX + 16;
  let top = clientY - h / 2;
  // If it would clip the right edge, flip to the left of the cursor.
  if (left + w + margin > vw) left = clientX - w - 16;
  // Clamp inside viewport.
  if (left < margin) left = margin;
  if (top < margin) top = margin;
  if (top + h + margin > vh) top = vh - h - margin;
  hoverPreview.style.left = `${Math.round(left)}px`;
  hoverPreview.style.top = `${Math.round(top)}px`;
}

function resolvePreviewUrl(imageUrl) {
  return typeof imageUrl === "function" ? imageUrl() : imageUrl;
}

function attachHoverPreview(thumbEl, imageUrl) {
  if (!thumbEl || !imageUrl || !hoverPreview || !hoverPreviewImg) return;
  thumbEl.addEventListener("mouseenter", (e) => {
    if (hoverHideTimer) { clearTimeout(hoverHideTimer); hoverHideTimer = null; }
    hoverPreview.hidden = false;
    positionHoverPreview(e.clientX, e.clientY);
    // Next frame so the transition runs.
    requestAnimationFrame(() => hoverPreview.classList.add("visible"));
    Promise.resolve(resolvePreviewUrl(imageUrl)).then((nextUrl) => {
      if (!nextUrl || hoverPreview.hidden) return;
      // Only swap src if it changed, to keep cached image instant.
      if (hoverPreviewImg.src !== nextUrl) hoverPreviewImg.src = nextUrl;
    });
  });
  thumbEl.addEventListener("mousemove", (e) => {
    positionHoverPreview(e.clientX, e.clientY);
  });
  thumbEl.addEventListener("mouseleave", () => {
    hoverPreview.classList.remove("visible");
    if (hoverHideTimer) clearTimeout(hoverHideTimer);
    hoverHideTimer = setTimeout(() => {
      hoverPreview.hidden = true;
      hoverHideTimer = null;
    }, 120);
  });
}
      if (!nextUrl || hoverPreview.hidden) return;
      // Only swap src if it changed, to keep cached image instant.
      if (hoverPreviewImg.src !== nextUrl) hoverPreviewImg.src = nextUrl;
    });
  });
  thumbEl.addEventListener("mousemove", (e) => {
    positionHoverPreview(e.clientX, e.clientY);
  });
  thumbEl.addEventListener("mouseleave", () => {
    hoverPreview.classList.remove("visible");
    if (hoverHideTimer) clearTimeout(hoverHideTimer);
    hoverHideTimer = setTimeout(() => {
      hoverPreview.hidden = true;
      hoverHideTimer = null;
    }, 120);
  });
}

if (ppToastClose) ppToastClose.addEventListener("click", hideUploadToast);

function showConnectionWarning(message) {
  if (!ppToast) return;
  if (ppToastTitle) ppToastTitle.textContent = "Connection problem";
  if (ppToastMessage) ppToastMessage.textContent = message;
  ppToast.hidden = false;
  void ppToast.offsetWidth;
  ppToast.classList.add("is-visible");
  if (ppToastTimer) clearTimeout(ppToastTimer);
  ppToastTimer = setTimeout(hideUploadToast, 6000);
}


// ── State ──────────────────────────────────────────────────────────────────
let allDesigns = [];
let activeTab = "redbubble";
let selectedIds = new Set();
let page = 1;
let perPage = 10;
let queueState = { queue: [], currentIndex: 0, status: "idle", lastError: "" };
let pollId = null;
let dataPollId = null;
let subscriptionInfo = null; // last loaded /api/me/subscription payload
let trialEligibility = null;
let isUploadGateBlocking = false;
let uploadGateMessage = "";
let platformAccess = normalizePlatformAccess(null);
let accessStatus = "loading";
let accessMessage = "";
let currentUserId = "";
let lastRenderSignature = "";
const cacheStatusLabel = $("cacheStatusLabel");
const ACCESS_CACHE_TTL_MS = 10 * 60 * 1000;

function releasePopupImageObjectUrls() {
  try {
    window.PodPilotImageCache?.revokeAllObjectUrls?.();
  } catch (_) {
    // Best-effort cleanup for popup-scoped blob URLs.
  }
}

window.addEventListener("pagehide", releasePopupImageObjectUrls);
window.addEventListener("unload", releasePopupImageObjectUrls);

function mapDesignToCache(d) {
  return {
    id: d.id,
    design_id: d.design_id || d.id,
    title: d.title || "",
    filename: d.filename || "",
    description: d.description || "",
    main_tag: d.main_tag || "",
    primary_tag: d.primary_tag || "",
    status: d.status || "",
    marketplace: d.marketplace || "redbubble",
    thumbnail_url: d.thumbnail_url || "",
    image_url: d.image_url || "",
    upload_url: d.upload_url || "",
    preview_url: d.preview_url || "",
    thumbnail_r2_key: d.thumbnail_r2_key || "",
    image_r2_key: d.image_r2_key || "",
    updated_at: d.updated_at || "",
    created_at: d.created_at || "",
  };
}

function getDesignCacheKey(userId, platform) {
  return `podpilot:designs:${platform}:${userId}`;
}

function getCachedDesigns(userId, platform) {
  return new Promise((resolve) => {
    const key = getDesignCacheKey(userId, platform);
    chrome.storage.local.get([key], (result) => {
      resolve(result[key] || null);
    });
  });
}

function setCachedDesigns(userId, platform, designs) {
  return new Promise((resolve, reject) => {
    const key = getDesignCacheKey(userId, platform);
    const lightweightDesigns = Array.isArray(designs) ? designs.map(mapDesignToCache) : [];
    const cacheObj = {
      userId,
      platform,
      designs: lightweightDesigns,
      cached_at: Date.now(),
    };
    chrome.storage.local.set({ [key]: cacheObj }, () => {
      const err = chrome.runtime.lastError;
      if (err) reject(err);
      else resolve();
    });
  });
}

function clearCachedDesigns(userId) {
  return new Promise((resolve) => {
    if (!userId) { resolve(); return; }
    const rbKey = getDesignCacheKey(userId, "redbubble");
    const tpKey = getDesignCacheKey(userId, "teepublic");
    chrome.storage.local.remove([rbKey, tpKey], () => {
      resolve();
    });
  });
}

function showCacheStatusLabel(text, tone = "info") {
  if (!cacheStatusLabel) return;
  cacheStatusLabel.textContent = text;
  if (tone === "warning") {
    cacheStatusLabel.style.color = "#f59e0b"; // Premium amber/orange
  } else {
    cacheStatusLabel.style.color = "#8b5cf6"; // Premium purple
  }
  cacheStatusLabel.hidden = false;
}

function hideCacheStatusLabel() {
  if (cacheStatusLabel) cacheStatusLabel.hidden = true;
}

let isInitialLoadingDesigns = true;
let isRefreshingDesigns = false;
let lastDesignFetchFailed = false;
let isUploadLaunching = false;
let designsLoadedByPlatform = {
  redbubble: false,
  teepublic: false,
};

const PLAN_LABELS = {
  redbubble: "Redbubble Plan",
  teepublic: "TeePublic Plan",
  all_platforms: "All Platforms Plan",
};

const STATUS_LABELS = {
  trialing: { text: "Trial active", tone: "info" },
  active: { text: "Active", tone: "success" },
  past_due: { text: "Payment issue", tone: "danger" },
  paused: { text: "Paused", tone: "warning" },
  canceled: { text: "Canceled", tone: "warning" },
  inactive: { text: "No active subscription", tone: "warning" },
};

function planLabel(plan) {
  const key = String(plan || "").toLowerCase();
  return PLAN_LABELS[key] || "No active plan";
}

function statusLabel(status) {
  const key = String(status || "").toLowerCase();
  return STATUS_LABELS[key] || { text: status || "Unknown", tone: "warning" };
}

function normalizePlatformAccess(raw) {
  return {
    has_active_plan: Boolean(raw?.has_active_plan),
    plan: raw?.plan || null,
    redbubble: raw?.redbubble === true,
    teepublic: raw?.teepublic === true,
  };
}

function platformLabel(platform = activeTab) {
  return platform === "teepublic" ? "TeePublic" : "Redbubble";
}

function getPodPilotSiteUrl(path = "/pricing") {
  return `https://podpilot.space${path}`;
}

function openPodPilotSite(path = "/pricing") {
  chrome.tabs.create({ url: getPodPilotSiteUrl(path) });
}

function setUploadLaunchLoading(isLoading, label = "Starting") {
  isUploadLaunching = Boolean(isLoading);
  if (!uploadBtn) return;
  uploadBtn.classList.toggle("is-loading", isUploadLaunching);
  uploadBtn.setAttribute("aria-busy", isUploadLaunching ? "true" : "false");
  if (uploadBtnLabel) uploadBtnLabel.textContent = isUploadLaunching ? label : "Upload";
}

function showUploadLaunchPanel({ title = "Preparing upload", meta = "Checking selected designs..." } = {}) {
  if (!uploadLaunchPanel) return;
  if (uploadLaunchTitle) uploadLaunchTitle.textContent = title;
  if (uploadLaunchMeta) uploadLaunchMeta.textContent = meta;
  uploadLaunchPanel.hidden = false;
  void uploadLaunchPanel.offsetWidth;
  uploadLaunchPanel.classList.add("is-visible");
}

function updateUploadLaunchPanel({ title, meta } = {}) {
  if (title && uploadLaunchTitle) uploadLaunchTitle.textContent = title;
  if (meta && uploadLaunchMeta) uploadLaunchMeta.textContent = meta;
}

function hideUploadLaunchPanel() {
  if (!uploadLaunchPanel) return;
  uploadLaunchPanel.classList.remove("is-visible");
  uploadLaunchPanel.hidden = true;
}

function resetUploadLaunchState() {
  setUploadLaunchLoading(false);
  hideUploadLaunchPanel();
}

function splitDesignsByPlatform(designs = []) {
  return {
    redbubble: designs.filter((d) => (d.marketplace || "redbubble") === "redbubble"),
    teepublic: designs.filter((d) => d.marketplace === "teepublic"),
  };
}

function hasLoadedPlatform(platform = activeTab) {
  return designsLoadedByPlatform[platform] === true;
}

function setRefreshButtonLoading(isLoading) {
  if (!refreshBtn) return;
  refreshBtn.classList.toggle("is-refreshing", Boolean(isLoading));
  refreshBtn.setAttribute("aria-busy", isLoading ? "true" : "false");
}

function setInitialDesignLoadingChrome() {
  if (designCountLabel) designCountLabel.textContent = "Loading designs...";
  if (tableBody) {
    tableBody.innerHTML = `<div class="table-empty table-loading">Loading designs...</div>`;
  }
}

function platformLockedMessage(platform = activeTab) {
  if (accessStatus === "loading") return "Checking access...";
  if (accessStatus === "error") return accessMessage || "Could not verify access.";
  if (!platformAccess?.has_active_plan) {
    return "You do not have an active subscription. Open PodPilot to choose a plan.";
  }
  return `${platformLabel(platform)} is locked for your current plan. Upgrade to continue.`;
}

function isPlatformLocked(platform = activeTab) {
  if (accessStatus === "loading" || accessStatus === "error") return false;
  if (accessStatus === "inactive") return true;
  return platformAccess?.[platform] !== true;
}

function updatePlatformTabs() {
  document.querySelectorAll(".nav-pill[data-tab]").forEach((btn) => {
    const locked = isPlatformLocked(btn.dataset.tab);
    btn.classList.toggle("disabled", locked);
    btn.disabled = false;
    btn.title = locked ? platformLockedMessage(btn.dataset.tab) : "";
    btn.setAttribute("aria-disabled", locked ? "true" : "false");
  });
}

function setBillingBannerMessage(message, { tone = "danger", cta = false, retry = false, compact = false } = {}) {
  if (!billingBanner) return;
  billingBanner.className = `billing-banner billing-banner-${tone}${compact ? " billing-banner-compact" : ""}`;
  billingBanner.textContent = "";
  if (compact) {
    const spinner = document.createElement("span");
    spinner.className = "billing-banner-spinner";
    spinner.setAttribute("aria-hidden", "true");
    billingBanner.appendChild(spinner);
  }
  const text = document.createElement("span");
  text.textContent = message;
  billingBanner.appendChild(text);
  if (cta) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "billing-banner-action";
    button.textContent = "Open PodPilot";
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      openPodPilotSite("/pricing");
    });
    billingBanner.appendChild(button);
  }
  if (retry) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "billing-banner-action billing-banner-action-secondary";
    button.textContent = "Retry";
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      void loadPlatformAccess({ preferCache: false });
    });
    billingBanner.appendChild(button);
  }
  billingBanner.hidden = false;
}

function selectActiveTab(nextTab) {
  activeTab = nextTab;
  document.querySelectorAll(".nav-pill[data-tab]").forEach((b) => {
    b.classList.toggle("active", b.dataset.tab === activeTab);
  });
}

function chooseAvailableTab() {
  updatePlatformTabs();
}


function formatNumber(n) {
  if (!Number.isFinite(n)) return "0";
  return n.toLocaleString();
}

function setLoadingAccountUI() {
  if (menuPlan) menuPlan.textContent = "Loading account...";
  if (menuStatus) {
    menuStatus.textContent = "—";
    menuStatus.className = "menu-status-badge";
  }
  if (menuUploads) menuUploads.textContent = "—";
  if (menuDailyTokens) menuDailyTokens.textContent = "—";
  if (menuExtraTokens) menuExtraTokens.textContent = "—";
}

function renderAccountFromSubscription(summary) {
  // Email is set elsewhere (enterDashboard); only render plan/status/usage.
  if (!menuPlan) return;
  if (!summary) {
    menuPlan.textContent = "No active plan";
    if (menuStatus) {
      menuStatus.textContent = "Unknown";
      menuStatus.className = "menu-status-badge menu-status-warning";
    }
    if (menuUploads) menuUploads.textContent = "—";
    if (menuDailyTokens) menuDailyTokens.textContent = "—";
    if (menuExtraTokens) menuExtraTokens.textContent = "—";
    return;
  }

  const plan = summary.plan;
  const status = summary.status;
  const hasSub = summary.has_subscription;

  menuPlan.textContent = planLabel(plan);
  if (menuStatus) {
    const label = statusLabel(status);
    menuStatus.textContent = label.text;
    menuStatus.className = `menu-status-badge menu-status-${label.tone}`;
  }
  if (menuUploads) {
    menuUploads.textContent = hasSub ? "Unlimited" : "—";
  }
  if (menuDailyTokens) {
    menuDailyTokens.textContent = hasSub ? `${summary.daily_ai_tokens_remaining ?? 0} / ${summary.daily_ai_tokens_limit ?? 0}` : "—";
  }
  if (menuExtraTokens) {
    menuExtraTokens.textContent = hasSub ? formatNumber(summary.ai_tokens || 0) : "—";
  }
}

function renderAccessBanner() {
  if (!billingBanner) return;
  isUploadGateBlocking = false;
  uploadGateMessage = "";

  if (accessStatus === "loading") {
    setBillingBannerMessage("Checking access...", { tone: "info", compact: true });
    return;
  }

  if (accessStatus === "error") {
    uploadGateMessage = accessMessage || "Could not verify access. Please refresh or open PodPilot.";
    setBillingBannerMessage(uploadGateMessage, { tone: "warning", retry: true, cta: true });
    return;
  }

  if (accessStatus === "inactive") {
    uploadGateMessage = "You do not have an active subscription. Open PodPilot to choose a plan.";
    setBillingBannerMessage(uploadGateMessage, { tone: "danger", cta: true });
    isUploadGateBlocking = true;
    return;
  }

  billingBanner.hidden = true;
  billingBanner.textContent = "";
}

async function loadAccountUser() {
  if (!PodPilotAuth?.getCurrentUser) return null;
  try {
    const user = await PodPilotAuth.getCurrentUser();
    if (!user) {
      if (menuEmail) menuEmail.textContent = "Signed in";
      currentUserId = "";
      return null;
    }
    currentUserId = user.id || "";
    const email = user.email || "";
    if (email) {
      debugLog("[Extension Account] user email=" + email);
      menuEmail.textContent = email;
      const truncated = email.length > 16 ? email.slice(0, 14) + "..." : email;
      accountName.textContent = truncated;
    } else if (menuEmail.textContent === "Loading...") {
      // Last-resort placeholder so the UI doesn't say "Loading..." forever.
      menuEmail.textContent = "Signed in";
    }
    return user;
  } catch (error) {
    console.warn(
      "[Extension Account] failed to load user email",
      error?.message || error,
    );
    if (menuEmail && menuEmail.textContent === "Loading...") {
      menuEmail.textContent = "Signed in";
    }
    return null;
  }
}

async function loadSubscription() {
  if (!PodPilotAuth?.getSubscriptionStatus) {
    return null;
  }
  try {
    const summary = await PodPilotAuth.getSubscriptionStatus();
    subscriptionInfo = summary || null;
    if ((!summary || summary?.can_upload === false) && PodPilotAuth?.getTrialEligibility) {
      trialEligibility = await PodPilotAuth.getTrialEligibility();
    } else {
      trialEligibility = null;
    }
    renderAccountFromSubscription(summary);
    if (summary) {
      debugLog(
        "[Extension Account] plan=" + (summary.plan || "(none)") +
        " status=" + (summary.status || "(none)"),
      );
    }
    // Re-render so the upload button picks up the new gate state.
    if (typeof render === "function") render();
    return summary;
  } catch (error) {
    console.warn("[Extension Account] subscription load failed", error?.message || error);
    subscriptionInfo = null;
    trialEligibility = null;
    renderAccountFromSubscription(null);
    return null;
  }
}

// ── View switching ─────────────────────────────────────────────────────────
async function hydrateCachedAccess() {
  accessStatus = "loading";
  accessMessage = "";
  platformAccess = normalizePlatformAccess(null);
  if (!PodPilotAuth?.getCachedActivePlatformAccess) {
    renderAccessBanner();
    updatePlatformTabs();
    return null;
  }
  try {
    const cached = await PodPilotAuth.getCachedActivePlatformAccess(ACCESS_CACHE_TTL_MS);
    if (cached?.has_active_plan) {
      platformAccess = normalizePlatformAccess(cached);
      accessStatus = "active";
      renderAccessBanner();
      updatePlatformTabs();
      return platformAccess;
    }
  } catch (error) {
    console.warn("[Extension Account] cached platform access load failed", error?.message || error);
  }
  renderAccessBanner();
  updatePlatformTabs();
  return null;
}

async function loadPlatformAccess({ preferCache = true } = {}) {
  if (preferCache) {
    await hydrateCachedAccess();
  } else {
    accessStatus = "loading";
    accessMessage = "";
    renderAccessBanner();
    updatePlatformTabs();
    if (typeof render === "function") render();
  }

  try {
    if (typeof PodPilotAuth?.refreshPlatformAccess !== "function") {
      throw new Error("Could not verify access.");
    }
    platformAccess = normalizePlatformAccess(await PodPilotAuth.refreshPlatformAccess());
    accessStatus = platformAccess.has_active_plan ? "active" : "inactive";
    accessMessage = "";
  } catch (error) {
    console.warn("[Extension Account] platform access load failed", error?.message || error);
    accessStatus = "error";
    const requestId = error?.requestId ||
      String(error?.message || "").match(/Request ID:\s*([A-Za-z0-9._-]+)/)?.[1] ||
      "";
    accessMessage = `Could not verify access. Please refresh or open PodPilot.${requestId ? ` Request ID: ${requestId}` : ""}`;
  }
  renderAccessBanner();
  chooseAvailableTab();
  updatePlatformTabs();
  if (typeof render === "function") render();
  return platformAccess;
}

function showView(name) {
  loadingView.hidden = name !== "loading";
  loginView.hidden = name !== "login";
  dashboardView.hidden = name !== "dashboard";
}

// ── Boot ───────────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", async () => {
  debugLog("[EXT THUMB] popup opened");
  loginForm.addEventListener("submit", handleSignIn);
  
  googleLoginBtn.addEventListener("click", () => {
    chrome.tabs.create({ url: "https://podpilot.space/login?source=extension" });
  });

  // Listen for session adopted events broadcasted by background.js
  chrome.runtime.onMessage.addListener((message) => {
    if (message.action === "session_adopted") {
      enterDashboard(message.session);
    }
  });
  signOutBtn.addEventListener("click", handleSignOut);
  refreshBtn.addEventListener("click", refreshAll);
  searchInput.addEventListener("input", () => { page = 1; render(); });
  filterSelect.addEventListener("change", () => { page = 1; render(); });
  uploadBtn.addEventListener("click", handleUpload);
  backgroundUploadToggle?.addEventListener("change", async () => {
    uploadSettings = { runUploadsInBackground: backgroundUploadToggle.checked };
    await chrome.storage.local.set({ uploadSettings });
  });
  selectAll.addEventListener("change", handleSelectAll);
  prevPage.addEventListener("click", () => { if (page > 1) { page--; render(); } });
  nextPage.addEventListener("click", () => { if (page < totalPages()) { page++; render(); } });
  rowsPerPage.addEventListener("change", () => { perPage = +rowsPerPage.value; page = 1; render(); });

  // Account dropdown toggle
  accountBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    accountMenu.hidden = !accountMenu.hidden;
  });
  document.addEventListener("click", () => { accountMenu.hidden = true; });

  // Tab buttons
  document.querySelectorAll(".nav-pill[data-tab]").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (isPlatformLocked(btn.dataset.tab)) {
        showConnectionWarning(platformLockedMessage(btn.dataset.tab));
        updatePlatformTabs();
      }
      selectActiveTab(btn.dataset.tab);
      selectedIds.clear();
      page = 1;
      render();
    });
  });

  showView("loading");
  await loadUploadSettings();

  // Handle missing marketplace icons gracefully (CSP doesn't allow inline onerror)
  document.querySelectorAll(".pill-icon").forEach((img) => {
    img.addEventListener("error", () => { img.style.display = "none"; });
  });

  const session = await PodPilotAuth.getValidSession();
  if (!session) { showView("login"); return; }
  enterDashboard(session);
});

async function loadUploadSettings() {
  const stored = await chrome.storage.local.get({
    uploadSettings: { runUploadsInBackground: true },
  });
  uploadSettings = {
    runUploadsInBackground: stored.uploadSettings?.runUploadsInBackground !== false,
  };
  if (backgroundUploadToggle) {
    backgroundUploadToggle.checked = uploadSettings.runUploadsInBackground;
  }
}

async function enterDashboard(session) {
  currentUserId = session?.user?.id || currentUserId || "";
  isInitialLoadingDesigns = true;
  isRefreshingDesigns = false;
  lastDesignFetchFailed = false;
  designsLoadedByPlatform = { redbubble: false, teepublic: false };
  accessStatus = "loading";
  accessMessage = "";
  platformAccess = normalizePlatformAccess(null);
  lastRenderSignature = "";
  
  // Show a placeholder while we resolve the real email asynchronously.
  const placeholderEmail = session?.user?.email || "";
  if (placeholderEmail) {
    accountName.textContent =
      placeholderEmail.length > 16 ? placeholderEmail.slice(0, 14) + "..." : placeholderEmail;
    menuEmail.textContent = placeholderEmail;
  } else {
    accountName.textContent = "Account";
    menuEmail.textContent = "Loading...";
  }

  setLoadingAccountUI();
  showView("dashboard");

  // Load from local storage cache first
  const [rbCached, tpCached] = await Promise.all([
    getCachedDesigns(currentUserId, "redbubble"),
    getCachedDesigns(currentUserId, "teepublic"),
  ]);

  let hasCache = false;
  let combinedDesigns = [];
  if (rbCached && rbCached.designs) {
    combinedDesigns = [...combinedDesigns, ...rbCached.designs];
    hasCache = true;
  }
  if (tpCached && tpCached.designs) {
    combinedDesigns = [...combinedDesigns, ...tpCached.designs];
    hasCache = true;
  }

  if (hasCache) {
    allDesigns = combinedDesigns;
    window.PodPilotImageCache?.pruneCacheForDesigns?.(allDesigns, currentUserId);
    designsLoadedByPlatform = {
      redbubble: Boolean(rbCached?.designs?.length),
      teepublic: Boolean(tpCached?.designs?.length)
    };
    isInitialLoadingDesigns = false;
    showCacheStatusLabel("Updating...");
    render();
  } else {
    setInitialDesignLoadingChrome();
  }

  // Resolve the real user (falls back to /auth/v1/user when needed),
  // then update the chrome (account pill + menu email).
  const accountUserPromise = loadAccountUser();
  const platformAccessPromise = loadPlatformAccess();

  // Fire designs + subscription in parallel — both are independent.
  const fetchSuccessPromise = fetchDesigns().then((success) => {
    isInitialLoadingDesigns = false;
    render();
    return success;
  });

  await Promise.all([
    fetchSuccessPromise,
    accountUserPromise,
    platformAccessPromise,
  ]);
  // Default to redbubble; switch to teepublic if no RB designs and access allows it.
  const rbCount = allDesigns.filter((d) => d.marketplace === "redbubble").length;
  if (
    rbCount === 0 &&
    platformAccess.teepublic &&
    allDesigns.some((d) => d.marketplace === "teepublic")
  ) {
    selectActiveTab("teepublic");
  }
  chooseAvailableTab();
  updatePlatformTabs();
  render();
  startPolling();
}

// ── Auth ───────────────────────────────────────────────────────────────────
async function handleSignIn(e) {
  e.preventDefault();
  loginError.textContent = "";
  loginBtn.disabled = true;
  loginBtn.textContent = "Signing in...";
  try {
    const session = await PodPilotAuth.signIn(loginEmail.value.trim(), loginPassword.value);
    enterDashboard(session);
  } catch (err) {
    loginError.textContent = err?.message || "Sign-in failed.";
  } finally {
    loginBtn.disabled = false;
    loginBtn.textContent = "Sign In";
  }
}

async function handleSignOut() {
  stopPolling();
  releasePopupImageObjectUrls();
  try { await PodPilotAuth.signOut(); } catch (_) {}
  await sendMsg({ action: "clear_local_state" });
  try { await clearCachedDesigns(currentUserId); } catch (_) {}
  allDesigns = [];
  currentUserId = "";
  lastRenderSignature = "";
  isInitialLoadingDesigns = true;
  isRefreshingDesigns = false;
  lastDesignFetchFailed = false;
  resetUploadLaunchState();
  designsLoadedByPlatform = { redbubble: false, teepublic: false };
  selectedIds.clear();
  subscriptionInfo = null;
  trialEligibility = null;
  platformAccess = normalizePlatformAccess(null);
  accessStatus = "loading";
  accessMessage = "";
  isUploadGateBlocking = false;
  uploadGateMessage = "";
  updatePlatformTabs();
  if (billingBanner) {
    billingBanner.hidden = true;
    billingBanner.textContent = "";
  }
  if (menuEmail) menuEmail.textContent = "—";
  setLoadingAccountUI();
  showView("login");
}

// ── Data ───────────────────────────────────────────────────────────────────
async function fetchDesigns() {
  lastDesignFetchFailed = false;
  try {
    const resp = await PodPilotAuth.apiFetch("/designs");
    if (!resp.ok) {
      const requestId = PodPilotAuth.getResponseRequestId?.(resp) || "";
      throw new Error(`Could not load designs (${resp.status})${requestId ? ` Request ID: ${requestId}` : ""}`);
    }
    const data = await resp.json();
    const freshDesigns = Array.isArray(data?.designs) ? data.designs : [];
    allDesigns = freshDesigns;
    window.PodPilotImageCache?.pruneCacheForDesigns?.(allDesigns, currentUserId);
    designsLoadedByPlatform = { redbubble: true, teepublic: true };
    
    // Save to cache per platform
    if (currentUserId) {
      const rbFresh = freshDesigns.filter(d => (d.marketplace || "redbubble") === "redbubble");
      const tpFresh = freshDesigns.filter(d => d.marketplace === "teepublic");
      await Promise.all([
        setCachedDesigns(currentUserId, "redbubble", rbFresh),
        setCachedDesigns(currentUserId, "teepublic", tpFresh)
      ]);
    }
    
    hideCacheStatusLabel();
    debugLog("[EXT THUMB] data refreshed", { count: allDesigns.length });
    return true;
  } catch (err) {
    if (err instanceof PodPilotAuth.ApiAuthError) { showView("login"); return false; }
    lastDesignFetchFailed = true;
    debugLog("[PodPilot] fetchDesigns failed:", {
      message: err?.message || String(err),
      apiBase: PodPilotAuth?.API_BASE || "",
    });
    
    if (allDesigns.length > 0) {
      showCacheStatusLabel("Showing saved designs. Could not refresh.", "warning");
    } else {
      showConnectionWarning("Could not refresh designs from PodPilot backend.");
    }
    return false;
  }
}

async function refreshAll() {
  if (isRefreshingDesigns) return;
  isRefreshingDesigns = true;
  setRefreshButtonLoading(true);
  render();
  try {
    await Promise.all([
      fetchDesigns(),
      loadAccountUser(),
      loadPlatformAccess(),
    ]);
  } finally {
    isRefreshingDesigns = false;
    setRefreshButtonLoading(false);
    render();
  }
}

function startPolling() {
  stopPolling();
  debugLog("[EXT THUMB] design auto refresh loop remains disabled");
}
function stopPolling() {
  if (dataPollId) { clearInterval(dataPollId); dataPollId = null; }
}

// ── Filtering & pagination ─────────────────────────────────────────────────
function getFiltered() {
  const needle = (searchInput.value || "").trim().toLowerCase();
  const filter = filterSelect.value;
  return allDesigns.filter((d) => {
    if ((d.marketplace || "redbubble") !== activeTab) return false;
    if (filter !== "all" && d.status !== filter) return false;
    if (needle) {
      const hay = [d.filename, d.title, d.description, d.primary_tag, d.main_tag, d.supporting_tags]
        .filter(Boolean).join(" ").toLowerCase();
      if (!hay.includes(needle)) return false;
    }
    return true;
  });
}

function totalPages() {
  return Math.max(1, Math.ceil(getFiltered().length / perPage));
}

function getPageItems() {
  const filtered = getFiltered();
  const start = (page - 1) * perPage;
  return filtered.slice(start, start + perPage);
}

// ── Render ─────────────────────────────────────────────────────────────────
function getThumbnailStableKey(design = {}) {
  return String(design.thumbnail_r2_key || design.image_r2_key || design.id || "").trim();
}

function getRenderSignature(items) {
  return [
    activeTab,
    page,
    perPage,
    searchInput.value || "",
    filterSelect.value || "",
    ...items.map((d) => `${d.id}:${getThumbnailStableKey(d)}`),
  ].join("|");
}

function statusDotHtml(status) {
  if (status === "uploaded") {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>';
  }
  if (status === "failed") {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
  }
  return "";
}

function updateRenderedRows(items) {
  items.forEach((d) => {
    const row = tableBody.querySelector(`.table-row[data-design-id="${CSS.escape(String(d.id))}"]`);
    if (!row) return;
    row.classList.toggle("selected", selectedIds.has(d.id));
    const cb = row.querySelector(".tr-check input");
    if (cb) cb.checked = selectedIds.has(d.id);
    const title = row.querySelector(".tr-title");
    if (title) title.textContent = d.title || d.filename || "Untitled";
    const desc = row.querySelector(".tr-desc");
    if (desc) desc.textContent = d.description || d.main_tag || d.primary_tag || d.filename || "";
    const dot = row.querySelector(".status-dot");
    if (dot) {
      const st = d.status || "pending";
      dot.className = `status-dot ${st}`;
      dot.innerHTML = statusDotHtml(st);
    }
  });
  debugLog("[EXT THUMB] kept existing thumbnail");
}

function renderTableMessage(message, extraClass = "") {
  lastRenderSignature = "";
  tableBody.innerHTML = `<div class="table-empty ${extraClass}">${message}</div>`;
}

function render() {
  const filtered = getFiltered();
  const items = getPageItems();
  const platformItems = allDesigns.filter((d) => (d.marketplace || "redbubble") === activeTab);
  const activePlatformLoaded = hasLoadedPlatform(activeTab);
  const total = filtered.length;
  const pages = totalPages();
  if (page > pages) page = pages;

  // Header count
  if (!activePlatformLoaded && allDesigns.length === 0) {
    designCountLabel.textContent = "Loading designs...";
  } else {
    designCountLabel.textContent = `${allDesigns.length} design${allDesigns.length === 1 ? "" : "s"}`;
  }

  // Footer
  totalLabel.textContent = !activePlatformLoaded && total === 0 ? "Loading..." : `${total} designs`;
  selectedLabel.textContent = `${selectedIds.size} selected`;
  pageLabel.textContent = `${page}/${pages}`;
  prevPage.disabled = page <= 1;
  nextPage.disabled = page >= pages;

  // Upload button — disabled if nothing is selected OR billing gate is on.
  const platformLocked = isPlatformLocked(activeTab);
  if (isUploadGateBlocking || platformLocked) {
    selectedIds.clear();
    selectedLabel.textContent = "0 selected";
  }
  const accessReadyForUpload = accessStatus === "active";
  uploadBtn.disabled = isUploadLaunching || selectedIds.size === 0 || !accessReadyForUpload || isUploadGateBlocking || platformLocked;
  if (platformLocked) {
    uploadBtn.title = platformLockedMessage(activeTab);
  } else if (accessStatus === "loading") {
    uploadBtn.title = "Checking access...";
  } else if (accessStatus === "error") {
    uploadBtn.title = "Could not verify access. Please retry.";
  } else if (isUploadGateBlocking) {
    uploadBtn.title = uploadGateMessage || "Subscription required";
  } else if (isUploadLaunching) {
    uploadBtn.title = "Starting upload";
  } else {
    uploadBtn.removeAttribute("title");
  }

  if ((accessStatus === "loading" || accessStatus === "error") && billingBanner) {
    renderAccessBanner();
  } else if (platformLocked && billingBanner) {
    setBillingBannerMessage(platformLockedMessage(activeTab), { tone: "danger", cta: !platformAccess?.has_active_plan });
  } else if (!isUploadGateBlocking && billingBanner) {
    billingBanner.hidden = true;
    billingBanner.textContent = "";
  }

  searchInput.disabled = accessStatus === "inactive" || platformLocked;
  filterSelect.disabled = accessStatus === "inactive" || platformLocked;
  selectAll.disabled = accessStatus === "inactive" || platformLocked || items.length === 0;

  // Select all checkbox
  const allOnPage = items.every((d) => selectedIds.has(d.id));
  selectAll.checked = items.length > 0 && allOnPage;
  selectAll.indeterminate = items.some((d) => selectedIds.has(d.id)) && !allOnPage;

  // Table body
  if (isUploadGateBlocking || platformLocked) {
    renderTableMessage(uploadGateMessage || platformLockedMessage(activeTab), "table-locked");
    return;
  }

  if (items.length === 0) {
    if (!activePlatformLoaded) {
      renderTableMessage(
        lastDesignFetchFailed && !isRefreshingDesigns && !isInitialLoadingDesigns
          ? "Could not load designs."
          : "Loading designs...",
        "table-loading",
      );
      return;
    }
    renderTableMessage(platformItems.length === 0 ? "No designs to show." : "No designs match your filters.");
    return;
  }

  const nextRenderSignature = getRenderSignature(items);
  if (lastRenderSignature === nextRenderSignature && tableBody.querySelector(".table-row")) {
    updateRenderedRows(items);
    return;
  }

  lastRenderSignature = nextRenderSignature;
  tableBody.innerHTML = "";
  items.forEach((d) => {
    const row = document.createElement("div");
    row.className = `table-row${selectedIds.has(d.id) ? " selected" : ""}`;
    row.dataset.designId = String(d.id);
    row.dataset.thumbnailStableKey = getThumbnailStableKey(d);

    // Checkbox
    const checkDiv = document.createElement("div");
    checkDiv.className = "tr-check";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = selectedIds.has(d.id);
    cb.addEventListener("change", () => {
      if (cb.checked) selectedIds.add(d.id); else selectedIds.delete(d.id);
      render();
    });
    checkDiv.appendChild(cb);

    // Image
    const imgDiv = document.createElement("div");
    imgDiv.className = "tr-image";
    const thumbnailUrl = window.PodPilotImageCache?.getImageUrl?.(d, "thumbnail") || d.thumbnail_url || d.image_url || "";
    if (thumbnailUrl) {
      const thumbBox = document.createElement("div");
      thumbBox.className = "tr-thumb-box is-loading";
      thumbBox.setAttribute("aria-label", d.title || d.filename || "Design thumbnail");
      const placeholder = document.createElement("div");
      placeholder.className = "tr-thumb-empty";
      placeholder.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9.5" r="1.5"/><path d="M21 15l-5-5L5 20"/></svg>';
      const img = document.createElement("img");
      img.className = "tr-thumb";
      img.alt = "";
      img.loading = "lazy";
      img.decoding = "async";
      img.addEventListener("load", () => {
        thumbBox.classList.remove("is-loading", "is-failed");
        thumbBox.classList.add("is-loaded");
      });
      img.addEventListener("error", () => {
        img.removeAttribute("src");
        thumbBox.classList.remove("is-loading", "is-loaded");
        thumbBox.classList.add("is-failed");
      });
      if (window.PodPilotImageCache?.setImageSourceFromCache) {
        window.PodPilotImageCache.setImageSourceFromCache(img, d, currentUserId, "thumbnail").then((src) => {
          if (!src && img.isConnected) {
            img.removeAttribute("src");
            thumbBox.classList.remove("is-loading", "is-loaded");
            thumbBox.classList.add("is-failed");
          }
        });
      } else {
        const isProtectedProxy = String(thumbnailUrl || "").startsWith("/api/designs/") ||
          String(thumbnailUrl || "").startsWith("/designs/");
        if (isProtectedProxy) {
          thumbBox.classList.remove("is-loading", "is-loaded");
          thumbBox.classList.add("is-failed");
        } else {
          img.src = thumbnailUrl;
        }
      }
      attachHoverPreview(thumbBox, async () => {
        const cachedPreview = await window.PodPilotImageCache?.getOrCacheImageForDesign?.(d, currentUserId, "preview");
        if (cachedPreview) return cachedPreview;
        const currentThumb = img.dataset.cachedImageSrc || img.currentSrc || img.src || "";
        if (currentThumb) return currentThumb;
        if (window.PodPilotImageCache?.isProtectedProxyUrl?.(thumbnailUrl)) return "";
        return thumbnailUrl;
      });
      thumbBox.append(placeholder, img);
      imgDiv.appendChild(thumbBox);
    } else {
      const ph = document.createElement("div");
      ph.className = "tr-thumb-empty";
      ph.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9.5" r="1.5"/><path d="M21 15l-5-5L5 20"/></svg>';
      imgDiv.appendChild(ph);
    }

    // Details
    const detDiv = document.createElement("div");
    detDiv.className = "tr-details";
    const title = document.createElement("div");
    title.className = "tr-title";
    title.textContent = d.title || d.filename || "Untitled";
    const desc = document.createElement("div");
    desc.className = "tr-desc";
    desc.textContent = d.description || d.main_tag || d.primary_tag || d.filename || "";
    detDiv.append(title, desc);

    // Status
    const statusDiv = document.createElement("div");
    statusDiv.className = "tr-status";
    const dot = document.createElement("div");
    const st = d.status || "pending";
    dot.className = `status-dot ${st}`;
    dot.innerHTML = statusDotHtml(st);
    statusDiv.appendChild(dot);

    row.append(checkDiv, imgDiv, detDiv, statusDiv);
    tableBody.appendChild(row);
  });
}

// ── Actions ────────────────────────────────────────────────────────────────
function handleSelectAll() {
  const items = getPageItems();
  if (selectAll.checked) {
    items.forEach((d) => selectedIds.add(d.id));
  } else {
    items.forEach((d) => selectedIds.delete(d.id));
  }
  render();
}

async function handleUpload() {
  if (isUploadLaunching) return;
  const selectedCountAtClick = selectedIds.size;
  if (selectedCountAtClick === 0) return;

  const platformName = platformLabel(activeTab);
  setUploadLaunchLoading(true, "Starting");
  showUploadLaunchPanel({
    title: `Preparing ${platformName} upload`,
    meta: `${selectedCountAtClick} design${selectedCountAtClick === 1 ? "" : "s"} selected`,
  });
  render();

  try {
  const clickTimer = debugTimerStart("popup Start button clicked", {
    marketplace: activeTab,
    selectedCount: selectedCountAtClick,
  });
  debugTimerEnd(clickTimer);

  const authTimer = debugTimerStart("auth/session check duration", { marketplace: activeTab });
  const session = await PodPilotAuth.getValidSession();
  debugTimerEnd(authTimer, { hasSession: Boolean(session) });
  if (!session) {
    resetUploadLaunchState();
    showView("login");
    return;
  }

  if (accessStatus !== "active") {
    resetUploadLaunchState();
    showConnectionWarning(
      accessStatus === "error"
        ? "Could not verify access. Please refresh or open PodPilot."
        : "Access is still loading. Please try again in a moment.",
    );
    return;
  }

  if (platformAccess?.[activeTab] !== true) {
    resetUploadLaunchState();
    showConnectionWarning(platformLockedMessage(activeTab));
    return;
  }

  if (isUploadGateBlocking) {
    resetUploadLaunchState();
    showConnectionWarning(uploadGateMessage || "Your subscription is not active.");
    return;
  }

  setUploadLaunchLoading(true, "Queuing");
  updateUploadLaunchPanel({ meta: "Building the upload queue..." });
  const queueTimer = debugTimerStart("queue/designs fetch duration", {
    marketplace: activeTab,
    selectedCount: selectedCountAtClick,
    libraryCount: allDesigns.length,
  });
  const toQueue = allDesigns.filter((d) => selectedIds.has(d.id) && d.marketplace === activeTab);
  debugTimerEnd(queueTimer, { queuedCount: toQueue.length });
  if (!toQueue.length) {
    resetUploadLaunchState();
    render();
    return;
  }

  const payload = {
    action: "start_queue_instant",
    marketplace: activeTab,
    designIds: toQueue.map((d) => d.id),
    designsLibrary: allDesigns,
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    expires_at: session.expires_at,
    user: session.user || null,
    uploadSettings,
  };

  debugLog("[PodPilot] Starting upload", {
    marketplace: activeTab,
    selected: toQueue.length,
  });

  const startResp = await sendMsg(payload);
  if (startResp && startResp.ok === false) {
    resetUploadLaunchState();
    if (startResp.blocked) {
      showConnectionWarning(
        startResp.summary?.reason || "Your current plan does not allow uploads right now."
      );
    } else {
      showConnectionWarning(startResp.error || "Could not start upload. Please try again.");
    }
    render();
    return;
  }

  setUploadLaunchLoading(true, "Launching");
  updateUploadLaunchPanel({
    title: `${platformName} upload started`,
    meta: `${toQueue.length} design${toQueue.length === 1 ? "" : "s"} queued. You can keep working.`,
  });
  selectedIds.clear();
  render();

  setTimeout(() => {
    try { window.close(); } catch (_) {}
  }, 700);
  } catch (error) {
    resetUploadLaunchState();
    showConnectionWarning(error?.message || "Could not start upload. Please try again.");
    render();
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────
function sendMsg(msg) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(msg, (r) => {
      if (chrome.runtime.lastError) { resolve({ ok: false, error: chrome.runtime.lastError.message }); return; }
      resolve(r || { ok: true });
    });
  });
}

// ── Background messages ────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg) => {
  if (!msg) return;
  if (msg.action === "queue_complete") {
    resetUploadLaunchState();
    showUploadToast(msg.summary || {});
    refreshAll();
  }
  if (msg.action === "billing_block") {
    if (typeof showConnectionWarning === "function") {
      showConnectionWarning(msg.message || "Upload blocked.");
    }
  }
  if (msg.action === "auth_required") showView("login");
});

// On popup open, surface a recent completion (within the last 30s) that the
// user may have missed because the popup was closed when it landed.
(function surfaceRecentCompletion() {
  try {
    chrome.runtime.sendMessage({ action: "get_status" }, (response) => {
      if (chrome.runtime.lastError || !response?.ok) return;
      const summary = response?.state?.lastCompletion;
      if (!summary?.finishedAt) return;
      const ageMs = Date.now() - new Date(summary.finishedAt).getTime();
      if (Number.isFinite(ageMs) && ageMs >= 0 && ageMs < 30000) {
        showUploadToast(summary);
      }
    });
  } catch (_) { /* ignore */ }
})();
