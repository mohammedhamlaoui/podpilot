import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Icon from "./Icon";
import { ProgressLoader } from "./LoadingComponents";

function buildUSPTOUrl(serial) {
  const cleanSerial = String(serial || "").replace(/\D/g, "");
  if (!cleanSerial) return null;
  return `https://tsdr.uspto.gov/#caseNumber=${cleanSerial}&caseSearchType=US_APPLICATION&caseType=DEFAULT&searchType=statusSearch`;
}

export default function TrademarkModal({ open, loading, error, results, phrase, onClose }) {
  const modalRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    requestAnimationFrame(() => {
      if (modalRef.current) modalRef.current.scrollTop = 0;
    });
  }, [open, phrase, loading]);

  if (!open) return null;

  const safeResults = results || [];
  const totalMatches = safeResults.reduce((acc, r) => acc + (r.matches?.length || 0), 0);
  const totalChecked = safeResults.reduce((acc, r) => acc + (r.checked_terms?.length || 0), 0);
  const allFailed = safeResults.flatMap((r) => r.failed_terms || r.errors || []);
  const totalFailed = allFailed.length;
  const isManual = safeResults.some((r) => r?.manual === true);
  const totalAttempted = totalChecked + totalFailed;
  const allChecksFailed = !isManual && totalAttempted > 0 && totalChecked === 0 && totalFailed > 0;
  const hasMatches = totalMatches > 0;
  const hasFailures = totalFailed > 0;

  return createPortal(
    <div className="pp-modal-overlay" onClick={loading ? undefined : onClose}>
      {loading ? (
        <div className="pp-loading-overlay-content" onClick={(e) => e.stopPropagation()}>
          <ProgressLoader
            title="Checking trademarks..."
            subtitle="Searching trademark records. This usually takes a few seconds."
            steps={["Collecting terms", "Searching records", "Comparing matches", "Preparing results"]}
          />
        </div>
      ) : (
        <div
          ref={modalRef}
          className="pp-modal pp-modal-tm"
          onClick={(e) => e.stopPropagation()}
          role="dialog"
          aria-modal="true"
        >
          <button className="pp-modal-close" type="button" onClick={onClose} aria-label="Close">
            <Icon name="x" />
          </button>

          {error ? (
            <FailureBlock title="Trademark check failed" message={error} failed={[]} onClose={onClose} />
          ) : isManual ? (
            <ManualBlock failed={allFailed} onClose={onClose} />
          ) : allChecksFailed ? (
            <FailureBlock
              title="Trademark check failed"
              message={`${totalFailed} term${totalFailed === 1 ? "" : "s"} could not be checked. Please try again or check USPTO manually.`}
              failed={allFailed}
              onClose={onClose}
            />
          ) : hasMatches ? (
            <MatchesBlock
              results={safeResults}
              totalMatches={totalMatches}
              totalChecked={totalChecked}
              failed={allFailed}
              phrase={phrase}
              onClose={onClose}
            />
          ) : hasFailures ? (
            <PartialBlock totalChecked={totalChecked} failed={allFailed} onClose={onClose} />
          ) : (
            <NoMatchBlock totalChecked={totalChecked} phrase={phrase} onClose={onClose} />
          )}
        </div>
      )}
    </div>,
    document.body
  );
}

function FailureBlock({ title, message, failed, onClose }) {
  return (
    <>
      <div className="pp-tm-fail-header">
        <span className="pp-tm-fail-icon" aria-hidden="true">!</span>
        <h3>{title}</h3>
      </div>
      <p className="pp-tm-error-msg">{message}</p>
      <p className="pp-tm-disclaimer">
        The checker could not contact the trademark database. Do not assume the design is clear.
        Retry the check or look up the terms manually at{" "}
        <a href="https://tmsearch.uspto.gov" target="_blank" rel="noreferrer noopener">
          tmsearch.uspto.gov
        </a>.
      </p>
      {failed.length > 0 && (
        <details className="pp-tm-errors" open>
          <summary>{failed.length} unchecked term{failed.length === 1 ? "" : "s"}</summary>
          <ul>
            {failed.map((e, i) => (
              <li key={i}>
                <code>{e.term}</code> - {e.error}
              </li>
            ))}
          </ul>
        </details>
      )}
      <div className="pp-modal-actions">
        <button type="button" className="secondary-button" onClick={onClose}>Close</button>
      </div>
    </>
  );
}

