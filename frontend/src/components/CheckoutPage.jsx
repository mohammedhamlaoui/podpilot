import { useEffect, useState, useRef } from "react";
import { ArrowLeft, CheckCircle2, ShieldCheck, Check, Sparkles, Mail, HelpCircle } from "lucide-react";
import { useAuth } from "../auth/AuthContext";
import { openPaddleCheckout, isPaddleConfigured } from "../lib/paddle";
import { getPaddlePrice } from "../config/paddlePrices";
import { setPendingCheckoutPlan } from "../lib/pendingCheckout";
import { getCheckoutConfig } from "../api/client";
import Icon from "./Icon";
import PublicHeader from "./PublicHeader";
import PublicFooter from "./PublicFooter";
import { useSeo } from "../utils/useSeo";


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

  if (planParam === "all-platforms" || planParam === "all_platforms" || planParam === "growth") {
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

export default function CheckoutPage({ theme, setTheme }) {
  console.log("[Checkout] mounted");
  const auth = useAuth();
  const authLoading = auth?.loading;
  const isAuthenticated = Boolean(auth?.user);
  const customerEmail = auth?.user?.email || "";
  const customerUserId = auth?.user?.id || "";
  const userEmail = customerEmail;
  const paddleReady = isPaddleConfigured();

  // Parse URL search parameters
  const [params, setParams] = useState(readCheckoutParams);
  const [checkoutNotice, setCheckoutNotice] = useState(null);
  const [checkoutSuccess, setCheckoutSuccess] = useState(false);
  const [loadingPaddle, setLoadingPaddle] = useState(false);
  const [paddleLoadError, setPaddleLoadError] = useState(false);
  const [checkoutConfig, setCheckoutConfig] = useState(null);
  const [checkoutConfigError, setCheckoutConfigError] = useState("");
  const [checkoutConfigLoading, setCheckoutConfigLoading] = useState(true);
  const initializationAttempted = useRef(false);
  const fallbackTimerRef = useRef(null);

  useEffect(() => {
    setParams(readCheckoutParams());
  }, []);

  const { plan, billing } = params;
  console.log("[Checkout] plan=", plan);
  console.log("[Checkout] billing=", billing);

  useEffect(() => {
    if (authLoading || isAuthenticated) return;
    setPendingCheckoutPlan(plan, billing);
    window.location.href = "/login";
  }, [authLoading, billing, isAuthenticated, plan]);

  const planInfo = PLANS_INFO[plan] || PLANS_INFO["all-platforms"];
  const billingInfo = planInfo[billing] || planInfo.annual;
  const isTrialEligible = !checkoutConfigLoading && checkoutConfig?.trial_eligible === true;
  const selectedPriceId = !checkoutConfigLoading
    ? getPaddlePrice({ plan, billing, trialEligible: isTrialEligible })
    : "";
  const checkoutButtonLabel = checkoutConfig?.button_label || (isTrialEligible ? "Start 3-day free trial" : "Subscribe now");
  const trialDays = Number(checkoutConfig?.trial_days || 0);
  const checkoutIntentId = checkoutConfig?.checkout_intent_id || "";
  console.log("[Checkout] selectedPriceId=", selectedPriceId);

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

  useEffect(() => {
    initializationAttempted.current = false;
  }, [checkoutIntentId, selectedPriceId]);

  function getTrialDueDate() {
    const date = new Date();
    date.setDate(date.getDate() + 3);
    return date.toLocaleDateString("en-US", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  }

  const isLocalhost = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
  const isProductionEnv = import.meta.env.VITE_PADDLE_ENVIRONMENT === "production";
  const showLocalhostWarning = isProductionEnv && isLocalhost;

  // Dev-only logs for checkout parameters
  useEffect(() => {
    if (import.meta.env.DEV) {
      console.log("[Checkout] hostname", window.location.hostname);
      console.log("[Checkout] paddle environment", import.meta.env.VITE_PADDLE_ENVIRONMENT);
      console.log("[Checkout] plan", plan);
      console.log("[Checkout] billing", billing);
      console.log("[Checkout] trialEligible", isTrialEligible);
      console.log("[Checkout] selectedPriceId", selectedPriceId);
    }
  }, [plan, billing, isTrialEligible, selectedPriceId]);

  useEffect(() => {
    initializationAttempted.current = false;
  }, [selectedPriceId, plan, billing]);

  useEffect(() => {
    if (showLocalhostWarning) return;
    if (!selectedPriceId || !isAuthenticated || !customerUserId) return;
    if (initializationAttempted.current) return;

    // Check if container exists in DOM
    const container = document.getElementById("paddle-checkout-container");
    if (!container) return;

    initializationAttempted.current = true;
    setLoadingPaddle(true);
    setPaddleLoadError(false);

    if (import.meta.env.DEV) {
      console.log("[Checkout] opening inline checkout");
    }

    openPaddleCheckout({
      priceId: selectedPriceId,
      checkoutConfig,
      checkoutIntentId,
      trialEligible: isTrialEligible,
      plan,
      email: customerEmail || undefined,
      userId: customerUserId,
      billingCycle: billing,
      mode: "inline",
      frameTarget: "paddle-checkout-container",
      onCheckoutComplete: () => {
        setCheckoutSuccess(true);
      },
      onCheckoutClosed: () => {
        initializationAttempted.current = false;
        setLoadingPaddle(false);
      },
      onEvent: (event) => {
        const name = event?.name || event?.event || event?.type;
        if (name === "checkout.loaded") {
          setLoadingPaddle(false);
          if (import.meta.env.DEV) {
            console.log("[Checkout] inline checkout opened");
          }
        }
      }
    }).catch((err) => {
      console.error("[Paddle] Inline checkout failure", err);
      if (import.meta.env.DEV) {
        console.error("[Checkout] checkout error", err.message || err);
      }
      initializationAttempted.current = false;
      setLoadingPaddle(false);
      setPaddleLoadError(true);
    });
  }, [billing, checkoutConfig, checkoutIntentId, customerUserId, isAuthenticated, isTrialEligible, plan, selectedPriceId, showLocalhostWarning, customerEmail]);

  // Handle overlay checkout fallback
  const handleOverlayFallback = async () => {
    if (loadingPaddle || !selectedPriceId) return;
    setLoadingPaddle(true);
    try {
      setCheckoutNotice({
        type: "info",
        message: "Opening secure overlay checkout...",
      });
      await openPaddleCheckout({
        priceId: selectedPriceId,
        checkoutConfig,
        checkoutIntentId,
        trialEligible: isTrialEligible,
        plan,
        email: customerEmail || undefined,
        userId: customerUserId || undefined,
        billingCycle: billing,
        displayMode: "overlay",
        onCheckoutComplete: () => {
          setCheckoutSuccess(true);
        },
        onCheckoutClosed: () => {
          setLoadingPaddle(false);
        },
      });
    } catch (err) {
      console.error("[Paddle] Overlay fallback failure", err);
      if (import.meta.env.DEV) {
        console.error("[Checkout] checkout error", err.message || err);
      }
      setLoadingPaddle(false);
      setCheckoutNotice({
        type: "error",
        message: err.message || "Could not open overlay checkout. Please try again.",
      });
    }
  };

  return (
    <main className="landing-page checkout-page-main">

      <PublicHeader theme={theme} setTheme={setTheme} />

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
                      <span>{trialDays || 3}-Day Free Trial Included</span>
                    </div>
                  )}
                  {checkoutConfigError && (
                    <div className="checkout-trial-warning">
                      <span>{checkoutConfigError}</span>
                    </div>
                  )}
                  <p className="checkout-billing-note">
                    {isTrialEligible
                      ? `3 days free, then ${billingInfo.total} ${billing === "annual" ? "annually" : "monthly"}.`
                      : `You will be charged ${billingInfo.total} today.`}
                  </p>
                </div>


                {/* Plan Card */}
                <div className="checkout-plan-card">
                  <div className="checkout-plan-card-header">
                    <div className="checkout-plan-logo-wrap">
                      {plan === "redbubble" && <Icon name="redbubble" className="checkout-plan-logo" />}
                      {plan === "teepublic" && <Icon name="teepublic" className="checkout-plan-logo" />}
                      {(plan === "all-platforms" || plan === "growth") && (
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
                      {isTrialEligible ? (
                        <>
                          <tr>
                            <td>Subtotal</td>
                            <td className="text-right">{billingInfo.subtotal}</td>
                          </tr>
                          <tr>
                            <td>Free Trial (3 Days)</td>
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


                {/* Prefilled email & Fallbacks */}
                <div className="checkout-footer-meta">
                  {customerEmail && (
                    <div className="checkout-email-badge">
                      <Mail size={14} />
                      <span>Prefilled Customer: {customerEmail}</span>
                    </div>
                  )}

                  <div className="checkout-fallback-wrapper">
                    <p>Having trouble loading the checkout frame?</p>
                    <button
                      type="button"
                      onClick={handleOverlayFallback}
                      disabled={checkoutConfigLoading || loadingPaddle || !selectedPriceId}
                      className="checkout-fallback-btn"
                    >
                      {checkoutConfigLoading || loadingPaddle
                        ? "Preparing secure checkout..."
                        : checkoutButtonLabel}
                    </button>
                  </div>
                </div>
              </div>

              {/* RIGHT COLUMN: PADDLE CHECKOUT CARD */}
              <div className="checkout-right-column">
                <div className="checkout-secure-card" style={{
                  padding: "24px",
                  borderRadius: "16px",
                  background: "var(--pp-card-background, #ffffff)",
                  border: "1px solid var(--pp-card-border, #e5e7eb)",
                  boxShadow: "0 10px 30px -10px rgba(0, 0, 0, 0.08)",
                  display: "flex",
                  flexDirection: "column",
                  minHeight: "650px",
                  position: "relative"
                }}>
                  <style dangerouslySetInnerHTML={{__html: `
                    @keyframes pp-spin {
                      to { transform: rotate(360deg); }
                    }
                  `}} />

                  {/* Card Title */}
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "20px", borderBottom: "1px solid var(--pp-card-border, #e5e7eb)", paddingBottom: "12px" }}>
                    <h3 style={{ fontSize: "18px", fontWeight: "700", margin: 0, color: "var(--pp-text-heading, #1f2937)", display: "flex", alignItems: "center", gap: "8px" }}>
                      <ShieldCheck size={20} style={{ color: "var(--accent, #7c3aed)" }} />
                      Secure checkout
                    </h3>
                  </div>

                  {showLocalhostWarning ? (
                    <div className="paddle-error-state" style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", flex: 1, gap: "12px", padding: "24px", textAlign: "center" }}>
                      <HelpCircle size={36} style={{ color: "var(--pp-text-muted, #9ca3af)" }} />
                      <h4 style={{ fontWeight: 700 }}>Local Testing Restriction</h4>
                      <p style={{ fontSize: "14px", color: "var(--pp-text-muted, #6b7280)", margin: 0, lineHeight: 1.5 }}>
                        Live Paddle checkout must be tested on the approved production domain. Use sandbox locally or test on podpilot.space.
                      </p>
                    </div>
                  ) : !selectedPriceId ? (
                    <div className="paddle-error-state" style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", flex: 1, gap: "12px", padding: "24px", textAlign: "center" }}>
                      <HelpCircle size={36} style={{ color: "var(--pp-text-muted, #9ca3af)" }} />
                      <h4 style={{ fontWeight: 700 }}>Checkout is not configured for this plan yet.</h4>
                      <p style={{ fontSize: "14px", color: "var(--pp-text-muted, #6b7280)", margin: 0 }}>
                        {checkoutConfigError || "Please check back later or contact support."}
                      </p>
                    </div>
                  ) : paddleLoadError ? (
                    <div className="paddle-error-state" style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", flex: 1, gap: "16px", padding: "24px", textAlign: "center" }}>
                      <HelpCircle size={36} style={{ color: "var(--pp-text-muted, #ef4444)" }} />
                      <h4 style={{ fontWeight: 700, margin: 0 }}>Checkout could not load</h4>
                      <p style={{ fontSize: "14px", color: "var(--pp-text-muted, #6b7280)", margin: 0, lineHeight: 1.5 }}>
                        Checkout could not load. Please refresh or contact support.
                      </p>
                      <button
                        type="button"
                        onClick={handleOverlayFallback}
                        disabled={loadingPaddle}
                        className="landing-btn landing-btn-primary"
                        style={{ marginTop: "12px", minHeight: "40px", padding: "0 24px" }}
                      >
                        {loadingPaddle ? "Opening secure checkout..." : "Open secure checkout"}
                      </button>
                    </div>
                  ) : (
                    <div style={{ position: "relative", flex: 1, display: "flex", flexDirection: "column", minHeight: "650px" }}>
                      {loadingPaddle && (
                        <div className="paddle-loading-overlay" style={{
                          position: "absolute",
                          top: 0,
                          left: 0,
                          right: 0,
                          bottom: 0,
                          display: "flex",
                          flexDirection: "column",
                          alignItems: "center",
                          justifyContent: "center",
                          zIndex: 5,
                          background: "var(--pp-card-background, #ffffff)"
                        }}>
                          <div className="spinner" style={{
                            width: "40px",
                            height: "40px",
                            border: "4px solid rgba(124, 58, 237, 0.1)",
                            borderTop: "4px solid var(--accent, #7c3aed)",
                            borderRadius: "50%",
                            animation: "pp-spin 1s linear infinite",
                            marginBottom: "16px"
                          }} />
                          <p style={{ color: "var(--pp-text-muted, #6b7280)", fontWeight: "500", margin: 0 }}>Preparing secure checkout...</p>
                        </div>
                      )}

                      <div
                        id="paddle-checkout-container"
                        className="paddle-checkout-container"
                        style={{
                          width: "100%",
                          minHeight: "650px"
                        }}
                      />
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
