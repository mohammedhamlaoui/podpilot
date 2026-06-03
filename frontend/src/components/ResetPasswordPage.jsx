import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../auth/AuthContext";
import { AUTH_MESSAGES, getResetErrorMessage, supabase } from "../lib/supabaseClient";
import podpilotLogo from "../assets/podpilot-logo.svg";
import Icon from "./Icon";

/* ── Custom brand icon (user SVG, grey via currentColor) ───────────────── */
function LockIcon({ className }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="20" height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

function ButtonSpinner() {
  return <span className="auth-spinner" aria-hidden="true" />;
}

/**
 * Renders at /reset-password after the user clicks the email link.
 *
 * Supabase sends the user to:
 *   http://localhost:5173/reset-password#access_token=...&type=recovery
 *
 * The Supabase JS client (detectSessionInUrl: true) reads that hash,
 * establishes a temporary recovery session, and fires onAuthStateChange
 * with event === "PASSWORD_RECOVERY". App.jsx catches that and renders
 * this page instead of the normal login or dashboard.
 *
 * After a successful update we sign the user out so they must sign in
 * fresh with their new password — this prevents the recovery session
 * from staying alive and lets the user know the change took effect.
 */
export default function ResetPasswordPage({ onBackToSignIn }) {
  const { updatePassword, signOut } = useAuth();

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDone, setIsDone] = useState(false);

  // Remove the token hash from the URL bar as soon as the page mounts.
  // This prevents the raw access_token from being visible in history/logs
  // and stops a hard-refresh from re-using the (already consumed) token.
  useEffect(() => {
    if (window.location.hash) {
      window.history.replaceState(null, "", window.location.pathname);
    }
  }, []);

  const handleSubmit = useCallback(
    async (event) => {
      event.preventDefault();
      setError("");

      if (password.length < 8) {
        setError(AUTH_MESSAGES.passwordTooShort);
        return;
      }

      if (password !== confirmPassword) {
        setError(AUTH_MESSAGES.passwordMismatch);
        return;
      }

      setIsSubmitting(true);

      try {
        // Update the password using the active recovery session
        await updatePassword({ password });

        // Sign out the recovery session so the user must log in fresh.
        // Ignore sign-out errors — the password was already updated.
        try {
          await signOut();
        } catch {
          // no-op: non-fatal
        }

        setIsDone(true);
      } catch (nextError) {
        setError(getResetErrorMessage(nextError));
      } finally {
        setIsSubmitting(false);
      }
    },
    [password, confirmPassword, updatePassword, signOut]
  );

  return (
    <main className="login-page auth-shell">
      <div className="auth-backdrop" aria-hidden="true" />

      <div className="auth-card-wrap">
        <div className="auth-logo-badge auth-logo-animated" aria-hidden="true">
          <img src={podpilotLogo} alt="" />
        </div>

        <section className="login-card auth-card" aria-label="Set new password">

        {isDone ? (
          /* ── Success state ─────────────────────────────────────────────── */
          <>
            <div className="auth-copy">
              <h2>Password updated</h2>
              <p>You can now sign in with your new password.</p>
            </div>

            <div className="auth-reset-success">
              <div className="auth-reset-icon" aria-hidden="true">
                <Icon name="designs" />
              </div>
              <p className="auth-reset-message">{AUTH_MESSAGES.resetSuccess}</p>
              <button type="button" className="auth-submit" onClick={onBackToSignIn}>
                Back to sign in
              </button>
            </div>
          </>
        ) : (
          /* ── Set password form ─────────────────────────────────────────── */
          <>
            <div className="auth-copy">
              <h2>Set new password</h2>
              <p>Choose a strong password with at least 8 characters.</p>
            </div>

            <form className="auth-form" onSubmit={handleSubmit}>
              <label className="auth-field">
                <span>New password</span>
                <div className="auth-input-wrap">
                  <LockIcon className="auth-input-icon" />
                  <input
                    className="auth-input"
                    type={showPassword ? "text" : "password"}
                    autoComplete="new-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="At least 8 characters"
                    disabled={isSubmitting}
                  />
                  <button
                    type="button"
                    className="auth-password-toggle"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    disabled={isSubmitting}
                  >
                    <Icon name={showPassword ? "eyeOff" : "eye"} />
                  </button>
                </div>
              </label>

              <label className="auth-field">
                <span>Confirm new password</span>
                <div className="auth-input-wrap">
                  <LockIcon className="auth-input-icon" />
                  <input
                    className="auth-input"
                    type={showConfirmPassword ? "text" : "password"}
                    autoComplete="new-password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Repeat your new password"
                    disabled={isSubmitting}
                  />
                  <button
                    type="button"
                    className="auth-password-toggle"
                    onClick={() => setShowConfirmPassword((v) => !v)}
                    aria-label={showConfirmPassword ? "Hide password" : "Show password"}
                    disabled={isSubmitting}
                  >
                    <Icon name={showConfirmPassword ? "eyeOff" : "eye"} />
                  </button>
                </div>
              </label>

              {error && (
                <div className="login-alert login-alert-error" role="alert">
                  {error}
                </div>
              )}

              <button type="submit" className="auth-submit" disabled={isSubmitting}>
                {isSubmitting && <ButtonSpinner />}
                {isSubmitting ? "Updating..." : "Update password"}
              </button>
            </form>

            <p className="auth-switch">
              <button type="button" onClick={onBackToSignIn}>
                ← Back to sign in
              </button>
            </p>
          </>
        )}
        </section>
      </div>
    </main>
  );
}
