import { useCallback, useEffect, useState, useRef } from "react";
import { ArrowLeft, CheckCircle2, ShieldCheck, Check, Sparkles, Mail, HelpCircle, Settings2 } from "lucide-react";
import { useAuth } from "../auth/AuthContext";
import {
  CHECKOUT_CONFIGURATION_ERROR_MESSAGE,
  closePaddleCheckout,
  isCheckoutConfigurationError,
  openPaddleCheckout,
  initializePaddlePaymentLink,
  isPaddleConfigured,
} from "../lib/paddle";
import { setPendingCheckoutPlan } from "../lib/pendingCheckout";
import { getCheckoutConfig, createBillingPortalSession } from "../api/client";
import Icon from "./Icon";
import { GUARANTEE_CONFIRMED } from "../config/commercial";
import PublicHeader from "./PublicHeader";
import PublicFooter from "./PublicFooter";
import { useSeo } from "../utils/useSeo";

const CHECKOUT_DEBUG =
  import.meta.env.DEV ||
  import.meta.env.VITE_ENABLE_CHECKOUT_DEBUG === "true";
const PLANS_INFO = {
  redbubble: {
    name: "Redbubble Plan",
    logo: "redbubble",
    monthly: {
      price: "$8.99",
      yearlyTotal: null,
      subtotal: "$8.99",
      total: "$8.99",
      dueInterval: "month",
      billingPeriod: "billed monthly",
    },
    annual: {
      price: "$7.49",
      yearlyTotal: "$89.90",
      subtotal: "$89.90",
      total: "$89.90",
      dueInterval: "year",
      billingPeriod: "billed annually",
    },
    features: [
      "Unlimited Redbubble uploads",
      "AI Listing Content",
      "AI Copyright Check",
      "Trademark Check",
      "30 Daily AI Tokens",
      "Account and subscription management",
    ],
  },
  teepublic: {
    name: "TeePublic Plan",
    logo: "teepublic",
    monthly: {
      price: "$8.99",
      yearlyTotal: null,
      subtotal: "$8.99",
      total: "$8.99",
      dueInterval: "month",
      billingPeriod: "billed monthly",
    },
    annual: {
      price: "$7.49",
      yearlyTotal: "$89.90",
      subtotal: "$89.90",
      total: "$89.90",
      dueInterval: "year",
      billingPeriod: "billed annually",
    },
    features: [
      "Unlimited TeePublic uploads",
      "AI Listing Content",
      "AI Copyright Check",
      "Trademark Check",
      "30 Daily AI Tokens",
      "Account and subscription management",
    ],
  },
  "all-platforms": {
    name: "All Platforms Plan",
    logo: "all_platforms",
    monthly: {
      price: "$10.99",
      yearlyTotal: null,
      subtotal: "$10.99",
      total: "$10.99",
      dueInterval: "month",
      billingPeriod: "billed monthly",
    },
    annual: {
      price: "$9.16",
      yearlyTotal: "$109.90",
      subtotal: "$109.90",
      total: "$109.90",
      dueInterval: "year",
      billingPeriod: "billed annually",
    },
    features: [
      "Unlimited Redbubble + TeePublic uploads",
      "AI Listing Content",
      "AI Copyright Check",
      "Trademark Check",
      "75 Daily AI Tokens",
      "Account and subscription management",
    ],
  },
};

const AI_CREDIT_PACKS_INFO = {
  1000: {
    id: "ai_credits_1000",
    name: "1,000 AI Credits",
    price: "$4.99",
    subtotal: "$4.99",
    total: "$4.99",
    dueInterval: "one-time",
    billingPeriod: "one-time purchase",
    features: [
      "1,000 AI listing credits",
      "Generate Redbubble listing drafts",
      "Generate TeePublic listing drafts",
      "Use with your existing PodPilot workflow",
    ],
  },
  10000: {
    id: "ai_credits_10000",
    name: "10,000 AI Credits",
    price: "$39.99",
    subtotal: "$39.99",
    total: "$39.99",
    dueInterval: "one-time",
    billingPeriod: "one-time purchase",
    features: ["10,000 AI listing credits", "Generate Redbubble listing drafts", "Generate TeePublic listing drafts", "Use with your existing PodPilot workflow"],
  },
};

