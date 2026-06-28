import { useEffect, useMemo, useState } from "react";
import { createUploadJob, listUploadJobs } from "../api/client";
import { EXTENSION_ID } from "../config";

const TERMINAL_STATUSES = new Set(["uploaded", "failed"]);

function statusLabel(status) {
  if (status === "uploaded") return "Done";
  if (status === "failed") return "Error";
  if (status === "uploading") return "Uploading";
  return "Pending";
}

function makeRows(designs) {
  return (designs || []).map((design) => ({
    id: design.id,
    title: design.title || design.filename || "Untitled design",
    filename: design.filename || "",
    status: statusLabel(design.status),
    rawStatus: design.status,
    message: design.error_message || "",
  }));
}

function findImage(design, uploadedImages) {
  const target = String(design.filename || "").trim().toLowerCase();
  if (!target) return null;
  return (uploadedImages || []).find((img) => {
    const name = String(img.name || "").trim().toLowerCase();
    return name === target || name.replace(/\.[^.]+$/, "") === target.replace(/\.[^.]+$/, "");
  }) || null;
}

function normalizeDesignForExtension(design, image) {
  return {
    id: design.id,
    filename: design.filename,
    cdn_image_url: design.cdn_image_url || image?.cdnImageUrl || "",
    image_url: image?.imageUrl || design.image_url || "",
    image_r2_key: design.image_r2_key || "",
    image_path: design.image_r2_key || "",
    title: design.title,
    description: design.description,
    main_tag: design.primary_tag || design.main_tag || "",
    primary_tag: design.primary_tag || design.main_tag || "",
    supporting_tags: design.supporting_tags,
    copy_link: design.copy_link,
    marketplace: design.marketplace || "redbubble",
  };
}

function sendExtensionMessage(message) {
  return new Promise((resolve, reject) => {
    if (!EXTENSION_ID.trim()) {
      reject(new Error("Paste your installed Chrome extension ID into frontend/src/config.js."));
      return;
    }
    if (!window.chrome?.runtime?.sendMessage) {
      reject(new Error("Chrome extension messaging is not available in this browser."));
      return;
    }
    window.chrome.runtime.sendMessage(EXTENSION_ID, message, (response) => {
      if (window.chrome.runtime.lastError) {
        reject(new Error(window.chrome.runtime.lastError.message));
        return;
      }
      if (response?.ok === false) {
        reject(new Error(response.error || "The extension rejected the request."));
        return;
      }
      resolve(response || { ok: true });
    });
  });
}

