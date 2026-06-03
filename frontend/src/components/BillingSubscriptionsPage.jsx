import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BadgeDollarSign,
  CheckCircle2,
  CreditCard,
  ExternalLink,
  LockKeyhole,
  ReceiptText,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  WalletCards,
} from "lucide-react";

import { createBillingPortalSession, getMyPlatformAccess, getMySubscription } from "../api/client";
import { Spinner } from "./LoadingComponents";

const STATUS_LABELS = {
  active: "Active",
  trialing: "Trial active",
  inactive: "Inactive",
  canceled: "Canceled",
  cancelled: "Canceled",
  past_due: "Past due",
  paused: "Paused",
};

const PLAN_LABELS = {
  redbubble: "Redbubble",
  teepublic: "TeePublic",
  all_platforms: "All Platforms",
  growth: "All Platforms",
  starter: "Starter",
  pro: "Pro",
};

function formatDate(value) {
  if (!value) return "Not available";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not available";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function formatStatus(status) {
  return STATUS_LABELS[String(status || "").toLowerCase()] || "Inactive";
}

function planName(summary) {
  const plan = String(summary?.plan || "").toLowerCase();
  return PLAN_LABELS[plan] ? `${PLAN_LABELS[plan]} Plan` : "No active plan";
}

function inferBillingCycle(summary) {
  const cycle = String(summary?.billing_cycle || summary?.billingCycle || "").toLowerCase();
  if (cycle === "annual" || cycle === "yearly") return "Annual";
  if (cycle === "monthly") return "Monthly";
  return "Not available";
}

function formatMoney(value, currency = "USD") {
  if (value === undefined || value === null || value === "") return "Not available";
  const numeric = Number(value);
  if (Number.isNaN(numeric)) return String(value);
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: String(currency || "USD").toUpperCase(),
      maximumFractionDigits: numeric % 1 === 0 ? 0 : 2,
    }).format(numeric);
  } catch {
    return `$${numeric.toLocaleString()}`;
  }
}

function subscriptionPrice(summary) {
  const amount =
    summary?.price ||
    summary?.amount ||
    summary?.subscription_price ||
    summary?.unit_price ||
    summary?.recurring_amount;
  return formatMoney(amount, summary?.currency);
}

function platformAccessLabel(access, summary) {
  const plan = String(summary?.plan || access?.plan || "").toLowerCase();
  if (plan === "all_platforms" || plan === "growth") return "All Platforms";
  if (access?.redbubble && access?.teepublic) return "All Platforms";
  if (access?.redbubble) return "Redbubble";
  if (access?.teepublic) return "TeePublic";
  if (plan === "redbubble") return "Redbubble";
  if (plan === "teepublic") return "TeePublic";
  return "None";
}

function getPayments(summary) {
  const candidates = [
    summary?.payment_history,
    summary?.payments,
    summary?.transactions,
    summary?.recent_payments,
  ];
  return candidates.find((value) => Array.isArray(value)) || [];
}

function paymentAmount(payment) {
  return payment.amount || payment.total || payment.price || formatMoney(payment.value, payment.currency);
}

function statusTone(status) {
  const safeStatus = String(status || "inactive").toLowerCase();
  if (safeStatus === "active") return "active";
  if (safeStatus === "trialing") return "trialing";
  if (safeStatus === "past_due") return "past-due";
  if (safeStatus === "paused") return "past-due";
  if (safeStatus === "canceled" || safeStatus === "cancelled") return "canceled";
  return "inactive";
}

function BillingStatusBadge({ status }) {
  const tone = statusTone(status);
  return (
    <span className={`billing-status-pill billing-status-${tone}`}>
      <span aria-hidden="true" />
      {formatStatus(status)}
    </span>
  );
}

