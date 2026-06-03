import Icon from "./Icon";

export default function NotFoundPage({ isAuthenticated, theme }) {
  const handleGoHome = (e) => {
    e.preventDefault();
    window.history.pushState(null, "", "/");
    // Force App state recalculation by dispatching a popstate event
    window.dispatchEvent(new PopStateEvent("popstate"));
  };

  const handleGoDashboard = (e) => {
    e.preventDefault();
    window.history.pushState(null, "", "/dashboard");
    window.dispatchEvent(new PopStateEvent("popstate"));
  };

  // Modern Premium Styling using inline styles for absolute contrast and isolation
  const containerStyle = {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    minHeight: "100vh",
    width: "100vw",
    background: theme === "dark" 
      ? "radial-gradient(circle at center, #0f0b1e 0%, #05030a 100%)"
      : "radial-gradient(circle at center, #f5f3ff 0%, #ffffff 100%)",
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    color: theme === "dark" ? "#ffffff" : "#1e293b",
    padding: "24px",
    boxSizing: "border-box",
  };

  const cardStyle = {
    background: theme === "dark" ? "rgba(255, 255, 255, 0.03)" : "rgba(255, 255, 255, 0.8)",
    backdropFilter: "blur(20px)",
    WebkitBackdropFilter: "blur(20px)",
    border: theme === "dark" ? "1px solid rgba(124, 58, 237, 0.2)" : "1px solid rgba(124, 58, 237, 0.15)",
    borderRadius: "24px",
    padding: "48px 40px",
    width: "100%",
    maxWidth: "480px",
    textAlign: "center",
    boxShadow: theme === "dark" 
      ? "0 20px 50px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.1)"
      : "0 20px 50px rgba(124, 58, 237, 0.05), inset 0 1px 0 rgba(255, 255, 255, 0.9)",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    animation: "fadeInUp 0.6s cubic-bezier(0.16, 1, 0.3, 1) both",
  };

  const logoStyle = {
    width: "56px",
    height: "56px",
    marginBottom: "24px",
  };

  const codeStyle = {
    fontSize: "82px",
    fontWeight: "900",
    lineHeight: "1",
    margin: "0 0 12px",
    background: "linear-gradient(135deg, #a78bfa 0%, #7c3aed 100%)",
    WebkitBackgroundClip: "text",
    WebkitTextFillColor: "transparent",
    letterSpacing: "-2px",
  };

  const titleStyle = {
    fontSize: "22px",
    fontWeight: "700",
    letterSpacing: "-0.5px",
    marginBottom: "10px",
    color: theme === "dark" ? "#ffffff" : "#0f172a",
  };

  const textStyle = {
    fontSize: "14.5px",
    lineHeight: "1.65",
    color: theme === "dark" ? "#9ca3af" : "#64748b",
    marginBottom: "32px",
  };

  const primaryBtnStyle = {
    background: "linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%)",
    color: "#ffffff",
    border: "none",
    borderRadius: "12px",
    padding: "13px 28px",
    fontSize: "14.5px",
    fontWeight: "600",
    cursor: "pointer",
    boxShadow: "0 10px 20px rgba(124, 58, 237, 0.25)",
    transition: "all 150ms cubic-bezier(0.16, 1, 0.3, 1)",
    outline: "none",
    textDecoration: "none",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "8px",
    width: "100%",
    boxSizing: "border-box",
  };

  const secondaryBtnStyle = {
    background: "transparent",
    color: theme === "dark" ? "#e5e7eb" : "#4b5563",
    border: theme === "dark" ? "1px solid rgba(255, 255, 255, 0.15)" : "1px solid #d1d5db",
    borderRadius: "12px",
    padding: "13px 28px",
    fontSize: "14.5px",
    fontWeight: "600",
    cursor: "pointer",
    transition: "all 150ms cubic-bezier(0.16, 1, 0.3, 1)",
    outline: "none",
    textDecoration: "none",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "8px",
    width: "100%",
    boxSizing: "border-box",
    marginTop: "12px",
  };

  const helpTextStyle = {
    fontSize: "12px",
    color: theme === "dark" ? "#6b7280" : "#94a3b8",
    marginTop: "32px",
    lineHeight: "1.5",
  };

  return (
    <div style={containerStyle}>
      <style>{`
        @keyframes fadeInUp {
          from { opacity: 0; transform: translateY(20px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
      <div style={cardStyle}>
        <a href="/" onClick={handleGoHome}>
          <img src="/brand/podpilot-logo.svg" alt="PodPilot" style={logoStyle} />
        </a>

        <div style={codeStyle}>404</div>
        <h2 style={titleStyle}>Page not found</h2>
        
        <p style={textStyle}>
          This page doesn’t exist, or the link may be outdated.
        </p>

        <div style={{ width: "100%" }}>
          {isAuthenticated ? (
            <>
              <button
                onClick={handleGoDashboard}
                style={primaryBtnStyle}
                onMouseEnter={(e) => {
                  e.currentTarget.style.transform = "translateY(-1px)";
                  e.currentTarget.style.boxShadow = "0 12px 24px rgba(124, 58, 237, 0.35)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = "translateY(0)";
                  e.currentTarget.style.boxShadow = "0 10px 20px rgba(124, 58, 237, 0.25)";
                }}
              >
                <Icon name="designs" style={{ width: "16px", height: "16px" }} />
                <span>Back to Dashboard</span>
              </button>
              
              <button
                onClick={handleGoHome}
                style={secondaryBtnStyle}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = theme === "dark" ? "rgba(255, 255, 255, 0.05)" : "#f9fafb";
                  e.currentTarget.style.borderColor = theme === "dark" ? "rgba(255, 255, 255, 0.3)" : "#9ca3af";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "transparent";
                  e.currentTarget.style.borderColor = theme === "dark" ? "rgba(255, 255, 255, 0.15)" : "#d1d5db";
                }}
              >
                <span>Go Home</span>
              </button>
            </>
          ) : (
            <button
              onClick={handleGoHome}
              style={primaryBtnStyle}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = "translateY(-1px)";
                e.currentTarget.style.boxShadow = "0 12px 24px rgba(124, 58, 237, 0.35)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = "translateY(0)";
                e.currentTarget.style.boxShadow = "0 10px 20px rgba(124, 58, 237, 0.25)";
              }}
            >
              <span>Go Home</span>
            </button>
          )}
        </div>

        <div style={helpTextStyle}>
          Need help? Return to PodPilot and continue managing your uploads.
        </div>
      </div>
    </div>
  );
}
