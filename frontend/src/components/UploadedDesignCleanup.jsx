import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { listDesigns, batchDeleteDesigns } from "../api/client";
import { deleteDesignBatch } from "../utils/designDeleteBatch";
import DeleteProgressModal from "./DeleteProgressModal";
import Icon from "./Icon";

export default function UploadedDesignCleanup({ userId, onDeleted, disabled, platform }) {
  const dialog = useRef(null);
  const [targets, setTargets] = useState(null);
  const platformName = platform === "teepublic" ? "TeePublic" : "Redbubble";
  useEffect(() => {
    if (targets && !dialog.current.open) dialog.current.showModal();
    else if (!targets && dialog.current.open) dialog.current.close();
  }, [targets]);
  const busy = useRef(false);
  const cancelled = useRef(false);
  const [progress, setProgress] = useState(null);
  const [notice, setNotice] = useState("");
  const [preparing, setPreparing] = useState(false);
  async function start() {
    if (busy.current || disabled) return;
    busy.current = true;
    setPreparing(true);
    setNotice("");
    try {
      // Read persisted status for this platform, including off-page rows.
      const data = await listDesigns(platform);
      if (!Array.isArray(data?.designs)) throw new Error("Could not verify uploaded designs. Please try again.");
      const targets = data.designs.filter(row => row.id && row.status === "uploaded" && (row.marketplace || "redbubble") === platform);
      if (!targets.length) { setNotice("No uploaded designs to delete."); return; }
      setTargets(targets);
    } catch (error) {
      setNotice(error?.message || "Could not verify uploaded designs. Please try again.");
    } finally {
      busy.current = false;
      setPreparing(false);
    }
  }
  async function confirmDelete() {
    if (!targets || busy.current || disabled) return;
    busy.current = true;
    const confirmedTargets = targets;
    setTargets(null);
    setPreparing(true);
    try {
      const targets = confirmedTargets;
      cancelled.current = false;
      setProgress({ status: "running", total: targets.length, completed: 0, percent: 0, canCancel: true });
      const result = await deleteDesignBatch({
        ids: targets.map(row => row.id), designs: targets, userId,
        deleteBackendDesigns: batchDeleteDesigns,
        onDesignsChange: () => {}, setSelectedIds: () => {},
        isCancelled: () => cancelled.current,
        updateProgress: (completed, total, deletedCount, failedCount) => setProgress({
          status: "running", completed, total, deletedCount, failedCount,
          percent: total ? completed / total * 100 : 0, canCancel: !cancelled.current,
        }),
      });
      // Only remove rows the backend confirmed, including when some failed.
      if (result.deletedIds.length) onDeleted(result.deletedIds);
      setProgress({ status: result.cancelled ? "cancelled" : result.failedIds.length ? "error" : "success",
        total: targets.length, completed: result.completed, percent: result.completed / targets.length * 100,
        deletedCount: result.deletedIds.length, failedCount: result.failedIds.length });
    } catch (error) {
      setNotice(error?.message || "Could not delete uploaded designs. Please try again.");
    } finally {
      busy.current = false;
      setPreparing(false);
    }
  }
  return <>
    <div className="pp-uploaded-cleanup">
      <button type="button" className="secondary-button" onClick={start} disabled={disabled || preparing || Boolean(progress) || Boolean(targets)}>
        <Icon name="trash" />{preparing ? "Processing…" : "Delete uploaded designs"}
      </button>
      {notice && <span role="status">{notice}</span>}
    </div>
    {createPortal(<dialog className="pp-cleanup-confirm" ref={dialog}
      aria-labelledby={`cleanup-title-${platform}`} aria-describedby={`cleanup-description-${platform}`}
      onCancel={() => setTargets(null)} onClick={event => { if (event.target === dialog.current) setTargets(null); }}>
      <div className="pp-cleanup-confirm-body">
        <span className="pp-cleanup-confirm-icon" aria-hidden="true"><Icon name="trash" /></span>
        <h2 id={`cleanup-title-${platform}`}>Delete uploaded {platformName} designs?</h2>
        <p id={`cleanup-description-${platform}`}>
          Permanently remove <strong>{targets?.length || 0} uploaded design{targets?.length === 1 ? "" : "s"}</strong> and their stored files from PodPilot. This cannot be undone.
        </p>
        <p className="pp-cleanup-confirm-note">Your published {platformName} listings will stay online.</p>
        <div className="pp-cleanup-confirm-actions">
          <button type="button" className="secondary-button" autoFocus onClick={() => setTargets(null)}>Cancel</button>
          <button type="button" className="primary-button pp-cleanup-confirm-delete" onClick={confirmDelete}>Delete {targets?.length || 0} designs</button>
        </div>
      </div>
    </dialog>, document.body)}
    {progress && createPortal(<div className="pp-modal-overlay">
      <DeleteProgressModal progress={progress} onClose={() => setProgress(null)}
        onCancel={() => { cancelled.current = true; }}
        onRetry={() => { setProgress(null); void start(); }} />
    </div>, document.body)}
  </>;
}
