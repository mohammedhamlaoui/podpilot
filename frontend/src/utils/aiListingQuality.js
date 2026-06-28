const GENERIC_AI_LISTING_PHRASES = [
  "print-on-demand design featuring",
  "print on demand design featuring",
  "this design features",
  "a design with",
  "graphic design",
  "artwork",
  "uploaded artwork",
  "seller artwork",
  "clean design",
  "unique design",
  "beautiful design",
  "perfect for everyone",
];

const GENERIC_WORDS = new Set([
  "a", "an", "and", "art", "artwork", "beautiful", "clean", "cool", "design",
  "featuring", "for", "graphic", "image", "illustration", "in", "of", "on",
  "perfect", "print", "the", "this", "unique", "with",
]);

function meaningfulWords(text = "") {
  return String(text)
    .toLowerCase()
    .match(/[a-z][a-z']{2,}/g)
    ?.filter((word) => !GENERIC_WORDS.has(word)) || [];
}

export function validateAiListingQuality(listing = {}, currentMetadata = {}) {
  const title = String(listing.title || "").trim();
  const description = String(listing.description || "").trim();
  const mainTag = String(listing.main_tag || listing.primary_tag || "").trim();
  const supportingTags = String(listing.supporting_tags || listing.tags || "").trim();
  const combined = `${title} ${description} ${mainTag} ${supportingTags}`.toLowerCase();

  const badPhrase = GENERIC_AI_LISTING_PHRASES.find((phrase) => combined.includes(phrase));
  if (badPhrase) throw new Error(`AI listing was too generic: ${badPhrase}.`);
  if (title.length < 8 || title.length > 70) throw new Error("AI listing title failed quality checks.");
  if (description.length < 25 || description.length > 180) throw new Error("AI listing description failed quality checks.");
  if (!mainTag) throw new Error("AI listing primary tag is missing.");
  if (supportingTags.split(/,|;/).map((tag) => tag.trim()).filter(Boolean).length < 5) {
    throw new Error("AI listing returned too few specific tags.");
  }
  if (String(currentMetadata.title || "").trim().toLowerCase() === title.toLowerCase()) {
    throw new Error("AI listing copied the existing title.");
  }
  if (String(currentMetadata.description || "").trim().toLowerCase() === description.toLowerCase()) {
    throw new Error("AI listing copied the existing description.");
  }
  if (meaningfulWords(`${title} ${description}`).length === 0) {
    throw new Error("AI listing lacks a concrete visible subject.");
  }
  return true;
}
