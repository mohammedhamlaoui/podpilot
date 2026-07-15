import {
  ArrowRight,
  Bot,
  Check,
  CircleCheck,
  Files,
  FolderKanban,
  Layers3,
  ListChecks,
  MousePointerClick,
  PanelsTopLeft,
  Palette,
  Sparkles,
  UploadCloud,
} from "lucide-react";
import PublicFooter from "./PublicFooter";
import PublicHeader from "./PublicHeader";
import { LandingButton } from "./LandingPage";
import { useSeo } from "../utils/useSeo";

export const canonicalPath = "/redbubble-automation-tool";
export const canonicalUrl = `https://podpilot.space${canonicalPath}`;
export const seoTitle = "Redbubble Automation Tool with AI | Bulk Upload Designs \u2013 PodPilot";
export const seoDescription =
  "Automate Redbubble uploads with PodPilot. Bulk upload designs, generate titles, tags and descriptions with AI, and save hours using our Chrome extension.";

const trustItems = [
  "Built for Redbubble sellers",
  "AI-assisted listings",
  "Browser-based upload workflow",
  "7-day free trial",
];

const workflowSteps = [
  {
    number: "01",
    icon: UploadCloud,
    title: "Upload your designs",
    text: "Upload or import PNG artwork into PodPilot. Keep files and listing records together before you publish.",
  },
  {
    number: "02",
    icon: Bot,
    title: "Create or edit listing information",
    text: "Write metadata manually or generate titles, descriptions, main tags, and supporting tags using AI.",
  },
  {
    number: "03",
    icon: Palette,
    title: "Choose products, colors, and settings",
    text: "Prepare the product configuration for each design and review the details while they are still easy to change.",
  },
  {
    number: "04",
    icon: PanelsTopLeft,
    title: "Start the Redbubble upload workflow",
    text: "Use the PodPilot Chrome extension to process prepared designs and follow progress from the queue.",
  },
];

const comparisonRows = [
  ["Upload one design at a time", "Prepare designs in batches"],
  ["Write each listing manually", "Generate and edit metadata with AI"],
  ["Repeat product and color settings", "Reuse prepared settings"],
  ["Switch between files and browser tabs", "Organize designs in one dashboard"],
  ["Difficult to track many uploads", "Follow progress from the upload queue"],
  ["Repetitive browser steps", "Automate supported upload actions with the extension"],
];

const audienceItems = [
  {
    icon: Sparkles,
    title: "New Redbubble sellers",
    text: "Build a repeatable publishing process without piecing together files, notes, and browser tabs.",
  },
  {
    icon: Layers3,
    title: "High-volume POD sellers",
    text: "Prepare larger batches carefully and keep a visible queue instead of losing track of what is next.",
  },
  {
    icon: Files,
    title: "Designers with many PNG files",
    text: "Match artwork with listing information and review the collection from one focused workspace.",
  },
  {
    icon: FolderKanban,
    title: "Redbubble and TeePublic sellers",
    text: "Manage two supported marketplace workflows without treating TeePublic as an afterthought.",
  },
  {
    icon: ListChecks,
    title: "Sellers comparing simpler tools",
    text: "Evaluate a focused MerchGhost alternative for Redbubble and TeePublic before paying for broader platform coverage.",
  },
];

