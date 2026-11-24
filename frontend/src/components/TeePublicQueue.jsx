import { useEffect, useMemo, useState } from "react";
import { createUploadSession, listUploadJobs } from "../api/client";
import { canonicalizeSettings } from "../config/teepublicOptions";
import { EXTENSION_ID } from "../config";
import { getDeviceId } from "../lib/deviceSession";

const TERMINAL_STATUSES = new Set(["uploaded", "failed"]);

function statusLabel(status) {
  if (status === "uploaded") return "Done";
  if (status === "failed") return "Error";
  if (status === "uploading") return "Uploading";
  if (status === "ready") return "Ready";
  if (status === "preparing") return "Preparing for upload...";
  return "Pending";
}

function makeRows(designs) {
  return (designs || []).map((design) => ({
    id: design.id,
    title: design.title || design.filename || "Untitled design",
    filename: design.filename || "",
    status: statusLabel(design.upload_ready === true && design.status === "pending" ? "ready" : design.status),
    rawStatus: design.status,
    message: design.error_message || "",
    uploadReady: design.upload_ready === true,
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
  // Canonicalize keys so the extension always sees the same shape
  // regardless of any legacy variants the DB might still hold.
  const colorSettings = canonicalizeSettings(design.color_settings);
  const productSettings = canonicalizeSettings(design.product_settings);
  console.log("[PodPilot] queue → extension payload for", design.filename || design.id, {
    color_settings: colorSettings,
    product_settings: productSettings,
    adult_content: Boolean(design.adult_content),
  });
  return {
    id: design.id,
    filename: design.filename,
    cdn_image_url: design.cdn_image_url || image?.cdnImageUrl || "",
    image_url: image?.imageUrl || design.image_url || "",
    image_r2_key: design.image_r2_key || "",
    image_path: design.image_r2_key || "",
    title: design.title,
    description: design.description,
    primary_tag: design.primary_tag || design.main_tag || "",
    main_tag: design.primary_tag || design.main_tag || "",
    supporting_tags: design.supporting_tags,
    adult_content: design.adult_content || false,
    color_settings: colorSettings,
    product_settings: productSettings,
    marketplace: "teepublic",
    mime_type: design.mime_type || "image/png",
    image_key: design.image_key || design.image_r2_key || "",
    upload_ready: design.upload_ready === true,
    prepared_queue: design.upload_ready === true,
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
    window.chrome.runtime.sendMessage(EXTENSION_ID, { ...message, device_id: getDeviceId() }, (response) => {
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

export default function TeePublicQueue({ designs, uploadedImages, onRefresh }) {
  const [rows, setRows] = useState(() => makeRows(designs));
  const [extensionStatus, setExtensionStatus] = useState("idle");
  const [isCreatingJob, setIsCreatingJob] = useState(false);
  const [jobInfo, setJobInfo] = useState(null);
  const [jobHistory, setJobHistory] = useState([]);
  const [error, setError] = useState("");

  useEffect(() => {
    setRows(makeRows(designs));
  }, [designs]);

  useEffect(() => {
    let isMounted = true;
    listUploadJobs({ marketplace: "teepublic" })
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

  useEffect(() => {
    if (!["running", "paused"].includes(extensionStatus) || !EXTENSION_ID.trim()) return undefined;
    const intervalId = window.setInterval(async () => {
      try {
        const response = await sendExtensionMessage({ action: "get_status" });
        setExtensionStatus(response.state?.status || "idle");
        setError(response.state?.lastError || "");
      } catch (statusError) {
        setError(statusError.message);
      }
    }, 1500);
    return () => window.clearInterval(intervalId);
  }, [extensionStatus]);

  const doneCount = rows.filter((r) => r.rawStatus === "uploaded").length;
  const errorCount = rows.filter((r) => r.rawStatus === "failed").length;
  const uploadingCount = rows.filter((r) => r.rawStatus === "uploading").length;
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
      setError(`Attach images first. Missing for: ${missingImages.slice(0, 5).join(", ")}` + (missingImages.length > 5 ? "..." : ""));
      return;
    }

    setIsCreatingJob(true);
    setError("");

    try {
      const session = await createUploadSession("teepublic", uploadable.map((d) => d.id));
      const preparedItems = Array.isArray(session?.items) ? session.items : [];
      const notReady = preparedItems.filter((item) => item.upload_ready !== true);
      if (notReady.length > 0) {
        setError(`Preparing for upload: ${notReady.slice(0, 5).map((item) => item.filename || item.design_id).join(", ")}`);
        onRefresh?.();
        return;
      }

      const extPayload = preparedItems.map((item) => normalizeDesignForExtension(item, findImage(item, uploadedImages)));
      const extensionResponse = await sendExtensionMessage({
        action: "start_teepublic_queue",
        designs: extPayload,
        uploadSessionId: session.session_id || "",
      });

      setJobInfo({ upload_job: { id: session.session_id, marketplace: "teepublic", total_designs: preparedItems.length } });
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
        <button type="button" className="primary-button" onClick={handleStartUpload} disabled={isCreatingJob || isRunning || isPaused}>
          {isCreatingJob ? "Creating Job..." : "Start Upload"}
        </button>
        <button type="button" className="secondary-button" onClick={handlePause} disabled={!isRunning && !isPaused}>
          {isPaused ? "Resume" : "Pause"}
        </button>
        <button type="button" className="danger-button" onClick={handleStop} disabled={!isRunning && !isPaused && uploadingCount === 0}>
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
                <span className={`status-badge ${row.status === "Done" ? "status-done" : row.status === "Error" ? "status-error" : row.status === "Uploading" ? "status-uploading" : "status-pending"}`}>
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
