import { useTheme, LayoutType } from "../ThemeContext";

export default function AppearanceScreen() {
  const { mode, layout, setMode, setLayout } = useTheme();

  return (
    <section className="panel appearance-panel">
      {/* Top Right Theme Toggle */}
      <div className="appearance-themes">
        {[
          { id: "light" as const, icon: "☀️", label: "Bright" },
          { id: "dark" as const, icon: "🌙", label: "Dark" },
          { id: "ocean" as const, icon: "🌊", label: "Ocean" },
        ].map((t) => (
          <button
            key={t.id}
            onClick={() => setMode(t.id)}
            style={{
              background: mode === t.id ? "var(--brand-primary)" : "transparent",
              color: mode === t.id ? "#ffffff" : "var(--text-muted)",
              boxShadow: mode === t.id ? "var(--shadow-sm)" : "none",
              border: "none",
              padding: "6px 14px",
              borderRadius: "999px",
              cursor: "pointer",
              fontWeight: 600,
              fontSize: "13px",
              transition: "all 0.2s",
              whiteSpace: "nowrap",
            }}
          >
            {mode === t.id && "✅ "}
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      <div style={{ maxWidth: "600px" }}>
        <span className="ready">PERSONALIZATION ENGINE</span>
        <h2 style={{ marginTop: "8px", fontSize: "28px" }}>Appearance & Layout</h2>
        <p style={{ fontSize: "16px", color: "var(--text-muted)" }}>
          Completely transform the structural architecture of your software.
        </p>
      </div>

      <div style={{ marginTop: "40px", paddingBottom: "60px" }}>
        <div className="appearance-layouts">
          <LayoutCard
            title="LAYOUT 1: Classic Enterprise"
            desc="The standard, reliable horizontal navigation at the top of the screen."
            layoutId="layout-1"
            currentLayout={layout}
            onSelect={setLayout}
          />
          <LayoutCard
            title="LAYOUT 2: Floating macOS"
            desc="The navigation bar becomes a floating, rounded pill in the center of the screen."
            layoutId="layout-2"
            currentLayout={layout}
            onSelect={setLayout}
          />
          <LayoutCard
            title="LAYOUT 3: Professional Vertical"
            desc="Navigation is moved to a fixed left-side vertical panel. Highly popular in modern tech startups."
            layoutId="layout-3"
            currentLayout={layout}
            onSelect={setLayout}
          />
        </div>
      </div>
    </section>
  );
}

function LayoutCard({
  title,
  desc,
  layoutId,
  currentLayout,
  onSelect,
}: {
  title: string;
  desc: string;
  layoutId: LayoutType;
  currentLayout: LayoutType;
  onSelect: (l: LayoutType) => void;
}) {
  const isActive = currentLayout === layoutId;
  return (
    <article
      onClick={() => onSelect(layoutId)}
      className="module-card live"
      style={{
        cursor: "pointer",
        border: isActive ? "2px solid var(--brand-secondary)" : "1px solid var(--border-light)",
        background: "var(--bg-card)",
        boxShadow: isActive ? "var(--shadow-glow)" : "var(--shadow-sm)",
        transition: "all 0.3s ease",
      }}
    >
      <h4 style={{ margin: "0 0 8px 0", color: "var(--text-main)", fontSize: "16px" }}>
        {isActive ? "✅ " : ""}
        {title}
      </h4>
      <p style={{ margin: 0, color: "var(--text-muted)", fontSize: "14px" }}>{desc}</p>
    </article>
  );
}
