import Icon from "./Icon";

function clampPercent(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

export default function DeleteProgressModal({ progress, onClose, onRetry }) {
  if (!progress) return null;

  const total = Math.max(0, Number(progress.total) || 0);
  const completed = Math.max(0, Math.min(total, Number(progress.completed) || 0));
  const percent = clampPercent(progress.percent);
  const isRunning = progress.status === "running";
  const isSuccess = progress.status === "success";
  const isError = progress.status === "error";
  const deletedCount = Number.isFinite(progress.deletedCount) ? progress.deletedCount : completed;

  const countText = isSuccess
    ? `Deleted ${deletedCount} design${deletedCount === 1 ? "" : "s"} successfully.`
    : isError
      ? `Deleted ${deletedCount} of ${total} design${total === 1 ? "" : "s"}`
    : `Deleting ${completed} of ${total} design${total === 1 ? "" : "s"}`;
  const title = isSuccess ? "Delete complete" : isError ? "Delete incomplete" : "Deleting selected designs…";
  const statusLine = isSuccess
    ? "Finalizing cleanup..."
    : isError
      ? "Some designs could not be deleted. Please try again."
      : progress.stage || "Removing image files from Cloudflare R2...";

  return (
    <div
      className="pp-delete-progress-modal"
      onClick={(event) => event.stopPropagation()}
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-progress-title"
      aria-describedby="delete-progress-description"
    >
      <div className={`pp-delete-progress-mark pp-delete-progress-mark-${progress.status}`} aria-hidden="true">
        {isRunning ? <span className="pp-spinner" /> : <Icon name={isSuccess ? "check" : "x"} />}
      </div>

      <div className="pp-delete-progress-copy">
        <h3 id="delete-progress-title">{title}</h3>
        <p id="delete-progress-description">Cleaning up design records and storage files.</p>
      </div>

      <div className="pp-delete-progress-summary">
        <strong>{percent}%</strong>
        <span>{countText}</span>
      </div>

      <div className="pp-delete-progress-track" aria-hidden="true">
        <span style={{ width: `${percent}%` }} />
      </div>

      <div className={`pp-delete-progress-status${isError ? " is-error" : ""}`}>
        <Icon name={isError ? "help" : "check"} />
        <span>{statusLine}</span>
      </div>

      <p className="pp-delete-progress-r2">
        Removing image files from Cloudflare R2 and cleaning up design records.
      </p>

      {isSuccess ? (
        <div className="pp-delete-progress-actions">
          <button type="button" className="secondary-button" onClick={onClose}>
            Done
          </button>
        </div>
      ) : isError ? (
        <div className="pp-delete-progress-actions">
          <button type="button" className="secondary-button" onClick={onClose}>
            Close
          </button>
          <button type="button" className="pp-btn-delete" onClick={onRetry}>
            Retry
          </button>
        </div>
      ) : null}
    </div>
  );
}
