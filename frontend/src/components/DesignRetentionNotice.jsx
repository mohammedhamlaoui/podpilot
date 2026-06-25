import { useEffect, useRef } from "react";
import { Info } from "lucide-react";
import Icon from "./Icon";

export const DESIGN_RETENTION_NOTICE_ACK_KEY = "podpilot_design_retention_notice_ack_v3_20d";

export function hasAcknowledgedDesignRetentionNotice() {
  try {
    return window.localStorage.getItem(DESIGN_RETENTION_NOTICE_ACK_KEY) === "true";
  } catch {
    return false;
  }
}

export function acknowledgeDesignRetentionNotice() {
  try {
    window.localStorage.setItem(DESIGN_RETENTION_NOTICE_ACK_KEY, "true");
  } catch {
    // The notice still closes when storage is unavailable.
  }
}

export default function DesignRetentionNotice({ open, onAcknowledge }) {
  const closeButtonRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();

    const handleKeyDown = (event) => {
      if (event.key === "Escape") onAcknowledge();
    };
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, onAcknowledge]);

  if (!open) return null;

  return (
    <div className="pp-retention-modal-overlay" role="presentation">
      <section
        className="pp-retention-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="design-retention-notice-title"
        aria-describedby="design-retention-notice-body"
      >
        <button ref={closeButtonRef} type="button" className="pp-retention-modal-close" onClick={onAcknowledge} aria-label="Close design retention notice">
          <Icon name="x" />
        </button>

        <div className="pp-retention-modal-icon" aria-hidden="true"><Info /></div>
        <h2 id="design-retention-notice-title">Design Retention Notice</h2>
        <p id="design-retention-notice-body">
          To keep PodPilot affordable and avoid expensive storage costs, uploaded designs are kept for 20 days after import and then automatically deleted from PodPilot storage.
        </p>
        <p>
          For the best experience, upload your designs from the dashboard within 20 days of importing them.
        </p>
        <a className="pp-retention-modal-policy" href="/terms">Read the full policy in our Terms of Service.</a>
        <button type="button" className="pp-retention-modal-confirm" onClick={onAcknowledge}>Got it</button>
      </section>
    </div>
  );
}
