import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "podpilot_storage_notice_acknowledged";

/**
 * One-time notice modal informing users that temporary uploaded
 * workspaces and image files may be cleaned periodically.
 *
 * UI-only — does NOT delete anything or call any backend endpoint.
 */
export default function StorageNoticeModal() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    try {
      if (localStorage.getItem(STORAGE_KEY) !== "true") {
        setVisible(true);
      }
    } catch {
      // If localStorage is unavailable, silently skip.
    }
  }, []);

  const handleAcknowledge = useCallback(() => {
    try {
      localStorage.setItem(STORAGE_KEY, "true");
    } catch {
      // Best-effort persistence.
    }
    setVisible(false);
  }, []);

  if (!visible) return null;

  return (
    <div
      className="pp-storage-notice-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="storage-notice-title"
      id="storage-notice-modal"
    >
      <div className="pp-storage-notice">
        {/* Warning icon */}
        <div className="pp-storage-notice-icon" aria-hidden="true">
          <svg
            width="28"
            height="28"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
        </div>

        <h3 id="storage-notice-title" className="pp-storage-notice-title">
          Important Notice
        </h3>
        <p className="pp-storage-notice-subtitle">
          Temporary Workspace Cleanup
        </p>

        <div className="pp-storage-notice-body">
          <p>
            To keep PodPilot running fast and affordable, uploaded design
            workspaces and temporary image files may be cleared periodically
            during scheduled maintenance.
          </p>
          <p className="pp-storage-notice-safe">
            Your account, subscription, billing status, AI tokens, and saved
            settings remain completely safe.
          </p>
        </div>

        <div className="pp-storage-notice-details">
          <span className="pp-storage-notice-details-label">
            What this means for you
          </span>
          <ul>
            <li>Uploaded design workspaces may be cleaned periodically</li>
            <li>Temporary image files may be removed from storage</li>
            <li>Your account and subscription stay safe</li>
            <li>Your AI tokens stay safe</li>
            <li>You can upload fresh files again whenever needed</li>
          </ul>
        </div>

        <button
          type="button"
          className="pp-storage-notice-btn"
          onClick={handleAcknowledge}
          id="storage-notice-acknowledge-btn"
          autoFocus
        >
          I Understand
        </button>
      </div>
    </div>
  );
}
