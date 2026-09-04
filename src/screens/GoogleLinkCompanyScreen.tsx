import { FormEvent, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import TravelHisabLogo from "../TravelHisabLogo";
import { COMPANY_NAME, PRODUCT_NAME } from "../brand";
import { useAuth } from "../AuthContext";
import { linkCurrentAuthUserToCompany } from "../cloudAuth";

export default function GoogleLinkCompanyScreen() {
  const navigate = useNavigate();
  const { pendingAuthEmail, refreshAuth, logout } = useAuth();
  const [companyCode, setCompanyCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    document.documentElement.classList.add("auth-screen");
    return () => document.documentElement.classList.remove("auth-screen");
  }, []);

  const joinCompany = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await linkCurrentAuthUserToCompany(companyCode);
      await refreshAuth();
      navigate("/", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const useDifferentAccount = async () => {
    await logout();
    navigate("/login", { replace: true });
  };

  return (
    <main className="center auth-login-page-v8">
      <section className="card login auth-login-card-v8">
        <div className="mark product-logo-mark">
          <TravelHisabLogo size={52} />
        </div>
        <span className="eyebrow blue">{PRODUCT_NAME.toUpperCase()}</span>
        <h1>Link your company</h1>
        <p className="muted auth-login-lead">
          Signed in with Google{pendingAuthEmail ? ` as ${pendingAuthEmail}` : ""}. Enter your Company Code to join a
          company that already has this email, or create a new company.
        </p>

        {error && <div className="alert error">{error}</div>}

        <form onSubmit={(e) => void joinCompany(e)}>
          <label>
            Company Code
            <input
              autoFocus
              value={companyCode}
              onChange={(e) => setCompanyCode(e.target.value.toUpperCase())}
              placeholder="Enter Company Code"
              autoComplete="organization"
            />
          </label>
          <button className="primary" type="submit" disabled={busy}>
            {busy ? "Linking..." : "Join this company"}
          </button>
        </form>

        <div className="new-company-divider">
          <span>Or</span>
        </div>
        <button className="create-company-login-button" type="button" onClick={() => navigate("/setup")}>
          Create a new company
        </button>
        <button className="auth-text-button" type="button" onClick={() => void useDifferentAccount()}>
          Use a different account
        </button>
        <p className="auth-login-footer">
          {PRODUCT_NAME} by {COMPANY_NAME}
        </p>
      </section>
    </main>
  );
}
