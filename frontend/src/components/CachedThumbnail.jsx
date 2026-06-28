import { useEffect, useMemo, useRef, useState } from "react";
import {
  buildImageCacheKey,
  getMemoryCachedImageUrl,
  getOrCacheImageUrl,
} from "../utils/imageCache";
import { getCachedThumbnailUrl } from "../lib/designCache";

export default function CachedThumbnail({
  design,
  userId = "",
  src = "",
  fallbackSrc = "",
  cacheVariant = "thumbnail",
  cacheR2Key = "",
  alt = "",
  className = "",
  ...imgProps
}) {
  const variant = cacheVariant === "preview" ? "preview" : "thumbnail";
  const storageKey = cacheR2Key || (variant === "preview"
    ? design?.image_r2_key
    : design?.thumbnail_r2_key || design?.image_r2_key);
  const explicitLocalSrc = /^(blob:|data:)/i.test(String(src || ""));
  const preferredRemoteSrc = getCachedThumbnailUrl(design);
  const thumbnailSrc = explicitLocalSrc ? src : preferredRemoteSrc || src || fallbackSrc || "";
  const errorFallbackSrc = [fallbackSrc, src, design?.thumbnail_url, design?.image_url]
    .map((value) => String(value || "").trim())
    .find((value) => value && value !== thumbnailSrc) || "";
  const r2Key = storageKey || design?.id || thumbnailSrc;
  const cacheKey = useMemo(
    () =>
      buildImageCacheKey({
        variant,
        userId,
        designId: design?.id,
        r2Key,
      }),
    [design?.id, r2Key, userId, variant],
  );
  const isProtectedProxySrc =
    String(thumbnailSrc || "").startsWith("/api/") ||
    String(thumbnailSrc || "").startsWith("/designs/");
  const isProtectedProxyFallback =
    String(errorFallbackSrc || "").startsWith("/api/") ||
    String(errorFallbackSrc || "").startsWith("/designs/");
  const shouldCache = Boolean(
    r2Key &&
    (/^https?:\/\//i.test(thumbnailSrc) ||
      isProtectedProxySrc)
  );
  const [displaySrc, setDisplaySrc] = useState(() => {
    if (!shouldCache) return thumbnailSrc;
    return getMemoryCachedImageUrl(cacheKey) || (isProtectedProxySrc ? "" : thumbnailSrc);
  });
  const displayCacheKeyRef = useRef(cacheKey);
  const failedFallbackKeyRef = useRef("");

  useEffect(() => {
    let cancelled = false;
    failedFallbackKeyRef.current = "";

    if (!shouldCache) {
      displayCacheKeyRef.current = cacheKey;
      setDisplaySrc((current) => (current === thumbnailSrc ? current : thumbnailSrc));
      return () => { cancelled = true; };
    }

    const memorySrc = getMemoryCachedImageUrl(cacheKey);
    if (memorySrc) {
      displayCacheKeyRef.current = cacheKey;
      setDisplaySrc((current) => (current === memorySrc ? current : memorySrc));
    } else if (displayCacheKeyRef.current !== cacheKey) {
      displayCacheKeyRef.current = cacheKey;
      setDisplaySrc(isProtectedProxySrc ? "" : thumbnailSrc);
    } else {
      setDisplaySrc((current) => {
        const nextSrc = isProtectedProxySrc ? "" : thumbnailSrc;
        return current === nextSrc ? current : nextSrc;
      });
    }

    if (!thumbnailSrc) return () => { cancelled = true; };

    getOrCacheImageUrl(cacheKey, thumbnailSrc, { fetchRemote: isProtectedProxySrc }).then((cachedSrc) => {
      if (!cancelled && cachedSrc) {
        displayCacheKeyRef.current = cacheKey;
        setDisplaySrc((current) => (current === cachedSrc ? current : cachedSrc));
      }
    });

    return () => {
      cancelled = true;
    };
  }, [cacheKey, isProtectedProxySrc, shouldCache, thumbnailSrc, variant]);

  if (!displaySrc) return <span className={`${className} cached-thumb-placeholder`} aria-hidden="true" />;

  return (
    <img
      {...imgProps}
      className={className}
      src={displaySrc}
      alt={alt}
      loading={imgProps.loading || "lazy"}
      decoding={imgProps.decoding || "async"}
      onError={(event) => {
        imgProps.onError?.(event);
        if (
          (errorFallbackSrc || thumbnailSrc) &&
          !isProtectedProxySrc &&
          failedFallbackKeyRef.current !== cacheKey
        ) {
          failedFallbackKeyRef.current = cacheKey;
          if (errorFallbackSrc && isProtectedProxyFallback) {
            getOrCacheImageUrl(cacheKey, errorFallbackSrc, { fetchRemote: true }).then((cachedSrc) => {
              if (cachedSrc) setDisplaySrc(cachedSrc);
            });
          } else {
            setDisplaySrc(errorFallbackSrc || thumbnailSrc);
          }
        }
      }}
    />
  );
}
