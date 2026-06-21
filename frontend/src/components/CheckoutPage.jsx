import { useCallback, useEffect, useState, useRef } from "react";
import { ArrowLeft, CheckCircle2, ShieldCheck, Check, Sparkles, Mail, HelpCircle } from "lucide-react";
import { useAuth } from "../auth/AuthContext";
import {
  CHECKOUT_CONFIGURATION_ERROR_MESSAGE,
  closePaddleCheckout,
  isCheckoutConfigurationError,
  openPaddleCheckout,
  isPaddleConfigured,
} from "../lib/paddle";
import { setPendingCheckoutPlan } from "../lib/pendingCheckout";
import { getCheckoutConfig } from "../api/client";
import Icon from "./Icon";
import PublicHeader from "./PublicHeader";
import PublicFooter from "./PublicFooter";
import { useSeo } from "../utils/useSeo";

const CHECKOUT_DEBUG =
  import.meta.env.DEV ||
  import.meta.env.VITE_ENABLE_CHECKOUT_DEBUG === "true";
const DISPLAY_TRIAL_DAYS = 7;

const CONFIRMED_NO_TRIAL_REASONS = new Set([
  "active_subscription",
  "active_subscription_exists",
  "already_used_trial",
  "trial_already_used",
  "confirmed_trial_used",
  "completed_transaction",
  "completed_transaction_exists",
  "subscription_history_exists",
  "device_or_network_trial_used",
]);

const CONFIRMED_NO_TRIAL_SOURCES = new Set([
  "subscription",
  "subscription_history",
  "confirmed_trial_redemption",
  "completed_transaction",
  "device_or_network_trial_redemption",
]);

function isConfirmedNoTrialState(value) {
  if (!value || value.eligible === true || value.trial_eligible === true) return false;
  const reason = String(value.reason || value.eligibility_reason || "").toLowerCase();
  const source = String(value.source || value.eligibility_source || "").toLowerCase();
  return CONFIRMED_NO_TRIAL_REASONS.has(reason) || CONFIRMED_NO_TRIAL_SOURCES.has(source);
}

function isTransientNoTrialState(value) {
  if (!value || value.trial_eligible !== false) return false;
  return !isConfirmedNoTrialState(value);
}

const PLANS_INFO = {
  redbubble: {
    name: "Redbubble Plan",
    logo: "redbubble",
    monthly: {
      price: "$4.99",
      yearlyTotal: null,
      subtotal: "$4.99",
      total: "$4.99",
      dueInterval: "month",
      billingPeriod: "billed monthly",
    },
    annual: {
      price: "$4.16",
      yearlyTotal: "$49.90",
      subtotal: "$49.90",
      total: "$49.90",
      dueInterval: "year",
      billingPeriod: "billed annually",
    },
    features: [
      "Unlimited Redbubble uploads",
      "AI Listing Content",
      "AI Copyright Check",
      "Trademark Check",
      "30 Daily AI Tokens",
      "24/7 Support",
    ],
  },
  teepublic: {
    name: "TeePublic Plan",
    logo: "teepublic",
    monthly: {
      price: "$4.99",
      yearlyTotal: null,
      subtotal: "$4.99",
      total: "$4.99",
      dueInterval: "month",
      billingPeriod: "billed monthly",
    },
    annual: {
      price: "$4.16",
      yearlyTotal: "$49.90",
      subtotal: "$49.90",
      total: "$49.90",
      dueInterval: "year",
      billingPeriod: "billed annually",
    },
    features: [
      "Unlimited TeePublic uploads",
      "AI Listing Content",
      "AI Copyright Check",
      "Trademark Check",
      "30 Daily AI Tokens",
      "24/7 Support",
    ],
  },
  "all-platforms": {
    name: "All Platforms Plan",
    logo: "all_platforms",
    monthly: {
      price: "$6.99",
      yearlyTotal: null,
      subtotal: "$6.99",
      total: "$6.99",
      dueInterval: "month",
      billingPeriod: "billed monthly",
    },
    annual: {
      price: "$5.83",
      yearlyTotal: "$69.90",
      subtotal: "$69.90",
      total: "$69.90",
      dueInterval: "year",
      billingPeriod: "billed annually",
    },
    features: [
      "Unlimited Redbubble + TeePublic uploads",
      "AI Listing Content",
      "AI Copyright Check",
      "Trademark Check",
      "75 Daily AI Tokens",
      "24/7 Priority Support",
    ],
  },
};

