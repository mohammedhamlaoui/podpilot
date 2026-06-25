import { useEffect, useState, useRef } from "react";
import Icon from "./Icon";

const DISMISSED_KEY = "podpilot_design_retention_notice_ack_v3_20d";

export default function StorageNoticeBell() {
  const [isOpen, setIsOpen] = useState(false);
  const [showDot, setShowDot] = useState(false);
  const containerRef = useRef(null);

  // Initialize dismissed state from localStorage
  useEffect(() => {
    try {
      if (localStorage.getItem(DISMISSED_KEY) !== "true") {
        setShowDot(true);
      }
    } catch (_) {
      // Degrade gracefully if storage is blocked
    }
  }, []);

  // Handle click outside to close the dropdown card
  useEffect(() => {
    if (!isOpen) return undefined;

    const handleClickOutside = (event) => {
      if (containerRef.current && !containerRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen]);

  const toggleDropdown = () => {
    setIsOpen((prev) => !prev);
  };

  const handleDismiss = (e) => {
    e.stopPropagation();
    try {
      localStorage.setItem(DISMISSED_KEY, "true");
    } catch (_) {
      // Best-effort storage persistence
    }
    setShowDot(false);
    setIsOpen(false);
  };

  return (
    <div
      ref={containerRef}
      className="pp-bell-container"
      id="storage-notice-bell-container"
      style={{ position: "relative", display: "inline-block" }}
    >
      <button
        type="button"
        className="pp-header-bell-btn"
        onClick={toggleDropdown}
        aria-label="Notification bell"
        aria-expanded={isOpen}
      >
        <Icon name="bell" />
        {showDot && <span className="pp-bell-dot" />}
      </button>

      {isOpen && (
        <div className="pp-bell-dropdown" role="dialog" aria-labelledby="pp-bell-title">
          <div className="pp-bell-dropdown-header">
            {/* Warning Amber SVG */}
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#f97316"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
            <h3 id="pp-bell-title" className="pp-bell-dropdown-title">
              Important storage notice
            </h3>
          </div>

          <div className="pp-bell-dropdown-body">
            <p>
              To keep PodPilot affordable and avoid expensive storage costs, uploaded designs are kept for 20 days after import and then automatically deleted from PodPilot storage.
            </p>
            <p>
              For the best experience, upload your designs from the dashboard within 20 days of importing them.
            </p>
            <p>
              Your design metadata, upload status, logs, and account data
              remain saved. Only temporary uploaded files are removed from storage.
            </p>
          </div>

          <div className="pp-bell-dropdown-recommendation">
            <strong>Recommendation:</strong> Start your upload queue within 20 days
            after importing your files.
          </div>

          <button
            type="button"
            className="pp-bell-dropdown-btn"
            onClick={handleDismiss}
          >
            Got it
          </button>
        </div>
      )}
    </div>
  );
}
