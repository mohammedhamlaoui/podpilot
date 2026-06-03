export const PREMIUM_LOCK_MESSAGE = "Choose a plan to use this feature";
export const DEBUG_SUBSCRIPTION = false;

export function debugSubscriptionLog(message, payload) {
  if (!DEBUG_SUBSCRIPTION) return;
  if (payload === undefined) {
    // eslint-disable-next-line no-console
    console.debug(`[SUB] ${message}`);
    return;
  }
  // eslint-disable-next-line no-console
  console.debug(`[SUB] ${message}`, payload);
}

export function hasActiveSubscription(summary) {
  if (!summary) return false;
  if (summary.has_active_subscription === true) return true;
  const status = String(summary.status || "").toLowerCase();
  if (summary.has_subscription === true && status === "active") {
    return true;
  }
  const periodEnd = summary.current_period_end || summary.current_period_ends_at;
  if (status === "canceled" && periodEnd) {
    const end = Date.parse(periodEnd);
    return Number.isFinite(end) && end > Date.now();
  }
  return false;
}

export function isTrialActive(summary) {
  if (!summary) return false;
  if (summary.trial_active === true) return true;
  const status = String(summary.status || "").toLowerCase();
  if (status !== "trialing") return false;
  const trialEnd = summary.trial_ends_at;
  if (!trialEnd) return true;
  const end = Date.parse(trialEnd);
  return !Number.isFinite(end) || end > Date.now();
}

export function getSubscriptionFlags(summary, subscriptionLoaded = false) {
  const loaded = subscriptionLoaded === true;
  const active = loaded ? hasActiveSubscription(summary) : false;
  const trial = loaded ? isTrialActive(summary) : false;
  return {
    hasActiveSubscription: active,
    trialActive: trial,
    isWorkspaceLocked: loaded && !active && !trial,
  };
}

export function isWorkspaceLocked(summary, subscriptionLoaded = false) {
  return getSubscriptionFlags(summary, subscriptionLoaded).isWorkspaceLocked;
}

export function getPricingUrl() {
  if (typeof window === "undefined") return "/pricing";
  const isLocal = window.location.hostname.includes("localhost") ||
    window.location.hostname.includes("127.0.0.1");
  return isLocal ? `${window.location.origin}/pricing` : "https://podpilot.space/pricing";
}

export function openPricing() {
  if (typeof window === "undefined") return;
  window.location.href = getPricingUrl();
}

export function lockedActionProps(isLocked, onLockedAction = openPricing) {
  if (!isLocked) return {};
  return {
    "aria-disabled": "true",
    title: PREMIUM_LOCK_MESSAGE,
    onClick: (event) => {
      event.preventDefault();
      event.stopPropagation();
      onLockedAction();
    },
  };
}
