import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { listDesigns, batchDeleteDesigns } from "../api/client";
import { deleteDesignBatch } from "../utils/designDeleteBatch";
import DeleteProgressModal from "./DeleteProgressModal";
import Icon from "./Icon";

export default function UploadedDesignCleanup({ userId, onDeleted, disabled }) {
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
      // Read the persisted status across both platforms, including off-page rows.
      const data = await listDesigns();
      if (!Array.isArray(data?.designs)) throw new Error("Could not verify uploaded designs. Please try again.");
      const targets = data.designs.filter(row => row.id && row.status === "uploaded");
      if (!targets.length) { setNotice("No uploaded designs to delete."); return; }
      if (!window.confirm(`Permanently delete ${targets.length} uploaded design${targets.length === 1 ? "" : "s"} from PodPilot and remove their stored files? This cannot be undone. Your published Redbubble and TeePublic listings will stay online.`)) return;
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
      <button type="button" className="secondary-button" onClick={start} disabled={disabled || preparing || Boolean(progress)}>
        <Icon name="trash" />{preparing ? "Processing…" : "Delete uploaded designs"}
      </button>
      {notice && <span role="status">{notice}</span>}
    </div>
    {progress && createPortal(<div className="pp-modal-overlay">
      <DeleteProgressModal progress={progress} onClose={() => setProgress(null)}
        onCancel={() => { cancelled.current = true; }}
        onRetry={() => { setProgress(null); void start(); }} />
    </div>, document.body)}
  </>;
}
