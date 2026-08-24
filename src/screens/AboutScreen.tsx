import packageJson from "../../package.json";

export default function AboutScreen() {
  return (
    <div
      style={{
        background: "var(--bg-card)",
        border: "1px solid var(--border-light)",
        borderRadius: "12px",
        padding: "32px",
        boxShadow: "var(--shadow-sm)",
        display: "flex",
        flexDirection: "column",
        gap: "24px",
      }}
    >
      <div>
        <h2 style={{ color: "var(--text-main)", marginBottom: "8px" }}>About Software</h2>
        <p style={{ color: "var(--text-muted)", fontSize: "14px" }}>
          Software identity, developer information and version details.
        </p>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            borderBottom: "1px solid var(--border-glass)",
            paddingBottom: "16px",
          }}
        >
          <span style={{ color: "var(--text-muted)", fontWeight: 600 }}>Developer</span>
          <span style={{ color: "var(--text-main)", fontWeight: 800 }}>Bug Traces</span>
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            borderBottom: "1px solid var(--border-glass)",
            paddingBottom: "16px",
          }}
        >
          <span style={{ color: "var(--text-muted)", fontWeight: 600 }}>Email</span>
          <span style={{ color: "var(--brand-primary)", fontWeight: 800 }}>Bugtraces@gmail.com</span>
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            borderBottom: "1px solid var(--border-glass)",
            paddingBottom: "16px",
          }}
        >
          <span style={{ color: "var(--text-muted)", fontWeight: 600 }}>Contact</span>
          <span style={{ color: "var(--brand-primary)", fontWeight: 800 }}>+923171717818</span>
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            borderBottom: "1px solid var(--border-glass)",
            paddingBottom: "16px",
          }}
        >
          <span style={{ color: "var(--text-muted)", fontWeight: 600 }}>Version</span>
          <span style={{ color: "var(--text-main)", fontWeight: 800 }}>v{packageJson.version}</span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <span style={{ color: "var(--text-muted)", fontWeight: 600 }}>Last Update</span>
          <span style={{ color: "var(--text-main)", fontWeight: 800 }}>{new Date().toLocaleDateString("en-GB")}</span>
        </div>
      </div>
    </div>
  );
}