function BillingSkeleton() {
  return (
    <div className="billing-page" aria-busy="true">
      <section className="billing-hero billing-skeleton-shell">
        <span className="pp-skeleton-cell billing-skeleton-kicker" />
        <span className="pp-skeleton-cell billing-skeleton-title" />
        <span className="pp-skeleton-cell billing-skeleton-subtitle" />
      </section>
      <div className="billing-layout">
        <section className="billing-panel billing-plan-panel pp-skeleton-card">
          <span className="pp-skeleton-cell" />
          <span className="pp-skeleton-cell" />
          <span className="pp-skeleton-cell" />
          <span className="pp-skeleton-cell" />
        </section>
        <section className="billing-panel pp-skeleton-card">
          <span className="pp-skeleton-cell" />
          <span className="pp-skeleton-cell" />
          <span className="pp-skeleton-cell" />
        </section>
        <section className="billing-panel pp-skeleton-card">
          <span className="pp-skeleton-cell" />
          <span className="pp-skeleton-cell" />
        </section>
      </div>
    </div>
  );
}

function MetricTile({ label, value, detail }) {
  return (
    <div className="billing-metric-tile">
      <span>{label}</span>
      <strong>{value}</strong>
      {detail && <small>{detail}</small>}
    </div>
  );
}

function PlatformPill({ active, label }) {
  return (
    <span className={`billing-platform-pill${active ? " is-active" : ""}`}>
      {active ? <CheckCircle2 aria-hidden="true" /> : <LockKeyhole aria-hidden="true" />}
      {label}
    </span>
  );
}

