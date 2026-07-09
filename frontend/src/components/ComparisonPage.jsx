import {
  ArrowRight,
  CheckCircle2,
  Layers,
  Monitor,
  Sparkles,
  Wallet,
} from "lucide-react";
import PublicHeader from "./PublicHeader";
import PublicFooter from "./PublicFooter";
import Icon from "./Icon";
import { LandingButton } from "./LandingPage";
import { useSeo } from "../utils/useSeo";

const canonicalPath = "/compare/podpilot-vs-merchghost-vs-merchtitans";
const canonicalUrl = `https://podpilot.space${canonicalPath}`;

const productLogos = {
  podpilot: "/brand/podpilot-logo-full.png",
  merchghost: "/brand/competitors/merchghost-logo.jpg",
  merchtitans: "/brand/competitors/merch-titans-logo.png",
};

const platformLogos = {
  redbubble: "/brand/redbubble-logo.svg",
  teepublic: "/brand/teepublic-logo.svg",
};

// Source note: comparison data is based on PodPilot repo pages/pricing plus public
// MerchGhost and Merch Titans official homepage/pricing pages reviewed July 9, 2026.
const faqItems = [
  {
    question: "What is the best MerchGhost alternative for Redbubble and TeePublic?",
    answer:
      "PodPilot is a good MerchGhost alternative to consider if your workflow is mainly Redbubble and TeePublic, and you want a focused, affordable upload automation tool with AI-assisted listing drafts. MerchGhost may still be a better fit if you specifically want its broader Amazon Merch, Redbubble, and TeePublic browser-extension workflow.",
  },
  {
    question: "Is PodPilot cheaper than Merch Titans?",
    answer:
      "Based on PodPilot pricing in this site and public Merch Titans pricing reviewed for this page, PodPilot's Redbubble + TeePublic plan costs less per month than Merch Titans' all-access plan. Pricing can change, so check the official pricing pages before buying.",
  },
  {
    question: "Does PodPilot support Redbubble uploads?",
    answer:
      "Yes. PodPilot includes Redbubble upload automation, design organization, metadata preparation, AI listing help, and a browser-based upload workflow.",
  },
  {
    question: "Does PodPilot support TeePublic uploads?",
    answer:
      "Yes. PodPilot includes TeePublic upload automation with listing prep, colors and product settings, AI metadata drafts, and a queue-friendly workflow for sellers managing multiple designs.",
  },
  {
    question: "Does PodPilot support Amazon Merch?",
    answer:
      "No. PodPilot is currently focused on Redbubble and TeePublic. If Amazon Merch automation is required today, compare tools that publicly list Amazon Merch support, such as MerchGhost or Merch Titans.",
  },
  {
    question: "Which tool is best for beginners?",
    answer:
      "PodPilot is built for beginners and small POD sellers who want a simpler Redbubble and TeePublic workflow. MerchGhost may be best for sellers who want its extension-first multi-platform setup, while Merch Titans may suit sellers who want a broader desktop tool with more platform coverage.",
  },
  {
    question: "Which POD upload automation tool is best for sellers on a budget?",
    answer:
      "For sellers who mainly use Redbubble and TeePublic, PodPilot is positioned as the budget-friendly choice because it avoids charging for wider marketplace coverage they may not use. Sellers who need Amazon Merch, Spreadshirt, Printful, MyDesigns, or other broader workflows should compare total platform needs before choosing.",
  },
  {
    question: "Can I use AI to generate Redbubble and TeePublic listings?",
    answer:
      "Yes. PodPilot includes AI-assisted listing drafts for titles, descriptions, and tags, then lets sellers review and edit the metadata before upload. AI should be treated as a draft helper, not a replacement for seller review.",
  },
];

