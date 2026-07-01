import axios from "axios";
import { supabase } from "../lib/supabaseClient";
import { trialDeviceHeaders } from "../lib/trialDevice";
import {
  devicePayload,
  getDeviceHeaders,
  isDeviceAlreadyActiveError,
  isDeviceSessionRevokedError,
  DEVICE_SESSION_REVOKED_MESSAGE,
  parseDeviceError,
} from "../lib/deviceSession";

// API base URL strategy:
//   - If VITE_API_BASE_URL is set, use it (production / explicit override).
//   - Otherwise use a relative empty base so requests hit the SAME origin
//     the frontend is served from. In dev, Vite's proxy forwards those
//     paths to the FastAPI backend on 127.0.0.1:8000, which means the
//     Cloudflare tunnel only needs to expose the frontend port.
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "";

const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 60000,
});

const UPLOAD_TIMEOUT_MIN_MS = 5 * 60 * 1000;
const UPLOAD_TIMEOUT_MAX_MS = 20 * 60 * 1000;
const UPLOAD_TIMEOUT_MS_PER_MB = 15 * 1000;
const UPLOAD_TIMEOUT_MS_PER_FILE = 10 * 1000;

export function getUploadTimeoutMs(files = []) {
  const uploadFiles = Array.isArray(files) ? files : [files].filter(Boolean);
  const totalBytes = uploadFiles.reduce((sum, file) => sum + Number(file?.size || 0), 0);
  const totalMb = totalBytes / (1024 * 1024);
  const estimatedMs = Math.ceil(totalMb * UPLOAD_TIMEOUT_MS_PER_MB) + (uploadFiles.length * UPLOAD_TIMEOUT_MS_PER_FILE);
  return Math.min(UPLOAD_TIMEOUT_MAX_MS, Math.max(UPLOAD_TIMEOUT_MIN_MS, estimatedMs));
}

const AUTH_REQUIRED_EVENT = "podpilot:auth-required";
const DEVICE_CONFLICT_EVENT = "podpilot:upload-device-conflict";
const DEVICE_REVOKED_EVENT = "podpilot:device-session-revoked";
const DEV_AUTH_LOGS = import.meta.env.DEV;
const PROTECTED_CACHE_TTL_MS = 30000;
const PROTECTED_API_PREFIXES = [
  "/api",
  "/designs",
  "/upload-jobs",
  "/upload-logs",
  "/trademark",
  "/me",
];

let currentAccessToken = null;
let refreshSessionPromise = null;
const protectedResourceCache = new Map();

function devLog(message, payload) {
  if (!DEV_AUTH_LOGS) return;
  if (payload === undefined) {
    // eslint-disable-next-line no-console
    console.debug(message);
    return;
  }
  // eslint-disable-next-line no-console
  console.debug(message, payload);
}

export class AuthSessionMissingError extends Error {
  constructor(message = "Please sign in again.") {
    super(message);
    this.name = "AuthSessionMissingError";
    this.code = "AUTH_SESSION_MISSING";
    this.isAuthSessionMissing = true;
  }
}

export function isAuthSessionMissingError(error) {
  return Boolean(error?.isAuthSessionMissing || error?.code === "AUTH_SESSION_MISSING");
}

function notifyAuthRequired(reason) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(AUTH_REQUIRED_EVENT, {
      detail: { reason },
    }),
  );
}

function notifyDeviceSessionRevoked(message) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(DEVICE_REVOKED_EVENT, {
      detail: { message },
    }),
  );
}

function notifyUploadDeviceConflict(message) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(DEVICE_CONFLICT_EVENT, {
      detail: { message },
    }),
  );
}

function getRequestPath(url = "") {
  try {
    return new URL(url, window.location.origin).pathname;
  } catch {
    return String(url || "");
  }
}

