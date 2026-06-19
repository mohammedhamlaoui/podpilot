import { useState } from "react";
import { HelpCircle, LifeBuoy, MonitorUp, ChevronDown, BookOpen } from "lucide-react";
import PublicHeader from "./PublicHeader";
import PublicFooter from "./PublicFooter";
import { useSeo } from "../utils/useSeo";

const faqItems = [
  {
    id: "how-works",
    question: "How does PodPilot work?",
    answer: "PodPilot uses a dual-engine architecture consisting of a Web Dashboard and a secure Browser Extension. You upload your design images and a spreadsheet (Excel/CSV) containing your titles, tags, and descriptions to the Web Dashboard. You then use our Browser Extension to auto-fill the print-on-demand marketplace listing forms directly in your active browser tabs. This keeps your listing workflow 100% browser-native and secure."
  },
  {
    id: "install-extension",
    question: "How do I install and use the Browser Extension?",
    answer: "You can get it directly from the Chrome Web Store. Once installed, pin the extension to your browser toolbar, open the dashboard, and log in with your secure PodPilot credentials.",
    answerElement: (
      <>
        You can get it directly from the Chrome Web Store at{" "}
        <a 
          href="https://chromewebstore.google.com/detail/aloidebamibhnggbnlhoemnokkllkgdn?utm_source=item-share-cb"
          target="_blank" 
          rel="noopener noreferrer"
          style={{ color: "#7C3AED", textDecoration: "underline", fontWeight: 500 }}
        >
          this link
        </a>
        . Once installed, pin the extension to your browser toolbar, open the dashboard, and log in with your secure PodPilot credentials.
      </>
    )
  },
  {
    id: "import-designs",
    question: "How do I bulk import designs and spreadsheet metadata?",
    answer: "You can import designs in bulk via our 'Import Designs' section on your dashboard. Simply upload your metadata spreadsheet (CSV/Excel) containing columns for title, description, tags, and product settings, and upload the corresponding design images. PodPilot automatically matches the spreadsheet rows with the image files using their filenames."
  },
  {
    id: "redbubble-upload",
    question: "How does the Redbubble upload automation work?",
    answer: "After launching your upload queue in the Web Dashboard, open Redbubble's listing editor tab in your browser. The PodPilot browser extension will detect the active listing, securely retrieve the design image and matched metadata from your local queue, auto-fill every input field (including colors, product enables, tags, and copy settings), and allow you to review and publish the listing naturally."
  },
  {
    id: "teepublic-upload",
    question: "How does the TeePublic upload automation work?",
    answer: "TeePublic uploads follow the exact same native browser workflow. Open the TeePublic listing editor page in your browser. Our extension automatically fetches the scheduled work from your TeePublic queue tab on the dashboard, applies all design tags and tags settings, and completes the form filling in seconds."
  },
  {
    id: "ai-listing",
    question: "How does the AI listing content generator work?",
    answer: "PodPilot integrates high-speed generative AI (powered securely on our backend using Google Gemini) to analyze your design filename, niche description, or raw ideas and automatically draft highly optimized, search-friendly listing titles, descriptions, and tags. This saves you hours of brainstorming and copy-pasting."
  },
  {
    id: "trademark-check",
    question: "How does the Trademark and Safety check work?",
    answer: "Our safety engine scans your design titles, tags, and descriptions against active registered trademark databases to highlight potential copyright risks before you upload them. Please note that this check is strictly for informational convenience and does NOT constitute legal trademark advice. You must review all outputs carefully before publishing your designs."
  },
  {
    id: "subscriptions",
    question: "How do subscriptions and billing cycles work?",
    answer: "We offer monthly and annual subscriptions billed securely through Paddle, our merchant of record. Annual subscriptions include a built-in discount, showing a lower monthly equivalent rate billed as a single yearly charge. Trial availability may depend on account eligibility and the checkout offer shown at the time of purchase."
  },
  {
    id: "cancel",
    question: "How do I cancel my active subscription?",
    answer: "You can cancel your subscription at any time. Navigate to your dashboard profile and click 'Manage billing' to open your secure Paddle Customer Portal session. Click cancel, and your premium subscription benefits will remain active and unrestricted until the end of your current paid billing period."
  },
  {
    id: "troubleshoot",
    question: "How do I troubleshoot extension upload issues?",
    answer: "Most upload issues can be solved by checking three items: 1) Ensure you are logged into both your PodPilot extension and the marketplace account in the same browser window. 2) Refresh the marketplace tab to clear old browser session cookies. 3) Make sure your spreadsheet filenames match your uploaded image filenames exactly. If issues persist, ensure your extension is updated to the latest version."
  }
];

