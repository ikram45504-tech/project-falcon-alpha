import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import TravelHisabLogo from "../../TravelHisabLogo";
import { COMPANY_NAME, PRODUCT_NAME } from "../../brand";
import { googleAuthErrorFromUrl, signInWithGoogleAsMaster } from "../../cloudAuth";
import { supabaseMaster } from "../../supabaseClient";
import { isPlatformMaster } from "../../platformMaster";
import { CONTROL_POST_LOGIN_CACHE_RESET_KEY, hardResetPwaCache } from "../../registerPwa";
import { useControlTheme } from "./controlTheme";
import "./ControlPanel.css";

export default function MasterLoginScreen() {
  const location = useLocation();
  const navigate = useNavigate();
  const { theme, setTheme } = useControlTheme();
  const [busy, setBusy] = useState(false);
  const [cacheBusy, setCacheBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    document.documentElement.classList.add("master-control-screen");
    return () => {
      document.documentElement.classList.remove("master-control-screen");
    };
  }, []);

  useEffect(() => {
    const oauthError = googleAuthErrorFromUrl(location.search);
    if (oauthError) setError(oauthError);
  }, [location.search]);

  useEffect(() => {
    let mounted = true;
    void (async () => {
      const {
        data: { session },
      } = await supabaseMaster.auth.getSession();
      if (!session?.user || !mounted) return;
      const master = await isPlatformMaster();
      if (master && mounted) navigate("/control", { replace: true });
    })();
    return () => {
      mounted = false;
    };
  }, [navigate]);

  const startMasterGoogle = async () => {
    setBusy(true);
    setError("");
    try {
      sessionStorage.setItem(CONTROL_POST_LOGIN_CACHE_RESET_KEY, "1");
      await signInWithGoogleAsMaster();
    } catch (err) {
      sessionStorage.removeItem(CONTROL_POST_LOGIN_CACHE_RESET_KEY);
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  return (
    <main className="master-control-page" data-control-theme={theme}>
      <section className="card master-control-card">
        <div className="master-login-brand">
          <div className="mark product-logo-mark">
            <TravelHisabLogo size={52} />
          </div>
          <h1>Control Panel</h1>
          <span className="eyebrow">MASTER ACCOUNT</span>
          <p className="muted auth-login-lead">
            Sign in with a Master Google account to approve companies and set capacity. This is not the agency Travel
            Hisab workspace.
          </p>
        </div>

        <div className="master-theme-switch master-login-theme" role="group" aria-label="Control Panel theme">
          <button type="button" className={theme === "dark" ? "active" : ""} onClick={() => setTheme("dark")}>
            Dark
          </button>
          <button type="button" className={theme === "ocean" ? "active" : ""} onClick={() => setTheme("ocean")}>
            Ocean
          </button>
        </div>

        {error && <div className="alert error">{error}</div>}

        <button className="primary" type="button" disabled={busy || cacheBusy} onClick={() => void startMasterGoogle()}>
          {busy ? "Opening Google..." : "Continue with Google"}
        </button>

        <button
          className="ghost master-cache-refresh master-login-cache"
          type="button"
          disabled={busy || cacheBusy}
          title="Clear PWA/browser cache and reload the latest deployment"
          onClick={() => {
            setCacheBusy(true);
            void hardResetPwaCache({ path: "/control/login" });
          }}
        >
          {cacheBusy ? "Updating…" : "Clear cache & reload"}
        </button>

        <p className="muted master-login-agency-hint">
          Agency users should use{" "}
          <Link to="/login" className="master-inline-link">
            company Sign In
          </Link>
          .
        </p>
        <p className="auth-login-footer">
          {PRODUCT_NAME} by {COMPANY_NAME}
        </p>
      </section>
    </main>
  );
}
