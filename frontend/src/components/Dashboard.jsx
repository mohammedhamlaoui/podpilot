import UploadedDesignCleanup from "./UploadedDesignCleanup";
import { useMemo, useState } from "react";
import Icon from "./Icon";
import { Sparkles, CircleArrowDown, Bell, CreditCard, Puzzle, UserRound, Download, Layers3, CircleCheck, Clock3, CircleAlert, ArrowUpRight } from "lucide-react";
import AiCreditsDashboardCard from "./AiCreditsDashboardCard";
import ThemeToggle from "./ThemeToggle";
import { getPricingUrl } from "../lib/subscriptionAccess";

const EXTENSION_URL = "https://chromewebstore.google.com/detail/aloidebamibhnggbnlhoemnokkllkgdn?utm_source=item-share-cb";

function percent(uploaded, total) {
  if (!total || total === 0) return 0;
  return Math.round((uploaded / total) * 100);
}

const PLATFORM_METRICS = [
  { label: "Total", icon: Layers3, tone: "total" },
  { label: "Uploaded", icon: CircleCheck, tone: "uploaded" },
  { label: "Pending", icon: Clock3, tone: "pending" },
  { label: "Failed", icon: CircleAlert, tone: "failed" },
];

function PlatformStats({ total, uploaded, pending, failed }) {
  const values = { total, uploaded, pending, failed };

  return (
    <div className="pp-dash-platform-stats">
      {PLATFORM_METRICS.filter(({ tone }) => tone !== "failed" || failed > 0).map(({ label, icon: MetricIcon, tone }) => (
        <div className={`pp-platform-metric pp-platform-metric-${tone}`} key={tone}>
          <strong>{values[tone]}</strong>
          <small><MetricIcon size={14} strokeWidth={1.8} aria-hidden="true" />{label}</small>
        </div>
      ))}
    </div>
  );
}

function CardSkeleton() {
  return (
    <div className="pp-dash-card pp-skeleton-card" aria-hidden="true">
      <span className="pp-skeleton-cell" />
      <span className="pp-skeleton-cell" style={{ width: "60%", height: 28 }} />
      <span className="pp-skeleton-cell" />
    </div>
  );
}

function AiCreditsHeaderPill({ summary }) {
  const hasSubscription = Boolean(summary?.has_subscription);
  const remaining = hasSubscription ? Number(summary?.daily_ai_tokens_remaining ?? summary?.daily_ai_tokens ?? 0) : 0;
  const limit = hasSubscription ? Number(summary?.daily_ai_tokens_limit ?? summary?.daily_ai_tokens ?? 0) : 0;
  const extra = Number(summary?.ai_tokens || 0);
  const totalAvailable = Math.max(remaining, 0) + Math.max(extra, 0);
  const label = hasSubscription ? `${totalAvailable.toLocaleString()} left` : "0 left";
  const detail = hasSubscription
    ? `${Math.max(remaining, 0).toLocaleString()} daily${limit ? ` / ${limit.toLocaleString()}` : ""}${extra ? ` + ${extra.toLocaleString()} extra` : ""}`
    : "No active AI credits";

  return (
    <a
      href="/pricing#ai-listing-credits"
      className="pp-header-ai-credits"
      title={detail}
      aria-label={`AI listing credits: ${detail}`}
    >
      <Sparkles className="ui-icon" strokeWidth={1.8} aria-hidden="true" />
      <span className="pp-header-ai-credits-text">
        <strong>{label}</strong>
        <small>AI credits</small>
      </span>
    </a>
  );
}

function ExtensionUpdateGlyph({ className = "" }) {
  return <CircleArrowDown className={className} strokeWidth={1.8} aria-hidden="true" />;
}

function ExtensionUpdateButton() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="pp-extension-update-wrap">
      <button
        type="button"
        className={`pp-extension-update-btn${isOpen ? " is-open" : ""}`}
        onClick={() => setIsOpen((current) => !current)}
        aria-label="New extension update available"
        aria-expanded={isOpen}
        aria-controls="pp-extension-update-popover"
        title="New extension update available"
      >
        <ExtensionUpdateGlyph className="pp-extension-update-glyph" />
        <span className="pp-extension-update-pulse" aria-hidden="true" />
      </button>

      {isOpen && (
        <div id="pp-extension-update-popover" className="pp-extension-update-popover" role="dialog" aria-label="Extension update">
          <div className="pp-extension-update-head">
            <span className="pp-extension-update-mark" aria-hidden="true">
              <ExtensionUpdateGlyph className="pp-extension-update-glyph" />
            </span>
            <div>
              <strong>New extension update available</strong>
              <span>Update your browser extension</span>
            </div>
          </div>
          <p>
            A new PodPilot extension update is available. Update it now to get the latest upload fixes and the best automation experience.
          </p>
          <a href={EXTENSION_URL} target="_blank" rel="noopener noreferrer" className="pp-extension-update-link">
            <Download className="ui-icon" strokeWidth={1.8} aria-hidden="true" />
            <span>Open extension update</span>
          </a>
        </div>
      )}
    </div>
  );
}