export default function HelpCenterPage() {
  const [activeFaq, setActiveFaq] = useState(null);

  useSeo({
    title: "Help Center - PodPilot FAQs & Setup Guides",
    description: "Get answers to PodPilot FAQs. Learn how to install the browser extension, bulk import designs, automate Redbubble and TeePublic uploads, and troubleshoot common issues.",
    canonical: "/help",
    jsonLd: {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      "@id": "https://podpilot.space/help#faq",
      mainEntity: faqItems.map((faq) => ({
        "@type": "Question",
        name: faq.question,
        acceptedAnswer: {
          "@type": "Answer",
          text: faq.answer,
        },
      })),
    },
  });

  function toggleFaq(id) {
    setActiveFaq((prev) => (prev === id ? null : id));
  }

  return (
    <main className="landing-page privacy-page help-page">
      <PublicHeader />

      <section className="privacy-hero">
        <div className="landing-container privacy-hero-inner">
          <div className="contact-kicker privacy-kicker">
            <HelpCircle size={16} strokeWidth={2.2} style={{ color: "#7C3AED" }} />
            <span>Help Center</span>
          </div>
          <h1>Frequently Asked Questions</h1>
          <p>Find answers to common questions about PodPilot setup, uploading, billing, and settings.</p>
        </div>
      </section>

      <section className="privacy-section" style={{ padding: "40px 0 80px 0" }}>
        <div className="landing-container help-layout" style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: "2.5rem" }}>
          
          <article className="privacy-policy-card">
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "2rem", borderBottom: "1px solid rgba(0,0,0,0.06)", paddingBottom: "1rem" }}>
              <BookOpen size={20} style={{ color: "#7C3AED" }} />
              <h2 style={{ fontSize: "1.5rem", fontWeight: 700, margin: 0 }}>Articles &amp; FAQs</h2>
            </div>

            <div className="help-faq-list" style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
              {faqItems.map((faq) => {
                const isOpen = activeFaq === faq.id;
                return (
                  <div
                    key={faq.id}
                    style={{
                      border: "1px solid var(--border-color, rgba(0,0,0,0.06))",
                      borderRadius: "12px",
                      background: "var(--card-bg, rgba(255,255,255,0.02))",
                      overflow: "hidden",
                      transition: "all 0.25s ease"
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => toggleFaq(faq.id)}
                      style={{
                        width: "100%",
                        padding: "1.25rem",
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        textAlign: "left",
                        background: "transparent",
                        border: "none",
                        color: "inherit",
                        fontWeight: 600,
                        cursor: "pointer"
                      }}
                    >
                      <span style={{ fontSize: "1.05rem" }}>{faq.question}</span>
                      <ChevronDown
                        size={18}
                        style={{
                          transform: isOpen ? "rotate(180deg)" : "rotate(0deg)",
                          transition: "transform 0.25s ease",
                          color: "#7C3AED"
                        }}
                      />
                    </button>
                    
                    <div
                      style={{
                        maxHeight: isOpen ? "300px" : "0px",
                        overflow: "hidden",
                        transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)"
                      }}
                    >
                      <p style={{ padding: "0 1.25rem 1.25rem 1.25rem", margin: 0, opacity: 0.85, fontSize: "0.95rem", lineHeight: 1.6 }}>
                        {faq.answerElement || faq.answer}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </article>

          <aside className="privacy-summary-card help-support-card" style={{ height: "fit-content" }}>
            <LifeBuoy size={22} strokeWidth={2.1} style={{ color: "#7C3AED" }} />
            <h2>Still need help?</h2>
            <p>
              Our support team is here to assist you with upload issues, account setups, billing portals, or feature recommendations.
            </p>
            <a href="/contact" style={{ display: "inline-block", background: "#7C3AED", color: "#FFF", padding: "0.75rem 1.5rem", borderRadius: "8px", fontWeight: 600, textDecoration: "none", textAlign: "center", width: "100%", boxSizing: "border-box", marginTop: "1rem" }}>
              Contact Customer Support
            </a>
            <div className="help-response-note" style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginTop: "1.5rem", fontSize: "0.8rem", opacity: 0.7 }}>
              <MonitorUp size={16} strokeWidth={2.2} />
              <span>We reply within 24–48 hours, Monday to Friday.</span>
            </div>
          </aside>

        </div>
      </section>

      <PublicFooter />
    </main>
  );
}
