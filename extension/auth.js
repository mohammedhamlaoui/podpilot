var AUTH_DEBUG = false;
var authDebugLog = (...args) => {
  if (AUTH_DEBUG) console.log(...args);
};

/**
 * PodPilot extension auth.
 *
 * The extension is a Supabase client, just like the website. It uses the
 * PUBLIC URL + anon key only (never the service role key) to:
 *   - sign in with email + password
 *   - persist the session in chrome.storage.local
 *   - refresh the access token before it expires
 *   - hand the freshest token to fetch() calls against the PodPilot backend
 *
 * Service-role secrets and R2 secrets stay on the server. The extension
 * never sees them.
 */

const SUPABASE_URL = "https://okmcvbopiwjuusdiqnas.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_QEi_heLvRo0_guA07QCK_A_crkC9wUI";
const API_BASE = "https://api.podpilot.space";

const SESSION_STORAGE_KEY = "podpilot_session_v1";
const PLATFORM_ACCESS_STORAGE_KEY = "podpilot_platform_access";
// Refresh the access token when it has less than this many seconds left.
const REFRESH_LEEWAY_SECONDS = 60;

const LOCKED_PLATFORM_ACCESS = {
  has_active_plan: false,
  plan: null,
  redbubble: false,
  teepublic: false,
};

const PLAN_VERIFY_SIGNIN_MESSAGE = "You are not signed in. Please sign in again.";
const PLAN_VERIFY_AUTH_MESSAGE = "Could not verify your plan. Please sign in again or check backend connection.";
const PLAN_VERIFY_BACKEND_MESSAGE = `Could not verify your plan. Backend connection failed at ${API_BASE}.`;

function backendEndpointLabel(path) {
  try {
    const parsed = new URL(String(path || ""), API_BASE);
    return `${parsed.pathname}${parsed.search || ""}`;
  } catch (_) {
    return String(path || "");
  }
}

function getResponseRequestId(response) {
  return response?.headers?.get("X-Request-ID") ||
    response?.headers?.get("x-request-id") ||
    "";
}

function appendRequestId(message, requestId) {
  const cleanMessage = String(message || "").trim();
  if (!requestId) return cleanMessage;
  return `${cleanMessage} Request ID: ${requestId}`.trim();
}

function logBackendResponse(path, response, { attempt = 1 } = {}) {
  const requestId = getResponseRequestId(response);
  console.info("[PodPilot API]", {
    endpoint: backendEndpointLabel(path),
    status: response?.status || 0,
    request_id: requestId || null,
    attempt,
  });
}

// ── Storage ─────────────────────────────────────────────────────────────────

async function getStoredSession() {
  return new Promise((resolve) => {
    chrome.storage.local.get(SESSION_STORAGE_KEY, (data) => {
      resolve((data && data[SESSION_STORAGE_KEY]) || null);
    });
  });
}

async function setStoredSession(session) {
  return new Promise((resolve) => {
    if (session === null) {
      chrome.storage.local.remove([SESSION_STORAGE_KEY, PLATFORM_ACCESS_STORAGE_KEY], () => resolve());
      return;
    }
    chrome.storage.local.set({ [SESSION_STORAGE_KEY]: session }, () => resolve());
  });
}

function normalizePlatformAccess(raw) {
  return {
    has_active_plan: Boolean(raw?.has_active_plan),
    plan: raw?.plan || null,
    status: raw?.status || null,
    current_period_ends_at: raw?.current_period_ends_at || raw?.current_period_end || null,
    current_period_end: raw?.current_period_end || raw?.current_period_ends_at || null,
    cancel_at_period_end: Boolean(raw?.cancel_at_period_end),
    reason: raw?.reason || null,
    subscription_status: raw?.subscription_status || raw?.status || null,
    payment_status: raw?.payment_status || raw?.status || null,
    is_past_due: raw?.is_past_due === true,
    past_due_grace_active: raw?.past_due_grace_active === true,
    past_due_grace_days: Number(raw?.past_due_grace_days ?? 3),
    past_due_lock_after: raw?.past_due_lock_after || null,
    payment_recovery_required: raw?.payment_recovery_required === true,
    payment_recovery_message: raw?.payment_recovery_message || null,
    redbubble: Boolean(raw?.redbubble),
    teepublic: Boolean(raw?.teepublic),
  };
}

