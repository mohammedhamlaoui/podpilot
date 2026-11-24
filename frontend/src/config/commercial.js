export const SUBSCRIPTION_PRICES = Object.freeze({
  redbubble: { monthly: 8.99, annual: 89.9, name: "Redbubble" },
  teepublic: { monthly: 8.99, annual: 89.9, name: "TeePublic" },
  all_platforms: { monthly: 10.99, annual: 109.9, name: "Redbubble + TeePublic" },
});

// Enable only after Paddle confirms the operational refund workflow.
export const GUARANTEE_CONFIRMED = import.meta.env.VITE_3_DAY_GUARANTEE_CONFIRMED === "true";

export function formatUsd(amount) {
  return `$${Number(amount).toFixed(2)}`;
}

export function subscriptionPrice(plan, cycle = "monthly") {
  const key = plan === "all-platforms" ? "all_platforms" : plan;
  return SUBSCRIPTION_PRICES[key]?.[cycle] ?? null;
}
