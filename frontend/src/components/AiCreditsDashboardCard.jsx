import { useState } from "react";
import Icon from "./Icon";

export default function AiCreditsDashboardCard() {
  const [dismissed, setDismissed] = useState(() => {
    try { return sessionStorage.getItem("podpilot-ai-credits-banner-dismissed") === "true"; }
    catch { return false; }
  });

  function handleDismiss() {
    setDismissed(true);
    try { sessionStorage.setItem("podpilot-ai-credits-banner-dismissed", "true"); }
    catch { /* Dismissal still works when browser storage is unavailable. */ }
  }

  function handleNavigateToCredits() {
    window.location.href = "/pricing#ai-listing-credits";
  }

  if (dismissed) return null;

  return (
    <div className="pp-credits-cta-card">
      <button type="button" className="pp-credits-cta-dismiss" onClick={handleDismiss} aria-label="Dismiss AI credits banner">
        <Icon name="x" />
      </button>
      <div className="pp-credits-cta-content">
        <div className="pp-credits-cta-icon-wrapper">
          <Icon name="sparkle" strokeWidth="2.2" />
        </div>
        <div className="pp-credits-cta-text">
          <h3>Need more AI Listing Credits?</h3>
          <p>
            Generate extra titles, descriptions, and tags after your daily allowance runs out.
          </p>
          <span className="pp-credits-cta-microcopy">
            One-time add-ons for AI Listing Creator.
          </span>
        </div>
      </div>
      <button
        type="button"
        className="pp-credits-cta-btn"
        onClick={handleNavigateToCredits}
      >
        <span>View credit packs</span>
        <Icon name="chevronRight" />
      </button>
    </div>
  );
}