const verdictCards = [
  {
    title: "Choose PodPilot",
    badge: "Best affordable choice",
    icon: Wallet,
    text: "Choose PodPilot if you want an affordable Redbubble and TeePublic automation tool with AI listing help, a simple dashboard, and a focused browser-based workflow.",
  },
  {
    title: "Choose MerchGhost",
    badge: "Extension-first workflow",
    icon: Monitor,
    text: "Choose MerchGhost if you want a browser-extension-first tool that publicly mentions Amazon Merch, Redbubble, and TeePublic support on its official pages.",
  },
  {
    title: "Choose Merch Titans",
    badge: "Broader coverage",
    icon: Layers,
    text: "Choose Merch Titans if you want a broader multi-platform automation tool and do not mind paying more for extra platform coverage and desktop-app features.",
  },
];

const comparisonRows = [
  {
    feature: "Best for",
    podpilot: "Small POD sellers focused on affordable Redbubble and TeePublic upload automation.",
    merchghost: "Sellers who want a Chrome extension workflow for Amazon Merch, Redbubble, and TeePublic.",
    merchtitans: "Sellers who want wider multi-platform coverage from a Windows/Mac desktop app.",
  },
  {
    feature: "Main platform focus",
    podpilot: "Redbubble + TeePublic.",
    merchghost: "Amazon Merch on Demand, Redbubble, and TeePublic according to its public site.",
    merchtitans: "Amazon Merch plus RedBubble, TeePublic, Spreadshirt, Printful, and MyDesigns according to its public site.",
  },
  {
    feature: "Redbubble support",
    podpilot: "Yes. Redbubble import, edit, AI metadata, and browser upload workflow.",
    merchghost: "Yes, listed publicly on its official site and pricing page.",
    merchtitans: "Yes, listed publicly as one of six platform integrations.",
  },
  {
    feature: "TeePublic support",
    podpilot: "Yes. TeePublic listing prep, settings workflow, and upload queue.",
    merchghost: "Yes, listed publicly on its official site and pricing page.",
    merchtitans: "Yes, listed publicly as one of six platform integrations.",
  },
  {
    feature: "Amazon Merch support",
    podpilot: "No. PodPilot is currently focused on Redbubble and TeePublic.",
    merchghost: "Yes, according to public MerchGhost pages.",
    merchtitans: "Yes. Merch Titans positions itself around Amazon Merch automation.",
  },
  {
    feature: "AI listing generation / AI SEO",
    podpilot: "AI-assisted listing drafts for titles, descriptions, and tags.",
    merchghost: "Public pricing page mentions AI Listing Content and AI tokens.",
    merchtitans: "Public site mentions AI-powered SEO for titles, bullets, and descriptions.",
  },
  {
    feature: "Browser-based workflow",
    podpilot: "Yes. PodPilot uses a browser-based workflow and Chrome extension upload flow.",
    merchghost: "Yes. MerchGhost positions itself as a browser-native Chrome extension.",
    merchtitans: "No browser extension required according to its pricing page; it lists a Windows/Mac desktop app.",
  },
  {
    feature: "Bulk upload workflow",
    podpilot: "Yes. Import, edit, prepare, and queue Redbubble/TeePublic listings.",
    merchghost: "Yes. Public pages describe bulk import and automated uploads.",
    merchtitans: "Yes. Public pages describe one-click bulk upload and parallel upload sessions.",
  },
  {
    feature: "Trademark scanning",
    podpilot: "Informational Trademark Check is listed in PodPilot pricing; sellers should still review manually.",
    merchghost: "Public pricing page lists Check Trademark; check the official pricing page for plan details.",
    merchtitans: "Public site describes a built-in trademark engine; check official pages for current behavior.",
  },
  {
    feature: "Pricing position",
    podpilot: "Focused low-cost plans: Redbubble or TeePublic from $4.99/mo, both from $6.99/mo monthly.",
    merchghost: "Public pricing reviewed showed plans from $14.99/mo, but check the official pricing page for latest details.",
    merchtitans: "Public pricing reviewed showed $39.99/mo monthly or $29.99/mo annually.",
  },
  {
    feature: "Beginner friendliness",
    podpilot: "High for Redbubble/TeePublic sellers who want a simple dashboard and fewer moving parts.",
    merchghost: "Good if the seller wants its extension-first workflow and supported platform set.",
    merchtitans: "Good for sellers ready for a broader desktop workflow and more platform coverage.",
  },
  {
    feature: "Best value if you only use Redbubble + TeePublic",
    podpilot: "Strong fit because you are not paying for extra marketplaces you may not use.",
    merchghost: "May be less focused if you do not need Amazon Merch or its other feature set.",
    merchtitans: "May be more than you need if you only want Redbubble and TeePublic.",
  },
];

