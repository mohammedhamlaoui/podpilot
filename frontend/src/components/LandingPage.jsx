import { useEffect, useRef, useState } from "react";
import {
  User,
  ChevronDown,
  LayoutDashboard,
  LogOut,
  CircleUserRound,
} from "lucide-react";
import Icon from "./Icon";
import ThemeToggle from "./ThemeToggle";
import { useAuth } from "../auth/AuthContext";
import PublicHeader from "./PublicHeader";
import PublicFooter from "./PublicFooter";
import { useSeo } from "../utils/useSeo";
import ProductDemoVideo from "./ProductDemoVideo";
import PlatformLogoStrip from "./PlatformLogoStrip";
import HowItWorksVideoSection from "./HowItWorksVideoSection";

const authHref = "/dashboard";

const navItems = [
  { label: "How It Works", href: "#how-it-works" },
  { label: "Blog", href: "/blog" },
  { label: "Pricing", href: "/pricing" },
  { label: "FAQ", href: "/pricing#faq" },
];

const safetyPoints = [
  "Uploads run through your own Chrome or Brave session",
  "No marketplace passwords stored in PodPilot",
  "Review every listing before the extension uploads",
  "Keep your design files and listing data in your workspace",
];

const testimonials = [
  {
    quote: "Prepare image files, titles, tags, descriptions, and platform settings in one place before you start uploading.",
    name: "Batch prep",
    role: "Less tab switching",
  },
  {
    quote: "Use AI listing tools and trademark checks while you review each design, instead of copying text between spreadsheets and marketplace forms.",
    name: "Listing review",
    role: "Less manual copy-paste",
  },
  {
    quote: "Send prepared designs to Redbubble and TeePublic through the browser extension when your batch is ready.",
    name: "Browser upload",
    role: "More control before publishing",
  },
];

const faqs = [
  {
    question: "How does PodPilot work?",
    answer:
      "PodPilot gives you a dashboard to import design files, prepare listing metadata, review platform settings, and then send the ready queue to the browser extension for Redbubble and TeePublic upload automation.",
  },
  {
    question: "Which platforms are supported?",
    answer: "Redbubble and TeePublic are supported now.",
  },
  {
    question: "Do I need to give PodPilot my marketplace password?",
    answer:
      "No. Uploads run through your own browser session, so PodPilot does not need to store marketplace passwords.",
  },
  {
    question: "Can I upload designs in bulk?",
    answer:
      "Yes. You can bulk upload print on demand designs into PodPilot, match them with spreadsheet metadata, review the batch, and prepare it for Redbubble or TeePublic uploads.",
  },
  {
    question: "Can I edit colors and products for TeePublic?",
    answer:
      "Yes. You can review TeePublic product and color settings before starting the extension upload workflow.",
  },
  {
    question: "What happens to my designs?",
    answer:
      "Your designs remain yours. PodPilot organizes your files and listing data so you can prepare uploads from your own workspace.",
  },
  {
    question: "Can I cancel anytime?",
    answer: "Yes. You can upgrade, downgrade, or cancel anytime.",
  },
];

const landingSeoDescription =
  "Redbubble and TeePublic upload automation for POD sellers. Bulk upload print on demand designs, generate listing drafts, and publish from your browser.";

const landingJsonLd = [
  {
    "@type": "WebPage",
    "@id": "https://podpilot.space/#webpage",
    url: "https://podpilot.space/",
    name: "Redbubble & TeePublic Upload Automation for POD Sellers",
    description: landingSeoDescription,
    isPartOf: { "@id": "https://podpilot.space/#website" },
    about: { "@id": "https://podpilot.space/#software" },
  },
  {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    "@id": "https://podpilot.space/#landing-faq",
    mainEntity: faqs.map((faq) => ({
      "@type": "Question",
      name: faq.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: faq.answer,
      },
    })),
  },
];

export function LogoMark() {
  return (
    <a className="landing-logo-link" href="/" aria-label="PodPilot home">
      <img src="/brand/pod-pilot-logo.svg" alt="PodPilot" className="landing-logo" />
      <span>PodPilot</span>
    </a>
  );
}