function isProtectedApiRequest(url = "") {
  const path = getRequestPath(url);
  if (path === "/api/auth/check-email") return false;
  return PROTECTED_API_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

function clearProtectedResourceCache() {
  protectedResourceCache.clear();
}

async function getLatestAccessToken({ required = false } = {}) {
  if (!supabase) {
    if (required) {
      devLog("[Auth] session missing");
      notifyAuthRequired("supabase_not_configured");
      throw new AuthSessionMissingError();
    }
    return null;
  }

  try {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token || null;
    currentAccessToken = token;
    if (required && !token) {
      devLog("[Auth] session missing");
      notifyAuthRequired("missing_session");
      throw new AuthSessionMissingError();
    }
    return token;
  } catch (error) {
    if (isAuthSessionMissingError(error)) throw error;
    console.warn("[PodPilot] Could not read Supabase session:", error?.message || error);
    if (required) {
      devLog("[Auth] session missing");
      notifyAuthRequired("session_read_failed");
      throw new AuthSessionMissingError();
    }
    return null;
  }
}

async function refreshAccessTokenOnce() {
  if (!supabase) {
    devLog("[Auth] retry failed", { reason: "supabase_not_configured" });
    throw new AuthSessionMissingError();
  }

  if (!refreshSessionPromise) {
    devLog("[Auth] refresh after 401");
    refreshSessionPromise = supabase.auth.refreshSession()
      .then(({ data, error }) => {
        if (error) throw error;
        const token = data.session?.access_token || null;
        if (!token) throw new AuthSessionMissingError();
        currentAccessToken = token;
        return token;
      })
      .finally(() => {
        refreshSessionPromise = null;
      });
  }

  return refreshSessionPromise;
}

if (supabase) {
  supabase.auth.getSession().then(({ data }) => {
    currentAccessToken = data.session?.access_token || null;
  }).catch((error) => {
    console.warn("[PodPilot] Could not hydrate Supabase token:", error?.message || error);
    currentAccessToken = null;
  });

  supabase.auth.onAuthStateChange((_event, nextSession) => {
    currentAccessToken = nextSession?.access_token || null;
    clearProtectedResourceCache();
  });
}

async function withProtectedAuth(config = {}) {
  const token = await getLatestAccessToken({ required: true });
  const headers = {
    ...(config.headers || {}),
    ...getDeviceHeaders(),
    Authorization: `Bearer ${token}`,
  };
  return { ...config, headers };
}

async function protectedGet(url, config = {}) {
  return api.get(url, await withProtectedAuth(config));
}

async function cachedProtectedGet(url, config = {}, { cacheKey = url, force = false, logLabel = "" } = {}) {
  const cached = protectedResourceCache.get(cacheKey);
  const now = Date.now();
  if (!force && cached) {
    if (cached.promise) {
      if (logLabel) devLog(`[${logLabel}] skipped duplicate fetch`, { cacheKey });
      return cached.promise;
    }
    if (now - cached.timestamp < PROTECTED_CACHE_TTL_MS) {
      if (logLabel) devLog(`[${logLabel}] skipped duplicate fetch`, { cacheKey });
      return cached.data;
    }
  }

  if (logLabel) devLog(`[${logLabel}] fetching platform access`, { cacheKey });
  const promise = protectedGet(url, config)
    .then((response) => {
      protectedResourceCache.set(cacheKey, {
        data: response.data,
        timestamp: Date.now(),
        promise: null,
      });
      return response.data;
    })
    .catch((error) => {
      protectedResourceCache.delete(cacheKey);
      throw error;
    });

  protectedResourceCache.set(cacheKey, { promise, timestamp: now, data: cached?.data });
  return promise;
}

// Inject the freshest Supabase access token on every request that did not
// explicitly go through the protected helper. Protected helpers cancel before
// the network when no session exists, which avoids dashboard 401 spam.
api.interceptors.request.use(async (config) => {
  config.headers = config.headers || {};
  Object.assign(config.headers, getDeviceHeaders());
  if (config.headers?.Authorization) return config;
  const token = await getLatestAccessToken({ required: isProtectedApiRequest(config.url) });
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  } else if (currentAccessToken) {
    config.headers.Authorization = `Bearer ${currentAccessToken}`;
  }
  return config;
});

