var DEBUG = false;
var debugLog = (...args) => {
  if (DEBUG) console.log(...args);
};
var debugWarn = (...args) => {
  if (DEBUG) console.warn(...args);
};
var debugTimingSeq = 0;
function debugTimerStart(label, details) {
  if (!DEBUG) return null;
  const id = ++debugTimingSeq;
  const name = `[PodPilot Timing ${id}] ${label}`;
  const startedAt = performance.now();
  console.time(name);
  if (details) console.log(`${name} start`, details);
  return { name, startedAt };
}
function debugTimerEnd(timer, details) {
  if (!DEBUG || !timer) return;
  const elapsedMs = performance.now() - timer.startedAt;
  console.timeEnd(timer.name);
  console.log(`${timer.name} end`, {
    elapsedMs: Number(elapsedMs.toFixed(1)),
    ...(details || {}),
  });
}

// ─── PodPilot TeePublic Content Script ─────────────────────────────────────────
// Injected on teepublic.com/design/* pages. Handles:
//   - Image upload via file input
//   - Form filling (title, description, tags, adult content)
//   - Product enable/disable based on user's product_settings
//   - Color selection per product based on user's color_settings
//   - Pre-publish verification
//   - Publish button click
//   - Success URL detection
//   - Progress overlay with pause/stop
//
// Based on MerchGhost TeePublic automation patterns, adapted for PodPilot.
// The website is the source of truth — whatever the user selected must be applied.

debugLog('[PodPilot-TP] content-teepublic.js injected —', window.location.href);

