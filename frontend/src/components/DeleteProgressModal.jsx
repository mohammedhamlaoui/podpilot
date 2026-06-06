import Icon from "./Icon";

function clampPercent(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

export default function DeleteProgressModal({ progress, onClose, onRetry, onCancel }) {
  if (!progress) return null;

  const total = Math.max(0, Number(progress.total) || 0);
  const completed = Math.max(0, Math.min(total, Number(progress.completed) || 0));
  const percent = clampPercent(progress.percent);
  const isRunning = progress.status === "running";
  const isSuccess = progress.status === "success";
  const isError = progress.status === "error";
  const isCancelled = progress.status === "cancelled";
  const deletedCount = Number.isFinite(progress.deletedCount) ? progress.deletedCount : completed;
  const failedCount = Number.isFinite(progress.failedCount) ? progress.failedCount : 0;
  const current = Math.max(1, Math.min(total || 1, Number(progress.current) || completed + 1));

  const title = isSuccess
    ? `Deleted ${deletedCount} design${deletedCount === 1 ? "" : "s"}`
    : isError
      ? "Delete incomplete"
      : isCancelled
        ? "Deletion stopped"
        : "Deleting selected designs";

  const progressText = isRunning
    ? `Deleting design ${current} of ${total}`
    : isSuccess
      ? `Deleted ${deletedCount} of ${total}`
      : isError
        ? `${deletedCount} deleted, ${failedCount} failed`
        : `Stopped after ${completed} of ${total}`;

  const description = isRunning
    ? "Please wait while PodPilot removes selected designs."
    : isSuccess
      ? "Selected designs were removed from your workspace."
      : isCancelled
        ? "PodPilot stopped before starting the next design."
        : `${failedCount} design${failedCount === 1 ? "" : "s"} could not be deleted. Please try again.`;

  const statusLine = isSuccess
    ? `Deleted ${deletedCount} design${deletedCount === 1 ? "" : "s"}`
    : progress.stage || "Removing designs and related files from your workspace.";

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
        {isRunning ? <span className="pp-spinner" /> : <Icon name={isSuccess ? "check" : isCancelled ? "help" : "x"} />}
      </div>

      <div className="pp-delete-progress-copy">
        <h3 id="delete-progress-title">{title}</h3>
        <p id="delete-progress-description">{description}</p>
      </div>

      <div className="pp-delete-progress-summary">
        <strong>{progressText}</strong>
        <span>{percent}% complete</span>
      </div>

      <div className="pp-delete-progress-track" aria-hidden="true">
        <span style={{ width: `${percent}%` }} />
      </div>

      <div className={`pp-delete-progress-status${isError ? " is-error" : ""}`}>
        <Icon name={isError ? "help" : isRunning ? "file" : "check"} />
        <span>{statusLine}</span>
      </div>

      <p className="pp-delete-progress-r2">
        Removing designs and related files from your workspace.
      </p>

      {isSuccess ? (
        <div className="pp-delete-progress-actions">
          <button type="button" className="secondary-button" onClick={onClose}>
            Done
          </button>
        </div>
      ) : isError || isCancelled ? (
        <div className="pp-delete-progress-actions">
          <button type="button" className="secondary-button" onClick={onClose}>
            Close
          </button>
          {isError ? (
            <button type="button" className="pp-btn-delete" onClick={onRetry}>
              Retry
            </button>
          ) : null}
        </div>
      ) : progress.canCancel ? (
        <div className="pp-delete-progress-actions">
          <button type="button" className="secondary-button" onClick={onCancel}>
            Cancel
          </button>
        </div>
      ) : null}
    </div>
  );
}
