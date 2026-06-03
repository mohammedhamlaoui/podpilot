/**
 * Hex color map for TeePublic color swatches.
 * Used by the custom ColorDropdown component to render circular swatches.
 */
export const TEEPUBLIC_COLOR_HEX = {
  "White": "#FFFFFF",
  "Off White": "#FAF9F6",
  "Heather": "#B8B8B8",
  "Black": "#1A1A1A",
  "Charcoal Heather": "#4A4A4A",
  "Navy": "#1B2A4A",
  "Light Blue": "#A4C8E1",
  "Royal Blue": "#2E5FA1",
  "Slate": "#6B7B8D",
  "Kelly": "#2E8B57",
  "Forest Green": "#2D5A27",
  "Military Green": "#4B5320",
  "Sage": "#9CAF88",
  "Pistachio": "#93C572",
  "Teal": "#008080",
  "Maroon": "#5C1A1A",
  "Red": "#CC2222",
  "Soft Pink": "#F4C2C2",
  "Hot Pink": "#FF69B4",
  "Azalea": "#F19CBB",
  "Brown": "#5C3A21",
  "Orange": "#E86100",
  "Yellow": "#F5C518",
  "Creme": "#FFFDD0",
  "Latte": "#C8A882",
  "Purple": "#6B3FA0",
  "Paragon": "#7B68AE",
  "Red Heather": "#A04040",
  "Asphalt": "#505050",
  "Navy Heather": "#3D4F6A",
  "Royal Heather": "#5B7BAE",
  "Tie Dye": "linear-gradient(135deg, #FF6B6B, #4ECDC4, #45B7D1, #96E6A1)",
  "Oatmeal Heather": "#D4C9B0",
  "Sport Green": "#3AA655",
  "Burgundy": "#6B1C2A",
  "Colony Blue": "#6B8BA4",
  "Vintage Heather": "#9E9E9E",
  "Ghost": "#F0F0F0",
  "Indigo Blue": "#3F51B5",
  "Dark Green": "#1B4D1B",
  "Garnet": "#6C2E3A",
  "Black/White": "linear-gradient(90deg, #1A1A1A 50%, #FFFFFF 50%)",
  "White/Black": "linear-gradient(90deg, #FFFFFF 50%, #1A1A1A 50%)",
  "White/Royal": "linear-gradient(90deg, #FFFFFF 50%, #2E5FA1 50%)",
  "White/Red": "linear-gradient(90deg, #FFFFFF 50%, #CC2222 50%)",
  "White/Kelly": "linear-gradient(90deg, #FFFFFF 50%, #2E8B57 50%)",
  "White/Navy": "linear-gradient(90deg, #FFFFFF 50%, #1B2A4A 50%)",
  "Dark Grey": "#3D3D3D",
  "Coastal Blue": "#5B8FA8",
  "Moss": "#6B7F4A",
  "Basil": "#4A7A4A",
  "Butter": "#F5E6A3",
  "Blush": "#F2D4D7",
  "Lavender": "#B4A7D6",
  "Sunset Stripe": "linear-gradient(180deg, #FF6B35, #F7C948, #FF6B35)",
  "Natural Heather": "#C8BFA8",
  "Mauvelous": "#EF98AA",
  "Vintage Royal": "#4A6FA5",
  "Deep Royal": "#1A3A7A",
  "Oxford": "#4A4A5A",
  "Light Grey": "#C8C8C8",
  "Chestnut": "#7B4B2A",
  "White/Red": "linear-gradient(90deg, #FFFFFF 50%, #CC2222 50%)",
  "White/Navy": "linear-gradient(90deg, #FFFFFF 50%, #1B2A4A 50%)",
};

/**
 * Get the hex/gradient for a color name. Falls back to a neutral gray.
 */
export function getColorHex(colorName) {
  return TEEPUBLIC_COLOR_HEX[colorName] || "#999999";
}

/**
 * Classify colors as light or dark for the Color Preference filter.
 */
const LIGHT_COLORS = new Set([
  "White", "Off White", "Heather", "Light Blue", "Sage", "Pistachio",
  "Soft Pink", "Azalea", "Yellow", "Creme", "Latte", "Oatmeal Heather",
  "Ghost", "Butter", "Blush", "Lavender", "Natural Heather", "Light Grey",
  "Vintage Heather", "Mauvelous",
]);

const DARK_COLORS = new Set([
  "Black", "Charcoal Heather", "Navy", "Slate", "Forest Green", "Military Green",
  "Maroon", "Brown", "Asphalt", "Navy Heather", "Dark Grey", "Dark Green",
  "Garnet", "Burgundy", "Deep Royal", "Indigo Blue", "Oxford", "Chestnut",
]);

export function getColorCategory(colorName) {
  if (LIGHT_COLORS.has(colorName)) return "light";
  if (DARK_COLORS.has(colorName)) return "dark";
  return "medium"; // shown in both light and dark, always in "all"
}