const faqItems = [
  {
    question: "What is a Redbubble automation tool?",
    answer:
      "It is productivity software that helps sellers prepare listings and reduce repeated upload work. PodPilot combines design organization, editable metadata, a queue, and a browser-extension workflow.",
  },
  {
    question: "Can I automate Redbubble uploads?",
    answer:
      "PodPilot can automate supported browser actions after you prepare and review your listings. Sellers should follow current marketplace rules and use automation responsibly.",
  },
  {
    question: "How can I bulk upload designs to Redbubble?",
    answer:
      "Import multiple designs, add or generate their metadata, review settings, then move prepared items into the upload queue. The extension processes the queue through your browser workflow.",
  },
  {
    question: "Does PodPilot work as a Redbubble auto uploader?",
    answer:
      "Yes. PodPilot prepares the batch in its dashboard and uses a Chrome extension to handle supported upload steps from the queue. Uploads are processed as a controlled workflow, not all at once.",
  },
  {
    question: "Can AI generate Redbubble titles, tags and descriptions?",
    answer:
      "Yes. PodPilot can draft titles, descriptions, main tags, supporting tags, and related listing metadata. You can edit the result before saving or uploading it.",
  },
  {
    question: "Do I need to install software?",
    answer:
      "You use the PodPilot web dashboard for preparation and install the PodPilot Chrome extension for the browser upload workflow. No desktop uploader is required.",
  },
  {
    question: "Can I review my listings before uploading?",
    answer:
      "Yes. Titles, descriptions, tags, product choices, colors, and other prepared settings remain available for review and editing before the upload workflow starts.",
  },
  {
    question: "Does PodPilot also support TeePublic?",
    answer:
      "Yes. TeePublic is an active supported platform with its own listing preparation and browser-based upload workflow.",
  },
  {
    question: "Is PodPilot an official Redbubble partner?",
    answer:
      "No. PodPilot is an independent productivity tool for print-on-demand sellers and is not affiliated with or endorsed by Redbubble.",
  },
];

