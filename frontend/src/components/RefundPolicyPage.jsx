import { CreditCard, FileText, RotateCcw, ShieldCheck } from "lucide-react";
import { GUARANTEE_CONFIRMED } from "../config/commercial";
import PublicHeader from "./PublicHeader";
import PublicFooter from "./PublicFooter";
import { useSeo } from "../utils/useSeo";

const policySections = [
  {
    title: "Billing and cancellation",
    paragraphs: [
      "PodPilot subscriptions are billed monthly or annually through Paddle, our merchant of record. The billing interval and amount are shown before payment.",
      "You can cancel future renewals through your Paddle billing portal. Cancellation is separate from requesting a refund. A scheduled cancellation normally leaves paid access in place until the current billing period ends.",
    ],
  },
  ...(GUARANTEE_CONFIRMED ? [{
    title: "Voluntary 3-day money-back guarantee",
    paragraphs: [
      "For your first PodPilot subscription purchase, you may request a refund if the product is not right for you. Submit the request within 72 hours of the first successful subscription payment, measured from Paddle's transaction timestamp. This offer applies to the first monthly or annual subscription payment. It does not cover later renewals or separate AI credit purchases.",
      "To request a refund, email support@podpilot.space with your account email and Paddle receipt or transaction number, or contact Paddle buyer support. A cancellation by itself does not submit a refund request. PodPilot will submit eligible requests through Paddle's refund workflow. Paddle processes and may review the refund; payment return time depends on the payment method.",
      "After a full refund is approved, the associated subscription is cancelled and access to its paid features ends. Your account and historical billing records remain available as required for support and accounting.",
    ],
  }] : []),
  {
    title: "Statutory rights and Paddle procedures",
    paragraphs: [
      GUARANTEE_CONFIRMED
        ? "The voluntary PodPilot guarantee does not replace, restrict, or override mandatory consumer withdrawal or refund rights. Applicable rights can continue after the commercial guarantee period. Paddle's refund policy and local law determine those rights, including rights relating to faulty or misdescribed products."
        : "Mandatory consumer withdrawal and refund rights remain in effect. Paddle's refund policy and local law determine those rights, including rights relating to faulty or misdescribed products.",
      GUARANTEE_CONFIRMED
        ? "Paddle is the merchant of record and handles payment refunds. Requests outside the voluntary guarantee are still assessed under applicable law and Paddle's procedures. They are not automatically rejected because three days have passed."
        : "Paddle is the merchant of record and handles payment refunds. Requests are assessed under applicable law and Paddle's procedures.",
    ],
  },
  {
    title: "How to get help",
    paragraphs: [
      "For subscription or refund help, email support@podpilot.space or use Paddle buyer support. Include the email on your account and your Paddle receipt or transaction number. Do not send payment card details.",
    ],
  },
];

export default function RefundPolicyPage() {
  useSeo({
    title: "Refund Policy - PodPilot",
    description: "Read how PodPilot subscription cancellation and refund requests work, including applicable consumer rights.",
    canonical: "/refund-policy",
  });

  return (
    <main className="landing-page privacy-page">
      <PublicHeader />
      <section className="privacy-hero">
        <div className="landing-container privacy-hero-inner">
          <div className="contact-kicker privacy-kicker">
            <RotateCcw size={16} strokeWidth={2.2} style={{ color: "#7C3AED" }} />
            <span>Billing and refunds</span>
          </div>
          <h1>Refund Policy</h1>
          <p>Last updated: November 2026</p>
          <div className="privacy-note" style={{ background: "rgba(124,58,237,0.05)", border: "1px solid rgba(124,58,237,0.15)", borderRadius: "8px", padding: "1rem", display: "flex", gap: "0.5rem", alignItems: "center", marginTop: "1rem" }}>
            <ShieldCheck size={18} strokeWidth={2.2} style={{ color: "#7C3AED" }} />
            <span style={{ fontSize: "0.9rem" }}>{GUARANTEE_CONFIRMED ? "Our 3-day commercial guarantee adds to your mandatory consumer rights." : "Refund requests are handled through Paddle. Applicable consumer rights remain in effect."}</span>
          </div>
        </div>
      </section>
      <section className="privacy-section" style={{ padding: "40px 0 80px 0" }}>
        <div className="landing-container privacy-layout">
          <aside className="privacy-summary-card">
            <CreditCard size={22} strokeWidth={2.1} style={{ color: "#7C3AED" }} />
            <h2>Need billing help?</h2>
            <p>Cancel in your Paddle billing portal. To request a refund, contact PodPilot support or Paddle buyer support.</p>
            <a href="mailto:support@podpilot.space">support@podpilot.space</a>
            <a href="https://paddle.net" target="_blank" rel="noreferrer">Paddle buyer support</a>
          </aside>
          <article className="privacy-policy-card">
            {policySections.map((section) => (
              <section className="privacy-policy-block" key={section.title}>
                <h2>{section.title}</h2>
                {section.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
              </section>
            ))}
            <p><FileText size={16} /> Read <a href="https://www.paddle.com/legal/refund-policy" target="_blank" rel="noreferrer">Paddle's refund policy</a> for its buyer procedures and country-specific terms.</p>
          </article>
        </div>
      </section>
      <PublicFooter />
    </main>
  );
}
