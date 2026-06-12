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

function normalizeCustomerEmail(email) {
  const value = String(email || "").trim();
  return value.includes("@") ? value : "";
}

function normalizeCountryCode(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const direct = raw.match(/^[A-Za-z]{2}$/);
  if (direct) return raw.toUpperCase();
  const localeRegion = raw.match(/[-_]([A-Za-z]{2})$/);
  if (localeRegion) return localeRegion[1].toUpperCase();
  return "";
}

function inferBrowserCountryCode() {
  if (typeof navigator === "undefined") return "";
  const candidates = [
    navigator.language,
    ...(Array.isArray(navigator.languages) ? navigator.languages : []),
  ];
  for (const candidate of candidates) {
    const country = normalizeCountryCode(candidate);
    if (country) return country;
  }
  return "";
}

function resolveCheckoutCountryCode(countryCode) {
  return normalizeCountryCode(countryCode) || inferBrowserCountryCode() || "MA";
}

function buildCheckoutCustomer({ email, countryCode }) {
  const normalizedEmail = normalizeCustomerEmail(email);
  if (!normalizedEmail) return undefined;
  const resolvedCountry = resolveCheckoutCountryCode(countryCode);
  const customer = { email: normalizedEmail };
  if (resolvedCountry) {
    customer.address = { countryCode: resolvedCountry };
  }
  return customer;
}

// One-shot listener registry. Each call to openPaddleCheckout() pushes its
// onCheckoutComplete / onCheckoutClosed callbacks here; the global Paddle
// eventCallback (registered at init) drains them when the matching event
// fires.
const PADDLE_LISTENERS = new Set();
const PADDLE_DEBUG =
  import.meta.env.DEV ||
  import.meta.env.VITE_ENABLE_CHECKOUT_DEBUG === "true";
const CHECKOUT_CONFIGURATION_ERROR_MESSAGE = "Checkout configuration error. Please contact support.";

function safeErrorMessage(error) {
  const detail = error?.response?.data?.detail || error?.message || error?.detail;
  if (detail) return String(detail);
  try {
    return JSON.stringify(error);
  } catch {
    return String(error || "");
  }
}

function isCheckoutConfigurationError(error) {
  const message = safeErrorMessage(error).toLowerCase();
  return (
    message.includes("price_ids could not be found")
    || message.includes("price id could not be found")
    || message.includes("provided price_ids")
    || message.includes("price_id")
    || message.includes("price id")
    || message.includes("bad request")
    || message.includes("validation")
  );
}

function normalizeCheckoutError(error) {
  if (!isCheckoutConfigurationError(error)) return error;
  const normalized = new Error(CHECKOUT_CONFIGURATION_ERROR_MESSAGE);
  normalized.code = "CHECKOUT_CONFIGURATION_ERROR";
  normalized.cause = error;
  return normalized;
}