function readCheckoutParams() {
  const searchParams = new URLSearchParams(window.location.search);
  let planParam = searchParams.get("plan") || "all-platforms";
  let billingParam = searchParams.get("billing") || "annual";
  const creditsParam = Number(searchParams.get("credits") || 1000);

  if (planParam === "ai-credits" || planParam === "ai_credits") {
    const normalizedCredits = AI_CREDIT_PACKS_INFO[creditsParam] ? creditsParam : 1000;
    const pack = AI_CREDIT_PACKS_INFO[normalizedCredits];
    return {
      mode: "ai_credits",
      plan: "ai-credits",
      billing: "one_time",
      credits: normalizedCredits,
      creditPackId: pack.id,
    };
  }

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

  return { mode: "subscription", plan: planParam, billing: billingParam };
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
  const params = new URLSearchParams(window.location.search);
  if (params.has("_ptxn")) {
    return <PaymentLinkCheckout theme={theme} setTheme={setTheme} transactionIds={params.getAll("_ptxn")} />;
  }
  return <OfferCheckoutPage theme={theme} setTheme={setTheme} />;
}

function PaymentLinkCheckout({ theme, setTheme, transactionIds }) {
  const transactionId = transactionIds.length === 1 ? transactionIds[0] : "";
  const valid = /^txn_[a-z0-9]{26}$/.test(transactionId);
  const [message, setMessage] = useState(valid ? "Opening secure Paddle checkout…" : "This payment link is invalid.");
  useSeo({ title: "Secure payment", canonical: "/checkout", noindex: true });
  useEffect(() => {
    if (!valid) return undefined;
    let active = true;
    let unsubscribe;
    const timer = window.setTimeout(() => {
      initializePaddlePaymentLink((event) => {
        if (!active) return;
        const name = getPaddleEventName(event);
        if (name === "checkout.loaded") setMessage("Complete your payment or payment method update in the secure Paddle window.");
        if (name === "checkout.closed") setMessage("Checkout closed. No payment confirmation has been received.");
        if (name === "checkout.completed") setMessage("Paddle received your checkout. Your account will update after server verification.");
        if (name === "checkout.error" || name === "checkout.failed") setMessage("This payment link could not be opened. Please contact support.");
      }).then((remove) => { if (active) unsubscribe = remove; else remove(); })
        .catch(() => { if (active) setMessage("Secure checkout is unavailable. Please try again later."); });
    }, 0);
    return () => { active = false; window.clearTimeout(timer); unsubscribe?.(); };
  }, [valid, transactionId]);
  return <main className="landing-page">
    <PublicHeader theme={theme} setTheme={setTheme} />
    <section className="landing-section"><div className="landing-container">
      <h1>Secure payment</h1><p role="status">{message}</p>
      <a href="/dashboard">Return to dashboard</a>
    </div></section><PublicFooter />
  </main>;
}

