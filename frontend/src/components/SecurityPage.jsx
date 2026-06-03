import { LockKeyhole, ShieldCheck, Server, Key, EyeOff, ShieldAlert } from "lucide-react";
import PublicHeader from "./PublicHeader";
import PublicFooter from "./PublicFooter";
import { useSeo } from "../utils/useSeo";

const securitySections = [
  {
    title: "1. Browser-Based Automation Architecture",
    body: [
      "Unlike risky server-side automated scrapers, PodPilot functions as a browser-native uploading assistant. The upload workflows run entirely inside your own local browser window session using a secure browser extension helper.",
      "This approach mimics natural human mouse and keyboard form inputs. No browser sessions, cookies, or marketplace accounts are shared with our central servers.",
    ],
  },
  {
    title: "2. Zero Marketplace Password Storage",
    body: [
      "We believe that your login credentials belong solely to you. PodPilot does NOT ask for, collect, or store your passwords for Redbubble or TeePublic.",
      "You log into print-on-demand marketplaces yourself directly, keeping your credentials securely stored in your own browser's password manager or key vault.",
    ],
  },
  {
    title: "3. Enterprise-Grade Session Security",
    body: [
      "Account security, profile creation, and session authorization are handled securely via Supabase using enterprise-standard OAuth 2.0 and JSON Web Token (JWT) standards.",
      "All communications between your browser, the extension helper, and our FastAPI servers are encrypted in transit using industry-standard HTTPS (TLS 1.3) protocols.",
    ],
  },
  {
    title: "4. Secure Payments & Merchant Privacy",
    body: [
      "PodPilot is fully integrated with Paddle, our secure merchant of record, to process subscription checkouts and billing events.",
      "PodPilot never stores, parses, or handles full credit card numbers or raw payment credentials. All payment operations take place directly inside Paddle's PCI-DSS compliant overlays.",
    ],
  },
  {
    title: "5. Private Design Storage & Automatic Deletion",
    body: [
      "Your uploaded design files and bulk spreadsheet metadata are stored in isolated cloud buckets (using secure Cloudflare R2 object storage). Access keys are highly restricted, and no other users can access your workspace.",
      "You maintain absolute copyright ownership of your print-on-demand designs. You can request a permanent purge of all files and account logs from our databases at any time by contacting support.",
    ],
  },
  {
    title: "6. Debug Logs and Audit Trails",
    body: [
      "We maintain minimal transaction logs, strictly utilized to troubleshoot extension upload errors and count daily AI listing tokens. We do not inspect design contents, nor do we track listing metrics unrelated to error prevention.",
    ],
  },
  {
    title: "7. Vulnerability Disclosure SLA",
    body: [
      "We welcome audit reports and bug disclosures from independent security researchers. If you identify a vulnerability in our dashboard, extension communication, or backend routers, please email us directly at support@podpilot.space.",
      "We are committed to reviewing security reports and coordinating swift patches within 48 hours of notification.",
    ],
  },
];

export default function SecurityPage() {
  useSeo({
    title: "Security Practices - PodPilot",
    description: "Learn how PodPilot protects your account, design assets, and data. Browser-native uploads, zero marketplace password storage, and secure cloud infrastructure.",
    canonical: "/security",
  });
  return (
    <main className="landing-page privacy-page">
      <PublicHeader />

      <section className="privacy-hero">
        <div className="landing-container privacy-hero-inner">
          <div className="contact-kicker privacy-kicker">
            <ShieldCheck size={16} strokeWidth={2.2} style={{ color: "#7C3AED" }} />
            <span>Platform Security</span>
          </div>
          <h1>Security Practices</h1>
          <p>Learn how PodPilot keeps your credentials, designs, and workflow safe.</p>
        </div>
      </section>

      <section className="privacy-section" style={{ padding: "40px 0 80px 0" }}>
        <div className="landing-container privacy-layout">
          <aside className="privacy-summary-card">
            <LockKeyhole size={22} strokeWidth={2.1} style={{ color: "#7C3AED" }} />
            <h2>Secure Workflow</h2>
            <p>
              By executing uploads natively through your own browser session, PodPilot completely eliminates marketplace password storage and account takeover risks.
            </p>
            <a href="mailto:support@podpilot.space" style={{ color: "#7C3AED", fontWeight: 600 }}>support@podpilot.space</a>
          </aside>

          <article className="privacy-policy-card">
            <div className="security-icon-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1.5rem", marginBottom: "3rem" }}>
              <div style={{ background: "rgba(124, 58, 237, 0.03)", padding: "1.5rem", borderRadius: "12px", border: "1px solid rgba(124, 58, 237, 0.08)" }}>
                <EyeOff size={24} style={{ color: "#7C3AED", marginBottom: "0.5rem" }} />
                <h3 style={{ fontWeight: 600, fontSize: "1.1rem", marginBottom: "0.25rem" }}>Zero Password Risk</h3>
                <p style={{ margin: 0, fontSize: "0.85rem", opacity: 0.8, lineHeight: 1.4 }}>We never ask for your Redbubble or TeePublic password.</p>
              </div>
              <div style={{ background: "rgba(124, 58, 237, 0.03)", padding: "1.5rem", borderRadius: "12px", border: "1px solid rgba(124, 58, 237, 0.08)" }}>
                <Key size={24} style={{ color: "#7C3AED", marginBottom: "0.5rem" }} />
                <h3 style={{ fontWeight: 600, fontSize: "1.1rem", marginBottom: "0.25rem" }}>Secure Session Auth</h3>
                <p style={{ margin: 0, fontSize: "0.85rem", opacity: 0.8, lineHeight: 1.4 }}>Authentication is securely managed by Supabase endpoints.</p>
              </div>
              <div style={{ background: "rgba(124, 58, 237, 0.03)", padding: "1.5rem", borderRadius: "12px", border: "1px solid rgba(124, 58, 237, 0.08)" }}>
                <Server size={24} style={{ color: "#7C3AED", marginBottom: "0.5rem" }} />
                <h3 style={{ fontWeight: 600, fontSize: "1.1rem", marginBottom: "0.25rem" }}>Protected Storage</h3>
                <p style={{ margin: 0, fontSize: "0.85rem", opacity: 0.8, lineHeight: 1.4 }}>Design files are kept private in secure Cloudflare R2 buckets.</p>
              </div>
              <div style={{ background: "rgba(124, 58, 237, 0.03)", padding: "1.5rem", borderRadius: "12px", border: "1px solid rgba(124, 58, 237, 0.08)" }}>
                <ShieldAlert size={24} style={{ color: "#7C3AED", marginBottom: "0.5rem" }} />
                <h3 style={{ fontWeight: 600, fontSize: "1.1rem", marginBottom: "0.25rem" }}>Merchant Privacy</h3>
                <p style={{ margin: 0, fontSize: "0.85rem", opacity: 0.8, lineHeight: 1.4 }}>Checkouts are handled by Paddle with full PCI-DSS encryption.</p>
              </div>
            </div>

            {securitySections.map((section) => (
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