function isPlatformAccessStillLive(access) {
  if (!access?.has_active_plan) return false;
  const status = String(access.status || "").toLowerCase();
  if (status === "past_due" && access.past_due_grace_active === true) {
    const lockAfter = Date.parse(access.past_due_lock_after || "");
    return Number.isFinite(lockAfter) && lockAfter > Date.now();
  }
  if (status && !["active", "trialing"].includes(status)) return false;
  const periodEnd = access.current_period_ends_at || access.current_period_end;
  if (!periodEnd) return false;
  const end = Date.parse(periodEnd);
  return Number.isFinite(end) && end > Date.now();
}

async function setStoredPlatformAccess(access) {
  const normalized = normalizePlatformAccess(access || LOCKED_PLATFORM_ACCESS);
  return new Promise((resolve) => {
    chrome.storage.local.set({
      [PLATFORM_ACCESS_STORAGE_KEY]: {
        access: normalized,
        cached_at: Date.now(),
      },
    }, () => resolve(normalized));
  });
}

function normalizeStoredPlatformAccess(raw) {
  if (raw?.access) {
    return {
      access: normalizePlatformAccess(raw.access),
      cached_at: Number(raw.cached_at) || 0,
    };
  }
  return {
    access: normalizePlatformAccess(raw || LOCKED_PLATFORM_ACCESS),
    cached_at: Number(raw?.cached_at) || 0,
  };
}

async function getStoredPlatformAccessEntry() {
  return new Promise((resolve) => {
    chrome.storage.local.get(PLATFORM_ACCESS_STORAGE_KEY, (data) => {
      resolve(normalizeStoredPlatformAccess(data?.[PLATFORM_ACCESS_STORAGE_KEY]));
    });
  });
}

async function getStoredPlatformAccess() {
  const entry = await getStoredPlatformAccessEntry();
  return entry.access;
}

async function getCachedActivePlatformAccess(maxAgeMs = 10 * 60 * 1000) {
  const entry = await getStoredPlatformAccessEntry();
  const ageMs = Date.now() - entry.cached_at;
  if (
    isPlatformAccessStillLive(entry.access) &&
    Number.isFinite(ageMs) &&
    ageMs >= 0 &&
    ageMs <= maxAgeMs
  ) {
    return entry.access;
  }
  return null;
}

// ── Supabase auth wire calls ────────────────────────────────────────────────