const schemaGraph = [
  {
    "@type": "SoftwareApplication",
    "@id": `${canonicalUrl}#software`,
    name: "PodPilot",
    applicationCategory: "BusinessApplication",
    applicationSubCategory: "Print-on-demand upload automation",
    operatingSystem: "Web, Chrome Extension",
    url: canonicalUrl,
    description:
      "PodPilot is a browser-based upload automation workflow for Redbubble and TeePublic sellers with AI-assisted listing drafts.",
    offers: [
      {
        "@type": "Offer",
        name: "Redbubble",
        price: "4.99",
        priceCurrency: "USD",
        url: "https://podpilot.space/pricing",
      },
      {
        "@type": "Offer",
        name: "Redbubble + TeePublic",
        price: "6.99",
        priceCurrency: "USD",
        url: "https://podpilot.space/pricing",
      },
      {
        "@type": "Offer",
        name: "TeePublic",
        price: "4.99",
        priceCurrency: "USD",
        url: "https://podpilot.space/pricing",
      },
    ],
    featureList: [
      "Redbubble upload automation",
      "TeePublic upload automation",
      "AI-assisted listing metadata drafts",
      "Bulk design import and editing workflow",
      "Browser-based upload workflow",
      "Informational trademark checks",
    ],
    publisher: {
      "@type": "Organization",
      "@id": "https://podpilot.space/#organization",
      name: "PodPilot",
      url: "https://podpilot.space",
    },
  },
  {
    "@type": "FAQPage",
    "@id": `${canonicalUrl}#faq`,
    mainEntity: faqItems.map((faq) => ({
      "@type": "Question",
      name: faq.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: faq.answer,
      },
    })),
  },
  {
    "@type": "BreadcrumbList",
    "@id": `${canonicalUrl}#breadcrumb`,
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: "https://podpilot.space/" },
      { "@type": "ListItem", position: 2, name: "Compare", item: "https://podpilot.space/compare" },
      {
        "@type": "ListItem",
        position: 3,
        name: "PodPilot vs MerchGhost vs Merch Titans",
        item: canonicalUrl,
      },
    ],
  },
];

function CheckItem({ children }) {
  return (
    <li>
      <CheckCircle2 size={18} strokeWidth={2.2} />
      <span>{children}</span>
    </li>
  );
}

function ToolLogo({ name, src, className = "" }) {
  return (
    <span className={`comparison-tool-logo ${className}`.trim()}>
      <img src={src} alt={`${name} logo`} loading="lazy" decoding="async" />
    </span>
  );
}

function PlatformLogoChip({ name, src }) {
  return (
    <span className="comparison-platform-chip">
      <img src={src} alt={`${name} logo`} loading="lazy" decoding="async" />
      <strong>{name}</strong>
    </span>
  );
}

function ToolCard({ name, src, featured = false, className = "" }) {
  return (
    <span className={`comparison-tool-card${featured ? " is-featured" : ""}`.trim()}>
      <ToolLogo name={name} src={src} className={className} />
      <span>{name}</span>
    </span>
  );
}

