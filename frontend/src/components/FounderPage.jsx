import { HeartHandshake, LockKeyhole, Mail, Sparkles, UploadCloud, UserRound } from "lucide-react";
import PublicHeader from "./PublicHeader";
import PublicFooter from "./PublicFooter";
import { useSeo } from "../utils/useSeo";

const founderSections = [
  {
    icon: HeartHandshake,
    title: "Founder intro",
    body: "I'm Mohammed Hamlaoui, an 18-year-old developer from Morocco. I built PodPilot to help print-on-demand creators save time when preparing listings, managing designs, and uploading to platforms like Redbubble and TeePublic.",
  },
  {
    icon: Sparkles,
    title: "Why I built PodPilot",
    body: "I started working on PodPilot because repetitive upload tasks take too much time. My goal is to make the process faster, cleaner, and easier for creators, while keeping users in control of their content.",
  },
  {
    icon: UploadCloud,
    title: "What PodPilot helps with",
    body: "PodPilot helps creators prepare listing metadata, organize design queues, and reduce repetitive browser work during Redbubble and TeePublic uploads.",
  },
  {
    icon: LockKeyhole,
    title: "Trust and privacy note",
    body: "PodPilot is built with privacy and security in mind. The tool is designed to help with workflow automation, not to take ownership of your work.",
  },
];

export default function FounderPage() {
  useSeo({
    title: "Who is behind PodPilot? - Founder Story",
    description: "Meet Mohammed Hamlaoui, the developer behind PodPilot, and learn why the tool was built for print-on-demand creators.",
    canonical: "/founder",
    robots: "index, follow",
  });

  return (
    <main className="landing-page founder-page">
      <PublicHeader />

      <section className="founder-hero">
        <div className="landing-container founder-hero-inner">
          <div className="contact-kicker privacy-kicker">
            <UserRound size={16} strokeWidth={2.2} />
            <span>Founder note</span>
          </div>
          <h1>Who is behind PodPilot?</h1>
          <p>
            A simple note from the developer building PodPilot for creators who want a faster,
            cleaner upload workflow.
          </p>
        </div>
      </section>

      <section className="founder-section">
        <div className="landing-container founder-layout">
          <aside className="founder-summary-card">
            <div className="founder-avatar" aria-hidden="true">
              <span>MH</span>
            </div>
            <p className="founder-eyebrow">Founder</p>
            <h2>Mohammed Hamlaoui</h2>
            <p>
              Independent developer from Morocco, focused on building practical tools for
              print-on-demand workflows.
            </p>
            <a className="landing-btn landing-btn-primary founder-contact-btn" href="/contact">
              <Mail size={17} strokeWidth={2.2} />
              <span>Contact me</span>
            </a>
          </aside>

          <article className="founder-story-card">
            {founderSections.map(({ icon: SectionIcon, title, body }) => (
              <section className="founder-story-block" key={title}>
                <div className="founder-story-icon" aria-hidden="true">
                  <SectionIcon size={20} strokeWidth={2.2} />
                </div>
                <div>
                  <h2>{title}</h2>
                  <p>{body}</p>
                </div>
              </section>
            ))}
          </article>
        </div>
      </section>

      <PublicFooter />
    </main>
  );
}
