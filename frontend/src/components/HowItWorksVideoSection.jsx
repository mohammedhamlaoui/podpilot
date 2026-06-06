import { useEffect, useState } from "react";

const steps = [
  {
    number: "1",
    label: "Import",
    title: "Import your designs",
    description: "Bring in design files and spreadsheet metadata so your bulk POD upload batch starts organized.",
    video: "/videos/how-it-works/podpilot-step-1-import.webm",
    ariaLabel: "PodPilot import workflow for bulk upload print on demand designs",
  },
  {
    number: "2",
    label: "Edit",
    title: "Review listings faster",
    description: "Use the print on demand listing generator to review titles, descriptions, tags, colors, and product settings before anything goes live.",
    video: "/videos/how-it-works/podpilot-step-2-edit.webm",
    ariaLabel: "PodPilot print on demand listing generator and metadata editor",
  },
  {
    number: "3",
    label: "Publish",
    title: "Upload with the extension",
    description: "Send the prepared queue to Redbubble and TeePublic through your own browser session.",
    video: "/videos/how-it-works/podpilot-step-3-publish.webm",
    ariaLabel: "PodPilot Redbubble and TeePublic upload automation extension workflow",
  },
];

export default function HowItWorksVideoSection() {
  const [activeStepIndex, setActiveStepIndex] = useState(0);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    setPrefersReducedMotion(mediaQuery.matches);

    const listener = (event) => {
      setPrefersReducedMotion(event.matches);
    };

    if (mediaQuery.addEventListener) {
      mediaQuery.addEventListener("change", listener);
      return () => mediaQuery.removeEventListener("change", listener);
    }

    mediaQuery.addListener(listener);
    return () => mediaQuery.removeListener(listener);
  }, []);

  const activeStep = steps[activeStepIndex];
  const handleVideoEnded = () => {
    if (prefersReducedMotion) return;
    setActiveStepIndex((currentIndex) => (currentIndex + 1) % steps.length);
  };

  return (
    <section className="landing-section how-it-works-video-section" id="how-it-works">
      <div className="landing-container">
        
        {/* Section Heading */}
        <div className="landing-section-heading how-it-works-heading">
          <span className="how-it-works-pill">HOW IT WORKS</span>
          <h2>How POD upload automation works</h2>
          <p className="how-it-works-subtitle">
            Prepare the batch once, review the listing details, then let the browser extension handle the repetitive Redbubble and TeePublic upload steps.
          </p>
        </div>

        <div className="how-it-works-tabs" role="tablist" aria-label="How PodPilot Works Steps">
          {steps.map((step, index) => (
            <button
              key={step.number}
              type="button"
              className={`how-it-works-tab-btn${activeStepIndex === index ? " is-active" : ""}`}
              onClick={() => setActiveStepIndex(index)}
              aria-selected={activeStepIndex === index}
              role="tab"
              tabIndex={activeStepIndex === index ? 0 : -1}
              id={`tab-step-${step.number}`}
              aria-controls={`panel-step-${step.number}`}
            >
              <span className="how-it-works-tab-num">{step.number}</span>
              <span className="how-it-works-tab-label">{step.label}</span>
            </button>
          ))}
        </div>

        <div className="how-it-works-mockup-wrapper">
          <div
            className="how-it-works-browser-mockup"
            role="tabpanel"
            id={`panel-step-${activeStep.number}`}
            aria-labelledby={`tab-step-${activeStep.number}`}
          >
            <div className="how-it-works-browser-header">
              <div className="browser-dots">
                <span className="dot dot-red" />
                <span className="dot dot-yellow" />
                <span className="dot dot-green" />
              </div>
              <div className="browser-address-bar">
                <span>podpilot.space/dashboard/{activeStep.label.toLowerCase()}</span>
              </div>
            </div>
            <div className="how-it-works-video-frame">
              <video
                key={activeStep.video}
                autoPlay={!prefersReducedMotion}
                muted
                onEnded={handleVideoEnded}
                playsInline
                preload="metadata"
                aria-label={activeStep.ariaLabel}
                className="how-it-works-video"
              >
                <source src={activeStep.video} type="video/webm" />
                Your browser does not support the video tag.
              </video>
            </div>
          </div>
        </div>

        <div className="how-it-works-caption" aria-live="polite">
          <h3>{activeStep.title}</h3>
          <p>{activeStep.description}</p>
        </div>

      </div>
    </section>
  );
}
