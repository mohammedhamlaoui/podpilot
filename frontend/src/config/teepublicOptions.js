/**
 * TeePublic product and color configuration.
 *
 * Single source of truth for all TeePublic product keys, display names,
 * available colors per product, and default selected colors.
 *
 * The keys here are CANONICAL — same on the website, same in
 * color_settings/product_settings JSON, same in the Chrome extension.
 * Backend and extension also normalize incoming keys (lowercase, strip
 * underscores/hyphens, plural/singular) so a few legacy variants
 * (bag/bags, hat/hats, wall_art/wallArt) still match, but the UI itself
 * only ever writes the canonical form below.
 */

export const TEEPUBLIC_PRODUCTS = {
  tshirt: "T-Shirt",
  hoodie: "Hoodie",
  tank: "Tank",
  crewneck: "Crewneck",
  longsleevetshirt: "Long Sleeve T-Shirt",
  baseballtee: "Baseball Tee",
  kids: "Kids",
  kidshoodie: "Kids Hoodie",
  kidslongsleevetshirt: "Kids Long Sleeve T-Shirt",
  shorts: "Shorts",
  bags: "Bags",
  hats: "Hats",
  stickers: "Stickers",
  cases: "Cases",
  mugs: "Mugs",
  wallArt: "Wall Art",
  pillows: "Pillows",
  totes: "Totes",
  tapestries: "Tapestries",
  pins: "Pins",
  magnets: "Magnets",
};

/**
 * Colors available per product. Products not listed here (stickers, cases,
 * mugs, wallArt, pillows, totes, tapestries, pins, magnets) are toggle-only
 * and have no color dropdown.
 */
export const TEEPUBLIC_COLORS = {
  tshirt: [
    "White", "Heather", "Black", "Charcoal Heather", "Navy", "Light Blue",
    "Royal Blue", "Slate", "Kelly", "Forest Green", "Military Green", "Sage",
    "Pistachio", "Teal", "Maroon", "Red", "Soft Pink", "Hot Pink", "Azalea",
    "Brown", "Orange", "Yellow", "Creme", "Latte", "Purple", "Paragon",
    "Red Heather", "Asphalt", "Navy Heather", "Royal Heather", "Tie Dye",
  ],
  hoodie: [
    "Oatmeal Heather", "Sport Green", "Black", "Burgundy", "Creme", "Navy",
    "Colony Blue", "Vintage Heather", "Charcoal Heather",
  ],
  tank: ["White", "Black", "Red", "Navy"],
  crewneck: [
    "White", "Heather", "Black", "Charcoal Heather", "Navy", "Royal Blue",
    "Sport Green", "Chestnut", "Creme",
  ],
  longsleevetshirt: [
    "White", "Heather", "Black", "Navy", "Ghost", "Light Blue", "Royal Blue",
    "Indigo Blue", "Dark Green", "Garnet",
  ],
  baseballtee: [
    "Black/White", "White/Black", "White/Royal", "White/Red", "White/Kelly",
    "White/Navy",
  ],
  kids: [
    "White", "Off White", "Heather", "Dark Grey", "Black", "Navy", "Light Blue",
    "Coastal Blue", "Royal Blue", "Slate", "Forest Green", "Moss", "Basil",
    "Red", "Soft Pink", "Orange", "Butter", "Blush", "Creme", "Lavender",
    "Asphalt", "Sunset Stripe",
  ],
  kidshoodie: [
    "Natural Heather", "Black", "Navy", "Kelly", "Mauvelous", "Red Heather",
    "Vintage Royal",
  ],
  kidslongsleevetshirt: ["Black", "Navy", "Deep Royal"],
  shorts: ["Heather", "Black", "Military Green", "Creme"],
  bags: ["Oxford", "Black", "Navy", "Light Grey"],
  hats: [
    "Black", "Navy", "Deep Royal", "Red", "Creme", "White/Black", "White/Royal",
    "White/Red", "White/Navy",
  ],
};

