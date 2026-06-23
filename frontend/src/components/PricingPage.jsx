import { useEffect, useState } from "react";
import { CheckCircle2, ShieldCheck, HelpCircle, ArrowRight, Gift } from "lucide-react";
import { useAuth } from "../auth/AuthContext";
import Icon from "./Icon";
import { LandingButton, LogoMark, UserMenu } from "./LandingPage";
import { openPaddleCheckout, isPaddleConfigured, isAnnualPaddleConfigured } from "../lib/paddle";
import { setPendingCheckoutPlan } from "../lib/pendingCheckout";
import PublicHeader from "./PublicHeader";
import PublicFooter from "./PublicFooter";
import { useSeo } from "../utils/useSeo";
import { getCheckoutConfig, getMySubscription, getTrialEligibility } from "../api/client";

const authHref = "/dashboard";

const publicNavItems = [
  { label: "How It Works", href: "/#how-it-works" },
  { label: "Features", href: "/#features" },
  { label: "Pricing", href: "/pricing" },
  { label: "FAQ", href: "/pricing#faq" },
  { label: "Contact", href: "/contact" },
  { label: "Privacy", href: "/privacy" },
  { label: "Terms", href: "/terms" },
];

const pricingPlans = [
  {
    name: "Redbubble",
    planId: "redbubble",
    price: "$4.99/month",
    details: [
      "Unlimited Redbubble upload automation",
      "Fast Redbubble upload workflow",
      "AI listing drafts for titles, tags, and descriptions",
      "AI copyright review",
      "Trademark Check",
      "30 Daily AI Tokens",
      "Support when you need help",
    ],
  },
  {
    name: "Redbubble + TeePublic",
    planId: "all_platforms",
    price: "$6.99/month",
    badge: "Best for bulk sellers",
    workflowBadge: "Faster bulk workflow",
    details: [
      "Unlimited Redbubble and TeePublic upload automation",
      "Priority fast upload workflow for bulk sellers",
      "AI listing drafts for both platforms",
      "AI copyright review",
      "Trademark Check",
      "75 Daily AI Tokens",
      "Priority support for multi-platform workflows",
    ],
    featured: true,
  },
  {
    name: "TeePublic",
    planId: "teepublic",
    price: "$4.99/month",
    details: [
      "Unlimited TeePublic upload automation",
      "Fast TeePublic upload workflow",
      "AI listing drafts for titles, tags, and descriptions",
      "AI copyright review",
      "Trademark Check",
      "30 Daily AI Tokens",
      "Support when you need help",
    ],
  },
];

const faqs = [
  {
    question: "Which plan should I choose?",
    answer: "Choose Redbubble or TeePublic if you only upload to one marketplace. Choose Redbubble + TeePublic if you sell on both and want one workflow for both platforms, plus more daily AI tokens.",
  },
  {
    question: "Do the plans limit uploads?",
    answer: "No. All plans include unlimited upload automation for the platforms included in your plan. PodPilot prepares the queue and helps fill the marketplace forms through your browser session.",
  },
  {
    question: "Can my team use one subscription?",
    answer: "Each subscription is intended for one account session. You can still manage your design files, imports, and upload batches from one dashboard.",
  },
  {
    question: "What does the browser extension do?",
    answer: "The extension helps upload prepared listings through your own Chrome or Brave browser session. PodPilot does not need your marketplace passwords.",
  },
  {
    question: "Do you offer a money-back guarantee?",
    answer: "Yes. If PodPilot is not a fit, contact support within 7 days of your purchase and we will refund your payment.",
  },
];

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

const aiCreditPacks = [


  {
    id: "ai_credits_250",
    credits: 250,
    label: "250 AI Listing Credits",
    price: "$1.99",
    description: "Extra credits for AI listing drafts",
  },
  {
    id: "ai_credits_500",
    credits: 500,
    label: "500 AI Listing Credits",
    price: "$2.99",
    badge: "Starter",
    description: "Extra credits for AI listing drafts",
  },
  {
    id: "ai_credits_1000",
    credits: 1000,
    label: "1,000 AI Listing Credits",
    price: "$4.99",
    badge: "Popular",
    description: "Extra credits for AI listing drafts",
  },
  {
    id: "ai_credits_2500",
    credits: 2500,
    label: "2,500 AI Listing Credits",
    price: "$11.99",
    description: "Extra credits for AI listing drafts",
  },
  {
    id: "ai_credits_5000",
    credits: 5000,
    label: "5,000 AI Listing Credits",
    price: "$21.99",
    description: "Extra credits for AI listing drafts",
  },
  {
    id: "ai_credits_10000",
    credits: 10000,
    label: "10,000 AI Listing Credits",
    price: "$39.99",
    badge: "Best Value",
    description: "Extra credits for AI listing drafts",
  },
];

