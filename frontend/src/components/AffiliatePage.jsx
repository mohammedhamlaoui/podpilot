import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowUpRight,
  BadgeDollarSign,
  Banknote,
  Check,
  ChevronRight,
  CircleDollarSign,
  Copy,
  CreditCard,
  Link2,
  MousePointerClick,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  UserPlus,
  Users,
  WalletCards,
} from "lucide-react";
import {
  createAffiliatePayoutRequest,
  getAffiliateDashboard,
  joinAffiliate,
  updateAffiliatePaymentSettings,
} from "../api/client";

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const number = new Intl.NumberFormat("en-US");

function formatDate(value, fallback = "—") {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(date);
}

function statusLabel(value) {
  return String(value || "pending").replace(/_/g, " ").replace(/^./, (letter) => letter.toUpperCase());
}

function AffiliateSkeleton() {
  return (
    <div className="affiliate-page" aria-busy="true">
      <div className="affiliate-skeleton affiliate-skeleton-hero" />
      <div className="affiliate-stat-grid">
        {Array.from({ length: 4 }).map((_, index) => <div className="affiliate-skeleton affiliate-skeleton-card" key={index} />)}
      </div>
    </div>
  );
}

function EmptyAffiliate({ onJoin, joining, error }) {
  return (
    <div className="affiliate-page affiliate-join-page">
      <section className="affiliate-join-card">
        <div className="affiliate-orbit" aria-hidden="true"><CircleDollarSign /><span /><span /></div>
        <span className="affiliate-eyebrow">PodPilot partner program</span>
        <h1>Turn your recommendation into recurring rewards.</h1>
        <p className="affiliate-join-lead">Earn $2 for every successful subscription payment made by a customer you refer.</p>
        <div className="affiliate-join-rules">
          <span><Check /> 30-day attribution window</span>
          <span><Check /> Initial payments and renewals</span>
          <span><Check /> No application or approval queue</span>
        </div>
        <button type="button" className="affiliate-primary-btn" onClick={onJoin} disabled={joining}>
          {joining ? <RefreshCw className="is-spinning" /> : <Sparkles />}
          {joining ? "Creating your link…" : "Join the affiliate program"}
        </button>
        {error && <p className="affiliate-form-error" role="alert">{error}</p>}
        <p className="affiliate-fine-print">AI credit purchases are excluded. Commissions hold for 30 days and may be reversed after refunds or chargebacks.</p>
      </section>
    </div>
  );
}

function MetricCard({ icon: Icon, label, value, detail, tone = "ink" }) {
  return (
    <article className={`affiliate-metric-card is-${tone}`}>
      <span className="affiliate-metric-icon"><Icon /></span>
      <div><span>{label}</span><strong>{value}</strong><small>{detail}</small></div>
    </article>
  );
}

