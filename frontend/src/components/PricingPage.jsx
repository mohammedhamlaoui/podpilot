import { useEffect, useState } from "react";
import { CheckCircle2, ShieldCheck, ArrowRight, Info, WandSparkles, LockKeyhole, CreditCard } from "lucide-react";
import { useAuth } from "../auth/AuthContext";
import Icon from "./Icon";
import { openPaddleCheckout, isPaddleConfigured } from "../lib/paddle";
import PublicHeader from "./PublicHeader";
import PublicFooter from "./PublicFooter";
import { useSeo } from "../utils/useSeo";
import { getCheckoutConfig, getMySubscription } from "../api/client";
import { GUARANTEE_CONFIRMED, SUBSCRIPTION_PRICES, formatUsd } from "../config/commercial";

const pricingPlans = [
  {
    name: "Redbubble",
    planId: "redbubble",
    subtitle: "For your Redbubble workflow",
    description: "Prepare listings and keep Redbubble uploads organized in one place.",
    details: [
      "Unlimited Redbubble upload automation",
      "Redbubble upload queue management",
      "AI listing drafts for titles, tags, and descriptions",
      "AI copyright review",
      "Trademark Check",
      "30 Daily AI Tokens",
      "Account and subscription management",
    ],
  },
  {
    name: "Redbubble + TeePublic",
    planId: "all_platforms",
    subtitle: "For both marketplaces",
    description: "One workspace for your designs, listings, and queues across both platforms.",
    details: [
      "Unlimited Redbubble and TeePublic upload automation",
      "Upload queues for both platforms",
      "AI listing drafts for both platforms",
      "AI copyright review",
      "Trademark Check",
      "75 Daily AI Tokens",
      "Account and subscription management",
    ],
    featured: true,
  },
  {
    name: "TeePublic",
    planId: "teepublic",
    subtitle: "For your TeePublic workflow",
    description: "Keep TeePublic listings prepared and your upload queue moving.",
    details: [
      "Unlimited TeePublic upload automation",
      "TeePublic upload queue management",
      "AI listing drafts for titles, tags, and descriptions",
      "AI copyright review",
      "Trademark Check",
      "30 Daily AI Tokens",
      "Account and subscription management",
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
    answer: "Each subscription supports one active upload device at a time. You can switch devices when needed; starting on a new device disconnects upload control on the previous one.",
  },
  {
    question: "What does the browser extension do?",
    answer: "The extension helps upload prepared listings through your own Chrome or Brave browser session. PodPilot does not need your marketplace passwords.",
  },
  { question: "Is there a free trial?", answer: "No. New subscriptions are charged at checkout. You can choose monthly or annual billing before you pay." },
  { question: "Can I cancel anytime?", answer: "Yes. You can manage cancellation in your Paddle billing portal. Cancellation stops future renewal charges; current paid access continues until the period ends." },
  { question: "Does cancellation request a refund?", answer: "No. Cancellation and a refund request are separate actions. See the Refund Policy or contact support for a refund request." },
  { question: "What payment methods are supported?", answer: "Available payment methods are shown by Paddle at checkout and can vary by location and device." },
  { question: "Can I change plans?", answer: "Contact support if you want to change plan or billing cycle. We will confirm the available change and any billing effect before it takes effect." },
  { question: "Are AI credits limited?", answer: "Redbubble and TeePublic plans include 30 daily AI tokens; the combined plan includes 75. Optional one-time AI listing credit packs are sold separately." },
  ...(GUARANTEE_CONFIRMED ? [
    { question: "What is the 3-day money-back guarantee?", answer: "For a first subscription purchase, request a refund within 72 hours of the successful payment. Read the Refund Policy for the request process. This voluntary guarantee does not limit mandatory consumer rights." },
    { question: "How do I request a refund?", answer: "Email support@podpilot.space with your account email and Paddle receipt or contact Paddle buyer support. A cancellation alone does not submit a refund request." },
    { question: "What happens after the first 3 days?", answer: "The voluntary satisfaction guarantee ends, but applicable statutory withdrawal and refund rights and Paddle's refund procedures may still apply." },
    { question: "What happens after a refund?", answer: "Paddle processes approved refunds. Access linked to a fully refunded subscription ends when the related subscription is cancelled." },
  ] : [
    { question: "How do refunds work?", answer: "Refund requests are handled through Paddle. Contact support@podpilot.space or Paddle buyer support. Applicable statutory rights are preserved; see the Refund Policy." },
  ]),
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
    description: "One-time credits for AI titles, descriptions, and tags.",
  },
  {
    id: "ai_credits_500",
    credits: 500,
    label: "500 AI Listing Credits",
    price: "$2.99",
    badge: "Starter",
    description: "One-time credits for AI titles, descriptions, and tags.",
  },
  {
    id: "ai_credits_1000",
    credits: 1000,
    label: "1,000 AI Listing Credits",
    price: "$4.99",
    badge: "Popular",
    description: "One-time credits for AI titles, descriptions, and tags.",
  },
  {
    id: "ai_credits_2500",
    credits: 2500,
    label: "2,500 AI Listing Credits",
    price: "$11.99",
    description: "One-time credits for AI titles, descriptions, and tags.",
  },
  {
    id: "ai_credits_5000",
    credits: 5000,
    label: "5,000 AI Listing Credits",
    price: "$21.99",
    description: "One-time credits for AI titles, descriptions, and tags.",
  },
  {
    id: "ai_credits_10000",
    credits: 10000,
    label: "10,000 AI Listing Credits",
    price: "$39.99",
    badge: "Best Value",
    description: "One-time credits for AI titles, descriptions, and tags.",
  },
];

