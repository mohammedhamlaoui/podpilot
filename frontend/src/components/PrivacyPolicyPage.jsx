import { FileText, LockKeyhole, ShieldCheck } from "lucide-react";
import PublicHeader from "./PublicHeader";
import PublicFooter from "./PublicFooter";
import { useSeo } from "../utils/useSeo";

const policySections = [
  {
    title: "1. Introduction",
    body: [
      "PodPilot helps print-on-demand (POD) sellers manage design workflows, generate listing metadata, perform copyright/trademark safety checks, and automate uploads to marketplaces through browser-native integration.",
      "This Privacy Policy describes how we collect, use, store, and safeguard your personal information when you use our website, dashboard, and browser extension. We are committed to protecting your privacy and securing your intellectual property.",
    ],
  },
  {
    title: "2. Information We Collect",
    body: [
      "We collect only the information necessary to provide, secure, and maintain the PodPilot services. This includes:",
    ],
    bullets: [
      "Account Credentials: Account email address and basic profile identifiers.",
      "Design Metadata: Design titles, descriptions, tags, and product platform settings.",
      "Print-On-Demand Assets: Design images you upload to the dashboard for scheduling.",
      "Billing & Payment Status: Subscription status, plan tier, and subscription lifecycle events processed via Paddle. We never collect or store full credit card numbers.",
      "Authentication Data: Session identifiers, token mappings, and authentication states processed securely via Supabase.",
      "Technical Log Files: Application performance logs, browser extension communication parameters, and debug values to solve upload errors.",
    ],
  },
  {
    title: "3. How We Use Your Information",
    body: [
      "Your personal data is processed exclusively for functional product workflows. We use your data to:",
    ],
    bullets: [
      "Authenticate your session and grant secure access to your private workspace.",
      "Process upload workflows and organize active design queues.",
      "Manage subscription tiers, plan limits, and verify payment access.",
      "Provide customer support, SLA responses, and resolve extension errors.",
      "Prevent abuse, security breaches, or duplicate trial exploitation.",
    ],
  },
  {
    title: "4. No Marketplace Password Storage",
    body: [
      "PodPilot is a browser-native automation tool. All upload actions execute directly inside your own browser window session.",
      "We NEVER ask for, collect, or store your Redbubble or TeePublic account passwords. Your marketplace accounts remain protected under your own credentials.",
    ],
  },
  {
    title: "5. Data Storage and Image Retention Policy",
    body: [
      "User-uploaded designs and metadata are securely stored using cloud storage services (including Cloudflare R2). Images are securely linked directly to your authenticated user account.",
      "To optimize storage and security, we enforce an automatic image retention policy: uploaded design files are kept temporarily in active workflow storage and automatically purged from our servers when designs are deleted or after workflows are fully processed, based on your retention settings.",
    ],
  },
  {
    title: "6. Payment & Authentication Providers",
    body: [
      "Subscription processing and payment checkouts are securely handled by our merchant of record, Paddle. PodPilot does not collect, receive, or store your payment details.",
      "User sign-ins, password security, and session authentication are handled securely through Supabase, using industry-standard protocols.",
    ],
  },
  {
    title: "7. No Selling of Data",
    body: [
      "We do not sell, rent, trade, or distribute your personal information, design assets, or metadata to third parties for commercial or advertising purposes. Your designs and listings remain yours.",
    ],
  },
  {
    title: "8. Data Portability and Deletion Rights",
    body: [
      "You have full ownership of your data. At any time, you can request access to your metadata, export your designs, or request permanent deletion of your account and all associated assets.",
      "To request permanent account deletion, please contact our support team at support@podpilot.space, and we will process your deletion request within 30 days.",
    ],
  },
  {
    title: "9. Contact Us",
    body: [
      "If you have any questions about this Privacy Policy, your data rights, or security practices, please contact us at support@podpilot.space.",
    ],
  },
];

export default function PrivacyPolicyPage() {
  useSeo({
    title: "Privacy Policy - PodPilot",
    description: "Read PodPilot's privacy policy. We protect your design assets and personal data. No marketplace passwords stored. Your designs remain yours.",
    canonical: "/privacy",
  });
  return (
    <main className="landing-page privacy-page">
      <PublicHeader />

      <section className="privacy-hero">
        <div className="landing-container privacy-hero-inner">
          <div className="contact-kicker privacy-kicker">
            <ShieldCheck size={16} strokeWidth={2.2} />
            <span>Legal Policy</span>
          </div>
          <h1>Privacy Policy</h1>
          <p>Effective Date: May 2026</p>
          <div className="privacy-note" style={{ background: "rgba(124,58,237,0.05)", border: "1px solid rgba(124,58,237,0.15)", borderRadius: "8px", padding: "1rem", display: "flex", gap: "0.5rem", alignItems: "center", marginTop: "1rem" }}>
            <FileText size={18} strokeWidth={2.2} style={{ color: "#7C3AED" }} />
            <span style={{ fontSize: "0.9rem" }}>This Privacy Policy outlines how your print-on-demand assets and personal credentials are protected.</span>
          </div>
        </div>
      </section>

      <section className="privacy-section" style={{ padding: "40px 0 80px 0" }}>
        <div className="landing-container privacy-layout">
          <aside className="privacy-summary-card">
            <LockKeyhole size={22} strokeWidth={2.1} style={{ color: "#7C3AED" }} />
            <h2>PodPilot Privacy Commitment</h2>
            <p>
              We prioritize the protection of your intellectual property. All design assets and metadata belong exclusively to you, and no marketplace passwords are ever stored.
            </p>
            <a href="mailto:support@podpilot.space" style={{ color: "#7C3AED", fontWeight: 600 }}>support@podpilot.space</a>
          </aside>

          <article className="privacy-policy-card">
            {policySections.map((section) => (
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
