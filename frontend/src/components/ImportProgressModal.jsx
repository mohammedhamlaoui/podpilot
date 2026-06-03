import { createPortal } from "react-dom";
import Icon from "./Icon";

const STEP_LABELS = [
  { key: "preparing", label: "Preparing import" },
  { key: "uploading", label: "Uploading images" },
  { key: "creating", label: "Creating designs" },
  { key: "finalizing", label: "Finalizing" },
  { key: "done", label: "Done" },
];

function stepStatus(step, currentStep, done) {
  if (done || step === currentStep) return step === currentStep && !done ? "active" : "done";
  const currentIndex = STEP_LABELS.findIndex((item) => item.key === currentStep);
  const stepIndex = STEP_LABELS.findIndex((item) => item.key === step);
  return stepIndex < currentIndex ? "done" : "pending";
}

function stepDetail(step, progress) {
  if (step === "uploading") {
    if (!progress.uploadTotal) return "No images to upload";
    return `${progress.uploadDone} / ${progress.uploadTotal}`;
  }
  if (step === "creating") {
    if (!progress.createTotal) return "No rows to create";
    return `${progress.createDone} / ${progress.createTotal}`;
  }
  if (step === "done" && progress.done) {
    return `${progress.createdCount} imported`;
  }
  return "";
}

export default function ImportProgressModal({ progress, onClose }) {
  if (!progress?.open) return null;
  const hasFailures = Array.isArray(progress.failures) && progress.failures.length > 0;
  const percent = progress.percent || 0;
  const status = progress.status || "Uploading";

  function formatBytes(bytes) {
    if (!bytes || bytes <= 0) return "0.00 MB";
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }

  return createPortal(
    <div className="pp-modal-overlay import-progress-overlay">
      <div className="pp-modal import-progress-modal" role="dialog" aria-modal="true">
        <div className="ai-listing-modal-head">
          <span className="ai-listing-icon"><Icon name="upload" /></span>
          <div>
            <h3>{progress.done ? "Import complete" : "Importing designs"}</h3>
            <p>{progress.message || "PodPilot is preparing your matched files."}</p>
          </div>
        </div>

        {/* Real Progress Indicators */}
        {!progress.done && (
          <>
            <div className="import-progress-stats">
              <span className="filename">
                {progress.currentFileName ? `File: ${progress.currentFileName}` : "Initializing..."}
              </span>
              <span className="percentage">{percent}%</span>
            </div>

            <div className="import-progress-bar-container">
              <div 
                className="import-progress-bar-fill" 
                style={{ width: `${percent}%` }}
              />
            </div>

            <div className="import-progress-meta-info">
              <span>
                {progress.totalBytes > 0 
                  ? `${formatBytes(progress.loadedBytes || 0)} / ${formatBytes(progress.totalBytes)}`
                  : ""}
              </span>
              <span className={`status-badge status-${status.toLowerCase()}`}>
                {status}
              </span>
            </div>
          </>
        )}

        <div className="import-progress-steps">
          {STEP_LABELS.map((step) => {
            const stepStatusValue = stepStatus(step.key, progress.step, progress.done);
            return (
              <div className={`import-progress-step import-progress-step-${stepStatusValue}`} key={step.key}>
                <span className="import-progress-dot">
                  {stepStatusValue === "done" ? <Icon name="check" /> : null}
                </span>
                <strong>{step.label}</strong>
                <small>{stepDetail(step.key, progress)}</small>
              </div>
            );
          })}
        </div>

        {hasFailures && (
          <div className="import-progress-failures" role="alert">
            <strong>{progress.failures.length} item{progress.failures.length === 1 ? "" : "s"} need attention</strong>
            <ul>
              {progress.failures.slice(0, 6).map((failure) => (
                <li key={`${failure.filename}-${failure.reason}`}>
                  <span>{failure.filename}</span>
                  <small>{failure.reason}</small>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="pp-modal-actions ai-listing-actions">
          {progress.done && (
            <button type="button" className="primary-button" onClick={onClose}>
              Close
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
