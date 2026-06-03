import os

styles_path = r"c:\Users\dynast\Desktop\chofi bntk\my project autmation\frontend\src\styles.css"

dark_theme_css = """

/* ═══════════════════════════════════════════════════════════════════════════
   PREMIUM OLED DARK THEME SYSTEM & SELECTOR POLISH
   ═══════════════════════════════════════════════════════════════════════════ */
[data-theme="dark"] {
  color-scheme: dark;
  --background: #050505;
  --surface: #0f0f10;
  --surface-strong: #151518;
  --text: #f5f5f7;
  --muted: #a1a1aa;
  --border: #242428;
  --accent: #7C3AED;
  --accent-strong: #8B5CF6;
  --accent-soft: rgba(124, 58, 237, 0.12);
  --text-active: #a78bfa;
  --danger: #ef4444;
  --danger-soft: rgba(239, 68, 68, 0.15);
  --success: #10b981;
  --success-soft: rgba(16, 185, 129, 0.15);
  --warning: #f59e0b;
  --warning-soft: rgba(245, 158, 11, 0.15);
  --shadow: 0 18px 45px rgba(0, 0, 0, 0.5);

  --border-sidebar: #242428;
  --bg-sidebar: #0f0f10;
  --bg-app: #070707;
  --text-td: #f5f5f7;
  --tr-hover: #151518;

  /* Landing page vars */
  --landing-bg: #050505;
  --landing-bg-rgb: 5, 5, 5;
  --landing-text: #f5f5f7;
  --landing-muted: #a1a1aa;
  --landing-card: #0f0f10;
  --landing-border: #242428;
  --landing-soft: #111113;
  --landing-shadow: 0 10px 30px rgba(0, 0, 0, 0.4);

  /* PodPilot specific UI Polish vars */
  --pp-bg: #050505;
  --pp-card: #0f0f10;
  --pp-border: #242428;
  --pp-border-strong: #3f3f46;
  --pp-text: #f5f5f7;
  --pp-text-muted: #a1a1aa;
  --pp-accent: #7C3AED;
  --pp-accent-strong: #8B5CF6;
  --pp-accent-soft: rgba(124, 58, 237, 0.12);
  --pp-accent-ring: rgba(124, 58, 237, 0.3);
  --pp-accent-shadow: rgba(0, 0, 0, 0.5);
  --pp-accent-light: #C084FC;
  --pp-accent-deep: #1E1B4B;
  --pp-purple-border: #242428;
  --pp-success: #10b981;
  --pp-success-soft: rgba(16, 185, 129, 0.15);
  --pp-warning: #f59e0b;
  --pp-warning-soft: rgba(245, 158, 11, 0.15);
  --pp-danger: #ef4444;
  --pp-danger-soft: rgba(239, 68, 68, 0.15);
  --pp-shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.5);
  --pp-shadow-md: 0 4px 12px rgba(0, 0, 0, 0.5);
}

/* ── Specific element overrides in dark mode ── */
[data-theme="dark"] body {
  background-color: #050505 !important;
  color: #f5f5f7 !important;
}
[data-theme="dark"] .pp-app {
  background-color: #070707 !important;
}
[data-theme="dark"] .pp-sidebar {
  background-color: #0f0f10 !important;
  border-right: 1px solid #242428 !important;
  box-shadow: none !important;
}
[data-theme="dark"] .pp-sidebar-brand:hover {
  background-color: rgba(124, 58, 237, 0.12) !important;
}
[data-theme="dark"] .pp-sidebar-brand-text {
  color: #f5f5f7 !important;
}
[data-theme="dark"] .pp-sidebar-btn {
  color: #a1a1aa !important;
}
[data-theme="dark"] .pp-sidebar-btn:hover {
  background-color: rgba(124, 58, 237, 0.12) !important;
  color: #8B5CF6 !important;
}
[data-theme="dark"] .pp-sidebar-btn-active {
  background-color: rgba(124, 58, 237, 0.12) !important;
  color: #8B5CF6 !important;
}

/* Dashboard Cards */
[data-theme="dark"] .pp-dash-card {
  background: #0f0f10 !important;
  border: 1px solid #242428 !important;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4) !important;
}
[data-theme="dark"] .pp-dash-card:hover {
  border-color: #7C3AED !important;
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.5) !important;
}
[data-theme="dark"] .pp-dash-card-value {
  color: #f5f5f7 !important;
}
[data-theme="dark"] .pp-dash-card small {
  color: #71717a !important;
}
[data-theme="dark"] .pp-dash-platform-card {
  background: #0f0f10 !important;
  border: 1px solid #242428 !important;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4) !important;
}
[data-theme="dark"] .pp-dash-platform-card:hover {
  border-color: #7C3AED !important;
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.5) !important;
}
[data-theme="dark"] .pp-dash-platform-card > p {
  color: #a1a1aa !important;
}
[data-theme="dark"] .pp-dash-platform-stats div {
  border: 1px solid #242428 !important;
  background: #101012 !important;
}
[data-theme="dark"] .pp-dash-platform-stats strong {
  color: #f5f5f7 !important;
}
[data-theme="dark"] .pp-dash-platform-stats small {
  color: #71717a !important;
}
[data-theme="dark"] .pp-dash-platform-progress {
  color: #a1a1aa !important;
}
[data-theme="dark"] .pp-dash-progress-bar {
  background: #242428 !important;
}
[data-theme="dark"] .pp-dash-badge-accent {
  background: rgba(124, 58, 237, 0.12) !important;
  color: #8B5CF6 !important;
  border: 1px solid rgba(124, 58, 237, 0.2) !important;
}
[data-theme="dark"] .pp-dash-section-head h2,
[data-theme="dark"] .pp-dash-summary-head h2 {
  color: #f5f5f7 !important;
}
[data-theme="dark"] .pp-dash-section-head span,
[data-theme="dark"] .pp-dash-summary-head span {
  color: #a1a1aa !important;
}

/* Workspace Managers */
[data-theme="dark"] .manager-header h2 {
  color: #f5f5f7 !important;
}
[data-theme="dark"] .manager-header p {
  color: #a1a1aa !important;
}
[data-theme="dark"] .manager-toolbar {
  background: #0f0f10 !important;
  border: 1px solid #242428 !important;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4) !important;
}
[data-theme="dark"] .search-field input {
  background: #101012 !important;
  border: 1px solid #242428 !important;
  color: #f5f5f7 !important;
}
[data-theme="dark"] .search-field input:focus {
  border-color: #7C3AED !important;
  box-shadow: 0 0 0 3px rgba(124, 58, 237, 0.2) !important;
}
[data-theme="dark"] .table-wrap,
[data-theme="dark"] .manager-table-wrap {
  background: #0f0f10 !important;
  border: 1px solid #242428 !important;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4) !important;
}
[data-theme="dark"] .manager-table {
  background: #0f0f10 !important;
}
[data-theme="dark"] .manager-table th {
  background: #151518 !important;
  color: #a1a1aa !important;
  border-bottom: 1px solid #242428 !important;
}
[data-theme="dark"] .manager-table td {
  background: #0f0f10 !important;
  color: #f5f5f7 !important;
  border-bottom: 1px solid #242428 !important;
}
[data-theme="dark"] .manager-table tr:hover td {
  background: #151518 !important;
}
[data-theme="dark"] .pagination-bar {
  background: #0f0f10 !important;
  border: 1px solid #242428 !important;
  color: #a1a1aa !important;
}
[data-theme="dark"] .pagination-bar select {
  background: #101012 !important;
  border: 1px solid #242428 !important;
  color: #f5f5f7 !important;
}
[data-theme="dark"] .pagination-buttons button {
  background: #101012 !important;
  border: 1px solid #242428 !important;
  color: #f5f5f7 !important;
}
[data-theme="dark"] .pagination-buttons button:hover:not(:disabled) {
  background: rgba(124, 58, 237, 0.12) !important;
  color: #8B5CF6 !important;
}

/* Import & Image Upload panels */
[data-theme="dark"] .import-card,
[data-theme="dark"] .preview-card,
[data-theme="dark"] .create-config-card,
[data-theme="dark"] .create-upload-card {
  background: #0f0f10 !important;
  border: 1px solid #242428 !important;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4) !important;
}
[data-theme="dark"] .import-dropzone,
[data-theme="dark"] .create-upload-drop,
[data-theme="dark"] .dropzone {
  background: #101012 !important;
  border: 2px dashed #242428 !important;
}
[data-theme="dark"] .import-dropzone:hover,
[data-theme="dark"] .create-upload-drop:hover {
  background: rgba(124, 58, 237, 0.08) !important;
  border-color: #7C3AED !important;
}
[data-theme="dark"] .upload-symbol {
  background: #0f0f10 !important;
  border: 1px solid #242428 !important;
  color: #7C3AED !important;
}
[data-theme="dark"] .create-image-picker {
  background: #101012 !important;
  border: 1px solid #242428 !important;
  border-radius: 12px;
}
[data-theme="dark"] .create-image-option {
  background: #0f0f10 !important;
  border: 1px solid #242428 !important;
}
[data-theme="dark"] .create-image-option span {
  color: #a1a1aa !important;
}
[data-theme="dark"] .create-image-option-active {
  border-color: #7C3AED !important;
  box-shadow: 0 0 0 3px rgba(124, 58, 237, 0.2) !important;
}
[data-theme="dark"] .create-image-option img,
[data-theme="dark"] .image-card img,
[data-theme="dark"] .table-thumb {
  background: #101012 !important;
  border: 1px solid #242428 !important;
}
[data-theme="dark"] .create-switcher {
  background: #101012 !important;
  border: 1px solid #242428 !important;
  border-radius: 12px;
  color: #f5f5f7 !important;
}
[data-theme="dark"] .create-switcher strong {
  color: #f5f5f7 !important;
}
[data-theme="dark"] .create-switcher span {
  color: #a1a1aa !important;
}

/* Previews */
[data-theme="dark"] .design-preview-frame {
  background: #101012 !important;
  border: 1px solid #242428 !important;
}
[data-theme="dark"] .design-upload-placeholder {
  background: #101012 !important;
  border: 2px dashed #242428 !important;
  color: #a1a1aa !important;
}
[data-theme="dark"] .design-upload-placeholder:hover {
  border-color: #7C3AED !important;
  background: rgba(124, 58, 237, 0.08) !important;
}
[data-theme="dark"] .design-upload-placeholder-icon {
  background: #0f0f10 !important;
  border: 1px solid #242428 !important;
  color: #7C3AED !important;
}
[data-theme="dark"] .design-upload-placeholder strong {
  color: #f5f5f7 !important;
}
[data-theme="dark"] .design-upload-placeholder small {
  color: #71717a !important;
}

/* Form inputs & labels */
[data-theme="dark"] .edit-grid input,
[data-theme="dark"] .edit-grid textarea,
[data-theme="dark"] .edit-grid select,
[data-theme="dark"] .tp-field input,
[data-theme="dark"] .tp-field textarea,
[data-theme="dark"] .tp-field select {
  background: #101012 !important;
  border: 1px solid #242428 !important;
  color: #f5f5f7 !important;
}
[data-theme="dark"] .edit-grid input:focus,
[data-theme="dark"] .edit-grid textarea:focus,
[data-theme="dark"] .edit-grid select:focus,
[data-theme="dark"] .tp-field input:focus,
[data-theme="dark"] .tp-field textarea:focus {
  border-color: #7C3AED !important;
  box-shadow: 0 0 0 3px rgba(124, 58, 237, 0.2) !important;
}
[data-theme="dark"] .edit-grid label,
[data-theme="dark"] .tp-field span {
  color: #a1a1aa !important;
}

/* TeePublic Editor Tabs */
[data-theme="dark"] .design-tabs {
  background: #101012 !important;
  border: 1px solid #242428 !important;
}
[data-theme="dark"] .tp-tab-bar {
  border-bottom: 1px solid #242428 !important;
}
[data-theme="dark"] .tp-toggle {
  background: #242428 !important;
}
[data-theme="dark"] .tp-toggle input:checked + .tp-toggle-slider {
  background: #7C3AED !important;
}
[data-theme="dark"] .tp-product-card {
  background: #101012 !important;
  border: 1px solid #242428 !important;
  color: #f5f5f7 !important;
}

/* Modals & Overlays */
[data-theme="dark"] .pp-modal {
  background: #0f0f10 !important;
  border: 1px solid #242428 !important;
  box-shadow: 0 20px 50px rgba(0, 0, 0, 0.8) !important;
}
[data-theme="dark"] .pp-modal-overlay {
  background: rgba(0, 0, 0, 0.8) !important;
}
[data-theme="dark"] .pp-modal-close {
  color: #a1a1aa !important;
  background: transparent !important;
}
[data-theme="dark"] .pp-modal-close:hover {
  background: rgba(124, 58, 237, 0.12) !important;
  color: #8B5CF6 !important;
}
[data-theme="dark"] .ai-listing-icon {
  background: rgba(124, 58, 237, 0.12) !important;
  color: #8B5CF6 !important;
  box-shadow: inset 0 0 0 1px rgba(124, 58, 237, 0.3) !important;
}
[data-theme="dark"] .ai-listing-preview {
  background: #101012 !important;
  border: 1px solid #242428 !important;
}
[data-theme="dark"] .ai-listing-preview label {
  border-bottom-color: #242428 !important;
}
[data-theme="dark"] .ai-listing-preview label span {
  color: #71717a !important;
}
[data-theme="dark"] .ai-listing-preview label p {
  color: #f5f5f7 !important;
}

/* Public Landing Page */
[data-theme="dark"] .landing-page {
  background: #050505 !important;
  color: #f5f5f7 !important;
}
[data-theme="dark"] .landing-nav {
  background: rgba(5, 5, 5, 0.85) !important;
  border-bottom: 1px solid #242428 !important;
}
[data-theme="dark"] .landing-logo-link {
  color: #f5f5f7 !important;
}
[data-theme="dark"] .landing-nav-links > a:not(.landing-btn) {
  color: #a1a1aa !important;
}
[data-theme="dark"] .landing-nav-links > a:not(.landing-btn):hover {
  color: #8B5CF6 !important;
}
[data-theme="dark"] .landing-btn-secondary {
  background: #0f0f10 !important;
  border: 1px solid #242428 !important;
  color: #f5f5f7 !important;
  box-shadow: 0 4px 12px rgba(0,0,0,0.4) !important;
}
[data-theme="dark"] .landing-btn-secondary:hover {
  background: #151518 !important;
  border-color: #7C3AED !important;
}
[data-theme="dark"] .landing-hero {
  background: linear-gradient(180deg, #050505 0%, #111113 100%) !important;
}
[data-theme="dark"] .landing-mockup {
  background: #0f0f10 !important;
  border: 1px solid #242428 !important;
  box-shadow: 0 20px 50px rgba(0,0,0,0.6) !important;
}
[data-theme="dark"] .landing-mockup-topbar span {
  background: #242428 !important;
}
[data-theme="dark"] .landing-mockup-header,
[data-theme="dark"] .landing-progress-card,
[data-theme="dark"] .landing-platform-cards article,
[data-theme="dark"] .landing-stat-card {
  background: #101012 !important;
  border: 1px solid #242428 !important;
}
[data-theme="dark"] .landing-platform-strip {
  background: #050505 !important;
  border-top: 1px solid #242428 !important;
  border-bottom: 1px solid #242428 !important;
}
[data-theme="dark"] .landing-platform-logo,
[data-theme="dark"] .landing-platform-coming {
  background: #0f0f10 !important;
  border: 1px solid #242428 !important;
}
[data-theme="dark"] .landing-section {
  background: #050505 !important;
}
[data-theme="dark"] .landing-section-soft {
  background: #111113 !important;
}
[data-theme="dark"] .landing-step-card {
  background: #0f0f10 !important;
  border: 1px solid #242428 !important;
}
[data-theme="dark"] .landing-step-number {
  background: rgba(124, 58, 237, 0.12) !important;
  color: #8B5CF6 !important;
}
[data-theme="dark"] .landing-feature-card {
  background: #0f0f10 !important;
  border: 1px solid #242428 !important;
}
[data-theme="dark"] .landing-safety {
  background: #050505 !important;
}
[data-theme="dark"] .landing-pricing-card {
  background: #0f0f10 !important;
  border: 1px solid #242428 !important;
}
[data-theme="dark"] .landing-pricing-card.is-featured {
  border-color: #7C3AED !important;
  box-shadow: 0 10px 30px rgba(124, 58, 237, 0.15) !important;
}
[data-theme="dark"] .landing-testimonial-card {
  background: #0f0f10 !important;
  border: 1px solid #242428 !important;
}
[data-theme="dark"] .landing-faq-item {
  border-bottom: 1px solid #242428 !important;
}
[data-theme="dark"] .landing-faq-item button {
  color: #f5f5f7 !important;
}
[data-theme="dark"] .landing-faq-answer p {
  color: #a1a1aa !important;
}
[data-theme="dark"] .landing-final-cta {
  background: linear-gradient(180deg, #111113 0%, #050505 100%) !important;
}
[data-theme="dark"] .landing-footer {
  background: #050505 !important;
  border-top: 1px solid #242428 !important;
}

/* Polished Theme Toggle Button */
.theme-toggle-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 38px;
  height: 38px;
  border-radius: 50%;
  border: 1px solid var(--pp-border);
  background: var(--pp-card);
  color: var(--pp-text);
  cursor: pointer;
  box-shadow: var(--pp-shadow-sm);
  transition: background 0.16s, border-color 0.16s, transform 0.16s, color 0.16s;
}
.theme-toggle-btn:hover {
  background: var(--pp-accent-soft);
  border-color: var(--pp-accent);
  color: var(--pp-accent-strong);
  transform: scale(1.04);
}
.theme-toggle-icon {
  width: 18px;
  height: 18px;
  transition: transform 0.25s ease;
}
.theme-toggle-btn:active .theme-toggle-icon {
  transform: rotate(45deg);
}

/* Alignments inside layout containers */
.pp-sidebar-theme-toggle {
  margin: 6px auto 10px;
}
.pp-dash-theme-toggle {
  flex-shrink: 0;
}
.landing-theme-toggle {
  margin-left: 8px;
}
"""

with open(styles_path, 'a', encoding='utf-8') as f:
    f.write(dark_theme_css)

print("SUCCESS: Appended premium dark theme declarations to styles.css!")
