// PodPilot reusable loading UI primitives.
// Keep this file small; styles live in styles.css under the
// "Loading primitives" section so the purple theme stays consistent.

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

/**
 * Small spinner. Sized via CSS class. Pure visual; safe in any context.
 */
export function Spinner({ size = "sm", className = "", ariaLabel }) {
  const cls = `pp-spinner pp-spinner-${size}${className ? ` ${className}` : ""}`;
  return (
    <span
      className={cls}
      role={ariaLabel ? "status" : undefined}
      aria-label={ariaLabel || undefined}
      aria-hidden={ariaLabel ? undefined : "true"}
    />
  );
}

/**
 * Drop-in replacement for <button>. When `loading` is true the button is
 * disabled, shows a spinner, and renders `loadingText` instead of children.
 *
 *   <LoadingButton loading={isSaving} loadingText="Saving...">Save</LoadingButton>
 */
export function LoadingButton({
  loading = false,
  loadingText,
  children,
  className = "",
  disabled,
  type = "button",
  ...rest
}) {
  return (
    <button
      type={type}
      className={className}
      disabled={loading || disabled}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading && <Spinner size="sm" className="pp-spinner-on-button" />}
      <span>{loading && loadingText ? loadingText : children}</span>
    </button>
  );
}

/**
 * Centered spinner + message. Use for full-page or large-section data fetches.
 */
export function PageLoader({ message = "Loading..." }) {
  return (
    <div className="pp-page-loader" role="status" aria-live="polite">
      <Spinner size="lg" ariaLabel={message} />
      <span>{message}</span>
    </div>
  );
}

/**
 * Skeleton rows for a table while data is fetching. The default is 4 rows
 * matching the manager-table column count (checkbox, image, title, tags,
 * copy link, status, actions).
 */
export function TableSkeleton({ rows = 4, columns = 7 }) {
  return (
    <tbody className="pp-skeleton-tbody" aria-hidden="true">
      {Array.from({ length: rows }).map((_, rowIndex) => (
        <tr key={rowIndex} className="pp-skeleton-row">
          {Array.from({ length: columns }).map((__, colIndex) => (
            <td key={colIndex}>
              <span className="pp-skeleton-cell" />
            </td>
          ))}
        </tr>
      ))}
    </tbody>
  );
}

/**
 * Tiny inline loading message for cards/forms — just a spinner + text inline.
 */
export function InlineStatus({ children, tone = "info" }) {
  return (
    <span className={`pp-inline-status pp-inline-status-${tone}`} role="status" aria-live="polite">
      <Spinner size="xs" />
      <span>{children}</span>
    </span>
  );
}

/**
 * useLongRunHint(loading, delayMs) → boolean
 * Returns true after `delayMs` if the action is still running, so the UI can
 * show "This is taking longer than usual…" without flashing on every fast call.
 */
export function ProgressLoader({
  title,
  subtitle,
  steps = [],
  value,
  className = "",
}) {
  const [autoPercent, setAutoPercent] = useState(12);
  const hasValue = typeof value === "number" && Number.isFinite(value);

  useEffect(() => {
    if (hasValue) return undefined;
    setAutoPercent(12);
    const timer = window.setInterval(() => {
      setAutoPercent((current) => {
        if (current < 70) return current + 7;
        if (current < 88) return current + 3;
        if (current < 94) return current + 1;
        return current;
      });
    }, 650);
    return () => window.clearInterval(timer);
  }, [hasValue, title, subtitle]);

  const percent = Math.max(0, Math.min(98, Math.round(hasValue ? value : autoPercent)));
  const stepIndex = steps.length > 0
    ? Math.min(steps.length - 1, Math.floor((percent / 100) * steps.length))
    : -1;
  const activeStep = stepIndex >= 0 ? steps[stepIndex] : "Working...";

  return (
    <div className={`pp-progress-loader${className ? ` ${className}` : ""}`} role="status" aria-live="polite">
      <div className="pp-progress-loader-orbit" aria-hidden="true">
        <span />
      </div>
      <div className="pp-progress-loader-copy">
        <strong>{title}</strong>
        {subtitle && <span>{subtitle}</span>}
      </div>
      <div className="pp-progress-track" aria-hidden="true">
        <div className="pp-progress-fill" style={{ width: `${percent}%` }} />
      </div>
      <div className="pp-progress-meta">
        <span>{activeStep}</span>
        <b>{percent}%</b>
      </div>
    </div>
  );
}

export function useLongRunHint(loading, delayMs = 6000) {
  const [hint, setHint] = useState(false);
  useEffect(() => {
    if (!loading) {
      setHint(false);
      return undefined;
    }
    const timer = window.setTimeout(() => setHint(true), delayMs);
    return () => window.clearTimeout(timer);
  }, [loading, delayMs]);
  return hint;
}

/**
 * A premium, full-screen blur overlay to show when saving/updating designs.
 */
export function SavingOverlay({
  message = "Saving designs...",
  subtext = "Please keep this page open while we prepare and upload your listings.",
  show = false,
  progress = null // { percent, loadedBytes, totalBytes, currentFileName, status }
}) {
  if (!show) return null;

  const percent = progress?.percent || 0;
  const status = progress?.status || "";
  const loadedBytes = progress?.loadedBytes || 0;
  const totalBytes = progress?.totalBytes || 0;
  const currentFileName = progress?.currentFileName || "";

  function formatBytes(bytes) {
    if (!bytes || bytes <= 0) return "0.00 MB";
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }

  return createPortal(
    <div className="pp-modal-overlay pp-saving-overlay" role="status" aria-live="assertive">
      <div className="pp-modal pp-saving-card">
        <div className="pp-saving-spinner-wrap">
          <div className="pp-saving-spinner-ring"></div>
          <div className="pp-saving-logo-inner">
            <img src="/brand/podpilot-logo.svg" alt="PodPilot" className="pp-saving-logo-pulse" />
          </div>
        </div>
        <h3>{message}</h3>
        <p>{subtext}</p>

        {progress && (
          <>
            <div className="import-progress-stats" style={{ margin: "16px 0 6px", width: "100%" }}>
              <span className="filename" style={{ fontSize: "12px" }}>
                {currentFileName ? `File: ${currentFileName}` : "Processing..."}
              </span>
              <span className="percentage" style={{ fontSize: "13px" }}>{percent}%</span>
            </div>

            <div className="import-progress-bar-container" style={{ margin: "8px 0 10px", width: "100%" }}>
              <div 
                className="import-progress-bar-fill" 
                style={{ width: `${percent}%` }}
              />
            </div>

            <div className="import-progress-meta-info" style={{ margin: "0 0 16px", width: "100%", fontSize: "11px" }}>
              <span>
                {totalBytes > 0 
                  ? `${formatBytes(loadedBytes)} / ${formatBytes(totalBytes)}`
                  : ""}
              </span>
              {status && (
                <span className={`status-badge status-${status.toLowerCase()}`}>
                  {status}
                </span>
              )}
            </div>
          </>
        )}

        {!progress && (
          <div className="pp-saving-progress-bar">
            <div className="pp-saving-progress-fill" style={{ width: "100%" }}></div>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}

