import {
  ArrowRight,
  Bot,
  Check,
  CircleCheck,
  Copy,
  Eye,
  Files,
  FolderKanban,
  Layers3,
  ListChecks,
  MousePointerClick,
  PackageCheck,
  Palette,
  PanelsTopLeft,
  Save,
  Sparkles,
  UploadCloud,
} from "lucide-react";
import PublicFooter from "./PublicFooter";
import PublicHeader from "./PublicHeader";
import { LandingButton } from "./LandingPage";
import { useSeo } from "../utils/useSeo";

export const canonicalPath = "/teepublic-automation-tool";
export const canonicalUrl = `https://podpilot.space${canonicalPath}`;
export const seoTitle = "TeePublic Automation Tool with AI | Bulk Upload Designs \u2013 PodPilot";
export const seoDescription =
  "Automate TeePublic uploads with PodPilot. Prepare designs in batches, generate titles, tags and descriptions with AI, configure colors and products, and upload faster with our Chrome extension.";

const trustItems = [
  "Built for TeePublic sellers",
  "AI-assisted listing generation",
  "Color and product configuration",
  "Chrome extension workflow",
];

const workflowSteps = [
  {
    number: "01",
    icon: UploadCloud,
    title: "Upload your designs",
    text: "Upload or import PNG artwork into PodPilot and keep each file attached to its listing record.",
  },
  {
    number: "02",
    icon: Bot,
    title: "Create or generate listing information",
    text: "Write metadata yourself or use AI to draft titles, descriptions, a main tag, and supporting tags.",
  },
  {
    number: "03",
    icon: Palette,
    title: "Choose colors and products",
    text: "Configure TeePublic product selections and color choices for the artwork you are preparing.",
  },
  {
    number: "04",
    icon: Eye,
    title: "Review every listing",
    text: "Check the image, title, description, tags, colors, and products before anything enters the queue.",
  },
  {
    number: "05",
    icon: PanelsTopLeft,
    title: "Start the TeePublic upload workflow",
    text: "Use the PodPilot Chrome extension to process prepared designs and track upload progress.",
  },
];

const comparisonRows = [
  ["Edit designs one by one", "Prepare designs in batches"],
  ["Write metadata manually", "Generate and edit metadata with AI"],
  ["Repeat product and color settings", "Copy and reuse prepared settings"],
  ["Switch between files and tabs", "Organize designs in one dashboard"],
  ["Hard to track large batches", "Follow progress from an upload queue"],
  ["Repeat browser actions", "Automate supported upload steps"],
];

const audienceItems = [
  {
    icon: Sparkles,
    title: "New TeePublic sellers",
    text: "Follow a clear preparation process for artwork, metadata, colors, and products.",
  },
  {
    icon: Layers3,
    title: "High-volume POD sellers",
    text: "Turn a large design folder into an organized, reviewed sequence.",
  },
  {
    icon: Files,
    title: "Designers with many PNG files",
    text: "Keep artwork matched to listing information and review status.",
  },
  {
    icon: Bot,
    title: "Sellers who need listing help",
    text: "Draft metadata with AI, then edit it for the design.",
  },
  {
    icon: FolderKanban,
    title: "TeePublic and Redbubble sellers",
    text: "Manage both supported marketplaces with separate workflows.",
  },
  {
    icon: ListChecks,
    title: "Sellers comparing simpler tools",
    text: "Consider a focused alternative to a broad multi-marketplace suite.",
  },
];