function PartialBlock({ totalChecked, failed, onClose }) {
  return (
    <>
      <div className="pp-tm-fail-header pp-tm-fail-header-warn">
        <span className="pp-tm-fail-icon pp-tm-fail-icon-warn" aria-hidden="true">!</span>
        <h3>Trademark check incomplete</h3>
      </div>
      <p className="pp-tm-summary">
        {totalChecked} term{totalChecked === 1 ? "" : "s"} returned no matches, but{" "}
        {failed.length} term{failed.length === 1 ? "" : "s"} could not be checked.
        Do not assume the design is clear until every term is verified.
      </p>
      <details className="pp-tm-errors" open>
        <summary>{failed.length} unchecked term{failed.length === 1 ? "" : "s"}</summary>
        <ul>
          {failed.map((e, i) => (
            <li key={i}>
              <code>{e.term}</code> - {e.error}
            </li>
          ))}
        </ul>
      </details>
      <p className="pp-tm-disclaimer">
        This is informational only, not legal advice. Verify unchecked terms manually before publishing.
      </p>
      <div className="pp-modal-actions">
        <button type="button" className="secondary-button" onClick={onClose}>Close</button>
      </div>
    </>
  );
}

function NoMatchBlock({ totalChecked, phrase, onClose }) {
  return (
    <>
      <h3>No trademark matches found</h3>
      <p className="pp-tm-summary">
        {phrase ? <>Matches for "{phrase}" returned no rows.</> : <>Checked {totalChecked} term{totalChecked === 1 ? "" : "s"} successfully.</>}
      </p>
      <div className="pp-tm-risk pp-tm-risk-clean">No trademark matches found.</div>
      <p className="pp-tm-disclaimer">No trademark matches found. This is not legal advice; review official sources before publishing.</p>
      <div className="pp-modal-actions">
        <button type="button" className="secondary-button" onClick={onClose}>Close</button>
      </div>
    </>
  );
}

