import { FileText, Scale, ShieldCheck } from "lucide-react";
import PublicHeader from "./PublicHeader";
import PublicFooter from "./PublicFooter";
import { useSeo } from "../utils/useSeo";

const termsSections = [
  {
    title: "1. Agreement to Terms",
    body: [
      "These Terms of Service govern your access to and use of PodPilot, including our website, dashboard web application, and associated browser extension.",
      "By registering an account, subscribing to a plan, or using the PodPilot browser extension, you agree to be bound by these Terms of Service. If you do not agree to these terms, do not access or use the services.",
    ],
  },
  {
    title: "2. Description of Services",
    body: [
      "PodPilot provides a workflow utility for print-on-demand sellers, which includes:",
    ],
    bullets: [
      "Web Dashboard: An interface to organize image files, draft design details, and import bulk spreadsheet metadata.",
      "Browser Extension: An automation script helper designed to auto-fill listing fields directly inside your active browser session.",
      "Upload Automation: Helper integrations to support Redbubble and TeePublic browser-native listing uploads.",
      "AI Listing Helper: Generative listing text and description helpers powered by artificial intelligence.",
      "Trademark & Safety Check: Informational checking tools to cross-reference design terms against registered databases.",
    ],
  },
  {
    title: "3. User Ownership & Listing Responsibility",
    body: [
      "You retain full intellectual property ownership and copyrights for all design images, titles, tags, and descriptions you import or compile on PodPilot. We make no ownership claims to your designs.",
      "You are solely responsible for ensuring that you own or have obtained all necessary commercial licenses, rights, and permissions to upload, publish, automate, and sell your designs.",
      "You agree to fully comply with the community guidelines, copyright rules, and terms of service of each marketplace (Redbubble and TeePublic) that you use.",
      "AI-generated listing text and trademark safety reports are provided for informational convenience only. They DO NOT constitute legal trademark advice. You must review all titles, tags, descriptions, and safety parameters carefully before publishing your designs.",
    ],
  },
  {
    title: "4. Platform Risks & Upload Automation Disclaimers",
    body: [
      "PodPilot is an independent software tool and is NOT affiliated, endorsed, or partnered with Redbubble, TeePublic, or any other print-on-demand marketplace.",
      "POD marketplaces frequently update their website structures, forms, rules, and layout parameters. Because our upload assistant relies on browser-native interactions, automated actions may occasionally fail or require software updates to adapt to these changes.",
      "PodPilot is provided on an 'as is' basis. We make no guarantees, warranties, or representations regarding marketplace account longevity, account safety, design approvals, or guaranteed sales. You accept all platform risks associated with print-on-demand uploading.",
    ],
  },
  {
    title: "5. Subscriptions, Cycles, & Cancellations",
    body: [
      "Paid plans are billed on a subscription basis, choosing either monthly or annual billing cycles. Billing is processed securely via Paddle.",
      "Your subscription will automatically renew at the end of each billing period unless cancelled. You can cancel your subscription at any time directly through your dashboard billing portal.",
      "Upon cancellation, your active subscription benefits and plan limits will remain fully accessible until the end of your current paid billing period, after which your account will revert to the free plan limit.",
    ],
  },
  {
    title: "6. Refund Policy",
    body: [
      "Paid subscription transactions and one-time token purchases are governed by our Refund Policy, accessible at /refund-policy. Please review our refund guidelines prior to subscription checkout.",
    ],
  },
  {
    title: "7. Account Termination and Abuse Prevention",
    body: [
      "We reserve the right to suspend or terminate your access to PodPilot at any time, without prior notice, in the event of payment failures, duplicate account trial exploitation, system scraping, or structural terms violations.",
    ],
  },
  {
    title: "8. Amendments to Terms",
    body: [
      "We may update these Terms of Service periodically to reflect product changes, technical requirements, or legal revisions. We will update the effective date at the top of this page, and your continued use of PodPilot signifies your acceptance of the revised terms.",
    ],
  },
  {
    title: "9. Legal Contact",
    body: [
      "For legal inquiries, copyright notices, or questions regarding these terms, please contact us at support@podpilot.space.",
    ],
  },
];

export default function TermsOfServicePage() {
  useSeo({
    title: "Terms of Service - PodPilot",
    description: "Read PodPilot's terms of service. Understand your rights and responsibilities when using our POD upload automation tool for Redbubble and TeePublic.",
    canonical: "/terms",
  });
  return (
    <main className="landing-page privacy-page terms-page">
      <PublicHeader />

      <section className="privacy-hero">
        <div className="landing-container privacy-hero-inner">
          <div className="contact-kicker privacy-kicker">
            <Scale size={16} strokeWidth={2.2} style={{ color: "#7C3AED" }} />
            <span>Legal Agreement</span>
          </div>
          <h1>Terms of Service</h1>
          <p>Effective Date: May 2026</p>
          <div className="privacy-note" style={{ background: "rgba(124,58,237,0.05)", border: "1px solid rgba(124,58,237,0.15)", borderRadius: "8px", padding: "1rem", display: "flex", gap: "0.5rem", alignItems: "center", marginTop: "1rem" }}>
            <FileText size={18} strokeWidth={2.2} style={{ color: "#7C3AED" }} />
            <span style={{ fontSize: "0.9rem" }}>Please read these terms carefully before automating print-on-demand listings with PodPilot.</span>
          </div>
        </div>
      </section>

      <section className="privacy-section" style={{ padding: "40px 0 80px 0" }}>
        <div className="landing-container privacy-layout">
          <aside className="privacy-summary-card">
            <ShieldCheck size={22} strokeWidth={2.1} style={{ color: "#7C3AED" }} />
            <h2>Responsible Use</h2>
            <p>
              By utilizing our dashboard and browser assistant, you agree to respect trademark laws, own copyright rights for your design assets, and follow marketplace community guidelines.
            </p>
            <a href="mailto:support@podpilot.space" style={{ color: "#7C3AED", fontWeight: 600 }}>support@podpilot.space</a>
          </aside>

          <article className="privacy-policy-card">
            {termsSections.map((section) => (
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
