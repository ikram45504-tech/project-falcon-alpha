import React, { createContext, useContext, useEffect, useRef, useState } from "react";
import { supabase } from "./supabaseClient";
import { isOfflineOnlyBuild } from "./appMode";
import {
  Company,
  UserSession,
  initDatabase,
  startBackgroundSync,
  setBackgroundSyncCompanyId,
  syncCloudSessionToLocal,
  isCompanySetupInProgress,
  restoreLocalSession,
  OFFLINE_SESSION_STORAGE_KEY,
} from "./db";
import { clearAgencyAuthStorage } from "./desktopReset";
import { UserRole } from "./permissions";
import {
  clearPasswordRecoveryPending,
  isPasswordRecoveryCompleted,
  isPasswordRecoveryPending,
  markPasswordRecoveryCompleted,
  markPasswordRecoveryPending,
  urlLooksLikePasswordRecovery,
} from "./authSessionFlags";
import { applyCompanyAccessExpiry } from "./companyAccess";

const USER_ROLES: UserRole[] = ["OWNER", "ADMIN", "ACCOUNTS", "DATA_ENTRY", "VIEW_ONLY"];

export type AuthGate = "none" | "recovery" | "google-link";

function normalizeUserRole(value: string): UserRole {
  const upper = value.trim().toUpperCase();
  return USER_ROLES.includes(upper as UserRole) ? (upper as UserRole) : "VIEW_ONLY";
}

/** Master Control Panel uses its own gate — agency auth must not clear the shared Supabase session. */
function isControlPanelPath() {
  if (typeof window === "undefined") return false;
  return window.location.pathname.replace(/\/$/, "").startsWith("/control");
}

type AuthContextType = {
  isInitialized: boolean;
  session: UserSession | null;
  company: Company | null;
  error: string;
  authGate: AuthGate;
  pendingAuthEmail: string;
  setError: (msg: string) => void;
  setSessionData: (session: UserSession | null, company: Company | null) => void;
  logout: () => Promise<void>;
  finishPasswordRecovery: () => Promise<void>;
  refreshAuth: () => Promise<void>;
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

type SupabaseAuthUser = {
  id: string;
  email?: string;
  user_metadata?: Record<string, unknown>;
  app_metadata?: Record<string, unknown>;
  identities?: Array<{ provider?: string }>;
};

function isGoogleAuthUser(user: SupabaseAuthUser) {
  const identities = Array.isArray(user.identities) ? user.identities : [];
  if (identities.some((identity) => identity?.provider === "google")) return true;
  const metadata = user.app_metadata || {};
  if (metadata.provider === "google") return true;
  const providers = metadata.providers;
  return Array.isArray(providers) && providers.some((provider) => provider === "google");
}

async function resolveAuthUser(): Promise<SupabaseAuthUser | null> {
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) return null;
  return user as SupabaseAuthUser;
}

