import { FormEvent, useState, useEffect } from "react";
import { useBodyScrollLock } from "../useBodyScrollLock";
import { supabase } from "../supabaseClient";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../AuthContext";
import TravelHisabLogo from "../TravelHisabLogo";
import { COMPANY_NAME, PRODUCT_NAME, PRODUCT_TAGLINE } from "../brand";
import { resolveLoginEmail } from "../loginAuth";
import { isOfflineOnlyBuild } from "../appMode";
import { getCompanyById, loginUser, OFFLINE_SESSION_STORAGE_KEY } from "../db";

export default function LoginScreen({
  accountCreatedNotice,
  setAccountCreatedNotice,
}: {
  accountCreatedNotice: any;
  setAccountCreatedNotice: (n: any) => void;
}) {
  useBodyScrollLock(Boolean(accountCreatedNotice));

  const navigate = useNavigate();
  const { error: globalAuthError, setError: setGlobalAuthError, setSessionData } = useAuth();

  const [loginCompanyCode, setLoginCompanyCode] = useState(
    () => localStorage.getItem("travelAccountingLastCompanyCode") || accountCreatedNotice?.companyCode || "",
  );
  const [loginName, setLoginName] = useState(
    () => localStorage.getItem("travelAccountingLastIdentifier") || accountCreatedNotice?.username || "",
  );
  const [loginPassword, setLoginPassword] = useState("");
  const [rememberCredentials, setRememberCredentials] = useState(() =>
    Boolean(localStorage.getItem("travelAccountingRememberToken")),
  );
  const [showLoginPassword, setShowLoginPassword] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setGlobalAuthError("");
    setError("");
  }, [setGlobalAuthError]);

  useEffect(() => {
    if (accountCreatedNotice) {
      setGlobalAuthError("");
      setError("");
      setLoginCompanyCode(accountCreatedNotice.companyCode);
      setLoginName(accountCreatedNotice.username);
    }
  }, [accountCreatedNotice, setGlobalAuthError]);

  useEffect(() => {
    if (globalAuthError) {
      setError(
        globalAuthError.startsWith("Workspace could not start")
          ? globalAuthError
          : `Database Error: ${globalAuthError}`,
      );
    }
  }, [globalAuthError]);

  useEffect(() => {
    document.documentElement.classList.add("auth-screen");
    return () => document.documentElement.classList.remove("auth-screen");
  }, []);

  const signIn = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (!loginPassword) {
        throw new Error("Enter your password.");
      }

      if (isOfflineOnlyBuild()) {
        const session = await loginUser(loginCompanyCode, loginName, loginPassword);
        if (!session) {
          throw new Error("Company Code, Username/Email or Password is incorrect.");
        }
        const company = await getCompanyById(session.companyId);
        if (!company) {
          throw new Error("Company workspace could not be loaded.");
        }
        sessionStorage.setItem(
          OFFLINE_SESSION_STORAGE_KEY,
          JSON.stringify({ userId: session.userId, companyId: session.companyId }),
        );
        setSessionData(session, company);
      } else {
        const emailToUse = await resolveLoginEmail(loginCompanyCode, loginName);

        const { data, error: authError } = await supabase.auth.signInWithPassword({
          email: emailToUse,
          password: loginPassword,
        });

        if (authError || !data.user) {
          throw new Error(authError?.message || "Invalid credentials.");
        }
      }

      if (rememberCredentials) {
        localStorage.setItem("travelAccountingLastCompanyCode", loginCompanyCode.trim());
        localStorage.setItem("travelAccountingLastIdentifier", loginName.trim());
      } else {
        localStorage.removeItem("travelAccountingLastCompanyCode");
        localStorage.removeItem("travelAccountingLastIdentifier");
      }

      setAccountCreatedNotice(null);
      setGlobalAuthError("");
      setError("");
      navigate("/");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const closeAccountNotice = () => setAccountCreatedNotice(null);

  const copyLoginDetails = async () => {
    if (!accountCreatedNotice || accountCreatedNotice.accountStatus !== "ACTIVE") return;
    const text = [
      `Company Code: ${accountCreatedNotice.companyCode}`,
      `Master Username: ${accountCreatedNotice.username}`,
      `Email Address: ${accountCreatedNotice.email}`,
    ].join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setMessage("Login details copied. Your password is never included in copied details.");
    } catch {
      setMessage("Please write down your Company Code, Master Username and Email Address.");
    }
  };

  return (
    <main className="center auth-login-page-v8">
      <section className="card login auth-login-card-v8">
        <div className="mark product-logo-mark">
          <TravelHisabLogo size={52} />
        </div>
        <span className="eyebrow blue">{PRODUCT_NAME.toUpperCase()}</span>
        <h1>Sign in to your company</h1>
        <p className="muted auth-login-lead">
          {isOfflineOnlyBuild()
            ? "Offline edition — all data stays on this computer. No cloud login required."
            : `${PRODUCT_TAGLINE}. Use your Company Code with Username or Email.`}
        </p>

        {message && <div className="alert success">{message}</div>}
        {error && <div className="alert error">{error}</div>}

        <form onSubmit={signIn}>
          <label>
            Company Code
            <input
              autoFocus
              value={loginCompanyCode}
              onChange={(e) => setLoginCompanyCode(e.target.value.toUpperCase())}
              placeholder="Enter Company Code"
              autoComplete="organization"
            />
          </label>
          <label>
            Username or Email
            <input
              value={loginName}
              onChange={(e) => setLoginName(e.target.value)}
              placeholder="Enter username or email"
              autoComplete="username"
            />
          </label>
          <label>
            Password
            <div className="password-input-wrap-v8b">
              <input
                type={showLoginPassword ? "text" : "password"}
                value={loginPassword}
                onChange={(e) => setLoginPassword(e.target.value)}
                autoComplete="current-password"
              />
              <button
                className="password-eye-v8b"
                type="button"
                onClick={() => setShowLoginPassword((v) => !v)}
                aria-label={showLoginPassword ? "Hide password" : "Show password"}
              >
                {showLoginPassword ? "Hide" : "Show"}
              </button>
            </div>
          </label>

          <label className="remember-company-code">
            <input
              type="checkbox"
              checked={rememberCredentials}
              onChange={(e) => setRememberCredentials(e.target.checked)}
            />
            <span>Remember credentials on this device</span>
          </label>

          <button className="primary" type="submit" disabled={busy}>
            {busy ? "Signing in..." : "Sign In"}
          </button>
        </form>

        <div className="new-company-divider">
          <span>New to {PRODUCT_NAME}?</span>
        </div>
        <button
          className="create-company-login-button"
          type="button"
          onClick={() => {
            setAccountCreatedNotice(null);
            navigate("/setup");
          }}
        >
          Create an Account
        </button>

        <p className="auth-login-footer">
          {PRODUCT_NAME} by {COMPANY_NAME}
        </p>
      </section>

      {accountCreatedNotice && (
        <div className="modal-backdrop account-created-backdrop" onMouseDown={closeAccountNotice}>
          <section className="modal-card account-created-modal" onMouseDown={(e) => e.stopPropagation()}>
            <button
              className="close-btn account-created-close"
              type="button"
              onClick={closeAccountNotice}
              aria-label="Close"
            >
              ×
            </button>

            {accountCreatedNotice.accountStatus === "ACTIVE" ? (
              <>
                <div className="account-created-check">✓</div>
                <span className="eyebrow blue">ACCOUNT CREATED SUCCESSFULLY</span>
                <h2>Your company account is ready</h2>
                <p className="account-created-intro">Keep the following login details in a safe place.</p>

                <div className="account-created-details">
                  <div>
                    <span>Company</span>
                    <b>{accountCreatedNotice.companyName}</b>
                  </div>
                  <div className="confidential-code-row">
                    <span>Company Code</span>
                    <b>{accountCreatedNotice.companyCode}</b>
                  </div>
                  <div>
                    <span>Master Username</span>
                    <b>{accountCreatedNotice.username}</b>
                  </div>
                  <div>
                    <span>Email Address</span>
                    <b>{accountCreatedNotice.email}</b>
                  </div>
                </div>

                <div className="confidential-warning">
                  <b>Confidential Company Code</b>
                  <p>
                    Your Company Code is confidential to your organization. Please write it down and keep it secure. You
                    and your authorized company users will need it to sign in.
                  </p>
                </div>

                <div className="account-created-actions">
                  <button className="secondary" type="button" onClick={() => void copyLoginDetails()}>
                    Copy Login Details
                  </button>
                  <button className="primary" type="button" onClick={closeAccountNotice}>
                    Continue to Sign In
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="account-created-check">✓</div>
                <span className="eyebrow blue">ACCOUNT REQUEST SUBMITTED</span>
                <h2>Company registration received</h2>
                <p className="account-created-intro">Your company account creation has been successfully completed.</p>
                <div className="confidential-warning neutral">
                  <p>
                    Please wait while the relevant staff reviews your registration. You will be contacted with your
                    Company Code and account credentials after activation.
                  </p>
                </div>
                <div className="account-created-actions single">
                  <button className="primary" type="button" onClick={closeAccountNotice}>
                    Close
                  </button>
                </div>
              </>
            )}
          </section>
        </div>
      )}
    </main>
  );
}
