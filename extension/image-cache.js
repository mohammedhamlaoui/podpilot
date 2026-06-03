(function () {
  const CACHE_NAME = "podpilot-ui-image-cache-v1";
  const CACHE_PREFIX = "/__podpilot_extension_ui_image_cache__/";
  const DEBUG = false;
  const memoryUrls = new Map();

  function cacheLog(message, cacheKey) {
    if (!DEBUG) return;
    const variant = String(cacheKey || "").split(":")[0] || "image";
    console.log(`[IMG CACHE] ${message} ${variant}`, cacheKey);
  }

  function isCacheAvailable() {
    return typeof caches !== "undefined" && typeof fetch === "function";
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

  function buildImageCacheKey(design = {}, userId = "", variant = "thumbnail") {
    const safeVariant = variant === "preview" ? "preview" : "thumbnail";
    const designPart = String(design.id || design.design_id || "unknown").trim() || "unknown";
    const assetPart = String(
      safeVariant === "preview"
        ? design.image_r2_key || "no-r2-key"
        : design.thumbnail_r2_key || design.image_r2_key || "no-r2-key",
    ).trim() || "no-r2-key";
    const userPart = String(userId || "").trim();
    return userPart
      ? `${safeVariant}:${userPart}:${designPart}:${assetPart}`
      : `${safeVariant}:${designPart}:${assetPart}`;
  }

  function getImageUrl(design = {}, variant = "thumbnail") {
    if (variant === "preview") {
      return String(design.image_url || design.upload_url || "").trim();
    }
    return String(design.thumbnail_url || design.thumbnailUrl || design.preview_url || design.image_url || "").trim();
  }

  function hasStableCacheKey(design = {}, variant = "thumbnail") {
    return variant === "preview"
      ? Boolean(design.image_r2_key)
      : Boolean(design.thumbnail_r2_key || design.image_r2_key);
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
      return objectUrlFromBlob(cacheKey, blob);
    } catch (_) {
      return remoteUrl;
    }
  }

  async function getOrCacheImageUrl(cacheKey, remoteUrl) {
    if (!cacheKey) return remoteUrl || "";
    const cached = await getCachedImageObjectUrl(cacheKey);
    if (cached) return cached;
    return fetchAndCacheImage(cacheKey, remoteUrl);
  }

  async function getOrCacheImageForDesign(design, userId = "", variant = "thumbnail") {
    const remoteUrl = getImageUrl(design, variant);
    if (!remoteUrl) return "";
    if (!hasStableCacheKey(design, variant)) return remoteUrl;
    return getOrCacheImageUrl(buildImageCacheKey(design, userId, variant), remoteUrl);
  }

  async function setImageSourceFromCache(img, design, userId = "", variant = "thumbnail") {
    const remoteUrl = getImageUrl(design, variant);
    if (!img || !remoteUrl) return "";
    if (!hasStableCacheKey(design, variant)) {
      if (img.src !== remoteUrl) img.src = remoteUrl;
      img.dataset.cachedImageSrc = remoteUrl;
      return remoteUrl;
    }

    const cacheKey = buildImageCacheKey(design, userId, variant);
    if (img.dataset.imageCacheKey === cacheKey && img.dataset.cachedImageSrc && img.src) {
      cacheLog("skip refetch same key", cacheKey);
      return img.dataset.cachedImageSrc;
    }
    img.dataset.imageCacheKey = cacheKey;

    const memorySrc = getMemoryCachedImageUrl(cacheKey);
    if (memorySrc && img.src !== memorySrc) img.src = memorySrc;

    const cachedSrc = await getOrCacheImageUrl(cacheKey, remoteUrl);
    if (img.isConnected && img.dataset.imageCacheKey === cacheKey && cachedSrc && img.src !== cachedSrc) {
      img.src = cachedSrc;
    }
    img.dataset.cachedImageSrc = cachedSrc || memorySrc || remoteUrl;
    return cachedSrc || memorySrc || remoteUrl;
  }

  window.PodPilotImageCache = {
    buildImageCacheKey,
    getImageUrl,
    getCachedImageObjectUrl,
    getMemoryCachedImageUrl,
    getOrCacheImageUrl,
    getOrCacheImageForDesign,
    setImageSourceFromCache,
  };
})();
