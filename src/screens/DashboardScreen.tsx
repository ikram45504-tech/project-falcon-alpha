import { useEffect, useState } from "react";
import { useAuth } from "../AuthContext";
import { getDashboardMetrics, getRecentActivity, DashboardMetrics, RecentActivity } from "../DashboardDb";
import { useNavigate } from "react-router-dom";
import { check } from "@tauri-apps/plugin-updater";
import { ask, message } from "@tauri-apps/plugin-dialog";

// Helper to format currency
const pkr = (val: number) =>
  new Intl.NumberFormat("en-PK", {
    style: "currency",
    currency: "PKR",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(val || 0);

export default function DashboardScreen() {
  const { company } = useAuth();
  const navigate = useNavigate();

  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [recent, setRecent] = useState<RecentActivity[]>([]);
  const [loading, setLoading] = useState(true);

  const checkForUpdates = async () => {
    try {
      const update = await check();
      if (update) {
        const yes = await ask(`Update to ${update.version} is available!\n\nRelease notes: ${update.body}`, {
          title: "Update Available",
          kind: "info",
        });
        if (yes) {
          await update.downloadAndInstall();
          await message("Update installed successfully! Please restart the application to apply changes.", {
            title: "Update Complete",
            kind: "info",
          });
        }
      } else {
        await message("You are already on the latest version!", { title: "No Update Available", kind: "info" });
      }
    } catch (error) {
      await message(`Error checking for updates: ${error}`, { title: "Update Error", kind: "error" });
    }
  };

  useEffect(() => {
    if (!company) return;
    let active = true;

    async function load() {
      try {
        const [m, r] = await Promise.all([getDashboardMetrics(company!.id), getRecentActivity(company!.id, 6)]);
        if (active) {
          setMetrics(m);
          setRecent(r);
        }
      } catch (err) {
        console.error("Dashboard Load Error:", err);
      } finally {
        if (active) setLoading(false);
      }
    }
    load();
    return () => {
      active = false;
    };
  }, [company]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "32px", padding: "16px", minHeight: "100%" }}>
      {/* Header section */}
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-end",
          borderBottom: "1px solid var(--border-light)",
          paddingBottom: "16px",
        }}
      >
        <div>
          <h1 style={{ fontSize: "28px", fontWeight: 800, margin: 0, color: "var(--brand-primary)" }}>
            Command Center
          </h1>
          <p style={{ margin: "4px 0 0 0", color: "var(--text-muted)", fontSize: "15px" }}>
            Welcome back to {company?.name || "your agency"}. Here's your performance this month.
          </p>
        </div>
        <div style={{ display: "flex", gap: "12px" }}>
          <button
            onClick={checkForUpdates}
            style={{
              padding: "10px 20px",
              borderRadius: "8px",
              border: "1px solid var(--border-glass)",
              background: "var(--bg-app)",
              color: "var(--brand-primary)",
              fontWeight: 600,
              cursor: "pointer",
              boxShadow: "var(--shadow-sm)",
            }}
          >
            🔄 Check for Updates
          </button>
          <button
            onClick={() => navigate("/payments")}
            style={{
              padding: "10px 20px",
              borderRadius: "8px",
              border: "1px solid var(--border-glass)",
              background: "var(--brand-primary)",
              color: "#fff",
              fontWeight: 600,
              cursor: "pointer",
              boxShadow: "var(--shadow-sm)",
            }}
          >
            Add Payment
          </button>
        </div>
      </header>

      {/* KPI Grid */}
      <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "24px" }}>
        {/* Sales Card */}
        <div
          style={{
            background: "var(--bg-card)",
            padding: "24px",
            borderRadius: "16px",
            border: "1px solid var(--border-light)",
            boxShadow: "var(--shadow-sm)",
            display: "flex",
            flexDirection: "column",
            gap: "12px",
            position: "relative",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              position: "absolute",
              top: 0,
              right: 0,
              width: "100px",
              height: "100px",
              background: "var(--brand-secondary)",
              filter: "blur(60px)",
              opacity: 0.2,
              borderRadius: "50%",
            }}
          ></div>
          <span
            style={{
              fontSize: "14px",
              fontWeight: 700,
              color: "var(--text-muted)",
              textTransform: "uppercase",
              letterSpacing: "1px",
            }}
          >
            Monthly Sales
          </span>
          {loading ? (
            <div
              style={{
                height: "40px",
                background: "var(--border-light)",
                borderRadius: "8px",
                animation: "pulse 1.5s infinite",
              }}
            ></div>
          ) : (
            <span style={{ fontSize: "36px", fontWeight: 900, color: "var(--text-main)", lineHeight: 1 }}>
              {pkr(metrics?.monthlySales || 0)}
            </span>
          )}
        </div>

        {/* Purchases Card */}
        <div
          style={{
            background: "var(--bg-card)",
            padding: "24px",
            borderRadius: "16px",
            border: "1px solid var(--border-light)",
            boxShadow: "var(--shadow-sm)",
            display: "flex",
            flexDirection: "column",
            gap: "12px",
            position: "relative",
            overflow: "hidden",
          }}
        >
          <span
            style={{
              fontSize: "14px",
              fontWeight: 700,
              color: "var(--text-muted)",
              textTransform: "uppercase",
              letterSpacing: "1px",
            }}
          >
            Monthly Purchases
          </span>
          {loading ? (
            <div
              style={{
                height: "40px",
                background: "var(--border-light)",
                borderRadius: "8px",
                animation: "pulse 1.5s infinite",
              }}
            ></div>
          ) : (
            <span style={{ fontSize: "36px", fontWeight: 900, color: "var(--text-main)", lineHeight: 1 }}>
              {pkr(metrics?.monthlyPurchases || 0)}
            </span>
          )}
        </div>

        {/* Profit Card */}
        <div
          style={{
            background: "var(--bg-card)",
            padding: "24px",
            borderRadius: "16px",
            border: "1px solid var(--border-light)",
            boxShadow: "var(--shadow-sm)",
            display: "flex",
            flexDirection: "column",
            gap: "12px",
            position: "relative",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              position: "absolute",
              top: 0,
              right: 0,
              width: "100px",
              height: "100px",
              background: "var(--profit-color)",
              filter: "blur(60px)",
              opacity: 0.2,
              borderRadius: "50%",
            }}
          ></div>
          <span
            style={{
              fontSize: "14px",
              fontWeight: 700,
              color: "var(--text-muted)",
              textTransform: "uppercase",
              letterSpacing: "1px",
            }}
          >
            Net Profit
          </span>
          {loading ? (
            <div
              style={{
                height: "40px",
                background: "var(--border-light)",
                borderRadius: "8px",
                animation: "pulse 1.5s infinite",
              }}
            ></div>
          ) : (
            <span
              style={{
                fontSize: "36px",
                fontWeight: 900,
                color: (metrics?.monthlyProfit || 0) >= 0 ? "var(--profit-color)" : "var(--loss-color)",
                lineHeight: 1,
              }}
            >
              {pkr(metrics?.monthlyProfit || 0)}
            </span>
          )}
        </div>

        {/* Bookings Card */}
        <div
          style={{
            background: "var(--btn-primary-bg)",
            padding: "24px",
            borderRadius: "16px",
            border: "none",
            boxShadow: "var(--shadow-glow)",
            display: "flex",
            flexDirection: "column",
            gap: "12px",
            color: "#fff",
          }}
        >
          <span
            style={{
              fontSize: "14px",
              fontWeight: 700,
              opacity: 0.8,
              textTransform: "uppercase",
              letterSpacing: "1px",
            }}
          >
            Active Bookings
          </span>
          {loading ? (
            <div
              style={{
                height: "40px",
                background: "rgba(255,255,255,0.2)",
                borderRadius: "8px",
                animation: "pulse 1.5s infinite",
              }}
            ></div>
          ) : (
            <div style={{ display: "flex", alignItems: "baseline", gap: "8px" }}>
              <span style={{ fontSize: "42px", fontWeight: 900, lineHeight: 1 }}>
                {metrics?.activeBookingsCount || 0}
              </span>
              <span style={{ fontSize: "16px", opacity: 0.8 }}>files</span>
            </div>
          )}
        </div>
      </section>

      {/* Main Content Split */}
      <section style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: "24px", flex: 1 }}>
        {/* Left Column: Recent Activity Feed */}
        <div
          style={{
            background: "var(--bg-card)",
            borderRadius: "16px",
            border: "1px solid var(--border-light)",
            boxShadow: "var(--shadow-sm)",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              padding: "20px 24px",
              borderBottom: "1px solid var(--border-light)",
              background: "var(--table-th-bg)",
            }}
          >
            <h3 style={{ margin: 0, fontSize: "16px", fontWeight: 800, color: "var(--text-main)" }}>Recent Activity</h3>
          </div>

          <div style={{ display: "flex", flexDirection: "column" }}>
            {loading ? (
              <div style={{ padding: "40px", textAlign: "center", color: "var(--text-muted)" }}>Loading feed...</div>
            ) : recent.length === 0 ? (
              <div style={{ padding: "40px", textAlign: "center", color: "var(--text-muted)" }}>
                No recent activity to show.
              </div>
            ) : (
              recent.map((item, i) => (
                <div
                  key={item.id}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    padding: "16px 24px",
                    borderBottom: i < recent.length - 1 ? "1px solid var(--border-light)" : "none",
                    transition: "background 0.2s",
                  }}
                  className="recent-activity-row"
                >
                  <div style={{ display: "flex", gap: "16px", alignItems: "center" }}>
                    <div
                      style={{
                        width: "40px",
                        height: "40px",
                        borderRadius: "50%",
                        background: item.type.includes("SALE") ? "var(--profit-glow)" : "var(--loss-glow)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: "18px",
                      }}
                    >
                      {item.type.includes("SALE") ? "💰" : "🛒"}
                    </div>
                    <div>
                      <div
                        style={{ fontWeight: 700, color: "var(--text-main)", fontSize: "15px", marginBottom: "2px" }}
                      >
                        {item.type.replace("_", " ")}
                      </div>
                      <div style={{ fontSize: "13px", color: "var(--text-muted)" }}>
                        {item.description} • {item.date}
                      </div>
                    </div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontWeight: 800, fontSize: "16px", color: "var(--text-main)" }}>
                      {pkr(item.amount)}
                    </div>
                    <div
                      style={{
                        fontSize: "12px",
                        color: "var(--text-muted)",
                        fontWeight: 600,
                        background: "var(--bg-app)",
                        padding: "2px 6px",
                        borderRadius: "4px",
                        display: "inline-block",
                        marginTop: "4px",
                      }}
                    >
                      {item.status}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Right Column: Quick Stats / Links */}
        <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
          <div
            style={{
              background: "var(--bg-card)",
              borderRadius: "16px",
              border: "1px solid var(--border-light)",
              boxShadow: "var(--shadow-sm)",
              padding: "24px",
              display: "flex",
              flexDirection: "column",
              gap: "16px",
            }}
          >
            <h3 style={{ margin: 0, fontSize: "16px", fontWeight: 800, color: "var(--text-main)" }}>Fast Navigation</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              <button
                onClick={() => navigate("/parties")}
                style={{
                  textAlign: "left",
                  padding: "12px 16px",
                  background: "var(--bg-app)",
                  border: "1px solid var(--border-light)",
                  borderRadius: "8px",
                  cursor: "pointer",
                  fontWeight: 600,
                  color: "var(--text-main)",
                }}
              >
                👥 Parties & Vendors Directory
              </button>
              <button
                onClick={() => navigate("/ledger")}
                style={{
                  textAlign: "left",
                  padding: "12px 16px",
                  background: "var(--bg-app)",
                  border: "1px solid var(--border-light)",
                  borderRadius: "8px",
                  cursor: "pointer",
                  fontWeight: 600,
                  color: "var(--text-main)",
                }}
              >
                📔 Master Ledger
              </button>
              <button
                onClick={() => navigate("/pnl")}
                style={{
                  textAlign: "left",
                  padding: "12px 16px",
                  background: "var(--bg-app)",
                  border: "1px solid var(--border-light)",
                  borderRadius: "8px",
                  cursor: "pointer",
                  fontWeight: 600,
                  color: "var(--text-main)",
                }}
              >
                📊 PnL & Portfolio
              </button>
            </div>
          </div>

          <div
            style={{
              background: "linear-gradient(135deg, var(--bg-card), var(--bg-app))",
              borderRadius: "16px",
              border: "1px solid var(--border-light)",
              padding: "24px",
              flex: 1,
              display: "flex",
              flexDirection: "column",
              justifyContent: "center",
              alignItems: "center",
              textAlign: "center",
              opacity: 0.8,
            }}
          >
            <div style={{ fontSize: "40px", marginBottom: "8px" }}>🚀</div>
            <h4 style={{ margin: "0 0 8px 0", color: "var(--brand-primary)" }}>Ready to Scale</h4>
            <p style={{ margin: 0, fontSize: "13px", color: "var(--text-muted)" }}>
              Your workspace is completely optimized and ready for daily operations.
            </p>
          </div>
        </div>
      </section>

      <style>{`
        .recent-activity-row:hover {
          background: var(--bg-app) !important;
        }
        @keyframes pulse {
          0% { opacity: 0.4; }
          50% { opacity: 0.8; }
          100% { opacity: 0.4; }
        }
      `}</style>
    </div>
  );
}
