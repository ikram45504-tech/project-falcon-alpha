import React, { createContext, useContext, useEffect, useState } from "react";
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
import { clearAuthStorage } from "./desktopReset";
import { UserRole } from "./permissions";

const USER_ROLES: UserRole[] = ["OWNER", "ADMIN", "ACCOUNTS", "DATA_ENTRY", "VIEW_ONLY"];

function normalizeUserRole(value: string): UserRole {
  const upper = value.trim().toUpperCase();
  return USER_ROLES.includes(upper as UserRole) ? (upper as UserRole) : "VIEW_ONLY";
}

type AuthContextType = {
  isInitialized: boolean;
  session: UserSession | null;
  company: Company | null;
  error: string;
  setError: (msg: string) => void;
  setSessionData: (session: UserSession | null, company: Company | null) => void;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

type SupabaseAuthUser = {
  id: string;
  email?: string;
  user_metadata?: Record<string, unknown>;
};

async function resolveAuthUser(): Promise<SupabaseAuthUser | null> {
  await supabase.auth.refreshSession();
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

  useEffect(() => {
    let mounted = true;
    let authSubscription: { unsubscribe: () => void } | null = null;

    async function loadSupabaseSession(initialUser: SupabaseAuthUser | null | undefined) {
      if (!initialUser) {
        if (mounted) {
          setSession(null);
          setCompany(null);
          setError("");
          setIsInitialized(true);
        }
        return;
      }

      try {
        const user = (await resolveAuthUser()) || initialUser;
        const profile = await resolveCompanyId(user);

        if (!profile.companyId) {
          if (isCompanySetupInProgress()) {
            if (mounted) {
              setSession(null);
              setCompany(null);
              setError("");
              setIsInitialized(true);
            }
            return;
          }

          await supabase.auth.signOut({ scope: "local" });
          clearAuthStorage();
          if (mounted) {
            setSession(null);
            setCompany(null);
            setError("");
            setIsInitialized(true);
          }
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
          .select("*")
          .eq("id", profile.companyId)
          .maybeSingle();

        if (companyError) {
          throw new Error(companyError.message);
        }

        if (!companyData) {
          if (isCompanySetupInProgress()) {
            if (mounted) {
              setSession(null);
              setCompany(null);
              setError("");
              setIsInitialized(true);
            }
            return;
          }

          await supabase.auth.signOut({ scope: "local" });
          clearAuthStorage();
          if (mounted) {
            setSession(null);
            setCompany(null);
            setError("");
            setIsInitialized(true);
          }
          return;
        }

        if (mounted) {
          await syncCloudSessionToLocal(companyData as Company, newSession);
          setBackgroundSyncCompanyId(profile.companyId);
          setSession(newSession);
          setCompany(companyData as Company);
          setError("");
          setIsInitialized(true);
        }
      } catch (err) {
        if (mounted) {
          setError(err instanceof Error ? err.message : String(err));
          setSession(null);
          setCompany(null);
          setIsInitialized(true);
        }
      }
    }

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
        await loadSupabaseSession(currentSession?.user as SupabaseAuthUser | undefined);

        const {
          data: { subscription },
        } = supabase.auth.onAuthStateChange((_event, currentSession) => {
          void loadSupabaseSession(currentSession?.user as SupabaseAuthUser | undefined);
        });
        authSubscription = subscription;
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
    if (isOfflineOnlyBuild()) {
      sessionStorage.removeItem(OFFLINE_SESSION_STORAGE_KEY);
      clearAuthStorage();
      setBackgroundSyncCompanyId("");
      setSession(null);
      setCompany(null);
      setError("");
      return;
    }

    await supabase.auth.signOut();
    clearAuthStorage();
    setBackgroundSyncCompanyId("");
    setSession(null);
    setCompany(null);
    setError("");
  };

  return (
    <AuthContext.Provider
      value={{
        isInitialized,
        session,
        company,
        error,
        setError,
        setSessionData,
        logout,
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
