export const DESIGN_CACHE_VERSION = 1;
export const DESIGN_CACHE_TTL_MS = 10 * 60 * 1000;

const DB_NAME = "podpilot_design_cache";
const DB_VERSION = 1;
const STORE_NAME = "podpilot_designs";
const SIGNED_URL_FALLBACK_TTL_MS = 55 * 60 * 1000;
const SIGNED_URL_SAFETY_MS = 60 * 1000;
const MARKETPLACES = new Set(["redbubble", "teepublic"]);

let dbPromise = null;

function devCacheLog(message) {
  if (!import.meta.env.DEV) return;
  // eslint-disable-next-line no-console
  console.log(`[Cache] ${message}`);
}

function normalizeMarketplace(marketplace) {
  return MARKETPLACES.has(marketplace) ? marketplace : "redbubble";
}

function cacheKey(userId, marketplace) {
  return `designs:${userId}:${normalizeMarketplace(marketplace)}`;
}

function isIndexedDbAvailable() {
  return typeof window !== "undefined" && "indexedDB" in window;
}

function openDb() {
  if (!isIndexedDbAvailable()) return Promise.resolve(null);
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve) => {
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      const store = db.objectStoreNames.contains(STORE_NAME)
        ? request.transaction.objectStore(STORE_NAME)
        : db.createObjectStore(STORE_NAME, { keyPath: "key" });

      if (!store.indexNames.contains("userId")) {
        store.createIndex("userId", "userId", { unique: false });
      }
      if (!store.indexNames.contains("marketplace")) {
        store.createIndex("marketplace", "marketplace", { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      devCacheLog(`unavailable reason=${request.error?.message || "open_failed"}`);
      resolve(null);
    };
    request.onblocked = () => {
      devCacheLog("blocked");
      resolve(null);
    };
  });

  return dbPromise;
}

async function withStore(mode, callback) {
  const db = await openDb();
  if (!db) return null;

  return new Promise((resolve) => {
    const transaction = db.transaction(STORE_NAME, mode);
    const store = transaction.objectStore(STORE_NAME);
    let settled = false;

    function finish(value) {
      if (settled) return;
      settled = true;
      resolve(value);
    }

    transaction.onerror = () => finish(null);
    transaction.onabort = () => finish(null);
    transaction.oncomplete = () => {
      if (!settled) finish(true);
    };

    try {
      const result = callback(store);
      if (result && typeof result.onsuccess !== "undefined") {
        result.onsuccess = () => finish(result.result ?? true);
        result.onerror = () => finish(null);
      }
    } catch (_) {
      finish(null);
    }
  });
}

function parseAmzDate(value) {
  const match = String(value || "").match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
  if (!match) return 0;
  const [, year, month, day, hour, minute, second] = match;
  return Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second));
}

