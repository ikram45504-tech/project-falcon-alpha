import { useEffect, useState } from "react";
import TravelHisabLogo from "../TravelHisabLogo";
import { COMPANY_NAME, PRODUCT_NAME } from "../brand";
import { useAuth } from "../AuthContext";
import { companyStatusLabel } from "../companyEntitlements";

export default function AccountStatusScreen() {
  const { company, session, logout } = useAuth();
  const [busy, setBusy] = useState(false);
  const status = String(company?.status || "").toUpperCase();
  const pending = status === "PENDING_APPROVAL";
  const suspended = status === "SUSPENDED";

  useEffect(() => {
    document.documentElement.classList.add("auth-screen");
    return () => document.documentElement.classList.remove("auth-screen");
  }, []);

  const title = pending ? "Waiting for Master approval" : suspended ? "Account suspended" : "Account not active";

  const lead = pending
    ? "Your company was created successfully. A Master account must approve it before you can open Travel Hisab."
    : suspended
      ? "This company is suspended. Contact Travel Hisab support if you need it reactivated."
      : "This company cannot open the workspace right now.";

  return (
    <main className="center auth-login-page-v8">
      <section className="card login auth-login-card-v8">
        <div className="mark product-logo-mark">
          <TravelHisabLogo size={52} />
        </div>
        <span className="eyebrow blue">{PRODUCT_NAME.toUpperCase()}</span>
        <h1>{title}</h1>
        <p className="muted auth-login-lead">{lead}</p>

        <div className="alert" style={{ textAlign: "left" }}>
          <div>
            <strong>{company?.name || "Company"}</strong>
          </div>
          <div className="muted">Code: {company?.company_code || "—"}</div>
          <div className="muted">Signed in as: {session?.email || session?.username || "—"}</div>
          <div className="muted">Status: {companyStatusLabel(status)}</div>
        </div>

        <button
          className="primary"
          type="button"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void logout().finally(() => setBusy(false));
          }}
        >
          {busy ? "Signing out..." : "Back to Sign In"}
        </button>
        <p className="auth-login-footer">
          {PRODUCT_NAME} by {COMPANY_NAME}
        </p>
      </section>
    </main>
  );
}
