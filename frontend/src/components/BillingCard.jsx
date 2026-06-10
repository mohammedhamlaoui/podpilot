// Subscription / billing card. Shows the current plan, status, trial /
// period dates, AI tokens, and a "Manage Billing" button that opens the
// Paddle customer-portal session (the URL is created by the backend).

import { useCallback, useEffect, useState } from "react";

import { getMySubscription, createBillingPortalSession } from "../api/client";
import { Spinner } from "./LoadingComponents";
import Icon from "./Icon";

function formatDate(value) {
  if (!value) return "—";
  try {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return "—";
    return d.toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return "—";
  }
}

function statusBadge(status) {
  switch ((status || "").toLowerCase()) {
    case "trialing": return { label: "Trial active", tone: "info" };
    case "active":   return { label: "Active subscription", tone: "success" };
    case "past_due": return { label: "Payment issue", tone: "danger" };
    case "paused":   return { label: "Paused", tone: "warning" };
    case "canceled": return { label: "Canceled", tone: "warning" };
    default:         return { label: status || "Inactive", tone: "warning" };
  }
}

function formatPlanName(plan) {
  if (!plan || plan === "—") return "—";
  const planMap = {
    redbubble: "Redbubble Plan",
    teepublic: "TeePublic Plan",
    all_platforms: "All Platforms Plan",
  };
  const key = plan.toLowerCase();
  return planMap[key] || (plan[0].toUpperCase() + plan.slice(1));
}

export default function BillingCard() {
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [openingPortal, setOpeningPortal] = useState(false);
  const [error, setError] = useState("");

  const fetchSummary = useCallback(async () => {
    try {
      const data = await getMySubscription();
      setSummary(data);
      setError("");
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("[Billing] fetch summary failed:", err?.message || err);
      setError("Could not load your billing details.");
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchSummary().finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [fetchSummary]);

  async function handleManageBilling() {
    if (openingPortal) return;
    setOpeningPortal(true);
    setError("");
    try {
      const data = await createBillingPortalSession();
      const url = data?.url;
      if (!url) {
        setError("Paddle did not return a portal URL.");
        return;
      }
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (err) {
      const detail = err?.response?.data?.detail;
      // eslint-disable-next-line no-console
      console.warn("[Billing] portal open failed:", detail || err?.message || err);
      setError(typeof detail === "string" && detail
        ? detail
        : "Could not open the billing portal. Please try again.");
    } finally {
      setOpeningPortal(false);
    }
  }

  if (loading) {
    return (
      <div className="profile-card billing-card">
        <div className="profile-card-header">
          <Icon name="queue" className="profile-card-icon" />
          <h3>Billing</h3>
        </div>
        <div className="profile-card-body">
          <Spinner size="sm" />
          <span style={{ marginLeft: 8 }}>Loading billing...</span>
        </div>
      </div>
    );
  }

  const plan = summary?.plan || "—";
  const badge = statusBadge(summary?.status);
  const hasCustomer = Boolean(summary?.paddle_customer_id);
  const isPastDue = String(summary?.status || "").toLowerCase() === "past_due";
  const cancelAtPeriodEnd = Boolean(summary?.cancel_at_period_end);
  const periodEndsAt = formatDate(summary?.current_period_ends_at);

  return (
    <div className="profile-card billing-card account-settings-card">
      <div className="profile-card-header">
        <Icon name="queue" className="profile-card-icon" />
        <h3>Billing</h3>
        <span className={`profile-badge billing-badge billing-badge-${badge.tone}`}>
          {badge.label}
        </span>
      </div>

      {isPastDue && (
        <div className="billing-alert billing-alert-danger" role="alert">
          Payment issue. Please manage billing to update your card.
        </div>
      )}
      {cancelAtPeriodEnd && (
        <div className="billing-alert billing-alert-warning">
          Your subscription will end on {periodEndsAt}.
        </div>
      )}

      <div className="billing-grid">
        <div>
          <span>Plan</span>
          <strong>{formatPlanName(plan)}</strong>
        </div>
        <div>
          <span>Status</span>
          <strong>{summary?.status || "inactive"}</strong>
        </div>
        <div>
          <span>Trial ends</span>
          <strong>{formatDate(summary?.trial_ends_at)}</strong>
        </div>
        <div>
          <span>Period ends</span>
          <strong>{periodEndsAt}</strong>
        </div>
        <div>
          <span>Uploads</span>
          <strong>{summary?.has_subscription ? "Unlimited" : "—"}</strong>
        </div>
        <div>
          <span>Daily AI Tokens</span>
          <strong>{summary?.has_subscription ? `${summary?.daily_ai_tokens_remaining ?? 0} / ${summary?.daily_ai_tokens_limit ?? 0}` : "—"}</strong>
        </div>
        <div>
          <span>Extra AI Tokens</span>
          <strong>{summary?.has_subscription ? (summary?.ai_tokens || 0).toLocaleString() : "—"}</strong>
        </div>
      </div>

      {error && <div className="billing-alert billing-alert-danger">{error}</div>}

      <div className="billing-actions">
        <button
          type="button"
          className="profile-btn"
          onClick={handleManageBilling}
          disabled={openingPortal || !hasCustomer}
          aria-busy={openingPortal || undefined}
          title={!hasCustomer ? "No Paddle customer found yet." : "Open the Paddle customer portal"}
        >
          {openingPortal && <Spinner size="sm" className="pp-spinner-on-button" />}
          <span>{openingPortal ? "Opening portal..." : "Manage Billing"}</span>
        </button>
      </div>
    </div>
  );
}