export default function BillingSubscriptionsPage({
  initialSubscription = null,
  initialPlatformAccess = null,
}) {
  const [summary, setSummary] = useState(initialSubscription);
  const [platformAccess, setPlatformAccess] = useState(initialPlatformAccess);
  const [loading, setLoading] = useState(!initialSubscription);
  const [error, setError] = useState("");
  const [portalMessage, setPortalMessage] = useState("");
  const [openingPortal, setOpeningPortal] = useState("");

  const loadBilling = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [nextSummary, nextAccess] = await Promise.all([
        getMySubscription(),
        getMyPlatformAccess().catch(() => initialPlatformAccess),
      ]);
      setSummary(nextSummary || null);
      setPlatformAccess(nextAccess || null);
    } catch (err) {
      console.warn("[Billing] details load failed:", err?.message || err);
      setError("Could not load billing details. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [initialPlatformAccess]);

  useEffect(() => {
    void loadBilling();
  }, [loadBilling]);

  const status = String(summary?.status || "inactive").toLowerCase();
  const hasSubscription = Boolean(summary?.has_subscription);
  const hasActiveSubscription = Boolean(
    summary?.has_active_subscription ||
    summary?.trial_active ||
    status === "active" ||
    status === "trialing",
  );
  const portalAvailable = Boolean(summary?.paddle_customer_id);
  const payments = useMemo(() => getPayments(summary), [summary]);
  const dailyLimit = Number(summary?.daily_ai_tokens_limit ?? summary?.daily_ai_tokens ?? 0);
  const dailyRemaining = Number(summary?.daily_ai_tokens_remaining ?? summary?.daily_ai_tokens ?? 0);
  const dailyUsed = Number(summary?.daily_ai_tokens_used ?? Math.max(dailyLimit - dailyRemaining, 0));
  const dailyPercent = dailyLimit > 0 ? Math.min(100, Math.max(0, Math.round((dailyUsed / dailyLimit) * 100))) : 0;
  const extraTokens = Number(summary?.ai_tokens || 0);
  const platformLabel = platformAccessLabel(platformAccess, summary);
  const isEmptySubscription = !hasSubscription || !hasActiveSubscription;

  async function openPortal(action) {
    if (!portalAvailable) {
      setPortalMessage("Billing portal will be available after your subscription is synced.");
      return;
    }
    setOpeningPortal(action);
    setPortalMessage("");
    try {
      const data = await createBillingPortalSession();
      if (!data?.url) {
        setPortalMessage("Billing portal will be available after your subscription is synced.");
        return;
      }
      window.open(data.url, "_blank", "noopener,noreferrer");
    } catch (err) {
      const detail = err?.response?.data?.detail;
      console.warn("[Billing] portal action failed:", detail || err?.message || err);
      setPortalMessage("Billing portal will be available after your subscription is synced.");
    } finally {
      setOpeningPortal("");
    }
  }

  if (loading) return <BillingSkeleton />;

  if (error) {
    return (
      <div className="billing-page">
        <section className="billing-hero">
          <div>
            <span className="billing-kicker">Account billing</span>
            <h1>Billing & Subscriptions</h1>
            <p>Manage your plan, billing status, payment settings, and subscription access.</p>
          </div>
          <BillingStatusBadge status="inactive" />
        </section>
        <section className="billing-panel billing-state-panel" role="alert">
          <span className="billing-state-icon"><RefreshCw aria-hidden="true" /></span>
          <h2>Could not load billing details. Please try again.</h2>
          <button type="button" className="primary-button" onClick={loadBilling}>
            Retry
          </button>
        </section>
      </div>
    );
  }

  const planDetails = [
    ["Billing cycle", inferBillingCycle(summary)],
    ["Status", formatStatus(status)],
    ["Price", subscriptionPrice(summary)],
    ["Trial end date", status === "trialing" ? formatDate(summary?.trial_ends_at) : "Not applicable"],
    ["Next payment date", formatDate(summary?.next_payment_date || summary?.current_period_ends_at || summary?.current_period_end)],
    ["Renewal", summary?.cancel_at_period_end ? "Ends at period close" : "Renews automatically"],
  ];

  return (
    <div className="billing-page">
      <section className="billing-hero">
        <div>
          <span className="billing-kicker">Account billing</span>
          <h1>Billing & Subscriptions</h1>
          <p>Manage your plan, billing status, payment settings, and subscription access.</p>
        </div>
        <BillingStatusBadge status={status} />
      </section>

      {isEmptySubscription ? (
        <section className="billing-panel billing-no-subscription">
          <span className="billing-state-icon"><WalletCards aria-hidden="true" /></span>
          <div>
            <h2>You do not have an active subscription.</h2>
            <p>Choose a plan to unlock Redbubble and TeePublic workspaces, upload queues, and AI listing credits.</p>
          </div>
          <a className="primary-button" href="/pricing">
            View plans
            <ExternalLink aria-hidden="true" />
          </a>
        </section>
      ) : null}

      <div className="billing-layout">
        <section className="billing-panel billing-plan-panel">
          <div className="billing-panel-head">
            <span className="billing-panel-icon"><CreditCard aria-hidden="true" /></span>
            <div>
              <h2>Current plan</h2>
              <p>{isEmptySubscription ? "No active plan" : planName(summary)}</p>
            </div>
          </div>

          <div className="billing-plan-hero">
            <div>
              <span>Plan</span>
              <strong>{isEmptySubscription ? "Inactive" : planName(summary)}</strong>
            </div>
            <BillingStatusBadge status={status} />
          </div>

          <div className="billing-detail-grid">
            {planDetails.map(([label, value]) => (
              <div className="billing-detail-row" key={label}>
                <span>{label}</span>
                <strong>{value}</strong>
              </div>
            ))}
          </div>

          <div className="billing-access-block">
            <div>
              <h3>Platform access</h3>
              <p>{platformLabel}</p>
            </div>
            <div className="billing-platform-list">
              <PlatformPill active={Boolean(platformAccess?.redbubble)} label="Redbubble" />
              <PlatformPill active={Boolean(platformAccess?.teepublic)} label="TeePublic" />
            </div>
          </div>
        </section>

        <section className="billing-panel billing-usage-panel">
          <div className="billing-panel-head">
            <span className="billing-panel-icon"><Sparkles aria-hidden="true" /></span>
            <div>
              <h2>AI credits</h2>
              <p>Daily allowance and extra credit balance.</p>
            </div>
          </div>

          <div className="billing-token-grid">
            <MetricTile
              label="Daily remaining"
              value={dailyRemaining.toLocaleString()}
              detail={dailyLimit ? `${dailyLimit.toLocaleString()} daily limit` : "No daily allowance"}
            />
            <MetricTile
              label="Extra credits"
              value={extraTokens.toLocaleString()}
              detail="Purchased add-ons"
            />
          </div>

          <div className="billing-usage-meter" aria-label={`Daily AI usage ${dailyPercent}% used`}>
            <div>
              <span>Daily usage</span>
              <strong>{dailyUsed.toLocaleString()} used</strong>
            </div>
            <div className="billing-meter-track">
              <span style={{ width: `${dailyPercent}%` }} />
            </div>
          </div>

          <a className="billing-inline-cta" href="/pricing#ai-listing-credits">
            Buy more AI credits
            <ExternalLink aria-hidden="true" />
          </a>
        </section>

        <section className="billing-panel billing-actions-panel">
          <div className="billing-panel-head">
            <span className="billing-panel-icon"><BadgeDollarSign aria-hidden="true" /></span>
            <div>
              <h2>Billing actions</h2>
              <p>Secure changes are handled by Paddle.</p>
            </div>
          </div>

          <div className="billing-action-list">
            <a className="primary-button" href="/pricing">
              View plans
              <ExternalLink aria-hidden="true" />
            </a>
            {[
              ["manage", "Manage billing"],
              ["payment", "Update payment method"],
              ["cancel", "Cancel subscription"],
            ].map(([action, label]) => (
              <button
                type="button"
                className="secondary-button"
                key={action}
                onClick={() => openPortal(action)}
                disabled={!portalAvailable || Boolean(openingPortal)}
                aria-busy={openingPortal === action || undefined}
              >
                {openingPortal === action ? <Spinner size="sm" className="pp-spinner-on-button" /> : <WalletCards aria-hidden="true" />}
                <span>{label}</span>
              </button>
            ))}
          </div>

          {(!portalAvailable || portalMessage) && (
            <p className="billing-portal-note">
              {portalMessage || "Billing portal will be available after your subscription is synced."}
            </p>
          )}
        </section>

        <section className="billing-panel billing-history-panel">
          <div className="billing-panel-head">
            <span className="billing-panel-icon"><ReceiptText aria-hidden="true" /></span>
            <div>
              <h2>Payment history</h2>
              <p>Recent Paddle payments and receipts.</p>
            </div>
          </div>

          {payments.length > 0 ? (
            <div className="billing-payment-table" role="table" aria-label="Payment history">
              <div className="billing-payment-header" role="row">
                <span>Date</span>
                <span>Plan</span>
                <span>Amount</span>
                <span>Status</span>
                <span>Receipt</span>
              </div>
              {payments.slice(0, 6).map((payment, index) => (
                <div className="billing-payment-row" role="row" key={payment.id || payment.transaction_id || index}>
                  <span>{formatDate(payment.paid_at || payment.created_at || payment.date)}</span>
                  <strong>{payment.plan || payment.description || payment.title || planName(summary)}</strong>
                  <span>{paymentAmount(payment)}</span>
                  <span>{payment.status || "Paid"}</span>
                  {payment.receipt_url || payment.receiptUrl ? (
                    <a href={payment.receipt_url || payment.receiptUrl} target="_blank" rel="noopener noreferrer">
                      Open
                    </a>
                  ) : (
                    <span>Not available</span>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="billing-empty-history">
              <ReceiptText aria-hidden="true" />
              <div>
                <strong>No payment history yet.</strong>
                <span>Your Paddle payments and receipts will appear here when available.</span>
              </div>
            </div>
          )}
        </section>

        <section className="billing-panel billing-info-panel">
          <span className="billing-info-icon"><ShieldCheck aria-hidden="true" /></span>
          <div>
            <h2>Secure billing by Paddle</h2>
            <p>Plan changes, invoices, and payment methods are handled securely by Paddle.</p>
          </div>
        </section>
      </div>
    </div>
  );
}
