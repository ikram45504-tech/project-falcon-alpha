import { Component, type ReactNode } from "react";

type Props = { children: ReactNode };
type State = { error: Error | null };

async function hardResetWebCache(options?: { navigate?: boolean }) {
  const navigate = options?.navigate !== false;
  try {
    if ("serviceWorker" in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((reg) => reg.unregister()));
    }
    if ("caches" in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));
    }
  } catch (error) {
    console.warn("PWA cache reset failed:", error);
  }
  if (!navigate) return;
  const url = new URL(window.location.href);
  url.searchParams.delete("pwa-reset");
  window.location.replace(url.toString());
}

export class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error("App render crashed:", error);
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <main
        style={{
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          padding: 24,
          fontFamily: "system-ui, sans-serif",
          background: "#f5f7fa",
        }}
      >
        <section
          style={{
            maxWidth: 520,
            width: "100%",
            background: "#fff",
            border: "1px solid #d9e0e8",
            borderRadius: 14,
            padding: 24,
            boxShadow: "0 12px 36px rgba(30, 50, 70, 0.08)",
          }}
        >
          <strong style={{ display: "block", color: "#b42318", marginBottom: 8 }}>SCREEN FAILED TO LOAD</strong>
          <h1 style={{ margin: "0 0 10px", fontSize: 22 }}>Travel Hisab hit a display error</h1>
          <p style={{ margin: "0 0 16px", lineHeight: 1.5, color: "#52606d" }}>
            This is often an outdated phone PWA cache. Clear the web cache and reload to pull the latest version.
          </p>
          <p style={{ margin: "0 0 18px", fontSize: 12, color: "#7a8696", wordBreak: "break-word" }}>
            {this.state.error.message}
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
            <button
              type="button"
              onClick={() => void hardResetWebCache()}
              style={{
                border: 0,
                borderRadius: 8,
                padding: "10px 14px",
                background: "#082751",
                color: "#fff",
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              Clear cache & reload
            </button>
            <button
              type="button"
              onClick={() => window.location.reload()}
              style={{
                border: "1px solid #cbd5e1",
                borderRadius: 8,
                padding: "10px 14px",
                background: "#fff",
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              Reload only
            </button>
          </div>
        </section>
      </main>
    );
  }
}

export { hardResetWebCache };
