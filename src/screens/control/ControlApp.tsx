import { useEffect, useRef, useState } from "react";
import { Link, Navigate, Route, Routes, useNavigate } from "react-router-dom";
import type { Session } from "@supabase/supabase-js";
import TravelHisabLogo from "../../TravelHisabLogo";
import { PRODUCT_NAME } from "../../brand";
import { supabaseMaster } from "../../supabaseClient";
import { isPlatformMaster } from "../../platformMaster";
import { clearMasterAuthStorage } from "../../desktopReset";
import { CONTROL_POST_LOGIN_CACHE_RESET_KEY, hardResetPwaCache } from "../../registerPwa";
import MasterLoginScreen from "./MasterLoginScreen";
import ControlHomeScreen from "./ControlHomeScreen";
import { useControlTheme } from "./controlTheme";
import "./ControlPanel.css";

function ControlGate() {
  const navigate = useNavigate();
  const { theme, setTheme } = useControlTheme();
  const [checking, setChecking] = useState(true);
  const [allowed, setAllowed] = useState(false);
  const [cacheResetting, setCacheResetting] = useState(false);
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const allowedRef = useRef(false);

  useEffect(() => {
    document.documentElement.classList.add("master-control-screen");
    return () => document.documentElement.classList.remove("master-control-screen");
  }, []);

  useEffect(() => {
    let mounted = true;
    let applyGen = 0;

    async function applySession(session: Session | null, options?: { showChecking?: boolean }) {
      const showChecking = Boolean(options?.showChecking);
      const gen = ++applyGen;

      // Tab resume / token refresh must not unmount ControlHomeScreen or the desk resets.
      if (showChecking && !allowedRef.current) {
        setChecking(true);
        setError("");
      }

      try {
        if (!session?.user) {
          return;
        }

        const master = await isPlatformMaster();
        if (!mounted || gen !== applyGen) return;

        if (!master) {
          if (allowedRef.current) {
            setChecking(false);
            return;
          }
          allowedRef.current = false;
          setAllowed(false);
          setEmail(session.user.email || "");
          setError("This Google account is not a Master account.");
          setChecking(false);
          return;
        }

        allowedRef.current = true;
        setEmail(session.user.email || "");
        setAllowed(true);
        setError("");
        setChecking(false);
      } catch (err) {
        if (!mounted || gen !== applyGen) return;
        if (allowedRef.current) {
          setChecking(false);
          return;
        }
        setError(err instanceof Error ? err.message : String(err));
        allowedRef.current = false;
        setAllowed(false);
        setChecking(false);
      }
    }

    function markLoggedOut() {
      allowedRef.current = false;
      setAllowed(false);
      setEmail("");
      setError("");
      setChecking(false);
    }

    void (async () => {
      const {
        data: { session },
      } = await supabaseMaster.auth.getSession();
      if (!mounted) return;
      if (session?.user) {
        await applySession(session, { showChecking: true });
      } else {
        // No Master session — stop the checking spinner immediately (do not wait 4s).
        setChecking(false);
      }
    })();

    const { data } = supabaseMaster.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT") {
        markLoggedOut();
        return;
      }

      if (event === "TOKEN_REFRESHED" || event === "USER_UPDATED") {
        if (session?.user) {
          setEmail(session.user.email || "");
          allowedRef.current = true;
          setAllowed(true);
          setChecking(false);
        }
        return;
      }

      if (session?.user) {
        void applySession(session, {
          showChecking: (event === "SIGNED_IN" || event === "INITIAL_SESSION") && !allowedRef.current,
        });
      }
    });

    // If storage is slow to hydrate after tab resume, wait before treating as logged out.
    const settleTimer = window.setTimeout(() => {
      if (mounted && !allowedRef.current) {
        markLoggedOut();
      }
    }, 4000);

    return () => {
      mounted = false;
      window.clearTimeout(settleTimer);
      data.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!allowed) return;
    if (sessionStorage.getItem(CONTROL_POST_LOGIN_CACHE_RESET_KEY) !== "1") return;
    sessionStorage.setItem(CONTROL_POST_LOGIN_CACHE_RESET_KEY, "0");
    setCacheResetting(true);
    void hardResetPwaCache({ path: "/control" }).catch((err) => {
      console.warn("Post-login cache reset failed:", err);
      setCacheResetting(false);
    });
  }, [allowed]);

  const signOutMaster = async () => {
    sessionStorage.removeItem(CONTROL_POST_LOGIN_CACHE_RESET_KEY);
    await supabaseMaster.auth.signOut();
    clearMasterAuthStorage();
    navigate("/control/login", { replace: true });
  };

  if (checking || cacheResetting) {
    return (
      <main className="master-control-page" data-control-theme={theme}>
        <section className="card master-control-card">
          <div className="mark product-logo-mark">
            <TravelHisabLogo size={48} />
          </div>
          <h1>{PRODUCT_NAME}</h1>
          <p className="muted">{cacheResetting ? "Loading latest Control Panel…" : "Checking Master access..."}</p>
        </section>
      </main>
    );
  }

  if (!allowed) {
    if (!error) return <Navigate to="/control/login" replace />;
    return (
      <main className="master-control-page" data-control-theme={theme}>
        <section className="card master-control-card">
          <div className="mark product-logo-mark">
            <TravelHisabLogo size={48} />
          </div>
          <span className="eyebrow">MASTER ACCOUNT</span>
          <h1>Access denied</h1>
          <div className="alert error">{error}</div>
          {email && <p className="muted">Signed in as {email}</p>}
          <button className="primary" type="button" onClick={() => void signOutMaster()}>
            Sign out
          </button>
          <p className="muted" style={{ marginTop: 12 }}>
            <Link to="/login" className="master-inline-link">
              Agency Sign In
            </Link>
          </p>
        </section>
      </main>
    );
  }

  return (
    <div className="master-control-root" data-control-theme={theme}>
      <ControlHomeScreen
        masterEmail={email}
        theme={theme}
        onThemeChange={setTheme}
        onSignOut={() => void signOutMaster()}
      />
    </div>
  );
}

export default function ControlApp() {
  return (
    <Routes>
      <Route path="/control/login" element={<MasterLoginScreen />} />
      <Route path="/control" element={<ControlGate />} />
      <Route path="/control/*" element={<ControlGate />} />
      <Route path="*" element={<Navigate to="/control" replace />} />
    </Routes>
  );
}
