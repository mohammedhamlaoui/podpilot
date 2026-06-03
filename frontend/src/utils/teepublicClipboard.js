/**
 * TeePublic Copy/Paste clipboard utility.
 *
 * Stores copied config in localStorage so it survives page refresh.
 * Key: podpilot_teepublic_clipboard
 *
 * Clipboard shape:
 * {
 *   type: "all" | "colors" | "products" | "adult_content",
 *   marketplace: "teepublic",
 *   data: {
 *     color_settings?: {},      // canonical keys only
 *     product_settings?: {},    // canonical keys only
 *     adult_content?: boolean
 *   }
 * }
 */

import { canonicalizeSettings } from "../config/teepublicOptions";

const STORAGE_KEY = "podpilot_teepublic_clipboard";

function _persist(clip) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(clip));
  } catch (err) {
    console.warn("[PodPilot] clipboard persist failed:", err?.message || err);
  }
  return clip;
}

export function copyAllConfig(design) {
  return _persist({
    type: "all",
    marketplace: "teepublic",
    data: {
      color_settings: canonicalizeSettings(design.color_settings),
      product_settings: canonicalizeSettings(design.product_settings),
      adult_content: Boolean(design.adult_content),
    },
  });
}

export function copyColorsOnly(design) {
  return _persist({
    type: "colors",
    marketplace: "teepublic",
    data: {
      color_settings: canonicalizeSettings(design.color_settings),
    },
  });
}

export function copyProductsOnly(design) {
  return _persist({
    type: "products",
    marketplace: "teepublic",
    data: {
      product_settings: canonicalizeSettings(design.product_settings),
    },
  });
}

export function copyAdultContentOnly(design) {
  return _persist({
    type: "adult_content",
    marketplace: "teepublic",
    data: {
      adult_content: Boolean(design.adult_content),
    },
  });
}

export function getClipboard() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const clip = JSON.parse(raw);
    if (!clip || clip.marketplace !== "teepublic") return null;
    return clip;
  } catch {
    return null;
  }
}

export function hasClipboard() {
  return getClipboard() !== null;
}

/**
 * Apply clipboard data to a single design object (returns a new object).
 */
export function applyClipboardToDesign(design, clipboard) {
  if (!clipboard || clipboard.marketplace !== "teepublic") return design;
  const patch = {};
  const data = clipboard.data || {};

  if (data.color_settings !== undefined) {
    patch.color_settings = canonicalizeSettings(data.color_settings);
  }
  if (data.product_settings !== undefined) {
    patch.product_settings = canonicalizeSettings(data.product_settings);
  }
  if (data.adult_content !== undefined) {
    patch.adult_content = data.adult_content;
  }

  return { ...design, ...patch };
}

/**
 * Get the label for what was copied.
 */
export function getClipboardLabel(clipboard) {
  if (!clipboard) return "";
  switch (clipboard.type) {
    case "all": return "All Config";
    case "colors": return "Colors";
    case "products": return "Products";
    case "adult_content": return "Adult Content";
    default: return "Config";
  }
}
