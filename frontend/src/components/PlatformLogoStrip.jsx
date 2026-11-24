import { ArrowUpRight } from "lucide-react";

const platformLogos = [
  {
    name: "Redbubble",
    src: "/platforms/redbubble-logo.svg",
    alt: "Redbubble",
    href: "/redbubble-automation-tool",
    description: "Prepare listings and manage Redbubble upload queues.",
  },
  {
    name: "TeePublic",
    src: "/platforms/teepublic-logo.svg",
    alt: "TeePublic",
    href: "/teepublic-automation-tool",
    description: "Keep TeePublic designs and upload progress together.",
  },
];

export default function PlatformLogoStrip() {
  return (
    <section className="landing-platform-logo-strip" aria-labelledby="platform-strip-title">
      <div className="landing-container landing-platform-logo-inner">
        <div className="landing-platform-logo-intro">
          <span className="landing-platform-logo-eyebrow">Built for your workflow</span>
          <h2 id="platform-strip-title" className="landing-platform-logo-title">
            Your designs, ready for <span>both marketplaces.</span>
          </h2>
          <p>Choose the platform you sell on. PodPilot keeps your listings and upload queues organized in one workspace.</p>
        </div>
        <div className="landing-platform-logo-grid">
          {platformLogos.map((logo) => (
            <a key={logo.name} className="landing-platform-logo-item" href={logo.href} aria-label={`Explore ${logo.name} tools`}>
              <span className="landing-platform-logo-card-top">
                <span>WORKS WITH</span>
                <ArrowUpRight size={19} strokeWidth={1.8} aria-hidden="true" />
              </span>
              <img src={logo.src} alt={logo.alt} className={`landing-platform-logo-img landing-platform-logo-img--${logo.name.toLowerCase()}`} draggable="false" />
              <span className="landing-platform-logo-description">{logo.description}</span>
            </a>
          ))}
        </div>
      </div>
    </section>
  );
}
