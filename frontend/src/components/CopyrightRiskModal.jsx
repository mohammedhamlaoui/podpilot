import { createPortal } from "react-dom";
import Icon from "./Icon";
import { ProgressLoader } from "./LoadingComponents";

const LABELS = {
  SAFE: "SAFE",
  NOT_SAFE: "NOT SAFE",
  NEEDS_REVIEW: "NEEDS REVIEW",
};

export default function CopyrightRiskModal({ open, loading, error, result, onClose }) {
  if (!open) return null;

  const normalized = result?.result || "";
  const label = LABELS[normalized] || "NEEDS REVIEW";
  const tone = normalized === "SAFE" ? "safe" : normalized === "NOT_SAFE" ? "not-safe" : "review";
  const riskyTerms = Array.isArray(result?.risky_terms) ? result.risky_terms : [];
  const categories = Array.isArray(result?.matched_categories) ? result.matched_categories : [];
  const tokens = result?.tokens_remaining || null;

  return createPortal(
    <div className="pp-modal-overlay ai-risk-overlay" onClick={loading ? undefined : onClose}>
      <div className="pp-modal ai-risk-modal" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true">
        <button type="button" className="pp-modal-close" onClick={onClose} disabled={loading} aria-label="Close">
          <Icon name="x" />
        </button>

        {loading ? (
          <div className="ai-risk-loading">
            <ProgressLoader
              title="Checking design risk..."
              subtitle="AI risk check is informational only. Review carefully before publishing."
              steps={["Reading listing text", "Checking similarity signals", "Reviewing risk terms", "Preparing report"]}
            />
          </div>
        ) : error ? (
          <div className="ai-risk-error" role="alert">
            <span className="ai-risk-icon ai-risk-icon-review"><Icon name="help" /></span>
            <div>
              <h3>AI Risk Check</h3>
              <p>{error}</p>
              <small>AI risk check is informational only. Review carefully before publishing.</small>
            </div>
          </div>
        ) : (
          <>
            <div className="ai-risk-head">
              <span className={`ai-risk-icon ai-risk-icon-${tone}`}><Icon name={tone === "safe" ? "check" : "help"} /></span>
              <div>
                <h3>AI Copyright Risk Check</h3>
                <p>AI risk check is informational only. Review carefully before publishing.</p>
              </div>
            </div>

            <div className={`ai-risk-result ai-risk-result-${tone}`}>
              <span>{label}</span>
              {typeof result?.score === "number" && <strong>{result.score}/100</strong>}
            </div>

            <div className="ai-risk-section">
              <span>Reason</span>
              <p>{result?.reason || "No reason returned."}</p>
            </div>

            <div className="ai-risk-grid">
              <div className="ai-risk-section">
                <span>Risky terms</span>
                {riskyTerms.length > 0 ? (
                  <div className="ai-risk-chips">
                    {riskyTerms.map((term) => <b key={term}>{term}</b>)}
                  </div>
                ) : (
                  <p>None found.</p>
                )}
              </div>
              <div className="ai-risk-section">
                <span>Matched categories</span>
                {categories.length > 0 ? (
                  <div className="ai-risk-chips ai-risk-chips-muted">
                    {categories.map((category) => <b key={category}>{category}</b>)}
                  </div>
                ) : (
                  <p>None found.</p>
                )}
              </div>
            </div>

            <div className="ai-risk-section ai-risk-recommendation">
              <span>Recommended action</span>
              <p>{result?.recommendation || "Review official sources before publishing."}</p>
            </div>

            {tokens && (
              <div className="ai-risk-token-row">
                <span>AI tokens remaining</span>
                <strong>{tokens.daily_remaining ?? 0} daily</strong>
                <strong>{tokens.extra_tokens ?? 0} extra</strong>
              </div>
            )}
          </>
        )}

        {!loading && (
          <div className="pp-modal-actions ai-risk-actions">
            <button type="button" className="primary-button" onClick={onClose}>
              Close
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