export default function PricingPage({ theme, setTheme, subscriptionSummary }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [billingInterval, setBillingInterval] = useState("annual"); // Default to annual per MerchGhost spec
  const [checkoutPlan, setCheckoutPlan] = useState(null);
  const [checkoutNotice, setCheckoutNotice] = useState(null);
  const [openFaq, setOpenFaq] = useState(0);
  const [subscription, setSubscription] = useState(subscriptionSummary || null);
  const [loadingSubscription, setLoadingSubscription] = useState(false);
  const [trialEligibility, setTrialEligibility] = useState(null);

  useEffect(() => {
    if (subscriptionSummary) {
      setSubscription(subscriptionSummary);
    }
  }, [subscriptionSummary]);

  const auth = useAuth();
  const customerEmail = auth?.user?.email || "";
  const customerUserId = auth?.user?.id || "";
  const customerCountryCode = countryCodeFromUser(auth?.user);
  const isAuthenticated = Boolean(auth?.user);
  const signOut = auth?.signOut;
  const paddleReady = isPaddleConfigured();

  useSeo({
    title: "Pricing for Redbubble & TeePublic Upload Automation",
    description: "Choose a PodPilot plan for Redbubble, TeePublic, or both. Eligible accounts may see a trial offer, with upload automation and AI listing tools for POD sellers.",
    canonical: "/pricing",
    jsonLd: {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      "@id": "https://podpilot.space/pricing#faq",
      mainEntity: faqs.map((faq) => ({
        "@type": "Question",
        name: faq.question,
        acceptedAnswer: {
          "@type": "Answer",
          text: faq.answer,
        },
      })),
    },
  });

  // Scroll to hash on load and hash change
  useEffect(() => {
    function scrollToHash() {
      if (window.location.hash) {
        const hash = window.location.hash;
        const element = document.querySelector(hash);
        if (element) {
          setTimeout(() => {
            element.scrollIntoView({ behavior: "smooth", block: "start" });
          }, 150);
        }
      }
    }

    scrollToHash();

    window.addEventListener("hashchange", scrollToHash);
    return () => window.removeEventListener("hashchange", scrollToHash);
  }, []);

  useEffect(() => {
    if (!isAuthenticated) return;
    let isMounted = true;
    setLoadingSubscription(true);
    Promise.allSettled([getMySubscription(), getTrialEligibility({ force: true })])
      .then(([subscriptionResult, trialResult]) => {
        if (isMounted) {
          if (subscriptionResult.status === "fulfilled") {
            setSubscription(subscriptionResult.value);
          } else {
            console.warn("[PricingPage] fetch subscription failed:", subscriptionResult.reason);
          }
          if (trialResult.status === "fulfilled") {
            setTrialEligibility(trialResult.value || null);
          } else {
            console.warn("[PricingPage] fetch trial eligibility failed:", trialResult.reason);
            setTrialEligibility({ eligible: false, reason: "unknown", source: "unknown" });
          }
        }
      })
      .finally(() => {
        if (isMounted) {
          setLoadingSubscription(false);
        }
      });
    return () => {
      isMounted = false;
    };
  }, [isAuthenticated]);

  function closeMobileMenu() {
    setMobileOpen(false);
  }

  function dismissNotice() {
    setCheckoutNotice(null);
  }

  async function handleStartCheckout(planId) {
    if (!planId || checkoutPlan) return;
    setCheckoutPlan(planId);
    
    // Use the public slug for the All Platforms checkout URL.
    const urlPlan = planId === "all_platforms" ? "all-platforms" : planId;
    window.location.href = `/checkout?plan=${urlPlan}&billing=${billingInterval}`;
  }

  async function handleBuyAiCredits(packId) {
    if (!packId || checkoutPlan) return;
    if (!isAuthenticated || !customerUserId) {
      setCheckoutNotice({
        type: "error",
        message: "Please sign in before buying AI listing credits.",
      });
      return;
    }
    setCheckoutPlan(packId);
    try {
      const data = await getCheckoutConfig({
        intent_type: "ai_credits",
        credit_pack_id: packId,
      });
      await openPaddleCheckout({
        priceId: data?.selected_price_id || data?.price_id,
        checkoutConfig: data,
        checkoutIntentId: data?.checkout_intent_id,
        creditPackId: data?.credit_pack_id || packId,
        plan: data?.credit_pack_id || packId,
        email: customerEmail || undefined,
        countryCode: customerCountryCode,
        userId: customerUserId,
        onCheckoutComplete: () => {
          setCheckoutNotice({
            type: "success",
            message: "AI credits purchased. We are syncing your account...",
          });
        },
        onCheckoutClosed: () => {
          setCheckoutPlan(null);
        },
      });
    } catch (err) {
      console.warn("[PricingPage] AI credits checkout failed:", err?.message || err);
      setCheckoutPlan(null);
      setCheckoutNotice({
        type: "error",
        message: err?.response?.data?.detail || err?.message || "Could not open AI credits checkout.",
      });
    }
  }

  // Never infer a trial while auth or eligibility is unresolved. The backend
  // response is the only authority that can reveal trial messaging.
  const eligibilityLoaded = isAuthenticated && !loadingSubscription && trialEligibility !== null;
  const showTrialOffer = eligibilityLoaded
    && (trialEligibility?.trial_eligible === true || trialEligibility?.eligible === true);

  return (
    <main className="landing-page pricing-page">
      <PublicHeader
        theme={theme}
        setTheme={setTheme}
        guestCtaLabel={showTrialOffer ? "Start your 7-day free trial" : (eligibilityLoaded ? "Subscribe now" : "Continue")}
      />

      {/* Hero Header Section */}
      <section className="pricing-hero">
        <div className="pricing-hero-inner">
          <div className="pricing-kicker">
            <span>Pricing for POD sellers</span>
          </div>
          <h1>Choose the platforms you upload to</h1>
          <p>
            Start with Redbubble, TeePublic, or both. Every plan includes bulk upload automation, AI listing tools, trademark checks, and a browser-based workflow with no marketplace passwords stored.
          </p>
        </div>
      </section>

      {/* Subscription Cards & Toggle */}
      <section className="landing-section" style={{ padding: "0 0 56px 0" }}>
        <div className="landing-container">
          <div className="landing-billing-toggle-container">
            <div className="landing-billing-toggle">
              <button
                type="button"
                className={`landing-billing-toggle-btn ${billingInterval === "monthly" ? "active" : ""}`}
                onClick={() => setBillingInterval("monthly")}
              >
                Monthly
              </button>
              <button
                type="button"
                className={`landing-billing-toggle-btn ${billingInterval === "annual" ? "active" : ""}`}
                onClick={() => setBillingInterval("annual")}
              >
                Annual (Save 15%)
              </button>
            </div>
            {billingInterval === "annual" && (
              <>
                <span className="landing-billing-toggle-badge">
                  2 months free
                </span>
                <span className="landing-billing-toggle-badge">
                  Best Value
                </span>
              </>
            )}
          </div>

          <div className="landing-pricing-grid">
            {pricingPlans.map((plan) => {
              const isAnnual = billingInterval === "annual";
              const priceText = isAnnual
                ? (plan.planId === "all_platforms" ? "$5.83" : "$4.16")
                : (plan.planId === "all_platforms" ? "$6.99" : "$4.99");
              const subLabel = isAnnual ? "Billed annually" : "Billed monthly";

              const isConfigured = isAnnual
                ? (paddleReady && isAnnualPaddleConfigured(plan.planId))
                : paddleReady;

              const isLoading = checkoutPlan === plan.planId;
              const isCurrentPlan = subscription?.has_subscription && (
                subscription.plan?.toLowerCase() === plan.planId?.toLowerCase() ||
                (subscription.plan?.toLowerCase() === "all_platforms" && plan.planId?.toLowerCase() === "all_platforms")
              );

              const disabled = (Boolean(checkoutPlan) && !isLoading) || !isConfigured;

              const yearlyTotal = plan.planId === "all_platforms" ? "$69.90" : "$49.90";
              const subscribeLabel = !eligibilityLoaded
                ? "Continue"
                : (showTrialOffer ? "Start your 7-day free trial" : "Subscribe now");
              const buttonText = isAnnual
                ? (!isAnnualPaddleConfigured(plan.planId)
                    ? "Coming soon"
                    : (isLoading ? "Opening checkout..." : (!eligibilityLoaded ? "Continue" : (showTrialOffer ? `Start trial - ${yearlyTotal}/year` : `Subscribe - ${yearlyTotal}/year`))))
                : (isLoading ? "Opening checkout..." : subscribeLabel);

              return (
                <article className={`landing-pricing-card${plan.featured ? " is-featured" : ""}`} key={plan.name}>
                  <div className="landing-pricing-card-head">
                    <div>
                      <div className="landing-plan-title-with-logos">
                        <h3 style={{ whiteSpace: "nowrap" }}>{plan.name}</h3>
                        {plan.planId === "redbubble" && (
                          <Icon name="redbubble" className="landing-plan-title-logo" />
                        )}
                        {plan.planId === "teepublic" && (
                          <Icon name="teepublic" className="landing-plan-title-logo" />
                        )}
                        {plan.planId === "all_platforms" && (
                          <div className="landing-plan-title-logos-group">
                            <Icon name="redbubble" className="landing-plan-title-logo" />
                            <Icon name="teepublic" className="landing-plan-title-logo" />
                          </div>
                        )}
                      </div>
                      {plan.subtitle && <span className="landing-plan-subtitle">{plan.subtitle}</span>}
                    </div>
                    {plan.badge && (
                      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "6px" }}>
                        <span className="landing-plan-badge">{plan.badge}</span>
                        {plan.planId === "all_platforms" && (
                          <div style={{ display: "flex", justifyContent: "flex-end", gap: "6px", flexWrap: "wrap", maxWidth: "190px" }}>
                            {plan.workflowBadge && (
                              <span style={{
                                fontSize: "10px",
                                fontWeight: "700",
                                color: "#6d28d9",
                                backgroundColor: "rgba(124, 58, 237, 0.12)",
                                border: "1px solid rgba(124, 58, 237, 0.25)",
                                padding: "2px 8px",
                                borderRadius: "9999px",
                                whiteSpace: "nowrap",
                              }}>
                                {plan.workflowBadge}
                              </span>
                            )}
                            <span style={{
                              fontSize: "10px",
                              fontWeight: "700",
                              color: "#0d9488",
                              backgroundColor: "rgba(13, 148, 136, 0.1)",
                              border: "1px solid rgba(13, 148, 136, 0.25)",
                              padding: "2px 8px",
                              borderRadius: "9999px",
                              whiteSpace: "nowrap",
                            }}>
                              Save vs separate plans
                            </span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                  <strong>{priceText}<span className="landing-price-period"> /month</span></strong>
                  <span className="landing-plan-subtitle">{subLabel}</span>
                  {isAnnual ? (
                    <div className="landing-plan-total-line">
                      {yearlyTotal}/year total
                    </div>
                  ) : (
                    <div className="landing-plan-total-line" style={{ visibility: "hidden" }}>
                      &nbsp;
                    </div>
                  )}

                  {/* Highlighted Trial Line */}
                  {showTrialOffer && (
                    <div className="landing-pricing-trial-highlight" style={{
                      display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "8px",
                    marginTop: "14px",
                    marginBottom: "12px",
                    padding: "8px 12px",
                    borderRadius: "8px",
                    fontSize: "14px",
                    fontWeight: "700",
                    background: plan.featured 
                      ? "var(--accent-soft, rgba(124, 58, 237, 0.10))"
                      : "rgba(124, 58, 237, 0.04)",
                    border: plan.featured
                      ? "1px solid var(--accent-border, rgba(124, 58, 237, 0.25))"
                      : "1px dashed rgba(124, 58, 237, 0.15)",
                    color: "var(--accent, #7c3aed)",
                    boxShadow: plan.featured ? "0 4px 12px rgba(124, 58, 237, 0.08)" : "none"
                    }}>
                      <Gift size={16} className="animate-pulse" style={{ color: "var(--accent, #7c3aed)", flexShrink: 0 }} />
                      <span>7-day free trial included</span>
                    </div>
                  )}

                  <ul>
                    {plan.details.map((detail) => (
                      <li key={detail}>
                        <Icon name="check" />
                        <span>{detail}</span>
                      </li>
                    ))}
                  </ul>
                  {isCurrentPlan ? (
                    <button
                      type="button"
                      className="landing-btn landing-btn-current-plan"
                      disabled={true}
                    >
                      <Icon name="check" style={{ marginRight: "8px" }} />
                      <span>Your Current Plan</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      className={`landing-btn landing-btn-${plan.featured ? "primary" : "secondary"}`}
                      onClick={() => handleStartCheckout(plan.planId)}
                      disabled={disabled || isLoading}
                      aria-busy={isLoading || undefined}
                      title={isAnnual && !isAnnualPaddleConfigured(plan.planId) ? "Annual billing coming soon" : (!paddleReady ? "Checkout temporarily unavailable" : undefined)}
                    >
                      {plan.featured && !isLoading && (
                        <span className="landing-btn-icon-bubble" aria-hidden="true">
                          <span className="landing-btn-svg landing-btn-gift" />
                          <span className="landing-btn-svg landing-btn-sparkle" />
                        </span>
                      )}
                      <span>{buttonText}</span>
                      {!isLoading && (
                        plan.featured ? (
                          <span className="landing-btn-svg landing-btn-arrow" aria-hidden="true" />
                        ) : (
                          <Icon name="chevronRight" />
                        )
                      )}
                    </button>
                  )}
                </article>
              );
            })}
          </div>
        </div>
      </section>

      {/* AI Listing Credits Section */}
      <section className="pricing-tokens-section" id="ai-listing-credits">
        <div className="pricing-tokens-card">
          <div className="pricing-tokens-header">
            <div className="pricing-tokens-badge">
              <Icon name="sparkle" style={{ width: "12px", height: "12px", strokeWidth: 2.2 }} />
              <span>AI LISTING CREDITS</span>
            </div>
            <h2>Need more AI listing credits?</h2>
            <p>
              Add one-time credits when you want more AI title, description, and tag drafts after your daily allowance runs out.
            </p>
          </div>

          <div className="pricing-tokens-grid">
            {aiCreditPacks.map((pack) => {
              const badgeClass = pack.badge ? pack.badge.toLowerCase().replace(" ", "-") : "";
              return (
                <article className="pricing-tokens-item" key={pack.id}>
                  <div className="pricing-tokens-item-head">
                    <div className="pricing-tokens-item-head-title-group">
                      <strong>{pack.label}</strong>
                      {pack.badge && (
                        <span className={`pricing-tokens-item-badge ${badgeClass}`}>
                          {pack.badge}
                        </span>
                      )}
                    </div>
                    <span className="pricing-tokens-item-price">{pack.price}</span>
                  </div>
                  <div className="pricing-tokens-item-desc">
                    {pack.description}
                  </div>
                  <button
                    type="button"
                    className="landing-btn landing-btn-secondary"
                    onClick={() => handleBuyAiCredits(pack.id)}
                    disabled={Boolean(checkoutPlan)}
                    aria-busy={checkoutPlan === pack.id || undefined}
                  >
                    <span>{checkoutPlan === pack.id ? "Opening checkout..." : "Buy now"}</span>
                    {checkoutPlan !== pack.id && <Icon name="chevronRight" />}
                  </button>
                </article>
              );
            })}
          </div>
        </div>
      </section>
      {/* 7-Day Money-Back Guarantee Section */}
      <section className="pricing-guarantee-container">
        <div className="pricing-guarantee-card">
          <div className="pricing-guarantee-icon-wrapper">
            <ShieldCheck size={28} strokeWidth={2} />
          </div>
          <div className="pricing-guarantee-content">
            <h2>7-Day Money-Back Guarantee</h2>
            <p>
              Try PodPilot with your own upload workflow. If it is not a fit, contact support within 7 days of your initial payment for a full refund.
            </p>
            <div className="pricing-guarantee-checkmarks">
              <div className="pricing-guarantee-check-item">
                <CheckCircle2 size={16} />
                <span>Full refund within 7 days</span>
              </div>
              <div className="pricing-guarantee-check-item">
                <CheckCircle2 size={16} />
                <span>Simple support request</span>
              </div>
              <div className="pricing-guarantee-check-item">
                <CheckCircle2 size={16} />
                <span>No long cancellation process</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Accordion FAQ Section */}
      <section className="pricing-faq-section" id="faq">
        <div className="pricing-faq-heading">
          <h2>Pricing questions</h2>
          <p>Clear answers before you choose a PodPilot plan.</p>
        </div>

        <div className="pricing-faq-list">
          {faqs.map((faq, index) => {
            const isOpen = openFaq === index;
            return (
              <div className={`pricing-faq-item${isOpen ? " is-open" : ""}`} key={faq.question}>
                <button
                  type="button"
                  onClick={() => setOpenFaq(isOpen ? -1 : index)}
                  aria-expanded={isOpen}
                >
                  <span>{faq.question}</span>
                  <Icon name="chevronDown" />
                </button>
                <div className="pricing-faq-answer">
                  <div className="pricing-faq-answer-inner">
                    <p>{faq.answer}</p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="pricing-faq-cta-card">
          <span>Not sure which plan fits your upload workflow?</span>
          <a href="/contact" className="landing-btn landing-btn-primary">
            <span>Ask Support</span>
            <ArrowRight size={16} strokeWidth={2} style={{ marginLeft: "4px" }} />
          </a>
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
          <button type="button" onClick={dismissNotice} aria-label="Dismiss">
            <Icon name="x" />
          </button>
        </div>
      )}

      {/* Footer */}
      <PublicFooter />
    </main>
  );
}