export function LandingButton({ href = authHref, children, variant = "primary", extensionIcon = false, ...props }) {
  const isPrimary = variant === "primary";
  return (
    <a className={`landing-btn landing-btn-${variant}`} href={href} {...props}>
      {isPrimary && (
        <span className="landing-btn-icon-bubble" aria-hidden="true">
          <span className="landing-btn-svg landing-btn-gift" />
          <span className="landing-btn-svg landing-btn-sparkle" />
        </span>
      )}
      <span>{children}</span>
      {isPrimary ? (
        <span className="landing-btn-svg landing-btn-arrow" aria-hidden="true" />
      ) : extensionIcon ? (
        <span className="landing-btn-svg landing-btn-extension-icon" aria-hidden="true" />
      ) : (
        <Icon name="download" />
      )}
    </a>
  );
}

export function UserMenu({ email, onSignOut }) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef(null);

  // Close on outside click + Escape
  useEffect(() => {
    if (!open) return undefined;
    function onDocClick(event) {
      if (!wrapperRef.current) return;
      if (!wrapperRef.current.contains(event.target)) setOpen(false);
    }
    function onKey(event) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function handleNavigate(event, path) {
    event.preventDefault();
    setOpen(false);
    if (window.location.pathname !== path) {
      window.history.pushState(null, "", path);
      // App listens for popstate; emit a synthetic event so it picks up the change.
      window.dispatchEvent(new PopStateEvent("popstate"));
    }
    window.location.href = path;
  }

  async function handleSignOut(event) {
    event.preventDefault();
    setOpen(false);
    try {
      await onSignOut?.();
    } finally {
      // Ensure we land on the public landing page either way.
      if (window.location.pathname !== "/") {
        window.location.href = "/";
      }
    }
  }

  // Truncate the email so the pill stays compact.
  const display = email && email.length > 18 ? `${email.slice(0, 15)}…` : email || "Account";

  return (
    <div className="landing-user-menu" ref={wrapperRef}>
      <button
        type="button"
        className={`landing-user-pill${open ? " is-open" : ""}`}
        onClick={() => setOpen((current) => !current)}
        aria-haspopup="menu"
        aria-expanded={open}
        title={email || "Account"}
      >
        <span className="landing-user-avatar" aria-hidden="true">
          <User size={16} strokeWidth={2} />
        </span>
        <span className="landing-user-email">{display}</span>
        <ChevronDown
          size={16}
          strokeWidth={2}
          className={`landing-user-chevron${open ? " is-open" : ""}`}
        />
      </button>

      {open ? (
        <div className="landing-user-dropdown" role="menu">
          <a
            href="/dashboard"
            className="landing-user-item"
            role="menuitem"
            onClick={(event) => handleNavigate(event, "/dashboard")}
          >
            <LayoutDashboard size={16} strokeWidth={2} />
            <span>Dashboard</span>
          </a>
          <a
            href="/profile"
            className="landing-user-item"
            role="menuitem"
            onClick={(event) => handleNavigate(event, "/profile")}
          >
            <CircleUserRound size={16} strokeWidth={2} />
            <span>Profile</span>
          </a>
          <div className="landing-user-divider" />
          <button
            type="button"
            className="landing-user-item landing-user-signout"
            role="menuitem"
            onClick={handleSignOut}
          >
            <LogOut size={16} strokeWidth={2} />
            <span>Sign out</span>
          </button>
        </div>
      ) : null}
    </div>
  );
}

function DashboardMockup() {
  return (
    <div className="landing-mockup" aria-label="PodPilot dashboard preview">
      <div className="landing-mockup-topbar">
        <span />
        <span />
        <span />
      </div>

      <div className="landing-mockup-header">
        <div>
          <strong>Upload Queue</strong>
          <p>Today&apos;s POD batch</p>
        </div>
        <span className="landing-mockup-status">Live preview</span>
      </div>

      <div className="landing-stat-grid">
        <div className="landing-stat-card">
          <span>Total Designs</span>
          <strong>248</strong>
        </div>
        <div className="landing-stat-card">
          <span>Uploaded</span>
          <strong>186</strong>
        </div>
        <div className="landing-stat-card">
          <span>Pending</span>
          <strong>62</strong>
        </div>
      </div>

      <div className="landing-progress-card">
        <div>
          <span>Progress</span>
          <strong>75%</strong>
        </div>
        <div className="landing-progress-track">
          <span />
        </div>
      </div>

      <div className="landing-platform-cards">
        <article>
          <div className="landing-platform-title">
            <Icon name="redbubble" />
            <strong>Redbubble</strong>
          </div>
          <p>136 queued designs</p>
          <div className="landing-mini-track"><span style={{ width: "82%" }} /></div>
        </article>
        <article>
          <div className="landing-platform-title">
            <Icon name="teepublic" />
            <strong>TeePublic</strong>
          </div>
          <p>112 queued designs</p>
          <div className="landing-mini-track"><span style={{ width: "68%" }} /></div>
        </article>
      </div>
    </div>
  );
}

function FAQItem({ item, isOpen, onToggle }) {
  return (
    <div className={`landing-faq-item${isOpen ? " is-open" : ""}`}>
      <button type="button" onClick={onToggle} aria-expanded={isOpen}>
        <span>{item.question}</span>
        <Icon name="chevronDown" />
      </button>
      <div className="landing-faq-answer">
        <p>{item.answer}</p>
      </div>
    </div>
  );
}

export default function LandingPage({ theme, setTheme }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [openFaq, setOpenFaq] = useState(0);
  const auth = useAuth();
  const isAuthenticated = Boolean(auth?.user);
  const signOut = auth?.signOut;

  useSeo({
    title: "Redbubble & TeePublic Upload Automation",
    description: landingSeoDescription,
    canonical: "/",
    jsonLd: landingJsonLd,
  });

  useEffect(() => {
    if (window.location.hash === "#pricing") {
      window.location.replace("/pricing");
    }
  }, []);

  function closeMobileMenu() {
    setMobileOpen(false);
  }

  return (
    <main className="landing-page">
      <PublicHeader theme={theme} setTheme={setTheme} />

      <section className="landing-hero">
        <div className="landing-container landing-hero-grid">
          <div className="landing-hero-copy">
            <h1>Redbubble & TeePublic Upload Automation for POD Sellers</h1>
            <p>
              Bulk upload print on demand designs, edit listing metadata, generate AI listing drafts, check trademarks, and publish through the PodPilot browser extension.
            </p>
            <div className="landing-hero-actions">
              <LandingButton>Start Free Trial</LandingButton>
              <LandingButton href="/extension-download" variant="secondary" extensionIcon>Download Extension</LandingButton>
            </div>
            <small>Built for POD sellers who prepare and upload designs in batches.</small>
          </div>
          <ProductDemoVideo />
        </div>
      </section>

      <PlatformLogoStrip />

      <HowItWorksVideoSection />

      <section className="landing-section landing-safety">
        <div className="landing-container landing-safety-grid">
          <div>
            <h2>Browser-based POD upload automation with seller control</h2>
            <p>
              PodPilot helps you prepare the batch first, then uses your browser session to handle the upload workflow you would otherwise repeat by hand.
            </p>
          </div>
          <div className="landing-safety-list">
            {safetyPoints.map((point) => (
              <div key={point}>
                <Icon name="check" />
                <span>{point}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="landing-section landing-section-soft">
        <div className="landing-container">
          <div className="landing-section-heading">
            <h2>Print on demand listing tools for batch sellers</h2>
            <p>PodPilot is built around the daily work of preparing Redbubble and TeePublic listings in batches.</p>
          </div>
          <div className="landing-testimonial-grid">
            {testimonials.map((item) => (
              <article className="landing-testimonial-card" key={item.name}>
                <p>&ldquo;{item.quote}&rdquo;</p>
                <strong>{item.name}</strong>
                <span>{item.role}</span>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="landing-section" id="faq">
        <div className="landing-container landing-faq-grid">
          <div className="landing-section-heading landing-faq-heading">
            <h2>POD upload automation FAQ</h2>
            <p>Quick answers for sellers comparing PodPilot with manual Redbubble and TeePublic uploading.</p>
          </div>
          <div className="landing-faq-list">
            {faqs.map((item, index) => (
              <FAQItem
                key={item.question}
                item={item}
                isOpen={openFaq === index}
                onToggle={() => setOpenFaq((current) => (current === index ? -1 : index))}
              />
            ))}
          </div>
        </div>
      </section>

      <section className="landing-final-cta">
        <div className="landing-container landing-final-inner">
          <h2>Ready to bulk upload POD designs with less copy-paste?</h2>
          <div className="landing-hero-actions">
            <LandingButton>Start Free Trial</LandingButton>
            <LandingButton href="/extension-download" variant="secondary" extensionIcon>Download Extension</LandingButton>
          </div>
        </div>
      </section>

      <PublicFooter />
    </main>
  );
}
