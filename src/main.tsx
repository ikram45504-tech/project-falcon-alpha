import ReactDOM from "react-dom/client";
import App from "./App";
import { initializeDatabaseSafety } from "./DatabaseSafety";

async function bootstrap() {
  try {
    const report = await initializeDatabaseSafety();
    if (report.duplicatePaymentDocuments > 0) {
      console.warn(`Database Safety: ${report.duplicatePaymentDocuments} duplicate payment document group(s) need cleanup before uniqueness can be enforced.`);
    }
  } catch (error) {
    // Browser-only Vite preview does not expose Tauri commands. The app still renders;
    // real Tauri startup will surface any database issue through the normal DB initializer.
    console.error("Database safety bootstrap could not complete:", error);
  }

  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(<App />);
}

void bootstrap();