async function supabaseAuth(path, body, { method = "POST", token } = {}) {
  const headers = {
    "Content-Type": "application/json",
    apikey: SUPABASE_ANON_KEY,
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(`${SUPABASE_URL}/auth/v1/${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch (_) {
    data = { raw: text };
  }
  if (!response.ok) {
    const detail =
      (data && (data.error_description || data.msg || data.error || data.message)) ||
      `HTTP ${response.status}`;
    throw new Error(detail);
  }
  return data;
}

function normalizeSession(raw) {
  if (!raw) return null;
  const expiresAtSec = Number(raw.expires_at) || (Date.now() / 1000) + Number(raw.expires_in || 3600);
  return {
    access_token: raw.access_token,
    refresh_token: raw.refresh_token,
    token_type: raw.token_type || "bearer",
    expires_at: Math.floor(expiresAtSec),
    user: raw.user || null,
  };
}

// ── Public API used by popup.js / background.js ────────────────────────────

async function signIn(email, password) {
  if (!email || !password) {
    throw new Error("Enter your email and password.");
  }
  const data = await supabaseAuth("token?grant_type=password", { email, password });
  const session = normalizeSession(data);
  await setStoredSession(session);
  try { await fetchPlatformAccess(); } catch (_) { /* fetchPlatformAccess stores locked on failure */ }
  return session;
}

async function signOut() {
  const session = await getStoredSession();
  if (session?.access_token) {
    try {
      await supabaseAuth("logout", null, { token: session.access_token });
    } catch (_) {
      // Logout may fail if the server-side session is already gone — that's
      // fine, what matters is we forget it locally.
    }
  }
  await setStoredSession(null);
}

async function refreshSession(refreshToken) {
  if (!refreshToken) throw new Error("Missing refresh token.");
  const data = await supabaseAuth(
    "token?grant_type=refresh_token",
    { refresh_token: refreshToken },
  );
  const session = normalizeSession(data);
  await setStoredSession(session);
  return session;
}

/**
 * Return the current session, refreshing if it expires soon. Returns null
 * if no session is stored or the refresh fails (caller should send the
 * user back to the login screen).
 */
async function getValidSession() {
  let session = await getStoredSession();
  if (!session) return null;

  const nowSec = Math.floor(Date.now() / 1000);
  if (session.expires_at - nowSec > REFRESH_LEEWAY_SECONDS) {
    return session;
  }

  try {
    session = await refreshSession(session.refresh_token);
    return session;
  } catch (error) {
    console.warn("[PodPilot] session refresh failed:", error?.message || error);
    await setStoredSession(null);
    await setStoredPlatformAccess(LOCKED_PLATFORM_ACCESS);
    return null;
  }
}

/**
 * Inject a session that the dashboard handed us. Used when the user is
 * already signed in on the dashboard so they don't have to type their
 * password into the popup as well.
 */
async function adoptSession(rawSession) {
  if (!rawSession?.access_token) return null;
  const session = normalizeSession(rawSession);
  await setStoredSession(session);
  try { await fetchPlatformAccess(); } catch (_) { /* fetchPlatformAccess stores locked on failure */ }
  return session;
}

/**
 * Authenticated fetch against the PodPilot backend. Automatically:
 *   - refreshes the access token if needed
 *   - attaches Authorization: Bearer <jwt>
 *   - on 401/403, refreshes once and retries before re-prompting for login
 */
async function apiFetch(path, options = {}) {
  let session = await getValidSession();
  if (!session) {
    throw new ApiAuthError("Not signed in.");
  }

  const buildHeaders = (accessToken) => {
    const headers = new Headers(options.headers || {});
    headers.set("Authorization", `Bearer ${accessToken}`);
    if (!headers.has("Content-Type") && options.body && !(options.body instanceof FormData)) {
      headers.set("Content-Type", "application/json");
    }
    return headers;
  };

  let response = await fetch(`${API_BASE}${path}`, { ...options, headers: buildHeaders(session.access_token) });
  logBackendResponse(path, response, { attempt: 1 });
  if ((response.status === 401 || response.status === 403) && session.refresh_token) {
    try {
      session = await refreshSession(session.refresh_token);
      response = await fetch(`${API_BASE}${path}`, { ...options, headers: buildHeaders(session.access_token) });
      logBackendResponse(path, response, { attempt: 2 });
    } catch (error) {
      console.warn("[PodPilot] session refresh after backend auth failure failed:", error?.message || error);
      await setStoredSession(null);
      await setStoredPlatformAccess(LOCKED_PLATFORM_ACCESS);
      throw new ApiAuthError("Session expired. Please sign in again.");
    }
  }

  if (response.status === 401 || response.status === 403) {
    await setStoredSession(null);
    await setStoredPlatformAccess(LOCKED_PLATFORM_ACCESS);
    throw new ApiAuthError("Session expired. Please sign in again.");
  }
  return response;
}

/**
 * Return a tiny snapshot of the currently signed-in Supabase user (id +
 * email). Tries the persisted session first. If that doesn't include
 * `email` (e.g. the session came from the dashboard via adoptSession or
 * from a token refresh), call Supabase's /auth/v1/user endpoint with the
 * existing access token, then cache the result back into storage so
 * subsequent calls are free.
 *
 * Returns null when the extension is signed out.
 */
async function getCurrentUser() {
  const session = await getStoredSession();
  if (!session?.access_token) return null;

  const stored = session.user || {};
  if (stored.email) {
    if (stored.id) {
      authDebugLog("[Extension Account] user id=" + stored.id);
    }
    return { id: stored.id || "", email: stored.email };
  }

  // Fall back to the Supabase user endpoint.
  try {
    const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        apikey: SUPABASE_ANON_KEY,
      },
    });
    if (!response.ok) {
      console.warn(
        "[Extension Account] failed to load user email status=" +
          response.status,
      );
      return stored.id ? { id: stored.id, email: "" } : null;
    }
    const data = await response.json();
    const fresh = {
      id: data?.id || stored.id || "",
      email: data?.email || stored.email || "",
    };
    // Cache the user back into the stored session so future popups are fast.
    try {
      await setStoredSession({
        ...session,
        user: { ...stored, id: fresh.id, email: fresh.email },
      });
    } catch (_) { /* storage write failures are non-fatal */ }
    if (fresh.id) {
      authDebugLog("[Extension Account] user id=" + fresh.id);
    }
    return fresh;
  } catch (error) {
    console.warn(
      "[Extension Account] failed to load user email",
      error?.message || error,
    );
    return stored.id ? { id: stored.id, email: "" } : null;
  }
}

/**
 * Read-only subscription summary. Calls the same backend endpoint the
 * dashboard uses, with the extension's auth token attached. Returns null
 * on auth/network/HTTP errors so the popup can degrade gracefully.
 */
async function getSubscriptionStatus() {
  try {
    const response = await apiFetch("/api/me/subscription", { method: "GET" });
    if (!response.ok) {
      console.warn(
        "[Extension Account] subscription load failed status=",
        response.status,
        "request_id=",
        getResponseRequestId(response) || "none",
      );
      return null;
    }
    return response.json();
  } catch (error) {
    console.warn(
      "[Extension Account] subscription load failed",
      error?.message || error,
    );
    return null;
  }
}

async function getTrialEligibility() {
  try {
    const response = await apiFetch("/api/billing/trial-eligibility", {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
    });
    if (!response.ok) {
      console.warn(
        "[Extension Account] trial eligibility load failed status=",
        response.status,
        "request_id=",
        getResponseRequestId(response) || "none",
      );
      return null;
    }
    return response.json();
  } catch (error) {
    console.warn(
      "[Extension Account] trial eligibility load failed",
      error?.message || error,
    );
    return null;
  }
}

class ApiAuthError extends Error {}

function sanitizeDebugDetail(value) {
  return String(value || "")
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [redacted]")
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[jwt-redacted]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
}

async function readResponseDetail(response) {
  const text = await response.text().catch(() => "");
  if (!text) return "";
  try {
    const data = JSON.parse(text);
    const detail = data?.detail || data?.message || data?.error_description || data?.error || data?.msg || text;
    return sanitizeDebugDetail(typeof detail === "string" ? detail : JSON.stringify(detail));
  } catch (_) {
    return sanitizeDebugDetail(text);
  }
}

async function requestPlatformAccessWithSession(session, { attempt = 1 } = {}) {
  authDebugLog("[PlatformAccess] request", {
    API_BASE,
    endpoint: "/api/me/platform-access",
    attempt,
    hasSession: Boolean(session),
    hasAccessToken: Boolean(session?.access_token),
  });

  const response = await fetch(`${API_BASE}/api/me/platform-access`, {
    method: "GET",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${session.access_token}`,
    },
  });
  logBackendResponse("/api/me/platform-access", response, { attempt });
  const requestId = getResponseRequestId(response);

  authDebugLog("[PlatformAccess] response", {
    status: response.status,
    ok: response.ok,
    attempt,
    request_id: requestId || null,
  });

  if (!response.ok) {
    const detail = await readResponseDetail(response);
    authDebugLog("[PlatformAccess] error detail", {
      status: response.status,
      detail,
      attempt,
    });
    const error = new Error(appendRequestId(detail || `platform-access failed (${response.status})`, requestId));
    error.status = response.status;
    error.detail = detail;
    error.requestId = requestId;
    throw error;
  }

  return normalizePlatformAccess(await response.json());
}

