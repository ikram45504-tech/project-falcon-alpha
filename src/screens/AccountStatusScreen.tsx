import { useEffect, useState } from "react";
import TravelHisabLogo from "../TravelHisabLogo";
import { COMPANY_NAME, PRODUCT_NAME } from "../brand";
import { useAuth } from "../AuthContext";
import { companyStatusLabel } from "../companyEntitlements";
import { supabase } from "../supabaseClient";

export default function AccountStatusScreen() {
  const { company, session, logout, refreshAuth, setSessionData } = useAuth();
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const status = String(company?.status || "").toUpperCase();
  const pending = status === "PENDING_APPROVAL";
  const suspended = status === "SUSPENDED";

  useEffect(() => {
    document.documentElement.classList.add("auth-screen");
    return () => document.documentElement.classList.remove("auth-screen");
  }, []);

  useEffect(() => {
    if (!company?.id || status === "ACTIVE") return;

    let cancelled = false;
    const poll = async () => {
      setChecking(true);
      try {
        const { data } = await supabase
          .from("companies")
          .select(
            "id, company_code, name, dts_license, logo_data, address, phone, whatsapp, email, base_currency, foreign_currency, status, entitlements, access_ends_at, created_at, updated_at",
          )
          .eq("id", company.id)
          .maybeSingle();
        if (cancelled || !data || !session) return;
        const nextStatus = String(data.status || "").toUpperCase();
        if (nextStatus === String(company.status || "").toUpperCase()) return;
        setSessionData(session, data as typeof company);
        if (nextStatus === "ACTIVE") {
          await refreshAuth();
        }
      } catch {
        // Keep waiting silently; user can still sign out.
      } finally {
        if (!cancelled) setChecking(false);
      }
    };

    void poll();
    const timer = window.setInterval(() => void poll(), 8000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [company, company?.id, company?.status, refreshAuth, session, setSessionData, status]);

  const title = pending ? "Registration under review" : suspended ? "Account suspended" : "Account not active";

  const lead = pending
    ? `Your request has been delivered to the relevant department at ${COMPANY_NAME}. They will contact you shortly once your account is activated.`
    : suspended
      ? `This company account is suspended (including after a trial or access period ends). Please contact ${COMPANY_NAME} if you need it reactivated.`
      : `This company cannot open the workspace right now. Please contact ${COMPANY_NAME} for help.`;

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
          {pending ? (
            <div className="muted" style={{ marginTop: 8 }}>
              {checking ? "Checking for approval..." : "This page updates automatically when approved."}
            </div>
          ) : null}
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