const faqItems = [
  {
    question: "What is a TeePublic automation tool?",
    answer:
      "A TeePublic automation tool helps sellers prepare listings and reduce repeated browser work. PodPilot combines editable metadata, product settings, a queue, and a Chrome extension workflow.",
  },
  {
    question: "Can I automate TeePublic uploads?",
    answer:
      "PodPilot can automate supported upload actions after you prepare and review your listings. Sellers should review current TeePublic policies and use automation responsibly.",
  },
  {
    question: "How can I upload multiple designs to TeePublic?",
    answer:
      "TeePublic offers its own bulk uploader. PodPilot lets you import designs, prepare AI-assisted metadata and settings, review listings, and process a browser queue.",
  },
  {
    question: "Does PodPilot work as a TeePublic bulk uploader?",
    answer:
      "PodPilot supports batch preparation and uploading with reusable settings, AI-assisted listing drafts, and visible queue progress. It does not claim to replace TeePublic's official bulk uploader.",
  },
  {
    question: "Can AI generate TeePublic titles, tags and descriptions?",
    answer:
      "Yes. PodPilot can draft titles, descriptions, a main tag, supporting tags, and related metadata. Every result remains editable before upload.",
  },
  {
    question: "Does PodPilot support TeePublic colors and products?",
    answer:
      "Yes. Choose available products and colors, then copy or paste those settings across prepared designs before upload.",
  },
  {
    question: "Do I need desktop software?",
    answer:
      "No desktop uploader is required. Prepare listings in the web dashboard and run supported actions through the Chrome extension.",
  },
  {
    question: "Can I review listings before uploading?",
    answer:
      "Yes. Review the artwork, metadata, colors, products, and prepared settings before starting the upload workflow.",
  },
  {
    question: "Does PodPilot also support Redbubble?",
    answer:
      "Yes. PodPilot supports Redbubble and TeePublic with separate preparation and browser-based upload workflows for each marketplace.",
  },
  {
    question: "Is PodPilot affiliated with TeePublic?",
    answer:
      "No. PodPilot is an independent productivity tool for print-on-demand sellers and is not affiliated with or endorsed by TeePublic.",
  },
];

export const schemaGraph = [
  {
    "@type": "BreadcrumbList",
    "@id": `${canonicalUrl}#breadcrumb`,
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: "https://podpilot.space/" },
      { "@type": "ListItem", position: 2, name: "TeePublic Automation Tool", item: canonicalUrl },
    ],
  },
  {
    "@type": "SoftwareApplication",
    "@id": `${canonicalUrl}#software`,
    name: "PodPilot",
    applicationCategory: "BusinessApplication",
    applicationSubCategory: "Print-on-demand upload automation",
    url: canonicalUrl,
    description: seoDescription,
    featureList: [
      "Batch design import and organization",
      "AI-assisted TeePublic listing metadata",
      "Editable titles, descriptions, main tags, and supporting tags",
      "TeePublic color and product configuration",
      "Reusable prepared settings",
      "Chrome extension upload workflow",
      "Upload queue and progress tracking",
    ],
    publisher: {
      "@type": "Organization",
      "@id": "https://podpilot.space/#organization",
      name: "PodPilot",
      url: "https://podpilot.space/",
    },
  },
  {
    "@type": "FAQPage",
    "@id": `${canonicalUrl}#faq`,
    mainEntity: faqItems.map((faq) => ({
      "@type": "Question",
      name: faq.question,
      acceptedAnswer: { "@type": "Answer", text: faq.answer },
    })),
  },
];

function TextLink({ href, children }) {
  return (
    <a className="rb-tool-text-link" href={href}>
      <span>{children}</span>
      <ArrowRight aria-hidden="true" size={16} />
    </a>
  );
}