function logCheckoutFailure(error, diagnostics) {
  const normalizedMessage = safeErrorMessage(error).slice(0, 240);
  // eslint-disable-next-line no-console
  console.error("[Paddle] checkout failed", {
    ...diagnostics,
    environment: PADDLE_CONFIG.environment,
    clientTokenExists: Boolean(PADDLE_CONFIG.clientToken),
    errorType: error?.name || error?.code || "Error",
    message: normalizedMessage,
  });
}

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
  if (!PADDLE_DEBUG) return;
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

  if (PADDLE_DEBUG) {
    logPaddleDebug("initializing SDK");
    // eslint-disable-next-line no-console
    console.log("[Paddle] script loading");
  }
  paddleInstancePromise = initializePaddle({
    environment: PADDLE_CONFIG.environment === "production" ? "production" : "sandbox",
    token: PADDLE_CONFIG.clientToken,
    eventCallback: (event) => {
      try {
        const name = event?.name || event?.event || event?.type;
        if (PADDLE_DEBUG && name) {
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
      if (PADDLE_DEBUG) {
        // eslint-disable-next-line no-console
        console.log("[Paddle] initialized");
      }
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
  countryCode,
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
        logCheckoutFailure(err, {
          stage: "checkout_config",
          plan: mappedPlan,
          billing: normalizedBillingCycle,
          trialEligible: trialEligible ?? null,
          selectedPriceId: "",
          payloadKeys: [],
          itemKeys: [],
        });
        const detail = err.response?.data?.detail || "Checkout is temporarily unavailable.";
        throw normalizeCheckoutError(new Error(detail));
      }
    } else {
      resolvedPriceId = resolvePaddlePriceId(plan);
    }
  }

  if (!resolvedPriceId) {
    const error = new Error(`Checkout price is missing for this plan.`);
    // eslint-disable-next-line no-console
    console.error("[Paddle] checkout error", error.message);
    throw normalizeCheckoutError(error);
  }

  mode = mode || displayMode;
  priceId = resolvedPriceId;
  if (PADDLE_DEBUG) {
    logPaddleDebug("openPaddleCheckout called", {
      mode,
      selectedPriceId: priceId,
      plan: planKey,
      billing: normalizedBillingCycle,
      trialEligible: trialEligible ?? resolvedCheckoutConfig?.trial_eligible,
    });
  }

  let paddle;
  try {
    paddle = await getPaddle();
    if (PADDLE_DEBUG) {
      // eslint-disable-next-line no-console
      console.log("[Paddle] script loaded");
      // eslint-disable-next-line no-console
      console.log("[Paddle] initialized");
    }
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
  const checkoutCustomer = buildCheckoutCustomer({ email, countryCode });
  if (checkoutCustomer?.email) customData.email = checkoutCustomer.email;
  if (plan) customData.plan = String(plan);
  if (trialUsageId) customData.trial_usage_id = String(trialUsageId);

  if (PADDLE_DEBUG) {
    // eslint-disable-next-line no-console
    console.log("[Paddle] customData sent", {
      hasUserId: Boolean(customData.user_id),
      hasCheckoutIntentId: Boolean(customData.checkout_intent_id),
      plan_key: customData.plan_key,
      credit_pack_id: customData.credit_pack_id,
      billing_cycle: customData.billing_cycle,
      hasCustomerEmail: Boolean(checkoutCustomer?.email),
      hasCustomerCountry: Boolean(checkoutCustomer?.address?.countryCode),
    });
  }

  try {
    const checkoutPayload = {
      items: [{ priceId: resolvedPriceId, quantity: 1 }],
      customer: checkoutCustomer,
      customData: Object.keys(customData).length > 0 ? customData : undefined,
    };
    if (PADDLE_DEBUG) {
      logPaddleDebug("checkout payload prepared", {
        mode,
        selectedPriceId: resolvedPriceId,
        payloadKeys: Object.keys(checkoutPayload).filter((key) => checkoutPayload[key] !== undefined),
        itemKeys: Object.keys(checkoutPayload.items[0]),
      });
    }
    if (mode === "inline" && frameTarget) {
      if (PADDLE_DEBUG) {
        // eslint-disable-next-line no-console
        console.log("[Paddle] opening inline checkout");
      }
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
      if (PADDLE_DEBUG) {
        // eslint-disable-next-line no-console
        console.log("[Paddle] opening overlay checkout");
      }
      paddle.Checkout.open({
        ...checkoutPayload,
        settings: {
          successUrl: `${window.location.origin}/dashboard?checkout=success`
        }
      });
    }
  } catch (error) {
    const checkoutPayload = {
      items: [{ priceId: resolvedPriceId, quantity: 1 }],
      customer: checkoutCustomer,
      customData: Object.keys(customData).length > 0 ? customData : undefined,
    };
    logCheckoutFailure(error, {
      stage: "checkout_open",
      plan: planKey,
      billing: normalizedBillingCycle,
      trialEligible: trialEligible ?? resolvedCheckoutConfig?.trial_eligible ?? null,
      selectedPriceId: resolvedPriceId,
      payloadKeys: Object.keys(checkoutPayload).filter((key) => checkoutPayload[key] !== undefined),
      itemKeys: Object.keys(checkoutPayload.items[0]),
    });
    throw normalizeCheckoutError(error);
  }
}



export {
  CHECKOUT_CONFIGURATION_ERROR_MESSAGE,
  isCheckoutConfigurationError,
  isPaddleConfigured,
  isAnnualPaddleConfigured,
};