// ── Designs ────────────────────────────────────────────────────────────────

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const status = Number(error?.response?.status);
    const originalConfig = error?.config || {};
    const shouldRefresh =
      (status === 401 || status === 403) &&
      !originalConfig._podpilotAuthRetry &&
      isProtectedApiRequest(originalConfig.url || "");

    if (shouldRefresh) {
      try {
        const token = await refreshAccessTokenOnce();
        originalConfig._podpilotAuthRetry = true;
        originalConfig.headers = {
          ...(originalConfig.headers || {}),
          Authorization: `Bearer ${token}`,
        };
        const retryResponse = await api(originalConfig);
        devLog("[Auth] retry success", { endpoint: originalConfig.url });
        return retryResponse;
      } catch (refreshError) {
        devLog("[Auth] retry failed", {
          endpoint: originalConfig.url,
          status: refreshError?.response?.status || refreshError?.status || null,
        });
        clearProtectedResourceCache();
        notifyAuthRequired("session_expired");
      }
    }

    if (isDeviceAlreadyActiveError(error)) {
      const { message } = parseDeviceError(error);
      notifyUploadDeviceConflict(message || "PodPilot is already connected to another browser for upload automation.");
    }
    if (isDeviceSessionRevokedError(error)) {
      const { message } = parseDeviceError(error);
      notifyDeviceSessionRevoked(message || DEVICE_SESSION_REVOKED_MESSAGE);
    }
    return Promise.reject(error);
  },
);

export async function getDeviceStatus() {
  const response = await protectedGet("/api/device/status");
  return response.data;
}

export async function registerDevice() {
  const response = await api.post("/api/device/register", devicePayload());
  return response.data;
}

export async function switchDevice() {
  const response = await api.post("/api/device/switch", devicePayload());
  return response.data;
}

export async function heartbeatDevice() {
  const response = await api.post("/api/device/heartbeat", devicePayload());
  return response.data;
}

export async function logoutDevice() {
  const response = await api.post("/api/device/logout", devicePayload());
  return response.data;
}

export async function listDesigns(marketplace) {
  const params = marketplace ? { marketplace } : {};
  const response = await protectedGet("/designs", { params });
  return response.data;
}

export async function getDesign(designId) {
  const response = await api.get(`/designs/${designId}`);
  return response.data;
}

export async function createDesign(payload) {
  const response = await api.post("/designs", payload);
  return response.data;
}

export async function updateDesign(designId, patch) {
  const response = await api.patch(`/designs/${designId}`, patch);
  return response.data;
}

export async function batchUpdateDesigns(designs) {
  // Each item must have `id` plus any updatable fields (title, description,
  // primary_tag, supporting_tags, copy_link, adult_content, color_settings,
  // product_settings).
  const response = await api.post("/designs/batch-update", designs);
  return response.data;
}

export async function deleteDesign(designId) {
  const response = await api.delete(`/designs/${designId}`);
  return response.data;
}

export async function batchDeleteDesigns(designIds) {
  const response = await api.post("/designs/batch-delete", {
    design_ids: Array.isArray(designIds) ? designIds : [],
  });
  return response.data;
}

export async function copyDesignsToMarketplace(designIds, targetMarketplace) {
  const response = await api.post("/designs/copy-to-marketplace", {
    design_ids: Array.isArray(designIds) ? designIds : [],
    target_marketplace: targetMarketplace,
  });
  return response.data;
}

export async function uploadDesignImage(designId, file, onUploadProgress = null) {
  const formData = new FormData();
  formData.append("file", file);
  const response = await api.post(`/designs/${designId}/image`, formData, {
    headers: { "Content-Type": "multipart/form-data" },
    onUploadProgress,
    timeout: getUploadTimeoutMs(file),
  });
  return response.data;
}

export async function importDesigns({ excelFile, imageFiles = [], marketplace = "redbubble" }) {
  // One-shot: backend parses the xlsx, persists rows in Supabase, uploads
  // each matching image to R2, and returns the created designs (with
  // signed image_url already attached).
  const formData = new FormData();
  formData.append("file", excelFile);
  formData.append("marketplace", marketplace);
  imageFiles.forEach((file) => formData.append("images", file));

  const response = await api.post("/designs/import", formData, {
    headers: { "Content-Type": "multipart/form-data" },
    timeout: getUploadTimeoutMs([excelFile, ...imageFiles]),
  });
  return response.data;
}

