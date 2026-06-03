import { useEffect, useState, useRef } from "react";
import { ArrowLeft, CheckCircle2, ShieldCheck, Check, Sparkles, Mail, HelpCircle } from "lucide-react";
import { useAuth } from "../auth/AuthContext";
import { openPaddleCheckout, isPaddleConfigured } from "../lib/paddle";
import { setPendingCheckoutPlan } from "../lib/pendingCheckout";
import { getTrialEligibility } from "../api/client";
import { PADDLE_CONFIG } from "../config/paddle";
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
  const [trialEligibility, setTrialEligibility] = useState(null);
  const [trialEligibilityError, setTrialEligibilityError] = useState(false);
  const [trialEligibilityLoading, setTrialEligibilityLoading] = useState(true);
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

  const CHECKOUT_PRICE_IDS = {
    redbubble: {
      monthly: PADDLE_CONFIG.prices.redbubble,
      annual: PADDLE_CONFIG.prices.redbubble_annual
    },
    teepublic: {
      monthly: PADDLE_CONFIG.prices.teepublic,
      annual: PADDLE_CONFIG.prices.teepublic_annual
    },
    "all-platforms": {
      monthly: PADDLE_CONFIG.prices.all_platforms,
      annual: PADDLE_CONFIG.prices.all_platforms_annual
    }
  };

  const PAID_CHECKOUT_PRICE_IDS = {
    redbubble: {
      monthly: PADDLE_CONFIG.prices.redbubble_paid,
      annual: ""
    },
    teepublic: {
      monthly: PADDLE_CONFIG.prices.teepublic_paid,
      annual: ""
    },
    "all-platforms": {
      monthly: PADDLE_CONFIG.prices.all_platforms_paid,
      annual: ""
    }
  };

  const planInfo = PLANS_INFO[plan] || PLANS_INFO["all-platforms"];
  const billingInfo = planInfo[billing] || planInfo.annual;
  const isTrialEligible = !trialEligibilityLoading && trialEligibility?.eligible === true && trialEligibility?.reason === "new_user";
  const hasEligibilityDecision = !trialEligibilityLoading;
  const selectedPriceId = hasEligibilityDecision
    ? (
        isTrialEligible
          ? CHECKOUT_PRICE_IDS[plan]?.[billing]
          : (PAID_CHECKOUT_PRICE_IDS[plan]?.[billing] || CHECKOUT_PRICE_IDS[plan]?.[billing])
      ) || ""
    : "";
  console.log("[Checkout] selectedPriceId=", selectedPriceId);

  useSeo({
    title: `Checkout - ${planInfo.name}`,
    description: `Complete your checkout for the PodPilot ${planInfo.name}. Secure online payment processed via Paddle.`,
    canonical: "/checkout",
    noindex: true,
  });



  // Request trial eligibility on mount
  useEffect(() => {
    if (!customerUserId) {
      setTrialEligibilityLoading(false);
      return;
    }

    let active = true;
    const checkEligibility = async () => {
      try {
        setTrialEligibilityLoading(true);
        setTrialEligibilityError(false);
        const data = await getTrialEligibility();
        if (active) {
          setTrialEligibility(data);
          setTrialEligibilityLoading(false);
        }
      } catch (err) {
        console.warn("[Checkout] Trial eligibility check failed:", err);
        if (active) {
          setTrialEligibilityError(true);
          setTrialEligibilityLoading(false);
        }
      }
    };

    checkEligibility();
    return () => {
      active = false;
    };
  }, [customerUserId]);

  function getTrialDueDate() {
    const date = new Date();
    date.setDate(date.getDate() + 3);
    return date.toLocaleDateString("en-US", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  }

  // Run checkout opening
  useEffect(() => {
    if (!selectedPriceId || !isAuthenticated || !customerUserId) return;

    const target = document.querySelector(".paddle-checkout-frame");
    console.log("[Checkout] inline useEffect running");
    console.log("[Checkout] selectedPriceId=", selectedPriceId);
    console.log("[Paddle] frame target found=", Boolean(target));

    if (!target) return;

    openPaddleCheckout({
      priceId: selectedPriceId,
      plan,
      email: userEmail,
      userId: customerUserId,
      billingCycle: billing,
      mode: "inline",
      frameTarget: "paddle-checkout-frame"
    }).catch((err) => {
      console.error("[Paddle] Inline checkout failure", err);
      setPaddleLoadError(true);
      setCheckoutNotice({
        type: "error",
        message: err.message || "Could not open checkout. Please try again.",
      });
    });
  }, [billing, customerUserId, isAuthenticated, plan, selectedPriceId, userEmail]);



  // Handle overlay checkout fallback
  const handleOverlayFallback = async () => {
    try {
      setCheckoutNotice({
        type: "info",
        message: "Opening secure overlay checkout...",
      });
      await openPaddleCheckout({
        priceId: selectedPriceId,
        plan,
        email: customerEmail || undefined,
        userId: customerUserId || undefined,
        billingCycle: billing,
        displayMode: "overlay",
        onCheckoutComplete: () => {
          setCheckoutSuccess(true);
        },
      });
    } catch (err) {
      console.error("[Paddle] Overlay fallback failure", err);
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
                      <span>3-Day Free Trial Included</span>
                    </div>
                  )}
                  {trialEligibilityError && (
                    <div className="checkout-trial-warning">
                      <span>Could not verify trial eligibility. Standard checkout shown.</span>
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
                      disabled={trialEligibilityLoading || !selectedPriceId}
                      className="checkout-fallback-btn"
                    >
                      {trialEligibilityLoading
                        ? "Preparing secure checkout..."
                        : isTrialEligible
                          ? "Start your free trial in secure checkout"
                          : "Continue to checkout"}
                    </button>
                  </div>
                </div>
              </div>

              {/* RIGHT COLUMN: PADDLE FRAME */}
              <div className="checkout-right-column">
                <div className="paddle-checkout-frame-wrapper" style={{ position: "relative" }}>
                  <div className="paddle-checkout-frame" style={{ minHeight: 450, width: "100%" }} />


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
                      <p>Try opening the secure overlay checkout instead if the payment form fails to appear.</p>
                      <button
                        type="button"
                        onClick={handleOverlayFallback}
                        className="landing-btn landing-btn-primary"
                        style={{ marginTop: "12px", minHeight: "38px", padding: "0 16px" }}
                      >
                        Open Secure Overlay Checkout
                      </button>
                    </div>
                  )}

                  {trialEligibilityLoading && (
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

                  {!trialEligibilityLoading && !selectedPriceId && (
                    <div className="paddle-error-state">
                      <HelpCircle size={36} />
                      <h4>Missing Paddle price ID for this plan.</h4>
                    </div>
                  )}

                  {!trialEligibilityLoading && !paddleReady && selectedPriceId && (
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