function readCheckoutParams() {
  const searchParams = new URLSearchParams(window.location.search);
  let planParam = searchParams.get("plan") || "all-platforms";
  let billingParam = searchParams.get("billing") || "annual";

  if (planParam === "all-platforms" || planParam === "all_platforms") {
    planParam = "all-platforms";
  } else if (planParam === "redbubble") {
    planParam = "redbubble";
  } else if (planParam === "teepublic") {
    planParam = "teepublic";
  } else {
    planParam = "all-platforms";
  }

  if (billingParam !== "monthly" && billingParam !== "annual") {
    billingParam = "annual";
  }

  return { plan: planParam, billing: billingParam };
}

function checkoutMessageForError(error, fallback) {
  if (error?.code === "CHECKOUT_CONFIGURATION_ERROR" || isCheckoutConfigurationError(error)) {
    return CHECKOUT_CONFIGURATION_ERROR_MESSAGE;
  }
  return error?.response?.data?.detail || error?.message || fallback;
}

function getPaddleEventName(event) {
  return String(event?.name || event?.event || event?.type || "").toLowerCase();
}

function getPaddleEventMessage(event) {
  const payload = event?.payload || event?.data || event?.error || event;
  return (
    payload?.message
    || payload?.detail
    || payload?.error?.message
    || payload?.errors?.[0]?.message
    || event?.detail
    || ""
  );
}

function isValidPaddlePriceId(value) {
  return /^pri_[a-z0-9]+$/i.test(String(value || "").trim());
}

function normalizeCountryCode(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const direct = raw.match(/^[A-Za-z]{2}$/);
  if (direct) return raw.toUpperCase();
  const localeRegion = raw.match(/[-_]([A-Za-z]{2})$/);
  return localeRegion ? localeRegion[1].toUpperCase() : "";
}

function countryCodeFromUser(user) {
  const metadata = user?.user_metadata || {};
  const appMetadata = user?.app_metadata || {};
  const candidates = [
    metadata.country_code,
    metadata.countryCode,
    metadata.country,
    metadata.billing_country,
    metadata.address_country,
    metadata.locale,
    appMetadata.country_code,
    appMetadata.countryCode,
    appMetadata.country,
  ];
  for (const candidate of candidates) {
    const country = normalizeCountryCode(candidate);
    if (country) return country;
  }
  return "";
}

