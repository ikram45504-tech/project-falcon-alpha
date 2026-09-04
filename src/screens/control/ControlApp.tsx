import { useEffect, useRef, useState } from "react";
import { Link, Navigate, Route, Routes, useNavigate } from "react-router-dom";
import type { Session } from "@supabase/supabase-js";
import TravelHisabLogo from "../../TravelHisabLogo";
import { PRODUCT_NAME } from "../../brand";
import { supabase } from "../../supabaseClient";
import { isPlatformMaster } from "../../platformMaster";
import { clearAuthStorage } from "../../desktopReset";
import MasterLoginScreen from "./MasterLoginScreen";
import ControlHomeScreen from "./ControlHomeScreen";
import { useControlTheme } from "./controlTheme";
import "./ControlPanel.css";

function ControlGate() {
  const navigate = useNavigate();
  const { theme, setTheme } = useControlTheme();
  const [checking, setChecking] = useState(true);
  const [allowed, setAllowed] = useState(false);
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

    async function applySession(session: Session | null, options?: { showChecking?: boolean; soft?: boolean }) {
      const showChecking = Boolean(options?.showChecking);
      const soft = Boolean(options?.soft);
      const gen = ++applyGen;

      if (showChecking) {
        setChecking(true);
        setError("");
      }

      try {
        if (!session?.user) {
          if (!mounted || gen !== applyGen) return;
          // Tab focus / token refresh can briefly report no session — do not kick an active Master out.
          if (soft && allowedRef.current) {
            setChecking(false);
            return;
          }
          allowedRef.current = false;
          setAllowed(false);
          setEmail("");
          setError("");
          setChecking(false);
          return;
        }

        const master = await isPlatformMaster();
        if (!mounted || gen !== applyGen) return;

        if (!master) {
          // Network blip on tab switch: keep the existing Master session.
          if (soft && allowedRef.current) {
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
        if (soft && allowedRef.current) {
          setChecking(false);
          return;
        }
        setError(err instanceof Error ? err.message : String(err));
        allowedRef.current = false;
        setAllowed(false);
        setChecking(false);
      }
    }

    void (async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      await applySession(session, { showChecking: true });
    })();

    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      // Use the event session — do not call getSession() inside this callback (lock/race).
      if (event === "SIGNED_OUT") {
        void applySession(null);
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
      if (event === "SIGNED_IN") {
        void applySession(session, { showChecking: true });
        return;
      }
      // INITIAL_SESSION and other events: soft apply so tab focus cannot bounce to login.
      void applySession(session, { soft: true });
    });

    return () => {
      mounted = false;
      data.subscription.unsubscribe();
    };
  }, []);

  const signOutMaster = async () => {
    await supabase.auth.signOut();
    clearAuthStorage();
    navigate("/control/login", { replace: true });
  };

  if (checking) {
    return (
      <main className="master-control-page" data-control-theme={theme}>
        <section className="card master-control-card">
          <div className="mark product-logo-mark">
            <TravelHisabLogo size={48} />
          </div>
          <h1>{PRODUCT_NAME}</h1>
          <p className="muted">Checking Master access...</p>
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
