import { Pin, LogIn, FileSpreadsheet, Rocket, HelpCircle, Download, ArrowRight, ExternalLink } from "lucide-react";
import PublicHeader from "./PublicHeader";
import PublicFooter from "./PublicFooter";
import { useSeo } from "../utils/useSeo";

export default function ThankYouPage() {
  useSeo({
    title: "Thank You & Extension Setup - PodPilot",
    description: "Follow these quick onboarding steps to connect your dashboard and start uploading designs to Redbubble and TeePublic with the PodPilot browser extension.",
    canonical: "/thank-you"
  });

  return (
    <main className="landing-page thank-you-page-root">
      <PublicHeader />

      <section className="thank-you-hero">
        <div className="landing-container thank-you-hero-inner">
          <div className="thank-you-badge">
            <Rocket size={14} style={{ color: "#7C3AED" }} />
            <span>Extension Installed</span>
          </div>
          <h1>You’re ready to upload faster</h1>
          <p className="thank-you-subtitle">
            PodPilot is almost set up. Follow these quick steps to connect your dashboard and start uploading designs to Redbubble and TeePublic.
          </p>

          <div className="thank-you-hero-ctas">
            <a href="/dashboard" className="landing-btn landing-btn-primary thank-you-primary-btn">
              <span>Open Dashboard</span>
              <ArrowRight size={18} />
            </a>
            <a href="/help#install-extension" className="landing-btn landing-btn-outline">
              <span>View Setup Guide</span>
            </a>
          </div>
        </div>
      </section>

      <section className="thank-you-steps-section">
        <div className="landing-container">
          <div className="thank-you-section-header">
            <h2>Easy 4-Step Setup</h2>
            <p>Connect your extension and start automating your design uploads</p>
          </div>

          <div className="thank-you-steps-grid">
            <div className="thank-you-step-card">
              <div className="thank-you-step-number">1</div>
              <div className="thank-you-step-icon-wrap">
                <Pin size={24} className="thank-you-step-icon" />
              </div>
              <h3>Pin the extension</h3>
              <p>Open your browser extensions menu and pin PodPilot so it’s always visible.</p>
            </div>

            <div className="thank-you-step-card">
              <div className="thank-you-step-number">2</div>
              <div className="thank-you-step-icon-wrap">
                <LogIn size={24} className="thank-you-step-icon" />
              </div>
              <h3>Sign in</h3>
              <p>Use the same PodPilot account you used on the dashboard.</p>
            </div>

            <div className="thank-you-step-card">
              <div className="thank-you-step-number">3</div>
              <div className="thank-you-step-icon-wrap">
                <FileSpreadsheet size={24} className="thank-you-step-icon" />
              </div>
              <h3>Prepare your designs</h3>
              <p>Import images, edit titles, descriptions, tags, colors, and product settings.</p>
            </div>

            <div className="thank-you-step-card">
              <div className="thank-you-step-number">4</div>
              <div className="thank-you-step-icon-wrap">
                <Rocket size={24} className="thank-you-step-icon" />
              </div>
              <h3>Start upload</h3>
              <p>Open Redbubble or TeePublic, choose your designs in the extension, and start the upload queue.</p>
            </div>
          </div>

          <div className="thank-you-resources-grid">
            <div className="thank-you-help-box">
              <div className="thank-you-help-header">
                <HelpCircle size={20} className="thank-you-help-icon" />
                <h3>Need help?</h3>
              </div>
              <p>
                If the extension does not detect your designs, refresh the dashboard, reload the extension, or open the upload page again.
              </p>
            </div>

            <div className="thank-you-quick-links">
              <h3>Quick Actions</h3>
              <div className="thank-you-actions-list">
                <a href="/redbubble" className="thank-you-action-link">
                  <span>Go to Redbubble Manager</span>
                  <ArrowRight size={16} />
                </a>
                <a href="/teepublic" className="thank-you-action-link">
                  <span>Go to TeePublic Manager</span>
                  <ArrowRight size={16} />
                </a>
                <a 
                  href="https://podpilot.space/extension-download" 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="thank-you-action-link thank-you-download-link"
                >
                  <Download size={16} />
                  <span>Download Extension Again</span>
                  <ExternalLink size={14} style={{ marginLeft: "auto", opacity: 0.6 }} />
                </a>
              </div>
            </div>
          </div>
        </div>
      </section>

      <PublicFooter />
    </main>
  );
}