export default function ComparisonPage({ theme, setTheme }) {
  useSeo({
    title: "PodPilot vs MerchGhost vs Merch Titans | POD Upload Automation Comparison",
    description:
      "Compare PodPilot, MerchGhost, and Merch Titans for print-on-demand upload automation. See which tool is best for Redbubble, TeePublic, AI listing generation, browser-based workflows, and affordable POD automation.",
    canonical: canonicalPath,
    ogImage: "https://podpilot.space/brand/podpilot-og-v2.png",
    ogType: "article",
    jsonLd: schemaGraph,
  });

  return (
    <main className="comparison-page">
      <PublicHeader theme={theme} setTheme={setTheme} guestCtaLabel="Start your 7-day free trial" />

      <section className="comparison-hero">
        <div className="landing-container comparison-hero-grid">
          <div className="comparison-hero-copy">
            <span className="comparison-kicker">POD automation comparison</span>
            <h1>PodPilot vs MerchGhost vs Merch Titans: Which POD Upload Automation Tool Should You Choose?</h1>
            <p>
              Compare three POD automation tools for Redbubble, TeePublic, Amazon Merch, AI listing generation,
              browser-based automation, pricing, and seller workflow.
            </p>
            <div className="comparison-hero-actions">
              <LandingButton href="/dashboard">Start your 7-day free trial</LandingButton>
              <LandingButton href="/pricing" variant="secondary">See PodPilot pricing</LandingButton>
            </div>
            <p className="comparison-disclaimer">
              This comparison is based on publicly available information at the time of writing. Features and prices may change.
            </p>
          </div>
          <div className="comparison-hero-panel" aria-label="PodPilot positioning summary">
            <div className="comparison-platform-line">
              <PlatformLogoChip name="Redbubble" src={platformLogos.redbubble} />
              <PlatformLogoChip name="TeePublic" src={platformLogos.teepublic} />
            </div>
            <div className="comparison-tool-line" aria-label="Compared software logos">
              <ToolCard name="PodPilot" src={productLogos.podpilot} className="is-podpilot" featured />
              <ToolCard name="MerchGhost" src={productLogos.merchghost} className="is-square" />
              <ToolCard name="Merch Titans" src={productLogos.merchtitans} className="is-wide" />
            </div>
            <strong>Best affordable choice for Redbubble + TeePublic sellers</strong>
            <p>
              PodPilot keeps the workflow focused: import designs, edit listing metadata, use AI-assisted drafts,
              review settings, and upload through your browser without paying for marketplace coverage you do not use.
            </p>
            <div className="comparison-mini-metrics">
              <span><Wallet size={16} /> From $6.99/mo for both</span>
              <span><Sparkles size={16} /> AI listing drafts</span>
              <span><Monitor size={16} /> Browser workflow</span>
            </div>
          </div>
        </div>
      </section>

      <section className="comparison-section">
        <div className="landing-container">
          <div className="comparison-section-heading">
            <span>Quick Verdict</span>
            <h2>Quick Verdict</h2>
            <p>
              There is no single best POD upload automation tool for every seller. The right choice depends on
              the marketplaces you actually use, how much setup you want, and whether you need a focused or broader workflow.
            </p>
          </div>
          <div className="comparison-verdict-grid">
            {verdictCards.map((card, index) => {
              const CardIcon = card.icon;
              return (
                <article className={index === 0 ? "comparison-verdict-card is-featured" : "comparison-verdict-card"} key={card.title}>
                  <div className="comparison-card-icon"><CardIcon size={22} /></div>
                  <span>{card.badge}</span>
                  <h3>{card.title}</h3>
                  <p>{card.text}</p>
                </article>
              );
            })}
          </div>
        </div>
      </section>

      <section className="comparison-section comparison-table-section">
        <div className="landing-container">
          <div className="comparison-section-heading">
            <span>Side by side</span>
            <h2>PodPilot vs MerchGhost vs Merch Titans Comparison</h2>
            <p>
              Use this table as a starting point, then check each official pricing page before subscribing. The
              goal is a practical fit, not a scoreboard.
            </p>
          </div>
          <div className="comparison-table-wrap">
            <table className="comparison-table">
              <thead>
                <tr>
                  <th>Feature</th>
                  <th>
                    <span className="comparison-table-logo-head">
                      <ToolLogo name="PodPilot" src={productLogos.podpilot} className="is-podpilot" />
                      PodPilot
                    </span>
                  </th>
                  <th>
                    <span className="comparison-table-logo-head">
                      <ToolLogo name="MerchGhost" src={productLogos.merchghost} className="is-square" />
                      MerchGhost
                    </span>
                  </th>
                  <th>
                    <span className="comparison-table-logo-head">
                      <ToolLogo name="Merch Titans" src={productLogos.merchtitans} className="is-wide" />
                      Merch Titans
                    </span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {comparisonRows.map((row) => (
                  <tr key={row.feature}>
                    <th scope="row">{row.feature}</th>
                    <td data-label="PodPilot">{row.podpilot}</td>
                    <td data-label="MerchGhost">{row.merchghost}</td>
                    <td data-label="Merch Titans">{row.merchtitans}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="comparison-section comparison-price-band">
        <div className="landing-container comparison-split">
          <div>
            <span className="comparison-kicker">Pricing fit</span>
            <h2>Which Tool Is Cheaper?</h2>
            <p>
              If a seller mainly uploads to Redbubble and TeePublic, PodPilot is the lower-cost, focused option
              because users are not paying for extra marketplace coverage they may not use. PodPilot's current
              public plans in this repo show Redbubble at $4.99/month, TeePublic at $4.99/month, and Redbubble +
              TeePublic at $6.99/month, with lower effective monthly pricing on annual billing.
            </p>
            <p>
              Based on official public pages reviewed for this comparison, MerchGhost lists plans beginning at
              $14.99/month and Merch Titans lists an all-access plan at $39.99/month monthly or $29.99/month when
              billed annually. Competitor pricing can change, so always check the official pricing pages before buying.
            </p>
          </div>
          <div className="comparison-price-card">
            <span>Focused value</span>
            <strong>$6.99/mo</strong>
            <p>PodPilot Redbubble + TeePublic monthly plan, based on the current PodPilot pricing component.</p>
            <a className="comparison-text-link" href="/pricing">
              See PodPilot pricing <ArrowRight size={16} />
            </a>
          </div>
        </div>
      </section>

      <section className="comparison-section">
        <div className="landing-container comparison-two-columns">
          <article className="comparison-deep-card">
            <div className="comparison-card-icon"><Icon name="redbubble" /></div>
            <h2>Best Redbubble Upload Automation Tool</h2>
            <p>
              PodPilot is especially strong for Redbubble sellers who want to organize design files, prepare
              metadata, and move through upload steps with fewer repeated clicks. Instead of treating Redbubble as
              one platform among many, PodPilot gives it a focused workflow: import your designs, match or create
              listing fields, review titles and tags, copy settings where useful, and prepare a cleaner browser
              upload flow.
            </p>
            <ul className="comparison-check-list">
              <CheckItem>Organize Redbubble design batches before publishing.</CheckItem>
              <CheckItem>Use AI listing drafts for titles, descriptions, and tags.</CheckItem>
              <CheckItem>Import and edit metadata in a simple dashboard.</CheckItem>
              <CheckItem>Use a lower-cost option for Redbubble-focused sellers.</CheckItem>
            </ul>
            <a href="/redbubble-upload-automation" className="comparison-text-link">
              Learn about Redbubble automation <ArrowRight size={16} />
            </a>
          </article>

          <article className="comparison-deep-card">
            <div className="comparison-card-icon"><Icon name="teepublic" /></div>
            <h2>Best TeePublic Upload Automation Tool</h2>
            <p>
              TeePublic sellers often need a different rhythm than Redbubble sellers: colors, product settings,
              primary tags, supporting tags, and listing copy need to stay organized across many designs. PodPilot
              keeps that workflow approachable for beginners while still supporting batch-friendly listing prep.
              You can draft metadata with AI, review it, organize a queue, and keep settings cleaner before upload.
            </p>
            <ul className="comparison-check-list">
              <CheckItem>Prepare TeePublic titles, descriptions, primary tags, and supporting tags.</CheckItem>
              <CheckItem>Manage colors, products, and listing settings in a focused flow.</CheckItem>
              <CheckItem>Keep batches easier to review before upload.</CheckItem>
              <CheckItem>Use a simple workflow without a broad enterprise-style setup.</CheckItem>
            </ul>
            <a href="/teepublic-upload-automation" className="comparison-text-link">
              Learn about TeePublic automation <ArrowRight size={16} />
            </a>
          </article>
        </div>
      </section>

      <section className="comparison-section comparison-choice-section">
        <div className="landing-container">
          <div className="comparison-section-heading">
            <span>Decision guide</span>
            <h2>Which POD Automation Tool Is Right for You?</h2>
            <p>
              A good POD upload automation tool should match your actual selling habits. Paying for every platform
              can be useful when you need every platform. It can also be unnecessary if your store strategy is
              currently Redbubble and TeePublic.
            </p>
          </div>
          <div className="comparison-choice-grid">
            <article>
              <h3>PodPilot is best if:</h3>
              <ul className="comparison-check-list">
                <CheckItem>You sell mainly on Redbubble and TeePublic.</CheckItem>
                <CheckItem>You want something simple and affordable.</CheckItem>
                <CheckItem>You want AI listing help for titles, descriptions, and tags.</CheckItem>
                <CheckItem>You do not need Amazon Merch automation yet.</CheckItem>
              </ul>
            </article>
            <article>
              <h3>MerchGhost may be best if:</h3>
              <ul className="comparison-check-list">
                <CheckItem>You specifically want their browser extension workflow.</CheckItem>
                <CheckItem>You need Amazon Merch, Redbubble, and TeePublic in one tool.</CheckItem>
                <CheckItem>You prefer their current feature set and pricing structure.</CheckItem>
              </ul>
            </article>
            <article>
              <h3>Merch Titans may be best if:</h3>
              <ul className="comparison-check-list">
                <CheckItem>You want wider multi-platform automation.</CheckItem>
                <CheckItem>You need AI SEO plus the trademark engine described on their site.</CheckItem>
                <CheckItem>You are okay with a higher price for broader coverage.</CheckItem>
              </ul>
            </article>
          </div>
        </div>
      </section>

      <section className="comparison-section comparison-ai-section">
        <div className="landing-container comparison-split">
          <div>
            <span className="comparison-kicker">AI listing workflow</span>
            <h2>AI Listing Generation Without Losing Control</h2>
            <p>
              AI can speed up Redbubble and TeePublic listing prep, but the safest workflow still keeps the seller
              in control. PodPilot uses AI as a draft helper for listing metadata. You can generate a first pass,
              edit the wording, remove irrelevant keywords, review potential risk, and publish only after the
              listing matches the design.
            </p>
            <p>
              That matters for beginners and small POD sellers because automation should reduce copy-paste work
              without creating a black-box publishing process. PodPilot keeps the import, edit, AI draft, review,
              and upload process visible in one dashboard.
            </p>
            <a href="/ai-listing-generator" className="comparison-text-link">
              Explore the AI listing generator <ArrowRight size={16} />
            </a>
          </div>
          <div className="comparison-ai-card">
            <Sparkles size={28} />
            <strong>Draft, review, then upload</strong>
            <p>Use AI for momentum, keep human judgment for accuracy, keyword fit, and marketplace policy safety.</p>
          </div>
        </div>
      </section>

      <section className="comparison-section comparison-faq-section" id="faq">
        <div className="landing-container">
          <div className="comparison-section-heading">
            <span>FAQ</span>
            <h2>Frequently Asked Questions</h2>
          </div>
          <div className="comparison-faq-list">
            {faqItems.map((faq) => (
              <article className="comparison-faq-item" key={faq.question}>
                <h3>{faq.question}</h3>
                <p>{faq.answer}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="comparison-final-cta">
        <div className="landing-container">
          <h2>Try the Affordable Redbubble and TeePublic Automation Tool</h2>
          <p>
            If you mainly sell on Redbubble and TeePublic, PodPilot gives you a focused, affordable workflow
            without paying for extra marketplace features you may not need.
          </p>
          <div className="comparison-hero-actions">
            <LandingButton href="/dashboard">Start your 7-day free trial today</LandingButton>
            <LandingButton href="/blog/redbubble-vs-teepublic-upload-workflow" variant="secondary">
              Read the workflow guide
            </LandingButton>
          </div>
        </div>
      </section>

      <PublicFooter />
    </main>
  );
}