async function refreshPlatformAccess({ retryAuth = true } = {}) {
  let session = await getStoredSession();
  authDebugLog("[PlatformAccess] refresh start", {
    API_BASE,
    hasSession: Boolean(session),
    hasAccessToken: Boolean(session?.access_token),
  });

  if (!session?.access_token) {
    await setStoredPlatformAccess(LOCKED_PLATFORM_ACCESS);
    authDebugLog("[PlatformAccess] final decision", {
      ok: false,
      reason: "missing_session",
      redbubble: false,
      teepublic: false,
    });
    throw new ApiAuthError(PLAN_VERIFY_SIGNIN_MESSAGE);
  }

  try {
    const data = await requestPlatformAccessWithSession(session, { attempt: 1 });
    await setStoredPlatformAccess(data);
    authDebugLog("[PlatformAccess] final decision", {
      ok: true,
      has_active_plan: data.has_active_plan,
      redbubble: data.redbubble,
      teepublic: data.teepublic,
      plan: data.plan || null,
    });
    return data;
  } catch (firstError) {
    const status = Number(firstError?.status);
    const shouldRetryAuth = retryAuth && (status === 401 || status === 403) && Boolean(session?.refresh_token);

    if (shouldRetryAuth) {
      authDebugLog("[PlatformAccess] auth retry", {
        status,
        hasRefreshToken: true,
      });
      try {
        session = await refreshSession(session.refresh_token);
        const data = await requestPlatformAccessWithSession(session, { attempt: 2 });
        await setStoredPlatformAccess(data);
        authDebugLog("[PlatformAccess] final decision", {
          ok: true,
          retried: true,
          has_active_plan: data.has_active_plan,
          redbubble: data.redbubble,
          teepublic: data.teepublic,
          plan: data.plan || null,
        });
        return data;
      } catch (retryError) {
        authDebugLog("[PlatformAccess] auth retry failed", {
          status: retryError?.status || null,
          detail: sanitizeDebugDetail(retryError?.detail || retryError?.message || retryError),
        });
        await setStoredSession(null);
        await setStoredPlatformAccess(LOCKED_PLATFORM_ACCESS);
        throw new ApiAuthError(PLAN_VERIFY_AUTH_MESSAGE);
      }
    }

    await setStoredPlatformAccess(LOCKED_PLATFORM_ACCESS);
    const isAuthFailure = status === 401 || status === 403 || firstError instanceof ApiAuthError;
    const message = isAuthFailure
      ? PLAN_VERIFY_AUTH_MESSAGE
      : (firstError instanceof TypeError ? PLAN_VERIFY_BACKEND_MESSAGE : `${PLAN_VERIFY_AUTH_MESSAGE} ${sanitizeDebugDetail(firstError?.detail || firstError?.message || firstError)}`.trim());
    authDebugLog("[PlatformAccess] final decision", {
      ok: false,
      status: Number.isFinite(status) ? status : null,
      reason: isAuthFailure ? "auth_or_api" : "network_or_backend",
      message,
    });
    if (isAuthFailure) throw new ApiAuthError(message);
    throw new Error(message);
  }
}

