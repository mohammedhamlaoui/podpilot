import { useMemo, useState } from "react";
import { useDropzone } from "react-dropzone";
import { uploadStandaloneImages } from "../api/client";
import { createImagePreviewDataUrl } from "../utils/imagePreview";
import CachedThumbnail from "./CachedThumbnail";
import { PREMIUM_LOCK_MESSAGE } from "../lib/subscriptionAccess";

function stripExtension(fileName) {
  return String(fileName ?? "").replace(/\.[^/.]+$/, "");
}

function normalizeName(fileName) {
  return stripExtension(fileName).trim().toLowerCase();
}

function getImageKey(fileName) {
  return String(fileName ?? "").trim().toLowerCase();
}

function isImageMatched(fileName, designNames) {
  const fullName = getImageKey(fileName);
  const baseName = normalizeName(fileName);
  return designNames.has(fullName) || designNames.has(baseName);
}

function findSavedFile(file, response) {
  const files = Array.isArray(response?.files) ? response.files : [];
  return files.find((savedFile) => savedFile.original_name === file.name) || {};
}

export default function ImageGrid({ designs, uploadedImages, onImagesUploaded, userId = "", isWorkspaceLocked = false, onLockedAction }) {
  const [pendingFiles, setPendingFiles] = useState([]);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [isUploading, setIsUploading] = useState(false);

  function requireUnlocked() {
    if (!isWorkspaceLocked) return true;
    setError(PREMIUM_LOCK_MESSAGE);
    if (typeof onLockedAction === "function") onLockedAction();
    return false;
  }

  const designNames = useMemo(() => {
    const names = new Set();
    designs.forEach((design) => {
      names.add(getImageKey(design.filename));
      names.add(normalizeName(design.filename));
    });
    return names;
  }, [designs]);

  const matchedCount = useMemo(
    () => uploadedImages.filter((image) => isImageMatched(image.name, designNames)).length,
    [uploadedImages, designNames]
  );

  const onDrop = (acceptedFiles) => {
    if (!requireUnlocked()) return;
    setError("");
    setSuccess("");

    if (acceptedFiles.length === 0) {
      setError("Drop PNG or JPG files to continue.");
      return;
    }

    setPendingFiles(acceptedFiles);
  };

  const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
    onDrop,
    accept: {
      "image/png": [".png"],
      "image/jpeg": [".jpg", ".jpeg"]
    },
    multiple: true,
    noClick: true,
    noKeyboard: true
  });

  async function handleUploadImages() {
    if (!requireUnlocked()) return;
    if (pendingFiles.length === 0) {
      setError("Choose at least one image before uploading.");
      return;
    }

    setIsUploading(true);
    setError("");
    setSuccess("");

    try {
      const response = await uploadStandaloneImages(pendingFiles, "redbubble");
      const nextImages = await Promise.all(pendingFiles.map(async (file) => {
        const savedFile = findSavedFile(file, response);
        const previewDataUrl = await createImagePreviewDataUrl(file);

        return {
          id: `${file.name}-${file.lastModified}-${file.size}`,
          name: file.name,
          size: file.size,
          previewUrl: URL.createObjectURL(file),
          previewDataUrl,
          matched: isImageMatched(file.name, designNames),
          storedName: savedFile.stored_name || "",
          imagePath: savedFile.image_r2_key || "",
          imageUrl: savedFile.image_url || "",
          thumbnail_r2_key: savedFile.thumbnail_r2_key || "",
          thumbnailUrl: savedFile.thumbnail_url || "",
          serverResponse: response
        };
      }));

      onImagesUploaded(nextImages, response);
      setSuccess(`${pendingFiles.length} image files uploaded successfully.`);
      setPendingFiles([]);
    } catch (uploadError) {
      const detail = uploadError.response?.data?.detail;
      setError(
        typeof detail === "string"
          ? detail
          : "The backend rejected the image upload. Check that FastAPI is running on localhost:8000."
      );
    } finally {
      setIsUploading(false);
    }
  }

  return (
    <section className="workflow-panel">
      <div className="panel-heading">
        <div>
          <h2>Upload Images</h2>
          <p>Drop the product artwork files that should match the Excel image names.</p>
        </div>
        <div className="counter-row">
          <div className="counter-card">
            <span>{uploadedImages.length}</span>
            <small>uploaded</small>
          </div>
          <div className="counter-card">
            <span>{matchedCount}</span>
            <small>matched</small>
          </div>
        </div>
      </div>

      <div
        {...getRootProps({
          className: `dropzone ${isDragActive ? "dropzone-active" : ""}`
        })}
      >
        <input {...getInputProps()} />
        <div>
          <strong>
            {pendingFiles.length > 0
              ? `${pendingFiles.length} image file${pendingFiles.length === 1 ? "" : "s"} ready`
              : "Drop PNG or JPG files here"}
          </strong>
          <span>
            {isDragActive
              ? "Release to stage these image files"
              : "Images are uploaded together and matched against the Excel filename column."}
          </span>
        </div>
        <button type="button" className="secondary-button" onClick={open}>
          Browse
        </button>
      </div>

      <div className="action-strip">
        <button
          type="button"
          className="primary-button"
          onClick={handleUploadImages}
          disabled={isUploading || pendingFiles.length === 0}
        >
          {isUploading ? "Uploading..." : "Upload Images"}
        </button>
        {pendingFiles.length > 0 && (
          <span className="muted-text">
            Ready: {pendingFiles.map((file) => file.name).join(", ")}
          </span>
        )}
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {success && <div className="alert alert-success">{success}</div>}

      {uploadedImages.length > 0 && (
        <div className="image-grid">
          {uploadedImages.map((image) => {
            const matched = isImageMatched(image.name, designNames);

            return (
              <article className="image-card" key={image.id}>
                {image.thumbnailUrl ? (
                  <CachedThumbnail
                    design={{
                      id: image.id,
                      thumbnail_r2_key: image.thumbnail_r2_key,
                      image_r2_key: image.imagePath,
                    }}
                    userId={userId}
                    src={image.thumbnailUrl}
                    alt={image.name}
                  />
                ) : (
                  <img src={image.previewUrl} alt={image.name} />
                )}
                <div className="image-card-footer">
                  <strong title={image.name}>{image.name}</strong>
                  <span className={`status-badge ${matched ? "status-done" : "status-error"}`}>
                    {matched ? "Matched" : "Missing"}
                  </span>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
