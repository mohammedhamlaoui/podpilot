export const AI_TOKENS_EXHAUSTED_CODE = "AI_TOKENS_EXHAUSTED";
export const AI_CREDITS_REQUIRED_MESSAGE =
  "You're out of AI tokens. Buy more AI credits to keep generating listings.";
export const AI_CREDITS_REQUIRED_SECONDARY =
  "Plans start at 250 AI credits for $1.99.";

export function getAiCreditsCheckoutUrl({ credits = 250 } = {}) {
  return `/checkout?plan=ai-credits&credits=${encodeURIComponent(String(credits))}`;
}

export function getApiErrorDetail(error) {
  return error?.response?.data?.detail ?? error?.response?.data ?? null;
}

export function getApiErrorMessage(error, fallback = "AI generation failed.") {
  const detail = getApiErrorDetail(error);
  if (typeof detail === "string") return detail;
  if (detail?.message) return detail.message;
  if (error?.message) return error.message;
  return fallback;
}

export function isAiCreditsError(error) {
  const status = Number(error?.response?.status || error?.status || 0);
  const detail = getApiErrorDetail(error);
  const code = String(detail?.code || error?.code || error?.response?.data?.code || "").toUpperCase();
  const message = String(
    typeof detail === "string"
      ? detail
      : detail?.message || error?.message || "",
  ).toLowerCase();

  return (
    status === 402
    || code === AI_TOKENS_EXHAUSTED_CODE
    || (
      message.includes("ai token")
      && (
        message.includes("exhausted")
        || message.includes("remaining")
        || message.includes("allowance")
        || message.includes("purchased")
      )
    )
  );
}
