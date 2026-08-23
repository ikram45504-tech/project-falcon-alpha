import React, { createContext, useContext, useEffect, useState } from "react";
import { supabase } from "./supabaseClient";
import { Company, UserSession, initDatabase, startBackgroundSync } from "./db";

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

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [isInitialized, setIsInitialized] = useState(false);
  const [session, setSession] = useState<UserSession | null>(null);
  const [company, setCompany] = useState<Company | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let mounted = true;
    let authSubscription: any = null;

    async function loadSupabaseSession(supabaseUser: any) {
      if (!supabaseUser) {
        if (mounted) {
          setSession(null);
          setCompany(null);
          setIsInitialized(true);
        }
        return;
      }

      try {
        const metadata = supabaseUser.user_metadata || {};
        const companyId = metadata.company_id || "";
        const role = metadata.role || "VIEW_ONLY";

        const newSession: UserSession = {
          userId: supabaseUser.id,
          companyId,
          companyCode: metadata.company_code || "",
          companyName: metadata.company_name || "",
          fullName: metadata.full_name || "",
          username: metadata.username || "",
          email: supabaseUser.email || "",
          phone: metadata.phone || "",
          role,
        };

        const { data: companyData, error: companyError } = await supabase
          .from("companies")
          .select("*")
          .eq("id", companyId)
          .single();

        if (companyError || !companyData) {
          throw new Error("Could not load company profile from cloud database.");
        }

        if (mounted) {
          setSession(newSession);
          setCompany(companyData as Company);
          setIsInitialized(true);
        }
      } catch (err) {
        if (mounted) {
          setError(err instanceof Error ? err.message : String(err));
          setIsInitialized(true);
        }
      }
    }

    async function initialize() {
      try {
        await initDatabase(); // Keep local DB running for unmigrated modules
        await startBackgroundSync(); // Start offline-first sync engine

        const {
          data: { session: currentSession },
        } = await supabase.auth.getSession();
        await loadSupabaseSession(currentSession?.user);

        const {
          data: { subscription },
        } = supabase.auth.onAuthStateChange((_event, currentSession) => {
          loadSupabaseSession(currentSession?.user);
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
      if (authSubscription) {
        authSubscription.unsubscribe();
      }
    };
  }, []);

  const setSessionData = (newSession: UserSession | null, newCompany: Company | null) => {
    setSession(newSession);
    setCompany(newCompany);
  };

  const logout = async () => {
    await supabase.auth.signOut();

    // Clear legacy tokens if any
    localStorage.removeItem("travelAccountingRememberToken");
    localStorage.removeItem("travelAccountingLastCompanyCode");
    localStorage.removeItem("travelAccountingLastIdentifier");

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