export default function Dashboard({ userId, onUploadedDesignsDeleted, redbubbleDesigns, teepublicDesigns, onNavigate, onOpenRetentionNotice, isLoading = false, isRefreshing = false, theme, setTheme, platformAccess, subscriptionSummary = null, isWorkspaceLocked = false }) {
  const pricingUrl = getPricingUrl();
  const canUseRedbubble = Boolean(platformAccess?.redbubble);
  const canUseTeePublic = Boolean(platformAccess?.teepublic);
  const lockedTitle = "Choose a plan to use this feature";

  const stats = useMemo(() => {
    const all = [...(redbubbleDesigns || []), ...(teepublicDesigns || [])];
    const total = all.length;
    const uploaded = all.filter((d) => d.status === "uploaded").length;
    const failed = all.filter((d) => d.status === "failed").length;
    const pending = total - uploaded - failed;
    const progress = percent(uploaded, total);

    const tp = teepublicDesigns || [];
    const tpTotal = tp.length;
    const tpUploaded = tp.filter((d) => d.status === "uploaded").length;
    const tpFailed = tp.filter((d) => d.status === "failed").length;
    const tpPending = tpTotal - tpUploaded - tpFailed;
    const tpProgress = percent(tpUploaded, tpTotal);

    const rb = redbubbleDesigns || [];
    const rbTotal = rb.length;
    const rbUploaded = rb.filter((d) => d.status === "uploaded").length;
    const rbFailed = rb.filter((d) => d.status === "failed").length;
    const rbPending = rbTotal - rbUploaded - rbFailed;
    const rbProgress = percent(rbUploaded, rbTotal);

    return { total, uploaded, failed, pending, progress, tpTotal, tpUploaded, tpFailed, tpPending, tpProgress, rbTotal, rbUploaded, rbFailed, rbPending, rbProgress };
  }, [redbubbleDesigns, teepublicDesigns]);

  return (
    <div className="pp-dashboard">
      <div className="pp-dash-header">
        <div>
          <h1>Dashboard</h1>
          <p>{isLoading ? "Loading dashboard..." : "Overview of your designs across all platforms"}</p>
        </div>
        <div className="pp-dash-header-right">
          <AiCreditsHeaderPill summary={subscriptionSummary} />

          <ExtensionUpdateButton />

          <button
            type="button"
            className="pp-header-bell-btn"
            onClick={onOpenRetentionNotice}
            aria-label="Design retention notice"
            title="Design retention notice"
          >
            <Bell className="ui-icon" strokeWidth={1.8} aria-hidden="true" />
            <span className="pp-bell-dot" aria-hidden="true" />
          </button>
          
          <a
            href={pricingUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="pp-header-btn"
          >
            <CreditCard className="ui-icon" strokeWidth={1.8} aria-hidden="true" />
            <span>Pricing Plans</span>
          </a>

          <a
            href={EXTENSION_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="pp-header-btn"
          >
            <Puzzle className="ui-icon" strokeWidth={1.8} aria-hidden="true" />
            <span>Get Extension</span>
          </a>

          <ThemeToggle theme={theme} setTheme={setTheme} className="pp-dash-theme-toggle" />

          <button
            type="button"
            className="pp-header-profile-btn"
            onClick={() => onNavigate("profile")}
            aria-label="Profile"
          >
            <UserRound className="ui-icon" strokeWidth={1.8} aria-hidden="true" />
          </button>
        </div>
      </div>

      <AiCreditsDashboardCard />

      <UploadedDesignCleanup userId={userId} onDeleted={onUploadedDesignsDeleted} disabled={isLoading || isWorkspaceLocked} />

      <div className="pp-dash-section pp-dash-platform-section">
        <div className="pp-dash-section-head">
          <h2>Platform Overview</h2>
          <span>Active upload automation for Redbubble and TeePublic</span>
        </div>

        <div className="pp-dash-platforms">
          <div
            className={`pp-dash-platform-card${!canUseTeePublic ? " pp-dash-platform-card-locked" : ""}`}
            data-platform="teepublic"
            title={!canUseTeePublic ? lockedTitle : undefined}
          >
            <div className="pp-dash-platform-head">
              <div className="pp-dash-platform-title">
                <Icon name="teepublic" />
                <strong>TeePublic</strong>
              </div>
              <span className={`pp-dash-badge ${canUseTeePublic ? "pp-dash-badge-accent" : "pp-dash-badge-locked"}`}>
                {canUseTeePublic ? `${stats.tpProgress}% uploaded` : <><Icon name="lock" /> Preview</>}
              </span>
            </div>
            <p>Prepare TeePublic metadata, colors, products, queues, and upload status.</p>
            <PlatformStats total={stats.tpTotal} uploaded={stats.tpUploaded} pending={stats.tpPending} failed={stats.tpFailed} />
            <div className="pp-dash-platform-progress">
              <span>Upload Progress</span>
              <span>{stats.tpProgress}%</span>
            </div>
            <div className="pp-dash-progress-bar">
              <div className="pp-dash-progress-fill" style={{ "--platform-progress": stats.tpProgress / 100 }} />
            </div>
            <button type="button" className="pp-dash-manage-btn" onClick={() => { console.log("[PodPilot] Manage clicked", "teepublic"); onNavigate("teepublic"); }}>
              Manage <ArrowUpRight className="pp-platform-manage-icon" aria-hidden="true" />
            </button>
          </div>

          <div
            className={`pp-dash-platform-card${!canUseRedbubble ? " pp-dash-platform-card-locked" : ""}`}
            data-platform="redbubble"
            title={!canUseRedbubble ? lockedTitle : undefined}
          >
            <div className="pp-dash-platform-head">
              <div className="pp-dash-platform-title">
                <Icon name="redbubble" />
                <strong>Redbubble</strong>
              </div>
              <span className={`pp-dash-badge ${canUseRedbubble ? "pp-dash-badge-accent" : "pp-dash-badge-locked"}`}>
                {canUseRedbubble ? `${stats.rbProgress}% uploaded` : <><Icon name="lock" /> Preview</>}
              </span>
            </div>
            <p>Manage Redbubble imports, image matching, queue progress, and upload status.</p>
            <PlatformStats total={stats.rbTotal} uploaded={stats.rbUploaded} pending={stats.rbPending} failed={stats.rbFailed} />
            <div className="pp-dash-platform-progress">
              <span>Upload Progress</span>
              <span>{stats.rbProgress}%</span>
            </div>
            <div className="pp-dash-progress-bar">
              <div className="pp-dash-progress-fill" style={{ "--platform-progress": stats.rbProgress / 100 }} />
            </div>
            <button type="button" className="pp-dash-manage-btn" onClick={() => { console.log("[PodPilot] Manage clicked", "redbubble"); onNavigate("redbubble"); }}>
              Manage <ArrowUpRight className="pp-platform-manage-icon" aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>

      <div className="pp-dash-summary-head">
        <h2>Upload Snapshot</h2>
        <span style={isRefreshing ? { opacity: 0.55 } : undefined}>
          {isRefreshing ? "Updating quietly..." : "A quick read on this month's workflow"}
        </span>
      </div>

      <div className="pp-dash-cards">
        {isLoading ? (
          <>
            <CardSkeleton />
            <CardSkeleton />
            <CardSkeleton />
            <CardSkeleton />
          </>
        ) : (
          <>
            <div className="pp-dash-card">
              <div className="pp-dash-card-head">
                <span>Total Designs</span>
                <Icon name="designs" />
              </div>
              <strong className="pp-dash-card-value">{stats.total}</strong>
              <small>Across Redbubble and TeePublic</small>
            </div>
            <div className="pp-dash-card">
              <div className="pp-dash-card-head">
                <span>Uploaded</span>
                <Icon name="check" />
              </div>
              <strong className="pp-dash-card-value pp-dash-success">{stats.uploaded}</strong>
              <small>Successfully published</small>
            </div>
            <div className="pp-dash-card">
              <div className="pp-dash-card-head">
                <span>Pending</span>
                <Icon name="upload" />
              </div>
              <strong className="pp-dash-card-value pp-dash-warning">{stats.pending}</strong>
              <small>Waiting in upload flow</small>
            </div>
            <div className="pp-dash-card">
              <div className="pp-dash-card-head">
                <span>Progress</span>
                <Icon name="queue" />
              </div>
              <strong className="pp-dash-card-value">{stats.progress}%</strong>
              <div className="pp-dash-progress-bar">
                <div className="pp-dash-progress-fill" style={{ width: `${stats.progress}%` }} />
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
