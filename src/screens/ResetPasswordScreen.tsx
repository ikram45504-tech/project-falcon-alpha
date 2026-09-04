import { FormEvent, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import TravelHisabLogo from "../TravelHisabLogo";
import { COMPANY_NAME, PRODUCT_NAME } from "../brand";
import { useAuth } from "../AuthContext";
import { supabase } from "../supabaseClient";
import { validateStrongPassword } from "../db";
import { stripRecoveryTokensFromUrl } from "../authSessionFlags";

function passwordChecks(value: string) {
  return {
    length: value.length >= 8,
    upper: /[A-Z]/.test(value),
    lower: /[a-z]/.test(value),
    number: /[0-9]/.test(value),
    special: /[!@#$%^&*]/.test(value),
  };
}

export default function ResetPasswordScreen() {
  const navigate = useNavigate();
  const { authGate, logout, finishPasswordRecovery } = useAuth();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [hasSession, setHasSession] = useState(authGate === "recovery");
  const [checking, setChecking] = useState(authGate !== "recovery");

  const checks = useMemo(() => passwordChecks(password), [password]);

  useEffect(() => {
    document.documentElement.classList.add("auth-screen");
    return () => document.documentElement.classList.remove("auth-screen");
  }, []);

  useEffect(() => {
    let mounted = true;
    async function checkSession() {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!mounted) return;
      setHasSession(Boolean(session) || authGate === "recovery");
      setChecking(false);
    }
    void checkSession();
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY" || session) {
        setHasSession(true);
        setChecking(false);
      }
    });
    return () => {
      mounted = false;
      data.subscription.unsubscribe();
    };
  }, [authGate]);

  const savePassword = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (password !== confirmPassword) {
        throw new Error("Passwords do not match.");
      }
      validateStrongPassword(password);
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) throw new Error(updateError.message);
      stripRecoveryTokensFromUrl("/login");
      await finishPasswordRecovery();
      navigate("/login", { replace: true, state: { passwordUpdated: true } });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const cancelReset = async () => {
    stripRecoveryTokensFromUrl("/login");
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
        <h1>Set a new password</h1>
        <p className="muted auth-login-lead">Choose a new password for your Travel Hisab account.</p>

        {error && <div className="alert error">{error}</div>}

        {checking ? (
          <p className="muted auth-login-lead">Opening reset link...</p>
        ) : !hasSession ? (
          <>
            <div className="alert error">This reset link is invalid or has expired. Request a new one.</div>
            <button className="primary" type="button" onClick={() => navigate("/forgot-password")}>
              Request a new link
            </button>
          </>
        ) : (
          <form onSubmit={(e) => void savePassword(e)}>
            <label>
              New password
              <div className="password-input-wrap-v8b">
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="new-password"
                  autoFocus
                />
                <button
                  className="password-eye-v8b"
                  type="button"
                  onClick={() => setShowPassword((value) => !value)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? "Hide" : "Show"}
                </button>
              </div>
            </label>
            <label>
              Confirm password
              <input
                type={showPassword ? "text" : "password"}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                autoComplete="new-password"
              />
            </label>
            <div className="password-rules-v8b auth-setup-rules-compact">
              <span className={checks.length ? "ok" : ""}>8+ chars</span>
              <span className={checks.upper ? "ok" : ""}>A-Z</span>
              <span className={checks.lower ? "ok" : ""}>a-z</span>
              <span className={checks.number ? "ok" : ""}>0-9</span>
              <span className={checks.special ? "ok" : ""}>!@#$</span>
            </div>
            <button className="primary" type="submit" disabled={busy}>
              {busy ? "Saving..." : "Update password"}
            </button>
          </form>
        )}

        <button className="create-company-login-button" type="button" onClick={() => void cancelReset()}>
          Back to Sign In
        </button>
        <p className="auth-login-footer">
          {PRODUCT_NAME} by {COMPANY_NAME}
        </p>
      </section>
    </main>
  );
}
