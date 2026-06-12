// PodPilot Paddle Billing browser checkout.
//
// This module is the only place that talks to Paddle.js. It is intentionally
// browser-only — never import or read PADDLE_API_KEY (server-only). The
// browser uses Paddle's `clientToken`, which is a public, origin-bound key.
//
// Public surface:
//   - openPaddleCheckout({ plan, email, onCheckoutComplete, onCheckoutClosed })
//   - isPaddleConfigured (re-export from ../config/paddle)
//
// We never persist subscription state from the frontend. After a successful
// checkout we just show a friendly "verifying" message — Paddle webhooks
// (added in a later step) are the source of truth.

import { initializePaddle } from "@paddle/paddle-js";
import { getCheckoutConfig } from "../api/client";

import {
  PADDLE_CONFIG,
  isPaddleConfigured,
  getPaddlePriceId,
  isAnnualPaddleConfigured,
} from "../config/paddle";

function normalizePlanKey(plan) {
  const value = String(plan || "").toLowerCase().trim();
  if (!value) return "";
  if (value === "all-platforms") return "all_platforms";
  if (value === "all_platforms") return "all_platforms";
  if (value.endsWith("_paid")) return normalizePlanKey(value.replace(/_paid$/, ""));
  if (value.endsWith("_annual")) return normalizePlanKey(value.replace(/_annual$/, ""));
  return value;
}

function normalizeBillingCycle(cycle) {
  return String(cycle || "monthly").toLowerCase().trim() === "annual" ? "annual" : "monthly";
}

// One-shot listener registry. Each call to openPaddleCheckout() pushes its
// onCheckoutComplete / onCheckoutClosed callbacks here; the global Paddle
// eventCallback (registered at init) drains them when the matching event
// fires.
const PADDLE_LISTENERS = new Set();

function dispatchPaddleEvent(event) {
  const name = event?.name || event?.event || event?.type;
  if (!name) return;
  
  PADDLE_LISTENERS.forEach((cbs) => {
    try { cbs.onEvent?.(event); } catch { /* noop */ }
  });

  if (name === "checkout.completed") {
    PADDLE_LISTENERS.forEach((cbs) => {
      try { cbs.onCheckoutComplete?.(event); } catch { /* noop */ }
    });
    PADDLE_LISTENERS.clear();
  } else if (name === "checkout.closed") {
    PADDLE_LISTENERS.forEach((cbs) => {
      try { cbs.onCheckoutClosed?.(event); } catch { /* noop */ }
    });
    PADDLE_LISTENERS.clear();
  }
}

let paddleInstancePromise = null;

function logPaddleDebug(message, extra = {}) {
  // eslint-disable-next-line no-console
  console.log(`[Paddle] ${message}`, {
    environment: PADDLE_CONFIG.environment,
    clientTokenExists: Boolean(PADDLE_CONFIG.clientToken),
    clientTokenLooksSandbox: Boolean(PADDLE_CONFIG.clientTokenLooksSandbox),
    ...extra,
  });
}

/**
 * Lazy, single-flight initializer. Calling more than once just returns the
 * cached promise, so multiple buttons share one Paddle instance.
 */
function getPaddle() {
  if (paddleInstancePromise) return paddleInstancePromise;

  if (!isPaddleConfigured()) {
    return Promise.reject(
      new Error(
        "Paddle is not configured. Set VITE_PADDLE_CLIENT_TOKEN in frontend/.env.",
      ),
    );
  }

  logPaddleDebug("initializing SDK");
  console.log("[Paddle] script loading");
  paddleInstancePromise = initializePaddle({
    environment: PADDLE_CONFIG.environment === "production" ? "production" : "sandbox",
    token: PADDLE_CONFIG.clientToken,
    eventCallback: (event) => {
      try {
        const name = event?.name || event?.event || event?.type;
        if (name) {
          // eslint-disable-next-line no-console
          console.debug("[Paddle] event", name);
        }
        dispatchPaddleEvent(event);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn("[Paddle] event dispatch error", err);
      }
    },
  })
    .then((paddle) => {
      if (!paddle) {
        throw new Error("Paddle SDK failed to initialize.");
      }
      console.log("[Paddle] initialized");
      return paddle;
    })
    .catch((error) => {
      // eslint-disable-next-line no-console
      console.error("[Paddle] checkout init failed", error);
      paddleInstancePromise = null; // allow retry
      throw error;
    });

  return paddleInstancePromise;
}

export function resolvePaddlePriceId(plan) {
  return getPaddlePriceId(plan);
}

/**
 * Open Paddle checkout for the given plan id, including subscription plans
 * and AI credit packs resolved by the backend checkout endpoint.
 * Returns a promise that resolves once the checkout overlay is opened.
 *
 * Optional callbacks fire later, asynchronously, when Paddle reports
 * lifecycle events:
 *   - onCheckoutComplete: payment succeeded (still requires server-side
 *     verification via webhook; the frontend should NOT mark the
 *     subscription active itself).
 *   - onCheckoutClosed: user closed without completing.
 */
