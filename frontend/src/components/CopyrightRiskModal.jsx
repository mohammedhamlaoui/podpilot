import { useEffect } from "react";
import { createPortal } from "react-dom";
import Icon from "./Icon";

const LABELS = {
  SAFE: "SAFE",
  NOT_SAFE: "RISKY",
  NEEDS_REVIEW: "REVIEW",
};

function resultTone(normalized) {
  if (normalized === "SAFE") return "safe";
  if (normalized === "NOT_SAFE") return "not-safe";
  return "review";
}

export default function CopyrightRiskModal({ open, loading, error, result, onClose }) {
  const normalized = result?.result || "";
  const label = LABELS[normalized] || "REVIEW";
  const tone = resultTone(normalized);
  const riskyTerms = Array.isArray(result?.risky_terms) ? result.risky_terms : [];
  const visibleTerms = riskyTerms.slice(0, 5);
  const hiddenTermCount = Math.max(0, riskyTerms.length - visibleTerms.length);
  const tokens = result?.tokens_remaining || null;

  useEffect(() => {
    if (!open || loading || error || normalized !== "SAFE") return undefined;
    const timer = window.setTimeout(() => {
      onClose?.();
    }, 4500);
    return () => window.clearTimeout(timer);
  }, [open, loading, error, normalized, onClose]);

  if (!open) return null;

  return createPortal(
    <div className={`ai-risk-card ai-risk-card-${tone}`} role="status" aria-live="polite">
      <button type="button" className="ai-risk-card-close" onClick={onClose} disabled={loading} aria-label="Close">
        <Icon name="x" />
      </button>

      {loading ? (
        <>
          <div className="ai-risk-card-head">
            <span className="ai-risk-card-icon"><span className="pp-spinner pp-spinner-sm" /></span>
            <div>
              <strong>Checking...</strong>
              <span>Reviewing listing risk</span>
            </div>
          </div>
          <p className="ai-risk-card-reason">AI risk check is informational only.</p>
        </>
      ) : error ? (
        <>
          <div className="ai-risk-card-head">
            <span className="ai-risk-card-icon"><Icon name="help" /></span>
            <div>
              <strong>REVIEW</strong>
              <span>AI Check failed</span>
            </div>
          </div>
          <p className="ai-risk-card-reason">{error}</p>
        </>
      ) : (
        <>
          <div className="ai-risk-card-head">
            <span className="ai-risk-card-icon"><Icon name={tone === "safe" ? "check" : "help"} /></span>
            <div>
              <strong>{label}</strong>
              <span>{typeof result?.score === "number" ? `${result.score}/100` : "Score unavailable"}</span>
            </div>
          </div>

          <p className="ai-risk-card-reason">{result?.reason || "No reason returned."}</p>

          {riskyTerms.length > 0 && (
            <details className="ai-risk-card-terms" open={tone === "not-safe"}>
              <summary>Risky terms</summary>
              <div>
                {visibleTerms.map((term) => <b key={term}>{term}</b>)}
                {hiddenTermCount > 0 && <b>+{hiddenTermCount}</b>}
              </div>
            </details>
          )}

          {tokens && (
            <div className="ai-risk-card-tokens">
              <span>{tokens.daily_remaining ?? 0} daily</span>
              <span>{tokens.extra_tokens ?? 0} extra</span>
            </div>
          )}
        </>
      )}
    </div>,
    document.body
  );
}
