import { NavLink, Routes, Route, Navigate } from "react-router-dom";
import AppearanceScreen from "./AppearanceScreen";
import SecurityCenter from "../SecurityCenter";
import { useAuth } from "../AuthContext";

export default function SettingsScreen() {
  const { session, company } = useAuth();

  if (!session || !company) return <Navigate to="/" />;

  return (
    <div style={{ display: "flex", gap: "24px", height: "100%", alignItems: "flex-start" }}>
      {/* Settings Sidebar */}
      <aside style={{ width: "260px", flexShrink: 0, background: "var(--bg-card)", border: "1px solid var(--border-light)", borderRadius: "12px", padding: "16px", boxShadow: "var(--shadow-sm)" }}>
        <h3 style={{ marginBottom: "16px", paddingLeft: "12px", color: "var(--brand-primary)", fontSize: "14px", fontWeight: 800 }}>SETTINGS HUB</h3>
        <nav style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
          <NavLink 
            to="/settings/appearance" 
            style={({ isActive }) => ({ padding: "10px 12px", borderRadius: "8px", textDecoration: "none", color: isActive ? "var(--brand-secondary)" : "var(--text-main)", background: isActive ? "var(--bg-app)" : "transparent", fontWeight: isActive ? 800 : 600, borderLeft: isActive ? "3px solid var(--brand-secondary)" : "3px solid transparent" })}
          >
            🎨 Appearance & Layout
          </NavLink>
          <NavLink 
            to="/settings/account" 
            style={({ isActive }) => ({ padding: "10px 12px", borderRadius: "8px", textDecoration: "none", color: isActive ? "var(--brand-secondary)" : "var(--text-main)", background: isActive ? "var(--bg-app)" : "transparent", fontWeight: isActive ? 800 : 600, borderLeft: isActive ? "3px solid var(--brand-secondary)" : "3px solid transparent" })}
          >
            👤 Account & Profile
          </NavLink>
          <NavLink 
            to="/settings/security" 
            style={({ isActive }) => ({ padding: "10px 12px", borderRadius: "8px", textDecoration: "none", color: isActive ? "var(--brand-secondary)" : "var(--text-main)", background: isActive ? "var(--bg-app)" : "transparent", fontWeight: isActive ? 800 : 600, borderLeft: isActive ? "3px solid var(--brand-secondary)" : "3px solid transparent" })}
          >
            🛡️ Security & Access
          </NavLink>
        </nav>
      </aside>

      {/* Settings Content Area */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <Routes>
          <Route path="/" element={<Navigate to="appearance" replace />} />
          <Route path="appearance" element={<AppearanceScreen />} />
          <Route path="account" element={<SecurityCenter key="account" category="ACCOUNT" company={company} session={session} onCompanyUpdated={() => {}} />} />
          <Route path="security" element={<SecurityCenter key="security" category="SECURITY" company={company} session={session} onCompanyUpdated={() => {}} />} />
        </Routes>
      </div>
    </div>
  );
}
