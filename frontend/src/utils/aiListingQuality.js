export function validateAiListingQuality(listing = {}, currentMetadata = {}) {
  const title = String(listing.title || "").trim();
  const description = String(listing.description || "").trim();
  const mainTag = String(listing.main_tag || listing.primary_tag || "").trim();
  const supportingTags = String(listing.supporting_tags || listing.tags || "").trim();

  void currentMetadata;
  if (!title) throw new Error("AI listing title is missing.");
  if (!description) throw new Error("AI listing description is missing.");
  if (!mainTag) throw new Error("AI listing primary tag is missing.");
  if (!supportingTags) throw new Error("AI listing supporting tags are missing.");
  return true;
}
