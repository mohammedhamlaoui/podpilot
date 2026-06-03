styles_path = r"c:\Users\dynast\Desktop\chofi bntk\my project autmation\frontend\src\styles.css"

with open(styles_path, 'r', encoding='utf-8') as f:
    content = f.read()

# Fix 1: Restore the full media query block and sidebar hover code
bad_block_1 = """.pp-sidebar:focus-within .pp-sidebar-label {
  opacity: 0 !important;
  visibility: hidden;
  transform: translateX(-8px) !important;
}
  .pp-sidebar:hover .pp-sidebar-logo {
    transform: scale(1.04);
  }"""

good_block_1 = """.pp-sidebar:focus-within .pp-sidebar-label {
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

  .pp-sidebar:hover .pp-sidebar-logo {
    transform: scale(1.04);
  }"""

# Fix 2: Restore the complete marketplace-import blocks
bad_block_2 = """.marketplace-import .selected-file-card .icon-button,
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

good_block_2 = """.marketplace-import .selected-file-card .icon-button,
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

# Check and replace
if bad_block_1 in content:
    content = content.replace(bad_block_1, good_block_1)
    print("Fixed sidebar hover block.")
else:
    # try normalized line endings
    bad_1_norm = bad_block_1.replace('\n', '\r\n')
    good_1_norm = good_block_1.replace('\n', '\r\n')
    if bad_1_norm in content:
        content = content.replace(bad_1_norm, good_1_norm)
        print("Fixed sidebar hover block (CRLF).")

if bad_block_2 in content:
    content = content.replace(bad_block_2, good_block_2)
    print("Fixed marketplace import block.")
else:
    bad_2_norm = bad_block_2.replace('\n', '\r\n')
    good_2_norm = good_block_2.replace('\n', '\r\n')
    if bad_2_norm in content:
        content = content.replace(bad_2_norm, good_2_norm)
        print("Fixed marketplace import block (CRLF).")

with open(styles_path, 'w', encoding='utf-8') as f:
    f.write(content)

print("Finished exact style rebuilding.")
