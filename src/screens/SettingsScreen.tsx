import { NavLink, Routes, Route, Navigate } from "react-router-dom";
import AppearanceScreen from "./AppearanceScreen";
import SecurityCenter from "../SecurityCenter";
import { useAuth } from "../AuthContext";
import { check } from "@tauri-apps/plugin-updater";
import { ask, message } from "@tauri-apps/plugin-dialog";

export default function SettingsScreen() {
  const { session, company } = useAuth();

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

  if (!session || !company) return <Navigate to="/" />;

  return (
    <div style={{ display: "flex", gap: "24px", height: "100%", alignItems: "flex-start" }}>
      {/* Settings Sidebar */}
      <aside
        style={{
          width: "260px",
          flexShrink: 0,
          background: "var(--bg-card)",
          border: "1px solid var(--border-light)",
          borderRadius: "12px",
          padding: "16px",
          boxShadow: "var(--shadow-sm)",
        }}
      >
        <h3
          style={{
            marginBottom: "16px",
            paddingLeft: "12px",
            color: "var(--brand-primary)",
            fontSize: "14px",
            fontWeight: 800,
          }}
        >
          SETTINGS HUB
        </h3>
        <nav style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
          <NavLink
            to="/settings/appearance"
            style={({ isActive }) => ({
              padding: "10px 12px",
              borderRadius: "8px",
              textDecoration: "none",
              color: isActive ? "var(--brand-secondary)" : "var(--text-main)",
              background: isActive ? "var(--bg-app)" : "transparent",
              fontWeight: isActive ? 800 : 600,
              borderLeft: isActive ? "3px solid var(--brand-secondary)" : "3px solid transparent",
            })}
          >
            🎨 Appearance & Layout
          </NavLink>
          <NavLink
            to="/settings/account"
            style={({ isActive }) => ({
              padding: "10px 12px",
              borderRadius: "8px",
              textDecoration: "none",
              color: isActive ? "var(--brand-secondary)" : "var(--text-main)",
              background: isActive ? "var(--bg-app)" : "transparent",
              fontWeight: isActive ? 800 : 600,
              borderLeft: isActive ? "3px solid var(--brand-secondary)" : "3px solid transparent",
            })}
          >
            👤 Account & Profile
          </NavLink>
          <NavLink
            to="/settings/security"
            style={({ isActive }) => ({
              padding: "10px 12px",
              borderRadius: "8px",
              textDecoration: "none",
              color: isActive ? "var(--brand-secondary)" : "var(--text-main)",
              background: isActive ? "var(--bg-app)" : "transparent",
              fontWeight: isActive ? 800 : 600,
              borderLeft: isActive ? "3px solid var(--brand-secondary)" : "3px solid transparent",
            })}
          >
            🛡️ Security & Access
          </NavLink>
        </nav>
        <div style={{ marginTop: "32px", paddingTop: "16px", borderTop: "1px solid var(--border-light)" }}>
          <button
            onClick={checkForUpdates}
            style={{
              width: "100%",
              padding: "10px",
              borderRadius: "8px",
              border: "1px solid var(--border-glass)",
              background: "var(--bg-app)",
              color: "var(--brand-primary)",
              fontWeight: 600,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "8px",
            }}
          >
            🔄 Check for Updates
          </button>
        </div>
      </aside>

      {/* Settings Content Area */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <Routes>
          <Route path="/" element={<Navigate to="appearance" replace />} />
          <Route path="appearance" element={<AppearanceScreen />} />
          <Route
            path="account"
            element={
              <SecurityCenter
                key="account"
                category="ACCOUNT"
                company={company}
                session={session}
                onCompanyUpdated={() => {}}
              />
            }
          />
          <Route
            path="security"
            element={
              <SecurityCenter
                key="security"
                category="SECURITY"
                company={company}
                session={session}
                onCompanyUpdated={() => {}}
              />
            }
          />
        </Routes>
      </div>
    </div>
  );
}