function OfferCheckoutPage({ theme, setTheme }) {
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
  const [hasExistingSubscription, setHasExistingSubscription] = useState(false);
  const [openingPortal, setOpeningPortal] = useState(false);
  const [portalError, setPortalError] = useState("");
  const [checkoutConfigLoading, setCheckoutConfigLoading] = useState(true);
  const [inlineAttempt, setInlineAttempt] = useState(0);
  const checkoutFrameRef = useRef(null);
  const fallbackTimerRef = useRef(null);

  useEffect(() => {
    setParams(readCheckoutParams());
  }, []);

  const {
    mode: checkoutMode = "subscription",
    plan,
    billing,
    credits = 0,
    creditPackId = "",
  } = params;
  const isAiCreditsCheckout = checkoutMode === "ai_credits";
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

  const aiCreditPackInfo = AI_CREDIT_PACKS_INFO[credits] || AI_CREDIT_PACKS_INFO[1000];
  const planInfo = isAiCreditsCheckout ? aiCreditPackInfo : (PLANS_INFO[plan] || PLANS_INFO["all-platforms"]);
  const billingInfo = isAiCreditsCheckout ? aiCreditPackInfo : (planInfo[billing] || planInfo.annual);
  const selectedPriceId = !checkoutConfigLoading ? checkoutConfig?.selected_price_id || checkoutConfig?.price_id || "" : "";
  const hasValidSelectedPriceId = isValidPaddlePriceId(selectedPriceId);
  const checkoutIntentId = checkoutConfig?.checkout_intent_id || "";
  if (CHECKOUT_DEBUG) {
    // eslint-disable-next-line no-console
    console.log("[Checkout] selectedPriceId=", selectedPriceId);
  }

  useSeo({
    title: `Checkout - ${planInfo.name}`,
    description: isAiCreditsCheckout
      ? `Buy ${planInfo.name} for PodPilot AI listing generation. Secure online payment processed via Paddle.`
      : `Complete your checkout for the PodPilot ${planInfo.name}. Secure online payment processed via Paddle.`,
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
        setHasExistingSubscription(false);
        setPortalError("");
        const data = isAiCreditsCheckout
          ? await getCheckoutConfig({
              intent_type: "ai_credits",
              credit_pack_id: creditPackId || aiCreditPackInfo.id,
            })
          : await getCheckoutConfig(plan, billing);
        if (active) {
          setCheckoutConfig(data || null);
          setCheckoutConfigLoading(false);
        }
      } catch (err) {
        if (active) {
          const existingSubscription = !isAiCreditsCheckout && err?.response?.status === 409;
          setCheckoutConfig(null);
          setHasExistingSubscription(existingSubscription);
          setCheckoutConfigError(existingSubscription ? "" : err?.response?.data?.detail || err?.message || "Could not prepare checkout.");
          setCheckoutConfigLoading(false);
        }
      }
    };

    loadCheckoutConfig();
    return () => {
      active = false;
    };
  }, [aiCreditPackInfo.id, billing, creditPackId, customerUserId, isAiCreditsCheckout, plan]);

  async function handleManageSubscription() {
    if (openingPortal) return;
    setOpeningPortal(true);
    setPortalError("");
    try {
      const data = await createBillingPortalSession();
      if (!data?.url) throw new Error("Missing billing portal URL");
      window.location.assign(data.url);
    } catch {
      setPortalError("We couldn't open your billing portal. Please try again or contact support.");
      setOpeningPortal(false);
    }
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
        plan: isAiCreditsCheckout ? (checkoutConfig?.credit_pack_id || creditPackId || aiCreditPackInfo.id) : plan,
        creditPackId: isAiCreditsCheckout ? (checkoutConfig?.credit_pack_id || creditPackId || aiCreditPackInfo.id) : undefined,
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
  }, [aiCreditPackInfo.id, billing, checkoutConfig, checkoutConfigLoading, checkoutIntentId, creditPackId, customerCountryCode, customerUserId, hasValidSelectedPriceId, inlineAttempt, isAiCreditsCheckout, isAuthenticated, paddleReady, plan, selectedPriceId, showInlineError, userEmail]);

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
        guestCtaLabel={
          checkoutConfigLoading
            ? "Continue"
            : isAiCreditsCheckout
            ? "Buy AI credits"
            : "Subscribe now"
        }
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
                <h2>{isAiCreditsCheckout ? "AI Credits Purchased!" : "Subscription Activated!"}</h2>
                <p>
                  {isAiCreditsCheckout ? (
                    <>Thank you for buying <strong>{planInfo.name}</strong>.</>
                  ) : (
                    <>Thank you for subscribing to the <strong>{planInfo.name}</strong> ({billing === "annual" ? "Annual" : "Monthly"}).</>
                  )}
                </p>
                <div className="checkout-success-details">
                  <p>
                    {isAiCreditsCheckout
                      ? "Our backend is syncing your new AI credits. Paddle webhooks serve as the single secure source of truth."
                      : "Our backend is currently verifying and configuring your workspace access. Paddle webhooks serve as the single secure source of truth."}
                  </p>
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
                    {billingInfo?.price || "—"}
                    <span className="checkout-price-vat"> base price</span>
                  </span>
                  <span className="checkout-price-period">
                    {isAiCreditsCheckout ? "one-time AI credit pack" : (billing === "annual" ? "billed annually ⓘ" : "billed monthly ⓘ")}
                  </span>
                  {checkoutConfigError && (
                    <div className="checkout-trial-warning">
                      <span>{checkoutConfigError}</span>
                    </div>
                  )}
                  <p className="checkout-billing-note">
                    {checkoutConfigLoading
                      ? "Confirming your offer..."
                      : isAiCreditsCheckout
                      ? `${planInfo.name} for ${billingInfo.total}.`
                      : `Plan price: ${billingInfo.total}. Paddle will show applicable taxes and the final amount before payment.`}
                  </p>
                  {GUARANTEE_CONFIRMED && !isAiCreditsCheckout && (
                    <p className="checkout-guarantee-note"><ShieldCheck size={16} /> 3-day money-back guarantee. <a href="/refund-policy">Read the policy</a>.</p>
                  )}
                </div>


                {/* Plan Card */}
                <div className="checkout-plan-card">
                  <div className="checkout-plan-card-header">
                    <div className="checkout-plan-logo-wrap">
                      {isAiCreditsCheckout && <Sparkles className="checkout-plan-logo" size={32} />}
                      {!isAiCreditsCheckout && plan === "redbubble" && <Icon name="redbubble" className="checkout-plan-logo" />}
                      {!isAiCreditsCheckout && plan === "teepublic" && <Icon name="teepublic" className="checkout-plan-logo" />}
                      {!isAiCreditsCheckout && plan === "all-platforms" && (
                        <div className="checkout-plan-logo-group">
                          <Icon name="redbubble" className="checkout-plan-logo" />
                          <Icon name="teepublic" className="checkout-plan-logo" />
                        </div>
                      )}
                    </div>
                    <div className="checkout-plan-title-group">
                      <h3>{planInfo.name}</h3>
                      <span>
                        {isAiCreditsCheckout ? billingInfo.billingPeriod : `${billingInfo?.price || "—"} / month`}
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
                      ) : (
                        <>
                          <tr>
                            <td>Subtotal</td>
                            <td className="text-right">{billingInfo.subtotal}</td>
                          </tr>
                          <tr>
                            <td>Taxes</td>
                            <td className="text-right">Shown by Paddle</td>
                          </tr>
                          <tr className="checkout-summary-total-row">
                            <td>Plan price</td>
                            <td className="text-right">{billingInfo.total}</td>
                          </tr>
                          <tr className="checkout-summary-due-row">
                            <td>Final amount due</td>
                            <td className="text-right">See Paddle checkout</td>
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
                <div className="paddle-checkout-frame-wrapper" style={{ position: "relative", ...(hasExistingSubscription ? { minHeight: 0 } : {}) }}>
                  {hasExistingSubscription ? (
                    <div className="paddle-error-state" style={{ minHeight: 360, gap: 16 }}>
                      <Settings2 size={36} aria-hidden="true" />
                      <h4>Manage your subscription</h4>
                      <p>You already have a subscription. Open your secure Paddle billing portal to view your plan, update payment details or manage cancellation.</p>
                      <button type="button" onClick={handleManageSubscription} disabled={openingPortal}
                        className="landing-btn landing-btn-primary" aria-busy={openingPortal}>
                        <Settings2 size={18} aria-hidden="true" />
                        {openingPortal ? "Opening billing portal…" : "Manage subscription"}
                      </button>
                      {portalError && <p role="alert">{portalError}</p>}
                      <a href="/contact">Contact support</a>
                    </div>
                  ) : (
                    <div ref={checkoutFrameRef} className="paddle-checkout-frame" style={{ minHeight: 450, width: "100%" }} />
                  )}


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

                  {!checkoutConfigLoading && !hasValidSelectedPriceId && !hasExistingSubscription && (
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
