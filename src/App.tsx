import { useState } from "react";
import "./App.css";
import "./App.mobile.css";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { AuthProvider, useAuth } from "./AuthContext";
import { WorkspaceProvider } from "./WorkspaceContext";
import TravelHisabLogo from "./TravelHisabLogo";
import { PRODUCT_NAME } from "./brand";
import { usePhoneUi } from "./phoneUi";
import { useWorkspaceLayoutState } from "./layout/useWorkspaceLayoutState";
import { DesktopAppLayout } from "./desktop/DesktopAppLayout";
import { MobileAppLayout } from "./mobile/MobileAppLayout";

// Screens
import LoginScreen from "./screens/LoginScreen";
import SetupScreen from "./screens/SetupScreen";

function AppLayout() {
  const isPhone = usePhoneUi();
  const state = useWorkspaceLayoutState();

  if (isPhone) {
    return <MobileAppLayout state={state} />;
  }

  return <DesktopAppLayout state={state} />;
}

function RouterContent() {
  const { isInitialized, session, company, error } = useAuth();
  const [accountCreatedNotice, setAccountCreatedNotice] = useState<any>(null);
  const location = useLocation();

  if (!isInitialized) {
    return (
      <main className="center">
        <div className="card loading">
          <div className="mark product-logo-mark">
            <TravelHisabLogo size={52} />
          </div>
          <h1>{PRODUCT_NAME}</h1>
          <p>{error || "Preparing your workspace..."}</p>
        </div>
      </main>
    );
  }

  if (!session || !company) {
    return (
      <Routes>
        <Route path="/setup" element={<SetupScreen onAccountCreated={setAccountCreatedNotice} />} />
        <Route
          path="/login"
          element={
            <LoginScreen
              accountCreatedNotice={accountCreatedNotice}
              setAccountCreatedNotice={setAccountCreatedNotice}
            />
          }
        />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  if (location.pathname === "/login") {
    return <Navigate to="/" replace />;
  }

  return (
    <WorkspaceProvider>
      <AppLayout />
    </WorkspaceProvider>
  );
}

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <RouterContent />
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
