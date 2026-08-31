import { useTheme } from "../ThemeContext";

const MOBILE_THEMES = [
  { id: "light" as const, icon: "☀️", label: "Bright" },
  { id: "dark" as const, icon: "🌙", label: "Dark" },
  { id: "ocean" as const, icon: "🌊", label: "Ocean" },
];

/** Mobile PWA appearance — theme only (no desktop layout options). */
export default function MobileAppearance() {
  const { mode, setMode } = useTheme();

  return (
    <section className="panel mobile-appearance-panel">
      <span className="ready">MOBILE APPEARANCE</span>
      <h2 style={{ marginTop: "8px", fontSize: "22px" }}>Theme</h2>
      <p style={{ fontSize: "15px", color: "var(--text-muted)", marginBottom: "20px" }}>
        Choose Bright, Dark, or Ocean. Mobile uses one fixed layout optimized for phones.
      </p>
      <div className="mobile-appearance-themes">
        {MOBILE_THEMES.map((theme) => {
          const active = mode === theme.id;
          return (
            <button
              key={theme.id}
              type="button"
              className={`mobile-appearance-theme${active ? " active" : ""}`}
              onClick={() => setMode(theme.id)}
            >
              <span className="mobile-appearance-theme-icon">{theme.icon}</span>
              <span className="mobile-appearance-theme-label">{theme.label}</span>
              {active ? <span className="mobile-appearance-theme-check">✓</span> : null}
            </button>
          );
        })}
      </div>
    </section>
  );
}