const visibleAiCreditPacks = aiCreditPacks.filter((pack) => [1000, 10000].includes(pack.credits));

export default function PricingPage({ theme, setTheme, subscriptionSummary }) {
  const [billingInterval, setBillingInterval] = useState("annual");
  const [checkoutPlan, setCheckoutPlan] = useState(null);
  const [checkoutNotice, setCheckoutNotice] = useState(null);
  const [openFaq, setOpenFaq] = useState(0);
  const [subscription, setSubscription] = useState(subscriptionSummary || null);

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
  const paddleReady = isPaddleConfigured();

  useSeo({
    title: "PodPilot Pricing - Upload Automation for POD Sellers",
    description: "Choose a PodPilot plan for Redbubble and TeePublic upload automation, AI listing drafts, and print-on-demand workflow management.",
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
    getMySubscription()
      .then((value) => {
        if (isMounted) setSubscription(value);
      })
      .catch((error) => {
        console.warn("[PricingPage] fetch subscription failed:", error);
      });
    return () => {
      isMounted = false;
    };
  }, [isAuthenticated]);

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

  return (
    <main className="landing-page pricing-page">
      <PublicHeader
        theme={theme}
        setTheme={setTheme}
        guestCtaLabel="View plans"
      />

      {/* Hero Header Section */}
      <section className="pricing-hero">
        <div className="pricing-hero-inner">
          <div className="pricing-kicker">
            <span>Pricing for POD sellers</span>
          </div>
          <h1>More creating. <span>Less repeating.</span></h1>
          <p>
            Keep your designs, listing details, and upload queues together. Choose one marketplace or work across Redbubble and TeePublic from the same PodPilot workspace.
          </p>
          <a href="#top-plans" className="landing-btn landing-btn-primary">Find your plan <ArrowRight size={17} /></a>
        </div>
      </section>

      {/* Subscription Cards & Toggle */}
      <section className="landing-section pricing-subscriptions">
        <div className="landing-container">
          <div className="pricing-plans-intro">
            <span className="relaunch-eyebrow">Plans built around your workflow</span>
            <h2>Choose where you publish.</h2>
            <p>Every plan includes design organization, AI listing tools, and upload automation for its marketplaces.</p>
          </div>
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
                Annual (Save 16.67%)
              </button>
            </div>
            {billingInterval === "annual" && (
              <span className="landing-billing-toggle-badge">
                Two months included
              </span>
            )}
          </div>

          <div className="landing-pricing-grid" id="top-plans">
            {pricingPlans.map((plan) => {
              const isAnnual = billingInterval === "annual";
              const priceText = isAnnual
                ? formatUsd(SUBSCRIPTION_PRICES[plan.planId].annual / 12)
                : formatUsd(SUBSCRIPTION_PRICES[plan.planId].monthly);
              const subLabel = isAnnual ? "Billed annually" : "Billed monthly";

              const isConfigured = paddleReady;

              const isLoading = checkoutPlan === plan.planId;
              const isCurrentPlan = subscription?.has_active_subscription && (
                subscription.plan?.toLowerCase() === plan.planId?.toLowerCase() ||
                (subscription.plan?.toLowerCase() === "all_platforms" && plan.planId?.toLowerCase() === "all_platforms")
              );

              const disabled = (Boolean(checkoutPlan) && !isLoading) || !isConfigured;

              const yearlyTotal = formatUsd(SUBSCRIPTION_PRICES[plan.planId].annual);
              const buttonText = isLoading
                ? "Opening checkout..."
                : (isAnnual ? `Subscribe - ${yearlyTotal}/year` : "Subscribe now");

              return (
                <article className={`landing-pricing-card${plan.featured ? " is-featured" : ""}`} key={plan.name}>
                  {plan.featured && <span className="pricing-popular-banner">Most popular <WandSparkles size={15} aria-hidden="true" /></span>}
                  <div className="landing-pricing-card-head">
                    <div>
                      <div className="landing-plan-title-with-logos">
                        <h3>{plan.name}</h3>
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
                  </div>
                  <p className="pricing-plan-description">{plan.description}</p>
                  <strong>{priceText}<span className="landing-price-period"> /month</span></strong>
                  <span className="landing-plan-subtitle">{subLabel}</span>
                  {isAnnual && (
                    <div className="landing-plan-total-line">
                      {yearlyTotal}/year total
                    </div>
                  )}
                  {isCurrentPlan ? (
                    <button
                      type="button"
                      className="landing-btn landing-btn-current-plan pricing-plan-cta"
                      disabled={true}
                    >
                      <Icon name="check" style={{ marginRight: "8px" }} />
                      <span>Your Current Plan</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      className={`landing-btn landing-btn-${plan.featured ? "primary" : "secondary"} pricing-plan-cta`}
                      onClick={() => handleStartCheckout(plan.planId)}
                      disabled={disabled || isLoading}
                      aria-busy={isLoading || undefined}
                      title={!paddleReady ? "Checkout temporarily unavailable" : undefined}
                    >
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

                  {GUARANTEE_CONFIRMED && (
                    <p className="pricing-plan-reassurance"><ShieldCheck size={16} /> 3-day money-back guarantee</p>
                  )}

                  <ul>
                    {plan.details.map((detail) => (
                      <li key={detail}>
                        <Icon name="check" />
                        <span>{detail}</span>
                      </li>
                    ))}
                  </ul>
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
            <div className="pricing-tokens-label-row">
              <div className="pricing-tokens-badge">
                <Icon name="sparkle" style={{ width: "12px", height: "12px", strokeWidth: 2.2 }} />
                <span>AI LISTING CREDITS</span>
              </div>
              <button
                type="button"
                className="pricing-guarantee-info pricing-tokens-info"
                aria-label="How AI Listing Credits work"
                aria-describedby="ai-listing-credit-explanation"
              >
                <Info size={14} strokeWidth={2.3} />
                <span
                  id="ai-listing-credit-explanation"
                  className="pricing-guarantee-tooltip pricing-tokens-tooltip"
                  role="tooltip"
                >
                  1 AI Listing Credit generates listing content for 1 design.
                </span>
              </button>
            </div>
            <h2>Need more AI listing credits?</h2>
            <p>
              Add one-time credits when you want more AI title, description, and tag drafts after your daily allowance runs out.
            </p>
          </div>

          <div className="pricing-tokens-grid pricing-tokens-grid-curated">
            {visibleAiCreditPacks.map((pack) => {
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
      <section className="relaunch-trust">
        <div className="landing-container relaunch-trust-grid">
          <div><LockKeyhole size={21} /><strong>Your marketplace sign-ins stay in your browser</strong><p>PodPilot does not ask you to store Redbubble or TeePublic passwords in the app.</p></div>
          <div><CreditCard size={21} /><strong>Billing through Paddle</strong><p>See your plan, billing interval, and the final payment total before you subscribe.</p></div>
          <div><ShieldCheck size={21} /><strong>Clear help and policies</strong><p>Questions about billing? <a href="/contact">Contact support</a> or read the <a href="/refund-policy">Refund Policy</a>.</p></div>
        </div>
      </section>

      {GUARANTEE_CONFIRMED && (
      <section className="pricing-guarantee-container">
        <div className="pricing-guarantee-card">
          <div className="pricing-guarantee-icon-wrapper">
            <ShieldCheck size={28} strokeWidth={2} />
          </div>
          <div className="pricing-guarantee-content">
            <div className="pricing-guarantee-title-row">
              <h2>3-Day Money-Back Guarantee</h2>
            </div>
            <p>
              Subscribe with confidence. If PodPilot is not right for you, request a refund within your first 3 days of purchase, subject to our <a href="/refund-policy">Refund Policy</a> and applicable consumer rights.
            </p>
            <div className="pricing-guarantee-checkmarks">
              <div className="pricing-guarantee-check-item">
                <CheckCircle2 size={16} />
                <span>72 hours from first successful subscription payment</span>
              </div>
              <div className="pricing-guarantee-check-item">
                <CheckCircle2 size={16} />
                <span>Request via PodPilot support or Paddle</span>
              </div>
              <div className="pricing-guarantee-check-item">
                <CheckCircle2 size={16} />
                <span>Statutory rights remain available where applicable</span>
              </div>
            </div>
          </div>
        </div>
      </section>
      )}

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

      <section className="relaunch-final">
        <div className="landing-container relaunch-final-inner">
          <div><span className="relaunch-eyebrow">Ready when your next batch is</span><h2>Choose your marketplaces. Keep the workflow together.</h2><p>Clear monthly or annual billing, with account management through Paddle.</p></div>
          <a className="landing-btn landing-btn-primary" href="#top-plans">View subscription plans <ArrowRight size={17} /></a>
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
