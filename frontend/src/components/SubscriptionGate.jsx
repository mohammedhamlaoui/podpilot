// PodPilot subscription gate.
//
// Wraps the protected dashboard. While the access check is pending, or
// while a post-checkout verification is running, we show a loading state.
// Children render once the access check completes. Unpaid users enter the
// app in preview mode; premium actions are locked in-page.
//
// "Allowed" means the backend says the user is on a current trial / active
// subscription, OR they're canceled but still inside the paid period.
// Hitting the upload limit does NOT lock the dashboard — it's surfaced
// elsewhere (Billing card, Upload button) so users can still see their
// data.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useAuth } from "../auth/AuthContext";
import { getMySubscription, createBillingPortalSession, getTrialEligibility, startTrialCheckout } from "../api/client";
import { openPaddleCheckout, isPaddleConfigured, isPaidPaddleConfigured } from "../lib/paddle";
import { Spinner } from "./LoadingComponents";
import Icon from "./Icon";

const POLL_INTERVAL_MS = 1500;
const POLL_DURATION_MS = 30000; // 30 seconds total per spec
const CHECKOUT_QUERY_KEY = "checkout";
const CHECKOUT_QUERY_VALUE = "success";

const PLAN_CARDS = [
  {
    planId: "redbubble",
    name: "Redbubble Plan",
    price: "$4.99",
    perks: [
      "3-day free trial",
      "Unlimited Redbubble uploads",
      "AI Listing Content",
      "AI Copyright Check",
      "Trademark Check",
      "30 Daily AI Tokens",
      "24/7 Support",
    ],
  },
  {
    planId: "all_platforms",
    name: "All Platforms Plan",
    price: "$6.99",
    perks: [
      "3-day free trial",
      "Unlimited Redbubble + TeePublic uploads",
      "AI Listing Content",
      "AI Copyright Check",
      "Trademark Check",
      "75 Daily AI Tokens",
      "24/7 Priority Support",
    ],
    featured: true,
  },
  {
    planId: "teepublic",
    name: "TeePublic Plan",
    price: "$4.99",
    perks: [
      "3-day free trial",
      "Unlimited TeePublic uploads",
      "AI Listing Content",
      "AI Copyright Check",
      "Trademark Check",
      "30 Daily AI Tokens",
      "24/7 Support",
    ],
  },
];

function readCheckoutFlag() {
  try {
    const params = new URLSearchParams(window.location.search);
    return params.get(CHECKOUT_QUERY_KEY) === CHECKOUT_QUERY_VALUE;
  } catch {
    return false;
  }
}

function clearCheckoutFlagFromUrl() {
  try {
    const url = new URL(window.location.href);
    url.searchParams.delete(CHECKOUT_QUERY_KEY);
    window.history.replaceState(null, "", url.pathname + url.search + url.hash);
  } catch {
    /* noop */
  }
}

function isAllowed(summary) {
  if (!summary) return false;
  // Per spec: any of the following four conditions are sufficient.
  // 1) can_upload === true
  if (summary.can_upload === true) return true;
  // 2 & 3) has_subscription AND status is trialing or active
  const status = String(summary.status || "").toLowerCase();
  if (summary.has_subscription === true && (status === "trialing" || status === "active")) {
    return true;
  }
  // 4) canceled but current period still in the future
  if (status === "canceled" && summary.current_period_ends_at) {
    const end = Date.parse(summary.current_period_ends_at);
    if (Number.isFinite(end) && end > Date.now()) return true;
  }
  return false;
}

function isBillingIssue(summary) {
  const status = String(summary?.status || "").toLowerCase();
  return status === "past_due" || status === "paused";
}

function isUploadLimitReached(summary) {
  // We allow trialing/active users into the dashboard even when they've
  // hit their monthly limit. This helper exists so the UI can flag it.
  if (!summary) return false;
  const status = String(summary.status || "").toLowerCase();
  if (status !== "trialing" && status !== "active") return false;
  const reason = String(summary.reason || "").toLowerCase();
  return reason.includes("upload limit") || reason.includes("limit reached");
}

