import { useState } from "react";
import { Clock3, CreditCard, Mail, MessageSquare, MonitorUp, PhoneCall } from "lucide-react";
import { useAuth } from "../auth/AuthContext";
import Icon from "./Icon";
import PublicHeader from "./PublicHeader";
import PublicFooter from "./PublicFooter";
import { useSeo } from "../utils/useSeo";

export default function ContactPage() {
  const [submitted, setSubmitted] = useState(false);
  const auth = useAuth();
  const customerEmail = auth?.user?.email || "";

  useSeo({
    title: "Contact Support - PodPilot",
    description: "Get help with your PodPilot account, billing, upload automation, or browser extension. Contact support via form or email at support@podpilot.space.",
    canonical: "/contact",
  });

  function handleSubmit(event) {
    event.preventDefault();
    setSubmitted(true);
  }

  return (
    <main className="landing-page contact-page">
      <PublicHeader />

      <section className="contact-hero">
        <div className="landing-container contact-hero-inner">
          <div className="contact-kicker">
            <MessageSquare size={16} strokeWidth={2.2} />
            <span>Support Center</span>
          </div>
          <h1>Contact PodPilot Support</h1>
          <p>Need help with your account, billing, uploads, or extension setup? We're here to assist you.</p>
        </div>
      </section>

      <section className="contact-section" style={{ padding: "40px 0 80px 0" }}>
        <div className="landing-container contact-grid">
          <form className="contact-card contact-form-card" onSubmit={handleSubmit}>
            <div className="contact-card-heading">
              <h2>Send us a Message</h2>
              <p>Please fill out the form below and our team will get back to you as soon as possible.</p>
            </div>

            <div className="contact-form-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1.5rem" }}>
              <label className="contact-field" style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                <span style={{ fontWeight: 600, fontSize: "0.9rem" }}>First Name</span>
                <input name="firstName" type="text" autoComplete="given-name" required style={{ padding: "0.75rem", borderRadius: "8px", border: "1px solid var(--border-color, rgba(0,0,0,0.1))", background: "var(--input-bg, transparent)" }} />
              </label>

              <label className="contact-field" style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                <span style={{ fontWeight: 600, fontSize: "0.9rem" }}>Last Name</span>
                <input name="lastName" type="text" autoComplete="family-name" required style={{ padding: "0.75rem", borderRadius: "8px", border: "1px solid var(--border-color, rgba(0,0,0,0.1))", background: "var(--input-bg, transparent)" }} />
              </label>

              <label className="contact-field" style={{ display: "flex", flexDirection: "column", gap: "0.5rem", gridColumn: "span 2" }}>
                <span style={{ fontWeight: 600, fontSize: "0.9rem" }}>Email Address</span>
                <input name="email" type="email" autoComplete="email" defaultValue={customerEmail} required style={{ padding: "0.75rem", borderRadius: "8px", border: "1px solid var(--border-color, rgba(0,0,0,0.1))", background: "var(--input-bg, transparent)" }} />
              </label>

              <label className="contact-field" style={{ display: "flex", flexDirection: "column", gap: "0.5rem", gridColumn: "span 2" }}>
                <span style={{ fontWeight: 600, fontSize: "0.9rem" }}>Help Topic</span>
                <select name="topic" required style={{ padding: "0.75rem", borderRadius: "8px", border: "1px solid var(--border-color, rgba(0,0,0,0.1))", background: "var(--input-bg, transparent)", color: "inherit" }}>
                  <option value="">Select a topic...</option>
                  <option value="technical">Technical Support</option>
                  <option value="billing">Billing &amp; Payments</option>
                  <option value="account">Account Help</option>
                  <option value="feature">Feature Request</option>
                  <option value="refund">Refund Request</option>
                  <option value="other">Other</option>
                </select>
              </label>

              <label className="contact-field" style={{ display: "flex", flexDirection: "column", gap: "0.5rem", gridColumn: "span 2" }}>
                <span style={{ fontWeight: 600, fontSize: "0.9rem" }}>Message / Description</span>
                <textarea name="message" rows={6} placeholder="Tell us how we can help..." required style={{ padding: "0.75rem", borderRadius: "8px", border: "1px solid var(--border-color, rgba(0,0,0,0.1))", background: "var(--input-bg, transparent)", fontFamily: "inherit" }} />
              </label>
            </div>

            {submitted ? (
              <div className="contact-success" role="status" aria-live="polite" style={{ background: "rgba(16, 185, 129, 0.1)", color: "#10B981", padding: "1rem", borderRadius: "8px", marginTop: "1rem", display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <Icon name="check" />
                <span>Message submitted! We will reply to your email address shortly.</span>
              </div>
            ) : null}

            <button type="submit" className="landing-btn landing-btn-primary contact-submit" style={{ marginTop: "1.5rem" }}>
              <span>Send message</span>
              <Icon name="chevronRight" />
            </button>
          </form>

          <aside className="contact-side" style={{ display: "flex", flexDirection: "column", gap: "2rem" }}>
            <div className="contact-card contact-info-card">
              <div className="contact-card-heading">
                <h2>Support Information</h2>
                <p>We are dedicated to helping our community automate their workflow efficiently.</p>
              </div>

              <div className="contact-info-list" style={{ display: "flex", flexDirection: "column", gap: "1.5rem", marginTop: "1.5rem" }}>
                <div className="contact-info-row" style={{ display: "flex", gap: "1rem" }}>
                  <span className="contact-info-icon" style={{ background: "rgba(124, 58, 237, 0.1)", color: "#7C3AED", width: "40px", height: "40px", borderRadius: "50%", display: "flex", alignItems: "center", justifyCenter: "center", justifyContent: "center" }}><Mail size={18} strokeWidth={2.2} /></span>
                  <div>
                    <span style={{ display: "block", fontSize: "0.8rem", opacity: 0.6 }}>Official Support Email</span>
                    <a href="mailto:support@podpilot.space" style={{ fontWeight: 600, color: "#7C3AED" }}>support@podpilot.space</a>
                  </div>
                </div>

                <div className="contact-info-row" style={{ display: "flex", gap: "1rem" }}>
                  <span className="contact-info-icon" style={{ background: "rgba(124, 58, 237, 0.1)", color: "#7C3AED", width: "40px", height: "40px", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center" }}><Clock3 size={18} strokeWidth={2.2} /></span>
                  <div>
                    <span style={{ display: "block", fontSize: "0.8rem", opacity: 0.6 }}>Typical Response Time</span>
                    <strong>We usually respond within 24–48 hours, Monday to Friday.</strong>
                  </div>
                </div>

                <div className="contact-info-row" style={{ display: "flex", gap: "1rem" }}>
                  <span className="contact-info-icon" style={{ background: "rgba(124, 58, 237, 0.1)", color: "#7C3AED", width: "40px", height: "40px", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center" }}><PhoneCall size={18} strokeWidth={2.2} /></span>
                  <div>
                    <span style={{ display: "block", fontSize: "0.8rem", opacity: 0.6 }}>Quick help via WhatsApp</span>
                    <a href="https://wa.me/message/something" target="_blank" rel="noopener noreferrer" style={{ fontWeight: 600, color: "#25D366" }}>Connect on WhatsApp</a>
                  </div>
                </div>
              </div>
            </div>

            <div className="contact-note" style={{ background: "rgba(124, 58, 237, 0.05)", borderLeft: "4px solid #7C3AED", padding: "1.5rem", borderRadius: "8px", display: "flex", gap: "1rem" }}>
              <div style={{ color: "#7C3AED" }}>
                <MonitorUp size={24} strokeWidth={2.2} />
              </div>
              <div>
                <strong style={{ display: "block", marginBottom: "0.25rem" }}>Submitting a Bug Report?</strong>
                <p style={{ margin: 0, fontSize: "0.85rem", opacity: 0.8, lineHeight: 1.5 }}>
                  To resolve issues faster, please include your <strong>browser version</strong>, a detailed <strong>screenshot</strong> of the problem, and a brief description of <strong>what happened</strong> when the issue occurred.
                </p>
              </div>
            </div>
          </aside>
        </div>
      </section>

      <PublicFooter />
    </main>
  );
}
