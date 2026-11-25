import Icon from "./Icon";
import { getPricingUrl } from "../lib/subscriptionAccess";

export default function PreviewModeBanner() {
  const pricingUrl = getPricingUrl();

  return (
    <section className="pp-preview-banner" aria-label="Preview mode">
      <div className="pp-preview-banner-icon" aria-hidden="true">
        <Icon name="lock" />
      </div>
      <div className="pp-preview-banner-copy">
        <strong>Your workspace is in preview mode</strong>
        <span>Choose a plan to unlock PodPilot.</span>
      </div>
      <div className="pp-preview-banner-actions">
        <a className="primary-button" href={pricingUrl}>
          Choose a plan
        </a>
        <a className="secondary-button" href={pricingUrl}>View plans</a>
      </div>
    </section>
  );
}
