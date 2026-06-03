import { useEffect, useState } from "react";

export default function ProductDemoVideo() {
  const [shouldAutoplay, setShouldAutoplay] = useState(true);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    setShouldAutoplay(!mediaQuery.matches);

    const handleChange = (e) => {
      setShouldAutoplay(!e.matches);
    };

    if (mediaQuery.addEventListener) {
      mediaQuery.addEventListener("change", handleChange);
      return () => mediaQuery.removeEventListener("change", handleChange);
    } else {
      mediaQuery.addListener(handleChange);
      return () => mediaQuery.removeListener(handleChange);
    }
  }, []);

  return (
    <div className="landing-video-mockup" aria-label="PodPilot Redbubble and TeePublic upload automation product demo">
      <div className="landing-video-topbar">
        <div className="landing-video-dots">
          <span className="landing-video-dot red" />
          <span className="landing-video-dot yellow" />
          <span className="landing-video-dot green" />
        </div>
        <div className="landing-video-address">
          <span className="landing-video-lock-icon">🔒</span>
          <span className="landing-video-url">podpilot.space/demo</span>
        </div>
        <div className="landing-video-label">
          <span className="landing-video-pulse" />
          <span>Automation preview</span>
        </div>
      </div>
      <div className="landing-video-content">
        <video
          autoPlay={shouldAutoplay}
          muted
          loop
          playsInline
          preload="metadata"
          poster="/videos/posters/podpilot-hero-demo-poster.jpg"
          aria-label="PodPilot product demo showing Redbubble and TeePublic upload automation"
          className="landing-video-element"
        >
          <source src="/videos/podpilot-hero-demo.webm" type="video/webm" />
          <source src="/videos/podpilot-hero-demo.mp4" type="video/mp4" />
          Your browser does not support the video tag.
        </video>
      </div>
    </div>
  );
}