export async function uploadStandaloneImages(files, marketplace = "redbubble", onUploadProgress = null) {
  const formData = new FormData();
  formData.append("marketplace", marketplace);
  files.forEach((file) => formData.append("files", file));
  const response = await api.post("/designs/import/images", formData, {
    headers: { "Content-Type": "multipart/form-data" },
    onUploadProgress,
    timeout: getUploadTimeoutMs(files),
  });
  return response.data;
}

export async function updateDesignStatus(designId, payload) {
  const response = await api.post(`/designs/${designId}/status`, payload);
  return response.data;
}

export async function getDesignSignedImageUrl(designId) {
  const response = await api.get(`/designs/${designId}/image-url`);
  return response.data;
}

// ── Upload jobs ────────────────────────────────────────────────────────────

export async function generateListingContent(designId, platform, currentMetadata = {}) {
  const response = await api.post("/api/ai/listing-content", {
    design_id: designId,
    platform,
    current_metadata: currentMetadata,
  }, {
    timeout: 90000,
  });
  return response.data;
}

export async function generateDraftListingContent(platform, currentMetadata = {}, file = null) {
  const formData = new FormData();
  formData.append("platform", platform);
  formData.append("current_metadata", JSON.stringify(currentMetadata || {}));
  if (file) formData.append("file", file);

  const response = await api.post("/api/ai/listing-content/draft", formData, {
    headers: { "Content-Type": "multipart/form-data" },
    timeout: 90000,
  });
  return response.data;
}

export async function checkCopyrightRisk(payload) {
  const response = await api.post("/api/ai/copyright-check", payload, {
    timeout: 90000,
  });
  return response.data;
}

export async function listUploadJobs({ marketplace, onlyPending } = {}) {
  const params = {};
  if (marketplace) params.marketplace = marketplace;
  if (onlyPending) params.only_pending = true;
  const response = await api.get("/upload-jobs", { params });
  return response.data;
}

export async function listPendingDesigns(marketplace) {
  const params = marketplace ? { marketplace } : {};
  const response = await api.get("/upload-jobs/pending", { params });
  return response.data;
}

export async function getUploadQueue(marketplace) {
  const response = await api.get(`/api/upload-queue/${marketplace}`);
  return response.data;
}

export async function createUploadSession(marketplace, designIds = []) {
  const response = await api.post(`/api/upload-sessions/${marketplace}`, {
    design_ids: Array.isArray(designIds) ? designIds : [],
  });
  return response.data;
}

export async function updateUploadSessionItemStatus(sessionId, designId, payload) {
  const response = await api.post(`/api/upload-sessions/${sessionId}/items/${designId}/status`, payload);
  return response.data;
}

export async function createUploadJob({ marketplace = "redbubble", design_ids = [] } = {}) {
  const response = await api.post("/upload-jobs", {
    marketplace,
    design_ids,
    total_designs: design_ids.length,
  });
  return response.data;
}

export async function updateUploadJob(jobId, patch) {
  const response = await api.patch(`/upload-jobs/${jobId}`, patch);
  return response.data;
}

// ── Upload logs ────────────────────────────────────────────────────────────

export async function listUploadLogs({ designId, jobId, limit = 200 } = {}) {
  const params = { limit };
  if (designId) params.design_id = designId;
  if (jobId) params.job_id = jobId;
  const response = await api.get("/upload-logs", { params });
  return response.data;
}

export async function createUploadLog(payload) {
  const response = await api.post("/upload-logs", payload);
  return response.data;
}

// ── Identity ───────────────────────────────────────────────────────────────

export async function whoami() {
  const response = await api.get("/me");
  return response.data;
}

// ── Billing / subscription ────────────────────────────────────────────────

export async function getMySubscription({ force = false } = {}) {
  return cachedProtectedGet("/api/me/subscription", {}, {
    cacheKey: "me:subscription",
    force,
    logLabel: "Access",
  });
}

export async function getMyPlatformAccess({ force = false } = {}) {
  return cachedProtectedGet("/api/me/platform-access", {}, {
    cacheKey: "me:platform-access",
    force,
    logLabel: "Access",
  });
}