export default function SubscriptionGate({ children, onSignOut }) {
  const auth = useAuth();
  const userId = auth?.user?.id || "";
  const userEmail = auth?.user?.email || "";

  const initialCheckoutFlag = useMemo(() => readCheckoutFlag(), []);
  // Modes: "init" → pre-fetch placeholder, "verifying" → post-checkout poll,
  //        "checking" → quick one-shot fetch, "ready" → render children,
  //        "stillVerifying" → friendly waiting screen with Retry,
  //        "locked"   → pricing cards.
  const [mode, setMode] = useState(initialCheckoutFlag ? "verifying" : "init");
  const [summary, setSummary] = useState(null);
  const [openingPlan, setOpeningPlan] = useState(null);
  const [openingPortal, setOpeningPortal] = useState(false);
  const [error, setError] = useState("");
  const [trialEligibility, setTrialEligibility] = useState(null);
  const trialEligible = trialEligibility?.eligible !== false;

  // Refs let us reason about the latest mode/summary inside async callbacks
  // without re-creating effects every time those values change.
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const initialCheckDoneRef = useRef(false);

  useEffect(() => {
    if (!userId) {
      setTrialEligibility(null);
      return undefined;
    }
    let cancelled = false;
    getTrialEligibility()
      .then((data) => {
        if (!cancelled) setTrialEligibility(data || null);
      })
      .catch((err) => {
        if (!cancelled) {
          console.warn("[Billing] trial eligibility failed:", err?.message || err);
          setTrialEligibility(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const fetchSummary = useCallback(async () => {
    try {
      const data = await getMySubscription();
      setSummary(data);
      // eslint-disable-next-line no-console
      console.log(
        "[SubscriptionGate] response can_upload=" + Boolean(data?.can_upload) +
        " status=" + (data?.status || "(none)") +
        " has_subscription=" + Boolean(data?.has_subscription)
      );
      // eslint-disable-next-line no-console
      console.log("[SubscriptionGate] subscription response=", data);
      const allowed = isAllowed(data);
      const limitReached = isUploadLimitReached(data);
      // eslint-disable-next-line no-console
      console.log(
        `[SubscriptionGate] allowed=${allowed} reason=${data?.reason || "(none)"}`,
      );
      // eslint-disable-next-line no-console
      console.log(`[SubscriptionGate] upload limit reached=${limitReached}`);
      return data;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(
        "[SubscriptionGate] /api/me/subscription failed:",
        err?.response?.status || "",
        err?.message || err,
      );
      return null;
    }
  }, []);

  // ── One-time initial check (runs after Supabase has resolved a user). ──
  // Skipped entirely when we land in "verifying" mode (URL ?checkout=success)
  // because the verifying effect handles the fetch itself.
  useEffect(() => {
    if (initialCheckDoneRef.current) return;
    if (modeRef.current === "verifying") return;
    if (!userId) return; // wait for Supabase to hydrate the user
    initialCheckDoneRef.current = true;
    setMode("checking");
    // eslint-disable-next-line no-console
    console.log(`[SubscriptionGate] current user id=${userId}`);
    fetchSummary().then((data) => {
      if (isAllowed(data)) {
        // eslint-disable-next-line no-console
        console.log("[SubscriptionGate] allowed=true, rendering dashboard");
      } else {
        // eslint-disable-next-line no-console
        console.log("[SubscriptionGate] allowed=false, rendering preview dashboard");
      }
      setMode("ready");
    });
  }, [userId, fetchSummary]);

  // ── Post-checkout verification polling. Runs only while mode==="verifying". ──
  useEffect(() => {
    if (mode !== "verifying") return undefined;
    // eslint-disable-next-line no-console
    console.log("[SubscriptionGate] checkout success mode=true");
    // eslint-disable-next-line no-console
    console.log(`[SubscriptionGate] current user id=${userId || "(pending)"}`);
    let cancelled = false;
    let intervalId = null;
    let timeoutId = null;
    const stop = () => {
      if (intervalId) window.clearInterval(intervalId);
      if (timeoutId) window.clearTimeout(timeoutId);
      intervalId = null;
      timeoutId = null;
    };
    const tick = async () => {
      // Wait for Supabase auth to hydrate before hitting a 401.
      if (!userId) return;
      const data = await fetchSummary();
      if (cancelled) return;
      if (isAllowed(data)) {
        clearCheckoutFlagFromUrl();
        // eslint-disable-next-line no-console
        console.log("[SubscriptionGate] allowed=true, rendering dashboard");
        stop();
        initialCheckDoneRef.current = true;
        setMode("ready");
      }
    };
    tick();
    intervalId = window.setInterval(tick, POLL_INTERVAL_MS);
    timeoutId = window.setTimeout(() => {
      if (cancelled) return;
      stop();
      clearCheckoutFlagFromUrl();
      initialCheckDoneRef.current = true;
      setMode("stillVerifying");
    }, POLL_DURATION_MS);
    return () => {
      cancelled = true;
      stop();
    };
  }, [mode, fetchSummary, userId]);

  async function handleRetryCheck() {
    setError("");
    const data = await fetchSummary();
    if (isAllowed(data)) {
      // eslint-disable-next-line no-console
      console.log("[SubscriptionGate] allowed=true, rendering dashboard");
      setMode("ready");
    } else {
      setMode("ready");
    }
  }

  async function handleStartCheckout(planId) {
    if (!planId) return;
    const urlPlan = planId === "all_platforms" ? "all-platforms" : planId;
    window.location.href = `/checkout?plan=${urlPlan}&billing=monthly`;
  }

  async function handleManageBilling() {
    if (openingPortal) return;
    setOpeningPortal(true);
    setError("");
    try {
      const data = await createBillingPortalSession();
      const url = data?.url;
      if (!url) {
        setError("Paddle did not return a portal URL. Please try again.");
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

  // ── Rendering ────────────────────────────────────────────────────────────

  if (mode === "init" || mode === "checking") {
    return (
      <div className="pp-page-loader" role="status" aria-live="polite">
        <Spinner size="lg" />
        <span>Checking your subscription...</span>
      </div>
    );
  }

  if (mode === "verifying") {
    return (
      <div className="pp-page-loader" role="status" aria-live="polite">
        <Spinner size="lg" />
        <strong style={{ fontWeight: 600, color: "var(--pp-text)" }}>
          Verifying your subscription...
        </strong>
        <span>Hang tight while we confirm your payment.</span>
      </div>
    );
  }

  if (mode === "ready") {
    return children;
  }

  if (mode === "stillVerifying") {
    return (
      <div className="pp-locked-shell">
        <div className="pp-locked-card pp-locked-card-narrow">
          <div className="pp-locked-head">
            <h1>Almost there</h1>
            <p>We are still verifying your subscription. Please refresh in a moment.</p>
          </div>
          {error && <div className="pp-locked-error">{error}</div>}
          <div className="pp-locked-actions">
            <button
              type="button"
              className="primary-button"
              onClick={handleRetryCheck}
            >
              <span>Retry</span>
            </button>
            <button
              type="button"
              className="secondary-button"
              onClick={() => setMode("locked")}
            >
              <span>Choose a plan</span>
            </button>
          </div>
          <div className="pp-locked-foot">
            <a href="/" className="pp-locked-link">Back to homepage</a>
            <button type="button" className="pp-locked-link" onClick={onSignOut}>
              Sign out
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (mode === "billingIssue") {
    return (
      <div className="pp-locked-shell">
        <div className="pp-locked-card pp-locked-card-narrow">
          <div className="pp-locked-head">
            <h1>Payment issue</h1>
            <p>Please manage billing to continue using PodPilot.</p>
            <small className="pp-locked-note">
              {summary?.reason || "We could not confirm a recent payment."}
            </small>
          </div>
          {error && <div className="pp-locked-error">{error}</div>}
          <div className="pp-locked-actions">
            <button
              type="button"
              className="primary-button"
              onClick={handleManageBilling}
              disabled={openingPortal}
              aria-busy={openingPortal || undefined}
            >
              {openingPortal && <Spinner size="sm" className="pp-spinner-on-button" />}
              <span>{openingPortal ? "Opening portal..." : "Manage Billing"}</span>
            </button>
          </div>
          <div className="pp-locked-foot">
            <a href="/" className="pp-locked-link">Back to homepage</a>
            <button type="button" className="pp-locked-link" onClick={onSignOut}>
              Sign out
            </button>
          </div>
        </div>
      </div>
    );
  }

  // mode === "locked"

  const reason = summary?.reason || "Choose a plan to continue.";

  return (
    <div className="pp-locked-shell">
      <div className="pp-locked-card">
        <div className="pp-locked-head">
          <h1>Choose a plan to continue</h1>
          <p>{trialEligible ? "Start your 3-day free trial to unlock PodPilot." : "Choose a plan to unlock PodPilot."}</p>
          <small className="pp-locked-note">{reason}</small>
        </div>

        {error && <div className="pp-locked-error">{error}</div>}

        <div className="pp-locked-plans">
          {PLAN_CARDS.map((plan) => {
            const isLoading = openingPlan === plan.planId;
            const disabled = Boolean(openingPlan) && !isLoading;
            return (
              <article
                key={plan.planId}
                className={`pp-locked-plan${plan.featured ? " is-featured" : ""}`}
              >
                <header>
                  <h3>{plan.name}</h3>
                  <strong>{plan.price}<span>/month</span></strong>
                </header>
                <ul>
                  {(trialEligible ? plan.perks : plan.perks.filter((perk) => !perk.toLowerCase().includes("free trial"))).map((perk) => (
                    <li key={perk}>
                      <Icon name="check" />
                      <span>{perk}</span>
                    </li>
                  ))}
                </ul>
                <button
                  type="button"
                  className="primary-button"
                  onClick={() => handleStartCheckout(plan.planId)}
                  disabled={disabled || isLoading}
                  aria-busy={isLoading || undefined}
                >
                  {isLoading && <Spinner size="sm" className="pp-spinner-on-button" />}
                  <span>{isLoading ? "Opening checkout..." : (trialEligible ? "Start 3-day trial" : "Subscribe")}</span>
                </button>
                {!trialEligible && (
                  <small className="pp-locked-note">Free trial already used on this device or network.</small>
                )}
              </article>
            );
          })}
        </div>

        <div className="pp-locked-foot">
          <a href="/" className="pp-locked-link">Back to homepage</a>
          <button type="button" className="pp-locked-link" onClick={onSignOut}>
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}