function MatchesBlock({ results, totalMatches, totalChecked, failed, phrase, onClose }) {
  const [filter, setFilter] = useState("all");
  const allMatches = useMemo(() => results.flatMap((r) => r.matches || []), [results]);
  const liveCount = allMatches.filter(isLiveMatch).length;
  const deadCount = allMatches.filter(isDeadMatch).length;
  const sortedResults = useMemo(() => {
    return results.map((r) => ({
      ...r,
      matches: [...(r.matches || [])]
        .sort((a, b) => matchRank(a) - matchRank(b))
        .filter((match) => {
          if (filter === "live") return isLiveMatch(match);
          if (filter === "dead") return isDeadMatch(match);
          return true;
        }),
    }));
  }, [results, filter]);
  const visibleCount = sortedResults.reduce((acc, r) => acc + (r.matches?.length || 0), 0);

  return (
    <>
      <h3>Found trademarks</h3>
      <p className="pp-tm-summary">
        {phrase ? (
          <>Matches for "{phrase}"</>
        ) : (
          <>{totalMatches} match{totalMatches === 1 ? "" : "es"} across {totalChecked} checked term{totalChecked === 1 ? "" : "s"}.</>
        )}
      </p>
      <div className="pp-tm-filter-pills" role="tablist" aria-label="Filter trademark results">
        <button type="button" className={filter === "all" ? "active" : ""} onClick={() => setFilter("all")}>
          All <span>{totalMatches}</span>
        </button>
        <button type="button" className={filter === "live" ? "active" : ""} onClick={() => setFilter("live")}>
          Live <span>{liveCount}</span>
        </button>
        <button type="button" className={filter === "dead" ? "active" : ""} onClick={() => setFilter("dead")}>
          Dead <span>{deadCount}</span>
        </button>
      </div>

      <div className="pp-tm-results">
        {visibleCount === 0 && (
          <div className="pp-tm-filter-empty">No {filter} trademark matches in this check.</div>
        )}
        {sortedResults.map((r, idx) =>
          r.matches && r.matches.length > 0 ? (
            <section key={idx} className="pp-tm-design-block">
              {r.designLabel && <h4 className="pp-tm-design-title">{r.designLabel}</h4>}
              <div className="pp-tm-table-wrap">
                <table className="pp-tm-table">
                  <thead>
                    <tr>
                      <th>Serial</th>
                      <th>Office</th>
                      <th>Trademark</th>
                      <th>Classification</th>
                      <th>Registration Date</th>
                      <th>Status</th>
                      <th>USPTO</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.matches.map((m, i) => {
                      const tsdrUrl = buildUSPTOUrl(m.serial);
                      return (
                        <tr key={`${m.serial}-${i}`}>
                          <td>
                            {tsdrUrl ? (
                              <a
                                href={tsdrUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="pp-tm-serial"
                              >
                                {m.serial}
                              </a>
                            ) : (
                              <span className="pp-tm-serial-na">N/A</span>
                            )}
                          </td>
                          <td>{m.office}</td>
                          <td className="pp-tm-mark">{m.trademark}</td>
                          <td>{m.classification ? <span className="pp-tm-class">{m.classification}</span> : "-"}</td>
                          <td className="pp-tm-date">{m.registration_date || "-"}</td>
                          <td><StatusBadge status={m.status} registered={m.registered} /></td>
                          <td>
                            {tsdrUrl ? (
                              <a className="pp-tm-uspto-link" href={tsdrUrl} target="_blank" rel="noopener noreferrer">
                                Open USPTO
                              </a>
                            ) : (
                              <span className="pp-tm-serial-na">-</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null
        )}
      </div>

      {failed.length > 0 && (
        <details className="pp-tm-errors">
          <summary>
            {failed.length} term{failed.length === 1 ? "" : "s"} could not be checked. Verify manually.
          </summary>
          <ul>
            {failed.map((e, i) => (
              <li key={i}>
                <code>{e.term}</code> - {e.error}
              </li>
            ))}
          </ul>
        </details>
      )}

      <p className="pp-tm-disclaimer">
        Trademark matches found above. This is informational only, not legal advice. Review carefully before publishing.
      </p>
      <div className="pp-modal-actions">
        <button type="button" className="secondary-button" onClick={onClose}>Close</button>
      </div>
    </>
  );
}

function StatusBadge({ status, registered }) {
  const s = String(status || "").toLowerCase();
  let cls = "pp-tm-status-neutral";
  if (s.includes("live") || s.includes("registered") || s.includes("active")) cls = "pp-tm-status-live";
  else if (s.includes("dead") || s.includes("abandoned") || s.includes("cancel")) cls = "pp-tm-status-dead";
  else if (s.includes("pending") || s.includes("examination") || s.includes("review")) cls = "pp-tm-status-pending";
  return (
    <span className="pp-tm-status-group">
      <span className={`pp-tm-status ${cls}`}>{status || "-"}</span>
      {registered && <span className="pp-tm-status pp-tm-status-live">Registered</span>}
    </span>
  );
}

function isLiveMatch(match) {
  return String(match?.status || "").toLowerCase().includes("live");
}

function isDeadMatch(match) {
  return String(match?.status || "").toLowerCase().includes("dead");
}

function matchRank(match) {
  if (isLiveMatch(match)) return 0;
  if (isDeadMatch(match)) return 2;
  return 1;
}

function ManualBlock({ failed, onClose }) {
  return (
    <>
      <h3>Trademark checker unavailable</h3>
      <p className="pp-tm-summary">These terms need manual review before publishing.</p>
      {failed.length > 0 && (
        <details className="pp-tm-errors" open>
          <summary>{failed.length} term{failed.length === 1 ? "" : "s"} to review</summary>
          <ul>
            {failed.map((e, i) => (
              <li key={i}>
                <code>{e.term}</code> - {e.error}
              </li>
            ))}
          </ul>
        </details>
      )}
      <p className="pp-tm-disclaimer">
        Check these terms manually at{" "}
        <a href="https://tmsearch.uspto.gov" target="_blank" rel="noreferrer noopener">
          tmsearch.uspto.gov
        </a>.
      </p>
      <div className="pp-modal-actions">
        <button type="button" className="secondary-button" onClick={onClose}>Close</button>
      </div>
    </>
  );
}