async function resolveCompanyId(user: SupabaseAuthUser) {
  const metadata = user.user_metadata || {};
  let companyId = String(metadata.company_id || "").trim();
  let role = normalizeUserRole(String(metadata.role || "VIEW_ONLY"));
  let fullName = String(metadata.full_name || "");
  let username = String(metadata.username || "");
  let phone = String(metadata.phone || "");
  let companyCode = String(metadata.company_code || "");
  let companyName = String(metadata.company_name || "");

  if (!companyId) {
    const { data: userRow, error: userError } = await supabase
      .from("users")
      .select("company_id, role, full_name, username, phone")
      .eq("id", user.id)
      .maybeSingle();

    if (!userError && userRow?.company_id) {
      companyId = String(userRow.company_id);
      role = normalizeUserRole(String(userRow.role || role));
      fullName = String(userRow.full_name || fullName);
      username = String(userRow.username || username);
      phone = String(userRow.phone || phone);
    }
  }

  if (companyId && (!companyCode || !companyName)) {
    const { data: companyRow } = await supabase
      .from("companies")
      .select("company_code, name")
      .eq("id", companyId)
      .maybeSingle();
    if (companyRow) {
      companyCode = String(companyRow.company_code || companyCode);
      companyName = String(companyRow.name || companyName);
    }
  }

  return {
    companyId,
    role,
    fullName,
    username,
    phone,
    companyCode,
    companyName,
  };
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [isInitialized, setIsInitialized] = useState(false);
  const [session, setSession] = useState<UserSession | null>(null);
  const [company, setCompany] = useState<Company | null>(null);
  const [error, setError] = useState("");
  const [authGate, setAuthGate] = useState<AuthGate>("none");
  const [pendingAuthEmail, setPendingAuthEmail] = useState("");
  const authGateRef = useRef<AuthGate>("none");
  const refreshAuthRef = useRef<() => Promise<void>>(async () => {});

  useEffect(() => {
    authGateRef.current = authGate;
  }, [authGate]);

  useEffect(() => {
    let mounted = true;
    let authSubscription: { unsubscribe: () => void } | null = null;
    let loadGen = 0;

    function enterRecovery(email = "") {
      if (isPasswordRecoveryCompleted()) return;
      markPasswordRecoveryPending();
      authGateRef.current = "recovery";
      if (!mounted) return;
      setAuthGate("recovery");
      setPendingAuthEmail(email);
      setSession(null);
      setCompany(null);
      setError("");
      setIsInitialized(true);
    }

    function enterGoogleLink(email = "") {
      authGateRef.current = "google-link";
      if (!mounted) return;
      setAuthGate("google-link");
      setPendingAuthEmail(email);
      setSession(null);
      setCompany(null);
      setError("");
      setIsInitialized(true);
    }

    async function loadSupabaseSession(
      initialUser: SupabaseAuthUser | null | undefined,
      options?: { force?: boolean },
    ) {
      const gen = ++loadGen;
      const force = Boolean(options?.force);

      if (!initialUser) {
        if (!isPasswordRecoveryCompleted() && (urlLooksLikePasswordRecovery() || isPasswordRecoveryPending())) {
          enterRecovery("");
          return;
        }
        if (!mounted || gen !== loadGen) return;
        clearPasswordRecoveryPending();
        authGateRef.current = "none";
        setAuthGate("none");
        setPendingAuthEmail("");
        setSession(null);
        setCompany(null);
        setError("");
        setIsInitialized(true);
        return;
      }

      if (!isPasswordRecoveryCompleted() && (urlLooksLikePasswordRecovery() || isPasswordRecoveryPending())) {
        enterRecovery(initialUser.email || "");
        return;
      }

      // /control is Master-only UI. Never sign out or force google-link here.
      if (isControlPanelPath()) {
        if (!mounted || gen !== loadGen) return;
        clearPasswordRecoveryPending();
        authGateRef.current = "none";
        setAuthGate("none");
        setPendingAuthEmail("");
        setSession(null);
        setCompany(null);
        setError("");
        setIsInitialized(true);
        return;
      }

      if (!force && authGateRef.current === "google-link") {
        enterGoogleLink(initialUser.email || "");
        return;
      }

      try {
        // Prefer the auth event user so we skip an extra refresh round-trip (pending screens feel late otherwise).
        const user = (initialUser as SupabaseAuthUser | null) || (await resolveAuthUser());
        if (!mounted || gen !== loadGen) return;
        if (!user) {
          clearPasswordRecoveryPending();
          authGateRef.current = "none";
          setAuthGate("none");
          setPendingAuthEmail("");
          setSession(null);
          setCompany(null);
          setError("");
          setIsInitialized(true);
          return;
        }
        const profile = await resolveCompanyId(user);

        if (!profile.companyId) {
          if (isCompanySetupInProgress()) {
            if (!mounted || gen !== loadGen) return;
            setSession(null);
            setCompany(null);
            setError("");
            setIsInitialized(true);
            return;
          }

          if (isGoogleAuthUser(user)) {
            enterGoogleLink(user.email || "");
            return;
          }

          await supabase.auth.signOut({ scope: "local" });
          clearAgencyAuthStorage();
          if (!mounted || gen !== loadGen) return;
          authGateRef.current = "none";
          setAuthGate("none");
          setPendingAuthEmail("");
          setSession(null);
          setCompany(null);
          setError("");
          setIsInitialized(true);
          return;
        }

        const newSession: UserSession = {
          userId: user.id,
          companyId: profile.companyId,
          companyCode: profile.companyCode,
          companyName: profile.companyName,
          fullName: profile.fullName,
          username: profile.username,
          email: user.email || "",
          phone: profile.phone,
          role: profile.role,
        };

        const { data: companyData, error: companyError } = await supabase
          .from("companies")
          .select(
            "id, company_code, name, dts_license, logo_data, address, phone, whatsapp, email, base_currency, foreign_currency, status, entitlements, access_ends_at, created_at, updated_at",
          )
          .eq("id", profile.companyId)
          .maybeSingle();

        if (companyError) {
          throw new Error(companyError.message);
        }

        if (!companyData) {
          if (isCompanySetupInProgress()) {
            if (!mounted || gen !== loadGen) return;
            setSession(null);
            setCompany(null);
            setError("");
            setIsInitialized(true);
            return;
          }

          if (isGoogleAuthUser(user)) {
            enterGoogleLink(user.email || "");
            return;
          }

          await supabase.auth.signOut({ scope: "local" });
          clearAgencyAuthStorage();
          if (!mounted || gen !== loadGen) return;
          authGateRef.current = "none";
          setAuthGate("none");
          setPendingAuthEmail("");
          setSession(null);
          setCompany(null);
          setError("");
          setIsInitialized(true);
          return;
        }

        // Auto-suspend when trial/access end date has passed.
        try {
          const expiry = await applyCompanyAccessExpiry(profile.companyId);
          if (expiry?.changed) {
            (companyData as Company).status = "SUSPENDED";
          }
        } catch {
          // Non-blocking — status check below still applies.
        }

        if (!mounted || gen !== loadGen) return;

        const companyStatus = String((companyData as Company).status || "").toUpperCase();
        if (companyStatus !== "ACTIVE") {
          setBackgroundSyncCompanyId("");
          authGateRef.current = "none";
          setAuthGate("none");
          setPendingAuthEmail("");
          setSession(newSession);
          setCompany(companyData as Company);
          setError("");
          setIsInitialized(true);
          return;
        }

        await syncCloudSessionToLocal(companyData as Company, newSession);
        setBackgroundSyncCompanyId(profile.companyId);
        authGateRef.current = "none";
        setAuthGate("none");
        setPendingAuthEmail("");
        setSession(newSession);
        setCompany(companyData as Company);
        setError("");
        setIsInitialized(true);
      } catch (err) {
        if (!mounted || gen !== loadGen) return;
        setError(err instanceof Error ? err.message : String(err));
        setSession(null);
        setCompany(null);
        setIsInitialized(true);
      }
    }

    refreshAuthRef.current = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      authGateRef.current = "none";
      await loadSupabaseSession(user as SupabaseAuthUser | null, { force: true });
    };

    async function initializeOffline() {
      try {
        await initDatabase();
        const raw = sessionStorage.getItem(OFFLINE_SESSION_STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw) as { userId?: string; companyId?: string };
          if (parsed.userId && parsed.companyId) {
            const restored = await restoreLocalSession(parsed.userId, parsed.companyId);
            if (restored && mounted) {
              setSession(restored.session);
              setCompany(restored.company);
            } else {
              sessionStorage.removeItem(OFFLINE_SESSION_STORAGE_KEY);
            }
          }
        }
        if (mounted) {
          setError("");
          setIsInitialized(true);
        }
      } catch (e) {
        if (mounted) {
          setError(`Workspace could not start: ${e instanceof Error ? e.message : String(e)}`);
          setIsInitialized(true);
        }
      }
    }

    async function initialize() {
      if (isOfflineOnlyBuild()) {
        await initializeOffline();
        return;
      }

      try {
        await initDatabase();
        await startBackgroundSync();

        const {
          data: { session: currentSession },
        } = await supabase.auth.getSession();

        const {
          data: { subscription },
        } = supabase.auth.onAuthStateChange((event, currentSession) => {
          if (event === "PASSWORD_RECOVERY") {
            markPasswordRecoveryPending();
            enterRecovery(currentSession?.user?.email || "");
            return;
          }
          if (!isPasswordRecoveryCompleted() && (urlLooksLikePasswordRecovery() || isPasswordRecoveryPending())) {
            markPasswordRecoveryPending();
            enterRecovery(currentSession?.user?.email || "");
            return;
          }
          void loadSupabaseSession(currentSession?.user as SupabaseAuthUser | undefined);
        });
        authSubscription = subscription;

        if (!isPasswordRecoveryCompleted() && (urlLooksLikePasswordRecovery() || isPasswordRecoveryPending())) {
          enterRecovery(currentSession?.user?.email || "");
          return;
        }

        await loadSupabaseSession(currentSession?.user as SupabaseAuthUser | undefined);
      } catch (e) {
        if (mounted) {
          setError(`Workspace could not start: ${e instanceof Error ? e.message : String(e)}`);
          setIsInitialized(true);
        }
      }
    }

    initialize();

    return () => {
      mounted = false;
      authSubscription?.unsubscribe();
    };
  }, []);

  const setSessionData = (newSession: UserSession | null, newCompany: Company | null) => {
    setSession(newSession);
    setCompany(newCompany);
  };

  const logout = async () => {
    clearPasswordRecoveryPending();
    authGateRef.current = "none";
    setAuthGate("none");
    setPendingAuthEmail("");

    if (isOfflineOnlyBuild()) {
      sessionStorage.removeItem(OFFLINE_SESSION_STORAGE_KEY);
      clearAgencyAuthStorage();
      setBackgroundSyncCompanyId("");
      setSession(null);
      setCompany(null);
      setError("");
      return;
    }

    await supabase.auth.signOut();
    clearAgencyAuthStorage();
    setBackgroundSyncCompanyId("");
    setSession(null);
    setCompany(null);
    setError("");
  };

  const finishPasswordRecovery = async () => {
    markPasswordRecoveryCompleted();
    await logout();
  };

  const refreshAuth = async () => {
    await refreshAuthRef.current();
  };

  return (
    <AuthContext.Provider
      value={{
        isInitialized,
        session,
        company,
        error,
        authGate,
        pendingAuthEmail,
        setError,
        setSessionData,
        logout,
        finishPasswordRecovery,
        refreshAuth,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