export async function openPaddleCheckout({
  priceId,
  checkoutConfig,
  checkoutIntentId,
  plan,
  email,
  userId,
  trialUsageId,
  trialEligible,
  creditPackId,
  billingCycle = "monthly",
  displayMode = "overlay",
  mode,
  frameTarget,
  onCheckoutComplete,
  onCheckoutClosed,
  onEvent,
} = {}) {
  if (!userId) {
    throw new Error("Please sign in before starting checkout.");
  }

  let resolvedPriceId = priceId;
  let resolvedCheckoutConfig = checkoutConfig || null;
  const planKey = normalizePlanKey(plan);
  const normalizedBillingCycle = normalizeBillingCycle(billingCycle);
  if (!resolvedPriceId) {
    const mappedPlan = planKey;
    if (["redbubble", "teepublic", "all_platforms"].includes(mappedPlan)) {
      try {
        const result = await getCheckoutConfig(mappedPlan, normalizedBillingCycle);
        resolvedCheckoutConfig = result || null;
        resolvedPriceId = result.selected_price_id || result.price_id;
      } catch (err) {
        console.error("[Paddle] Failed to get checkout price ID:", err);
        const detail = err.response?.data?.detail || "Checkout is temporarily unavailable.";
        throw new Error(detail);
      }
    } else {
      resolvedPriceId = resolvePaddlePriceId(plan);
    }
  }

  if (!resolvedPriceId) {
    const error = new Error(`Checkout price is missing for this plan.`);
    // eslint-disable-next-line no-console
    console.error("[Paddle] checkout error", error.message);
    throw error;
  }

  mode = mode || displayMode;
  priceId = resolvedPriceId;
  logPaddleDebug("openPaddleCheckout called", {
    mode,
    selectedPriceId: priceId,
    plan: planKey,
    billing: normalizedBillingCycle,
    trialEligible: trialEligible ?? resolvedCheckoutConfig?.trial_eligible,
  });

  let paddle;
  try {
    paddle = await getPaddle();
    console.log("[Paddle] script loaded");
    console.log("[Paddle] initialized");
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("[Paddle] checkout init failed", error);
    throw error;
  }

  if (typeof onCheckoutComplete === "function" || typeof onCheckoutClosed === "function" || typeof onEvent === "function") {
    PADDLE_LISTENERS.add({ onCheckoutComplete, onCheckoutClosed, onEvent });
  }

  // customData is round-tripped to Paddle webhooks, which is how the
  // backend maps a Paddle subscription back to the Supabase user_id.
  // If the visitor isn't logged in, we omit user_id and Paddle still
  // accepts the checkout — the webhook will log a warning and skip
  // attaching to a Supabase user.
  const customData = {};
  customData.user_id = String(userId);
  const resolvedIntentId = checkoutIntentId || resolvedCheckoutConfig?.checkout_intent_id;
  if (resolvedIntentId) customData.checkout_intent_id = String(resolvedIntentId);
  if (planKey) customData.plan_key = planKey;
  customData.billing_cycle = normalizedBillingCycle;
  const resolvedTrialEligible = trialEligible ?? resolvedCheckoutConfig?.trial_eligible;
  if (typeof resolvedTrialEligible === "boolean") customData.trial_eligible = resolvedTrialEligible;
  const resolvedCreditPackId = creditPackId || resolvedCheckoutConfig?.credit_pack_id;
  if (resolvedCreditPackId) customData.credit_pack_id = String(resolvedCreditPackId);
  if (email) customData.email = String(email);
  if (plan) customData.plan = String(plan);
  if (trialUsageId) customData.trial_usage_id = String(trialUsageId);

  if (import.meta.env.DEV) {
    // eslint-disable-next-line no-console
    console.log("[Paddle] customData sent", {
      hasUserId: Boolean(customData.user_id),
      hasCheckoutIntentId: Boolean(customData.checkout_intent_id),
      plan_key: customData.plan_key,
      credit_pack_id: customData.credit_pack_id,
      billing_cycle: customData.billing_cycle,
    });
  }

  try {
    const checkoutPayload = {
      items: [{ priceId: resolvedPriceId, quantity: 1 }],
      customer: email ? { email } : undefined,
      customData: Object.keys(customData).length > 0 ? customData : undefined,
    };
    logPaddleDebug("checkout payload prepared", {
      mode,
      selectedPriceId: resolvedPriceId,
      payloadKeys: Object.keys(checkoutPayload).filter((key) => checkoutPayload[key] !== undefined),
      itemKeys: Object.keys(checkoutPayload.items[0]),
    });
    if (mode === "inline" && frameTarget) {
      console.log("[Paddle] opening inline checkout");
      paddle.Checkout.open({
        settings: {
          displayMode: "inline",
          frameTarget: "paddle-checkout-frame",
          frameInitialHeight: 450,
          frameStyle: "width: 100%; min-width: 312px; background-color: transparent; border: none;",
          theme: "light",
          successUrl: `${window.location.origin}/dashboard?checkout=success`
        },
        ...checkoutPayload
      });
    } else {
      console.log("[Paddle] opening overlay checkout");
      paddle.Checkout.open({
        ...checkoutPayload,
        settings: {
          successUrl: `${window.location.origin}/dashboard?checkout=success`
        }
      });
    }
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("[Paddle] checkout error", error);
    throw error;
  }
}



export { isPaddleConfigured, isAnnualPaddleConfigured };
