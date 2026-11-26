import { Images, UploadCloud } from "lucide-react";

export default function CreateImageDropzone({ dropzone, uploading, error }) {
  const { getRootProps, getInputProps, isDragActive, isDragReject, open } = dropzone;
  const state = uploading ? "uploading" : isDragReject ? "reject" : isDragActive ? "active" : "idle";
  const title = {
    uploading: "Adding design images…",
    reject: "Choose PNG or JPG images",
    active: "Drop to add your images",
    idle: "Add design images",
  }[state];

  return (
    <div className="create-upload-card">
      <div {...getRootProps({
        className: "create-upload-drop create-image-dropzone",
        "data-state": state,
        "aria-busy": uploading || undefined,
        onClick: uploading ? undefined : open,
      })}>
        <input {...getInputProps()} />
        <div className="create-image-dropzone-mark">
          <UploadCloud size={27} strokeWidth={1.7} aria-hidden="true" />
        </div>
        <div className="create-image-dropzone-copy">
          <strong aria-live="polite">{title}</strong>
          <p>Drag images here to create designs in bulk.</p>
          <div className="create-image-dropzone-details">
            <small>PNG or JPG</small>
            <small>Up to 50 designs per session</small>
          </div>
        </div>
        <button type="button" className="primary-button create-image-dropzone-button" disabled={uploading}
          onClick={(event) => {
            event.stopPropagation();
            open();
          }}>
          <Images className="ui-icon" aria-hidden="true" />
          {uploading ? "Uploading…" : "Browse files"}
        </button>
      </div>
      {error && <div className="alert alert-error" role="alert">{error}</div>}
    </div>
  );
}
