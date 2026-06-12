// Welcome / onboarding card shown on the dashboard. It pulls the
// subscription summary from /api/me/subscription so the same card surfaces
// trial status, unlimited uploads, and AI token info without
// duplicating the BillingCard on the Profile page.

import { useCallback, useEffect, useState } from "react";

import { getMySubscription } from "../api/client";
import Icon from "./Icon";
import { Spinner } from "./LoadingComponents";

const STEPS = [
  { icon: "file", title: "Import your Excel file" },
  { icon: "images", title: "Upload your design images" },
  { icon: "edit", title: "Review and configure designs" },
  { icon: "puzzle", title: "Open the browser extension" },
  { icon: "upload", title: "Start uploading to Redbubble or TeePublic" },
];

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

function statusLabel(summary) {
  const status = String(summary?.status || "").toLowerCase();
  if (status === "trialing") return "Trial active";
  if (status === "active") return "Active subscription";
  if (status === "past_due") return "Payment issue";
  if (status === "paused") return "Paused";
  if (status === "canceled") return "Canceled";
  return status || "Inactive";
}

function formatPlanName(plan) {
  if (!plan) return "—";
  const planMap = {
    redbubble: "Redbubble Plan",
    teepublic: "TeePublic Plan",
    all_platforms: "All Platforms Plan",
  };
  const key = plan.toLowerCase();
  return planMap[key] || (plan[0].toUpperCase() + plan.slice(1));
}

export default function OnboardingCard({ onNavigate }) {
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);

  const fetchSummary = useCallback(async () => {
    try {
      const data = await getMySubscription();
      setSummary(data);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("[Onboarding] subscription fetch failed:", err?.message || err);
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

  const plan = summary?.plan;
  const limitReached = false;

  return (
    <section className="pp-onboarding-card">
      <div className="pp-onboarding-head">
        <div className="pp-onboarding-copy">
          <h2>Welcome to PodPilot</h2>
          <p>Import metadata, match images, and launch upload automation from one workspace.</p>
          {onNavigate && (
            <button
              type="button"
              className="pp-onboarding-primary"
              onClick={() => onNavigate("redbubble")}
            >
              <span>Import first batch</span>
              <Icon name="chevronRight" />
            </button>
          )}
        </div>
        {summary && !loading && (
          <div className="pp-onboarding-stats">
            <div>
              <span>Plan</span>
              <strong>{formatPlanName(plan)}</strong>
            </div>
            <div>
              <span>Status</span>
              <strong>{statusLabel(summary)}</strong>
            </div>
            <div>
              <span>Trial ends</span>
              <strong>{formatDate(summary?.trial_ends_at)}</strong>
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
        )}
        {loading && (
          <div className="pp-onboarding-stats pp-onboarding-stats-loading">
            <Spinner size="sm" />
            <span>Loading subscription...</span>
          </div>
        )}
      </div>

      {limitReached && (
        <div className="pp-onboarding-alert" role="status">
          <strong>Upload limit reached.</strong>
          <span>Upgrade your plan to continue uploading this month.</span>
          {onNavigate && (
            <button
              type="button"
              className="primary-button"
              onClick={() => onNavigate("profile")}
            >
              <span>Manage Billing</span>
              <Icon name="chevronRight" />
            </button>
          )}
        </div>
      )}

      <ol className="pp-onboarding-steps">
        {STEPS.map((step, index) => (
          <li key={step.title}>
            <span className="pp-onboarding-step-num">{index + 1}</span>
            <Icon name={step.icon} />
            <span>{step.title}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