export default function QueueManager({ designs, uploadedImages, onRefresh }) {
  const [rows, setRows] = useState(() => makeRows(designs));
  const [extensionStatus, setExtensionStatus] = useState("idle");
  const [isCreatingJob, setIsCreatingJob] = useState(false);
  const [jobInfo, setJobInfo] = useState(null);
  const [jobHistory, setJobHistory] = useState([]);
  const [error, setError] = useState("");

  // Recompute rows whenever the backend gives us a new list of designs.
  useEffect(() => {
    setRows(makeRows(designs));
  }, [designs]);

  useEffect(() => {
    let isMounted = true;
    listUploadJobs({ marketplace: "redbubble" })
      .then((data) => {
        if (isMounted) setJobHistory(data?.upload_jobs || []);
      })
      .catch(() => {
        if (isMounted) setJobHistory([]);
      });
    return () => {
      isMounted = false;
    };
  }, [jobInfo]);

  // Extension status polling — used to drive Pause/Resume button state.
  useEffect(() => {
    if (!["running", "paused"].includes(extensionStatus) || !EXTENSION_ID.trim()) {
      return undefined;
    }

    const intervalId = window.setInterval(async () => {
      try {
        const response = await sendExtensionMessage({ action: "get_status" });
        const state = response.state;
        setExtensionStatus(state.status || "idle");
        setError(state.lastError || "");
      } catch (statusError) {
        setError(statusError.message);
      }
    }, 1500);

    return () => window.clearInterval(intervalId);
  }, [extensionStatus]);

  const doneCount = rows.filter((row) => row.rawStatus === "uploaded").length;
  const errorCount = rows.filter((row) => row.rawStatus === "failed").length;
  const uploadingCount = rows.filter((row) => row.rawStatus === "uploading").length;
  const progressPercent = rows.length === 0 ? 0 : Math.round((doneCount / rows.length) * 100);
  const isRunning = extensionStatus === "running";
  const isPaused = extensionStatus === "paused";

  const uploadedFilenames = useMemo(
    () => new Set((uploadedImages || []).map((image) => image.name.trim().toLowerCase())),
    [uploadedImages]
  );

  async function handleStartUpload() {
    if (designs.length === 0) {
      setError("Import designs before creating a queue.");
      return;
    }

    if (!EXTENSION_ID.trim()) {
      setError("Paste your installed Chrome extension ID into frontend/src/config.js before starting.");
      return;
    }

    const uploadable = designs.filter((d) => !TERMINAL_STATUSES.has(d.status));
    if (uploadable.length === 0) {
      setError("Every design has already finished. Nothing to queue.");
      return;
    }

    const missingImages = uploadable.filter((d) => !d.image_r2_key && !d.cdn_image_url && !d.image_url).map((d) => d.filename);
    if (missingImages.length > 0) {
      setError(
        `Attach images first. Missing for: ${missingImages.slice(0, 5).join(", ")}` +
        (missingImages.length > 5 ? "..." : "")
      );
      return;
    }

    const missingLinks = uploadable.filter((d) => !d.copy_link).map((d) => d.filename);
    if (missingLinks.length > 0) {
      setError(
        `Each design needs a Redbubble duplicate URL in copy_link. Missing: ${missingLinks
          .slice(0, 5)
          .join(", ")}${missingLinks.length > 5 ? "..." : ""}`
      );
      return;
    }

    setIsCreatingJob(true);
    setError("");

    try {
      const job = await createUploadJob({
        marketplace: "redbubble",
        design_ids: uploadable.map((d) => d.id),
      });

      const extPayload = uploadable.map((d) => normalizeDesignForExtension(d, findImage(d, uploadedImages)));
      const extensionResponse = await sendExtensionMessage({
        action: "start_queue",
        designs: extPayload,
      });

      setJobInfo(job);
      setExtensionStatus(extensionResponse.state?.status || "running");
      onRefresh?.();
    } catch (startError) {
      setError(startError.message);
    } finally {
      setIsCreatingJob(false);
    }
  }

  async function handlePause() {
    if (!isRunning && !isPaused) return;
    try {
      const response = await sendExtensionMessage({
        action: isPaused ? "resume_queue" : "pause_queue"
      });
      setExtensionStatus(response.state?.status || (isPaused ? "running" : "paused"));
      setError("");
    } catch (pauseError) {
      setError(pauseError.message);
    }
  }

  async function handleStop() {
    try {
      const response = await sendExtensionMessage({ action: "stop_queue" });
      setExtensionStatus(response.state?.status || "idle");
      setError(response.state?.lastError || "");
      onRefresh?.();
    } catch (stopError) {
      setError(stopError.message);
    }
  }

  return (
    <section className="workflow-panel">
      <div className="panel-heading">
        <div>
          <h2>Start Queue</h2>
          <p>Create the backend job and hand the upload queue to the Chrome extension.</p>
        </div>
        <div className="counter-row">
          <div className="counter-card">
            <span>{doneCount} / {rows.length}</span>
            <small>complete</small>
          </div>
          <div className="counter-card">
            <span>{errorCount}</span>
            <small>errors</small>
          </div>
        </div>
      </div>

      <div className="queue-controls">
        <button
          type="button"
          className="primary-button"
          onClick={handleStartUpload}
          disabled={isCreatingJob || isRunning || isPaused}
        >
          {isCreatingJob ? "Creating Job..." : "Start Upload"}
        </button>
        <button
          type="button"
          className="secondary-button"
          onClick={handlePause}
          disabled={!isRunning && !isPaused}
        >
          {isPaused ? "Resume" : "Pause"}
        </button>
        <button
          type="button"
          className="danger-button"
          onClick={handleStop}
          disabled={!isRunning && !isPaused && uploadingCount === 0}
        >
          Stop
        </button>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {jobInfo && (
        <div className="alert alert-success">
          Job created: {jobInfo?.upload_job?.id || jobInfo?.id || "ok"}.
          Extension status: {extensionStatus}.
        </div>
      )}

      <div className="progress-block">
        <div className="progress-meta">
          <strong>
            Current upload: {Math.min(doneCount + uploadingCount, rows.length)} / {rows.length}
          </strong>
          <span>{progressPercent}%</span>
        </div>
        <div className="progress-track">
          <div className="progress-fill" style={{ width: `${progressPercent}%` }} />
        </div>
      </div>

      <div className="queue-list">
        {rows.map((row) => {
          const hasExactImage = uploadedFilenames.has(String(row.filename || "").trim().toLowerCase());
          return (
            <article className="queue-row" key={row.id}>
              <div>
                <strong>{row.title}</strong>
                <span>
                  {row.filename}
                  {!hasExactImage && " - filename may need review"}
                </span>
              </div>
              <div className="queue-row-status">
                {row.message && <small>{row.message}</small>}
                <span
                  className={`status-badge ${
                    row.status === "Done"
                      ? "status-done"
                      : row.status === "Error"
                        ? "status-error"
                        : row.status === "Uploading"
                          ? "status-uploading"
                          : "status-pending"
                  }`}
                >
                  {row.status}
                </span>
              </div>
            </article>
          );
        })}
      </div>

      {jobHistory.length > 0 && (
        <div className="job-history">
          <h3>Recent backend jobs</h3>
          <span>{jobHistory.length} job records returned by /upload-jobs</span>
        </div>
      )}
    </section>
  );
}
