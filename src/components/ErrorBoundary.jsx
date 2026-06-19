import { Component } from "react";

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, message: "" };
  }

  static getDerivedStateFromError(err) {
    return { hasError: true, message: err?.message || "Unknown error" };
  }

  componentDidCatch(err, info) {
    console.error("ErrorBoundary caught:", err, info);
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div style={{
        minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
        padding: 24, fontFamily: "'Instrument Sans', system-ui, sans-serif",
        background: "#212121", color: "#ececec",
      }}>
        <div style={{ maxWidth: 420, width: "100%", textAlign: "center" }}>
          <div style={{ fontSize: 40, marginBottom: 16 }}>⚠</div>
          <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>Something went wrong</div>
          <div style={{ fontSize: 13, opacity: 0.5, marginBottom: 28, lineHeight: 1.6 }}>
            {this.state.message}
          </div>
          <button
            onClick={() => window.location.reload()}
            style={{ background: "#ececec", color: "#212121", border: "none", padding: "11px 28px", borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: "pointer" }}>
            Reload App
          </button>
        </div>
      </div>
    );
  }
}
