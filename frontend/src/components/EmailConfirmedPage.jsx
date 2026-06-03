import { useAuth } from "../auth/AuthContext";
import podpilotLogo from "../assets/podpilot-logo.svg";

/**
 * Public landing target for Supabase email-confirmation links.
 * Supabase exchanges the token in the URL automatically (detectSessionInUrl),
 * so by the time this component mounts the user is already either signed in
 * or simply confirmed and asked to log in. We don't trigger any auth calls
 * here — we just show a friendly success state and route them onward.
 */
export default function EmailConfirmedPage() {
  const auth = useAuth();
  const isAuthenticated = Boolean(auth?.user);
  const target = isAuthenticated ? "/dashboard" : "/login";

  function handleContinue(event) {
    event.preventDefault();
    window.location.href = target;
  }

  return (
    <main className="login-page auth-shell">
      <div className="auth-backdrop" aria-hidden="true" />

      <div className="auth-card-wrap">
        <div className="auth-logo-badge auth-logo-animated" aria-hidden="true">
          <img src={podpilotLogo} alt="" />
        </div>

        <section className="login-card auth-card" aria-label="Email confirmed">
          <div className="auth-reset-success">
            <div className="auth-confirmed-icon" aria-hidden="true">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="36"
                height="36"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>

            <div className="auth-copy">
              <h2>Email confirmed</h2>
              <p>
                Your email has been confirmed successfully. You can close this
                page and return to login.
              </p>
            </div>

            <a
              href={target}
              className="auth-submit"
              onClick={handleContinue}
              style={{ textDecoration: "none" }}
            >
              {isAuthenticated ? "Go to dashboard" : "Go to login"}
            </a>
          </div>
        </section>
      </div>
    </main>
  );
}
