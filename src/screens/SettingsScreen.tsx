import { NavLink, Routes, Route, Navigate } from "react-router-dom";
import AppearanceScreen from "./AppearanceScreen";
import SecurityCenter from "../SecurityCenter";
import { useAuth } from "../AuthContext";
import { useIsDesktop } from "../useIsDesktop";
import { isOfflineOnlyBuild } from "../appMode";
import AboutScreen from "./AboutScreen";

export default function SettingsScreen() {
  const { session, company } = useAuth();
  const isDesktop = useIsDesktop();

  const checkForUpdates = async () => {
    try {
      const { check } = await import("@tauri-apps/plugin-updater");
      const { ask, message } = await import("@tauri-apps/plugin-dialog");
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
      const { message } = await import("@tauri-apps/plugin-dialog");
      await message(`Error checking for updates: ${error}`, { title: "Update Error", kind: "error" });
    }
  };

  if (!session || !company) return <Navigate to="/" />;

  return (
    <div className="settings-shell">
      {/* Settings Sidebar */}
      <aside className="settings-hub">
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
        <nav className="settings-hub-links">
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
          {isDesktop && (
            <NavLink
              to="/settings/about"
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
              ℹ️ About Software
            </NavLink>
          )}
        </nav>
        {isDesktop && !isOfflineOnlyBuild() && (
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
                marginBottom: "12px",
              }}
            >
              🔄 Check for Updates
            </button>
            <button
              onClick={async () => {
                try {
                  const { runManualSyncAndRefresh } = await import("../db");
                  await runManualSyncAndRefresh(company.id);
                } catch (e: any) {
                  const { message } = await import("@tauri-apps/plugin-dialog");
                  await message(`Sync failed: ${e.message || String(e)}`, { title: "Sync Error", kind: "error" });
                }
              }}
              style={{
                width: "100%",
                padding: "10px",
                borderRadius: "8px",
                border: "1px solid var(--border-glass)",
                background: "var(--bg-app)",
                color: "var(--brand-secondary)",
                fontWeight: 600,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "8px",
              }}
            >
              Sync
            </button>
          </div>
        )}
        {isDesktop && isOfflineOnlyBuild() && (
          <div
            style={{
              marginTop: "32px",
              padding: "12px",
              borderRadius: "8px",
              border: "1px solid var(--border-light)",
              background: "var(--bg-app)",
              fontSize: "13px",
              color: "var(--text-muted)",
            }}
          >
            Offline edition — data stays on this device. Cloud sync and auto-update are disabled.
          </div>
        )}
        {isDesktop && (
          <div style={{ marginTop: "16px", paddingTop: "16px", borderTop: "1px solid var(--border-light)" }}>
            <button
              onClick={async () => {
                const { ask, message } = await import("@tauri-apps/plugin-dialog");
                const yes = await ask(
                  "WARNING: This will permanently erase ALL bookings and operational data from your local database to allow a fresh start. Are you absolutely sure?",
                  { title: "DANGER ZONE", kind: "warning" },
                );
                if (yes) {
                  const { dangerouslyEraseAllData } = await import("../db");
                  try {
                    await dangerouslyEraseAllData(company.id);
                    await message("Local database successfully wiped. Please restart the application.", {
                      title: "Wipe Complete",
                      kind: "info",
                    });
                  } catch (e: any) {
                    await message(`Wipe failed: ${e.message}`, { title: "Error", kind: "error" });
                  }
                }
              }}
              style={{
                width: "100%",
                padding: "10px",
                borderRadius: "8px",
                border: "1px solid rgba(255,50,50,0.3)",
                background: "rgba(255,0,0,0.1)",
                color: "#ff4444",
                fontWeight: 700,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "8px",
                marginBottom: "12px",
              }}
            >
              ⚠️ Factory Reset Local Data
            </button>
          </div>
        )}
      </aside>

      {/* Settings Content Area */}
      <div className="settings-hub-content">
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
          {isDesktop && <Route path="about" element={<AboutScreen />} />}
        </Routes>
      </div>
    </div>
  );
}
