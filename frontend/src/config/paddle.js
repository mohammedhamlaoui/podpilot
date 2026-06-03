// PodPilot Paddle (browser-safe) config.
//
// Only values prefixed with VITE_* are bundled into the built JS, so this
// file must NEVER read PADDLE_API_KEY or any backend-only secret. The
// browser client uses Paddle's "client token", which is intentionally
// public and tied to checkout origins.
//
// Nothing here initializes Paddle.js — that comes in a later step. This
// module just exposes typed config + a small helper so feature code can
// degrade gracefully when the env isn't set yet (e.g. local dev without
// Paddle, or a contributor who hasn't filled their .env).

const env = typeof import.meta !== "undefined" ? import.meta.env || {} : {};

function read(name) {
  const value = env[name];
  return typeof value === "string" ? value.trim() : "";
}

const environment = read("VITE_PADDLE_ENVIRONMENT") || "sandbox";
const clientToken = read("VITE_PADDLE_CLIENT_TOKEN");
const redbubblePriceId = read("VITE_PADDLE_REDBUBBLE_PRICE_ID");
const teepublicPriceId = read("VITE_PADDLE_TEEPUBLIC_PRICE_ID");
const allPlatformsPriceId = read("VITE_PADDLE_ALL_PLATFORMS_PRICE_ID");
const redbubblePaidPriceId = read("VITE_PADDLE_REDBUBBLE_PAID_PRICE_ID");
const teepublicPaidPriceId = read("VITE_PADDLE_TEEPUBLIC_PAID_PRICE_ID");
const allPlatformsPaidPriceId = read("VITE_PADDLE_ALL_PLATFORMS_PAID_PRICE_ID");
const tokens1000PriceId = read("VITE_PADDLE_AI_TOKENS_1000_PRICE_ID");
const tokens10000PriceId = read("VITE_PADDLE_AI_TOKENS_10000_PRICE_ID");

// TODO placeholders:
// REDBUBBLE_ANNUAL_PRICE_ID
// TEEPUBLIC_ANNUAL_PRICE_ID
// ALL_PLATFORMS_ANNUAL_PRICE_ID
const redbubbleAnnualPriceId = read("VITE_PADDLE_REDBUBBLE_ANNUAL_PRICE_ID");
const teepublicAnnualPriceId = read("VITE_PADDLE_TEEPUBLIC_ANNUAL_PRICE_ID");
const allPlatformsAnnualPriceId = read("VITE_PADDLE_ALL_PLATFORMS_ANNUAL_PRICE_ID");

export const PADDLE_CONFIG = Object.freeze({
  environment,            // "sandbox" or "production"
  clientToken,            // Paddle browser client token (public)
  prices: Object.freeze({
    redbubble: redbubblePriceId,
    teepublic: teepublicPriceId,
    all_platforms: allPlatformsPriceId,
    redbubble_paid: redbubblePaidPriceId,
    teepublic_paid: teepublicPaidPriceId,
    all_platforms_paid: allPlatformsPaidPriceId,
    redbubble_annual: redbubbleAnnualPriceId,
    teepublic_annual: teepublicAnnualPriceId,
    all_platforms_annual: allPlatformsAnnualPriceId,
    tokens_1000: tokens1000PriceId,
    tokens_10000: tokens10000PriceId,
  }),
});

/**
 * Returns true when every required public Paddle var is present.
 * Use this before opening checkout so the UI can show a friendly
 * "Billing temporarily unavailable" state if env is missing.
 */
export function isPaddleConfigured() {
  return Boolean(
    PADDLE_CONFIG.clientToken &&
    PADDLE_CONFIG.prices.redbubble &&
    PADDLE_CONFIG.prices.teepublic &&
    PADDLE_CONFIG.prices.all_platforms
  );
}

/**
 * Resolve a plan id ("redbubble" | "teepublic" | "all_platforms" | "tokens_1000" | "tokens_10000") to its Paddle price id.
 * Returns "" if the plan is unknown or the env var is missing — callers
 * should check the result and skip checkout in that case.
 */
export function getPaddlePriceId(plan) {
  let key = String(plan || "").toLowerCase().trim();
  if (key === "growth") key = "all_platforms";
  if (key === "growth_annual") key = "all_platforms_annual";
  if (key === "growth_paid") key = "all_platforms_paid";
  return PADDLE_CONFIG.prices[key] || "";
}

/**
 * Check if the annual price ID is configured for the given plan.
 */
export function isAnnualPaddleConfigured(plan) {
  let key = String(plan || "").toLowerCase().trim();
  if (key === "growth") key = "all_platforms";
  const annualKey = key.endsWith("_annual") ? key : `${key}_annual`;
  return Boolean(PADDLE_CONFIG.prices[annualKey]);
}

export function isPaidPaddleConfigured(plan) {
  let key = String(plan || "").toLowerCase().trim();
  if (key === "growth") key = "all_platforms";
  const paidKey = key.endsWith("_paid") ? key : `${key}_paid`;
  return Boolean(PADDLE_CONFIG.prices[paidKey]);
}

// Lightweight one-time warning at module load so devs can spot misconfig
// in the console without crashing the app. Skipped during SSR/test builds
// where window is undefined.
if (typeof window !== "undefined" && !isPaddleConfigured()) {
  // eslint-disable-next-line no-console
  console.warn(
    "[PodPilot] Paddle env not fully set. Pricing checkout will be unavailable until VITE_PADDLE_* vars are filled in frontend/.env.",
  );
}
