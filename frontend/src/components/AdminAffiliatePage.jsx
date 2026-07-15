import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BadgeDollarSign,
  Banknote,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  Eye,
  LockKeyhole,
  MousePointerClick,
  PauseCircle,
  PlayCircle,
  RefreshCw,
  Search,
  ShieldCheck,
  TrendingUp,
  UserPlus,
  Users,
  WalletCards,
  X,
} from "lucide-react";
import {
  getAdminAffiliateAccount,
  getAdminAffiliateActivity,
  getAdminAffiliateOverview,
  listAdminAffiliateAccounts,
  listAdminAffiliateCommissions,
  listAdminAffiliatePayouts,
  reviewAdminAffiliatePayout,
  updateAdminAffiliateStatus,
} from "../api/client";


const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const integer = new Intl.NumberFormat("en-US");
const SECTIONS = [
  { id: "overview", label: "Overview" },
  { id: "affiliates", label: "Affiliates" },
  { id: "commissions", label: "Commissions" },
  { id: "payouts", label: "Payouts" },
  { id: "activity", label: "Referral activity" },
];
const EMPTY_PAGE = { items: [], page: 1, page_size: 25, total: 0, pages: 1 };
const INITIAL_LOADING = { overview: true, affiliates: true, commissions: true, payouts: true, activity: true };
const INITIAL_LOADED = { overview: false, affiliates: false, commissions: false, payouts: false, activity: false };
const INITIAL_ERRORS = { overview: "", affiliates: "", commissions: "", payouts: "", activity: "", drawer: "", action: "" };
const TRANSIENT_READ_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);


function formatDate(value, withTime = false) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    ...(withTime ? { hour: "numeric", minute: "2-digit" } : {}),
  }).format(date);
}


function label(value) {
  return String(value || "unknown").replace(/_/g, " ").replace(/^./, (letter) => letter.toUpperCase());
}


function errorMessage(error, fallback = "Could not load affiliate admin data.") {
  const detail = error?.response?.data?.detail;
  if (typeof detail === "string" && detail.trim()) return detail;
  if (typeof detail?.message === "string" && detail.message.trim()) return detail.message;
  return fallback;
}


function isTransientReadError(error) {
  const status = Number(error?.response?.status || 0);
  return !error?.response || TRANSIENT_READ_STATUSES.has(status);
}


async function readWithRetry(read, attempts = 2) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await read();
    } catch (error) {
      lastError = error;
      if (!isTransientReadError(error) || attempt === attempts - 1) throw error;
      await new Promise((resolve) => window.setTimeout(resolve, 300 * (attempt + 1)));
    }
  }
  throw lastError;
}


function StatusBadge({ value }) {
  return <span className={`admin-affiliate-status is-${String(value || "unknown").toLowerCase()}`}><span />{label(value)}</span>;
}


function AdminEmpty({ icon: Icon = CircleDollarSign, title, detail }) {
  return (
    <div className="admin-affiliate-empty">
      <Icon />
      <strong>{title}</strong>
      {detail && <span>{detail}</span>}
    </div>
  );
}


function TableSkeleton({ columns = 6 }) {
  return (
    <div className="admin-affiliate-table-skeleton" aria-busy="true">
      {Array.from({ length: 6 }).map((_, row) => (
        <div key={row} style={{ "--admin-columns": columns }}>
          {Array.from({ length: columns }).map((__, column) => <span key={column} />)}
        </div>
      ))}
    </div>
  );
}


function PanelSkeleton() {
  return (
    <section className="admin-affiliate-panel admin-affiliate-panel-skeleton" aria-busy="true" aria-label="Loading ranking data">
      <span /><span /><span /><span />
    </section>
  );
}


function AffiliateIdentity({ displayName, maskedEmail }) {
  const normalizedName = String(displayName || "").trim();
  const secondary = String(maskedEmail || "").trim();
  const primary = normalizedName || secondary || "PodPilot user";
  const showSecondary = secondary && secondary.toLocaleLowerCase() !== primary.toLocaleLowerCase();
  return (
    <div className="admin-affiliate-identity">
      <strong>{primary}</strong>
      {showSecondary && <small>{secondary}</small>}
    </div>
  );
}


function Pagination({ data, onPage, onPageSize }) {
  if (!data.total) return null;
  const start = (data.page - 1) * data.page_size + 1;
  const end = Math.min(data.page * data.page_size, data.total);
  return (
    <div className="admin-affiliate-pagination">
      <span>{start}–{end} of {integer.format(data.total)}</span>
      <label>
        Rows
        <select value={data.page_size} onChange={(event) => onPageSize(Number(event.target.value))}>
          {[10, 25, 50, 100].map((size) => <option key={size} value={size}>{size}</option>)}
        </select>
      </label>
      <button type="button" onClick={() => onPage(data.page - 1)} disabled={data.page <= 1} aria-label="Previous page"><ChevronLeft /></button>
      <strong>{data.page} / {data.pages}</strong>
      <button type="button" onClick={() => onPage(data.page + 1)} disabled={data.page >= data.pages} aria-label="Next page"><ChevronRight /></button>
    </div>
  );
}


