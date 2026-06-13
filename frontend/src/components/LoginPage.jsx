import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../auth/AuthContext";
import {
  AUTH_MESSAGES,
  getAuthErrorMessage,
  getResetErrorMessage,
  isEmailNotConfirmedError
} from "../lib/supabaseClient";
import googleLogo from "../assets/google-g.svg";
import podpilotLogo from "../assets/podpilot-logo.svg";
import Icon from "./Icon";
import { checkEmail } from "../api/client";

/* ── Custom brand icons (user SVGs, grey via currentColor) ─────────────── */
function EmailIcon({ className }) {
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
      <circle cx="12" cy="12" r="4" />
      <path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8" />
    </svg>
  );
}

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


function makeToastId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function ButtonSpinner() {
  return <span className="auth-spinner" aria-hidden="true" />;
}

export default function LoginPage() {
  const {
    isConfigured,
    signInWithGoogle,
    signInWithPassword,
    signUpWithPassword,
    resendConfirmationEmail,
    sendPasswordReset
  } = useAuth();
  const [mode, setMode] = useState(() => (
    window.location.pathname === "/signup" ? "signup" : "signin"
  )); // "signin" | "signup" | "forgot"
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [agreeTerms, setAgreeTerms] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [needsConfirmation, setNeedsConfirmation] = useState(false);
  const [showSignInInstead, setShowSignInInstead] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [resendLoading, setResendLoading] = useState(false);
  const [toasts, setToasts] = useState([]);

  const isSignUp = mode === "signup";
  const isForgot = mode === "forgot";
  const formDisabled = !isConfigured || isSubmitting || googleLoading || resendLoading;

  const heading = useMemo(
    () => (isSignUp ? "Create your workspace" : "Welcome back"),
    [isSignUp]
  );

  const subheading = useMemo(
    () =>
      isSignUp
        ? "Create an account to save designs, imports, and upload queues."
        : "Sign in to manage your PodPilot upload workflow.",
    [isSignUp]
  );

  useEffect(() => {
    const rawToast = localStorage.getItem("rb-auth-toast");
    if (!rawToast) return;

    try {
      const parsedToast = JSON.parse(rawToast);
      pushToast(parsedToast.type || "success", parsedToast.message || AUTH_MESSAGES.logoutSuccess);
    } catch {
      pushToast("success", AUTH_MESSAGES.logoutSuccess);
    }

    localStorage.removeItem("rb-auth-toast");
  }, []);

  function removeToast(toastId) {
    setToasts((currentToasts) => currentToasts.filter((toast) => toast.id !== toastId));
  }

  function pushToast(type, message) {
    const id = makeToastId();
    setToasts((currentToasts) => [...currentToasts, { id, type, message }]);
    window.setTimeout(() => removeToast(id), 5600);
  }

  function resetMessages() {
    setError("");
    setSuccess("");
    setNeedsConfirmation(false);
    setShowSignInInstead(false);
  }

  function switchMode(nextMode) {
    setMode(nextMode);
    resetMessages();
    setPassword("");
    setConfirmPassword("");
    setAgreeTerms(false);
    setForgotSent(false);
    if (nextMode === "signup" && window.location.pathname !== "/signup") {
      window.history.pushState(null, "", "/signup");
    } else if (nextMode === "signin" && window.location.pathname !== "/login") {
      window.history.pushState(null, "", "/login");
    }
  }

  async function handleGoogleLogin() {
    resetMessages();
    setGoogleLoading(true);

    try {
      await signInWithGoogle();
    } catch (nextError) {
      const message = getAuthErrorMessage(nextError, AUTH_MESSAGES.googleError);
      setError(message);
      pushToast("error", message);
      setGoogleLoading(false);
    }
  }

  async function handleEmailSubmit(event) {
    event.preventDefault();
    resetMessages();

    const cleanEmail = email.trim().toLowerCase();

    if (!cleanEmail || !password) {
      setError(AUTH_MESSAGES.missingFields);
      pushToast("error", AUTH_MESSAGES.missingFields);
      return;
    }

    if (password.length < 8) {
      setError(AUTH_MESSAGES.passwordTooShort);
      pushToast("error", AUTH_MESSAGES.passwordTooShort);
      return;
    }

    if (isSignUp && password !== confirmPassword) {
      setError(AUTH_MESSAGES.passwordMismatch);
      pushToast("error", AUTH_MESSAGES.passwordMismatch);
      return;
    }

    if (isSignUp && !agreeTerms) {
      const msg = "You must agree to the Terms of Service and Privacy Policy to register.";
      setError(msg);
      pushToast("error", msg);
      return;
    }

    setIsSubmitting(true);

    try {
      if (isSignUp) {
        // Query backend to check if email is valid and allowed
        let checkResult;
        try {
          checkResult = await checkEmail(cleanEmail);
        } catch (checkErr) {
          console.error("Email verification API error:", {
            status: checkErr?.response?.status || "unknown",
            message: checkErr?.message || "unknown",
          });
          const fallbackMsg = "Could not verify this email. Please try again.";
          setError(fallbackMsg);
          pushToast("error", fallbackMsg);
          setIsSubmitting(false);
          return;
        }

        const emailCheckAllowed = checkResult?.ok === true || checkResult?.allowed === true;
        if (!checkResult || emailCheckAllowed !== true) {
          const msg = checkResult?.message || "Temporary or invalid email addresses are not allowed.";
          setError(msg);
          pushToast("error", msg);
          setIsSubmitting(false);
          return;
        }

        await signUpWithPassword({ email: cleanEmail, password });
        setSuccess(AUTH_MESSAGES.signupSuccess);
        setNeedsConfirmation(true);
        pushToast("success", AUTH_MESSAGES.signupSuccess);
        setMode("signin");
        setPassword("");
        setConfirmPassword("");
      } else {
        await signInWithPassword({ email: cleanEmail, password });
        localStorage.setItem(
          "rb-dashboard-toast",
          JSON.stringify({ type: "success", message: AUTH_MESSAGES.loginSuccess })
        );
      }
    } catch (nextError) {
      const message = getAuthErrorMessage(nextError, isSignUp ? "Signup failed." : "Email login failed.");
      if (isEmailNotConfirmedError(nextError)) {
        setNeedsConfirmation(true);
      }
      setError(message);
      pushToast("error", message);
    } finally {
      setIsSubmitting(false);
    }
  }

  // ── Forgot password state ────────────────────────────────────────────────
  const [forgotSent, setForgotSent] = useState(false);
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotError, setForgotError] = useState("");
  const [forgotLoading, setForgotLoading] = useState(false);

  async function handleForgotSubmit(event) {
    event.preventDefault();
    setForgotError("");

    const cleanEmail = forgotEmail.trim();

    if (!cleanEmail) {
      setForgotError(AUTH_MESSAGES.resetMissingEmail);
      return;
    }

    // Basic RFC-5321 email format check
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      setForgotError(AUTH_MESSAGES.resetInvalidEmail);
      return;
    }

    setForgotLoading(true);

    try {
      await sendPasswordReset({ email: cleanEmail });
      setForgotSent(true);
    } catch (nextError) {
      // Always show the safe generic message — never reveal if email exists
      setForgotError(getResetErrorMessage(nextError));
    } finally {
      setForgotLoading(false);
    }
  }

  async function handleResendConfirmation() {
    const cleanEmail = email.trim();

    if (!cleanEmail) {
      const message = "Enter your email first.";
      setError(message);
      pushToast("error", message);
      return;
    }

    setResendLoading(true);

    try {
      await resendConfirmationEmail({ email: cleanEmail });
      setSuccess(AUTH_MESSAGES.resendSuccess);
      pushToast("success", AUTH_MESSAGES.resendSuccess);
    } catch (nextError) {
      const message = getAuthErrorMessage(nextError, "Could not resend confirmation email.");
      setError(message);
      pushToast("error", message);
    } finally {
      setResendLoading(false);
    }
  }

  return (
    <main className="login-page auth-shell">
      <div className="auth-backdrop" aria-hidden="true" />

      <div className="auth-toast-stack" aria-live="polite">
        {toasts.map((toast) => (
          <div key={toast.id} className={`auth-toast auth-toast-${toast.type}`}>
            <span>{toast.message}</span>
            <button
              type="button"
              onClick={() => removeToast(toast.id)}
              aria-label="Dismiss notification"
            >
              <Icon name="x" />
            </button>
          </div>
        ))}
      </div>

      <a href="/" className="auth-back-home">
        <Icon name="arrowLeft" />
        <span>Back to home</span>
      </a>

      <div className="auth-card-wrap">

        <div className="auth-logo-badge auth-logo-animated" aria-hidden="true">
          <img src={podpilotLogo} alt="" />
        </div>

        <section
          className="login-card auth-card"
          aria-label={isForgot ? "Reset password" : isSignUp ? "Create account" : "Sign in"}
        >

        {/* ── Forgot password panel ──────────────────────────────────────── */}
        {isForgot ? (
          <>
            <div className="auth-copy">
              <h2>Reset your password</h2>
              <p>Enter your email and we&rsquo;ll send you a password reset link.</p>
            </div>

            {forgotSent ? (
              /* Success state */
              <div className="auth-reset-success">
                <div className="auth-reset-icon" aria-hidden="true">
                  <EmailIcon />
                </div>
                <p className="auth-reset-message">{AUTH_MESSAGES.resetEmailSent}</p>
                <button
                  type="button"
                  className="auth-submit"
                  onClick={() => switchMode("signin")}
                >
                  Back to sign in
                </button>
              </div>
            ) : (
              /* Idle / send state */
              <form className="auth-form" onSubmit={handleForgotSubmit} noValidate>
                <label className="auth-field">
                  <span>Email address</span>
                  <div className="auth-input-wrap">
                    <EmailIcon className="auth-input-icon" />
                    <input
                      className="auth-input"
                      type="email"
                      autoComplete="email"
                      value={forgotEmail}
                      onChange={(event) => setForgotEmail(event.target.value)}
                      placeholder="you@email.com"
                      disabled={forgotLoading}
                    />
                  </div>
                </label>

                {forgotError && (
                  <div className="login-alert login-alert-error" role="alert">
                    {forgotError}
                  </div>
                )}

                <button
                  type="submit"
                  className="auth-submit"
                  disabled={forgotLoading || !isConfigured}
                >
                  {forgotLoading && <ButtonSpinner />}
                  {forgotLoading ? "Sending..." : "Send reset link"}
                </button>
              </form>
            )}

            <p className="auth-switch">
              <button type="button" onClick={() => switchMode("signin")}>
                ← Back to sign in
              </button>
            </p>
          </>
        ) : (
          /* ── Normal signin / signup ────────────────────────────────────── */
          <>
            <div className="auth-copy">
              <h2>{heading}</h2>
              <p>{subheading}</p>
            </div>

            <div className="auth-tabs" role="tablist" aria-label="Authentication mode">
              <button
                type="button"
                className={`auth-tab ${!isSignUp ? "is-active" : ""}`}
                onClick={() => switchMode("signin")}
                disabled={formDisabled}
              >
                Sign in
              </button>
              <button
                type="button"
                className={`auth-tab ${isSignUp ? "is-active" : ""}`}
                onClick={() => switchMode("signup")}
                disabled={formDisabled}
              >
                Sign up
              </button>
            </div>

            <form className="auth-form" onSubmit={handleEmailSubmit}>
              <label className="auth-field">
                <span>Email</span>
                <div className="auth-input-wrap">
                  <EmailIcon className="auth-input-icon" />
                  <input
                    className="auth-input"
                    type="email"
                    autoComplete="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="you@email.com"
                    disabled={formDisabled}
                  />
                </div>
              </label>

              <label className="auth-field">
                <span>Password</span>
                <div className="auth-input-wrap">
                  <LockIcon className="auth-input-icon" />
                  <input
                    className="auth-input"
                    type={showPassword ? "text" : "password"}
                    autoComplete={isSignUp ? "new-password" : "current-password"}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder="Enter your password"
                    disabled={formDisabled}
                  />
                  <button
                    type="button"
                    className="auth-password-toggle"
                    onClick={() => setShowPassword((currentValue) => !currentValue)}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    disabled={formDisabled}
                  >
                    <Icon name={showPassword ? "eyeOff" : "eye"} />
                  </button>
                </div>
              </label>

              {isSignUp && (
                <label className="auth-field">
                  <span>Confirm Password</span>
                  <div className="auth-input-wrap">
                    <LockIcon className="auth-input-icon" />
                    <input
                      className="auth-input"
                      type={showConfirmPassword ? "text" : "password"}
                      autoComplete="new-password"
                      value={confirmPassword}
                      onChange={(event) => setConfirmPassword(event.target.value)}
                      placeholder="Repeat your password"
                      disabled={formDisabled}
                    />
                    <button
                      type="button"
                      className="auth-password-toggle"
                      onClick={() => setShowConfirmPassword((currentValue) => !currentValue)}
                      aria-label={showConfirmPassword ? "Hide password" : "Show password"}
                      disabled={formDisabled}
                    >
                      <Icon name={showConfirmPassword ? "eyeOff" : "eye"} />
                    </button>
                  </div>
                </label>
              )}

              {isSignUp && (
                <div className="auth-row auth-terms-checkbox-row">
                  <label className="auth-check">
                    <input
                      type="checkbox"
                      checked={agreeTerms}
                      onChange={(event) => setAgreeTerms(event.target.checked)}
                      disabled={formDisabled}
                    />
                    <span>
                      I agree to the <a href="/terms" target="_blank" rel="noopener noreferrer">Terms of Service</a> and <a href="/privacy" target="_blank" rel="noopener noreferrer">Privacy Policy</a>
                    </span>
                  </label>
                </div>
              )}

              {!isSignUp && (
                <div className="auth-row">
                  <label className="auth-check">
                    <input
                      type="checkbox"
                      checked={rememberMe}
                      onChange={(event) => setRememberMe(event.target.checked)}
                      disabled={formDisabled}
                    />
                    <span>Remember me</span>
                  </label>
                  <button
                    type="button"
                    className="auth-forgot-link"
                    onClick={() => switchMode("forgot")}
                  >
                    Forgot password?
                  </button>
                </div>
              )}

              {!isConfigured && (
                <div className="login-alert">
                  <strong>Supabase is not configured yet.</strong>
                  <span>
                    Add <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> inside{" "}
                    <code>frontend/.env</code>.
                  </span>
                </div>
              )}

              {error && <div className="login-alert login-alert-error">{error}</div>}
              {success && <div className="login-alert login-alert-success">{success}</div>}

              {needsConfirmation && (
                <div className="auth-confirmation-tools">
                  <span className="auth-help">Need another confirmation email?</span>
                  <button
                    type="button"
                    className="auth-resend"
                    onClick={handleResendConfirmation}
                    disabled={formDisabled || !email.trim()}
                  >
                    {resendLoading && <ButtonSpinner />}
                    {resendLoading ? "Sending..." : "Resend confirmation email"}
                  </button>
                </div>
              )}

              {showSignInInstead && (
                <div className="auth-confirmation-tools">
                  <span className="auth-help">Want to access your existing account?</span>
                  <button
                    type="button"
                    className="auth-resend"
                    onClick={() => switchMode("signin")}
                    disabled={formDisabled}
                  >
                    Sign in instead
                  </button>
                </div>
              )}

              <button type="submit" className="auth-submit" disabled={formDisabled}>
                {isSubmitting && <ButtonSpinner />}
                {isSubmitting ? "Please wait..." : isSignUp ? "Create Account" : "Enter Dashboard"}
              </button>
            </form>

            <div className="auth-divider">
              <span>or continue with</span>
            </div>

            <button
              type="button"
              className="google-login-button auth-google"
              onClick={handleGoogleLogin}
              disabled={formDisabled}
            >
              {googleLoading ? (
                <ButtonSpinner />
              ) : (
                <img className="google-logo-img" src={googleLogo} alt="" />
              )}
              {googleLoading ? "Opening Google..." : "Continue with Google"}
            </button>


          </>
        )}

        <div className="auth-footer-links">
          <span className="auth-footer-copy">Secure login</span>
          <span className="auth-footer-bullet">•</span>
          <a href="/privacy" className="auth-footer-link">Privacy Policy</a>
          <span className="auth-footer-bullet">•</span>
          <a href="/founder" className="auth-footer-link">Who is behind this tool?</a>
        </div>
        </section>
      </div>
    </main>
  );
}