function inferSignedUrlExpiresAt(url, cachedAt = Date.now()) {
  if (!url || !/^https?:\/\//i.test(String(url))) return null;
  try {
    const parsed = new URL(url);
    const amzDate = parseAmzDate(parsed.searchParams.get("X-Amz-Date"));
    const amzExpires = Number(parsed.searchParams.get("X-Amz-Expires") || 0);
    if (amzDate && amzExpires > 0) {
      return amzDate + amzExpires * 1000 - SIGNED_URL_SAFETY_MS;
    }

    const expires = Number(parsed.searchParams.get("Expires") || 0);
    if (expires > 0) {
      return expires * 1000 - SIGNED_URL_SAFETY_MS;
    }
  } catch (_) {
    // Fall through to the conservative local TTL.
  }
  return cachedAt + SIGNED_URL_FALLBACK_TTL_MS;
}

function isUrlFresh(expiresAt, now = Date.now()) {
  return !expiresAt || Number(expiresAt) > now;
}

function isLegacySignedStorageUrl(value) {
  const url = String(value || "");
  return /^https?:\/\//i.test(url) && /r2\.cloudflarestorage\.com/i.test(url);
}

function proxyUrlForDesign(design, kind) {
  const id = String(design?.id || "").trim();
  return id ? `/api/designs/${encodeURIComponent(id)}/${kind}` : "";
}

function normalizeDesignForCache(design, cachedAt = Date.now()) {
  const next = { ...(design || {}) };
  if (isLegacySignedStorageUrl(next.image_url)) {
    next.image_url = proxyUrlForDesign(next, "image");
    next.image_url_expires_at = null;
  }
  if (isLegacySignedStorageUrl(next.thumbnail_url)) {
    next.thumbnail_url = proxyUrlForDesign(next, "thumbnail");
    next.thumbnail_url_expires_at = null;
  }
  if (next.image_url) {
    next.image_url_expires_at = next.image_url_expires_at || inferSignedUrlExpiresAt(next.image_url, cachedAt);
  }
  if (next.thumbnail_url) {
    next.thumbnail_url_expires_at = next.thumbnail_url_expires_at || inferSignedUrlExpiresAt(next.thumbnail_url, cachedAt);
  }
  return next;
}

function normalizeDesignForDisplay(design, now = Date.now()) {
  const next = { ...(design || {}) };
  if (isLegacySignedStorageUrl(next.image_url)) {
    next.image_url = proxyUrlForDesign(next, "image");
    next.image_url_expires_at = null;
  }
  if (isLegacySignedStorageUrl(next.thumbnail_url)) {
    next.thumbnail_url = proxyUrlForDesign(next, "thumbnail");
    next.thumbnail_url_expires_at = null;
  }
  if (next.image_url && !isUrlFresh(next.image_url_expires_at, now)) {
    next.image_url = "";
  }
  if (next.thumbnail_url && !isUrlFresh(next.thumbnail_url_expires_at, now)) {
    next.thumbnail_url = "";
  }
  return next;
}

function normalizeCachedRecord(record) {
  if (!record || record.version !== DESIGN_CACHE_VERSION) return null;
  return {
    ...record,
    designs: Array.isArray(record.designs)
      ? record.designs.map((design) => normalizeDesignForDisplay(design))
      : [],
  };
}

function designDedupeKeys(design, marketplace) {
  if (!design) return [];
  const keys = [];
  if (design.id) keys.push(`id:${design.id}`);
  if (design.local_id) keys.push(`local:${design.local_id}`);
  if (design.tempId) keys.push(`local:${design.tempId}`);
  if (design.filename) keys.push(`file:${normalizeMarketplace(design.marketplace || marketplace)}:${String(design.filename).trim().toLowerCase()}`);
  return keys;
}

function designDedupeKey(design, marketplace) {
  return designDedupeKeys(design, marketplace)[0] || "";
}

function mergeDesignLists(currentDesigns = [], incomingDesigns = [], marketplace, { prepend = false } = {}) {
  const safeCurrent = Array.isArray(currentDesigns) ? currentDesigns.filter(Boolean) : [];
  const safeIncoming = Array.isArray(incomingDesigns) ? incomingDesigns.filter(Boolean) : [];
  const currentByKey = new Map();
  const aliasToKey = new Map();
  const currentOrder = [];

  safeCurrent.forEach((design) => {
    const aliases = designDedupeKeys(design, marketplace);
    const key = aliases[0] || "";
    if (!key) {
      currentOrder.push(design);
      return;
    }
    if (!currentByKey.has(key)) currentOrder.push(key);
    currentByKey.set(key, design);
    aliases.forEach((alias) => aliasToKey.set(alias, key));
  });

  const incomingKeys = [];
  safeIncoming.forEach((design) => {
    const aliases = designDedupeKeys(design, marketplace);
    const key = aliases.find((alias) => aliasToKey.has(alias)) ? aliasToKey.get(aliases.find((alias) => aliasToKey.has(alias))) : aliases[0] || "";
    if (!key) {
      incomingKeys.push(design);
      return;
    }
    const existing = currentByKey.get(key) || {};
    if (!currentByKey.has(key) || prepend) incomingKeys.push(key);
    currentByKey.set(key, { ...existing, ...design });
    aliases.forEach((alias) => aliasToKey.set(alias, key));
  });

  const incomingKeySet = new Set(incomingKeys.filter((key) => typeof key === "string"));
  const orderedKeys = prepend
    ? [...incomingKeys, ...currentOrder.filter((key) => !(typeof key === "string" && incomingKeySet.has(key)))]
    : [...currentOrder, ...incomingKeys.filter((key) => !(typeof key === "string" && currentOrder.includes(key)))];

  return orderedKeys.map((keyOrDesign) => (
    typeof keyOrDesign === "string" ? currentByKey.get(keyOrDesign) : keyOrDesign
  )).filter(Boolean);
}

export function isCacheFresh(cachedAt, ttlMs = DESIGN_CACHE_TTL_MS) {
  return Boolean(cachedAt && Date.now() - Number(cachedAt) < ttlMs);
}

export async function getCachedDesigns(userId, marketplace) {
  if (!userId) return null;
  const safeMarketplace = normalizeMarketplace(marketplace);
  const record = await withStore("readonly", (store) => store.get(cacheKey(userId, safeMarketplace)));
  const normalized = normalizeCachedRecord(record);
  if (!normalized || normalized.userId !== userId || normalized.marketplace !== safeMarketplace) {
    if (record) {
      await withStore("readwrite", (store) => store.delete(cacheKey(userId, safeMarketplace)));
    }
    devCacheLog(`miss marketplace=${safeMarketplace}`);
    return null;
  }
  devCacheLog(`hit marketplace=${safeMarketplace} count=${normalized.designs.length}`);
  if (!isCacheFresh(normalized.cachedAt)) {
    devCacheLog(`stale marketplace=${safeMarketplace}`);
  }
  return normalized;
}

export async function setCachedDesigns(userId, marketplace, designs = []) {
  if (!userId) return null;
  const safeMarketplace = normalizeMarketplace(marketplace);
  const now = Date.now();
  const record = {
    key: cacheKey(userId, safeMarketplace),
    userId,
    marketplace: safeMarketplace,
    designs: Array.isArray(designs) ? designs.map((design) => normalizeDesignForCache(design, now)) : [],
    cachedAt: now,
    lastSyncedAt: now,
    version: DESIGN_CACHE_VERSION,
  };
  await withStore("readwrite", (store) => store.put(record));
  return normalizeCachedRecord(record);
}

export async function updateCachedDesign(userId, marketplace, design) {
  if (!userId || !design?.id) return null;
  const safeMarketplace = normalizeMarketplace(marketplace);
  const cached = await getCachedDesigns(userId, safeMarketplace);
  const nextDesigns = mergeDesignLists(cached?.designs || [], [design], safeMarketplace, { prepend: true });
  return setCachedDesigns(userId, safeMarketplace, nextDesigns);
}

export async function mergeCachedDesigns(userId, marketplace, designs = []) {
  if (!userId) return null;
  const safeMarketplace = normalizeMarketplace(marketplace);
  const incoming = Array.isArray(designs) ? designs : [designs].filter(Boolean);
  const cached = await getCachedDesigns(userId, safeMarketplace);
  const nextDesigns = mergeDesignLists(cached?.designs || [], incoming, safeMarketplace);
  devCacheLog(`mutation merge marketplace=${safeMarketplace} count=${incoming.length}`);
  return setCachedDesigns(userId, safeMarketplace, nextDesigns);
}

export async function prependCachedDesigns(userId, marketplace, newDesigns = []) {
  if (!userId) return null;
  const safeMarketplace = normalizeMarketplace(marketplace);
  const incoming = Array.isArray(newDesigns) ? newDesigns : [newDesigns].filter(Boolean);
  const cached = await getCachedDesigns(userId, safeMarketplace);
  const nextDesigns = mergeDesignLists(cached?.designs || [], incoming, safeMarketplace, { prepend: true });
  devCacheLog(`mutation add marketplace=${safeMarketplace} count=${incoming.length}`);
  return setCachedDesigns(userId, safeMarketplace, nextDesigns);
}

export async function removeCachedDesign(userId, marketplace, designId) {
  if (!userId || !designId) return null;
  const safeMarketplace = normalizeMarketplace(marketplace);
  const cached = await getCachedDesigns(userId, safeMarketplace);
  if (!cached) return null;
  return setCachedDesigns(
    userId,
    safeMarketplace,
    cached.designs.filter((design) => design.id !== designId),
  );
}

export async function invalidateDesignCache(userId, marketplace) {
  if (!userId) return null;
  const safeMarketplace = normalizeMarketplace(marketplace);
  const record = await withStore("readonly", (store) => store.get(cacheKey(userId, safeMarketplace)));
  if (!record) return null;
  record.cachedAt = 0;
  record.invalidatedAt = Date.now();
  await withStore("readwrite", (store) => store.put(record));
  devCacheLog(`mutation invalidated marketplace=${safeMarketplace}`);
  return normalizeCachedRecord(record);
}

export async function clearDesignCacheForUser(userId) {
  if (!userId) return;
  const db = await openDb();
  if (!db) return;

  await new Promise((resolve) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.getAllKeys();

    request.onsuccess = () => {
      const keys = (request.result || []).filter((key) => String(key).startsWith(`designs:${userId}:`));
      keys.forEach((key) => store.delete(key));
    };
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => resolve();
    transaction.onabort = () => resolve();
  });
}

export function getCachedThumbnailUrl(design) {
  if (!design) return "";
  if (design.thumbnail_url && isUrlFresh(design.thumbnail_url_expires_at)) return design.thumbnail_url;
  if (design.image_url && isUrlFresh(design.image_url_expires_at)) return design.image_url;
  return "";
}
