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
  const r2Key = cacheR2Key || (variant === "preview"
    ? design?.image_r2_key
    : design?.thumbnail_r2_key || design?.image_r2_key);
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
  const thumbnailSrc = src || getCachedThumbnailUrl(design) || fallbackSrc || "";
  const shouldCache = Boolean(r2Key && /^https?:\/\//i.test(thumbnailSrc));
  const [displaySrc, setDisplaySrc] = useState(() => (shouldCache ? getMemoryCachedImageUrl(cacheKey) || thumbnailSrc : thumbnailSrc));
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
      setDisplaySrc(thumbnailSrc);
    } else {
      setDisplaySrc((current) => (current === thumbnailSrc ? current : thumbnailSrc));
    }

    if (!thumbnailSrc) return () => { cancelled = true; };

    getOrCacheImageUrl(cacheKey, thumbnailSrc, { fetchRemote: false }).then((cachedSrc) => {
      if (!cancelled && cachedSrc) {
        displayCacheKeyRef.current = cacheKey;
        setDisplaySrc((current) => (current === cachedSrc ? current : cachedSrc));
      }
    });

    return () => {
      cancelled = true;
    };
  }, [cacheKey, shouldCache, thumbnailSrc, variant]);

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
          thumbnailSrc &&
          displaySrc !== thumbnailSrc &&
          failedFallbackKeyRef.current !== cacheKey
        ) {
          failedFallbackKeyRef.current = cacheKey;
          setDisplaySrc(thumbnailSrc);
        }
      }}
    />
  );
}
