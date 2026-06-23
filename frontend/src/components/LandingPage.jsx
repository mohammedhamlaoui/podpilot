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
    question: "What is PodPilot?",
    answer:
      "PodPilot is a browser-based upload automation and listing workflow tool for print-on-demand sellers who use Redbubble and TeePublic.",
  },
  {
    question: "Does PodPilot work with Redbubble?",
    answer:
      "Yes. PodPilot helps sellers prepare Redbubble listings, organize metadata, and run browser-based upload queues through the PodPilot extension.",
  },
  {
    question: "Does PodPilot work with TeePublic?",
    answer:
      "Yes. PodPilot helps sellers prepare TeePublic listings, review settings, and manage browser-based upload queues.",
  },
  {
    question: "Is PodPilot affiliated with Redbubble or TeePublic?",
    answer:
      "No. PodPilot is independent software and is not affiliated with, endorsed by, or partnered with Redbubble or TeePublic.",
  },
  {
    question: "How long are uploaded designs stored?",
    answer:
      "Uploaded design files are kept for 20 days, then automatically deleted. Designs you manually delete are also removed from active storage.",
  },
  {
    question: "Does PodPilot guarantee marketplace approval or sales?",
    answer:
      "No. Sellers remain responsible for reviewing content, designs, trademarks, and marketplace rules before publishing.",
  },
  {
    question: "Do I need to give PodPilot my marketplace password?",
    answer:
      "No. Uploads run through your own browser session, so PodPilot does not need to store marketplace passwords.",
  },
];

const landingSeoDescription =
  "Automate Redbubble and TeePublic upload workflows, prepare listings, organize metadata, and generate AI-assisted listing drafts for print-on-demand sellers.";

const landingJsonLd = [
  {
    "@type": "Organization",
    "@id": "https://podpilot.space/#organization",
    name: "PodPilot",
    url: "https://podpilot.space/",
    logo: "https://podpilot.space/brand/pod-pilot-logo.svg",
    contactPoint: {
      "@type": "ContactPoint",
      email: "support@podpilot.space",
      contactType: "customer support",
    },
  },
  {
    "@type": "SoftwareApplication",
    "@id": "https://podpilot.space/#software",
    name: "PodPilot",
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web, Chrome Extension",
    url: "https://podpilot.space/",
    description:
      "Browser-based upload automation and listing workflow tool for Redbubble and TeePublic sellers.",
    publisher: {
      "@id": "https://podpilot.space/#organization",
    },
  },
  {
    "@type": "WebSite",
    "@id": "https://podpilot.space/#website",
    name: "PodPilot",
    url: "https://podpilot.space/",
    publisher: {
      "@id": "https://podpilot.space/#organization",
    },
  },
  {
    "@type": "WebPage",
    "@id": "https://podpilot.space/#webpage",
    url: "https://podpilot.space/",
    name: "PodPilot - Redbubble & TeePublic Upload Automation",
    description: landingSeoDescription,
    isPartOf: { "@id": "https://podpilot.space/#website" },
    about: { "@id": "https://podpilot.space/#software" },
  },
  {
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
    title: "PodPilot - Redbubble & TeePublic Upload Automation",
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
              Bulk upload print on demand designs, edit listing metadata, generate AI listing Content, check trademarks, and publish through the PodPilot browser extension.
            </p>
            <div className="landing-hero-actions">
              <LandingButton>Start Free Trial</LandingButton>
              <LandingButton href="https://chromewebstore.google.com/detail/aloidebamibhnggbnlhoemnokkllkgdn?utm_source=item-share-cb" variant="secondary" extensionIcon>Download Extension</LandingButton>
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
            <LandingButton href="https://chromewebstore.google.com/detail/aloidebamibhnggbnlhoemnokkllkgdn?utm_source=item-share-cb" variant="secondary" extensionIcon>Download Extension</LandingButton>
          </div>
        </div>
      </section>

      <PublicFooter />
    </main>
  );
}
