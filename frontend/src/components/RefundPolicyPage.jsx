import { CreditCard, FileText, RotateCcw } from "lucide-react";
import PublicHeader from "./PublicHeader";
import PublicFooter from "./PublicFooter";
import { useSeo } from "../utils/useSeo";

const refundSections = [
  {
    title: "1. Overview of Refund Policy",
    body: [
      "We want print-on-demand sellers to be completely confident in their purchase. PodPilot is designed with extensive sandbox testing features, platform safety validation checks, and informational guides to ensure you can evaluate our upload assistant thoroughly.",
      "This policy details our refund criteria, cancellation terms, and process to request billing adjustments.",
    ],
  },
  {
    title: "2. The 3-Day Free Trial",
    body: [
      "All new subscription plans (Redbubble, TeePublic, and All Platforms) include an unconditional 3-day free trial. This trial is intended to give you full operational access to test the browser extension automation and web dashboard workflow in your own browser.",
      "If you cancel your subscription before the end of the 3-day trial period, you will not be charged. It is the user's responsibility to cancel before the trial concludes if they choose not to continue with a paid subscription.",
    ],
  },
  {
    title: "3. paid Subscriptions & Cancellation",
    body: [
      "After the 3-day trial period concludes, your selected billing cycle (monthly or annual) will initiate, and your payment method will be charged through our secure merchant of record, Paddle.",
      "You can cancel your subscription at any time. When you cancel, your access to advanced platform tools, upload limits, and daily AI listing tokens will remain active and unrestricted until the end of your current paid billing period. No further renewal charges will be made.",
    ],
  },
  {
    title: "4. Money-Back Guarantee SLA",
    body: [
      "For added peace of mind, refund requests may be submitted and reviewed within 7 days of your first payment.",
      "We want to ensure that every POD seller has an exceptional experience. If you encounter setup blockers or software errors, please let us know immediately so we can assist you.",
    ],
  },
  {
    title: "5. Billing Adjustments & Eligible Cases",
    body: [
      "After a paid billing cycle has processed, payments are generally non-refundable except where required by local consumer protection laws or in cases of:",
    ],
    bullets: [
      "Duplicate Billing: Accidental duplicate plan activations or double checkout errors.",
      "Billing Discrepancies: Verified processing mistakes or system calculation errors.",
      "Technical Interruptions: Severe, prolonged, and verified platform outages caused by PodPilot's central servers.",
    ],
  },
  {
    title: "6. Non-Refundable Scenarios",
    body: [
      "Refunds are not issued in cases where users forget to cancel prior to renewal, do not use the active dashboard features, or experience marketplace-specific account penalties or design rejections. Print-on-demand marketplaces own their listing approvals, and automated tools make no safety guarantees.",
    ],
  },
  {
    title: "7. How to Submit a Refund Request",
    body: [
      "All subscription payments and checkouts are managed by Paddle, our secure merchant of record. Standard billing updates and refunds are processed securely through them.",
      "To submit a refund request, please send an email to support@podpilot.space with the following details:",
    ],
    bullets: [
      "Your registered PodPilot email address.",
      "The billing transaction date and receipt number.",
      "A brief description of your request and any technical feedback.",
    ],
  },
  {
    title: "8. Support Contact",
    body: [
      "If you have questions about this policy or need billing assistance, contact support@podpilot.space.",
    ],
  },
];

export default function RefundPolicyPage() {
  useSeo({
    title: "Refund Policy - PodPilot",
    description: "PodPilot offers a 7-day money-back guarantee on all subscription plans. Learn about our refund criteria, cancellation terms, and how to request a refund.",
    canonical: "/refund-policy",
  });
  return (
    <main className="landing-page privacy-page">
      <PublicHeader />

      <section className="privacy-hero">
        <div className="landing-container privacy-hero-inner">
          <div className="contact-kicker privacy-kicker">
            <RotateCcw size={16} strokeWidth={2.2} style={{ color: "#7C3AED" }} />
            <span>Billing SLA</span>
          </div>
          <h1>Refund Policy</h1>
          <p>Effective Date: May 2026</p>
          <div className="privacy-note" style={{ background: "rgba(124,58,237,0.05)", border: "1px solid rgba(124,58,237,0.15)", borderRadius: "8px", padding: "1rem", display: "flex", gap: "0.5rem", alignItems: "center", marginTop: "1rem" }}>
            <FileText size={18} strokeWidth={2.2} style={{ color: "#7C3AED" }} />
            <span style={{ fontSize: "0.9rem" }}>PodPilot includes a 3-day free trial so you can test the product before being billed. Paid payments are generally non-refundable except as required by law.</span>
          </div>
        </div>
      </section>

      <section className="privacy-section" style={{ padding: "40px 0 80px 0" }}>
        <div className="landing-container privacy-layout">
          <aside className="privacy-summary-card">
            <CreditCard size={22} strokeWidth={2.1} style={{ color: "#7C3AED" }} />
            <h2>Refund Commitments</h2>
            <p>
              Refund requests may be submitted and reviewed within 7 days of first payment. You can cancel your subscription at any time to prevent renewals.
            </p>
            <a href="mailto:support@podpilot.space" style={{ color: "#7C3AED", fontWeight: 600 }}>support@podpilot.space</a>
          </aside>

          <article className="privacy-policy-card">
            {refundSections.map((section) => (
              <section className="privacy-policy-block" key={section.title} style={{ marginBottom: "2rem" }}>
                <h2 style={{ fontSize: "1.5rem", color: "inherit", fontWeight: 700, marginBottom: "1rem" }}>{section.title}</h2>
                {section.body?.map((paragraph, index) => (
                  <p key={index} style={{ fontSize: "0.95rem", opacity: 0.85, lineHeight: 1.6, marginBottom: "1rem" }}>{paragraph}</p>
                ))}
                {section.bullets ? (
                  <ul style={{ paddingLeft: "1.5rem", marginBottom: "1rem", listStyleType: "disc" }}>
                    {section.bullets.map((item, index) => (
                      <li key={index} style={{ fontSize: "0.95rem", opacity: 0.85, lineHeight: 1.6, marginBottom: "0.5rem" }}>{item}</li>
                    ))}
                  </ul>
                ) : null}
              </section>
            ))}
          </article>
        </div>
      </section>

      <PublicFooter />
    </main>
  );
}
