// PodPilot pending Paddle checkout state.
//
// When a visitor clicks a pricing CTA while logged out, we stash the chosen
// plan in localStorage and send them to the auth page. After a successful
// login/signup the dashboard reads this value, immediately opens Paddle
// checkout for that plan, and clears the pending state.
//
// Supabase user_id MUST be on the checkout `customData` for the webhook to
// attach the new subscription to the right user — that's the whole point
// of this gate.

const STORAGE_KEY = "podpilot_pending_checkout_plan_v1";
const VALID_PLANS = new Set(["redbubble", "teepublic", "all_platforms"]);

function normalizePlan(plan) {
  const value = String(plan || "").toLowerCase().trim();
  if (value === "all-platforms" || value === "growth") return "all_platforms";
  return VALID_PLANS.has(value) ? value : "";
}

function normalizeBilling(billing) {
  return String(billing || "monthly").toLowerCase().trim() === "annual" ? "annual" : "monthly";
}

export function setPendingCheckoutPlan(plan, billingCycle = "monthly") {
  try {
    const normalized = normalizePlan(plan);
    if (!normalized) {
      clearPendingCheckoutPlan();
      return null;
    }
    const pending = {
      plan: normalized,
      billing_cycle: normalizeBilling(billingCycle),
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(pending));
    return pending;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[Paddle] could not persist pending plan:", err?.message || err);
    return null;
  }
}

export function getPendingCheckoutPlan() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    if (raw.trim().startsWith("{")) {
      const parsed = JSON.parse(raw);
      const plan = normalizePlan(parsed?.plan);
      if (!plan) return null;
      return {
        plan,
        billing_cycle: normalizeBilling(parsed?.billing_cycle || parsed?.billingCycle),
      };
    }
    const plan = normalizePlan(raw);
    return plan ? { plan, billing_cycle: "monthly" } : null;
  } catch {
    return null;
  }
}

export function clearPendingCheckoutPlan() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* noop */
  }
}