export default function TeePublicAutomationToolPage() {
  useSeo({
    title: seoTitle,
    description: seoDescription,
    canonical: canonicalPath,
    ogImage: "https://podpilot.space/brand/podpilot-og-v2.png",
    ogType: "website",
    jsonLd: schemaGraph,
  });

  return (
    <div className="rb-tool-page tp-tool-page">
      <PublicHeader guestCtaLabel="Start your 7-day free trial" />

      <main>
        <section className="rb-tool-hero tp-tool-hero">
          <div className="landing-container rb-tool-hero-grid tp-tool-hero-grid">
            <div className="rb-tool-hero-copy">
              <span className="rb-tool-eyebrow"><CircleCheck size={16} /> TeePublic Upload Automation</span>
              <h1>TeePublic Automation Tool with AI</h1>
              <p>
                PodPilot is a TeePublic automation tool that helps print-on-demand sellers prepare multiple designs,
                generate titles, tags and descriptions with AI, configure colors and products, and automate repetitive
                TeePublic upload tasks through a browser-based workflow.
              </p>
              <div className="rb-tool-actions">
                <LandingButton href="/dashboard">Start your 7-day free trial</LandingButton>
                <LandingButton href="#workflow" variant="secondary">See how it works</LandingButton>
              </div>
              <ul className="rb-tool-trust-row" aria-label="PodPilot TeePublic product highlights">
                {trustItems.map((item) => (
                  <li key={item}><Check size={14} aria-hidden="true" /> {item}</li>
                ))}
              </ul>
            </div>

            <figure className="rb-tool-hero-visual tp-tool-hero-visual">
              <div className="tp-tool-visual-label">
                <img src="/platforms/teepublic-logo.svg" alt="" width="30" height="30" />
                <span>TeePublic preparation workspace</span>
              </div>
              <img
                src="/videos/posters/podpilot-hero-demo-poster.jpg"
                alt="PodPilot TeePublic upload automation dashboard with the TeePublic upload workflow selected"
                width="1920"
                height="1080"
                fetchPriority="high"
                decoding="async"
              />
              <figcaption>
                <span><Palette size={15} /> Colors and products</span>
                <span><ListChecks size={15} /> Prepared upload queue</span>
              </figcaption>
            </figure>
          </div>
        </section>

        <section className="rb-tool-section rb-tool-intro-section">
          <div className="landing-container rb-tool-split">
            <div className="rb-tool-section-heading">
              <span className="rb-tool-section-number">01</span>
              <h2>Automate Your TeePublic Uploads</h2>
            </div>
            <div className="rb-tool-prose">
              <p>
                Manual TeePublic preparation repeats the same decisions: write a title and description, separate the
                main tag from supporting tags, then choose suitable products and colors. PodPilot puts that work in one
                dashboard so TeePublic upload automation begins with an organized, reviewable listing instead of a
                blank marketplace form.
              </p>
              <p>
                Use the TeePublic upload tool to edit each design independently, reuse settings where they fit, and
                decide when the batch is ready. You can automate TeePublic uploads while keeping the final image,
                metadata, product selection, and color choices under seller control.
              </p>
              <ul className="rb-tool-benefits">
                <li><Check /> Prepare listings faster</li>
                <li><Check /> Generate metadata with AI</li>
                <li><Check /> Reuse colors and products</li>
                <li><Check /> Track designs in one dashboard</li>
              </ul>
            </div>
          </div>
        </section>

        <section className="rb-tool-section rb-tool-batch-section tp-tool-batch-section">
          <div className="landing-container rb-tool-batch-grid">
            <div>
              <span className="rb-tool-section-number">02</span>
              <h2>Upload Multiple Designs to TeePublic Faster</h2>
              <p>
                Import multiple PNG designs, organize them as a batch, prepare metadata before upload, and configure
                products and colors for each design. Ready listings move into the browser workflow while queue status
                shows what is waiting, processing, or complete.
              </p>
              <p>
                PodPilot works as a TeePublic bulk uploader workflow with an emphasis on preparation. It adds AI
                listing drafts, centralized organization, reusable settings, and progress visibility for sellers who
                want to upload multiple designs to TeePublic without rebuilding every listing from scratch.
              </p>
              <TextLink href="/blog/how-to-bulk-upload-designs-to-teepublic">
                Read the TeePublic bulk upload guide
              </TextLink>
            </div>
            <aside className="tp-tool-official-note">
              <span>Useful context</span>
              <p>
                TeePublic also offers its own bulk uploader. PodPilot adds AI-assisted listing preparation, reusable
                settings, and a focused browser workflow.
              </p>
              <div className="tp-tool-pipeline" aria-label="TeePublic bulk upload tool preparation stages">
                {[
                  [Files, "Design batch"],
                  [Bot, "AI metadata"],
                  [Palette, "Colors + products"],
                  [ListChecks, "Tracked queue"],
                ].map(([Icon, label]) => (
                  <span key={label}><Icon aria-hidden="true" size={17} /> {label}</span>
                ))}
              </div>
            </aside>
          </div>
        </section>

        <section className="rb-tool-section rb-tool-ai-section tp-tool-ai-section">
          <div className="landing-container rb-tool-ai-grid">
            <div className="rb-tool-ai-copy">
              <span className="rb-tool-section-number">03</span>
              <h2>Generate TeePublic Listings with AI</h2>
              <p>
                PodPilot's TeePublic AI listing generator can draft a title, description, main tag, supporting tags,
                and related listing metadata. AI-powered TeePublic automation is especially helpful when a folder of
                artwork has no prepared copy and every blank listing slows the batch down.
              </p>
              <p>
                Generated content remains editable before saving or uploading. Review every keyword for relevance,
                remove anything that does not describe the artwork, and keep the final decision. AI can reduce writing
                time, but it does not guarantee sales, search placement, or marketplace rankings.
              </p>
              <TextLink href="/ai-listing-generator">Explore the AI listing generator</TextLink>
            </div>
            <div className="rb-tool-before-after tp-tool-before-after" aria-label="TeePublic AI listing draft example">
              <div>
                <span>Before</span>
                <strong>Artwork only</strong>
                <small>No title &middot; No description &middot; No tags</small>
              </div>
              <ArrowRight aria-hidden="true" />
              <div className="is-after">
                <span>After</span>
                <strong>Listing draft</strong>
                <small>Title &middot; Description &middot; Main tag &middot; Supporting tags</small>
                <em>Ready for seller review</em>
              </div>
            </div>
          </div>
        </section>

        <section className="rb-tool-section rb-tool-workflow-section tp-tool-workflow-section" id="workflow">
          <div className="landing-container">
            <div className="rb-tool-centered-heading">
              <span className="rb-tool-section-number">04</span>
              <h2>How the PodPilot TeePublic Auto Uploader Works</h2>
              <p>A five-step review path moves each design from a local file to a prepared TeePublic browser queue.</p>
            </div>
            <ol className="rb-tool-workflow-list tp-tool-workflow-list">
              {workflowSteps.map((step) => {
                const StepIcon = step.icon;
                return (
                  <li key={step.number}>
                    <span className="rb-tool-step-number">{step.number}</span>
                    <StepIcon aria-hidden="true" />
                    <div><h3>{step.title}</h3><p>{step.text}</p></div>
                  </li>
                );
              })}
            </ol>
            <div className="rb-tool-workflow-cta">
              <LandingButton href="/dashboard">Start automating TeePublic uploads</LandingButton>
            </div>
          </div>
        </section>

        <section className="rb-tool-section tp-tool-settings-section">
          <div className="landing-container tp-tool-settings-grid">
            <div>
              <span className="rb-tool-section-number">05</span>
              <h2>Manage TeePublic Colors and Products</h2>
              <p>
                A TeePublic automation tool should account for more than metadata. PodPilot lets you choose available
                colors, turn product selections on or off, and review each design before upload. Product coverage stays
                part of preparation instead of a rushed final step.
              </p>
              <p>
                Copy colors, products, or the full configuration from a prepared design, then paste those settings to
                one design or the prepared batch when they fit. You can still open designs independently, make
                exceptions, and save the current listing before the queue starts.
              </p>
            </div>
            <div className="tp-tool-settings-board" aria-label="TeePublic color and product preparation features">
              <div className="tp-tool-settings-head">
                <img src="/brand/podpilot-icon.png" alt="" width="512" height="512" />
                <div><strong>Prepared settings</strong><span>Review before upload</span></div>
                <CircleCheck aria-hidden="true" />
              </div>
              <div className="tp-tool-setting-row">
                <span><Palette size={17} /> Product colors</span>
                <div className="tp-tool-swatches" aria-label="Example supported color choices">
                  <i className="is-asphalt" /><i className="is-navy" /><i className="is-creme" /><i className="is-purple" />
                </div>
              </div>
              <div className="tp-tool-product-chips">
                {[
                  "T-Shirt", "Hoodie", "Tank", "Mugs", "Wall Art", "Stickers",
                ].map((product) => <span key={product}><Check size={13} /> {product}</span>)}
              </div>
              <div className="tp-tool-settings-actions">
                <span><Copy size={15} /> Copy colors or products</span>
                <span><Save size={15} /> Save prepared design</span>
              </div>
            </div>
          </div>
        </section>

        <section className="rb-tool-section rb-tool-extension-section tp-tool-extension-section">
          <div className="landing-container rb-tool-extension-grid">
            <div className="rb-tool-extension-mark tp-tool-extension-mark" aria-hidden="true">
              <img className="rb-tool-extension-logo" src="/brand/podpilot-icon.png" alt="" width="512" height="512" />
              <span>PodPilot</span>
              <MousePointerClick />
            </div>
            <div>
              <span className="rb-tool-section-number">06</span>
              <h2>Why Use a TeePublic Chrome Extension?</h2>
              <p>
                A TeePublic Chrome extension works inside the browser where you already manage your seller session.
                PodPilot keeps listing preparation in its dashboard, then passes reviewed queue data to the extension
                for supported form-filling and upload actions. This reduces repeated clicking while keeping the queue
                visible and preparation separate from the marketplace page.
              </p>
              <p>
                Progress remains visible as prepared designs move through the browser workflow. PodPilot is an
                independent productivity tool. Sellers should review TeePublic's policies and use automation responsibly.
              </p>
            </div>
          </div>
        </section>

        <section className="rb-tool-section rb-tool-comparison-section">
          <div className="landing-container">
            <div className="rb-tool-centered-heading">
              <span className="rb-tool-section-number">07</span>
              <h2>PodPilot vs Manual TeePublic Uploading</h2>
              <p>This comparison is about two working methods, not a comparison between PodPilot and TeePublic.</p>
            </div>
            <div className="rb-tool-table-wrap">
              <table className="rb-tool-table">
                <thead><tr><th>Manual TeePublic Uploading</th><th>PodPilot</th></tr></thead>
                <tbody>
                  {comparisonRows.map(([manual, podpilot]) => (
                    <tr key={manual}>
                      <td data-label="Manual workflow">{manual}</td>
                      <td data-label="PodPilot workflow"><Check size={16} /> {podpilot}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <section className="rb-tool-section rb-tool-audience-section tp-tool-audience-section">
          <div className="landing-container">
            <div className="rb-tool-centered-heading">
              <span className="rb-tool-section-number">08</span>
              <h2>Who Is PodPilot Built For?</h2>
              <p>PodPilot suits sellers who want a visible preparation layer between a design folder and TeePublic.</p>
            </div>
            <div className="rb-tool-audience-grid tp-tool-audience-grid">
              {audienceItems.map((item) => {
                const ItemIcon = item.icon;
                return (
                  <article key={item.title}>
                    <ItemIcon aria-hidden="true" />
                    <div><h3>{item.title}</h3><p>{item.text}</p></div>
                  </article>
                );
              })}
            </div>
          </div>
        </section>

        <section className="rb-tool-section rb-tool-focus-section tp-tool-focus-section">
          <div className="landing-container rb-tool-focus-grid">
            <div>
              <span className="rb-tool-section-number">09</span>
              <h2>TeePublic Automation Without Unnecessary Complexity</h2>
              <p>
                PodPilot focuses on the practical work around TeePublic and Redbubble: organize designs, prepare
                marketplace-specific metadata, reuse settings, review listings, and run a browser queue. The result is
                focused TeePublic automation software that is easier to learn than a tool built around marketplaces
                you never use.
              </p>
              <p>
                Choose PodPilot when you want AI assistance and a browser-based process without a sprawling platform.
                Its focused scope supports more affordable positioning than broader multi-platform tools. Explore the
                broader <a href="/teepublic-upload-automation">TeePublic upload automation workflow</a>, or compare
                supported approaches before choosing a plan. Sellers working across marketplaces can also review the
                <a href="/redbubble-upload-automation"> Redbubble upload automation workflow</a>.
              </p>
              <TextLink href="/compare/podpilot-vs-merchghost-vs-merchtitans">
                Compare PodPilot with MerchGhost and Merch Titans
              </TextLink>
            </div>
            <aside className="rb-tool-focus-list">
              <strong>One focused TeePublic workflow</strong>
              <span><PackageCheck /> Product selection</span>
              <span><Palette /> Color configuration</span>
              <span><Bot /> AI listing preparation</span>
              <span><ListChecks /> Queue and progress tracking</span>
              <a href="/redbubble-automation-tool">Explore the Redbubble automation tool <ArrowRight size={15} /></a>
            </aside>
          </div>
        </section>

        <section className="rb-tool-section rb-tool-faq-section" id="faq">
          <div className="landing-container rb-tool-faq-grid">
            <div className="rb-tool-faq-intro">
              <span className="rb-tool-section-number">10</span>
              <h2>Frequently Asked Questions</h2>
              <p>Clear answers about TeePublic preparation, bulk workflows, AI, colors, products, and browser uploads.</p>
              <TextLink href="/help-center">Visit the PodPilot help center</TextLink>
            </div>
            <div className="rb-tool-faq-list">
              {faqItems.map((faq) => (
                <details key={faq.question}>
                  <summary>{faq.question}<span aria-hidden="true">+</span></summary>
                  <p>{faq.answer}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <section className="rb-tool-final-cta tp-tool-final-cta">
          <div className="landing-container rb-tool-final-inner">
            <span>Prepare. Review. Upload.</span>
            <h2>Save Time on Your TeePublic Upload Workflow</h2>
            <p>
              Prepare designs, generate listing metadata with AI, configure colors and products, and automate
              repetitive TeePublic upload tasks from one focused workflow.
            </p>
            <div className="rb-tool-actions">
              <LandingButton href="/dashboard">Start your 7-day free trial</LandingButton>
              <LandingButton href="/pricing" variant="secondary">View pricing</LandingButton>
            </div>
            <small>No long-term commitment. Review your listings before uploading.</small>
          </div>
        </section>
      </main>

      <PublicFooter />
    </div>
  );
}