/**
 * Default selected color per product. Used when a design has no saved
 * color_settings yet.
 */
export const TEEPUBLIC_DEFAULT_COLORS = {
  tshirt: "Asphalt",
  hoodie: "Navy",
  tank: "Black",
  crewneck: "Charcoal Heather",
  longsleevetshirt: "Navy",
  baseballtee: "White/Navy",
  kids: "Navy",
  kidshoodie: "Navy",
  kidslongsleevetshirt: "Deep Royal",
  bags: "Navy",
  hats: "Black",
  shorts: "Black",
};

/**
 * Products that have NO color dropdown — they are simple on/off toggles.
 */
export const TEEPUBLIC_TOGGLE_ONLY_PRODUCTS = [
  "stickers",
  "cases",
  "mugs",
  "wallArt",
  "pillows",
  "totes",
  "tapestries",
  "pins",
  "magnets",
];

/**
 * Products that have a color dropdown.
 */
export const TEEPUBLIC_COLOR_PRODUCTS = Object.keys(TEEPUBLIC_COLORS);

/**
 * All product keys in display order.
 */
export const TEEPUBLIC_ALL_PRODUCT_KEYS = Object.keys(TEEPUBLIC_PRODUCTS);

/**
 * Build default product_settings (all products enabled by default).
 */
export function getDefaultProductSettings() {
  const settings = {};
  TEEPUBLIC_ALL_PRODUCT_KEYS.forEach((key) => {
    settings[key] = true;
  });
  return settings;
}

/**
 * Build default color_settings from TEEPUBLIC_DEFAULT_COLORS.
 */
export function getDefaultColorSettings() {
  return { ...TEEPUBLIC_DEFAULT_COLORS };
}

/**
 * Normalize a key from any source to the canonical form used in this file.
 * Strips underscores/hyphens/spaces, lowercases, then maps a handful of
 * known aliases (bag→bags, hat→hats, wallart→wallArt etc.) to canonical.
 */
const KEY_ALIASES = {
  // singular → plural
  bag: "bags",
  hat: "hats",
  case: "cases",
  mug: "mugs",
  pillow: "pillows",
  tote: "totes",
  tapestry: "tapestries",
  pin: "pins",
  magnet: "magnets",
  sticker: "stickers",
  short: "shorts",
  sock: "socks",
  // legacy underscore / hyphen forms (already stripped by the time we get
  // here, but kept for clarity)
  wallart: "wallArt",
  wall_art: "wallArt",
  longsleeve: "longsleevetshirt",
  kidslongsleeve: "kidslongsleevetshirt",
  tshirt: "tshirt",
  longsleevetshirt: "longsleevetshirt",
  kidslongsleevetshirt: "kidslongsleevetshirt",
};

function _stripKey(k) {
  return String(k || "").toLowerCase().replace(/[_\-\s]/g, "");
}

export function canonicalProductKey(rawKey) {
  if (!rawKey) return "";
  const stripped = _stripKey(rawKey);
  if (TEEPUBLIC_PRODUCTS[stripped]) return stripped;
  if (KEY_ALIASES[stripped]) return KEY_ALIASES[stripped];
  // also try the raw key itself in case it's already canonical (e.g. "wallArt")
  if (TEEPUBLIC_PRODUCTS[rawKey]) return rawKey;
  return stripped;
}

/**
 * Rewrite a product_settings or color_settings object so all keys are in
 * canonical form. Preserves values exactly. Use this on every load and
 * before every save so the database never accumulates mixed key formats.
 */
export function canonicalizeSettings(settings) {
  if (!settings || typeof settings !== "object") return {};
  const out = {};
  for (const [k, v] of Object.entries(settings)) {
    const ck = canonicalProductKey(k);
    if (!ck) continue;
    // Last write wins if a design somehow has both `bag` and `bags`.
    out[ck] = v;
  }
  return out;
}
