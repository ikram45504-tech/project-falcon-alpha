import { FormEvent, useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import TravelHisabLogo from "../TravelHisabLogo";
import { COMPANY_NAME, PRODUCT_NAME } from "../brand";
import { requestPasswordReset } from "../cloudAuth";

export default function ForgotPasswordScreen() {
  const navigate = useNavigate();
  const location = useLocation();
  const prefill = (location.state || {}) as { companyCode?: string; identifier?: string };

  const [companyCode, setCompanyCode] = useState(prefill.companyCode || "");
  const [identifier, setIdentifier] = useState(prefill.identifier || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);

  useEffect(() => {
    document.documentElement.classList.add("auth-screen");
    return () => document.documentElement.classList.remove("auth-screen");
  }, []);

  const sendReset = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await requestPasswordReset(companyCode, identifier);
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="center auth-login-page-v8">
      <section className="card login auth-login-card-v8">
        <div className="mark product-logo-mark">
          <TravelHisabLogo size={52} />
        </div>
        <span className="eyebrow blue">{PRODUCT_NAME.toUpperCase()}</span>
        <h1>Forgot password</h1>
        <p className="muted auth-login-lead">
          Enter your Company Code and username or email. We will send a reset link to the email on the account.
        </p>

        {error && <div className="alert error">{error}</div>}
        {sent && (
          <div className="alert success">
            If this account has cloud login, we sent a reset link. Check your Gmail inbox and spam folder. Open the link
            on this same device. If no email arrives, ask your company admin to reset your password.
          </div>
        )}

        {!sent && (
          <form onSubmit={(e) => void sendReset(e)}>
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
            <label>
              Username or Email
              <input
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                placeholder="Enter username or email"
                autoComplete="username"
              />
            </label>
            <button className="primary" type="submit" disabled={busy}>
              {busy ? "Sending..." : "Send reset link"}
            </button>
          </form>
        )}

        <button className="create-company-login-button" type="button" onClick={() => navigate("/login")}>
          Back to Sign In
        </button>
        <p className="auth-login-footer">
          {PRODUCT_NAME} by {COMPANY_NAME}
        </p>
      </section>
    </main>
  );
}
