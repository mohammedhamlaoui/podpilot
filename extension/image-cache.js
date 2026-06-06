(function () {
  const CACHE_NAME = "podpilot-ui-image-cache-v1";
  const CACHE_PREFIX = "/__podpilot_extension_ui_image_cache__/";
  const DEBUG = false;
  const FETCH_FAILURE_COOLDOWN_MS = 60 * 1000;
  const memoryUrls = new Map();
  const fetchFailureUntil = new Map();

  function cacheLog(message, cacheKey) {
    if (!DEBUG) return;
    const variant = String(cacheKey || "").split(":")[0] || "image";
    console.log(`[IMG CACHE] ${message} ${variant}`, cacheKey);
  }

  function isCacheAvailable() {
    return typeof caches !== "undefined" && typeof fetch === "function";
  }

  function isFetchableImageUrl(url) {
    const raw = String(url || "");
    return /^https?:\/\//i.test(raw) || raw.startsWith("/api/") || raw.startsWith("/designs/");
  }

  function isProtectedProxyUrl(url) {
    const raw = String(url || "").trim();
    if (raw.startsWith("/api/designs/") || raw.startsWith("/designs/")) return true;
    try {
      const base = self.PodPilotAuth?.API_BASE || self.location?.origin || "http://localhost";
      const parsed = new URL(raw, base);
      return parsed.pathname.startsWith("/api/designs/") || parsed.pathname.startsWith("/designs/");
    } catch (_) {
      return false;
    }
  }

  function resolveFetchUrl(url) {
    const raw = String(url || "").trim();
    if (/^https?:\/\//i.test(raw)) return raw;
    const base = self.PodPilotAuth?.API_BASE || self.location?.origin || "";
    try {
      return new URL(raw, base || self.location?.origin).toString();
    } catch (_) {
      return raw;
    }
  }

  async function authHeadersForImage(url) {
    if (!isProtectedProxyUrl(url)) return {};
    const session = await self.PodPilotAuth?.getValidSession?.();
    const token = session?.access_token || "";
    if (!token) throw new self.PodPilotAuth.ApiAuthError("Not signed in.");
    return { Authorization: `Bearer ${token}` };
  }

  function hashString(value) {
    const text = String(value || "");
    let hash = 2166136261;
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
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

  function revokeObjectUrl(cacheKey) {
    const existing = memoryUrls.get(cacheKey);
    if (existing?.startsWith("blob:")) URL.revokeObjectURL(existing);
    memoryUrls.delete(cacheKey);
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

  function getImageUrl(design = {}, variant = "thumbnail") {
    if (variant === "preview") {
      return String(design.image_url || design.upload_url || "").trim();
    }
    return String(design.thumbnail_url || design.thumbnailUrl || design.preview_url || design.image_url || "").trim();
  }

  function buildImageCacheKey(design = {}, userId = "", variant = "thumbnail") {
    const safeVariant = variant === "preview" ? "preview" : "thumbnail";
    const designPart = String(design.id || design.design_id || "unknown").trim() || "unknown";
    const remoteUrl = getImageUrl(design, safeVariant);
    const assetSource = String(
      safeVariant === "preview"
        ? design.image_r2_key || remoteUrl || "no-image"
        : design.thumbnail_r2_key || design.image_r2_key || remoteUrl || "no-image",
    ).trim() || "no-image";
    const assetPart = assetSource === "no-image" ? assetSource : `asset-${hashString(assetSource)}`;
    const userPart = String(userId || "").trim();
    return userPart
      ? `${safeVariant}:${userPart}:${designPart}:${assetPart}`
      : `${safeVariant}:${designPart}:${assetPart}`;
  }

  function hasUsableCacheKey(design = {}, variant = "thumbnail") {
    return Boolean(design.id || design.design_id || getImageUrl(design, variant));
  }

  function getMemoryCachedImageUrl(cacheKey) {
    const cached = memoryUrls.get(cacheKey) || "";
    if (cached) cacheLog("hit", cacheKey);
    return cached;
  }

  async function getCachedImageObjectUrl(cacheKey) {
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

  async function fetchAndCacheImage(cacheKey, remoteUrl) {
    if (!cacheKey || !remoteUrl) return "";
    const existing = memoryUrls.get(cacheKey);
    if (existing) {
      cacheLog("skip refetch same key", cacheKey);
      return existing;
    }
    if (isFetchCoolingDown(cacheKey)) {
      cacheLog("skip fetch cooldown", cacheKey);
      return isProtectedProxyUrl(remoteUrl) ? "" : remoteUrl;
    }
    if (!isFetchableImageUrl(remoteUrl)) return remoteUrl;

    try {
      const protectedProxy = isProtectedProxyUrl(remoteUrl);
      const headers = await authHeadersForImage(remoteUrl);
      const response = await fetch(resolveFetchUrl(remoteUrl), {
        mode: "cors",
        credentials: "omit",
        headers,
      });
      if (!response.ok) throw new Error(`Image fetch failed (${response.status})`);
      const blob = await response.blob();
      if (!blob.size) throw new Error("Image fetch returned an empty body.");

      if (!protectedProxy && isCacheAvailable()) {
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
      }

      fetchFailureUntil.delete(cacheKey);
      cacheLog("cached", cacheKey);
      return objectUrlFromBlob(cacheKey, blob);
    } catch (error) {
      noteFetchFailure(cacheKey);
      cacheLog(`fetch failed ${error?.message || "unknown"}`, cacheKey);
      return isProtectedProxyUrl(remoteUrl) ? "" : remoteUrl;
    }
  }

  async function getOrCacheImageUrl(cacheKey, remoteUrl) {
    if (!cacheKey) return isProtectedProxyUrl(remoteUrl) ? "" : (remoteUrl || "");
    const cached = await getCachedImageObjectUrl(cacheKey);
    if (cached) return cached;
    return fetchAndCacheImage(cacheKey, remoteUrl);
  }

  async function getOrCacheImageForDesign(design, userId = "", variant = "thumbnail") {
    const remoteUrl = getImageUrl(design, variant);
    if (!remoteUrl || !hasUsableCacheKey(design, variant)) return "";
    return getOrCacheImageUrl(buildImageCacheKey(design, userId, variant), remoteUrl);
  }

  async function setImageSourceFromCache(img, design, userId = "", variant = "thumbnail") {
    const remoteUrl = getImageUrl(design, variant);
    if (!img || !remoteUrl || !hasUsableCacheKey(design, variant)) return "";

    const protectedProxy = isProtectedProxyUrl(remoteUrl);
    const cacheKey = buildImageCacheKey(design, userId, variant);
    if (img.dataset.imageCacheKey === cacheKey && img.dataset.cachedImageSrc && img.src) {
      cacheLog("skip refetch same key", cacheKey);
      return img.dataset.cachedImageSrc;
    }
    img.dataset.imageCacheKey = cacheKey;

    const memorySrc = getMemoryCachedImageUrl(cacheKey);
    if (memorySrc && img.src !== memorySrc) img.src = memorySrc;

    const cachedSrc = await getOrCacheImageUrl(cacheKey, remoteUrl);
    if (img.isConnected && img.dataset.imageCacheKey === cacheKey) {
      if (cachedSrc && img.src !== cachedSrc) {
        img.src = cachedSrc;
      } else if (!cachedSrc && protectedProxy) {
        img.removeAttribute("src");
      }
    }
    img.dataset.cachedImageSrc = cachedSrc || memorySrc || (protectedProxy ? "" : remoteUrl);
    return img.dataset.cachedImageSrc;
  }

  function pruneObjectUrls(activeCacheKeys = []) {
    const active = new Set(activeCacheKeys);
    for (const cacheKey of Array.from(memoryUrls.keys())) {
      if (!active.has(cacheKey)) revokeObjectUrl(cacheKey);
    }
  }

  function pruneCacheForDesigns(designs = [], userId = "") {
    const activeKeys = [];
    for (const design of designs || []) {
      if (getImageUrl(design, "thumbnail")) {
        activeKeys.push(buildImageCacheKey(design, userId, "thumbnail"));
      }
      if (getImageUrl(design, "preview")) {
        activeKeys.push(buildImageCacheKey(design, userId, "preview"));
      }
    }
    pruneObjectUrls(activeKeys);
  }

  function revokeAllObjectUrls() {
    for (const cacheKey of Array.from(memoryUrls.keys())) {
      revokeObjectUrl(cacheKey);
    }
    fetchFailureUntil.clear();
  }

  window.PodPilotImageCache = {
    buildImageCacheKey,
    getImageUrl,
    getCachedImageObjectUrl,
    getMemoryCachedImageUrl,
    getOrCacheImageUrl,
    getOrCacheImageForDesign,
    isProtectedProxyUrl,
    pruneCacheForDesigns,
    revokeAllObjectUrls,
    setImageSourceFromCache,
  };
})();
