const CACHE_NAME = "podpilot-ui-image-cache-v1";
const CACHE_PREFIX = "/__podpilot_ui_image_cache__/";
const DEBUG = false;
const FETCH_FAILURE_COOLDOWN_MS = 10 * 60 * 1000;

const memoryUrls = new Map();
const fetchFailureUntil = new Map();

function cacheLog(message, cacheKey) {
  if (!DEBUG) return;
  const variant = String(cacheKey || "").split(":")[0] || "image";
  console.log(`[IMG CACHE] ${message} ${variant}`, cacheKey);
}

function devImageCacheLog(message) {
  if (!import.meta.env.DEV) return;
  // eslint-disable-next-line no-console
  console.info(`[ImageCache] ${message}`);
}

function isCacheAvailable() {
  return typeof window !== "undefined" && "caches" in window && typeof fetch === "function";
}

function isRemoteImageUrl(url) {
  return /^https?:\/\//i.test(String(url || ""));
}

function cacheRequestUrl(cacheKey) {
  return `${CACHE_PREFIX}${encodeURIComponent(cacheKey)}`;
}

function objectUrlFromBlob(cacheKey, blob) {
  const existing = memoryUrls.get(cacheKey);
  if (existing) return existing;
  const objectUrl = URL.createObjectURL(blob);
  memoryUrls.set(cacheKey, objectUrl);
  return objectUrl;
}

function isFetchCoolingDown(cacheKey) {
  const retryAt = fetchFailureUntil.get(cacheKey) || 0;
  if (retryAt > Date.now()) return true;
  if (retryAt) fetchFailureUntil.delete(cacheKey);
  return false;
}

function noteFetchFailure(cacheKey) {
  if (!cacheKey) return;
  fetchFailureUntil.set(cacheKey, Date.now() + FETCH_FAILURE_COOLDOWN_MS);
}

export function buildImageCacheKey({
  variant = "thumbnail",
  userId = "",
  designId = "",
  r2Key = "",
} = {}) {
  const safeVariant = variant === "preview" ? "preview" : "thumbnail";
  const designPart = String(designId || "unknown").trim() || "unknown";
  const assetPart = String(r2Key || "no-r2-key").trim() || "no-r2-key";
  const userPart = String(userId || "").trim();
  return userPart
    ? `${safeVariant}:${userPart}:${designPart}:${assetPart}`
    : `${safeVariant}:${designPart}:${assetPart}`;
}

export function getMemoryCachedImageUrl(cacheKey) {
  const cached = memoryUrls.get(cacheKey) || "";
  if (cached) cacheLog("hit", cacheKey);
  return cached;
}

export async function getCachedImageObjectUrl(cacheKey) {
  if (!cacheKey) return "";
  const existing = memoryUrls.get(cacheKey);
  if (existing) {
    cacheLog("hit", cacheKey);
    return existing;
  }
  if (!isCacheAvailable()) return "";

  try {
    const cache = await caches.open(CACHE_NAME);
    const response = await cache.match(cacheRequestUrl(cacheKey));
    if (!response) {
      cacheLog("miss", cacheKey);
      return "";
    }
    const blob = await response.blob();
    cacheLog("hit", cacheKey);
    return objectUrlFromBlob(cacheKey, blob);
  } catch (_) {
    return "";
  }
}

export const getCachedImageUrl = getCachedImageObjectUrl;

export async function fetchAndCacheImage(cacheKey, remoteUrl) {
  if (!cacheKey || !remoteUrl) return "";
  const existing = memoryUrls.get(cacheKey);
  if (existing) {
    cacheLog("skip refetch same key", cacheKey);
    return existing;
  }
  if (isFetchCoolingDown(cacheKey)) {
    cacheLog("skip fetch cooldown", cacheKey);
    return remoteUrl;
  }
  if (!isRemoteImageUrl(remoteUrl) || !isCacheAvailable()) return remoteUrl;

  try {
    const response = await fetch(remoteUrl, { mode: "cors", credentials: "omit" });
    if (!response.ok) throw new Error(`Image fetch failed (${response.status})`);
    const blob = await response.blob();
    const cache = await caches.open(CACHE_NAME);
    await cache.put(
      cacheRequestUrl(cacheKey),
      new Response(blob, {
        headers: {
          "Content-Type": blob.type || response.headers.get("Content-Type") || "application/octet-stream",
          "X-PodPilot-Cached-At": new Date().toISOString(),
        },
      }),
    );
    cacheLog("cached", cacheKey);
    fetchFailureUntil.delete(cacheKey);
    return objectUrlFromBlob(cacheKey, blob);
  } catch (error) {
    noteFetchFailure(cacheKey);
    devImageCacheLog("thumbnail blob cache skipped due to CORS/fetch failure");
    cacheLog(`fetch failed ${error?.message || "unknown"}`, cacheKey);
    return remoteUrl;
  }
}

export async function getOrCacheImageUrl(cacheKey, remoteUrl, { fetchRemote = true } = {}) {
  if (!cacheKey) return remoteUrl || "";
  const cached = await getCachedImageObjectUrl(cacheKey);
  if (cached) return cached;
  if (!fetchRemote) return remoteUrl || "";
  return fetchAndCacheImage(cacheKey, remoteUrl);
}

export async function clearCachedImage(cacheKey) {
  if (!cacheKey) return;
  const existing = memoryUrls.get(cacheKey);
  if (existing?.startsWith("blob:")) URL.revokeObjectURL(existing);
  memoryUrls.delete(cacheKey);
  fetchFailureUntil.delete(cacheKey);
  if (!isCacheAvailable()) return;
  try {
    const cache = await caches.open(CACHE_NAME);
    await cache.delete(cacheRequestUrl(cacheKey));
  } catch (_) {
    // Cache eviction is best-effort UI cleanup.
  }
}

export async function clearCachedDesignImages(design = {}, userId = "") {
  const designId = design.id || design.design_id || "";
  const tasks = [];
  if (designId && (design.thumbnail_r2_key || design.image_r2_key)) {
    tasks.push(clearCachedImage(buildImageCacheKey({
      variant: "thumbnail",
      userId,
      designId,
      r2Key: design.thumbnail_r2_key || design.image_r2_key,
    })));
  }
  if (designId && design.image_r2_key) {
    tasks.push(clearCachedImage(buildImageCacheKey({
      variant: "preview",
      userId,
      designId,
      r2Key: design.image_r2_key,
    })));
  }
  await Promise.all(tasks);
}
