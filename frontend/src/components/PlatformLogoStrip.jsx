const platformLogos = [
  {
    name: "Redbubble",
    src: "/platforms/redbubble-logo.svg",
    alt: "Redbubble logo for Redbubble upload automation",
  },
  {
    name: "TeePublic",
    src: "/platforms/teepublic-logo.svg",
    alt: "TeePublic logo for TeePublic upload automation",
  },
];

export default function PlatformLogoStrip() {
  return (
    <section className="landing-platform-logo-strip" aria-labelledby="platform-strip-title">
      <div className="landing-container">
        <h2 id="platform-strip-title" className="landing-platform-logo-title">
          A Redbubble TeePublic uploader built for batch POD workflows.
        </h2>
        <div className="landing-platform-logo-grid">
          {platformLogos.map((logo) => (
            <div key={logo.name} className="landing-platform-logo-item">
              <img
                src={logo.src}
                alt={logo.alt}
                className={`landing-platform-logo-img landing-platform-logo-img--${logo.name.toLowerCase()}`}
                draggable="false"
              />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