function OverviewCard({ icon: Icon, label: cardLabel, value, detail, tone = "violet" }) {
  return (
    <article className={`admin-affiliate-overview-card is-${tone}`}>
      <span className="admin-affiliate-card-icon"><Icon /></span>
      <div>
        <span>{cardLabel}</span>
        <strong>{value}</strong>
        <small>{detail}</small>
      </div>
    </article>
  );
}


function ConfirmationModal({ confirmation, note, setNote, submitting, onCancel, onConfirm }) {
  if (!confirmation) return null;
  const requiresNote = confirmation.action === "rejected";
  return (
    <div className="admin-affiliate-modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && !submitting && onCancel()}>
      <section className="admin-affiliate-modal" role="alertdialog" aria-modal="true" aria-labelledby="admin-affiliate-confirm-title">
        <button type="button" className="admin-affiliate-close" onClick={onCancel} disabled={submitting} aria-label="Close"><X /></button>
        <span className={`admin-affiliate-modal-icon is-${confirmation.tone || "violet"}`}><ShieldCheck /></span>
        <span className="admin-affiliate-kicker">Server-verified action</span>
        <h2 id="admin-affiliate-confirm-title">{confirmation.title}</h2>
        <p>{confirmation.description}</p>
        <div className="admin-affiliate-confirm-target">
          <span>{confirmation.targetLabel}</span>
          <strong>{confirmation.targetValue}</strong>
        </div>
        <label>
          Admin note {requiresNote ? <em>Required</em> : <small>Optional</small>}
          <textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            maxLength={1000}
            placeholder={requiresNote ? "Explain why this payout is being rejected…" : "Add context for the audit log…"}
            rows="4"
          />
        </label>
        <div className="admin-affiliate-modal-actions">
          <button type="button" className="admin-affiliate-button is-secondary" onClick={onCancel} disabled={submitting}>Cancel</button>
          <button type="button" className={`admin-affiliate-button is-${confirmation.tone || "primary"}`} onClick={onConfirm} disabled={submitting || (requiresNote && !note.trim())}>
            {submitting ? <RefreshCw className="is-spinning" /> : <Check />}
            {submitting ? "Saving…" : confirmation.confirmLabel}
          </button>
        </div>
      </section>
    </div>
  );
}


function DetailDrawer({ data, loading, onClose, onStatusAction }) {
  return (
    <div className="admin-affiliate-drawer-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <aside className="admin-affiliate-drawer" aria-label="Affiliate detail">
        <header>
          <div><span className="admin-affiliate-kicker">Affiliate dossier</span><h2>{data?.account ? data.account.display_name || data.account.masked_email || "PodPilot user" : "Loading affiliate…"}</h2></div>
          <button type="button" onClick={onClose} aria-label="Close affiliate details"><X /></button>
        </header>
        {loading ? <TableSkeleton columns={2} /> : !data?.account ? (
          <AdminEmpty icon={Users} title="Affiliate details unavailable" />
        ) : (
          <div className="admin-affiliate-drawer-body">
            <section className="admin-affiliate-dossier-hero">
              <div>
                <StatusBadge value={data.account.status} />
                <code>{data.account.referral_code}</code>
                <span>{data.account.masked_email} · {data.account.safe_user_id}</span>
              </div>
              <button
                type="button"
                className={`admin-affiliate-button ${data.account.status === "active" ? "is-danger-quiet" : "is-success"}`}
                onClick={() => onStatusAction(data.account)}
              >
                {data.account.status === "active" ? <PauseCircle /> : <PlayCircle />}
                {data.account.status === "active" ? "Suspend" : "Reactivate"}
              </button>
            </section>
            <a className="admin-affiliate-referral-url" href={data.account.referral_url} target="_blank" rel="noreferrer">{data.account.referral_url}</a>
            <section className="admin-affiliate-drawer-metrics">
              {[
                ["Clicks", data.account.clicks], ["Signups", data.account.signups],
                ["Paid referrals", data.account.paid_customers], ["Conversion", `${data.account.conversion_rate}%`],
                ["Pending", money.format(data.account.pending_balance)], ["Available", money.format(data.account.available_balance)],
              ].map(([metric, value]) => <div key={metric}><span>{metric}</span><strong>{value}</strong></div>)}
            </section>
            <section className="admin-affiliate-safe-method">
              <div><span>Payout method</span><strong>{data.account.payout_method?.label || "Not configured"}</strong></div>
              <code>{data.account.payout_method?.summary || "No payout method"}</code>
              <small>Only masked payout details are returned by the server.</small>
            </section>

            <section className="admin-affiliate-drawer-section">
              <div className="admin-affiliate-section-heading"><div><span>Money trail</span><h3>Commission history</h3></div><small>{data.commissions?.length || 0} records</small></div>
              {data.commissions?.length ? (
                <div className="admin-affiliate-mini-list">
                  {data.commissions.slice(0, 12).map((item) => (
                    <div key={item.id}><StatusBadge value={item.status} /><strong>{money.format(item.commission_amount)}</strong><span>{label(item.plan)} · {label(item.transaction_type)}</span><small>{formatDate(item.created_at)}</small></div>
                  ))}
                </div>
              ) : <AdminEmpty title="No commissions yet" />}
            </section>

            <section className="admin-affiliate-drawer-section">
              <div className="admin-affiliate-section-heading"><div><span>Withdrawals</span><h3>Payout history</h3></div></div>
              {data.payouts?.length ? (
                <div className="admin-affiliate-mini-list">
                  {data.payouts.map((item) => (
                    <div key={item.id}><StatusBadge value={item.status} /><strong>{money.format(item.amount)}</strong><span>{item.payout_method?.label} · {item.payout_method?.summary}</span><small>{formatDate(item.requested_at)}</small></div>
                  ))}
                </div>
              ) : <AdminEmpty icon={Banknote} title="No payout history" />}
            </section>

            <section className="admin-affiliate-drawer-section">
              <div className="admin-affiliate-section-heading"><div><span>Accountability</span><h3>Audit events</h3></div></div>
              {data.audit_events?.length ? (
                <div className="admin-affiliate-audit-list">
                  {data.audit_events.map((event) => (
                    <div key={event.id}><span className="admin-affiliate-audit-dot" /><div><strong>{label(event.action)}</strong><span>{label(event.previous_state?.status)} → {label(event.new_state?.status)}</span><small>{formatDate(event.created_at, true)} · {event.admin_user}{event.note ? ` · ${event.note}` : ""}</small></div></div>
                  ))}
                </div>
              ) : <AdminEmpty icon={ShieldCheck} title="No admin actions recorded" />}
            </section>
          </div>
        )}
      </aside>
    </div>
  );
}