export default function AffiliatePage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [copied, setCopied] = useState("");
  const [landingPath, setLandingPath] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [method, setMethod] = useState("paypal");
  const [settings, setSettings] = useState({ payout_email: "", account_name: "", iban: "", swift_code: "" });
  const [saving, setSaving] = useState(false);
  const [requesting, setRequesting] = useState(false);

  const load = useCallback(async () => {
    setError("");
    try {
      setData(await getAffiliateDashboard());
    } catch (requestError) {
      setError(requestError?.response?.data?.detail || "Could not load your affiliate dashboard.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const handleJoin = async () => {
    setJoining(true);
    setError("");
    try {
      await joinAffiliate();
      await load();
    } catch (requestError) {
      setError(requestError?.response?.data?.detail || "Could not join the affiliate program.");
    } finally {
      setJoining(false);
    }
  };

  const customLink = useMemo(() => {
    const code = data?.profile?.referral_code;
    if (!code) return "";
    const value = landingPath.trim();
    const path = value.startsWith("/") && !value.startsWith("//") ? value.split(/[?#]/)[0] : "/";
    const url = new URL(path || "/", "https://podpilot.space");
    url.searchParams.set("ref", code);
    return url.toString();
  }, [data?.profile?.referral_code, landingPath]);

  const copy = async (value, key) => {
    await navigator.clipboard.writeText(value);
    setCopied(key);
    window.setTimeout(() => setCopied(""), 1800);
  };

  const saveSettings = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      await updateAffiliatePaymentSettings({ payout_method: method, ...settings });
      setSettings({ payout_email: "", account_name: "", iban: "", swift_code: "" });
      setSettingsOpen(false);
      setNotice("Payment settings saved securely.");
      await load();
    } catch (requestError) {
      setError(requestError?.response?.data?.detail || "Could not save payment settings.");
    } finally {
      setSaving(false);
    }
  };

  const requestPayout = async () => {
    const amount = Number(data?.balances?.available || 0);
    setRequesting(true);
    setError("");
    try {
      await createAffiliatePayoutRequest(amount);
      setNotice(`${money.format(amount)} payout request submitted for manual review.`);
      await load();
    } catch (requestError) {
      setError(requestError?.response?.data?.detail || "Could not submit payout request.");
    } finally {
      setRequesting(false);
    }
  };

  if (loading) return <AffiliateSkeleton />;
  if (!data?.joined) return <EmptyAffiliate onJoin={handleJoin} joining={joining} error={error} />;

  const { profile, balances, metrics, commissions = [], referrals = [], payouts = [] } = data;
  const openPayout = payouts.some((payout) => ["requested", "approved"].includes(payout.status));
  const canRequest = balances.available >= 20 && profile.payment_settings_complete && !openPayout;

  return (
    <div className="affiliate-page">
      <section className="affiliate-hero">
        <div className="affiliate-hero-copy">
          <div className="affiliate-title-row">
            <span className="affiliate-eyebrow">Affiliate studio</span>
            <span className={`affiliate-status is-${profile.status}`}><span />{statusLabel(profile.status)}</span>
          </div>
          <h1>Share PodPilot.<br /><em>Earn on every payment.</em></h1>
          <p>Earn $2 for every successful subscription payment made by a customer you refer.</p>
        </div>
        <div className="affiliate-link-card">
          <span>Your referral link</span>
          <div className="affiliate-link-value"><strong>{profile.referral_url}</strong><button type="button" onClick={() => copy(profile.referral_url, "main")}><Copy />{copied === "main" ? "Copied" : "Copy"}</button></div>
          <div className="affiliate-code-row"><span>Code</span><code>{profile.referral_code}</code><small>30-day attribution</small></div>
        </div>
      </section>

      {(notice || error) && <div className={`affiliate-notice ${error ? "is-error" : "is-success"}`} role={error ? "alert" : "status"}>{error || notice}<button type="button" onClick={() => { setError(""); setNotice(""); }}>×</button></div>}

      <section className="affiliate-balance-strip">
        <MetricCard icon={WalletCards} label="Available balance" value={money.format(balances.available)} detail={balances.reserved ? `${money.format(balances.reserved)} reserved` : "$20 minimum payout"} tone="emerald" />
        <MetricCard icon={RefreshCw} label="Pending balance" value={money.format(balances.pending)} detail="In the 30-day holding period" tone="amber" />
        <MetricCard icon={BadgeDollarSign} label="Total earnings" value={money.format(balances.total_earnings)} detail="Valid commissions to date" tone="violet" />
        <MetricCard icon={Banknote} label="Total paid" value={money.format(balances.total_paid)} detail="Manually completed payouts" />
      </section>

      <div className="affiliate-main-grid">
        <div className="affiliate-main-column">
          <section className="affiliate-panel affiliate-performance-panel">
            <div className="affiliate-panel-heading"><div><span>Performance</span><h2>Your referral funnel</h2></div><small>All time</small></div>
            <div className="affiliate-funnel">
              <div><MousePointerClick /><strong>{number.format(metrics.clicks)}</strong><span>Clicks</span></div><ChevronRight />
              <div><UserPlus /><strong>{number.format(metrics.signups)}</strong><span>Signups</span></div><ChevronRight />
              <div><CreditCard /><strong>{number.format(metrics.paid_referrals)}</strong><span>Paid referrals</span></div>
              <div className="affiliate-conversion"><strong>{metrics.conversion_rate}%</strong><span>Visit → signup</span></div>
            </div>
          </section>

          <section className="affiliate-panel">
            <div className="affiliate-panel-heading"><div><span>Commission ledger</span><h2>Recent commissions</h2></div><small>{commissions.length} transactions</small></div>
            <div className="affiliate-table-wrap">
              <table className="affiliate-table">
                <thead><tr><th>Date</th><th>Customer</th><th>Plan</th><th>Payment</th><th>Transaction</th><th>Commission</th><th>Status</th><th>Available</th></tr></thead>
                <tbody>
                  {commissions.slice(0, 20).map((item) => (
                    <tr key={item.id}>
                      <td>{formatDate(item.created_at)}</td><td>{item.referred_customer}</td><td><span className="affiliate-plan-pill">{statusLabel(item.plan)}</span></td>
                      <td>{item.transaction_type === "renewal" ? "Renewal" : "Initial"}</td><td>{money.format(item.gross_amount)}</td><td><strong>{money.format(item.commission_amount)}</strong></td>
                      <td><span className={`affiliate-table-status is-${item.status}`}>{statusLabel(item.status)}</span></td><td>{formatDate(item.hold_until)}</td>
                    </tr>
                  ))}
                  {!commissions.length && <tr><td colSpan="8"><div className="affiliate-empty"><CircleDollarSign /><strong>Your first commission will appear here.</strong><span>Share your referral link to get started.</span></div></td></tr>}
                </tbody>
              </table>
            </div>
          </section>

          <section className="affiliate-panel">
            <div className="affiliate-panel-heading"><div><span>Customers</span><h2>Referred users</h2></div><small>Privacy-safe identifiers</small></div>
            <div className="affiliate-referral-list">
              {referrals.slice(0, 12).map((referral) => <div key={referral.id}><span className="affiliate-avatar">{referral.customer.slice(0, 1).toUpperCase()}</span><div><strong>{referral.customer}</strong><small>Joined {formatDate(referral.attributed_at)}</small></div><span className={`affiliate-paid-dot ${referral.has_paid ? "is-paid" : ""}`}>{referral.has_paid ? "Paid customer" : "Awaiting payment"}</span></div>)}
              {!referrals.length && <div className="affiliate-empty compact"><Users /><strong>No referred users yet.</strong></div>}
            </div>
          </section>
        </div>

        <aside className="affiliate-side-column">
          <section className="affiliate-panel affiliate-payout-panel">
            <span className="affiliate-panel-icon"><CircleDollarSign /></span><span className="affiliate-eyebrow">Ready to withdraw</span>
            <strong className="affiliate-payout-amount">{money.format(balances.available)}</strong>
            <div className="affiliate-payout-progress"><span style={{ width: `${Math.min((balances.available / 20) * 100, 100)}%` }} /></div>
            <small>{balances.available >= 20 ? "Minimum reached" : `${money.format(20 - balances.available)} until payout`}</small>
            <button type="button" className="affiliate-primary-btn" onClick={handleRequestPayout} disabled={!canRequest || requesting}>{requesting ? <RefreshCw className="is-spinning" /> : <ArrowUpRight />}{openPayout ? "Payout under review" : requesting ? "Submitting…" : "Request payout"}</button>
            {!profile.payment_settings_complete && <button type="button" className="affiliate-text-btn" onClick={() => setSettingsOpen(true)}>Add payment settings</button>}
          </section>

          <section className="affiliate-panel affiliate-generator">
            <span className="affiliate-panel-icon"><Link2 /></span><h2>Link generator</h2><p>Send customers to a specific PodPilot page. Only PodPilot paths are allowed.</p>
            <label>Landing page path<input value={landingPath} onChange={(event) => setLandingPath(event.target.value)} placeholder="/pricing" /></label>
            <div className="affiliate-generated-link"><span>{customLink}</span><button type="button" onClick={() => copy(customLink, "custom")} aria-label="Copy custom link">{copied === "custom" ? <Check /> : <Copy />}</button></div>
          </section>

          <section className="affiliate-panel affiliate-settings-summary">
            <div className="affiliate-panel-heading"><div><span>Payout method</span><h2>Payment settings</h2></div><ShieldCheck /></div>
            {profile.payment_settings_complete ? <div className="affiliate-saved-method"><strong>{profile.payout_method === "paypal" ? "PayPal" : "Bank transfer"}</strong><span>{profile.payout_method === "paypal" ? profile.payout_email : `${profile.account_name || "Account"} · ${profile.iban}`}</span></div> : <p>No payment method saved yet.</p>}
            <button type="button" className="affiliate-secondary-btn" onClick={() => setSettingsOpen((current) => !current)}>{profile.payment_settings_complete ? "Update settings" : "Add payment method"}</button>
            {settingsOpen && (
              <form className="affiliate-settings-form" onSubmit={saveSettings}>
                <div className="affiliate-method-toggle"><button type="button" className={method === "paypal" ? "is-active" : ""} onClick={() => setMethod("paypal")}>PayPal</button><button type="button" className={method === "bank_transfer" ? "is-active" : ""} onClick={() => setMethod("bank_transfer")}>Bank transfer</button></div>
                {method === "paypal" ? <label>PayPal email<input type="email" required value={settings.payout_email} onChange={(e) => setSettings({ ...settings, payout_email: e.target.value })} autoComplete="email" /></label> : <><label>Account name<input required value={settings.account_name} onChange={(e) => setSettings({ ...settings, account_name: e.target.value })} autoComplete="name" /></label><label>IBAN<input required value={settings.iban} onChange={(e) => setSettings({ ...settings, iban: e.target.value })} autoComplete="off" /></label><label>SWIFT / BIC<input required value={settings.swift_code} onChange={(e) => setSettings({ ...settings, swift_code: e.target.value })} autoComplete="off" /></label></>}
                <button type="submit" className="affiliate-primary-btn" disabled={saving}>{saving ? "Saving…" : "Save securely"}</button>
              </form>
            )}
          </section>

          <section className="affiliate-panel affiliate-terms-card">
            <h2>Program essentials</h2><ul><li><span>30</span> day attribution cookie</li><li><span>30</span> day commission hold</li><li><span>$20</span> minimum payout</li><li><span>$2</span> per subscription payment</li></ul>
            <p>AI credit purchases are excluded. Refunds and chargebacks may reverse commissions.</p>
          </section>
        </aside>
      </div>

      <section className="affiliate-panel affiliate-payout-history">
        <div className="affiliate-panel-heading"><div><span>Withdrawals</span><h2>Payout history</h2></div><small>Paid manually after admin review</small></div>
        {payouts.length ? <div className="affiliate-payout-list">{payouts.map((payout) => <div key={payout.id}><span className={`affiliate-table-status is-${payout.status}`}>{statusLabel(payout.status)}</span><strong>{money.format(payout.amount)}</strong><span>Requested {formatDate(payout.requested_at)}</span><span>{payout.paid_at ? `Paid ${formatDate(payout.paid_at)}` : "USD"}</span></div>)}</div> : <div className="affiliate-empty compact"><Banknote /><strong>No payout requests yet.</strong></div>}
      </section>
    </div>
  );
}
