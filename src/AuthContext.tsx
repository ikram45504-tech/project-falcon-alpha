import React, { createContext, useContext, useEffect, useState } from "react";
import {
  Company,
  UserSession,
  getCompanyById,
  initDatabase,
  restoreRememberedSession,
  revokeRememberedSession,
} from "./db";

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
    (async () => {
      try {
        await initDatabase();
        const rememberedToken = localStorage.getItem("travelAccountingRememberToken") || "";
        if (rememberedToken) {
          const restored = await restoreRememberedSession(rememberedToken);
          if (restored) {
            const linkedCompany = await getCompanyById(restored.companyId);
            if (linkedCompany) {
              setSession(restored);
              setCompany(linkedCompany);
              setIsInitialized(true);
              return;
            }
          }
          localStorage.removeItem("travelAccountingRememberToken");
        }
      } catch (e) {
        setError(`Workspace could not start: ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        setIsInitialized(true);
      }
    })();
  }, []);

  const setSessionData = (newSession: UserSession | null, newCompany: Company | null) => {
    setSession(newSession);
    setCompany(newCompany);
  };

  const logout = async () => {
    const rememberToken = localStorage.getItem("travelAccountingRememberToken") || "";
    if (rememberToken) {
      try {
        await revokeRememberedSession(rememberToken);
      } catch {
        // Signing out should still clear the device session locally.
      }
    }
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
