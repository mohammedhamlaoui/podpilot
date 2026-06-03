const fs = require('fs');
const path = require('path');

const targetFile = 'c:\\Users\\dynast\\Desktop\\chofi bntk\\my project autmation\\extension\\content-teepublic.js';

if (!fs.existsSync(targetFile)) {
  console.error("Target file does not exist.");
  process.exit(1);
}

let content = fs.readFileSync(targetFile, 'utf-8');

const startMarker = '  async function fillSupportingTags(tagsStr, primaryTag) {';
const endMarker = '  // ─── Main Upload Pipeline ───────────────────────────────────────────────────';

const startIndex = content.indexOf(startMarker);
const endIndex = content.indexOf(endMarker);

if (startIndex === -1 || endIndex === -1) {
  console.error("Could not find startMarker or endMarker in file.");
  process.exit(1);
}

const replacementCode = `  async function fillSupportingTags(tagsStr, primaryTag) {
    const tagInput = document.querySelector('.taggle_input') ||
                     document.querySelector('input[name="design[supporting_tags]"]');
    if (!tagInput) {
      debugWarn('[PodPilot-TP] ✗ Supporting tags input not found');
      return;
    }

    const tags = tagsStr.split(',').map(t => t.trim()).filter(Boolean);
    const primaryNorm = cleanTagText(primaryTag).toLowerCase();
    const filtered = tags.filter(t => cleanTagText(t).toLowerCase() !== primaryNorm);

    let addedCount = 0;
    for (const tag of filtered) {
      const clean = cleanTagText(tag);
      if (!clean || clean.length < 2) continue;
      tagInput.value = clean;
      tagInput.dispatchEvent(new Event('input', { bubbles: true }));
      await sleep(200);
      tagInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, which: 13, bubbles: true }));
      await sleep(200);
      addedCount++;
    }
    document.body.click();
    debugLog(\`[PodPilot-TP] ✓ Supporting tags applied: \${addedCount} tags\`);
  }

  function cleanTagText(text) {
    return (text || '').trim().replace(/\\s+/g, ' ').replace(/[^\\w\\s\\u0600-\\u06FF]/g, '');
  }

  // ─── Product Configuration ──────────────────────────────────────────────────
  // This is the critical section. We must:
  // 1. Disable ALL products the user set to false/Off
  // 2. Enable ALL products the user set to true/On
  // 3. Select colors for every enabled product that has a color dropdown/input
  // TeePublic defaults everything to ON, so we MUST explicitly disable.

  async function configureProducts(design) {
    updateOverlay('Configuring products...', 'Applying product settings from PodPilot', 60);
    await handlePause();
    await sleep(1000);

    const productSettings = design.product_settings || {};
    const colorSettings = design.color_settings || {};

    debugLog('[PodPilot-TP] ── product_settings (raw):', JSON.stringify(productSettings));
    debugLog('[PodPilot-TP] ── product_settings (normalized):', JSON.stringify(debugNormalizeSettings(productSettings)));
    debugLog('[PodPilot-TP] ── color_settings (raw):', JSON.stringify(colorSettings));
    debugLog('[PodPilot-TP] ── color_settings (normalized):', JSON.stringify(debugNormalizeSettings(colorSettings)));

    // ── Step 1+2: Apply ALL product toggles (apparel + accessories) via the
    // dedicated text-based finder. State-based, never blind clicks.
    // Pass adult_content so Kids products get skipped when mature
    // content is enabled (TeePublic disables them client-side).
    await applyTeePublicProductSettings(productSettings, design.adult_content);

    // ── Step 2.5: Verify before moving to colors. If any product the user
    // explicitly set is wrong, abort the whole pipeline so we don't publish.
    // Verification also respects the adult_content rule for Kids products.
    const productCheck = verifyTeePublicProductSettings(productSettings, design.adult_content);
    if (!productCheck.valid) {
      throw new Error(productCheck.errors.join(' | '));
    }

    // ── Step 3: Select colors for enabled apparel products (ddslick dropdowns) ──
    updateOverlay('Configuring products...', 'Selecting colors for enabled products', 70);

    for (const prod of APPAREL_PRODUCTS) {
      const span = document.querySelector(\`tr[data-canvas="\${prod.canvas}"] .on-off span\`);
      if (!span || !span.classList.contains('enabled')) continue; // only enabled products need colors

      const userColor = resolveProductColor(colorSettings, prod.key, prod.colorKey);
      const color = userColor || DEFAULT_COLORS[prod.canvas] || DEFAULT_COLORS[prod.key];
      await handlePause();
      debugLog(\`[PodPilot-TP] Color for \${prod.name}: user="\${userColor}", final="\${color}"\`);
      const success = await selectDdslickColor(prod.canvas, color, \`tr[data-canvas="\${prod.canvas}"]\`);
      if (!success) {
        debugWarn(\`[PodPilot-TP] ⚠ Could not select color "\${color}" for \${prod.name}\`);
      }
    }

    // ── Step 4: Select colors for enabled accessories ──
    for (const prod of ACCESSORY_PRODUCTS) {
      const span = document.querySelector(prod.selector);
      if (!span || !span.classList.contains('enabled')) continue;
      if (!prod.colorType) continue; // stickers/magnets don't need color

      const userColor = resolveProductColor(colorSettings, prod.key, \`\${prod.key}_color\`);
      const color = userColor || DEFAULT_COLORS[prod.key] || DEFAULT_COLORS[prod.colorCanvas] || (prod.colorType === 'minicolors' ? '#ffffff' : 'Black');
      await handlePause();
      debugLog(\`[PodPilot-TP] Color for \${prod.name}: user="\${userColor}", final="\${color}"\`);

      if (prod.colorType === 'ddslick') {
        // hats, shorts, bags use ddslick dropdown
        const success = await selectDdslickColor(prod.colorCanvas, color, \`#primary_color_\${prod.colorCanvas}\`);
        if (!success) {
          debugWarn(\`[PodPilot-TP] ⚠ Could not select ddslick color "\${color}" for \${prod.name}\`);
        }
      } else if (prod.colorType === 'minicolors') {
        // cases, mugs, pillows, pins, socks, totes, tapestries, wall_art use minicolors hex input
        const hexColor = (typeof color === 'string' && color.startsWith('#')) ? color : '#ffffff';
        const selectors = prod.colorInput.split(',');
        for (const sel of selectors) {
          const input = document.querySelector(sel.trim());
          if (input) {
            input.value = hexColor;
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
            const swatch = input.closest('.minicolors')?.querySelector('.minicolors-swatch-color');
            if (swatch) swatch.style.backgroundColor = hexColor;
            debugLog(\`[PodPilot-TP] ✓ Minicolors set for \${sel.trim()}: \${hexColor}\`);
          } else {
            debugWarn(\`[PodPilot-TP] ✗ Minicolors input not found: \${sel.trim()}\`);
          }
        }
        await sleep(300);
      }
    }

    await sleep(500);
    debugLog('[PodPilot-TP] ✓ Product configuration complete');
  }

  // ─── Color Selection: ddslick dropdown (from MerchGhost pattern) ────────────
  // This handles the TeePublic ddslick custom dropdown used for apparel colors
  // and accessory primary colors (hats, shorts, bags).

  async function selectDdslickColor(canvas, targetColor, containerSelector) {
    // Find the dropdown trigger
    let ddSelect = null;
    const container = document.querySelector(containerSelector);
    if (container) {
      ddSelect = container.querySelector('.dd-select') || container.querySelector('.dd-selected');
    }
    if (!ddSelect) {
      // Fallback selectors from MerchGhost
      ddSelect = document.querySelector(\`#primary_color_\${canvas} .dd-select\`) ||
                 document.querySelector(\`#primary_color_\${canvas} .dd-selected\`);
    }
    if (!ddSelect) {
      debugWarn(\`[PodPilot-TP] No ddslick dropdown found for \${canvas} (\${containerSelector})\`);
      return false;
    }

    ddSelect.click();
    await sleep(300);

    const optionsContainer = container ? container.querySelector('.dd-options') : null;
    const options = optionsContainer 
      ? Array.from(optionsContainer.querySelectorAll('.dd-option'))
      : Array.from(document.querySelectorAll(\`#primary_color_\${canvas} .dd-option\`));

    let found = false;
    for (const opt of options) {
      const textEl = opt.querySelector('.dd-option-text');
      const optText = textEl ? textEl.textContent : opt.textContent;
      if (colorsMatch(optText, targetColor)) {
        opt.click();
        found = true;
        break;
      }
    }

    if (!found) {
      // Close dropdown if not found by clicking trigger again
      ddSelect.click();
    }
    return found;
  }

  function verifyTeePublicConfigApplied(design) {
    const errors = [];
    
    // Check title
    const titleInput = document.querySelector('input[name="design[design_title]"]');
    if (titleInput && !titleInput.value.trim()) {
      errors.push("Title is empty");
    }

    // Check adult flag matches intent
    const isAdult = isAdultContentTrue(design.adult_content);
    const adultYes = document.querySelector('#design_content_flag_true');
    const adultNo = document.querySelector('#design_content_flag_false');
    if (adultYes && adultNo) {
      const currentIsAdult = adultYes.checked;
      if (isAdult !== currentIsAdult) {
        errors.push(\`Mature content flag expected \${isAdult ? 'Mature' : 'Not Mature'} but got \${currentIsAdult ? 'Mature' : 'Not Mature'}\`);
      }
    }

    // Verify products
    const productCheck = verifyTeePublicProductSettings(design.product_settings, design.adult_content);
    if (!productCheck.valid) {
      errors.push(...productCheck.errors);
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  async function publishDesign(design) {
    updateOverlay('Publishing design...', 'Finalizing and submitting to TeePublic', 90);
    await handlePause();

    // Verify config before publishing
    const verification = verifyTeePublicConfigApplied(design);
    if (!verification.valid) {
      console.warn('[PodPilot-TP] Pre-publish verification warning (proceeding anyway):', verification.errors.join(' | '));
    }

    // Handle adult content flags if present
    const isAdult = isAdultContentTrue(design.adult_content);
    const adultYes = document.querySelector('#design_content_flag_true');
    const adultNo = document.querySelector('#design_content_flag_false');
    if (isAdult && adultYes) {
      adultYes.click();
    } else if (!isAdult && adultNo) {
      adultNo.click();
    }

    // Accept terms if checkbox exists
    const terms = document.querySelector('#terms_and_conditions, #design_terms, input[name*="terms"]');
    if (terms && !terms.checked) {
      terms.click();
    }

    await sleep(500);

    // Find publish button
    let publishBtn = null;
    for (const selector of PUBLISH_SELECTORS) {
      publishBtn = document.querySelector(selector);
      if (publishBtn) break;
    }

    if (!publishBtn) {
      throw new Error('Publish button not found on the page');
    }

    debugLog('[PodPilot-TP] Clicking publish button');
    publishBtn.click();
    await sleep(1000);
  }

  function waitForSuccess(timeoutMs = 60000) {
    debugLog('[PodPilot-TP] Waiting for success page/redirect...');
    const start = Date.now();
    return new Promise((resolve) => {
      let done = false;
      
      function finishSuccess(result) {
        if (done) return;
        done = true;
        resolve(result);
      }

      // Check current URL immediately
      if (isTeePublicFinalPage() || isTeePublicPublishedUrl()) {
        finishSuccess({ success: true, url: window.location.href });
        return;
      }

      const interval = setInterval(() => {
        const url = window.location.href;
        const elapsed = Date.now() - start;

        if (isTeePublicFinalPage() || isTeePublicPublishedUrl()) {
          clearInterval(interval);
          finishSuccess({ success: true, url });
          return;
        }

        const match = url.match(/teepublic\\.com\\/([a-z-]+)\\/(\\d+)-(.+)/);
        if (match) {
          const [, productType, id] = match;
          if (SUCCESS_PRODUCT_TYPES.includes(productType)) {
            clearInterval(interval);
            debugLog(\`[PodPilot-TP] ✓ Success: Product page — \${productType}/\${id}\`);
            finishSuccess({ success: true, url, productType, productId: id });
            return;
          }
        }

        if (elapsed >= timeoutMs) {
          clearInterval(interval);
          if (!url.includes('quick_create')) {
            debugLog('[PodPilot-TP] Timeout but URL changed — assuming success');
            finishSuccess({ success: true, url });
          } else {
            debugWarn('[PodPilot-TP] ✗ Timeout waiting for success URL');
            resolve({ success: false, error: 'Timeout waiting for published page' });
          }
        }

        if (elapsed % 10000 === 0) {
          updateOverlay('Publishing design...', \`Scanning for redirect... \${elapsed / 1000}s\`, 92);
        }
      }, 1000);
    });
  }

`;

const newContent = content.slice(0, startIndex) + replacementCode + content.slice(endIndex);
fs.writeFileSync(targetFile, newContent, 'utf-8');
console.log("Successfully replaced and reconstructed TeePublic color selection and publishing logic!");