function RankingBars({ title, rows, metric, formatter }) {
  const max = Math.max(...(rows || []).map((row) => Number(row[metric] || 0)), 1);
  return (
    <section className="admin-affiliate-panel admin-affiliate-ranking">
      <div className="admin-affiliate-section-heading"><div><span>Leaderboard</span><h2>{title}</h2></div><TrendingUp /></div>
      {rows?.length ? rows.map((row, index) => (
        <div className="admin-affiliate-rank-row" key={row.affiliate_id}>
          <span>{String(index + 1).padStart(2, "0")}</span>
          <div><strong>{row.affiliate}</strong><small>{row.referral_code}</small><i><b style={{ width: `${Math.max((Number(row[metric] || 0) / max) * 100, 4)}%` }} /></i></div>
          <em>{formatter(row[metric])}</em>
        </div>
      )) : <AdminEmpty icon={TrendingUp} title="No ranking data yet" />}
    </section>
  );
}


export default function AdminAffiliatePage({ isAdmin, initialSection = "overview" }) {
  const [section, setSection] = useState(initialSection);
  const [overview, setOverview] = useState(null);
  const [activityData, setActivityData] = useState(null);
  const [accounts, setAccounts] = useState(EMPTY_PAGE);
  const [commissions, setCommissions] = useState(EMPTY_PAGE);
  const [payouts, setPayouts] = useState(EMPTY_PAGE);
  const [loading, setLoading] = useState(INITIAL_LOADING);
  const [loaded, setLoaded] = useState(INITIAL_LOADED);
  const [errors, setErrors] = useState(INITIAL_ERRORS);
  const [notice, setNotice] = useState("");
  const [forbidden, setForbidden] = useState(false);
  const [accountFilters, setAccountFilters] = useState({ search: "", status: "", date_from: "", date_to: "", page: 1, page_size: 25 });
  const [commissionFilters, setCommissionFilters] = useState({ search: "", status: "", plan: "", transaction_type: "", date_from: "", date_to: "", page: 1, page_size: 25 });
  const [payoutFilters, setPayoutFilters] = useState({ search: "", status: "requested", date_from: "", date_to: "", page: 1, page_size: 25 });
  const [drawerId, setDrawerId] = useState("");
  const [drawerData, setDrawerData] = useState(null);
  const [drawerLoading, setDrawerLoading] = useState(false);
  const [confirmation, setConfirmation] = useState(null);
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const requestSequence = useRef({ overview: 0, affiliates: 0, commissions: 0, payouts: 0, activity: 0, drawer: 0 });

  useEffect(() => { setSection(initialSection); }, [initialSection]);

  const handleFailure = useCallback((sectionKey, requestError, fallback) => {
    if (requestError?.response?.status === 403) setForbidden(true);
    setErrors((current) => ({ ...current, [sectionKey]: errorMessage(requestError, fallback) }));
  }, []);

  const runSectionRead = useCallback(async (sectionKey, read, apply, fallback) => {
    const sequence = requestSequence.current[sectionKey] + 1;
    requestSequence.current[sectionKey] = sequence;
    setLoading((current) => ({ ...current, [sectionKey]: true }));
    try {
      const data = await readWithRetry(read);
      if (requestSequence.current[sectionKey] !== sequence) return;
      apply(data);
      setLoaded((current) => ({ ...current, [sectionKey]: true }));
      setErrors((current) => ({ ...current, [sectionKey]: "" }));
    } catch (requestError) {
      if (requestSequence.current[sectionKey] !== sequence) return;
      handleFailure(sectionKey, requestError, fallback);
    } finally {
      if (requestSequence.current[sectionKey] === sequence) {
        setLoading((current) => ({ ...current, [sectionKey]: false }));
      }
    }
  }, [handleFailure]);

  const loadOverview = useCallback(() => runSectionRead(
    "overview",
    getAdminAffiliateOverview,
    setOverview,
    "Could not load the affiliate overview.",
  ), [runSectionRead]);

  const loadActivity = useCallback(() => runSectionRead(
    "activity",
    getAdminAffiliateActivity,
    setActivityData,
    "Could not load referral activity.",
  ), [runSectionRead]);

  const loadAccounts = useCallback(() => runSectionRead(
    "affiliates",
    () => listAdminAffiliateAccounts(accountFilters),
    setAccounts,
    "Could not load affiliates.",
  ), [accountFilters, runSectionRead]);

  const loadCommissions = useCallback(() => runSectionRead(
    "commissions",
    () => listAdminAffiliateCommissions(commissionFilters),
    setCommissions,
    "Could not load commissions.",
  ), [commissionFilters, runSectionRead]);

  const loadPayouts = useCallback(() => runSectionRead(
    "payouts",
    () => listAdminAffiliatePayouts(payoutFilters),
    setPayouts,
    "Could not load payout requests.",
  ), [payoutFilters, runSectionRead]);

  const loadDrawer = useCallback(async (affiliateId) => {
    if (!affiliateId) return;
    const sequence = requestSequence.current.drawer + 1;
    requestSequence.current.drawer = sequence;
    setDrawerLoading(true);
    try {
      const data = await readWithRetry(() => getAdminAffiliateAccount(affiliateId));
      if (requestSequence.current.drawer !== sequence) return;
      setDrawerData(data);
      setErrors((current) => ({ ...current, drawer: "" }));
    } catch (requestError) {
      if (requestSequence.current.drawer !== sequence) return;
      handleFailure("drawer", requestError, "Could not load affiliate details.");
    } finally {
      if (requestSequence.current.drawer === sequence) setDrawerLoading(false);
    }
  }, [handleFailure]);

  useEffect(() => {
    if (!isAdmin) return;
    void loadOverview();
    void loadActivity();
  }, [isAdmin, loadActivity, loadOverview]);
  useEffect(() => { if (isAdmin && section === "affiliates") void loadAccounts(); }, [isAdmin, loadAccounts, section]);
  useEffect(() => { if (isAdmin && section === "commissions") void loadCommissions(); }, [isAdmin, loadCommissions, section]);
  useEffect(() => { if (isAdmin && section === "payouts") void loadPayouts(); }, [isAdmin, loadPayouts, section]);
  useEffect(() => { if (drawerId) void loadDrawer(drawerId); }, [drawerId, loadDrawer]);

  const overviewCards = useMemo(() => overview ? [
    { icon: Users, label: "Total affiliates", value: integer.format(overview.total_affiliates), detail: `${integer.format(overview.active_affiliates)} active`, tone: "violet" },
    { icon: MousePointerClick, label: "Referral clicks", value: integer.format(overview.total_clicks), detail: "All tracked visits", tone: "blue" },
    { icon: UserPlus, label: "Referred signups", value: integer.format(overview.total_signups), detail: `${integer.format(overview.total_paid_referrals)} paid customers`, tone: "cyan" },
    { icon: Clock3, label: "Pending commissions", value: money.format(overview.commissions?.pending || 0), detail: "Inside the 30-day hold", tone: "amber" },
    { icon: WalletCards, label: "Available commissions", value: money.format(overview.commissions?.available || 0), detail: "Eligible for payout", tone: "emerald" },
    { icon: BadgeDollarSign, label: "Paid commissions", value: money.format(overview.commissions?.paid || 0), detail: "Settled manually", tone: "ink" },
    { icon: RefreshCw, label: "Reversed commissions", value: money.format(overview.commissions?.reversed || 0), detail: "Refunds and chargebacks", tone: "rose" },
    { icon: Banknote, label: "Outstanding payouts", value: integer.format(overview.outstanding_payout_requests), detail: money.format(overview.outstanding_payout_amount || 0), tone: "purple" },
  ] : [], [overview]);

  const openAccountStatus = (account) => {
    const nextStatus = account.status === "active" ? "suspended" : "active";
    setNote("");
    setConfirmation({
      type: "account",
      id: account.id,
      action: nextStatus,
      title: nextStatus === "suspended" ? "Suspend this affiliate?" : "Reactivate this affiliate?",
      description: nextStatus === "suspended"
        ? "New referral attribution and commission creation will stop until the account is reactivated. Financial history remains intact."
        : "The affiliate can receive new attribution and commissions again. Existing financial history is unchanged.",
      targetLabel: account.display_name || account.masked_email || "PodPilot user",
      targetValue: account.referral_code,
      confirmLabel: nextStatus === "suspended" ? "Suspend affiliate" : "Reactivate affiliate",
      tone: nextStatus === "suspended" ? "danger" : "success",
    });
  };

  const openPayoutAction = (payout, action) => {
    const copy = {
      approved: ["Approve payout request?", "Approval reserves the request for manual payment. It does not send money automatically.", "Approve request", "success"],
      rejected: ["Reject payout request?", "The reserved amount will return to the affiliate's available balance.", "Reject request", "danger"],
      paid: ["Mark payout as paid?", "Confirm only after the manual payment has been completed outside PodPilot.", "Mark as paid", "violet"],
    }[action];
    setNote("");
    setConfirmation({ type: "payout", id: payout.id, action, title: copy[0], description: copy[1], confirmLabel: copy[2], tone: copy[3], targetLabel: payout.affiliate, targetValue: money.format(payout.amount) });
  };

  const refreshAfterAction = async () => {
    await Promise.all([loadOverview(), loadAccounts(), loadCommissions(), loadPayouts(), loadActivity()]);
    if (drawerId) await loadDrawer(drawerId);
  };

  const submitConfirmation = async () => {
    if (!confirmation || submitting) return;
    setSubmitting(true);
    setErrors((current) => ({ ...current, action: "" }));
    try {
      if (confirmation.type === "payout") {
        await reviewAdminAffiliatePayout(confirmation.id, { status: confirmation.action, admin_note: note.trim() || null });
        setNotice(`Payout request ${confirmation.action === "paid" ? "marked as paid" : confirmation.action}.`);
      } else {
        await updateAdminAffiliateStatus(confirmation.id, { status: confirmation.action, admin_note: note.trim() || null });
        setNotice(`Affiliate ${confirmation.action === "active" ? "reactivated" : "suspended"}.`);
      }
      setConfirmation(null);
      setNote("");
      await refreshAfterAction();
      setErrors((current) => ({ ...current, action: "" }));
    } catch (requestError) {
      handleFailure("action", requestError, "The admin action could not be completed.");
    } finally {
      setSubmitting(false);
    }
  };

  const activeError = errors.action || (section === "affiliates"
    ? errors.affiliates || errors.drawer
    : errors[section] || "");

  const dismissNotice = () => {
    setNotice("");
    setErrors((current) => ({
      ...current,
      action: "",
      [section]: "",
      ...(section === "affiliates" ? { drawer: "" } : {}),
    }));
  };

  if (!isAdmin || forbidden) {
    return (
      <div className="admin-affiliate-page admin-affiliate-denied">
        <span><LockKeyhole /></span>
        <div><span className="admin-affiliate-kicker">Restricted workspace</span><h1>Admin access required</h1><p>This route is available only when Supabase verifies <code>app_metadata.role = "admin"</code>. No affiliate data was loaded.</p></div>
      </div>
    );
  }

  return (
    <div className="admin-affiliate-page">
      <header className="admin-affiliate-hero">
        <div>
          <span className="admin-affiliate-kicker"><ShieldCheck /> Owner control plane</span>
          <h1>Affiliate operations,<br /><em>without blind spots.</em></h1>
          <p>Monitor attribution, commissions, and manual payouts from one audited workspace.</p>
        </div>
        <div className="admin-affiliate-hero-security"><span><LockKeyhole /></span><div><strong>Server-authorized</strong><small>Supabase app metadata · Service-role writes · Audit trail</small></div></div>
      </header>

      <nav className="admin-affiliate-tabs" aria-label="Affiliate admin sections">
        {SECTIONS.map((item) => <button key={item.id} type="button" className={section === item.id ? "is-active" : ""} onClick={() => setSection(item.id)}>{item.label}</button>)}
      </nav>

      {(notice || activeError) && (
        <div className={`admin-affiliate-notice ${activeError ? "is-error" : "is-success"}`} role={activeError ? "alert" : "status"}>
          <span>{activeError || notice}</span><button type="button" onClick={dismissNotice} aria-label="Dismiss"><X /></button>
        </div>
      )}

      {section === "overview" && (
        <div className="admin-affiliate-section-stack">
          {loading.overview ? <div className="admin-affiliate-overview-grid">{Array.from({ length: 8 }).map((_, index) => <div key={index} className="admin-affiliate-card-skeleton" />)}</div> : loaded.overview ? (
            <div className="admin-affiliate-overview-grid">{overviewCards.map((card) => <OverviewCard key={card.label} {...card} />)}</div>
          ) : <section className="admin-affiliate-panel"><AdminEmpty title="Overview unavailable" detail="Refresh to try loading the overview again." /></section>}
          <div className="admin-affiliate-overview-split">
            {loading.activity ? <><PanelSkeleton /><PanelSkeleton /></> : loaded.activity ? <>
              <RankingBars title="Top by paid customers" rows={activityData?.top_by_paid_customers} metric="paid_customers" formatter={(value) => integer.format(value || 0)} />
              <RankingBars title="Top by earned commission" rows={activityData?.top_by_earnings} metric="total_earned" formatter={(value) => money.format(value || 0)} />
            </> : <><section className="admin-affiliate-panel"><AdminEmpty title="Ranking data unavailable" /></section><section className="admin-affiliate-panel"><AdminEmpty title="Ranking data unavailable" /></section></>}
          </div>
        </div>
      )}

      {section === "affiliates" && (
        <section className="admin-affiliate-panel admin-affiliate-table-panel">
          <div className="admin-affiliate-section-heading"><div><span>Partner directory</span><h2>Affiliates</h2></div><small>{loading.affiliates && !loaded.affiliates ? "Loading accounts\u2026" : loaded.affiliates ? `${integer.format(accounts.total)} accounts` : "Accounts unavailable"}</small></div>
          <form className="admin-affiliate-filters is-accounts" onSubmit={(event) => { event.preventDefault(); setAccountFilters((current) => ({ ...current, page: 1 })); }}>
            <label className="is-search"><Search /><input value={accountFilters.search} onChange={(event) => setAccountFilters((current) => ({ ...current, search: event.target.value, page: 1 }))} placeholder="Referral code or masked email" /></label>
            <label><span>Status</span><select value={accountFilters.status} onChange={(event) => setAccountFilters((current) => ({ ...current, status: event.target.value, page: 1 }))}><option value="">All statuses</option><option value="active">Active</option><option value="suspended">Suspended</option></select></label>
            <label><span>Joined from</span><input type="date" value={accountFilters.date_from} onChange={(event) => setAccountFilters((current) => ({ ...current, date_from: event.target.value, page: 1 }))} /></label>
            <label><span>Joined to</span><input type="date" value={accountFilters.date_to} onChange={(event) => setAccountFilters((current) => ({ ...current, date_to: event.target.value, page: 1 }))} /></label>
          </form>
          <div className="admin-affiliate-table-wrap" role="region" aria-label="Affiliates table" tabIndex="0">
            {loading.affiliates ? <TableSkeleton columns={11} /> : !loaded.affiliates ? <AdminEmpty icon={Users} title="Affiliate data unavailable" detail="Refresh to try loading this directory again." /> : accounts.items?.length ? (
              <table className="admin-affiliate-table is-affiliate-directory">
                <thead><tr><th>Affiliate</th><th>Code</th><th>Joined</th><th>Status</th><th>Clicks</th><th>Signups</th><th>Paid</th><th>Pending</th><th>Available</th><th>Earned / Paid</th><th>Actions</th></tr></thead>
                <tbody>{accounts.items.map((account) => (
                  <tr key={account.id}>
                    <td><AffiliateIdentity displayName={account.display_name} maskedEmail={account.masked_email} /></td><td><code>{account.referral_code}</code></td><td>{formatDate(account.joined_at)}</td><td><StatusBadge value={account.status} /></td>
                    <td>{integer.format(account.clicks)}</td><td>{integer.format(account.signups)}</td><td>{integer.format(account.paid_customers)}</td><td>{money.format(account.pending_balance)}</td><td><strong>{money.format(account.available_balance)}</strong></td><td><strong>{money.format(account.total_earned)}</strong><small>{money.format(account.total_paid)} paid</small></td>
                    <td><div className="admin-affiliate-row-actions"><button type="button" onClick={() => setDrawerId(account.id)} aria-label={`View ${account.display_name || account.masked_email || "affiliate"}`}><Eye /></button><button type="button" className={account.status === "active" ? "is-danger" : "is-success"} onClick={() => openAccountStatus(account)} aria-label={account.status === "active" ? "Suspend affiliate" : "Reactivate affiliate"}>{account.status === "active" ? <PauseCircle /> : <PlayCircle />}</button></div></td>
                  </tr>
                ))}</tbody>
              </table>
            ) : <AdminEmpty icon={Users} title="No affiliates match these filters" detail="Try clearing the search or date range." />}
          </div>
          {loaded.affiliates && <Pagination data={accounts} onPage={(page) => setAccountFilters((current) => ({ ...current, page }))} onPageSize={(page_size) => setAccountFilters((current) => ({ ...current, page_size, page: 1 }))} />}
        </section>
      )}

      {section === "commissions" && (
        <section className="admin-affiliate-panel admin-affiliate-table-panel">
          <div className="admin-affiliate-section-heading"><div><span>Immutable ledger</span><h2>Commissions</h2></div><small>Amounts are view-only</small></div>
          <div className="admin-affiliate-filters is-sticky">
            <label className="is-search"><Search /><input value={commissionFilters.search} onChange={(event) => setCommissionFilters((current) => ({ ...current, search: event.target.value, page: 1 }))} placeholder="Affiliate or referral code" /></label>
            <label><span>Status</span><select value={commissionFilters.status} onChange={(event) => setCommissionFilters((current) => ({ ...current, status: event.target.value, page: 1 }))}><option value="">All statuses</option>{["pending", "available", "paid", "reversed"].map((item) => <option key={item} value={item}>{label(item)}</option>)}</select></label>
            <label><span>Plan</span><select value={commissionFilters.plan} onChange={(event) => setCommissionFilters((current) => ({ ...current, plan: event.target.value, page: 1 }))}><option value="">All plans</option>{["redbubble", "teepublic", "all_platforms"].map((item) => <option key={item} value={item}>{label(item)}</option>)}</select></label>
            <label><span>Payment</span><select value={commissionFilters.transaction_type} onChange={(event) => setCommissionFilters((current) => ({ ...current, transaction_type: event.target.value, page: 1 }))}><option value="">Initial + renewal</option><option value="initial">Initial</option><option value="renewal">Renewal</option></select></label>
            <label><span>From</span><input type="date" value={commissionFilters.date_from} onChange={(event) => setCommissionFilters((current) => ({ ...current, date_from: event.target.value, page: 1 }))} /></label>
            <label><span>To</span><input type="date" value={commissionFilters.date_to} onChange={(event) => setCommissionFilters((current) => ({ ...current, date_to: event.target.value, page: 1 }))} /></label>
          </div>
          <div className="admin-affiliate-table-wrap" role="region" aria-label="Commissions table" tabIndex="0">
            {loading.commissions ? <TableSkeleton columns={11} /> : !loaded.commissions ? <AdminEmpty title="Commission data unavailable" detail="Refresh to try loading the ledger again." /> : commissions.items?.length ? (
              <table className="admin-affiliate-table">
                <thead><tr><th>Date</th><th>Affiliate</th><th>Customer</th><th>Plan</th><th>Payment</th><th>Transaction</th><th>Gross</th><th>Commission</th><th>Status</th><th>Available</th><th>Reversal</th></tr></thead>
                <tbody>{commissions.items.map((item) => <tr key={item.id}><td>{formatDate(item.created_at)}</td><td><strong>{item.affiliate}</strong><small>{item.referral_code}</small></td><td>{item.referred_customer}</td><td>{label(item.plan)}</td><td>{label(item.transaction_type)}</td><td><code>{item.paddle_transaction_id}</code></td><td>{money.format(item.gross_amount)}</td><td><strong>{money.format(item.commission_amount)}</strong></td><td><StatusBadge value={item.status} /></td><td>{formatDate(item.hold_until)}</td><td>{item.reversal_reason || "—"}</td></tr>)}</tbody>
              </table>
            ) : <AdminEmpty title="No commissions match these filters" />}
          </div>
          {loaded.commissions && <Pagination data={commissions} onPage={(page) => setCommissionFilters((current) => ({ ...current, page }))} onPageSize={(page_size) => setCommissionFilters((current) => ({ ...current, page_size, page: 1 }))} />}
        </section>
      )}

      {section === "payouts" && (
        <section className="admin-affiliate-panel admin-affiliate-table-panel">
          <div className="admin-affiliate-section-heading"><div><span>Manual settlement queue</span><h2>Payout requests</h2></div><small>Every transition is audited</small></div>
          <div className="admin-affiliate-payout-tabs">{["requested", "approved", "paid", "rejected"].map((status) => <button key={status} type="button" className={payoutFilters.status === status ? "is-active" : ""} onClick={() => setPayoutFilters((current) => ({ ...current, status, page: 1 }))}>{label(status)}</button>)}</div>
          <div className="admin-affiliate-filters is-compact">
            <label className="is-search"><Search /><input value={payoutFilters.search} onChange={(event) => setPayoutFilters((current) => ({ ...current, search: event.target.value, page: 1 }))} placeholder="Affiliate or referral code" /></label>
            <label><span>From</span><input type="date" value={payoutFilters.date_from} onChange={(event) => setPayoutFilters((current) => ({ ...current, date_from: event.target.value, page: 1 }))} /></label>
            <label><span>To</span><input type="date" value={payoutFilters.date_to} onChange={(event) => setPayoutFilters((current) => ({ ...current, date_to: event.target.value, page: 1 }))} /></label>
          </div>
          <div className="admin-affiliate-table-wrap" role="region" aria-label="Payout requests table" tabIndex="0">
            {loading.payouts ? <TableSkeleton columns={10} /> : !loaded.payouts ? <AdminEmpty icon={Banknote} title="Payout data unavailable" detail="Refresh to try loading the settlement queue again." /> : payouts.items?.length ? (
              <table className="admin-affiliate-table">
                <thead><tr><th>Request date</th><th>Affiliate</th><th>Amount</th><th>Method</th><th>Available</th><th>Status</th><th>Reviewed</th><th>Admin note</th><th>Actions</th></tr></thead>
                <tbody>{payouts.items.map((item) => (
                  <tr key={item.id}><td>{formatDate(item.requested_at, true)}</td><td><strong>{item.affiliate}</strong><small>{item.referral_code}</small></td><td><strong>{money.format(item.amount)}</strong><small>{item.currency}</small></td><td><strong>{item.payout_method?.label}</strong><small>{item.payout_method?.summary}</small></td><td>{money.format(item.available_balance)}</td><td><StatusBadge value={item.status} /></td><td>{formatDate(item.reviewed_at, true)}</td><td>{item.admin_note || "—"}</td><td><div className="admin-affiliate-action-group">{item.status === "requested" && <button type="button" className="is-success" onClick={() => openPayoutAction(item, "approved")}>Approve</button>}{["requested", "approved"].includes(item.status) && <button type="button" className="is-danger" onClick={() => openPayoutAction(item, "rejected")}>Reject</button>}{item.status === "approved" && <button type="button" className="is-primary" onClick={() => openPayoutAction(item, "paid")}>Mark paid</button>}</div></td></tr>
                ))}</tbody>
              </table>
            ) : <AdminEmpty icon={Banknote} title={`No ${payoutFilters.status} payout requests`} />}
          </div>
          {loaded.payouts && <Pagination data={payouts} onPage={(page) => setPayoutFilters((current) => ({ ...current, page }))} onPageSize={(page_size) => setPayoutFilters((current) => ({ ...current, page_size, page: 1 }))} />}
        </section>
      )}

      {section === "activity" && (
        <div className="admin-affiliate-section-stack">
          {loading.activity ? <><div className="admin-affiliate-overview-split"><PanelSkeleton /><PanelSkeleton /></div><div className="admin-affiliate-activity-grid"><PanelSkeleton /><PanelSkeleton /><PanelSkeleton /></div></> : !loaded.activity ? <section className="admin-affiliate-panel"><AdminEmpty title="Referral activity unavailable" detail="Refresh to try loading recent activity again." /></section> : <>
            <div className="admin-affiliate-overview-split">
            <RankingBars title="Top by paid customers" rows={activityData?.top_by_paid_customers} metric="paid_customers" formatter={(value) => integer.format(value || 0)} />
            <RankingBars title="Top by earned commission" rows={activityData?.top_by_earnings} metric="total_earned" formatter={(value) => money.format(value || 0)} />
            </div>
            <div className="admin-affiliate-activity-grid">
            {[
              ["Recent clicks", MousePointerClick, activityData?.recent_clicks, (row) => [row.affiliate, row.landing_path, formatDate(row.created_at, true)]],
              ["Recent signups", UserPlus, activityData?.recent_signups, (row) => [row.affiliate, row.customer, formatDate(row.attributed_at, true)]],
              ["Recent paid referrals", BadgeDollarSign, activityData?.recent_paid_referrals, (row) => [row.affiliate, row.customer, `${money.format(row.commission_amount)} · ${formatDate(row.created_at)}`]],
            ].map(([title, Icon, rows, project]) => (
              <section className="admin-affiliate-panel admin-affiliate-feed" key={title}>
                <div className="admin-affiliate-section-heading"><div><span>Live trail</span><h2>{title}</h2></div><Icon /></div>
                {rows?.length ? rows.map((row) => { const values = project(row); return <div key={row.id}><span><Icon /></span><div><strong>{values[0]}</strong><small>{values[1]}</small></div><time>{values[2]}</time></div>; }) : <AdminEmpty icon={Icon} title="No activity yet" />}
              </section>
            ))}
            </div>
          </>}
        </div>
      )}

      {drawerId && <DetailDrawer data={drawerData} loading={drawerLoading} onClose={() => { setDrawerId(""); setDrawerData(null); }} onStatusAction={openAccountStatus} />}
      <ConfirmationModal confirmation={confirmation} note={note} setNote={setNote} submitting={submitting} onCancel={() => { setConfirmation(null); setNote(""); }} onConfirm={submitConfirmation} />
    </div>
  );
}
