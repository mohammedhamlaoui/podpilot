import Icon from "./Icon";

export default function AiCreditsDashboardCard() {
  function handleNavigateToCredits() {
    window.location.href = "/pricing#ai-listing-credits";
  }

  return (
    <div className="pp-credits-cta-card">
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
