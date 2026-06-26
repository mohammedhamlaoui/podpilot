export default function UnsavedChangesModal({ open, onStay, onLeave }) {
  if (!open) return null;

  return (
    <div className="pp-unsaved-modal-overlay" role="presentation">
      <section
        className="pp-unsaved-modal"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="pp-unsaved-modal-title"
        aria-describedby="pp-unsaved-modal-message"
      >
        <h2 id="pp-unsaved-modal-title">Unsaved changes</h2>
        <p id="pp-unsaved-modal-message">
          You have unsaved changes in this design. If you leave now, your changes may be lost.
        </p>
        <div className="pp-unsaved-modal-actions">
          <button type="button" className="secondary-button" onClick={onStay}>
            Stay here
          </button>
          <button type="button" className="primary-button danger-button" onClick={onLeave}>
            Leave without saving
          </button>
        </div>
      </section>
    </div>
  );
}
