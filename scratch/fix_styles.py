import os

styles_path = r"c:\Users\dynast\Desktop\chofi bntk\my project autmation\frontend\src\styles.css"

with open(styles_path, 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Restore Block 1 (Sidebar hover styles)
broken_block_1 = """.pp-sidebar:focus-within .pp-sidebar-label {
  opacity: 0 !important;
  visibility: hidden;
  transform: translateX(-8px) !important;
}
  .pp-sidebar:hover .pp-sidebar-logo {"""

restored_block_1 = """.pp-sidebar:focus-within .pp-sidebar-label {
  opacity: 0 !important;
  visibility: hidden;
  transform: translateX(-8px) !important;
}

.pp-sidebar:focus-within .pp-sidebar-logo {
  transform: none;
}

@media (min-width: 901px) {
  .pp-app:has(.pp-sidebar:hover) {
    grid-template-columns: var(--pp-side-expanded, 220px) minmax(0, 1fr);
  }

  .pp-sidebar:hover {
    width: var(--pp-side-expanded, 220px) !important;
    box-shadow: 12px 0 32px rgba(76, 29, 149, 0.10) !important;
  }

  .pp-sidebar:hover .pp-sidebar-label {
    opacity: 1 !important;
    visibility: visible;
    transform: translateX(0) !important;
  }

  .pp-sidebar:hover .pp-sidebar-logo {"""

if broken_block_1 in content:
    content = content.replace(broken_block_1, restored_block_1)
    print("Block 1 restored successfully.")
else:
    # Let's try matching with different line ending variations
    broken_block_1_crlf = broken_block_1.replace('\n', '\r\n')
    restored_block_1_crlf = restored_block_1.replace('\n', '\r\n')
    if broken_block_1_crlf in content:
        content = content.replace(broken_block_1_crlf, restored_block_1_crlf)
        print("Block 1 (CRLF) restored successfully.")
    else:
        print("Warning: Block 1 pattern not found.")

# 2. Restore Block 2 & 3 (Marketplace Import styles)
broken_block_2 = """.marketplace-import .selected-file-card .icon-button,
.marketplace-import .selected-image-row .icon-button {
  display: grid;
  place-items: center;
  width: 30px;
  min-width: 30px;
  height: 30px;
  padding: 0;
  border-color: transparent;
.marketplace-import .selected-image-row {
}"""

restored_block_2 = """.marketplace-import .selected-file-card .icon-button,
.marketplace-import .selected-image-row .icon-button {
  display: grid;
  place-items: center;
  width: 30px;
  min-width: 30px;
  height: 30px;
  padding: 0;
  border-color: transparent;
  color: var(--pp-text-muted, #64748b);
}

.marketplace-import .selected-file-card .icon-button:hover,
.marketplace-import .selected-image-row .icon-button:hover {
  background: var(--pp-danger-soft, #fee2e2);
  color: var(--pp-danger, #dc2626);
}

.marketplace-import .selected-image-list {
  margin-top: 0;
  padding: 12px;
  border-radius: 14px;
}

.marketplace-import .selected-image-row {
  min-height: 72px;
  border-color: #e8edf3;
  box-shadow: var(--pp-shadow-sm, 0 1px 2px rgba(15, 23, 42, 0.04));
}

.marketplace-import .selected-image-row > img {
  width: 48px;
  height: 48px;
}

.marketplace-import .preview-card {
  padding: 16px;
}

.marketplace-import .preview-heading {
  margin-bottom: 12px;
}"""

if broken_block_2 in content:
    content = content.replace(broken_block_2, restored_block_2)
    print("Block 2 restored successfully.")
else:
    broken_block_2_crlf = broken_block_2.replace('\n', '\r\n')
    restored_block_2_crlf = restored_block_2.replace('\n', '\r\n')
    if broken_block_2_crlf in content:
        content = content.replace(broken_block_2_crlf, restored_block_2_crlf)
        print("Block 2 (CRLF) restored successfully.")
    else:
        print("Warning: Block 2 pattern not found.")

# 3. Append the new SavingOverlay styles
overlay_styles = """

/* ── Premium Saving Overlay ─────────────────────────────────────────────── */
.pp-saving-overlay {
  background: rgba(15, 23, 42, 0.65) !important;
  backdrop-filter: blur(8px) !important;
  animation: pp-fade-in 0.25s cubic-bezier(0.16, 1, 0.3, 1) !important;
}

.pp-saving-card {
  display: flex !important;
  flex-direction: column !important;
  align-items: center !important;
  text-align: center !important;
  padding: 36px 24px !important;
  max-width: 400px !important;
  animation: pp-saving-scale-in 0.35s cubic-bezier(0.34, 1.56, 0.64, 1) !important;
  box-shadow: 0 32px 80px rgba(124, 58, 237, 0.25), 0 1px 3px rgba(0, 0, 0, 0.05) !important;
  border: 1px solid rgba(124, 58, 237, 0.2) !important;
  background: var(--pp-card, #ffffff) !important;
  border-radius: var(--pp-radius-lg, 12px) !important;
}

@keyframes pp-saving-scale-in {
  from { opacity: 0; transform: scale(0.9) translateY(15px); }
  to   { opacity: 1; transform: scale(1) translateY(0); }
}

.pp-saving-spinner-wrap {
  position: relative !important;
  width: 80px !important;
  height: 80px !important;
  margin-bottom: 24px !important;
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;
}

.pp-saving-spinner-ring {
  position: absolute !important;
  inset: 0 !important;
  border-radius: 50% !important;
  border: 3px solid rgba(124, 58, 237, 0.1) !important;
  border-top-color: var(--pp-accent, #7C3AED) !important;
  border-right-color: var(--pp-accent, #7C3AED) !important;
  animation: pp-spin 1.2s cubic-bezier(0.5, 0.1, 0.5, 0.9) infinite !important;
}

.pp-saving-logo-inner {
  width: 48px !important;
  height: 48px !important;
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;
  background: var(--pp-card, #ffffff) !important;
  border-radius: 50% !important;
  box-shadow: 0 4px 12px rgba(124, 58, 237, 0.15) !important;
  z-index: 2 !important;
}

.pp-saving-logo-pulse {
  width: 28px !important;
  height: 28px !important;
  animation: pp-logo-pulse 2s ease-in-out infinite !important;
}

@keyframes pp-logo-pulse {
  0%, 100% { transform: scale(1); opacity: 0.9; }
  50%      { transform: scale(1.15); opacity: 1; filter: drop-shadow(0 0 6px rgba(124, 58, 237, 0.45)); }
}

.pp-saving-card h3 {
  margin: 0 0 10px !important;
  font-size: 20px !important;
  font-weight: 700 !important;
  color: var(--pp-text, #0f172a) !important;
  letter-spacing: -0.02em !important;
}

.pp-saving-card p {
  margin: 0 0 24px !important;
  font-size: 14px !important;
  line-height: 1.5 !important;
  color: var(--pp-text-muted, #64748b) !important;
}

.pp-saving-progress-bar {
  width: 100% !important;
  height: 6px !important;
  background: rgba(124, 58, 237, 0.1) !important;
  border-radius: 3px !important;
  overflow: hidden !important;
}

.pp-saving-progress-fill {
  width: 100% !important;
  height: 100% !important;
  background: linear-gradient(90deg, var(--pp-accent, #7C3AED), #ec4899, var(--pp-accent, #7C3AED)) !important;
  background-size: 200% 100% !important;
  animation: pp-saving-progress-shimmer 1.8s linear infinite !important;
  border-radius: 3px !important;
}

@keyframes pp-saving-progress-shimmer {
  0%   { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}
"""

if not ".pp-saving-overlay" in content:
    content += overlay_styles
    print("SavingOverlay styles appended successfully.")
else:
    print("SavingOverlay styles already exist.")

with open(styles_path, 'w', encoding='utf-8') as f:
    f.write(content)

print("Styles file successfully fixed and updated.")
