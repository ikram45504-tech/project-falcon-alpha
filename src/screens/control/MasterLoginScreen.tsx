import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import TravelHisabLogo from "../../TravelHisabLogo";
import { COMPANY_NAME, PRODUCT_NAME } from "../../brand";
import { googleAuthErrorFromUrl, signInWithGoogleAsMaster } from "../../cloudAuth";
import { supabase } from "../../supabaseClient";
import { isPlatformMaster } from "../../platformMaster";

export default function MasterLoginScreen() {
  const location = useLocation();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    document.documentElement.classList.add("auth-screen");
    return () => document.documentElement.classList.remove("auth-screen");
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
      } = await supabase.auth.getSession();
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
      await signInWithGoogleAsMaster();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  return (
    <main className="center master-control-page">
      <section className="card master-control-card">
        <div className="mark product-logo-mark">
          <TravelHisabLogo size={48} />
        </div>
        <span className="eyebrow">MASTER ACCOUNT</span>
        <h1>Control Panel</h1>
        <p className="muted auth-login-lead">
          Sign in with a Master Google account to approve companies and set capacity. This is not the agency Travel
          Hisab workspace.
        </p>

        {error && <div className="alert error">{error}</div>}

        <button className="primary" type="button" disabled={busy} onClick={() => void startMasterGoogle()}>
          {busy ? "Opening Google..." : "Continue with Google"}
        </button>

        <p className="muted" style={{ marginTop: 16, fontSize: 13 }}>
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