async function fetchPlatformAccess() {
  try {
    return await refreshPlatformAccess();
  } catch (error) {
    console.warn("[Extension Account] platform access load failed:", error?.message || error);
    await setStoredPlatformAccess(LOCKED_PLATFORM_ACCESS);
    return { ...LOCKED_PLATFORM_ACCESS };
  }
}

// ── Billing / subscription helpers ──────────────────────────────────────────

/**
 * Check whether the current user can start an upload right now.
 * Returns the JSON body from the backend (with can_upload, plan, etc).
 *
 * Throws on auth/network/HTTP errors so callers can show a clear "Could not
 * verify subscription" message and skip starting the queue.
 */
async function checkUploadAccess() {
  authDebugLog("[Billing] checking upload access...");
  const response = await apiFetch("/api/billing/check-upload-access", {
    method: "POST",
    headers: { Accept: "application/json" },
    body: JSON.stringify({}),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    const error = new Error(appendRequestId(
      `check-upload-access failed (${response.status}) ${text || ""}`.trim(),
      getResponseRequestId(response),
    ));
    error.status = response.status;
    error.requestId = getResponseRequestId(response);
    throw error;
  }
  const data = await response.json();
  if (data && data.can_upload === false) {
    console.warn("[Billing] upload blocked reason=" + (data.reason || "unknown"));
  } else {
    authDebugLog(
      "[Billing] access allowed plan=" + (data?.plan || "?")
    );
  }
  return data;
}

/**
 * Increment usage by `amount` (default 1) after a successful upload.
 * Never throws — billing should not break the upload flow. Returns the
 * backend JSON on success, or null on failure. Retries once on transient
 * errors before giving up.
 */
async function incrementUploadUsage(amount = 1) {
  authDebugLog("[Billing] incrementing usage for successful upload...");
  const send = async () => {
    const response = await apiFetch("/api/usage/increment-upload", {
      method: "POST",
      body: JSON.stringify({ amount }),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(appendRequestId(
        `increment-upload failed (${response.status}) ${text || ""}`.trim(),
        getResponseRequestId(response),
      ));
    }
    return response.json().catch(() => ({}));
  };

  try {
    const data = await send();
    authDebugLog("[Billing] usage incremented uploaded_count=" + (data?.uploaded_count ?? "?"));
    return data;
  } catch (firstError) {
    console.warn("[Billing] failed to increment usage (will retry once):", firstError?.message || firstError);
    try {
      const data = await send();
      authDebugLog("[Billing] usage incremented uploaded_count=" + (data?.uploaded_count ?? "?"));
      return data;
    } catch (secondError) {
      console.warn("[Billing] failed to increment usage:", secondError?.message || secondError);
      return null;
    }
  }
}

// ── Module exports for plain <script> popup ─────────────────────────────────

const PodPilotAuth = {
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  API_BASE,
  ApiAuthError,
  signIn,
  signOut,
  getStoredSession,
  setStoredSession,
  getValidSession,
  refreshSession,
  adoptSession,
  apiFetch,
  checkUploadAccess,
  refreshPlatformAccess,
  fetchPlatformAccess,
  getStoredPlatformAccess,
  getCachedActivePlatformAccess,
  setStoredPlatformAccess,
  incrementUploadUsage,
  getCurrentUser,
  getSubscriptionStatus,
  getTrialEligibility,
  getResponseRequestId,
};

// Make available to popup.js (loaded before it via <script>) and to the
// background service worker (which uses importScripts).
if (typeof self !== "undefined") {
  self.PodPilotAuth = PodPilotAuth;
}
if (typeof window !== "undefined") {
  window.PodPilotAuth = PodPilotAuth;
}
