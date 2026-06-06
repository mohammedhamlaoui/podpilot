import { createPortal } from "react-dom";

export default function ImportProgressModal({ progress, onClose, onCancel }) {
  if (!progress?.open) return null;

  const hasFailures = Array.isArray(progress.failures) && progress.failures.length > 0;

  let current = 0;
  let total = 0;

  if (progress.step === "uploading" || progress.step === "preparing") {
    total = progress.uploadTotal || 0;
    current = total > 0 ? Math.min((progress.uploadDone || 0) + 1, total) : 0;
  } else if (progress.step === "creating" || progress.step === "finalizing") {
    total = progress.createTotal || 0;
    current = total > 0 ? Math.min((progress.createDone || 0) + 1, total) : 0;
  }

  const showProgressText = current > 0 && total > 0;

  return createPortal(
    <div className="pp-loading-card-overlay">
      <div className="pp-loading-card" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true">
        {!progress.done ? (
          <>
            <div className="pp-loading-card-spinner" />
            <h3 className="pp-loading-card-title">
              {showProgressText
                ? `Importing design ${current} of ${total}`
                : "Importing designs..."}
            </h3>
            <p className="pp-loading-card-subtitle">
              Please wait while PodPilot prepares your designs.
            </p>
            {onCancel && (
              <button
                type="button"
                className="pp-loading-card-btn secondary"
                onClick={onCancel}
              >
                Cancel
              </button>
            )}
          </>
        ) : (
          <>
            <h3 className="pp-loading-card-title">Import Completed</h3>
            <p className="pp-loading-card-subtitle">
              {progress.message || "Bulk import has finished."}
            </p>

            {hasFailures && (
              <div className="pp-loading-card-failures">
                <div style={{ fontSize: "12px", fontWeight: "700", marginBottom: "6px", color: "var(--text-primary)" }}>
                  {progress.failures.length} item{progress.failures.length === 1 ? "" : "s"} need attention:
                </div>
                {progress.failures.map((failure, idx) => (
                  <div key={idx} className="pp-loading-card-failure-row">
                    <span className="pp-loading-card-failure-name">{failure.filename}</span>
                    <span className="pp-loading-card-failure-reason">{failure.reason || "Failed"}</span>
                  </div>
                ))}
              </div>
            )}

            <button
              type="button"
              className="pp-loading-card-btn"
              onClick={onClose}
            >
              Close
            </button>
          </>
        )}
      </div>
    </div>,
    document.body
  );
}
