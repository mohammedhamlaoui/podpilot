import { useEffect, useState } from "react";
import { EXTENSION_ID } from "../config";

export default function ExtensionAuthSuccess({ session }) {
  const [status, setStatus] = useState("transmitting"); // "transmitting" | "success" | "warning"
  const [errorMsg, setErrorMsg] = useState("");
  const [closeBlocked, setCloseBlocked] = useState(false);

  const handleClose = () => {
    window.close();
    setTimeout(() => {
      setCloseBlocked(true);
    }, 150);
  };

  useEffect(() => {
    if (status === "success") {
      const autoCloseTimer = setTimeout(() => {
        window.close();
        setTimeout(() => {
          setCloseBlocked(true);
        }, 150);
      }, 3000);
      return () => clearTimeout(autoCloseTimer);
    }
    return undefined;
  }, [status]);

  useEffect(() => {
    // 1. Give it a tiny moment to ensure extension is fully loaded and ready
    const timer = setTimeout(() => {
      if (!window.chrome || !window.chrome.runtime || !window.chrome.runtime.sendMessage) {
        setStatus("warning");
        setErrorMsg("Extension sync failed. Please reload the extension and try again.");
        return;
      }

      try {
        window.chrome.runtime.sendMessage(
          EXTENSION_ID,
          {
            type: "PODPILOT_AUTH_SESSION",
            access_token: session?.access_token,
            refresh_token: session?.refresh_token,
            expires_at: session?.expires_at,
            user: session?.user,
          },
          (response) => {
            if (window.chrome.runtime.lastError) {
              setStatus("warning");
              setErrorMsg("Extension sync failed. Please reload the extension and try again.");
            } else if (response && response.ok === true) {
              setStatus("success");
            } else {
              setStatus("warning");
              setErrorMsg("Extension sync failed. Please reload the extension and try again.");
            }
          }
        );
      } catch (err) {
        setStatus("warning");
        setErrorMsg("Extension sync failed. Please reload the extension and try again.");
      }
    }, 800);

    return () => clearTimeout(timer);
  }, [session]);

  // Modern Premium Styling using inline styles for perfect isolation
  const containerStyle = {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    minHeight: "100vh",
    width: "100vw",
    background: "radial-gradient(circle at center, #1e1b4b 0%, #090514 100%)",
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    color: "#ffffff",
    padding: "24px",
    boxSizing: "border-box",
  };

  const cardStyle = {
    background: "rgba(255, 255, 255, 0.03)",
    backdropFilter: "blur(20px)",
    WebkitBackdropFilter: "blur(20px)",
    border: "1px solid rgba(124, 58, 237, 0.2)",
    borderRadius: "24px",
    padding: "48px 40px",
    width: "100%",
    maxWidth: "460px",
    textAlign: "center",
    boxShadow: "0 20px 50px rgba(0, 0, 0, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.1)",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    animation: "fadeInUp 0.6s cubic-bezier(0.16, 1, 0.3, 1) both",
  };

  const logoStyle = {
    width: "64px",
    height: "64px",
    marginBottom: "28px",
  };

  const titleStyle = {
    fontSize: "24px",
    fontWeight: "700",
    letterSpacing: "-0.5px",
    marginBottom: "12px",
    background: "linear-gradient(135deg, #ffffff 0%, #c084fc 100%)",
    WebkitBackgroundClip: "text",
    WebkitTextFillColor: "transparent",
  };

  const textStyle = {
    fontSize: "15px",
    lineHeight: "1.6",
    color: "#9ca3af",
    marginBottom: "32px",
  };

  const btnStyle = {
    background: "linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%)",
    color: "#ffffff",
    border: "none",
    borderRadius: "12px",
    padding: "14px 28px",
    fontSize: "15px",
    fontWeight: "600",
    cursor: "pointer",
    boxShadow: "0 10px 20px rgba(124, 58, 237, 0.3)",
    transition: "transform 150ms ease, box-shadow 150ms ease",
    outline: "none",
  };

  return (
    <div style={containerStyle}>
      <style>{`
        @keyframes fadeInUp {
          from { opacity: 0; transform: translateY(20px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes pulse {
          0%, 100% { transform: scale(1); opacity: 1; }
          50% { transform: scale(1.08); opacity: 0.8; }
        }
        .animate-pulse-icon {
          animation: pulse 2s infinite ease-in-out;
        }
      `}</style>
      <div style={cardStyle}>
        <img src="/brand/podpilot-logo.svg" alt="PodPilot" style={logoStyle} />

        {status === "transmitting" && (
          <>
            <div className="animate-pulse-icon" style={{ marginBottom: "24px" }}>
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#a78bfa" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
              </svg>
            </div>
            <h2 style={titleStyle}>Connecting to Extension</h2>
            <p style={textStyle}>Please hold on while we securely transmit your auth session credentials to your PodPilot extension...</p>
          </>
        )}

        {status === "success" && (
          <>
            <div style={{
              width: "56px",
              height: "56px",
              borderRadius: "50%",
              background: "rgba(16, 185, 129, 0.1)",
              border: "2px solid #10b981",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              marginBottom: "24px",
            }}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>
            <h2 style={titleStyle}>Signed In Successfully!</h2>
            <p style={textStyle}>Your session has been securely synchronized with the browser extension. You can now close this tab safely and start using PodPilot.</p>
            <button
              onClick={handleClose}
              style={btnStyle}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = "translateY(-1px)";
                e.currentTarget.style.boxShadow = "0 12px 24px rgba(124, 58, 237, 0.4)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = "translateY(0)";
                e.currentTarget.style.boxShadow = "0 10px 20px rgba(124, 58, 237, 0.3)";
              }}
            >
              Close Tab
            </button>
            {closeBlocked && (
              <div style={{ marginTop: "16px", fontSize: "13px", color: "#f87171", fontWeight: "500" }}>
                You can close this tab manually.
              </div>
            )}
          </>
        )}

        {status === "warning" && (
          <>
            <div style={{
              width: "56px",
              height: "56px",
              borderRadius: "50%",
              background: "rgba(245, 158, 11, 0.1)",
              border: "2px solid #f59e0b",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              marginBottom: "24px",
            }}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                <line x1="12" y1="9" x2="12" y2="13" />
                <line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
            </div>
            <h2 style={{ ...titleStyle, background: "linear-gradient(135deg, #ffffff 0%, #fbbf24 100%)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>Session Saved</h2>
            <p style={textStyle}>{errorMsg}</p>
            <div style={{ display: "flex", gap: "12px" }}>
              <button
                onClick={() => setStatus("success")}
                style={{
                  ...btnStyle,
                  background: "rgba(255, 255, 255, 0.05)",
                  border: "1px solid rgba(255, 255, 255, 0.1)",
                  boxShadow: "none",
                  color: "#e5e7eb",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "rgba(255, 255, 255, 0.1)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "rgba(255, 255, 255, 0.05)";
                }}
              >
                Ignore Warning
              </button>
              <button
                onClick={handleClose}
                style={btnStyle}
                onMouseEnter={(e) => {
                  e.currentTarget.style.transform = "translateY(-1px)";
                  e.currentTarget.style.boxShadow = "0 12px 24px rgba(124, 58, 237, 0.4)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = "translateY(0)";
                  e.currentTarget.style.boxShadow = "0 10px 20px rgba(124, 58, 237, 0.3)";
                }}
              >
                Close Tab
              </button>
            </div>
            {closeBlocked && (
              <div style={{ marginTop: "16px", fontSize: "13px", color: "#f87171", fontWeight: "500" }}>
                You can close this tab manually.
              </div>
            )}
          </>
        )}

      </div>
    </div>
  );
}
