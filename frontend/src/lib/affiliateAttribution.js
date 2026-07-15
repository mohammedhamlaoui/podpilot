const STORAGE_KEY = "podpilot:affiliate-attribution";
const VISITOR_KEY = "podpilot:affiliate-visitor";
const COOKIE_NAME = "podpilot_affiliate";
const MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

function parseJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export function getAffiliateVisitorId() {
  try {
    const existing = localStorage.getItem(VISITOR_KEY);
    if (existing) return existing;
    const created = crypto.randomUUID();
    localStorage.setItem(VISITOR_KEY, created);
    return created;
  } catch {
    return crypto.randomUUID();
  }
}

export function storeAffiliateAttribution(attribution) {
  const value = JSON.stringify({
    referral_code: attribution.referral_code,
    attribution_token: attribution.attribution_token,
    stored_at: new Date().toISOString(),
  });
  try {
    localStorage.setItem(STORAGE_KEY, value);
  } catch {
    // The first-party cookie remains the primary fallback.
  }
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${COOKIE_NAME}=${encodeURIComponent(value)}; Max-Age=${MAX_AGE_SECONDS}; Path=/; SameSite=Lax${secure}`;
}

export function readAffiliateAttribution() {
  const cookie = document.cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${COOKIE_NAME}=`));
  const cookieValue = cookie ? decodeURIComponent(cookie.slice(COOKIE_NAME.length + 1)) : "";
  let fallbackValue = "";
  try {
    fallbackValue = localStorage.getItem(STORAGE_KEY) || "";
  } catch {
    fallbackValue = "";
  }
  const stored = parseJson(cookieValue) || parseJson(fallbackValue);
  if (!stored?.attribution_token || !stored?.stored_at) return null;
  const age = Date.now() - new Date(stored.stored_at).getTime();
  if (!Number.isFinite(age) || age < 0 || age > MAX_AGE_SECONDS * 1000) {
    clearAffiliateAttribution();
    return null;
  }
  return stored;
}

export function clearAffiliateAttribution() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore storage-denied browsers.
  }
  document.cookie = `${COOKIE_NAME}=; Max-Age=0; Path=/; SameSite=Lax`;
}