export const schemaGraph = [
  {
    "@type": "BreadcrumbList",
    "@id": `${canonicalUrl}#breadcrumb`,
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: "https://podpilot.space/" },
      { "@type": "ListItem", position: 2, name: "Redbubble Automation Tool", item: canonicalUrl },
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
      "AI-assisted listing metadata",
      "Editable titles, descriptions, main tags, and supporting tags",
      "Redbubble product and color preparation",
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

export default function RedbubbleAutomationToolPage() {
  useSeo({
    title: seoTitle,
    description: seoDescription,
    canonical: canonicalPath,
    ogImage: "https://podpilot.space/brand/podpilot-og-v2.png",
    ogType: "website",
    jsonLd: schemaGraph,
  });

  return (
    <div className="rb-tool-page">
      <PublicHeader guestCtaLabel="Start your 7-day free trial" />

      <main>
        <section className="rb-tool-hero">
          <div className="landing-container rb-tool-hero-grid">
            <div className="rb-tool-hero-copy">
              <span className="rb-tool-eyebrow"><CircleCheck size={16} /> Redbubble Upload Automation</span>
              <h1>Redbubble Automation Tool with AI</h1>
              <p>
                PodPilot is a Redbubble automation tool that helps print-on-demand sellers organize and upload designs
                in batches, generate titles, tags and descriptions with AI, and automate repetitive Redbubble upload
                tasks using a browser-based workflow.
              </p>
              <div className="rb-tool-actions">
                <LandingButton href="/dashboard">Start your 7-day free trial</LandingButton>
                <LandingButton href="#workflow" variant="secondary">See how it works</LandingButton>
              </div>
              <ul className="rb-tool-trust-row" aria-label="PodPilot product highlights">
                {trustItems.map((item) => (
                  <li key={item}><Check size={14} aria-hidden="true" /> {item}</li>
                ))}
              </ul>
            </div>

            <figure className="rb-tool-hero-visual">
              <img
                src="/brand/redbubble-automation-dashboard.png"
                alt="PodPilot Redbubble upload automation dashboard showing prepared designs and upload queue progress"
                width="1918"
                height="1120"
                fetchPriority="high"
                decoding="async"
              />
              <figcaption>
                <span><PanelsTopLeft size={15} /> Browser workflow</span>
                <span><ListChecks size={15} /> Prepared queue</span>
              </figcaption>
            </figure>
          </div>
        </section>

        <section className="rb-tool-section rb-tool-intro-section">
          <div className="landing-container rb-tool-split">
            <div className="rb-tool-section-heading">
              <span className="rb-tool-section-number">01</span>
              <h2>Automate Your Redbubble Uploads</h2>
            </div>
            <div className="rb-tool-prose">
              <p>
                Manual publishing becomes repetitive because every design needs a title, description, tags, colors,
                product settings, and the same browser steps. PodPilot brings that preparation into one dashboard.
                Its Redbubble upload automation workflow gives sellers a place to organize the work before the
                marketplace form opens.
              </p>
              <p>
                You stay in control of the final listing. Use the Redbubble upload tool to review and edit each item,
                reuse prepared product and color settings where appropriate, and start automation only when the batch
                is ready. That makes it easier to automate Redbubble uploads without turning publishing into a blind process.
              </p>
              <ul className="rb-tool-benefits">
                <li><Check /> Prepare listings faster</li>
                <li><Check /> Reuse product and color settings</li>
                <li><Check /> Track designs in one dashboard</li>
                <li><Check /> Review every listing before upload</li>
              </ul>
            </div>
          </div>
        </section>

        <section className="rb-tool-section rb-tool-batch-section">
          <div className="landing-container rb-tool-batch-grid">
            <div>
              <span className="rb-tool-section-number">02</span>
              <h2>Upload Multiple Designs to Redbubble</h2>
              <p>
                A useful Redbubble bulk uploader starts with organization. Import multiple PNG designs, keep them
                inside PodPilot, edit metadata across the batch, and send only prepared items into the upload queue.
                You can follow progress without reopening every file and rebuilding the same listing from scratch.
              </p>
              <p>
                PodPilot works as a Redbubble bulk upload tool for sequential browser processing. It does not imply
                that every marketplace upload happens simultaneously. If you want to upload multiple designs to
                Redbubble, the advantage is a cleaner pipeline from files to reviewed listings to queue status.
              </p>
              <TextLink href="/blog/how-to-bulk-upload-designs-to-redbubble">
                Read the Redbubble bulk upload guide
              </TextLink>
            </div>
            <aside className="rb-tool-batch-callout">
              <div className="rb-tool-queue-rail" aria-hidden="true">
                {["Design files", "Listing metadata", "Ready queue", "Browser upload"].map((label, index) => (
                  <span key={label}><b>{index + 1}</b>{label}</span>
                ))}
              </div>
              <p>&ldquo;Prepare designs in batches, then let PodPilot handle the repetitive browser workflow.&rdquo;</p>
            </aside>
          </div>
        </section>

        <section className="rb-tool-section rb-tool-ai-section">
          <div className="landing-container rb-tool-ai-grid">
            <div className="rb-tool-ai-copy">
              <span className="rb-tool-section-number">03</span>
              <h2>Generate Redbubble Listings with AI</h2>
              <p>
                PodPilot&apos;s Redbubble AI listing generator can draft titles, descriptions, main tags, supporting tags,
                and related listing metadata. AI-powered Redbubble automation is most useful at the blank-page stage:
                it creates a structured first pass, while you keep responsibility for relevance and accuracy.
              </p>
              <p>
                Review and edit generated content before saving or uploading. AI does not guarantee sales, search
                placement, or marketplace approval. It simply helps move a design from an empty record to a complete
                draft that is ready for human judgment.
              </p>
              <TextLink href="/ai-listing-generator">Explore the AI listing generator</TextLink>
            </div>
            <div className="rb-tool-before-after" aria-label="AI listing draft example">
              <div>
                <span>Before</span>
                <strong>Untitled design</strong>
                <small>No description Â· No tags</small>
              </div>
              <ArrowRight aria-hidden="true" />
              <div className="is-after">
                <span>After</span>
                <strong>Generated listing draft</strong>
                <small>Title Â· Description Â· Relevant tags</small>
                <em>Ready for review</em>
              </div>
            </div>
          </div>
        </section>

        <section className="rb-tool-section rb-tool-workflow-section" id="workflow">
          <div className="landing-container">
            <div className="rb-tool-centered-heading">
              <span className="rb-tool-section-number">04</span>
              <h2>How the PodPilot Redbubble Auto Uploader Works</h2>
              <p>Four visible stages take a design from your computer to a prepared browser upload queue.</p>
            </div>
            <ol className="rb-tool-workflow-list">
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
              <LandingButton href="/dashboard">Start automating Redbubble uploads</LandingButton>
            </div>
          </div>
        </section>

        <section className="rb-tool-section rb-tool-extension-section">
          <div className="landing-container rb-tool-extension-grid">
            <div className="rb-tool-extension-mark" aria-hidden="true">
              <PanelsTopLeft />
              <span>PodPilot</span>
              <MousePointerClick />
            </div>
            <div>
              <span className="rb-tool-section-number">05</span>
              <h2>Why Use a Redbubble Chrome Extension?</h2>
              <p>
                A Redbubble Chrome extension works inside the seller&apos;s existing browser workflow. PodPilot uses your
                current Redbubble session, so the preparation dashboard stays separate from the marketplace upload
                page while the extension reduces repeated clicking and form filling.
              </p>
              <p>
                Queue and progress states help you see which prepared design is being processed and what still needs
                attention. The browser model keeps the workflow understandable, but it does not remove seller
                responsibility. Users should review marketplace rules and use automation responsibly.
              </p>
              <TextLink href="/redbubble-upload-automation">See the broader Redbubble upload automation workflow</TextLink>
            </div>
          </div>
        </section>

        <section className="rb-tool-section rb-tool-comparison-section">
          <div className="landing-container">
            <div className="rb-tool-centered-heading">
              <span className="rb-tool-section-number">06</span>
              <h2>PodPilot vs Manual Redbubble Uploading</h2>
              <p>The difference is preparation and visibility, not a promise to remove every decision.</p>
            </div>
            <div className="rb-tool-table-wrap">
              <table className="rb-tool-table">
                <thead><tr><th>Manual Redbubble Uploading</th><th>PodPilot</th></tr></thead>
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

        <section className="rb-tool-section rb-tool-audience-section">
          <div className="landing-container">
            <div className="rb-tool-centered-heading">
              <span className="rb-tool-section-number">07</span>
              <h2>Who Is PodPilot Built For?</h2>
              <p>It is designed for sellers who want a focused workflow and enough control to review the details.</p>
            </div>
            <div className="rb-tool-audience-grid">
              {audienceItems.map((item, index) => {
                const ItemIcon = item.icon;
                return (
                  <article key={item.title} className={index === 0 || index === 3 ? "is-wide" : ""}>
                    <ItemIcon aria-hidden="true" />
                    <div><h3>{item.title}</h3><p>{item.text}</p></div>
                  </article>
                );
              })}
            </div>
          </div>
        </section>

        <section className="rb-tool-section rb-tool-focus-section">
          <div className="landing-container rb-tool-focus-grid">
            <div>
              <span className="rb-tool-section-number">08</span>
              <h2>Redbubble Automation Without Unnecessary Complexity</h2>
              <p>
                PodPilot focuses on practical tools for Redbubble and TeePublic: simple design management, AI listing
                preparation, an upload queue, and a browser-extension workflow. That focused scope supports lower-cost
                positioning than broader tools built around many marketplaces.
              </p>
              <p>
                Choose PodPilot when you need a focused Redbubble automation tool. For a wider look at the feature
                process, visit the Redbubble workflow page. If you sell on two marketplaces, review the dedicated
                <a href="/teepublic-upload-automation"> TeePublic automation</a> page as well.
              </p>
              <TextLink href="/compare/podpilot-vs-merchghost-vs-merchtitans">
                Compare PodPilot with MerchGhost and Merch Titans
              </TextLink>
            </div>
            <aside className="rb-tool-focus-list">
              <strong>One focused workflow</strong>
              <span><Check /> Design organization</span>
              <span><Check /> AI listing preparation</span>
              <span><Check /> Review before upload</span>
              <span><Check /> Queue and browser extension</span>
              <a href="/pricing">View plans and trial details <ArrowRight size={15} /></a>
            </aside>
          </div>
        </section>

        <section className="rb-tool-section rb-tool-faq-section" id="faq">
          <div className="landing-container rb-tool-faq-grid">
            <div className="rb-tool-faq-intro">
              <span className="rb-tool-section-number">09</span>
              <h2>Frequently Asked Questions</h2>
              <p>Clear answers about preparation, AI, browser uploads, and marketplace independence.</p>
              <TextLink href="/help-center">Visit the PodPilot help center</TextLink>
            </div>
            <div className="rb-tool-faq-list">
              {faqItems.map((faq, index) => (
                <details key={faq.question} open={index === 0}>
                  <summary>{faq.question}<span aria-hidden="true">+</span></summary>
                  <p>{faq.answer}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <section className="rb-tool-final-cta">
          <div className="landing-container rb-tool-final-inner">
            <span>Ready when your listings are</span>
            <h2>Save Time on Your Redbubble Upload Workflow</h2>
            <p>
              Prepare listings, organize designs, generate metadata with AI, and automate repetitive Redbubble upload
              steps from one focused workflow.
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
