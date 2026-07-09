import {
  AI_CREDITS_REQUIRED_MESSAGE,
  AI_CREDITS_REQUIRED_SECONDARY,
  getAiCreditsCheckoutUrl,
} from "../utils/aiCredits";
import Icon from "./Icon";

export default function AiCreditsRequiredToast({ onDismiss }) {
  return (
    <div className="ai-credits-toast-content">
      <div className="ai-credits-toast-copy">
        <strong>{AI_CREDITS_REQUIRED_MESSAGE}</strong>
        <span>{AI_CREDITS_REQUIRED_SECONDARY}</span>
      </div>
      <a className="ai-credits-toast-cta" href={getAiCreditsCheckoutUrl({ credits: 250 })}>
        Buy AI credits
      </a>
      {onDismiss && (
        <button type="button" className="ai-credits-toast-close" onClick={onDismiss} aria-label="Dismiss">
          <Icon name="x" />
        </button>
      )}
    </div>
  );
}
