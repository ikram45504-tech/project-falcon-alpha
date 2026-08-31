import ReactDOM from "react-dom/client";
import App from "./App";
import { initializeDatabaseSafety } from "./DatabaseSafety";
import { ThemeProvider } from "./ThemeContext";
import { PRODUCT_NAME } from "./brand";
import { PwaChrome } from "./PwaChrome";
import "./mobile/mobileShell.css";

function renderSafetyFailure(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <main
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        padding: 32,
        fontFamily: "system-ui, sans-serif",
        background: "#f5f7fa",
      }}
    >
      <section
        style={{
          maxWidth: 680,
          background: "white",
          border: "1px solid #d9e0e8",
          borderRadius: 14,
          padding: 28,
          boxShadow: "0 12px 36px rgba(30, 50, 70, 0.08)",
        }}
      >
        <strong style={{ display: "block", color: "#b42318", marginBottom: 8 }}>DATABASE SAFETY CHECK FAILED</strong>
        <h1 style={{ margin: "0 0 12px", fontSize: 24 }}>{PRODUCT_NAME} did not open the workspace.</h1>
        <p style={{ margin: "0 0 10px", lineHeight: 1.55 }}>
          The app stopped before normal database initialization so existing accounting data is not exposed to an unsafe
          startup path.
        </p>
        <p style={{ margin: 0, lineHeight: 1.55, color: "#52606d", wordBreak: "break-word" }}>{message}</p>
      </section>
    </main>,
  );
}

async function bootstrap() {
  try {
    document.title = PRODUCT_NAME;
    const report = await initializeDatabaseSafety();
    if (report.duplicatePaymentDocuments > 0) {
      console.warn(
        `Database Safety: ${report.duplicatePaymentDocuments} duplicate payment document group(s) need cleanup before uniqueness can be enforced.`,
      );
    }
    ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
      <ThemeProvider>
        <PwaChrome />
        <App />
      </ThemeProvider>,
    );
  } catch (error) {
    console.error("Database safety bootstrap failed:", error);
    renderSafetyFailure(error);
  }
}

void bootstrap();
