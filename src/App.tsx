import { useState } from "react";
import "./App.css";
import "./App.mobile.css";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { AuthProvider, useAuth } from "./AuthContext";
import { isPasswordRecoveryCompleted } from "./authSessionFlags";
import { WorkspaceProvider } from "./WorkspaceContext";
import TravelHisabLogo from "./TravelHisabLogo";
import { PRODUCT_NAME } from "./brand";
import { usePhoneUi } from "./phoneUi";
import { useWorkspaceLayoutState } from "./layout/useWorkspaceLayoutState";
import { DesktopAppLayout } from "./desktop/DesktopAppLayout";
import { MobileAppLayout } from "./mobile/MobileAppLayout";
import CapacityLimitDialog from "./CapacityLimitDialog";
import { isOfflineOnlyBuild } from "./appMode";

import LoginScreen from "./screens/LoginScreen";
import SetupScreen from "./screens/SetupScreen";
import ForgotPasswordScreen from "./screens/ForgotPasswordScreen";
import ResetPasswordScreen from "./screens/ResetPasswordScreen";
import GoogleLinkCompanyScreen from "./screens/GoogleLinkCompanyScreen";
import AccountStatusScreen from "./screens/AccountStatusScreen";
import ControlApp from "./screens/control/ControlApp";
import { companyAllowsWorkspace } from "./companyStatus";

function AppLayout() {
  const isPhone = usePhoneUi();
  const state = useWorkspaceLayoutState();

  if (isPhone) {
    return (
      <>
        <MobileAppLayout state={state} />
        <CapacityLimitDialog />
      </>
    );
  }

  return (
    <>
      <DesktopAppLayout state={state} />
      <CapacityLimitDialog />
    </>
  );
}

function RouterContent() {
  const { isInitialized, session, company, error, authGate } = useAuth();
  const [accountCreatedNotice, setAccountCreatedNotice] = useState<any>(null);
  const location = useLocation();
  const offline = isOfflineOnlyBuild();
  const onControlPath = location.pathname.replace(/\/$/, "").startsWith("/control");

  if (!offline && onControlPath) {
    return <ControlApp />;
  }

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

  const onResetPath = location.pathname.replace(/\/$/, "") === "/reset-password";
  const recoveryDone = isPasswordRecoveryCompleted();

  if (recoveryDone && onResetPath) {
    return <Navigate to="/login" replace state={{ passwordUpdated: true }} />;
  }

  if (!recoveryDone && (authGate === "recovery" || onResetPath)) {
    return (
      <Routes>
        <Route path="/reset-password" element={<ResetPasswordScreen />} />
        <Route path="*" element={<Navigate to="/reset-password" replace />} />
      </Routes>
    );
  }

  if (authGate === "google-link") {
    return (
      <Routes>
        <Route path="/setup" element={<SetupScreen onAccountCreated={setAccountCreatedNotice} />} />
        <Route path="/auth/google-link" element={<GoogleLinkCompanyScreen />} />
        <Route path="*" element={<Navigate to="/auth/google-link" replace />} />
      </Routes>
    );
  }

  if (session && company && !companyAllowsWorkspace(company.status)) {
    return <AccountStatusScreen />;
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
        {!offline && <Route path="/forgot-password" element={<ForgotPasswordScreen />} />}
        {!offline && <Route path="/reset-password" element={<ResetPasswordScreen />} />}
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