(function () {
  if (window.__podpilotTeePublicBooted) return;
  window.__podpilotTeePublicBooted = true;

  // ─── Constants ──────────────────────────────────────────────────────────────
  const PUBLISH_SELECTORS = [
    'button.publish-and-promote-button[name="commit"]',
    'button[name="commit"][value="publish"]',
    'button.btn--green[name="commit"]',
    'button.btn[name="commit"]',
    'button[name="commit"]',
    '.publish-and-promote-button',
    'input[type="submit"][name="commit"]',
    '[data-action="publish"]',
  ];

  const SUCCESS_PRODUCT_TYPES = [
    't-shirt', 'hoodie', 'tank', 'tank-top', 'crewneck', 'long-sleeve',
    'baseball-tee', 'kids-t-shirt', 'kids-hoodie', 'kids-long-sleeve-t-shirt',
    'hats', 'shorts', 'bags', 'stickers', 'cases', 'mugs', 'wall-art',
    'pillows', 'totes', 'tapestries', 'pins', 'magnets', 'socks',
  ];
  const TP_UPLOAD_STATE_KEY = 'podpilot_teepublic_upload_state';

  // Known TeePublic colors per product canvas (from MerchGhost reference)
  const TP_COLORS = {
    tshirt: ['White','Asphalt','Black','Maroon','Red','Soft Pink','Hot Pink','Azalea','Brown','Orange','Yellow','Creme','Latte','Military Green','Kelly','Sage','Forest Green','Pistachio','Navy','Royal Blue','Teal','Slate','Light Blue','Purple','Paragon','Heather','Charcoal Heather','Red Heather','Turquoise Heather','Vintage Green','Purple Heather','Navy Heather','Royal Heather','Tie Dye'],
    hoodie: ['Oatmeal Heather','Sport Green','Black','Burgundy','Creme','Navy','Colony Blue','Vintage Heather','Charcoal Heather'],
    tank: ['White','Black','Red','Navy'],
    crewneck: ['White','Sport Green','Black','Chestnut','Creme','Navy','Royal Blue','Heather','Charcoal Heather'],
    longsleevetshirt: ['White','Ghost','Black','Garnet','Red','Dark Green','Navy','Royal Blue','Indigo Blue','Light Blue','Heather'],
    baseballtee: ['Black/White','White/Black','White/Royal','White/Red','White/Kelly','White/Navy'],
    kids: ['White','Off White','Dark Grey','Asphalt','Black','Red','Soft Pink','Orange','Butter','Blush','Creme','Moss','Basil','Forest Green','Navy','Royal Blue','Slate','Coastal Blue','Light Blue','Lavender','Heather','Sunset Stripe'],
    kidshoodie: ['Black','Mauvelous','Natural Heather','Kelly','Navy','Red Heather','Vintage Royal'],
    kidslongsleevetshirt: ['Black','Navy','Deep Royal'],
    hat: ['Black','Red','Creme','Navy','Deep Royal','White/Black','White/Royal','White/Red','White/Navy'],
    shorts: ['Black','Creme','Military Green','Heather'],
    bag: ['Light Grey','Oxford','Black','Navy'],
  };

  // All apparel products with their TeePublic canvas data-attribute.
  // Keys here are matched against backend product_settings via key normalization
  // (which strips underscores/hyphens and lowercases). So 'tshirt' in backend
  // matches 't_shirt' in our key list, etc.
  const APPAREL_PRODUCTS = [
    { key: 'tshirt', canvas: 'tshirt', name: 'T-Shirt', colorKey: 'tshirt_color' },
    { key: 'hoodie', canvas: 'hoodie', name: 'Hoodie', colorKey: 'hoodie_color' },
    { key: 'tank', canvas: 'tank', name: 'Tank', colorKey: 'tank_color' },
    { key: 'crewneck', canvas: 'crewneck', name: 'Crewneck', colorKey: 'crewneck_color' },
    { key: 'longsleevetshirt', canvas: 'longsleevetshirt', name: 'Long Sleeve T-Shirt', colorKey: 'longsleevetshirt_color' },
    { key: 'baseballtee', canvas: 'baseballtee', name: 'Baseball Tee', colorKey: 'baseballtee_color' },
    { key: 'kids', canvas: 'kids', name: 'Kids', colorKey: 'kids_color' },
    { key: 'kidshoodie', canvas: 'kidshoodie', name: 'Kids Hoodie', colorKey: 'kidshoodie_color' },
    { key: 'kidslongsleevetshirt', canvas: 'kidslongsleevetshirt', name: 'Kids Long Sleeve T-Shirt', colorKey: 'kidslongsleevetshirt_color' },
  ];

  // All accessory/non-apparel products
  // colorType: 'ddslick' = uses ddslick dropdown (hats/shorts/bags)
  //            'minicolors' = uses minicolors hex input (cases/mugs/pillows/pins/socks/totes/tapestries/print)
  //            null = no color needed (stickers/magnets)
  // Keys are matched against backend product_settings via normalizeKey()
  // so backend can send singular ('bag', 'hat') or plural ('bags', 'hats')
  // and either 'wallArt' or 'wall_art' — all match.
  const ACCESSORY_PRODUCTS = [
    { key: 'hats', selector: '.canvas.hat .on-off span', name: 'Hats', colorType: 'ddslick', colorCanvas: 'hat' },
    { key: 'shorts', selector: '.canvas.shorts .on-off span', name: 'Shorts', colorType: 'ddslick', colorCanvas: 'shorts' },
    { key: 'bags', selector: '.canvas.bag .on-off span', name: 'Bags', colorType: 'ddslick', colorCanvas: 'bag' },
    { key: 'stickers', selector: '.canvas.sticker .on-off span', name: 'Stickers', colorType: null },
    { key: 'cases', selector: '.canvas.case .on-off span', name: 'Cases', colorType: 'minicolors', colorInput: '.jsUploaderCaseColor' },
    { key: 'mugs', selector: '.canvas.mug .on-off span', name: 'Mugs', colorType: 'minicolors', colorInput: '.jsUploaderCoffeeMugColor,.jsUploaderTravelMugColor' },
    { key: 'wallArt', selector: '.canvas.print .on-off span', name: 'Wall Art', colorType: 'minicolors', colorInput: '.jsUploaderPrintColor' },
    { key: 'pillows', selector: '.canvas.pillow .on-off span', name: 'Pillows', colorType: 'minicolors', colorInput: '.jsUploaderPillowColor' },
    { key: 'totes', selector: '.canvas.tote .on-off span', name: 'Totes', colorType: 'minicolors', colorInput: '.jsUploaderToteColor' },
{ key: 'pins', selector: '.canvas.pin .on-off span', name: 'Pins', colorType: 'minicolors', colorInput: '.jsUploaderPinColor' },
    { key: 'magnets', selector: '.canvas.magnet .on-off span', name: 'Magnets', colorType: null },
    { key: 'socks', selector: '.canvas.socks .on-off span', name: 'Socks', colorType: 'minicolors', colorInput: '.jsUploaderSocksColor' },
  ];

  // Default colors when user didn't specify one (prevents "must choose a color" errors)
  const DEFAULT_COLORS = {
    tshirt: 'Asphalt', hoodie: 'Navy', tank: 'Black', crewneck: 'Charcoal Heather',
    longsleevetshirt: 'Navy', baseballtee: 'White/Navy', kids: 'Navy',
    kidshoodie: 'Navy', kidslongsleevetshirt: 'Deep Royal',
    hat: 'Black', hats: 'Black',
    shorts: 'Black',
    bag: 'Navy', bags: 'Navy',
    cases: '#000000', mugs: '#ffffff', pillows: '#ffffff', pins: '#ffffff',
    socks: '#ffffff', totes: '#ffffff', tapestries: '#ffffff',
    wall_art: '#ffffff', wallArt: '#ffffff', wallart: '#ffffff',
  };

  // ─── State ──────────────────────────────────────────────────────────────────
  let isPaused = false;
  let isStopped = false;
  let overlayEl = null;
  let currentDesign = null;
  let lastStoredTpState = null;
  let suppressImageProcessingOverlay = false;

  async function getStoredTpUploadState() {
    try {
      const stored = await chrome.storage.local.get({ [TP_UPLOAD_STATE_KEY]: null });
      const state = stored[TP_UPLOAD_STATE_KEY];
      lastStoredTpState = state && typeof state === 'object' ? state : null;
      if (state?.active) {
        debugLog('[PodPilot-TP] Loaded TeePublic upload state', {
          stage: state.stage || '',
          imageInjected: state.imageInjected === true,
          designId: state.designId || '',
        });
      }
      return state && typeof state === 'object' ? state : null;
    } catch (_) {
      return null;
    }
  }

  async function setStoredTpUploadState(partialState = {}) {
    try {
      const previous = await getStoredTpUploadState();
      const now = new Date().toISOString();
      const next = {
        ...(previous || {}),
        ...partialState,
        platform: 'teepublic',
        active: partialState.active !== undefined ? partialState.active : true,
        startedAt: previous?.startedAt || partialState.startedAt || now,
        updatedAt: now,
      };
      lastStoredTpState = next;
      if (next.publishClicked === true || ['publish_click', 'success_detected', 'done', 'stopped', 'error'].includes(next.stage)) {
        suppressImageProcessingOverlay = true;
      }
      await chrome.storage.local.set({ [TP_UPLOAD_STATE_KEY]: next });
      chrome.runtime.sendMessage({
        action: 'tp_upload_stage',
        stage: next.stage,
        imageInjected: next.imageInjected === true,
        state: {
          active: next.active,
          platform: 'teepublic',
          designId: next.designId || '',
          queueId: next.queueId || '',
          currentIndex: next.currentIndex,
          stage: next.stage,
          imageInjected: next.imageInjected === true,
          startedAt: next.startedAt,
          updatedAt: next.updatedAt,
        },
      }, () => { void chrome.runtime.lastError; });
      return next;
    } catch (_) {
      return null;
    }
  }

  async function clearStoredTpUploadState() {
    try {
      lastStoredTpState = null;
      await chrome.storage.local.remove(TP_UPLOAD_STATE_KEY);
    } catch (_) {}
  }


  // ─── Utilities ──────────────────────────────────────────────────────────────
  function normalizeIdMap(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? { ...value } : {};
  }

  function getDesignTerminalId(design) {
    return String(design?.id || design?.design_id || '').trim();
  }

  function isDesignTerminalHandled(state, designId) {
    const id = String(designId || '').trim();
    if (!id) return false;
    const completedDesignIds = normalizeIdMap(state?.completedDesignIds);
    const failedDesignIds = normalizeIdMap(state?.failedDesignIds);
    const terminalHandled = normalizeIdMap(state?.terminalHandled);
    return Boolean(completedDesignIds[id] || failedDesignIds[id] || terminalHandled[id]);
  }

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  function getTpUploadReadyState() {
    const fileInputReady = Boolean(document.querySelector('input[type="file"]'));
    const titleReady = Boolean(document.querySelector('input[name="design[design_title]"]'));
    return {
      ok: true,
      page: 'teepublic',
      ready: fileInputReady || titleReady,
      fileInputReady,
      titleReady,
    };
  }

  function isTeePublicPublishedUrl(url = window.location.href) {
    try {
      const parsed = new URL(url);
      const match = parsed.pathname.match(/^\/([a-z-]+)\/(\d+)-/);
      if (!match) return false;
      const productType = match[1];
      const successTypes = new Set([
        ...SUCCESS_PRODUCT_TYPES,
        'sticker',
        'case',
        'mug',
        'pillow',
        'tote',
        'tapestry',
        'pin',
        'magnet',
        'sock',
        'hat',
        'short',
        'bag',
        'wall-art',
      ]);
      return successTypes.has(productType);
    } catch (_) {
      return false;
    }
  }

  function isTeePublicFinalPage() {
    if (isTeePublicPublishedUrl()) return true;
    const bodyText = document.body?.innerText || '';
    return /\bManage\b/i.test(bodyText) &&
      (/View In Uploader/i.test(bodyText) || /Deactivate/i.test(bodyText) || /\d+\s+Designs?\s+Sold/i.test(bodyText));
  }

  function removeProgressOverlay() {
    if (overlayEl) {
      overlayEl.remove();
      overlayEl = null;
    }
    const existing = document.getElementById('podpilot-tp-overlay');
    if (existing) existing.remove();
  }

  function hasPublishStarted(state = lastStoredTpState) {
    return suppressImageProcessingOverlay ||
      state?.publishClicked === true ||
      ['publish_click', 'success_detected', 'done', 'stopped', 'error'].includes(state?.stage);
  }

  function isImageProcessingOverlay(stage, sub) {
    return /Waiting for TeePublic image processing/i.test(String(stage || '')) ||
      /TeePublic is preparing the uploaded artwork/i.test(String(sub || ''));
  }

  function shouldSuppressOverlay(stage, sub) {
    const finalPage = isTeePublicFinalPage();
    if (finalPage) {
      suppressImageProcessingOverlay = true;
      debugLog('[PodPilot-TP] Final TeePublic page detected; suppressing progress overlay');
      return true;
    }
    if (isImageProcessingOverlay(stage, sub) && hasPublishStarted()) {
      debugLog('[PodPilot-TP] Skipped image-processing overlay because publish already clicked');
      return true;
    }
    return false;
  }

  async function reportFinalSuccessIfNeeded(reason = 'final_page_detected') {
    const state = await getStoredTpUploadState();
    if (!state?.active && reason !== 'published_url') return false;
    if (!isTeePublicFinalPage() && reason !== 'published_url') return false;

    suppressImageProcessingOverlay = true;
    debugLog('[PodPilot-TP] Success detected; cleaning TeePublic overlay', { reason });
    removeProgressOverlay();
    await setStoredTpUploadState({
      active: true,
      stage: 'success_detected',
      publishClicked: true,
      imageInjected: true,
    });
    chrome.runtime.sendMessage({
      action: 'upload_result',
      design_id: state?.designId || currentDesign?.id || currentDesign?.design_id || '',
      status: 'success',
      error_message: '',
      published_url: window.location.href,
    }, () => { void chrome.runtime.lastError; });
    await clearStoredTpUploadState();
    return true;
  }

  function waitForTpUploadReady(timeoutMs = 30000) {
    const initial = getTpUploadReadyState();
    if (initial.ready) return Promise.resolve(initial);

    return new Promise((resolve) => {
      let done = false;
      const observer = new MutationObserver(() => {
        const state = getTpUploadReadyState();
        if (state.ready) finish(state);
      });
      const timeout = setTimeout(() => finish(getTpUploadReadyState()), timeoutMs);

      function finish(state) {
        if (done) return;
        done = true;
        clearTimeout(timeout);
        observer.disconnect();
        resolve(state);
      }

      observer.observe(document.documentElement || document.body, {
        childList: true,
        subtree: true,
      });
    });
  }

  async function handlePause() {
    if (isStopped) throw new Error('Upload stopped by user');
    while (isPaused && !isStopped) await sleep(300);
    if (isStopped) throw new Error('Upload stopped by user');
  }

  function normalizeColor(str) {
    return (str || '').toLowerCase().replace(/[\s\-\/]+/g, '').trim();
  }

  function colorsMatch(a, b) {
    if (!a || !b) return false;
    const na = normalizeColor(a);
    const nb = normalizeColor(b);
    if (na === nb) return true;
    if (na.includes(nb) || nb.includes(na)) return true;
    // Handle common aliases
    const aliases = {
      'whiteroyal': ['white/royal','whiteroyal'],
      'whiteblack': ['white/black','whiteblack'],
      'whitered': ['white/red','whitered'],
      'whitenavy': ['white/navy','whitenavy'],
      'whitekelly': ['white/kelly','whitekelly'],
      'blackwhite': ['black/white','blackwhite'],
      'darkgreen': ['darkgreen','forestgreen'],
      'militarygreen': ['militarygreen'],
      'royalblue': ['royalblue'],
      'lightblue': ['lightblue'],
      'charcoalheather': ['charcoalheather'],
      'navyheather': ['navyheather'],
      'vintageheather': ['vintageheather'],
    };
    for (const [, variants] of Object.entries(aliases)) {
      if (variants.includes(na) && variants.includes(nb)) return true;
    }
    return false;
  }

  /**
   * Normalize a key: lowercase, strip underscores/hyphens/spaces.
   * So 'wall_art', 'wallArt', 'WALL ART' all become 'wallart'.
   */
  function normalizeKey(k) {
    return String(k || '').toLowerCase().replace(/[_\-\s]/g, '');
  }

  /**
   * Build a set of variants for a given product key so backend keys
   * with plural/singular/casing differences still match.
   *   tshirt, t_shirt → tshirt, tshirts
   *   bag, bags       → bag, bags
   *   wallArt, wall_art → wallart, wallarts
   */
  function keyVariants(key) {
    const norm = normalizeKey(key);
    const variants = new Set([norm]);
    // plural/singular pairs
    if (norm.endsWith('s')) variants.add(norm.replace(/s$/, ''));
    else variants.add(norm + 's');
    // suffix variants
    variants.add(norm + 'enabled');
    variants.add(norm + 'color');
    return variants;
  }

  /**
   * Resolve whether a product should be enabled/disabled from product_settings.
   * Returns true | false | null (null = not specified by user).
   * Handles every reasonable key format the backend might send via normalization.
   */
  function resolveProductEnabled(productSettings, key) {
    if (!productSettings || typeof productSettings !== 'object') return null;
    const targetVariants = keyVariants(key);

    for (const [k, v] of Object.entries(productSettings)) {
      const kNorm = normalizeKey(k);
      // strip trailing 'enabled' if present so 'tshirtEnabled' matches 'tshirt'
      const kBase = kNorm.replace(/enabled$/, '');
      if (targetVariants.has(kNorm) || targetVariants.has(kBase)) {
        if (v === true || v === 'On' || v === 'on' || v === '1' || v === 'true' || v === 1) return true;
        if (v === false || v === 'Off' || v === 'off' || v === '0' || v === 'false' || v === 0) return false;
      }
    }
    return null;
  }

  /**
   * Resolve color for a product from color_settings.
   * Returns the color string or null if not specified.
   */
  function resolveProductColor(colorSettings, key, colorKey) {
    if (!colorSettings || typeof colorSettings !== 'object') return null;
    const targetVariants = new Set([
      ...keyVariants(key),
      ...(colorKey ? keyVariants(colorKey) : []),
    ]);

    for (const [k, v] of Object.entries(colorSettings)) {
      if (!v || typeof v !== 'string' || !v.trim()) continue;
      const kNorm = normalizeKey(k);
      const kBase = kNorm.replace(/color$/, '');
      if (targetVariants.has(kNorm) || targetVariants.has(kBase)) {
        return v.trim();
      }
    }
    return null;
  }

  /**
   * Build a debug-friendly normalized view of product_settings.
   */
  function debugNormalizeSettings(settings) {
    const out = {};
    if (!settings || typeof settings !== 'object') return out;
    for (const [k, v] of Object.entries(settings)) {
      out[normalizeKey(k)] = v;
    }
    return out;
  }


  // ─── Product Toggle Module ──────────────────────────────────────────────────
  // Single source of truth for product enable/disable.
  // Strategy (state-based, never blind clicks):
  //   1. Find the row for each product by visible name text (most robust),
  //      with data-canvas / .canvas.X fallbacks.
  //   2. Within that row, find ONLY the toggle (.on-off span).
  //   3. Compare current vs desired, click only if they differ.
  //   4. Wait, then re-read state to verify the click took effect.

  // Map every backend key to its visible TeePublic row label and DOM
  // selector hints. The label is the primary lookup key — TeePublic shows
  // it in the row's "Item" column. Aliases let us match small spelling
  // variations TeePublic might use.
  const PRODUCT_ROW_MAP = [
    { key: 'tshirt',                 label: 'T-Shirt',                 aliases: ['t shirt', 't-shirt', 'tshirt'],                                                       canvas: 'tshirt' },
    { key: 'hoodie',                 label: 'Hoodie',                  aliases: ['hoodie'],                                                                              canvas: 'hoodie' },
    { key: 'tank',                   label: 'Tank',                    aliases: ['tank', 'tank top'],                                                                    canvas: 'tank' },
    { key: 'crewneck',               label: 'Crewneck',                aliases: ['crewneck', 'crew neck', 'sweatshirt'],                                                 canvas: 'crewneck' },
    { key: 'longsleevetshirt',       label: 'Long Sleeve T-Shirt',     aliases: ['long sleeve t-shirt', 'long sleeve tshirt', 'long sleeve', 'longsleeve'],              canvas: 'longsleevetshirt' },
    { key: 'baseballtee',            label: 'Baseball Tee',            aliases: ['baseball tee', 'baseball'],                                                            canvas: 'baseballtee' },
    { key: 'kids',                   label: 'Kids',                    aliases: ['kids', 'kids t-shirt', 'kids tshirt'],                                                 canvas: 'kids' },
    { key: 'kidshoodie',             label: 'Kids Hoodie',             aliases: ['kids hoodie'],                                                                         canvas: 'kidshoodie' },
    { key: 'kidslongsleevetshirt',   label: 'Kids Long Sleeve T-Shirt',aliases: ['kids long sleeve t-shirt', 'kids long sleeve tshirt', 'kids long sleeve'],             canvas: 'kidslongsleevetshirt' },
    { key: 'hats',                   label: 'Hats',                    aliases: ['hats', 'hat'],                                                                          canvasClass: 'hat' },
    { key: 'shorts',                 label: 'Shorts',                  aliases: ['shorts'],                                                                              canvasClass: 'shorts' },
    { key: 'bags',                   label: 'Bags',                    aliases: ['bags', 'bag'],                                                                          canvasClass: 'bag' },
    { key: 'stickers',               label: 'Stickers',                aliases: ['stickers', 'sticker'],                                                                  canvasClass: 'sticker' },
    { key: 'cases',                  label: 'Cases',                   aliases: ['cases', 'phone cases', 'case'],                                                         canvasClass: 'case' },
    { key: 'mugs',                   label: 'Mugs',                    aliases: ['mugs', 'mug'],                                                                          canvasClass: 'mug' },
    { key: 'wallArt',                label: 'Wall Art',                aliases: ['wall art', 'wallart', 'print', 'prints'],                                              canvasClass: 'print' },
    { key: 'pillows',                label: 'Pillows',                 aliases: ['pillows', 'pillow'],                                                                    canvasClass: 'pillow' },
    { key: 'totes',                  label: 'Totes',                   aliases: ['totes', 'tote'],                                                                        canvasClass: 'tote' },
    { key: 'tapestries',             label: 'Tapestries',              aliases: ['tapestries', 'tapestry'],                                                               canvasClass: 'tapestry' },
    { key: 'pins',                   label: 'Pins',                    aliases: ['pins', 'pin'],                                                                          canvasClass: 'pin' },
    { key: 'magnets',                label: 'Magnets',                 aliases: ['magnets', 'magnet'],                                                                    canvasClass: 'magnet' },
    { key: 'socks',                  label: 'Socks',                   aliases: ['socks', 'sock'],                                                                        canvasClass: 'socks' },
  ];

  function normalizeText(s) {
    return String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
  }

  /**
   * Find the toggle <span> for a given product entry.
   * Tries, in order:
   *   1. tr[data-canvas="..."] (apparel)
   *   2. .canvas.<canvasClass> (accessories)
   *   3. Walk every row that has a .on-off element and match by visible text
   *      against the product's label/aliases.
   * Returns { toggle, row, foundBy } or null if not found.
   */
  function findProductToggle(prod) {
    // 1. data-canvas (apparel rows)
    if (prod.canvas) {
      const row = document.querySelector(`tr[data-canvas="${prod.canvas}"]`);
      if (row) {
        const toggle = row.querySelector('.on-off span');
        if (toggle) return { toggle, row, foundBy: `data-canvas="${prod.canvas}"` };
      }
    }

    // 2. .canvas.<class> (accessories)
    if (prod.canvasClass) {
      const row = document.querySelector(`.canvas.${prod.canvasClass}`);
      if (row) {
        const toggle = row.querySelector('.on-off span');
        if (toggle) return { toggle, row, foundBy: `.canvas.${prod.canvasClass}` };
      }
    }

    // 3. Text-based fallback: walk every element that contains a .on-off span,
    //    compare its visible text against the product's label/aliases.
    const candidates = document.querySelectorAll('tr, .canvas, [class*="canvas"], [data-canvas], li, .uploader-product, .product-row');
    const labels = [normalizeText(prod.label), ...prod.aliases.map(normalizeText)];

    for (const el of candidates) {
      const toggle = el.querySelector(':scope > * .on-off span, :scope .on-off span');
      if (!toggle) continue;
      // Only inspect the row's leading text cells (avoid matching the whole
      // page accidentally). Use the first cell or first ~80 chars.
      const firstCell = el.querySelector('td:first-child, .item, .name, .label, .product-name, h3, h4, strong');
      const sampleText = normalizeText(firstCell ? firstCell.textContent : (el.textContent || '').slice(0, 80));
      for (const lbl of labels) {
        if (!lbl) continue;
        // Exact label match preferred; require the cell text to be the label
        // or start with the label (so "Kids" doesn't match "Kids Hoodie").
        if (sampleText === lbl || sampleText.startsWith(lbl + ' ') || sampleText.startsWith(lbl + '\n')) {
          return { toggle, row: el, foundBy: `text="${lbl}"` };
        }
      }
    }

    // 4. Last-resort fallback specifically for apparel: match by exact <td> text
    //    inside any <tr> that contains an .on-off toggle.
    const trCandidates = document.querySelectorAll('tr');
    for (const tr of trCandidates) {
      const toggle = tr.querySelector('.on-off span');
      if (!toggle) continue;
      const cellText = normalizeText(tr.querySelector('td')?.textContent);
      for (const lbl of labels) {
        if (cellText === lbl) {
          return { toggle, row: tr, foundBy: `tr-td-text="${lbl}"` };
        }
      }
    }

    return null;
  }

  function isToggleEnabled(toggle) {
    if (!toggle) return false;
    if (toggle.classList.contains('enabled')) return true;
    // Some TeePublic builds use additional state classes
    if (toggle.classList.contains('on')) return true;
    if (toggle.getAttribute('aria-checked') === 'true') return true;
    return false;
  }

  /**
   * Click a toggle and verify the state changed. Retries up to 3 times if
   * the click didn't take effect (TeePublic has some debouncing).
   */
  async function clickToggleAndVerify(toggle, expectedAfter, name) {
    const originalState = isToggleEnabled(toggle);
    if (originalState === expectedAfter) return true;

    for (let attempt = 1; attempt <= 3; attempt++) {
      // Scroll into view so click reaches the right element
      try { toggle.scrollIntoView({ block: 'center', behavior: 'instant' }); } catch (_) {
        try { toggle.scrollIntoView({ block: 'center' }); } catch (_) {}
      }
      await sleep(150);

      // Dispatch a real click sequence
      toggle.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }));
      toggle.dispatchEvent(new MouseEvent('mouseup',   { bubbles: true, cancelable: true, button: 0 }));
      toggle.click();

      await sleep(450);
      const after = isToggleEnabled(toggle);
      if (after === expectedAfter) {
        debugLog(`[PodPilot-TP] ${name} after=${after} (attempt ${attempt})`);
        return true;
      }
      debugWarn(`[PodPilot-TP] ${name} click attempt ${attempt} did not take effect (still ${after})`);
      await sleep(200);
    }
    return false;
  }

  /**
   * Product keys TeePublic disables when Mature Content = Yes. Trying to
   * toggle these on while adult content is enabled causes the click to
   * have no effect (TeePublic blocks it client-side), which previously
   * tripped our verification step.
   */
  const KIDS_PRODUCT_KEYS = new Set([
    'kids',
    'kidshoodie',
    'kidslongsleevetshirt',
  ]);

  function isAdultContentTrue(value) {
    return value === true
      || value === 'Yes' || value === 'yes'
      || value === '1' || value === 1
      || value === 'true';
  }

  /**
   * Apply product_settings to the TeePublic page.
   * State-based: only clicks when current state ≠ desired state.
   * Leaves products with `null` (unspecified) alone.
   *
   * When adultContent is true, Kids products are skipped entirely because
   * TeePublic disables them client-side and any click would be a no-op.
   */
  async function applyTeePublicProductSettings(productSettings, adultContent = false) {
    const raw = productSettings || {};
    const normalized = debugNormalizeSettings(raw);
    const adult = isAdultContentTrue(adultContent);
    debugLog('[PodPilot-TP] ── raw product_settings:', JSON.stringify(raw));
    debugLog('[PodPilot-TP] ── normalized product_settings:', JSON.stringify(normalized));
    debugLog(`[PodPilot-TP] ── adult_content=${adult}`);
    if (adult) {
      debugLog('[PodPilot-TP] adult_content=true, skipping Kids products because TeePublic disables them');
    }

    const missingRows = [];
    const failedClicks = [];
    const kidsSkipped = [];

    for (const prod of PRODUCT_ROW_MAP) {
      // TeePublic blocks Kids products when Mature Content = Yes. Don't
      // even try — the click is a no-op and verification would fail.
      if (adult && KIDS_PRODUCT_KEYS.has(prod.key)) {
        kidsSkipped.push(prod.label);
        debugLog(`[PodPilot-TP] · ${prod.label}: skipped (adult_content=true blocks Kids products)`);
        continue;
      }

      const desired = resolveProductEnabled(raw, prod.key);
      await handlePause();

      const found = findProductToggle(prod);
      if (!found) {
        if (desired !== null) missingRows.push(prod.label);
        debugWarn(`[PodPilot-TP] ✗ row not found: ${prod.label}`);
        continue;
      }
      debugLog(`[PodPilot-TP] row found: ${prod.label} (via ${found.foundBy})`);

      const current = isToggleEnabled(found.toggle);
      debugLog(`[PodPilot-TP] ${prod.label} desired=${desired} current=${current}`);

      if (desired === null) {
        debugLog(`[PodPilot-TP] · ${prod.label}: not in user settings, leaving as ${current ? 'ON' : 'OFF'}`);
        continue;
      }

      if (current === desired) {
        debugLog(`[PodPilot-TP] · ${prod.label}: already ${current ? 'ON' : 'OFF'} (matches desired)`);
        continue;
      }

      debugLog(`[PodPilot-TP] clicked ${prod.label} toggle`);
      const ok = await clickToggleAndVerify(found.toggle, desired, prod.label);
      if (!ok) {
        failedClicks.push(`${prod.label} (could not toggle to ${desired ? 'ON' : 'OFF'})`);
      }
    }

    if (missingRows.length) {
      debugWarn(`[PodPilot-TP] missing product rows: ${missingRows.join(', ')}`);
    }
    if (failedClicks.length) {
      debugWarn(`[PodPilot-TP] failed toggle clicks: ${failedClicks.join(', ')}`);
    }
    if (kidsSkipped.length) {
      // Informational, not a real error — use log so Brave's Extensions
      // page doesn't surface it under "Errors".
      debugLog(`[PodPilot-TP] Kids products skipped because mature content is enabled: ${kidsSkipped.join(', ')}`);
    }

    // Safety guard: if zero products are enabled after applying settings,
    // fall back to T-Shirt so the publish doesn't fail with
    // "must have at least one product enabled".
    const enabledCount = document.querySelectorAll('.on-off span.enabled, .on-off span.on').length;
    debugLog(`[PodPilot-TP] enabled products after toggles: ${enabledCount}`);
    if (enabledCount === 0) {
      debugWarn('[PodPilot-TP] ⚠ ZERO products enabled — applying fallback (T-Shirt)');
      const tshirt = findProductToggle(PRODUCT_ROW_MAP[0]);
      if (tshirt && !isToggleEnabled(tshirt.toggle)) {
        await clickToggleAndVerify(tshirt.toggle, true, 'T-Shirt (fallback)');
      }
    }

    return { missingRows, failedClicks, kidsSkipped };
  }

  /**
   * Verify product_settings were applied correctly. Returns
   *   { valid: bool, errors: [..] }.
   * Reports per-product mismatches with the exact format requested by the user.
   *
   * When adultContent is true, Kids products are excluded from the
   * mismatch check (they cannot be enabled on TeePublic in adult mode).
   */
  function verifyTeePublicProductSettings(productSettings, adultContent = false) {
    const raw = productSettings || {};
    const adult = isAdultContentTrue(adultContent);
    const mismatches = [];
    const missing = [];
    const kidsExcluded = [];

    for (const prod of PRODUCT_ROW_MAP) {
      // Skip Kids products from verification when adult content is on —
      // TeePublic forces them OFF regardless of user intent.
      if (adult && KIDS_PRODUCT_KEYS.has(prod.key)) {
        const desired = resolveProductEnabled(raw, prod.key);
        if (desired === true) kidsExcluded.push(prod.label);
        continue;
      }

      const desired = resolveProductEnabled(raw, prod.key);
      if (desired === null) continue;

      const found = findProductToggle(prod);
      if (!found) {
        missing.push(prod.label);
        continue;
      }
      const current = isToggleEnabled(found.toggle);
      if (desired === true && !current) {
        mismatches.push(`${prod.key} should be ON but is OFF`);
      } else if (desired === false && current) {
        mismatches.push(`${prod.key} should be OFF but is ON`);
      }
    }

    const errors = [];
    if (mismatches.length) {
      errors.push(`Product settings not applied: ${mismatches.join(', ')}`);
    }
    if (missing.length) {
      errors.push(`Product rows not found: ${missing.join(', ')}`);
    }

    if (kidsExcluded.length) {
      // Informational. The user expects this when adult_content=true.
      debugLog(
        `[PodPilot-TP] Kids products skipped because mature content is enabled: ${kidsExcluded.join(', ')}`
      );
    }

    if (errors.length) {
      console.error('[PodPilot-TP] product verification failed:');
      errors.forEach(e => console.error('   ·', e));
    } else {
      debugLog('[PodPilot-TP] product verification passed');
    }

    return { valid: errors.length === 0, errors, kidsExcluded };
  }


  // ─── Progress Overlay ───────────────────────────────────────────────────────
  function createOverlay() {
    if (overlayEl) overlayEl.remove();
    overlayEl = document.createElement('div');
    overlayEl.id = 'podpilot-tp-overlay';
    overlayEl.innerHTML = `
      <div style="position:fixed;top:20px;right:20px;width:340px;padding:16px;background:#fff;border-radius:10px;box-shadow:0 4px 24px rgba(0,0,0,0.15);z-index:99999;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1a1a1a;">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;">
          <img src="${chrome.runtime.getURL('icons/icon48.png')}" style="width:32px;height:32px;" alt=""/>
          <div>
            <div style="font-size:16px;font-weight:700;">Upload Progress</div>
            <div id="pp-tp-design-count" style="font-size:12px;color:#666;">Preparing...</div>
          </div>
        </div>
        <div id="pp-tp-stage" style="font-size:14px;font-weight:500;margin-bottom:4px;">Preparing upload...</div>
        <div id="pp-tp-sub" style="font-size:12px;color:#666;margin-bottom:10px;">Getting ready</div>
        <div style="height:6px;background:#e5e7eb;border-radius:3px;margin-bottom:10px;">
          <div id="pp-tp-bar" style="height:100%;background:#7C3AED;border-radius:3px;width:0%;transition:width 0.3s;"></div>
        </div>
        <div id="pp-tp-status" style="font-size:12px;font-weight:500;color:#7C3AED;margin-bottom:10px;">Status: Running</div>
        <div style="display:flex;gap:8px;">
          <button id="pp-tp-pause" style="flex:1;padding:6px 12px;border:1px solid #d1d5db;border-radius:6px;background:#fff;cursor:pointer;font-size:13px;">Pause</button>
          <button id="pp-tp-stop" style="flex:1;padding:6px 12px;border:1px solid #dc2626;border-radius:6px;background:#ef4444;color:#fff;cursor:pointer;font-size:13px;">Stop</button>
        </div>
      </div>`;
    document.body.appendChild(overlayEl);
    overlayEl.querySelector('#pp-tp-pause').addEventListener('click', () => {
      isPaused = !isPaused;
      overlayEl.querySelector('#pp-tp-pause').textContent = isPaused ? 'Resume' : 'Pause';
      updateOverlayStatus();
    });
    overlayEl.querySelector('#pp-tp-stop').addEventListener('click', () => {
      isStopped = true;
      isPaused = false;
      updateOverlayStatus();
      clearStoredTpUploadState();
      chrome.runtime.sendMessage({ action: 'stop_queue' }, () => { void chrome.runtime.lastError; });
    });
  }

  function updateOverlay(stage, sub, percent) {
    if (shouldSuppressOverlay(stage, sub)) {
      removeProgressOverlay();
      return;
    }
    if (!overlayEl) createOverlay();
    const stageEl = overlayEl.querySelector('#pp-tp-stage');
    const subEl = overlayEl.querySelector('#pp-tp-sub');
    const barEl = overlayEl.querySelector('#pp-tp-bar');
    if (stageEl) stageEl.textContent = stage;
    if (subEl) subEl.textContent = sub;
    if (barEl) barEl.style.width = `${percent}%`;
    updateOverlayStatus();
  }

  function updateOverlayStatus() {
    if (!overlayEl) return;
    const el = overlayEl.querySelector('#pp-tp-status');
    if (!el) return;
    if (isStopped) { el.textContent = 'Status: Stopped'; el.style.color = '#ef4444'; }
    else if (isPaused) { el.textContent = 'Status: Paused'; el.style.color = '#f59e0b'; }
    else { el.textContent = 'Status: Running'; el.style.color = '#7C3AED'; }
  }

  function updateOverlayDesignCount(current, total) {
    if (!overlayEl) return;
    const el = overlayEl.querySelector('#pp-tp-design-count');
    if (el) el.textContent = `Design ${current} of ${total}`;
  }

  function showCompletionOverlay(success, total) {
    if (!overlayEl) createOverlay();
    const rate = total > 0 ? Math.round((success / total) * 100) : 0;
    const color = rate >= 80 ? '#7C3AED' : rate >= 50 ? '#f59e0b' : '#ef4444';
    overlayEl.innerHTML = `
      <div style="position:fixed;top:20px;right:20px;width:340px;padding:20px;background:#fff;border-radius:10px;box-shadow:0 4px 24px rgba(0,0,0,0.15);z-index:99999;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;text-align:center;">
        <div style="font-size:40px;margin-bottom:8px;">${rate >= 80 ? '🎉' : rate >= 50 ? '⚠️' : '❌'}</div>
        <div style="font-size:18px;font-weight:700;color:${color};margin-bottom:6px;">Upload Complete!</div>
        <div style="font-size:14px;color:#374151;margin-bottom:6px;">${success} of ${total} designs uploaded successfully</div>
        <div style="font-size:13px;color:#666;margin-bottom:14px;">${rate}% Success Rate</div>
        <button onclick="this.closest('#podpilot-tp-overlay').remove()" style="padding:8px 20px;background:${color};color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:14px;">Close</button>
      </div>`;
    playSuccessSound();
  }

  function playSuccessSound() {
    try {
      const url = chrome.runtime.getURL('assets/cha-ching.mp3');
      const audio = new Audio(url);
      audio.volume = 0.7;
      audio.play().catch(() => {});
    } catch (_) {}
  }


  // ─── Image Upload ───────────────────────────────────────────────────────────
  async function uploadImage(imageUrl) {
    updateOverlay('Uploading artwork...', 'Sending design file to TeePublic', 20);
    debugLog('[PodPilot-TP] uploadImage source:', imageUrl?.startsWith('data:') ? 'data-url' : 'remote-url');

    let file;
    const conversionTimer = debugTimerStart("image blob/file conversion duration", {
      marketplace: "teepublic",
      source: imageUrl?.startsWith('data:') ? "base64" : "remote-blob",
    });
    if (imageUrl.startsWith('data:')) {
      const parts = imageUrl.split(',');
      const mime = parts[0].match(/:(.*?);/)?.[1] || 'image/png';
      const binary = atob(parts[1]);
      const arr = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) arr[i] = binary.charCodeAt(i);
      file = new File([arr], 'design.png', { type: mime });
    } else {
      const fetchTimer = debugTimerStart("image URL fetch duration", {
        marketplace: "teepublic",
        source: "content-remote-url",
      });
      const resp = await fetch(imageUrl);
      if (!resp.ok) {
        debugTimerEnd(fetchTimer, { ok: false, status: resp.status });
        throw new Error(`Image fetch failed: ${resp.status}`);
      }
      const blob = await resp.blob();
      debugTimerEnd(fetchTimer, {
        ok: true,
        status: resp.status,
        mimeType: blob.type || 'image/png',
        bytes: blob.size,
      });
      file = new File([blob], 'design.png', { type: blob.type || 'image/png' });
    }
    debugTimerEnd(conversionTimer, { bytes: file.size, mimeType: file.type });

    const pageReadyTimer = debugTimerStart("marketplace page ready duration", {
      marketplace: "teepublic",
    });
    const input = document.querySelector('input[type="file"]');
    debugTimerEnd(pageReadyTimer, { ok: Boolean(input) });
    debugLog('[PodPilot Timing] file input found', {
      marketplace: 'teepublic',
      ok: Boolean(input),
    });
    if (!input) throw new Error('File upload input not found on page');

    const injectionTimer = debugTimerStart("image input injection duration", {
      marketplace: "teepublic",
      bytes: file.size,
      mimeType: file.type,
    });
    debugLog('[PodPilot-TP] Image injection started');
    await setStoredTpUploadState({
      active: true,
      stage: 'injecting_image',
      imageInjected: false,
      designId: currentDesign?.id || currentDesign?.design_id || '',
    });
    const dt = new DataTransfer();
    dt.items.add(file);
    input.files = dt.files;

    input.dispatchEvent(new Event('change', { bubbles: true }));
    debugTimerEnd(injectionTimer, { filesAfter: input.files?.length || 0 });
    debugLog('[PodPilot Timing] file injected', {
      marketplace: 'teepublic',
      filesAfter: input.files?.length || 0,
    });

    await setStoredTpUploadState({
      active: true,
      stage: 'waiting_image_processing',
      imageInjected: true,
      designId: currentDesign?.id || currentDesign?.design_id || '',
    });
    debugLog('[PodPilot-TP] Image injected; navigation locked');

    debugLog('[PodPilot-TP] File dispatched, waiting for preview...');
    updateOverlay('Waiting for TeePublic image processing', 'TeePublic is preparing the uploaded artwork', 35);

    const processingTimer = debugTimerStart("marketplace image processing wait duration", {
      marketplace: "teepublic",
      timeoutMs: 300000,
    });
    const appeared = await waitForImagePreview();
    debugTimerEnd(processingTimer, { ok: Boolean(appeared) });
    debugLog('[PodPilot Timing] processing detected', {
      marketplace: 'teepublic',
      ok: Boolean(appeared),
    });
    if (!appeared) throw new Error('Image did not appear after upload (timeout)');
    debugLog('[PodPilot-TP] Image preview detected');
    return true;
  }

  async function waitForImagePreview(timeoutMs = 300000) {
    const existing = new Set(
      Array.from(document.querySelectorAll('.mutable-preview'))
        .map(el => el.src).filter(Boolean)
    );
    const check = () => {
      const previews = document.querySelectorAll('.mutable-preview');
      return previews.length > 0 && Array.from(previews).some(el =>
        el.src && el.src.includes('production/designs') && !existing.has(el.src)
      );
    };
    if (check()) return true;

    return new Promise(resolve => {
      const observer = new MutationObserver(() => { if (check()) done(true); });
      observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['src'] });
      const interval = setInterval(() => { if (check()) done(true); }, 1000);
      const timeout = setTimeout(() => done(false), timeoutMs);
      function done(result) {
        clearInterval(interval);
        clearTimeout(timeout);
        observer.disconnect();
        setTimeout(() => resolve(result), 500);
      }
    });
  }


  // ─── Form Filling ───────────────────────────────────────────────────────────
  async function fillDesignInfo(design) {
    const metadataTimer = debugTimerStart("metadata fill duration", {
      marketplace: "teepublic",
      designId: design.id || design.design_id || "",
    });
    updateOverlay('Filling design information...', 'Title, description, and tags', 45);
    await handlePause();
    await sleep(1000);

    // 1. Title
    if (design.title) {
      await handlePause();
      const titleInput = document.querySelector('input[name="design[design_title]"]');
      if (titleInput) {
        titleInput.value = design.title;
        titleInput.dispatchEvent(new Event('input', { bubbles: true }));
        titleInput.dispatchEvent(new Event('change', { bubbles: true }));
        debugLog('[PodPilot-TP] ✓ Title applied:', design.title);
      } else {
        debugWarn('[PodPilot-TP] ✗ Title input not found');
      }
    }

    // 2. Adult content (set early so product availability updates)
    await handlePause();
    const isAdult = design.adult_content === true || design.adult_content === 'Yes' || design.adult_content === 'yes' || design.adult_content === '1';
    const adultRadio = document.querySelector(isAdult ? '#design_content_flag_true' : '#design_content_flag_false');
    if (adultRadio) {
      adultRadio.checked = true;
      adultRadio.dispatchEvent(new Event('change', { bubbles: true }));
      debugLog('[PodPilot-TP] ✓ Adult content set:', isAdult ? 'Yes' : 'No');
    } else {
      debugWarn('[PodPilot-TP] ✗ Adult content radio not found');
    }
    await sleep(500);

    // 3. Description
    if (design.description) {
      await handlePause();
      const descInput = document.querySelector('textarea[name="design[design_description]"]');
      if (descInput) {
        descInput.value = design.description;
        descInput.dispatchEvent(new Event('input', { bubbles: true }));
        descInput.dispatchEvent(new Event('change', { bubbles: true }));
        debugLog('[PodPilot-TP] ✓ Description applied');
      } else {
        debugWarn('[PodPilot-TP] ✗ Description textarea not found');
      }
    }

    // 4. Primary tag
    await handlePause();
    const primaryTag = (design.primary_tag || design.main_tag || '').trim();
    if (primaryTag) {
      const tagInput = document.querySelector('input[name="design[primary_tag]"]');
      if (tagInput) {
        tagInput.value = primaryTag;
        tagInput.dispatchEvent(new Event('input', { bubbles: true }));
        tagInput.dispatchEvent(new Event('change', { bubbles: true }));
        await sleep(300);
        // Dismiss autocomplete
        tagInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, which: 27, bubbles: true, cancelable: true }));
        await sleep(200);
        tagInput.blur();
        await sleep(200);
        // Click away to close any popups
        const mainContent = document.querySelector('.main-content') || document.querySelector('.page-container') || document.body;
        mainContent.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        await sleep(300);
        debugLog('[PodPilot-TP] ✓ Primary tag applied:', primaryTag);
      } else {
        debugWarn('[PodPilot-TP] ✗ Primary tag input not found');
      }
    }

    // 5. Supporting tags
    await handlePause();
    const supportingTags = Array.isArray(design.supporting_tags)
      ? design.supporting_tags.join(', ')
      : String(design.supporting_tags || '').trim();
    if (supportingTags) {
      await fillSupportingTags(supportingTags, primaryTag);
    }
    debugTimerEnd(metadataTimer, { ok: true });
  }

  async function fillSupportingTags(tagsStr, primaryTag) {
    const tags = normalizeSupportingTagList(tagsStr, primaryTag);
    if (tags.length === 0) {
      debugWarn('[PodPilot-TP] No usable supporting tags after filtering');
      return;
    }

    const tagInput = findSupportingTagsInput();
    if (!tagInput) {
      debugWarn('[PodPilot-TP] ✗ Supporting tags input not found');
      return;
    }

    const directValueField = tagInput.tagName === 'TEXTAREA' ||
      /supporting|secondary|tag_list|tags/i.test(tagInput.name || '');
    if (directValueField && !tagInput.classList.contains('taggle_input')) {
      setFormValue(tagInput, tags.join(', '));
      tagInput.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', keyCode: 13, which: 13, bubbles: true }));
      tagInput.blur();
      await sleep(300);
      debugLog(`[PodPilot-TP] Supporting tags applied as text: ${tags.length} tags`);
      return;
    }

    let addedCount = 0;
    for (const clean of tags) {
      setFormValue(tagInput, clean);
      await sleep(200);
      tagInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, which: 13, bubbles: true }));
      tagInput.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', keyCode: 13, which: 13, bubbles: true }));
      await sleep(200);
      addedCount++;
    }
    document.body.click();
    debugLog(`[PodPilot-TP] ✓ Supporting tags applied: ${addedCount} tags`);
  }

  function normalizeSupportingTagList(tagsStr, primaryTag) {
    const rawTags = Array.isArray(tagsStr)
      ? tagsStr
      : String(tagsStr || '').split(/[,;\n]+/);
    const primaryNorm = cleanTagText(primaryTag).toLowerCase();
    const seen = new Set();
    const tags = [];
    for (const raw of rawTags) {
      const clean = cleanTagText(raw);
      const key = clean.toLowerCase();
      if (!clean || clean.length < 2 || key === primaryNorm || seen.has(key)) continue;
      seen.add(key);
      tags.push(clean);
    }
    return tags;
  }

  function findSupportingTagsInput() {
    const selectors = [
      'textarea[name="design[supporting_tags]"]',
      'textarea[name="design[secondary_tags]"]',
      'textarea[name="design[tag_list]"]',
      'textarea[name="design[tags]"]',
      'textarea[placeholder*="comma" i]',
      'textarea[placeholder*="tag" i]',
      'input[name="design[supporting_tags]"]',
      'input[name="design[secondary_tags]"]',
      'input[name="design[tag_list]"]',
      'input[name="design[tags]"]',
      '.taggle_input',
    ];
    for (const selector of selectors) {
      const input = document.querySelector(selector);
      if (input && isUsableTagField(input)) return input;
    }

    const labels = Array.from(document.querySelectorAll('label, div, span, p, strong'))
      .filter((el) => /supporting tags|secondary tags|other relevant tags/i.test(el.textContent || ''));
    for (const label of labels) {
      const container = label.closest('label, .form-group, .field, .input, .row, div') || label.parentElement;
      const input = container?.querySelector('textarea, input[type="text"], input:not([type])');
      if (input && isUsableTagField(input)) return input;
      const nextInput = label.parentElement?.querySelector('textarea, input[type="text"], input:not([type])');
      if (nextInput && isUsableTagField(nextInput)) return nextInput;
    }
    return null;
  }

  function isUsableTagField(input) {
    if (!input || input.disabled || input.readOnly) return false;
    if (input.type === 'hidden') return false;
    if (input.matches('input[name="design[primary_tag]"]')) return false;
    return true;
  }

  function setFormValue(input, value) {
    const proto = input.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (setter) setter.call(input, value);
    else input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function cleanTagText(text) {
    return (text || '').trim().replace(/\s+/g, ' ').replace(/[^\w\s\u0600-\u06FF]/g, '');
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
      const span = document.querySelector(`tr[data-canvas="${prod.canvas}"] .on-off span`);
      if (!span || !span.classList.contains('enabled')) continue; // only enabled products need colors

      const userColor = resolveProductColor(colorSettings, prod.key, prod.colorKey);
      const color = userColor || DEFAULT_COLORS[prod.canvas] || DEFAULT_COLORS[prod.key];
      await handlePause();
      debugLog(`[PodPilot-TP] Color for ${prod.name}: user="${userColor}", final="${color}"`);
      const success = await selectDdslickColor(prod.canvas, color, `tr[data-canvas="${prod.canvas}"]`);
      if (!success) {
        debugWarn(`[PodPilot-TP] ⚠ Could not select color "${color}" for ${prod.name}`);
      }
    }

    // ── Step 4: Select colors for enabled accessories ──
    for (const prod of ACCESSORY_PRODUCTS) {
      const span = document.querySelector(prod.selector);
      if (!span || !span.classList.contains('enabled')) continue;
      if (!prod.colorType) continue; // stickers/magnets don't need color

      const userColor = resolveProductColor(colorSettings, prod.key, `${prod.key}_color`);
      const color = userColor || DEFAULT_COLORS[prod.key] || DEFAULT_COLORS[prod.colorCanvas] || (prod.colorType === 'minicolors' ? '#ffffff' : 'Black');
      await handlePause();
      debugLog(`[PodPilot-TP] Color for ${prod.name}: user="${userColor}", final="${color}"`);

      if (prod.colorType === 'ddslick') {
        // hats, shorts, bags use ddslick dropdown
        const success = await selectDdslickColor(prod.colorCanvas, color, `#primary_color_${prod.colorCanvas}`);
        if (!success) {
          debugWarn(`[PodPilot-TP] ⚠ Could not select ddslick color "${color}" for ${prod.name}`);
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
            debugLog(`[PodPilot-TP] ✓ Minicolors set for ${sel.trim()}: ${hexColor}`);
          } else {
            debugWarn(`[PodPilot-TP] ✗ Minicolors input not found: ${sel.trim()}`);
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
      ddSelect = document.querySelector(`#primary_color_${canvas} .dd-select`) ||
                 document.querySelector(`#primary_color_${canvas} .dd-selected`);
    }
    if (!ddSelect) {
      debugWarn(`[PodPilot-TP] No ddslick dropdown found for ${canvas} (${containerSelector})`);
      return false;
    }

    // Click to open dropdown
    ddSelect.click();
    await sleep(500);

    // Find options - try multiple locations
    let options = null;
    for (let attempt = 0; attempt < 5; attempt++) {
      // Try within the container first
      if (container) {
        options = container.querySelectorAll('.dd-option');
      }
      // Try global if container had none
      if (!options || options.length === 0) {
        const globalContainer = document.querySelector(`#primary_color_${canvas}`);
        if (globalContainer) {
          options = globalContainer.querySelectorAll('.dd-option');
        }
      }
      // Last resort: all visible dd-options
      if (!options || options.length === 0) {
        options = document.querySelectorAll('.dd-option');
      }
      if (options && options.length > 0) break;
      await sleep(300);
    }

    if (!options || options.length === 0) {
      document.body.click();
      debugWarn(`[PodPilot-TP] No dropdown options found for ${canvas}`);
      return false;
    }

    // Try to find matching color
    const knownColors = TP_COLORS[canvas] || [];
    let found = false;

    // Strategy 1: Match via known color list
    if (knownColors.length) {
      for (const known of knownColors) {
        if (colorsMatch(targetColor, known)) {
          for (const opt of options) {
            const text = (opt.querySelector('.dd-option-text')?.textContent || opt.textContent || '').trim();
            if (colorsMatch(known, text)) {
              opt.click();
              await sleep(300);
              found = true;
              debugLog(`[PodPilot-TP] ✓ ddslick color for ${canvas}: "${text}"`);
              break;
            }
          }
          if (found) break;
        }
      }
    }

    // Strategy 2: Direct text match
    if (!found) {
      for (const opt of options) {
        const text = (opt.querySelector('.dd-option-text')?.textContent || opt.textContent || '').trim();
        if (colorsMatch(targetColor, text)) {
          opt.click();
          await sleep(300);
          found = true;
          debugLog(`[PodPilot-TP] ✓ ddslick color (direct) for ${canvas}: "${text}"`);
          break;
        }
      }
    }

    // Strategy 3: First non-placeholder option
    if (!found) {
      for (const opt of options) {
        const text = (opt.querySelector('.dd-option-text')?.textContent || opt.textContent || '').trim().toLowerCase();
        if (text && !text.includes('select') && !text.includes('default') && text.length > 1) {
          opt.click();
          await sleep(300);
          found = true;
          debugWarn(`[PodPilot-TP] ⚠ Used fallback color for ${canvas}: "${text}"`);
          break;
        }
      }
    }

    if (!found) {
      document.body.click();
      await sleep(200);
    }

    return found;
  }


  // ─── Pre-Publish Verification ───────────────────────────────────────────────
  // Checks that all user settings were actually applied before clicking publish.
  // Returns { valid: true } or { valid: false, errors: [...] }

  function verifyTeePublicConfigApplied(design) {
    const errors = [];
    const missingProducts = [];
    const missingColors = [];
    const wrongState = [];
    const productSettings = design.product_settings || {};
    const colorSettings = design.color_settings || {};

    // 1. Verify title
    const titleInput = document.querySelector('input[name="design[design_title]"]');
    if (design.title && titleInput) {
      if (!titleInput.value || titleInput.value.trim().length === 0) {
        errors.push('Title field is empty');
      }
    }

    // 2. Verify description
    const descInput = document.querySelector('textarea[name="design[design_description]"]');
    if (design.description && descInput) {
      if (!descInput.value || descInput.value.trim().length === 0) {
        errors.push('Description field is empty');
      }
    }

    // 3. Verify primary tag
    const primaryTagInput = document.querySelector('input[name="design[primary_tag]"]');
    if ((design.primary_tag || design.main_tag) && primaryTagInput) {
      if (!primaryTagInput.value || primaryTagInput.value.trim().length === 0) {
        errors.push('Primary tag is empty');
      }
    }

    // 4. Verify supporting tags
    const supportingTags = Array.isArray(design.supporting_tags)
      ? design.supporting_tags.join(', ')
      : String(design.supporting_tags || '').trim();
    if (supportingTags) {
      const supportingTagInput = findSupportingTagsInput();
      const tagValue = String(supportingTagInput?.value || '').trim();
      const tagTokens = document.querySelectorAll('.taggle_list .taggle, .taggle .taggle_text, .taggle_list li');
      if (!tagValue && tagTokens.length === 0) {
        errors.push('Supporting tags are empty');
      }
    }

    // 5. Verify adult content
    const adultYes = document.querySelector('#design_content_flag_true');
    const adultNo = document.querySelector('#design_content_flag_false');
    if (adultYes && adultNo) {
      const expectedAdult = design.adult_content === true || design.adult_content === 'Yes' || design.adult_content === 'yes' || design.adult_content === '1';
      if (expectedAdult && !adultYes.checked) {
        errors.push('Adult content should be Yes but is not checked');
      } else if (!expectedAdult && !adultNo.checked) {
        errors.push('Adult content should be No but is not checked');
      }
    }

    // 6. Verify product toggles match user's product_settings
    // Only verify products the user explicitly specified.
    // When adult_content is on, TeePublic disables Kids products
    // automatically — exclude them from the mismatch check.
    const adultOn = isAdultContentTrue(design.adult_content);
    for (const prod of APPAREL_PRODUCTS) {
      if (adultOn && KIDS_PRODUCT_KEYS.has(prod.key)) {
        continue; // TeePublic blocks Kids products in adult mode
      }
      const shouldEnable = resolveProductEnabled(productSettings, prod.key);
      if (shouldEnable === null) continue;

      const span = document.querySelector(`tr[data-canvas="${prod.canvas}"] .on-off span`);
      if (!span) {
        missingProducts.push(prod.name);
        continue;
      }

      const isEnabled = span.classList.contains('enabled');
      if (shouldEnable === true && !isEnabled) {
        wrongState.push(`${prod.name} (should be ON, is OFF)`);
      } else if (shouldEnable === false && isEnabled) {
        wrongState.push(`${prod.name} (should be OFF, is ON)`);
      }
    }

    for (const prod of ACCESSORY_PRODUCTS) {
      const shouldEnable = resolveProductEnabled(productSettings, prod.key);
      if (shouldEnable === null) continue;

      const span = document.querySelector(prod.selector);
      if (!span) {
        missingProducts.push(prod.name);
        continue;
      }

      const isEnabled = span.classList.contains('enabled');
      if (shouldEnable === true && !isEnabled) {
        wrongState.push(`${prod.name} (should be ON, is OFF)`);
      } else if (shouldEnable === false && isEnabled) {
        wrongState.push(`${prod.name} (should be OFF, is ON)`);
      }
    }

    // 6. Verify that every actually-enabled apparel product has a color selected.
    // Use DOM state, not user settings, because we leave nulls alone — there
    // may be enabled products that weren't in user settings.
    for (const prod of APPAREL_PRODUCTS) {
      const span = document.querySelector(`tr[data-canvas="${prod.canvas}"] .on-off span`);
      if (!span || !span.classList.contains('enabled')) continue;

      const row = document.querySelector(`tr[data-canvas="${prod.canvas}"]`);
      if (!row) continue;

      const selectedText = row.querySelector('.dd-selected-text, .dd-selected .dd-option-text, .dd-selected');
      if (selectedText) {
        const text = (selectedText.textContent || '').trim().toLowerCase();
        if (!text || text.includes('select') || text.includes('default')) {
          missingColors.push(prod.name);
        }
      }
    }

    // 6b. Verify that every actually-enabled accessory has its color set
    for (const prod of ACCESSORY_PRODUCTS) {
      const span = document.querySelector(prod.selector);
      if (!span || !span.classList.contains('enabled')) continue;
      if (!prod.colorType) continue;

      if (prod.colorType === 'minicolors' && prod.colorInput) {
        const firstSel = prod.colorInput.split(',')[0].trim();
        const input = document.querySelector(firstSel);
        if (input && (!input.value || input.value.length !== 7 || !input.value.startsWith('#'))) {
          missingColors.push(prod.name);
        }
      } else if (prod.colorType === 'ddslick') {
        const container = document.querySelector(`#primary_color_${prod.colorCanvas}`);
        if (container) {
          const selectedText = container.querySelector('.dd-selected-text, .dd-selected .dd-option-text');
          const text = ((selectedText && selectedText.textContent) || '').trim().toLowerCase();
          if (!text || text.includes('select') || text.includes('default')) {
            missingColors.push(prod.name);
          }
        }
      }
    }

    // 7. Verify at least one product is enabled
    const anyEnabled = document.querySelectorAll('.on-off span.enabled');
    debugLog(`[PodPilot-TP] verify: ${anyEnabled.length} products currently enabled in DOM`);
    if (anyEnabled.length === 0) {
      errors.push('No products are enabled — at least one must be ON');
    }

    // Aggregate detailed errors
    if (wrongState.length > 0) {
      errors.push(`Product settings not applied: ${wrongState.join(', ')}`);
    }
    if (missingProducts.length > 0) {
      errors.push(`Product rows not found: ${missingProducts.join(', ')}`);
    }
    if (missingColors.length > 0) {
      errors.push(`Missing colors: ${missingColors.join(', ')}`);
    }

    if (errors.length > 0) {
      console.error('[PodPilot-TP] ✗ Verification FAILED:');
      errors.forEach(e => console.error('   ·', e));
    } else {
      debugLog('[PodPilot-TP] ✓ Verification PASSED — all settings applied correctly');
    }

    return { valid: errors.length === 0, errors };
  }

  // Backwards-compat alias (matches naming in user spec)
  const verifyTeePublicProductsAndColors = verifyTeePublicConfigApplied;


  // ─── Publish ────────────────────────────────────────────────────────────────
  async function publishDesign(design) {
    updateOverlay('Publishing design...', 'Running pre-publish verification', 80);
    await handlePause();

    // ── Pre-publish verification ──
    const verification = verifyTeePublicConfigApplied(design);
    if (!verification.valid) {
      const errorMsg = 'Pre-publish verification failed:\n' + verification.errors.join('\n');
      updateOverlay('Verification failed', verification.errors[0], 80);
      throw new Error(errorMsg);
    }

    updateOverlay('Publishing design...', 'Accepting terms and submitting', 85);

    // Accept terms
    const terms = document.querySelector('#terms');
    if (terms && !terms.checked) {
      terms.checked = true;
      terms.dispatchEvent(new Event('change', { bubbles: true }));
      terms.dispatchEvent(new Event('click', { bubbles: true }));
      await sleep(300);
      debugLog('[PodPilot-TP] ✓ Terms accepted');
    }

    await sleep(2000);
    await handlePause();

    // Find publish button
    let publishBtn = null;
    for (const sel of PUBLISH_SELECTORS) {
      try { publishBtn = document.querySelector(sel); } catch (_) {}
      if (publishBtn) break;
    }
    if (!publishBtn) throw new Error('Publish button not found');

    // Wait for button to be enabled
    if (publishBtn.disabled) {
      for (let i = 0; i < 10; i++) {
        await sleep(1000);
        if (!publishBtn.disabled) break;
        if (i === 9) {
          publishBtn.disabled = false;
          publishBtn.removeAttribute('disabled');
        }
      }
    }

    // Disable beforeunload to allow navigation
    window.onbeforeunload = null;
    try {
      window.removeEventListener('beforeunload', window.__ppBeforeUnload, { capture: true });
      window.removeEventListener('beforeunload', window.__ppBeforeUnload);
    } catch (_) {}

    debugLog('[PodPilot-TP] ✓ Clicking publish button...');

    // Multiple click strategies (from MerchGhost reference)
    const saveTimer = debugTimerStart("final save click duration", {
      marketplace: "teepublic",
      designId: design.id || design.design_id || "",
    });
    try {
      publishBtn.disabled = false;
      publishBtn.removeAttribute('disabled');

      const clickEvent = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, view: window });
      publishBtn.dispatchEvent(clickEvent);
      await sleep(100);

      publishBtn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }));
      await sleep(50);
      publishBtn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, button: 0 }));
      await sleep(100);

      try { publishBtn.click(); } catch (_) {}
      await sleep(200);

      // Form submit fallback
      const form = publishBtn.closest('form');
      if (form) {
        if (!form.action || form.action.includes('javascript:')) {
          form.action = form.action || window.location.href;
        }
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        setTimeout(() => { try { form.submit(); } catch (_) {} }, 300);
      }
    } catch (clickErr) {
      try { publishBtn.click(); } catch (_) {}
    }

    await sleep(500);
    debugTimerEnd(saveTimer, { ok: true });
    debugLog('[PodPilot-TP] ✓ Publish clicked');
  }

  function waitForSuccess(timeoutMs = 60000) {
    return new Promise((resolve) => {
      const startTime = Date.now();
      const interval = setInterval(() => {
        const url = window.location.href;
        const elapsed = Date.now() - startTime;

        function finishSuccess(result) {
          clearInterval(interval);
          suppressImageProcessingOverlay = true;
          debugLog('[PodPilot-TP] Success detected; cleaning TeePublic overlay');
          removeProgressOverlay();
          setStoredTpUploadState({
            active: true,
            stage: 'success_detected',
            publishClicked: true,
            imageInjected: true,
          }).finally(() => resolve(result));
        }

        if (isTeePublicFinalPage()) {
          debugLog('[PodPilot-TP] Final TeePublic page detected; suppressing progress overlay');
          finishSuccess({ success: true, url });
          return;
        }

        if (!url.includes('quick_create') && !url.includes('design/new')) {
          finishSuccess({ success: true, url });
          return;
        }

        // Published product URL
        const match = url.match(/teepublic\.com\/([a-z-]+)\/(\d+)-(.+)/);
        if (match) {
          const [, productType, id] = match;
          if (SUCCESS_PRODUCT_TYPES.includes(productType)) {
            clearInterval(interval);
            debugLog(`[PodPilot-TP] ✓ Success: Product page — ${productType}/${id}`);
            finishSuccess({ success: true, url, productType, productId: id });
            return;
          }
        }

        if (elapsed >= timeoutMs) {
          clearInterval(interval);
          if (!url.includes('quick_create') && !url.includes('design/new')) {
            debugLog('[PodPilot-TP] Timeout but URL changed — assuming success');
            finishSuccess({ success: true, url });
          } else {
            debugWarn('[PodPilot-TP] ✗ Timeout waiting for success URL');
            resolve({ success: false, error: 'Timeout waiting for published page' });
          }
        }

        if (elapsed % 10000 === 0) {
          updateOverlay('Publishing design...', `Scanning for redirect... ${elapsed / 1000}s`, 92);
        }
      }, 1000);
    });
  }


  // ─── Main Upload Pipeline ───────────────────────────────────────────────────
  async function runUpload(design) {
    currentDesign = design;
    isStopped = false;
    isPaused = false;

    createOverlay();
    updateOverlay('Preparing upload...', 'Starting TeePublic automation', 5);
    await setStoredTpUploadState({
      active: true,
      stage: 'page_ready',
      imageInjected: false,
      designId: design.id || design.design_id || '',
    });
    debugLog('[PodPilot-TP] === Starting upload for:', design.title || design.filename || design.id);
    debugLog('[PodPilot-TP] product_settings:', JSON.stringify(design.product_settings));
    debugLog('[PodPilot-TP] color_settings:', JSON.stringify(design.color_settings));
    debugLog('[PodPilot-TP] adult_content:', design.adult_content);

    try {
      // Step 1-2: Upload image and wait for processing
      await handlePause();
      const designId = getDesignTerminalId(design);
      const storedStateBeforeInjection = await getStoredTpUploadState();
      if (isDesignTerminalHandled(storedStateBeforeInjection, designId)) {
        debugLog(`[TP Batch] skipping already terminal design_id=${designId}`);
        return { status: 'error', terminal: true, error: 'Design already terminal-handled.' };
      }
      if (design.image_url || design.imageBase64) {
        const imageSource = design.imageBase64
          ? `data:image/png;base64,${design.imageBase64}`
          : design.image_url;
        await uploadImage(imageSource);
      } else {
        throw new Error('No image provided for upload');
      }

      // Step 3-4: Fill design info (title, description, tags, adult content)
      await handlePause();
      await setStoredTpUploadState({
        active: true,
        stage: 'metadata_fill',
        imageInjected: true,
        designId: design.id || design.design_id || '',
      });
      await fillDesignInfo(design);

      // Step 5-6: Configure products and colors
      await handlePause();
      await configureProducts(design);

      // Step 7-9: Verify, accept terms, publish
      await handlePause();
      await setStoredTpUploadState({
        active: true,
        stage: 'publish_click',
        publishClicked: true,
        imageInjected: true,
        designId: design.id || design.design_id || '',
      });
      suppressImageProcessingOverlay = true;
      debugLog('[PodPilot-TP] Publish clicked; suppressing image-processing overlay');
      await publishDesign(design);

      // Step 10: Wait for success
      const result = await waitForSuccess();

      if (result.success) {
        updateOverlay('Upload complete!', 'Design published successfully', 100);
        debugLog('[PodPilot-TP] ═══ Upload SUCCESS:', result.url);
        await setStoredTpUploadState({
          active: true,
          stage: 'done',
          publishClicked: true,
          imageInjected: true,
          designId: design.id || design.design_id || '',
        });
        return { status: 'success', url: result.url };
      } else {
        console.error('[PodPilot-TP] ═══ Upload FAILED:', result.error);
        await setStoredTpUploadState({
          active: true,
          stage: 'error',
          imageInjected: false,
          designId: design.id || design.design_id || '',
        });
        return { status: 'error', error: result.error || 'Publish failed' };
      }
    } catch (err) {
      const msg = err?.message || String(err);
      console.error('[PodPilot-TP] ═══ Upload ERROR:', msg);
      updateOverlay('Upload failed', msg, 0);
      await setStoredTpUploadState({
        active: true,
        stage: isStopped ? 'stopped' : 'error',
        imageInjected: false,
        designId: design.id || design.design_id || '',
      });
      return { status: 'error', error: msg };
    }
  }



  // ─── Message Listener ───────────────────────────────────────────────────────
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || !message.action) return;

    if (message.action === 'ping') {
      sendResponse({ ok: true, page: 'teepublic' });
      return;
    }

    if (message.action === 'tp_upload_page_ready') {
      sendResponse(getTpUploadReadyState());
      return;
    }

    if (message.action === 'tp_fill_and_publish') {
      const design = message.design;
      if (!design) {
        sendResponse({ ok: false, error: 'No design data provided' });
        return;
      }

      if (message.designIndex !== undefined && message.queueTotal !== undefined) {
        updateOverlayDesignCount(message.designIndex + 1, message.queueTotal);
      }

      runUpload(design).then((result) => {
        if (!result.terminal) {
          chrome.runtime.sendMessage({
            action: 'upload_result',
            design_id: design.id || design.design_id,
            status: result.status,
            error_message: result.error || '',
            published_url: result.url || '',
          }, () => { void chrome.runtime.lastError; });
        }
        sendResponse(result);
      }).catch((err) => {
        const errorResult = { status: 'error', error: err?.message || String(err) };
        chrome.runtime.sendMessage({
          action: 'upload_result',
          design_id: design.id || design.design_id,
          status: 'error',
          error_message: errorResult.error,
        }, () => { void chrome.runtime.lastError; });
        sendResponse(errorResult);
      });

      return true; // async response
    }

    if (message.action === 'tp_stop') {
      isStopped = true;
      isPaused = false;
      updateOverlayStatus();
      sendResponse({ ok: true });
      return;
    }

    if (message.action === 'tp_pause') {
      isPaused = true;
      updateOverlayStatus();
      sendResponse({ ok: true });
      return;
    }

    if (message.action === 'tp_resume') {
      isPaused = false;
      updateOverlayStatus();
      sendResponse({ ok: true });
      return;
    }

    if (message.action === 'queue_complete') {
      const summary = message.summary;
      if (summary) {
        showCompletionOverlay(summary.success || 0, summary.total || 0);
      }
      sendResponse({ ok: true });
      return;
    }
  });

  // ─── Auto-boot for ?auto=1 ─────────────────────────────────────────────────
  const params = new URLSearchParams(window.location.search);
  if (params.get('auto') === '1') {
    createOverlay();
    updateOverlay('Preparing upload...', 'Waiting for background to send design data', 5);

    // Notify background that the TeePublic page is ready
    setTimeout(() => {
      chrome.runtime.sendMessage(
        { action: 'tp_tab_ready' },
        () => { void chrome.runtime.lastError; }
      );
    }, 1000);
  }

  // ─── TeePublic Date Badge, Tags Copy, Circular Buttons & Client-Side Age Sorting (PodPilot Purple Style) ───
  let f = "none";
  let b = [];

  function h() {
    let e = window.location.href;
    return e.includes("/user/") || e.includes("/account/");
  }

  function c(e) {
    for (let t of [/\/v(\d{10,})\/production\/designs\//, /\/designs\/\d+_\d+\/(\d{10,})\//, /\/designs\/\d+\/(\d{10,})\//, /\/(\d{10,})$/, /_(\d{10,})_/, /_(\d{10,})$/, /(\d{10,})/]) {
      let o = e.match(t);
      if (o) {
        let e = parseInt(o[1]);
        if (e > 946684800) return e;
      }
    }
    return null;
  }

  function d(e) {
    let t = e.querySelector('a[href*="/designs/"]');
    if (t && t.href) {
      let e = c(t.href);
      if (e) return e;
    }
    let o = [
      e.querySelector('a[href*="/mug/"]'),
      e.querySelector('a[href*="/t-shirt/"]'),
      e.querySelector('a[href*="/hoodie/"]'),
      e.querySelector('a[href*="/hat/"]'),
      e.querySelector('a[href*="/sticker/"]'),
      e.querySelector('a[data-action*="product-clicked"]')
    ];
    for (let e of o) {
      if (e && e.href) {
        let t = c(e.href);
        if (t) return t;
      }
    }
    let a = e.querySelector(".tp-design-tile__image");
    if (a && a.src) {
      let t = c(a.src);
      if (t && t > 1e9) return t;
      let o = u(a.src);
      if (o) {
        let t = document.querySelectorAll(".tp-design-tile");
        for (let a of t) {
          if (a === e) continue;
          let t = a.querySelector(".tp-design-tile__image");
          if (t && t.src) {
            let e = u(t.src);
            if (e === o) {
              let e = c(t.src);
              if (e && e > 1e9) return e;
            }
          }
        }
      }
    }
    return null;
  }

  function u(e) {
    let t = e.match(/\/designs\/(\d+)_\d+/);
    if (t) return t[1];
    let o = e.match(/\/designs\/(\d+)/);
    return o ? o[1] : null;
  }

  function p(e) {
    let t = new Date(1e3 * e);
    let o = t.getUTCFullYear();
    let a = String(t.getUTCMonth() + 1).padStart(2, "0");
    let r = String(t.getUTCDate()).padStart(2, "0");
    let n = String(t.getUTCHours()).padStart(2, "0");
    let s = String(t.getUTCMinutes()).padStart(2, "0");
    let i = String(t.getUTCSeconds()).padStart(2, "0");
    return `${o}/${a}/${r} ${n}:${s}:${i} GMT`;
  }

  function m() {
    try {
      let e = window.scrollY || window.pageYOffset;
      let t = document.querySelectorAll(".tp-design-tile");
      if (0 === b.length && t.length > 0) {
        b = Array.from(t);
      }
      
      let o = document.querySelector(".podpilot-best-keywords");
      if (!o) {
        (function(e = false) {
          if (h()) return;
          let t = document.querySelector(".podpilot-keywords-container");
          if (!t) return;
          let o = t.querySelector(".podpilot-best-keywords");
          if (o && !e) return;
          let a = window.scrollY || window.pageYOffset;
          if (o) o.remove();
          w(t);
          requestAnimationFrame(() => {
            window.scrollTo(0, a);
          });
        })(true);
      }

      t.forEach((e) => {
        try {
          if (e.hasAttribute("data-podpilot-processed")) return;
          if (e.closest(".m-also-available-products") || e.closest(".m-recently-viewed-designs__contain") || e.closest(".jsRecentlyViewedDesigns")) {
            e.setAttribute("data-podpilot-processed", "true");
            return;
          }
          e.setAttribute("data-podpilot-processed", "true");
          let t = e.querySelector(".tp-design-tile__image");
          if (t && t.src || (t = e.querySelector('img[src*="images.teepublic.com"]')),
              t && t.src || (t = e.querySelector('img[src*="/designs/"]')),
              !t || !t.src) {
            let o = e.querySelectorAll("img");
            for (let e of o) {
              let o = e.src;
              if (o && o.includes("images.teepublic.com") && o.includes("/designs/")) {
                t = e;
                break;
              }
            }
          }
          if (!t || !t.src) return;
          let o = d(e);
          if (!o) return;
          let a = p(o);
          (function(e, t) {
            if (e.querySelector(".podpilot-publish-date")) return;
            let o = document.createElement("div");
            o.className = "podpilot-publish-date";
            o.textContent = t;
            let a = e.querySelector(".tp-design-tile__image-wrap");
            if (a) {
              if (!a.style.position || "static" === a.style.position || "" === a.style.position) {
                a.style.position = "relative";
              }
              if (!a.style.overflow || "hidden" === a.style.overflow) {
                a.style.overflow = "visible";
              }
              a.appendChild(o);
            }
          })(e, a);
        } catch (_) {}
      });
      requestAnimationFrame(() => {
        window.scrollTo(0, e);
      });
    } catch (_) {}
  }

  function g() {
    try {
      if (document.querySelector(".podpilot-product-date-badge") || document.querySelector(".podpilot-product-circular-btns")) return;
      let e = document.querySelector(".glide__slide--active") || document.querySelector('.glide__slide[data-default="active"]');
      if (!e) return;
      let t = window.location.href;
      let o = c(t);
      if (!o) {
        let e = document.querySelector(".jsProductMainImage");
        if (e && e.src) {
          o = c(e.src);
        }
        if (!o) return;
      }
      let a = p(o);
      let r = document.createElement("div");
      r.className = "podpilot-product-date-badge";
      r.textContent = a;
      Object.assign(r.style, {
        position: "absolute",
        top: "12px",
        left: "12px",
        background: "#EDE9FE",
        color: "#4C1D95",
        padding: "6px 12px",
        borderRadius: "6px",
        fontSize: "11px",
        fontWeight: "600",
        zIndex: "10",
        boxShadow: "0 2px 8px rgba(139, 92, 246, 0.4)",
        border: "1px solid #8B5CF6",
        letterSpacing: "0.3px"
      });
      if (!e.style.position || "static" === e.style.position) {
        e.style.position = "relative";
      }
      e.appendChild(r);

      // Add tag copying circular buttons on product page next to Favorite button
      let nBtn = document.querySelector(".tp-social-button--favorite") || document.querySelector('[data-action*="favorite"]') || document.querySelector(".m-product-actions__favorite") || document.querySelector('[class*="favorite"]');
      if (!nBtn) return;

      let sContainer = document.createElement("div");
      sContainer.className = "podpilot-product-circular-btns";
      sContainer.style.cssText = `
        display: flex;
        gap: 8px;
        margin-left: 8px;
      `;

      let iBtn = document.createElement("button");
      iBtn.className = "podpilot-circular-btn podpilot-copy-tags-btn";
      iBtn.innerHTML = '<span class="podpilot-btn-icon">📋</span>';
      iBtn.title = "Copy Tags";
      iBtn.style.cssText = `
        width: 40px;
        height: 40px;
        border-radius: 50%;
        border: none;
        background: linear-gradient(135deg, #a78bfa 0%, #7c3aed 100%);
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        transition: all 0.2s ease;
        box-shadow: 0 2px 6px rgba(124, 58, 237, 0.3);
      `;

      iBtn.onclick = async ev => {
        ev.preventDefault();
        ev.stopPropagation();
        iBtn.disabled = true;
        let originalHtml = iBtn.innerHTML;
        iBtn.innerHTML = '<span class="podpilot-btn-icon">⏳</span>';
        
        let meta = (function() {
          let h1 = document.querySelector("h1.h__h1--sm");
          let h2 = document.querySelector("h2.m-design-details__primary-tag");
          let pDesc = document.querySelector("p.m-design-details__description-text");
          let tags = document.querySelectorAll(".gtmDesignersAppliedTag");
          return {
            title: h1?.textContent?.trim() || "",
            mainTag: h2?.textContent?.trim() || "",
            description: pDesc?.textContent?.trim() || "",
            tags: Array.from(tags).map(el => el.textContent?.trim() || "").filter(Boolean),
            url: window.location.href
          };
        })();

        let ok = await k(meta.tags);
        if (ok) {
          iBtn.innerHTML = '<span class="podpilot-btn-icon">✓</span>';
          iBtn.style.background = "linear-gradient(135deg, #10b981 0%, #059669 100%)";
          setTimeout(() => {
            iBtn.innerHTML = originalHtml;
            iBtn.style.background = "linear-gradient(135deg, #a78bfa 0%, #7c3aed 100%)";
            iBtn.disabled = false;
          }, 1500);
        } else {
          iBtn.innerHTML = '<span class="podpilot-btn-icon">✗</span>';
          setTimeout(() => {
            iBtn.innerHTML = originalHtml;
            iBtn.disabled = false;
          }, 1500);
        }
      };

      iBtn.onmouseover = () => {
        iBtn.style.transform = "scale(1.1)";
        iBtn.style.boxShadow = "0 4px 12px rgba(124, 58, 237, 0.5)";
      };
      iBtn.onmouseout = () => {
        iBtn.style.transform = "scale(1)";
        iBtn.style.boxShadow = "0 2px 6px rgba(124, 58, 237, 0.3)";
      };

      sContainer.appendChild(iBtn);
      let pNode = nBtn.parentElement;
      if (pNode) {
        let act = pNode.querySelector(".m-product-preview__actions-container") || pNode;
        if (act) {
          act.style.display = "flex";
          act.style.alignItems = "center";
          act.style.gap = "8px";
          nBtn.parentNode?.insertBefore(sContainer, nBtn.nextSibling);
        }
      }
    } catch (_) {}
  }

  let _ = ["Kids Long Sleeve T-Shirt", "Long Sleeve T-Shirt", "Baseball Tee", "Kids Hoodie", "Kids T-Shirt", "Wall Art", "Tapestries", "Stickers", "Crewneck", "Pillows", "Magnets", "Apparel", "Shorts", "Totes", "Mugs", "Cases", "Pins", "Socks", "Bags", "Hats", "T-Shirt", "Hoodie", "Tank", "Kids"].sort((e, t) => t.length - e.length);
  
  function x(e) {
    if (!e || "string" != typeof e) return e;
    let t = e.trim();
    let o = e => e.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    for (let e of _) {
      let a = RegExp(`(?:^|[\\s,\\-])${o(e)}(?=[\\s,\\-]|$)`, "gi");
      t = t.replace(a, "").trim();
    }
    return t.replace(/\s\s+/g, " ").replace(/^[\s,\-]+|[\s,\-]+$/g, "").trim();
  }

  async function k(e) {
    try {
      let t = (Array.isArray(e) ? e : []).map(e => x(e)).filter(e => e.length > 0);
      let o = t.join(", ");
      await navigator.clipboard.writeText(o);
      return true;
    } catch (e) {
      console.error("Error copying tags:", e);
      return false;
    }
  }

  async function P(e) {
    try {
      let t = await fetch(e);
      let o = await t.text();
      let a = new DOMParser();
      let r = a.parseFromString(o, "text/html");
      let n = r.querySelector(".m-search__related-results");
      let s = n ? n.querySelectorAll(".gtmDesignersAppliedTag") : r.querySelectorAll(".gtmDesignersAppliedTag");
      let i = Array.from(s).map(e => e.textContent?.trim() || "").filter(Boolean);
      return i;
    } catch (e) {
      return [];
    }
  }

  function w(e) {
    try {
      if (h()) return;
      let t = document.querySelectorAll(".tp-design-tile");
      let o = Array.from(t).filter(e => !e.closest(".m-recently-viewed-designs__contain") && !e.closest(".jsRecentlyViewedDesigns"));
      if (0 === o.length) return;
      let a = {};
      let r = 0;
      o.forEach(e => {
        let t = e.querySelector(".tp-design-tile__seo-secondary-tags");
        if (t) {
          let e = t.textContent || "";
          let o = e.replace(/^Tags:\s*/i, "").split(",").map(e => e.trim().toLowerCase().replace(/^tags:\s*/i, "").replace(/tags:\s*/gi, "").trim()).filter(e => e.length > 0 && "tags" !== e && "tags:" !== e && "tag" !== e && !e.startsWith("tags"));
          o.forEach(e => {
            let t = x(e);
            if (t && t.length > 2) {
              a[t] = (a[t] || 0) + 1;
              r++;
            }
          });
        }
      });
      let n = Object.entries(a).sort((e, t) => t[1] !== e[1] ? t[1] - e[1] : e[0].localeCompare(t[0])).slice(0, 13);
      if (0 === n.length) return;
      let s = document.createElement("div");
      s.className = "podpilot-best-keywords";
      s.style.cssText = `
        display: flex;
        flex-direction: column;
        gap: 8px;
        width: 100%;
        min-width: 0;
      `;
      let i = document.createElement("div");
      i.style.cssText = `
        font-size: 13px;
        font-weight: 700;
        color: #374151;
        display: flex;
        align-items: center;
        gap: 6px;
        white-space: nowrap;
      `;
      i.innerHTML = '<span style="font-size: 16px;">🔥</span> Best Tags';
      let l = document.createElement("div");
      l.style.cssText = `
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        max-height: 80px;
        overflow-y: auto;
        overflow-x: hidden;
        padding-right: 4px;
      `;
      let cStyle = document.createElement("style");
      cStyle.textContent = `
        .podpilot-best-keywords div::-webkit-scrollbar {
          width: 6px;
        }
        .podpilot-best-keywords div::-webkit-scrollbar-track {
          background: #f3f4f6;
          border-radius: 3px;
        }
        .podpilot-best-keywords div::-webkit-scrollbar-thumb {
          background: #d1d5db;
          border-radius: 3px;
        }
        .podpilot-best-keywords div::-webkit-scrollbar-thumb:hover {
          background: #9ca3af;
        }
      `;
      document.head.appendChild(cStyle);
      
      n.forEach(([e, tCount], idx) => {
        let btn = document.createElement("button");
        btn.textContent = e;
        btn.title = `Click to copy "${e}"`;
        btn.style.cssText = `
          padding: 6px 12px;
          background: ${idx < 3 ? "#EDE9FE" : "#f3f4f6"};
          color: ${idx < 3 ? "#4C1D95" : "#374151"};
          border: 1px solid ${idx < 3 ? "#8B5CF6" : "#d1d5db"};
          border-radius: 6px;
          font-size: 12px;
          font-weight: ${idx < 3 ? "600" : "500"};
          cursor: pointer;
          transition: all 0.2s;
          white-space: nowrap;
          flex-shrink: 0;
        `;
        btn.onclick = async () => {
          await navigator.clipboard.writeText(e);
          let txt = btn.textContent;
          btn.textContent = "✓ Copied!";
          btn.style.background = "#dcfce7";
          btn.style.borderColor = "#86efac";
          btn.style.color = "#15803d";
          setTimeout(() => {
            btn.textContent = txt;
            btn.style.background = idx < 3 ? "#EDE9FE" : "#f3f4f6";
            btn.style.borderColor = idx < 3 ? "#8B5CF6" : "#d1d5db";
            btn.style.color = idx < 3 ? "#4C1D95" : "#374151";
          }, 1000);
        };
        btn.onmouseover = () => {
          btn.style.transform = "translateY(-2px)";
          btn.style.boxShadow = "0 4px 8px rgba(139, 92, 246, 0.15)";
        };
        btn.onmouseout = () => {
          btn.style.transform = "translateY(0)";
          btn.style.boxShadow = "none";
        };
        l.appendChild(btn);
      });

      let copyAllBtn = document.createElement("button");
      copyAllBtn.textContent = "Copy All";
      copyAllBtn.title = "Copy all tags";
      copyAllBtn.style.cssText = `
        padding: 6px 12px;
        background: #7C3AED;
        color: white;
        border: 1px solid #6D28D9;
        border-radius: 6px;
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.2s;
        white-space: nowrap;
        flex-shrink: 0;
      `;
      copyAllBtn.onclick = async () => {
        let tagStr = n.map(([e]) => e).join(", ");
        await navigator.clipboard.writeText(tagStr);
        let txt = copyAllBtn.textContent;
        copyAllBtn.textContent = "✓ Copied!";
        copyAllBtn.style.background = "#10b981";
        copyAllBtn.style.borderColor = "#059669";
        setTimeout(() => {
          copyAllBtn.textContent = txt;
          copyAllBtn.style.background = "#7C3AED";
          copyAllBtn.style.borderColor = "#6D28D9";
        }, 1000);
      };
      copyAllBtn.onmouseover = () => {
        copyAllBtn.style.transform = "translateY(-2px)";
        copyAllBtn.style.boxShadow = "0 4px 8px rgba(124, 58, 237, 0.3)";
        copyAllBtn.style.background = "#6D28D9";
      };
      copyAllBtn.onmouseout = () => {
        copyAllBtn.style.transform = "translateY(0)";
        copyAllBtn.style.boxShadow = "none";
        copyAllBtn.style.background = "#7C3AED";
      };
      l.appendChild(copyAllBtn);
      
      s.appendChild(i);
      s.appendChild(l);
      e.appendChild(s);
    } catch (e) {
      console.error("Error adding best keywords:", e);
    }
  }

  function y() {
    try {
      if (h()) return;
      (function() {
        try {
          if (h()) {
            let e = document.querySelector(".podpilot-custom-toolbar");
            if (e) e.remove();
            return;
          }
          if (document.querySelector(".podpilot-custom-toolbar")) return;
          let e = document.querySelector(".m-search__browse-results, .cards__designs-redesign, .jsTilesDesigns");
          if (!e) return;
          let t = document.createElement("div");
          t.className = "podpilot-custom-toolbar";
          t.style.cssText = `
            background: white;
            padding: 16px 20px;
            border-radius: 8px;
            margin-bottom: 20px;
            border: 1px solid #e5e7eb;
            box-shadow: 0 1px 3px rgba(0, 0, 0, 0.06);
            display: grid;
            grid-template-columns: 1fr auto;
            gap: 20px;
            align-items: start;
          `;
          let o = document.createElement("div");
          o.className = "podpilot-keywords-container";
          o.style.cssText = `
            min-width: 0;
            max-width: 100%;
            overflow: hidden;
          `;
          let a = document.createElement("div");
          a.className = "podpilot-filters-container";
          a.style.cssText = `
            display: flex;
            gap: 8px;
            align-items: center;
            flex-shrink: 0;
            flex-wrap: wrap;
            justify-content: flex-end;
          `;
          t.appendChild(o);
          t.appendChild(a);
          e.parentElement?.insertBefore(t, e);
          w(o);
        } catch (e) {
          console.error("Error creating custom toolbar:", e);
        }
      })();

      let e = document.querySelector(".podpilot-filters-container");
      if (!e || e.querySelector(".podpilot-age-filter")) return;
      let t = document.createElement("div");
      t.className = "podpilot-age-filter";
      t.innerHTML = `
        <div class="m-search__sort-btn-container">
          <div class="m-search__sort-menu" data-controller="search--sort-and-filter" data-search--sort-and-filter-container-selector-value=".podpilot-age-filter">
            <button type="button" class="btn m-search__sort-btn btn--no-space tp-btn--medium" data-action="click->search--sort-and-filter#toggleSortFilterList" data-search--sort-and-filter-target="triggerButton">
              <span class="teepublicon teepublicon--dark-default teepublicon-background--transparent teepublicon-spacing--right">
                <svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg" width="16" height="16" focusable="false" aria-hidden="true">
                  <path fill-rule="evenodd" clip-rule="evenodd" d="M14.504 4c.754 0 1.361.26 1.648.395.35.165.677.367.954.554.56.378 1.164.868 1.756 1.381 2.448 2.123 3.146 3.01 5.333 5.404l.001.002c1.131 1.242 1.067 3.19-.145 4.35a2.947 2.947 0 0 1-4.24-.148c-1.887-2.066-2.307-2.554-2.307-2.554v27.538c0 1.7-1.343 3.078-3 3.078s-3-1.378-3-3.078V13.385s-1.112 1.241-2.306 2.551-3.03 1.31-4.241.15a3.134 3.134 0 0 1-.153-4.35C6.986 9.34 7.697 8.455 10.147 6.33c.591-.513 1.196-1.003 1.755-1.38.277-.188.604-.39.954-.555.287-.135.894-.395 1.648-.395Zm18.992 40c-.754 0-1.361-.26-1.648-.395a7.178 7.178 0 0 1-.954-.554c-.56-.378-1.164-.868-1.756-1.381-2.448-2.123-3.146-3.01-5.333-5.404l-.001-.002c-1.131-1.242-1.067-3.19.145-4.35a2.947 2.947 0 0 1 4.24.148c1.887 2.066 2.307 2.553 2.307 2.553V7.078c0-1.7 1.343-3.078 3-3.078s3 1.378 3 3.078v27.537s1.112-1.241 2.306-2.551 3.03-1.31 4.241-.15a3.134 3.134 0 0 1 .153 4.35c-2.182 2.397-2.893 3.282-5.343 5.406-.591.513-1.196 1.003-1.755 1.38-.277.188-.604.39-.954.555-.287.135-.894.395-1.648.395Z"></path>
                </svg>
              </span>
              <div class="button__content">
                Age: <span class="podpilot-age-sort-label">Default</span>
              </div>
            </button>
            
            <div class="link-collection m-search__sort-dropdown hidden podpilot-age-dropdown" style="position: fixed; top: auto; bottom: calc(100vh - var(--button-bottom, 0px) + 8px); left: var(--button-left, 0px); z-index: 99999; background: white; border: 1px solid #e5e7eb; border-radius: 8px; box-shadow: 0 8px 32px rgba(0,0,0,0.12), 0 2px 8px rgba(0,0,0,0.08); min-width: 160px; overflow: hidden; transform: translateY(0); transition: all 0.2s ease;">
              <div class="link-collection__body" style="padding: 8px 0;">
                <div class="link-collection__content">
                  <a href="#" class="link m-search__sort-dropdown__link link-collection__link link--1 link--default podpilot-age-option active" data-sort="none" style="display: block; padding: 12px 16px; text-decoration: none; color: #374151; font-weight: 500; transition: background-color 0.2s;">
                    <span class="link__content">Default</span>
                  </a>
                  <a href="#" class="link m-search__sort-dropdown__link link-collection__link link--1 link--default podpilot-age-option" data-sort="oldest" style="display: block; padding: 12px 16px; text-decoration: none; color: #374151; font-weight: 500; transition: background-color 0.2s;">
                    <span class="link__content">Oldest First</span>
                  </a>
                  <a href="#" class="link m-search__sort-dropdown__link link-collection__link link--1 link--default podpilot-age-option" data-sort="newest" style="display: block; padding: 12px 16px; text-decoration: none; color: #374151; font-weight: 500; transition: background-color 0.2s;">
                    <span class="link__content">Newest First</span>
                  </a>
                </div>
              </div>
            </div>
          </div>
        </div>
      `;
      t.style.cssText = `
        display: inline-block;
        position: relative;
      `;
      e.appendChild(t);

      let styleEl = document.createElement("style");
      styleEl.textContent = `
        .podpilot-age-filter .m-search__sort-btn {
          display: inline-flex !important;
          align-items: center !important;
          justify-content: flex-start !important;
          height: 38px !important;
          padding: 0 14px !important;
          background: #f9fafb !important;
          border: 1px solid #d1d5db !important;
          border-radius: 6px !important;
          font-size: 14px !important;
          font-weight: 500 !important;
          color: #374151 !important;
          text-decoration: none !important;
          transition: all 0.15s ease !important;
          cursor: pointer !important;
          white-space: nowrap !important;
          min-width: 130px !important;
          box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04) !important;
          font-family: inherit !important;
          line-height: 1.5 !important;
          vertical-align: middle;
        }
        
        .podpilot-age-filter .m-search__sort-btn:hover {
          background: white !important;
          border-color: #9ca3af !important;
          box-shadow: 0 2px 4px rgba(0, 0, 0, 0.08) !important;
        }
        
        .podpilot-age-filter .m-search__sort-btn:active {
          background: #f3f4f6 !important;
        }
        
        .podpilot-age-filter .m-search__sort-btn:focus {
          outline: none !important;
          border-color: #8B5CF6 !important;
        }
        
        .podpilot-age-filter .teepublicon {
          margin-right: 8px !important;
          flex-shrink: 0 !important;
          display: inline-flex !important;
          align-items: center !important;
          width: 16px !important;
          height: 16px !important;
        }
        
        .podpilot-age-filter .button__content {
          display: flex !important;
          align-items: center !important;
          gap: 4px !important;
          flex: 1 !important;
          font-weight: 500 !important;
          min-width: 0 !important;
        }
        
        .podpilot-age-option:hover {
          background-color: #f8fafc !important;
          color: #4C1D95 !important;
        }
        .podpilot-age-option.active {
          background-color: #8B5CF6 !important;
          color: white !important;
        }
        .podpilot-age-dropdown {
          backdrop-filter: blur(12px);
          border: 1px solid rgba(0,0,0,0.08) !important;
        }
        .podpilot-age-dropdown.hidden {
          opacity: 0;
          transform: translateY(-8px) scale(0.95);
          pointer-events: none;
        }
        .podpilot-age-dropdown:not(.hidden) {
          opacity: 1;
          transform: translateY(0) scale(1);
          pointer-events: auto;
        }
        
        .podpilot-age-filter .m-search__sort-btn-container {
          display: inline-block !important;
          vertical-align: top !important;
        }
        
        .podpilot-age-filter .m-search__sort-menu {
          display: inline-block !important;
          position: relative !important;
        }
        
        .podpilot-age-filter .btn {
          all: unset !important;
          display: inline-flex !important;
          align-items: center !important;
          justify-content: flex-start !important;
          height: 40px !important;
          padding: 0 16px !important;
          background: #ffffff !important;
          border: 1px solid #e5e7eb !important;
          border-radius: 8px !important;
          font-size: 14px !important;
          font-weight: 500 !important;
          color: #374151 !important;
          text-decoration: none !important;
          transition: all 0.2s ease !important;
          cursor: pointer !important;
          white-space: nowrap !important;
          min-width: 120px !important;
          box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05) !important;
          font-family: inherit !important;
          line-height: 1.5 !important;
          vertical-align: middle !important;
          position: relative !important;
          overflow: visible !important;
          box-sizing: border-box !important;
        }
        
        .podpilot-age-filter .btn:hover {
          background: #f9fafb !important;
          border-color: #d1d5db !important;
          box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1) !important;
        }
        
        .podpilot-age-filter .btn:active {
          background: #f3f4f6 !important;
          transform: translateY(1px) !important;
        }
        
        .podpilot-age-filter .btn:focus {
          outline: none !important;
          border-color: #8B5CF6 !important;
          box-shadow: 0 0 0 3px rgba(139, 92, 246, 0.1) !important;
        }
        
        .podpilot-age-filter svg {
          width: 16px !important;
          height: 16px !important;
          flex-shrink: 0 !important;
        }
        
        .podpilot-age-filter .podpilot-age-sort-label {
          font-weight: 500 !important;
          color: inherit !important;
        }
        
        .podpilot-age-filter * {
          box-sizing: border-box !important;
        }
      `;
      document.head.appendChild(styleEl);

      let aBtn = t.querySelector(".m-search__sort-btn");
      let rDropdown = t.querySelector(".podpilot-age-dropdown");
      let nLabel = t.querySelector(".podpilot-age-sort-label");
      let sOptions = t.querySelectorAll(".podpilot-age-option");

      aBtn?.addEventListener("click", e => {
        try {
          if (e.preventDefault(), e.stopPropagation(), rDropdown) {
            let e = aBtn.getBoundingClientRect();
            let t = e.bottom;
            let o = e.left;
            document.documentElement.style.setProperty("--button-bottom", `${t}px`);
            document.documentElement.style.setProperty("--button-left", `${o}px`);
            rDropdown.classList.toggle("hidden");
          }
        } catch (_) {}
      });

      document.addEventListener("click", e => {
        try {
          if (t && !t.contains(e.target)) {
            rDropdown?.classList.add("hidden");
          }
        } catch (_) {}
      });

      sOptions.forEach(e => {
        e.addEventListener("click", t => {
          try {
            t.preventDefault();
            t.stopPropagation();
            let o = e.getAttribute("data-sort");
            f = o;
            sOptions.forEach(e => e.classList.remove("active"));
            e.classList.add("active");
            let aVal = e.querySelector(".link__content")?.textContent || "Default";
            if (nLabel) nLabel.textContent = aVal;
            rDropdown?.classList.add("hidden");
            v(o);
          } catch (_) {}
        });
      });
    } catch (_) {}
  }

  function v(e) {
    try {
      let t;
      let o = Array.from(document.querySelectorAll(".tp-design-tile"));
      let a = o.filter(e => !e.closest(".m-recently-viewed-designs__contain") && !e.closest(".jsRecentlyViewedDesigns"));
      if (0 === a.length) return;
      let r = a[0].parentElement;
      let n = [
        document.querySelector(".jsTilesDesigns"),
        document.querySelector(".cards__designs-redesign"),
        document.querySelector(".m-search__browse-results"),
        document.querySelector('[class*="jsTilesDesigns"]'),
        document.querySelector('[class*="cards__designs"]'),
        a[0].parentElement,
        a[0].parentElement?.parentElement
      ].filter(Boolean);
      for (let e of n) {
        if (e && e.querySelectorAll(".tp-design-tile").length === a.length) {
          r = e;
          break;
        }
      }
      if (!r) return;
      if (0 === b.length) {
        b = Array.from(a);
      }
      if ("oldest" === e) {
        let e = a.map(e => {
          try {
            let t = d(e);
            return { element: e, timestamp: t || 0 };
          } catch (_) {
            return { element: e, timestamp: 0 };
          }
        });
        e.sort((e, t) => e.timestamp - t.timestamp);
        t = e.map(e => e.element);
      } else if ("newest" === e) {
        let e = a.map(e => {
          try {
            let t = d(e);
            return { element: e, timestamp: t || 0 };
          } catch (_) {
            return { element: e, timestamp: 0 };
          }
        });
        e.sort((e, t) => t.timestamp - e.timestamp);
        t = e.map(e => e.element);
      } else {
        t = [...b];
      }
      let s = document.createDocumentFragment();
      t.forEach(e => {
        try {
          if (e.parentNode) e.parentNode.removeChild(e);
          s.appendChild(e);
        } catch (_) {}
      });
      let i = window.scrollY || window.pageYOffset;
      let l = r.querySelectorAll(".tp-design-tile");
      l.forEach(e => {
        try {
          e.remove();
        } catch (_) {}
      });
      t.forEach((e) => {
        try {
          r.appendChild(e);
        } catch (_) {}
      });
      requestAnimationFrame(() => {
        window.scrollTo(0, i);
      });
    } catch (_) {}
  }

  function S() {
    try {
      let e;
      if (h()) {
        let e = document.querySelector(".podpilot-custom-toolbar");
        if (e) e.remove();
      }
      m();
      g();
      let t = new MutationObserver(e => {
        try {
          e.forEach(e => {
            if ("childList" === e.type) {
              e.addedNodes.forEach(e => {
                try {
                  if (e.nodeType === Node.ELEMENT_NODE) {
                    if (e.classList?.contains("tp-design-tile")) {
                      setTimeout(() => { try { m(); } catch (_) {} }, 100);
                    }
                    if (e.querySelector && e.querySelector(".tp-design-tile")) {
                      setTimeout(() => { try { m(); } catch (_) {} }, 100);
                    }
                    if (e.classList?.contains("jsProductMainImage") || (e.querySelector && e.querySelector(".jsProductMainImage"))) {
                      setTimeout(() => { try { g(); } catch (_) {} }, 100);
                    }
                    if (e.classList?.contains("m-search__sort-and-filter-options") || (e.querySelector && e.querySelector(".m-search__sort-and-filter-options"))) {
                      setTimeout(() => { try { y(); } catch (_) {} }, 100);
                    }
                  }
                } catch (_) {}
              });
            }
          });
        } catch (_) {}
      });
      t.observe(document.body, { childList: true, subtree: true });

      let o = false;
      let a = 0;
      window.addEventListener("scroll", () => {
        try {
          if (o) return;
          clearTimeout(e);
          e = setTimeout(() => {
            try {
              o = true;
              m();
              g();
              y();
              if ("none" !== f) {
                let e = document.querySelectorAll(".tp-design-tile").length;
                if (e > a) {
                  a = e;
                  v(f);
                }
              }
              o = false;
            } catch (_) {
              o = false;
            }
          }, 800);
        } catch (_) {}
      }, { passive: true });

      y();

      let r = window.location.href;
      let n = new MutationObserver(() => {
        let e = window.location.href;
        if (e !== r) {
          r = e;
          if (h()) {
            let e = document.querySelector(".podpilot-custom-toolbar");
            if (e) e.remove();
          } else {
            setTimeout(() => { try { y(); } catch (_) {} }, 500);
          }
        }
      });
      n.observe(document, { subtree: true, childList: true });
    } catch (_) {}
  }

  function T() {
    if (document.getElementById("podpilot-listing-styles")) return;
    let e = document.createElement("style");
    e.id = "podpilot-listing-styles";
    e.textContent = `
      .podpilot-publish-date {
        position: absolute;
        top: 8px;
        left: 8px;
        background: #EDE9FE;
        color: #4C1D95;
        padding: 5px 10px;
        border-radius: 6px;
        font-size: 10px;
        font-weight: 600;
        z-index: 9;
        pointer-events: none;
        border: 1px solid #8B5CF6;
        white-space: nowrap;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        text-align: center;
        letter-spacing: 0.5px;
        line-height: 1.3;
        box-shadow: 0 2px 8px rgba(139, 92, 246, 0.4);
        will-change: auto;
      }

      .podpilot-listing-buttons-container {
        position: absolute !important;
        top: 88px !important;
        right: 6px !important;
        display: flex !important;
        flex-direction: column !important;
        gap: 6px !important;
        z-index: 5 !important;
        pointer-events: auto !important;
      }
      
      .podpilot-circular-btn {
        width: 32px !important;
        height: 32px !important;
        border-radius: 50% !important;
        border: none !important;
        background: #fff !important;
        box-shadow: 0 2px 6px rgba(0,0,0,0.12) !important;
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
        cursor: pointer !important;
        transition: all 0.2s ease !important;
        position: relative !important;
        pointer-events: auto !important;
      }
      
      .podpilot-circular-btn:hover {
        transform: scale(1.1);
        box-shadow: 0 4px 12px rgba(0,0,0,0.2);
      }
      
      .podpilot-circular-btn:active {
        transform: scale(0.95);
      }
      
      .podpilot-copy-tags-btn {
        background: linear-gradient(135deg, #a78bfa 0%, #7c3aed 100%) !important;
      }
      
      .podpilot-copy-tags-btn:hover {
        background: linear-gradient(135deg, #7c3aed 0%, #6d28d9 100%) !important;
      }
      
      .podpilot-copy-tags-btn.copied {
        background: linear-gradient(135deg, #10b981 0%, #059669 100%) !important;
      }
      
      .podpilot-btn-icon {
        font-size: 14px;
        filter: drop-shadow(0 1px 2px rgba(0,0,0,0.2));
      }
      
      .podpilot-circular-btn::after {
        content: attr(data-tooltip);
        position: absolute;
        right: 38px;
        top: 50%;
        transform: translateY(-50%);
        background: rgba(0, 0, 0, 0.9);
        color: white;
        padding: 4px 8px;
        border-radius: 4px;
        font-size: 11px;
        white-space: nowrap;
        opacity: 0;
        pointer-events: none;
        transition: opacity 0.2s ease;
        font-weight: 500;
      }
      
      .podpilot-circular-btn:hover::after {
        opacity: 1;
      }
    `;
    document.head.appendChild(e);

    // Dynamic processing for copy-tags buttons on listing cards
    let tiles = document.querySelectorAll(".tp-design-tile.jsDesignContainer");
    tiles.forEach(tile => {
      if (tile.hasAttribute("data-listing-processed")) return;
      if (tile.closest(".m-also-available-products") || tile.closest(".m-recently-viewed-designs__contain") || tile.closest(".jsRecentlyViewedDesigns")) {
        tile.setAttribute("data-listing-processed", "true");
        return;
      }
      tile.setAttribute("data-listing-processed", "true");
      let dUrl = tile.dataset.url || tile.querySelector('a[href*="/t-shirt/"]')?.getAttribute("href");
      let fullUrl = dUrl ? new URL(dUrl, window.location.origin).href : null;
      if (!fullUrl || !fullUrl.includes("/t-shirt/")) return;

      let wrap = tile.querySelector(".tp-design-tile__image-wrap");
      if (!wrap) return;

      if (!wrap.style.position || wrap.style.position === "static") {
        wrap.style.position = "relative";
      }
      if (!wrap.style.overflow) {
        wrap.style.overflow = "visible";
      }

      let btnContainer = document.createElement("div");
      btnContainer.className = "podpilot-listing-buttons-container";

      let copyBtn = document.createElement("button");
      copyBtn.className = "podpilot-circular-btn podpilot-copy-tags-btn";
      copyBtn.setAttribute("data-tooltip", "Copy Tags");
      copyBtn.innerHTML = '<span class="podpilot-btn-icon">📋</span>';

      copyBtn.addEventListener("click", async event => {
        event.preventDefault();
        event.stopPropagation();
        copyBtn.disabled = true;
        copyBtn.classList.add("loading");
        let origHtml = copyBtn.innerHTML;
        copyBtn.innerHTML = '<span class="podpilot-btn-icon">⏳</span>';
        
        let tagsFetched = await P(fullUrl);
        if (tagsFetched.length > 0 && await k(tagsFetched)) {
          copyBtn.innerHTML = '<span class="podpilot-btn-icon">✓</span>';
          copyBtn.classList.remove("loading");
          copyBtn.classList.add("copied");
          setTimeout(() => {
            copyBtn.innerHTML = origHtml;
            copyBtn.classList.remove("copied");
            copyBtn.disabled = false;
          }, 1500);
        } else {
          copyBtn.innerHTML = '<span class="podpilot-btn-icon">✗</span>';
          copyBtn.classList.remove("loading");
          setTimeout(() => {
            copyBtn.innerHTML = origHtml;
            copyBtn.disabled = false;
          }, 1500);
        }
      });

      btnContainer.appendChild(copyBtn);
      wrap.appendChild(btnContainer);
    });
  }

  function C() {
    let e = 0;
    let t = null;
    let observer = new MutationObserver(mutations => {
      let added = false;
      for (let mut of mutations) {
        if (mut.addedNodes.length > 0) {
          for (let node of mut.addedNodes) {
            if (1 === node.nodeType && (node.classList?.contains("tp-design-tile") || node.querySelector?.(".tp-design-tile"))) {
              added = true;
              break;
            }
          }
        }
        if (added) break;
      }
      if (added) {
        if (t) clearTimeout(t);
        t = setTimeout(() => {
          let currentCount = document.querySelectorAll(".tp-design-tile").length;
          if (currentCount !== e) {
            e = currentCount;
            let o = window.scrollY || window.pageYOffset;
            T();
            requestAnimationFrame(() => {
              window.scrollTo(0, o);
            });
          }
        }, 150);
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });
    e = document.querySelectorAll(".tp-design-tile").length;
    T();
  }

  // DOM Bootstrapper
  T();
  if ("loading" === document.readyState) {
    document.addEventListener("DOMContentLoaded", () => {
      S();
      C();
      reportFinalSuccessIfNeeded();
    });
  } else {
    S();
    C();
    reportFinalSuccessIfNeeded();
  }

})();
