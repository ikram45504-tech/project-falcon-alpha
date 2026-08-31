import packageJson from "../../package.json";
import { PRODUCT_NAME } from "../brand";
import { isTauriShell, usePhoneUi } from "../phoneUi";
import { usePwaUpdatePending } from "../usePwaUpdate";
import { useState } from "react";

export default function AboutScreen() {
  const isPhone = usePhoneUi();
  const isWeb = !isTauriShell();
  const { updatePending } = usePwaUpdatePending();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function updatePwa() {
    setBusy(true);
    setMessage("");
    try {
      const { checkAndApplyPwaUpdate, applyPwaUpdate } = await import("../registerPwa");
      if (updatePending) {
        await applyPwaUpdate();
        return;
      }
      const result = await checkAndApplyPwaUpdate();
      if (result === "current") {
        setMessage("You are already on the latest web app version.");
      } else if (result === "unavailable") {
        setMessage("PWA updates are only available in the browser / installed web app.");
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  const edition = isTauriShell() ? "Desktop App" : isPhone ? "Mobile PWA" : "Web App";

  return (
    <div
      style={{
        background: "var(--bg-card)",
        border: "1px solid var(--border-light)",
        borderRadius: "12px",
        padding: isPhone ? "20px" : "32px",
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
            gap: "12px",
            borderBottom: "1px solid var(--border-glass)",
            paddingBottom: "16px",
          }}
        >
          <span style={{ color: "var(--text-muted)", fontWeight: 600 }}>Product</span>
          <span style={{ color: "var(--text-main)", fontWeight: 800, textAlign: "right" }}>{PRODUCT_NAME}</span>
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: "12px",
            borderBottom: "1px solid var(--border-glass)",
            paddingBottom: "16px",
          }}
        >
          <span style={{ color: "var(--text-muted)", fontWeight: 600 }}>Edition</span>
          <span style={{ color: "var(--text-main)", fontWeight: 800 }}>{edition}</span>
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: "12px",
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
            gap: "12px",
            borderBottom: "1px solid var(--border-glass)",
            paddingBottom: "16px",
          }}
        >
          <span style={{ color: "var(--text-muted)", fontWeight: 600 }}>Email</span>
          <span style={{ color: "var(--brand-primary)", fontWeight: 800, textAlign: "right", wordBreak: "break-all" }}>
            Bugtraces@gmail.com
          </span>
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: "12px",
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
            gap: "12px",
            borderBottom: "1px solid var(--border-glass)",
            paddingBottom: "16px",
          }}
        >
          <span style={{ color: "var(--text-muted)", fontWeight: 600 }}>Version</span>
          <span style={{ color: "var(--text-main)", fontWeight: 800 }}>v{packageJson.version}</span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", gap: "12px" }}>
          <span style={{ color: "var(--text-muted)", fontWeight: 600 }}>Build date</span>
          <span style={{ color: "var(--text-main)", fontWeight: 800 }}>{new Date().toLocaleDateString("en-GB")}</span>
        </div>
      </div>

      {isWeb ? (
        <div
          style={{
            marginTop: "8px",
            paddingTop: "16px",
            borderTop: "1px solid var(--border-light)",
            display: "flex",
            flexDirection: "column",
            gap: "10px",
          }}
        >
          {updatePending ? (
            <div
              style={{
                padding: "10px 12px",
                borderRadius: "8px",
                background: "#dbeafe",
                color: "#1e3a8a",
                fontSize: "13px",
                fontWeight: 600,
              }}
            >
              A newer version is waiting. Tap Update PWA to refresh.
            </div>
          ) : null}
          <button
            type="button"
            onClick={() => void updatePwa()}
            disabled={busy}
            style={{
              width: "100%",
              padding: "12px",
              borderRadius: "8px",
              border: "1px solid var(--border-glass)",
              background: updatePending ? "#1d4ed8" : "var(--bg-app)",
              color: updatePending ? "#fff" : "var(--brand-primary)",
              fontWeight: 700,
              cursor: busy ? "wait" : "pointer",
            }}
          >
            {busy ? "Checking…" : updatePending ? "Update PWA Now" : "Check / Update PWA"}
          </button>
          {message ? <p style={{ margin: 0, fontSize: "13px", color: "var(--text-muted)" }}>{message}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
