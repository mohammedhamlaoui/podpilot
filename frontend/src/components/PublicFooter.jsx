import { LogoMark } from "./LandingPage";

export default function PublicFooter() {
  return (
    <footer className="landing-footer">
      <div className="landing-container landing-footer-grid">
        <div className="landing-footer-brand">
          <LogoMark />
          <p className="landing-footer-trust-text">
            Browser-based POD upload automation for Redbubble and TeePublic sellers.
          </p>
          <div className="landing-footer-pills">
            <span className="landing-footer-pill">No marketplace passwords</span>
            <span className="landing-footer-pill">Browser-based uploads</span>
            <span className="landing-footer-pill">Independent software</span>
          </div>
        </div>
        
        <div className="landing-footer-col">
          <h3 className="landing-footer-title">Product</h3>
          <a href="/pricing" className="landing-footer-link">Pricing</a>
          <a href="/#how-it-works" className="landing-footer-link">How It Works</a>
          <a href="/redbubble-upload-automation" className="landing-footer-link">Redbubble Upload Automation</a>
          <a href="/teepublic-upload-automation" className="landing-footer-link">TeePublic Upload Automation</a>
          <a href="/ai-listing-generator" className="landing-footer-link">AI Listing Generator</a>
          <a href="/blog" className="landing-footer-link">Blog</a>
        </div>
        
        <div className="landing-footer-col">
          <h3 className="landing-footer-title">Support</h3>
          <a href="/help" className="landing-footer-link">Help Center</a>
          <a href="/contact" className="landing-footer-link">Contact Support</a>
          <a href="/dashboard" className="landing-footer-link">Dashboard Login</a>
        </div>
        
        <div className="landing-footer-col">
          <h3 className="landing-footer-title">Legal &amp; Security</h3>
          <a href="/security" className="landing-footer-link">Security</a>
          <a href="/refund-policy" className="landing-footer-link">Refund Policy</a>
          <a href="/privacy" className="landing-footer-link">Privacy Policy</a>
          <a href="/terms" className="landing-footer-link">Terms of Service</a>
        </div>
      </div>
      
      <div className="landing-container landing-footer-bottom">
        <span className="landing-footer-copyright">Copyright &copy; 2026 PodPilot. All rights reserved.</span>
        <span className="landing-footer-disclaimer">Independent software not affiliated with Redbubble Ltd. or TeePublic.</span>
      </div>
    </footer>
  );
}