export default function CheckoutPage({ theme, setTheme }) {
  if (CHECKOUT_DEBUG) {
    // eslint-disable-next-line no-console
    console.log("[Checkout] mounted");
  }
  const auth = useAuth();
  const authLoading = auth?.loading;
  const isAuthenticated = Boolean(auth?.user);
  const customerEmail = auth?.user?.email || "";
  const customerUserId = auth?.user?.id || "";
  const customerCountryCode = countryCodeFromUser(auth?.user);
  const userEmail = customerEmail;
  const paddleReady = isPaddleConfigured();

  // Parse URL search parameters
  const [params, setParams] = useState(readCheckoutParams);
  const [checkoutNotice, setCheckoutNotice] = useState(null);
  const [checkoutSuccess, setCheckoutSuccess] = useState(false);
  const [loadingPaddle, setLoadingPaddle] = useState(false);
  const [paddleLoadError, setPaddleLoadError] = useState(false);
  const [paddleErrorMessage, setPaddleErrorMessage] = useState("");
  const [checkoutConfig, setCheckoutConfig] = useState(null);
  const [checkoutConfigError, setCheckoutConfigError] = useState("");
  const [checkoutConfigLoading, setCheckoutConfigLoading] = useState(true);
  const [inlineAttempt, setInlineAttempt] = useState(0);
  const checkoutFrameRef = useRef(null);
  const fallbackTimerRef = useRef(null);

  useEffect(() => {
    setParams(readCheckoutParams());
  }, []);

  const { plan, billing } = params;
  if (CHECKOUT_DEBUG) {
    // eslint-disable-next-line no-console
    console.log("[Checkout] plan=", plan);
    // eslint-disable-next-line no-console
    console.log("[Checkout] billing=", billing);
  }

  useEffect(() => {
    if (authLoading || isAuthenticated) return;
    setPendingCheckoutPlan(plan, billing);
    window.location.href = "/login";
  }, [authLoading, billing, isAuthenticated, plan]);

  const planInfo = PLANS_INFO[plan] || PLANS_INFO["all-platforms"];
  const billingInfo = planInfo[billing] || planInfo.annual;
  const isTrialEligible = !checkoutConfigLoading && checkoutConfig?.trial_eligible === true;
  const selectedPriceId = !checkoutConfigLoading ? checkoutConfig?.selected_price_id || checkoutConfig?.price_id || "" : "";
  const hasValidSelectedPriceId = isValidPaddlePriceId(selectedPriceId);
  const checkoutIntentId = checkoutConfig?.checkout_intent_id || "";
  if (CHECKOUT_DEBUG) {
    // eslint-disable-next-line no-console
    console.log("[Checkout] selectedPriceId=", selectedPriceId);
  }

  useSeo({
    title: `Checkout - ${planInfo.name}`,
    description: `Complete your checkout for the PodPilot ${planInfo.name}. Secure online payment processed via Paddle.`,
    canonical: "/checkout",
    noindex: true,
  });



  // Request backend-owned checkout config on mount and whenever URL selection changes.
  useEffect(() => {
    if (!customerUserId) {
      setCheckoutConfigLoading(false);
      return;
    }

    let active = true;
    const loadCheckoutConfig = async () => {
      try {
        setCheckoutConfigLoading(true);
        setCheckoutConfigError("");
        const data = await getCheckoutConfig(plan, billing);
        if (active) {
          if (isTransientNoTrialState(data)) {
            setCheckoutNotice(null);
          }
          setCheckoutConfig(data || null);
          setCheckoutConfigLoading(false);
        }
      } catch (err) {
        console.warn("[Checkout] checkout config failed:", err);
        if (active) {
          setCheckoutConfig(null);
          setCheckoutConfigError(err?.response?.data?.detail || err?.message || "Could not prepare checkout.");
          setCheckoutConfigLoading(false);
        }
      }
    };

    loadCheckoutConfig();
    return () => {
      active = false;
    };
  }, [billing, customerUserId, plan]);

  function getTrialDueDate() {
    const date = new Date();
    date.setDate(date.getDate() + DISPLAY_TRIAL_DAYS);
    return date.toLocaleDateString("en-US", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  }

  const showInlineError = useCallback((error, fallback = "Checkout could not load. Please try again.") => {
    const cleanMessage = checkoutMessageForError(error, fallback);
    // eslint-disable-next-line no-console
    console.error("[Paddle Checkout] inline checkout error", {
      message: cleanMessage,
      code: error?.code || "",
      type: error?.type || error?.name || "Error",
    });
    setLoadingPaddle(false);
    setPaddleLoadError(true);
    setPaddleErrorMessage(cleanMessage);
  }, []);

  // Initialize only after authentication, backend plan resolution, Paddle
  // configuration, and the inline target are all ready.
  useEffect(() => {
    if (checkoutConfigLoading || !hasValidSelectedPriceId || !isAuthenticated || !customerUserId || !paddleReady) return undefined;

    const target = checkoutFrameRef.current;
    // eslint-disable-next-line no-console
    console.info("[Paddle Checkout] inline container found", Boolean(target));
    if (!target) {
      showInlineError(new Error("Inline checkout container was not found."));
      return undefined;
    }

    let active = true;
    let inlineLoaded = false;
    let removePaddleListener = null;
    target.replaceChildren();
    setLoadingPaddle(true);
    setPaddleLoadError(false);
    setPaddleErrorMessage("");
    if (fallbackTimerRef.current) window.clearTimeout(fallbackTimerRef.current);
    fallbackTimerRef.current = window.setTimeout(() => {
      if (!active || inlineLoaded) return;
      showInlineError(new Error("Paddle checkout did not finish loading."));
    }, 20000);

    const handleInlineEvent = (event) => {
      if (!active) return;
      const eventName = getPaddleEventName(event);
      if (eventName === "checkout.loaded") {
        inlineLoaded = true;
        if (fallbackTimerRef.current) window.clearTimeout(fallbackTimerRef.current);
        setLoadingPaddle(false);
        setPaddleLoadError(false);
        // eslint-disable-next-line no-console
        console.info("[Paddle Checkout] inline checkout loaded");
        return;
      }

      const isCheckoutLoadError = eventName === "checkout.error" || eventName === "checkout.failed";
      const isPaymentError = eventName === "checkout.payment.error" || eventName === "checkout.payment.failed";
      if (!isCheckoutLoadError && !isPaymentError) return;

      const message = getPaddleEventMessage(event);
      const eventError = new Error(message || (isPaymentError ? "Payment could not be completed." : "Paddle checkout error"));
      eventError.code = event?.code || "";
      eventError.type = event?.type || "";
      if (isPaymentError && inlineLoaded) {
        // Paddle keeps the form usable after payment errors. Do not replace it.
        setCheckoutNotice({ type: "error", message: eventError.message });
        // eslint-disable-next-line no-console
        console.error("[Paddle Checkout] inline checkout error", {
          message: eventError.message,
          code: eventError.code,
          type: eventError.type,
        });
        return;
      }
      showInlineError(eventError);
    };

    // Deferring one task avoids React development StrictMode opening two
    // checkouts during its setup-cleanup-setup verification cycle.
    const openTimerId = window.setTimeout(() => {
      void openPaddleCheckout({
        priceId: selectedPriceId,
        checkoutConfig,
        checkoutIntentId,
        trialEligible: isTrialEligible,
        plan,
        email: userEmail,
        countryCode: customerCountryCode,
        userId: customerUserId,
        billingCycle: billing,
        mode: "inline",
        frameTarget: "paddle-checkout-frame",
        onCheckoutComplete: () => {
          setCheckoutSuccess(true);
        },
        onCheckoutClosed: () => {
          if (active) setLoadingPaddle(false);
        },
        onEvent: handleInlineEvent,
      }).then((removeListener) => {
        if (!active) {
          removeListener?.();
          return;
        }
        removePaddleListener = removeListener;
      }).catch((error) => {
        if (active) showInlineError(error, "Could not load checkout. Please try again.");
      });
    }, 0);

    return () => {
      active = false;
      window.clearTimeout(openTimerId);
      if (fallbackTimerRef.current) window.clearTimeout(fallbackTimerRef.current);
      removePaddleListener?.();
    };
  }, [billing, checkoutConfig, checkoutConfigLoading, checkoutIntentId, customerCountryCode, customerUserId, hasValidSelectedPriceId, inlineAttempt, isAuthenticated, isTrialEligible, paddleReady, plan, selectedPriceId, showInlineError, userEmail]);

  const handleInlineRetry = async () => {
    if (loadingPaddle) return;
    setLoadingPaddle(true);
    setPaddleLoadError(false);
    setPaddleErrorMessage("");
    await closePaddleCheckout();
    checkoutFrameRef.current?.replaceChildren();
    setInlineAttempt((attempt) => attempt + 1);
  };

  return (
    <main className="landing-page checkout-page-main">

      <PublicHeader
        theme={theme}
        setTheme={setTheme}
        guestCtaLabel={checkoutConfigLoading ? "Continue" : (isTrialEligible ? "Start your 7-day free trial" : "Subscribe now")}
      />

      <section className="checkout-section">
        <div className="landing-container">
          {checkoutSuccess ? (
            /* SUCCESS VIEW */
            <div className="checkout-success-container">
              <div className="checkout-success-card animate-fade-in">
                <div className="checkout-success-icon-wrapper">
                  <CheckCircle2 size={48} className="checkout-success-icon animate-scale-up" />
                </div>
                <h2>Subscription Activated!</h2>
                <p>
                  Thank you for subscribing to the <strong>{planInfo.name}</strong> ({billing === "annual" ? "Annual" : "Monthly"}).
                </p>
                <div className="checkout-success-details">
                  <p>Our backend is currently verifying and configuring your workspace access. Paddle webhooks serve as the single secure source of truth.</p>
                  <span className="checkout-success-badge">
                    <ShieldCheck size={14} />
                    Verified Checkout Origin
                  </span>
                </div>
                <a href="/dashboard?checkout=success" className="landing-btn landing-btn-primary checkout-success-btn">
                  <span>Go to Dashboard</span>
                  <ArrowLeft size={16} style={{ transform: "rotate(180deg)", marginLeft: "4px" }} />
                </a>
              </div>
            </div>
          ) : (
            /* CHECKOUT PAGE VIEW */
            <div className="checkout-grid">
              {/* LEFT COLUMN: ORDER SUMMARY */}
              <div className="checkout-left-column">
                <a href="/pricing" className="checkout-back-link">
                  <ArrowLeft size={16} />
                  <span>Return to Pricing</span>
                </a>

                <div className="checkout-price-hero">
                  <span className="checkout-price-amount">
                    {billing === "annual" ? billingInfo.price : planInfo.monthly.price}
                    <span className="checkout-price-vat"> inc. VAT</span>
                  </span>
                  <span className="checkout-price-period">
                    {billing === "annual" ? "billed annually ⓘ" : "billed monthly ⓘ"}
                  </span>
                  {isTrialEligible && (
                    <div className="checkout-trial-badge">
                      <Sparkles size={14} className="animate-pulse" />
                      <span>{DISPLAY_TRIAL_DAYS}-Day Free Trial Included</span>
                    </div>
                  )}
                  {checkoutConfigError && (
                    <div className="checkout-trial-warning">
                      <span>{checkoutConfigError}</span>
                    </div>
                  )}
                  <p className="checkout-billing-note">
                    {checkoutConfigLoading
                      ? "Confirming your offer..."
                      : isTrialEligible
                      ? `${DISPLAY_TRIAL_DAYS} days free, then ${billingInfo.total} ${billing === "annual" ? "annually" : "monthly"}.`
                      : `You will be charged ${billingInfo.total} today.`}
                  </p>
                </div>


                {/* Plan Card */}
                <div className="checkout-plan-card">
                  <div className="checkout-plan-card-header">
                    <div className="checkout-plan-logo-wrap">
                      {plan === "redbubble" && <Icon name="redbubble" className="checkout-plan-logo" />}
                      {plan === "teepublic" && <Icon name="teepublic" className="checkout-plan-logo" />}
                      {plan === "all-platforms" && (
                        <div className="checkout-plan-logo-group">
                          <Icon name="redbubble" className="checkout-plan-logo" />
                          <Icon name="teepublic" className="checkout-plan-logo" />
                        </div>
                      )}
                    </div>
                    <div className="checkout-plan-title-group">
                      <h3>{planInfo.name}</h3>
                      <span>
                        {billing === "annual" ? `${billingInfo.price} / month` : `${planInfo.monthly.price} / month`}
                      </span>
                    </div>
                  </div>

                  <ul className="checkout-plan-features">
                    {planInfo.features.map((feat) => (
                      <li key={feat} className="checkout-feature-item">
                        <Check size={14} className="checkout-feature-check" />
                        <span>{feat}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                {/* Summary Table */}
                <div className="checkout-summary-table-container">
                  <table className="checkout-summary-table">
                    <tbody>
                      {checkoutConfigLoading ? (
                        <tr className="checkout-summary-total-row">
                          <td>Offer</td>
                          <td className="text-right">Loading...</td>
                        </tr>
                      ) : isTrialEligible ? (
                        <>
                          <tr>
                            <td>Subtotal</td>
                            <td className="text-right">{billingInfo.subtotal}</td>
                          </tr>
                          <tr>
                            <td>Free Trial ({DISPLAY_TRIAL_DAYS} Days)</td>
                            <td className="text-right" style={{ color: "#10B981", fontWeight: 700 }}>
                              -{billingInfo.subtotal}
                            </td>
                          </tr>
                          <tr className="checkout-summary-total-row">
                            <td>Due Today</td>
                            <td className="text-right" style={{ color: "#10B981", fontWeight: 800 }}>
                              $0.00
                            </td>
                          </tr>
                          <tr className="checkout-summary-due-row">
                            <td>Billed starting {getTrialDueDate()}</td>
                            <td className="text-right">{billingInfo.total}</td>
                          </tr>
                        </>
                      ) : (
                        <>
                          <tr>
                            <td>Subtotal</td>
                            <td className="text-right">{billingInfo.subtotal}</td>
                          </tr>
                          <tr>
                            <td>VAT</td>
                            <td className="text-right">$0.00</td>
                          </tr>
                          <tr className="checkout-summary-total-row">
                            <td>Total</td>
                            <td className="text-right">{billingInfo.total}</td>
                          </tr>
                          <tr className="checkout-summary-due-row">
                            <td>Due Today</td>
                            <td className="text-right">{billingInfo.total}</td>
                          </tr>
                        </>
                      )}
                    </tbody>
                  </table>
                </div>


                {/* Prefilled email */}
                <div className="checkout-footer-meta">
                  {customerEmail && (
                    <div className="checkout-email-badge">
                      <Mail size={14} />
                      <span>Prefilled Customer: {customerEmail}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* RIGHT COLUMN: PADDLE FRAME */}
              <div className="checkout-right-column">
                <div className="paddle-checkout-frame-wrapper" style={{ position: "relative" }}>
                  <div ref={checkoutFrameRef} className="paddle-checkout-frame" style={{ minHeight: 450, width: "100%" }} />


                  {paddleLoadError && (
                    <div 
                      className="paddle-error-state" 
                      style={{ 
                        position: "absolute", 
                        top: 0, 
                        left: 0, 
                        right: 0, 
                        bottom: 0, 
                        zIndex: 10,
                        background: "var(--pp-card-background, #ffffff)" 
                      }}
                    >
                      <HelpCircle size={36} />
                      <h4>Checkout could not load</h4>
                      <p>{paddleErrorMessage || "The payment form did not load. Please try again."}</p>
                      <button
                        type="button"
                        onClick={handleInlineRetry}
                        disabled={loadingPaddle || !selectedPriceId}
                        className="landing-btn landing-btn-primary"
                        style={{ marginTop: "12px", minHeight: "38px", padding: "0 16px" }}
                      >
                        Retry inline checkout
                      </button>
                    </div>
                  )}

                  {(checkoutConfigLoading || (loadingPaddle && !paddleLoadError)) && (
                    <div className="paddle-loading-skeleton" role="status" aria-live="polite">
                      <div className="paddle-skeleton-header">
                        <span className="skeleton-pill wide" />
                        <span className="skeleton-pill" />
                      </div>
                      <div className="paddle-skeleton-card">
                        <span className="skeleton-line" />
                        <span className="skeleton-line short" />
                        <span className="skeleton-input" />
                        <span className="paddle-skeleton-button" />
                      </div>
                      <p>Verifying checkout details...</p>
                    </div>
                  )}

                  {!checkoutConfigLoading && !hasValidSelectedPriceId && (
                    <div className="paddle-error-state">
                      <HelpCircle size={36} />
                      <h4>Checkout is temporarily unavailable.</h4>
                      <p>{checkoutConfigError || "The selected plan does not have a valid Paddle price ID."}</p>
                    </div>
                  )}

                  {!checkoutConfigLoading && !paddleReady && hasValidSelectedPriceId && (
                    <div className="paddle-error-state">
                      <HelpCircle size={36} />
                      <h4>Payment System Unavailable</h4>
                      <p>Paddle Client Token or Price IDs are missing in the workspace environment variables. Please check your configuration.</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Checkout notice toast */}
      {checkoutNotice && (
        <div
          className={`landing-pricing-toast landing-pricing-toast-${checkoutNotice.type}`}
          style={{ zIndex: 999999 }}
          role={checkoutNotice.type === "error" ? "alert" : "status"}
          aria-live="polite"
        >
          <span>{checkoutNotice.message}</span>
          <button type="button" onClick={() => setCheckoutNotice(null)} aria-label="Dismiss">
            <Icon name="x" />
          </button>
        </div>
      )}

      <PublicFooter />
    </main>
  );
}