export async function createBillingPortalSession() {
  const response = await api.post("/api/billing/customer-portal");
  return response.data;
}

export async function getTrialEligibility({ force = false } = {}) {
  return cachedProtectedGet("/api/billing/trial-eligibility", {
    headers: trialDeviceHeaders(),
  }, {
    cacheKey: "billing:trial-eligibility",
    force,
    logLabel: "Access",
  });
}

export async function startTrialCheckout(planKey) {
  const response = await api.post(
    "/api/billing/start-trial",
    { plan_key: planKey },
    { headers: trialDeviceHeaders() },
  );
  return response.data;
}

export async function getCheckoutConfig(planKey, billingCycle, options = {}) {
  const payload = typeof planKey === "object" && planKey !== null
    ? planKey
    : {
        plan_key: planKey,
        billing_cycle: billingCycle,
        ...options,
      };
  const response = await api.post("/api/billing/checkout", payload, {
    headers: trialDeviceHeaders(),
  });
  return response.data;
}

export async function getCheckoutPriceId(planKey, billingCycle) {
  return getCheckoutConfig(planKey, billingCycle);
}


// ── Trademark check ────────────────────────────────────────────────────────

export async function checkTrademarkPhrase(phrase) {
  const response = await api.get("/api/trademark/check", { params: { phrase } });
  return response.data;
}

export async function checkTrademark(terms) {
  const response = await api.post("/trademark/check", { terms });
  return response.data;
}

export async function checkTrademarkForDesign(design) {
  const response = await api.post("/trademark/check-design", {
    title: design.title || "",
    primary_tag: design.primary_tag || design.main_tag || "",
    main_tag: design.main_tag || "",
    supporting_tags: design.supporting_tags || "",
    description: design.description || "",
  });
  return response.data;
}

// ── Backwards-compat shims ─────────────────────────────────────────────────
// Older components still import these names. Keeping the shims avoids a
// broad sweep through every component while still routing every call
// through the new authenticated, user-scoped API.

export async function getDesigns(marketplace) {
  return listDesigns(marketplace);
}

export async function getJobs() {
  const data = await listUploadJobs();
  return { jobs: data.upload_jobs };
}

export async function uploadExcel(/* file */) {
  throw new Error(
    "uploadExcel() is no longer supported on its own. Call importDesigns({ excelFile, imageFiles, marketplace }) instead.",
  );
}

export async function uploadImages(files, marketplace = "redbubble") {
  // Re-shape the new response so legacy callers that read
  // `response.files[i].image_url` keep working.
  const data = await uploadStandaloneImages(files, marketplace);
  return data;
}

export async function createJob(designs) {
  // Map legacy createJob(designs[]) onto the new createUploadJob API.
  const ids = (designs || []).map((d) => d.id).filter(Boolean);
  const data = await createUploadJob({ design_ids: ids });
  return { id: data?.upload_job?.id, ...data };
}

export async function uploadTeePublicExcel() {
  throw new Error(
    "uploadTeePublicExcel() is deprecated. Use importDesigns({ marketplace: 'teepublic', ... }).",
  );
}

export async function createTeePublicJob(designs) {
  const ids = (designs || []).map((d) => d.id).filter(Boolean);
  const data = await createUploadJob({ marketplace: "teepublic", design_ids: ids });
  return { id: data?.upload_job?.id, ...data };
}

export async function getTeePublicJobs() {
  const data = await listUploadJobs({ marketplace: "teepublic" });
  return { jobs: data.upload_jobs };
}

export function logFailingRequest(error) {
  if (!error) return;
  const config = error.config || {};
  const response = error.response || {};
  const endpoint = config.url || "unknown";
  const statusCode = response.status || "unknown";
  const errorMessage = response.data?.detail || error.message || "unknown";
  const hasAuthHeader = !!(config.headers && config.headers.Authorization);

  console.error("[PodPilot Request Failure]", {
    endpoint,
    statusCode,
    errorMessage,
    hasAuthHeader,
  });
}

export async function checkEmail(email) {
  const response = await api.post("/api/auth/check-email", { email });
  return response.data;
}

export default api;
export { API_BASE_URL };
