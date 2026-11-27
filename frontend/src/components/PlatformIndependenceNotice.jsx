import { useState } from "react";
import { Info, X } from "lucide-react";

export default function PlatformIndependenceNotice({ userId }) {
  const storageKey = `podpilot:independence-notice:v1:${userId || "guest"}`;
  const [dismissed, setDismissed] = useState(() => {
    try { return localStorage.getItem(storageKey) === "dismissed"; }
    catch { return false; }
  });
  function dismiss() {
    setDismissed(true);
    try { localStorage.setItem(storageKey, "dismissed"); }
    catch { /* Still dismiss for this visit when storage is unavailable. */ }
  }
  if (dismissed) return null;
  return <aside className="pp-independence-notice" aria-label="Platform independence notice">
    <span className="pp-independence-mark" aria-hidden="true"><Info size={19} /></span>
    <div>
      <strong>Independent platform</strong>
      <p>PodPilot is an independent platform with its own brand and identity. It is not affiliated with, endorsed by, or operated by MerchGhost (merchghost.com). Any similarities in features or workflows do not imply a connection between the two platforms.</p>
    </div>
    <button type="button" className="pp-independence-dismiss" onClick={dismiss} aria-label="Dismiss platform independence notice" title="Dismiss notice"><X size={17} aria-hidden="true" /></button>
  </aside>;
}
