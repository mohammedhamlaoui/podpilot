import { Component } from "react";

export default class AppErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error) {
    // Keep production logging minimal and never include user or billing data.
    console.error("[PodPilot] page render failed", error?.name || "RenderError");
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <main
        role="alert"
        style={{
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          padding: "24px",
          background: "#f8fafc",
          color: "#0f172a",
          fontFamily: "Inter, system-ui, sans-serif",
        }}
      >
        <section style={{ maxWidth: "520px", textAlign: "center" }}>
          <h1 style={{ margin: "0 0 12px", fontSize: "28px" }}>PodPilot could not display this page</h1>
          <p style={{ margin: "0 0 20px", color: "#64748b", lineHeight: 1.6 }}>
            Your data is safe. Reload the page to try again.
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{
              border: 0,
              borderRadius: "10px",
              padding: "12px 18px",
              background: "#7c3aed",
              color: "#fff",
              font: "inherit",
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            Reload PodPilot
          </button>
        </section>
      </main>
    );
  }
}
