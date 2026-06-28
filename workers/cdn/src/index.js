const ALLOWED_ORIGINS = new Set([
  "https://podpilot.space",
  "https://www.podpilot.space",
  "chrome-extension://aloidebamibhnggbnlhoemnokkllkgdn",
]);

const CACHE_CONTROL = "public, max-age=86400, stale-while-revalidate=604800";
const ALLOWED_MARKETPLACES = new Set(["redbubble", "teepublic"]);
const RESERVED_KEY_SEGMENTS = new Set(["imports", "tmp", "temp", "backup", "backups", "thumbnails"]);

function corsHeaders(request) {
  const origin = request.headers.get("Origin") || "";
  if (!ALLOWED_ORIGINS.has(origin)) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

function jsonError(message, status, request) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...corsHeaders(request),
    },
  });
}

function base64UrlDecode(value) {
  const padded = value + "=".repeat((4 - (value.length % 4)) % 4);
  const binary = atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new TextDecoder().decode(bytes);
}

function hexToBytes(hex) {
  if (!/^[a-f0-9]{64}$/i.test(hex || "")) return null;
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

async function verifySignature(secret, token, signatureHex) {
  if (!secret || !token || !signatureHex) return false;
  const signature = hexToBytes(signatureHex);
  if (!signature) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  return crypto.subtle.verify(
    "HMAC",
    key,
    signature,
    new TextEncoder().encode(token),
  );
}

function hasEncodedTraversal(key) {
  return /%(?:2e|2f|5c)/i.test(key);
}

function parseDesignAssetKey(key, assetType) {
  if (!key || key.startsWith("/") || key.includes("\\") || key.includes("\0")) return false;
  if (hasEncodedTraversal(key)) return false;
  const parts = key.split("/");
  if (parts.some((part) => !part || part === "." || part === "..")) return false;
  if (parts[0] !== "users" || parts.length < 5) return false;

  const [, userId, marketplace] = parts;
  if (!userId || !ALLOWED_MARKETPLACES.has(marketplace)) return false;

  if (assetType === "image") {
    if (parts.length !== 5) return false;
    const objectId = parts[3];
    const filename = parts[4];
    if (!objectId || !filename || RESERVED_KEY_SEGMENTS.has(objectId.toLowerCase())) return false;
    return { assetType, userId, marketplace, objectId, filename };
  }

  if (assetType === "thumbnail") {
    if (parts.length !== 6 || parts[4] !== "thumbnails") return false;
    const designId = parts[3];
    const filename = parts[5];
    if (!designId || !filename || RESERVED_KEY_SEGMENTS.has(designId.toLowerCase())) return false;
    return { assetType, userId, marketplace, designId, filename };
  }

  return false;
}

function parseSignedPayload(url, request) {
  const pathMatch = url.pathname.match(/^\/designs\/([^/]+)\/(image|thumbnail)$/);
  if (!pathMatch) return { error: jsonError("Not found", 404, request) };

  const token = url.searchParams.get("token") || "";
  const sig = url.searchParams.get("sig") || "";
  if (!token || !sig) return { error: jsonError("Forbidden", 403, request) };

  let payload;
  try {
    payload = JSON.parse(base64UrlDecode(token));
  } catch (_) {
    return { error: jsonError("Forbidden", 403, request) };
  }

  const assetType = String(payload.asset_type || "").trim();
  const designId = String(payload.design_id || "").trim();
  const marketplace = String(payload.marketplace || "").trim();
  const userId = String(payload.user_id || "").trim();
  const key = String(payload.key || "").trim();
  const version = String(payload.v || "").trim();
  const expires = Number(payload.exp || 0);
  const pathDesignId = decodeURIComponent(pathMatch[1]);
  const pathAssetType = pathMatch[2];

  if (!designId || designId !== pathDesignId || !assetType || assetType !== pathAssetType || !marketplace || !userId || !key || !version || !Number.isFinite(expires)) {
    return { error: jsonError("Forbidden", 403, request) };
  }
  if (expires <= Math.floor(Date.now() / 1000)) {
    return { error: jsonError("Forbidden", 403, request) };
  }
  const keyParts = parseDesignAssetKey(key, assetType);
  if (!keyParts || keyParts.userId !== userId || keyParts.marketplace !== marketplace) {
    return { error: jsonError("Forbidden", 403, request) };
  }
  if (assetType === "thumbnail" && keyParts.designId !== designId) {
    return { error: jsonError("Forbidden", 403, request) };
  }
  return { payload: { assetType, designId, marketplace, userId, key, version }, token, sig };
}

function cacheRequestFor(url, payload) {
  const cacheUrl = new URL(url);
  cacheUrl.pathname = `/__podpilot_design_image_cache__/${encodeURIComponent(payload.key)}`;
  cacheUrl.search = `?v=${encodeURIComponent(payload.version)}`;
  return new Request(cacheUrl.toString(), { method: "GET" });
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(request) });
    }
    if (!["GET", "HEAD"].includes(request.method)) {
      return jsonError("Method not allowed", 405, request);
    }

    const url = new URL(request.url);
    const parsed = parseSignedPayload(url, request);
    if (parsed.error) return parsed.error;

    const signatureOk = await verifySignature(env.CDN_SIGNING_SECRET, parsed.token, parsed.sig);
    if (!signatureOk) return jsonError("Forbidden", 403, request);

    const cache = caches.default;
    const cacheKey = cacheRequestFor(url, parsed.payload);
    const cached = await cache.match(cacheKey);
    if (cached) {
      const headers = new Headers(cached.headers);
      for (const [key, value] of Object.entries(corsHeaders(request))) headers.set(key, value);
      return new Response(request.method === "HEAD" ? null : cached.body, {
        status: cached.status,
        headers,
      });
    }

    const object = await env.DESIGN_IMAGES.get(parsed.payload.key);
    if (!object) return jsonError("Not found", 404, request);

    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set("Content-Type", headers.get("Content-Type") || "application/octet-stream");
    headers.set("Cache-Control", CACHE_CONTROL);
    headers.set("ETag", object.httpEtag);
    for (const [key, value] of Object.entries(corsHeaders(request))) headers.set(key, value);

    const response = new Response(request.method === "HEAD" ? null : object.body, {
      status: 200,
      headers,
    });
    if (request.method === "GET") {
      ctx.waitUntil(cache.put(cacheKey, response.clone()));
    }
    return response;
  },
};
