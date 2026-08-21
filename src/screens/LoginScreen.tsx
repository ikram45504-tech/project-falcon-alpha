import { FormEvent, useState, useEffect } from "react";
import { loginUser, getCompanyById, createRememberedSession, revokeRememberedSession } from "../db";
import { useAuth } from "../AuthContext";
import { useNavigate } from "react-router-dom";

function getOrCreateDeviceId() {
  const key = "travelAccountingDeviceId";
  const existing = localStorage.getItem(key);
  if (existing) return existing;
  const created = crypto.randomUUID();
  localStorage.setItem(key, created);
  return created;
}

export default function LoginScreen({ 
  accountCreatedNotice, 
  setAccountCreatedNotice 
}: { 
  accountCreatedNotice: any; 
  setAccountCreatedNotice: (n: any) => void;
}) {
  const { setSessionData } = useAuth();
  const navigate = useNavigate();
  
  const [loginCompanyCode, setLoginCompanyCode] = useState(() => localStorage.getItem("travelAccountingLastCompanyCode") || accountCreatedNotice?.companyCode || "");
  const [loginName, setLoginName] = useState(() => localStorage.getItem("travelAccountingLastIdentifier") || accountCreatedNotice?.username || "");
  const [loginPassword, setLoginPassword] = useState("");
  const [rememberCredentials, setRememberCredentials] = useState(() => Boolean(localStorage.getItem("travelAccountingRememberToken")));
  const [showLoginPassword, setShowLoginPassword] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (accountCreatedNotice) {
      setLoginCompanyCode(accountCreatedNotice.companyCode);
      setLoginName(accountCreatedNotice.username);
    }
  }, [accountCreatedNotice]);

  const signIn = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const loggedIn = await loginUser(loginCompanyCode.trim(), loginName.trim(), loginPassword);
      if (!loggedIn) return setError("Company Code, username/email or password is incorrect.");
      const linkedCompany = await getCompanyById(loggedIn.companyId);
      if (!linkedCompany) return setError("Company account could not be loaded.");

      const existingRememberToken = localStorage.getItem("travelAccountingRememberToken") || "";
      if (existingRememberToken) {
        await revokeRememberedSession(existingRememberToken);
        localStorage.removeItem("travelAccountingRememberToken");
      }

      if (rememberCredentials) {
        const rememberToken = await createRememberedSession(loggedIn, getOrCreateDeviceId());
        localStorage.setItem("travelAccountingRememberToken", rememberToken);
        localStorage.setItem("travelAccountingLastCompanyCode", linkedCompany.company_code);
        localStorage.setItem("travelAccountingLastIdentifier", loginName.trim());
      } else {
        localStorage.removeItem("travelAccountingLastCompanyCode");
        localStorage.removeItem("travelAccountingLastIdentifier");
      }

      setSessionData(loggedIn, linkedCompany);
      setAccountCreatedNotice(null);
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
        <div className="mark">TA</div>
        <span className="eyebrow blue">TRAVEL ACCOUNTING</span>
        <h1>Sign in to your company</h1>
        <p className="muted">Use your Company Code with your authorized Username or Email.</p>

        {message && <div className="alert success">{message}</div>}
        {error && <div className="alert error">{error}</div>}

        <form onSubmit={signIn}>
          <label>
            Company Code
            <input autoFocus value={loginCompanyCode} onChange={e => setLoginCompanyCode(e.target.value.toUpperCase())} placeholder="Enter Company Code" autoComplete="organization" />
          </label>
          <label>
            Username or Email
            <input value={loginName} onChange={e => setLoginName(e.target.value)} placeholder="Enter username or email" autoComplete="username" />
          </label>
          <label>
            Password
            <div className="password-input-wrap-v8b">
              <input type={showLoginPassword ? "text" : "password"} value={loginPassword} onChange={e => setLoginPassword(e.target.value)} autoComplete="current-password" />
              <button className="password-eye-v8b" type="button" onClick={() => setShowLoginPassword(v => !v)} aria-label={showLoginPassword ? "Hide password" : "Show password"}>
                {showLoginPassword ? "Hide" : "Show"}
              </button>
            </div>
          </label>

          <label className="remember-company-code">
            <input type="checkbox" checked={rememberCredentials} onChange={e => setRememberCredentials(e.target.checked)} />
            <span>Remember credentials to sign in next time on this device</span>
          </label>
          <small className="remember-session-help">Your password is not stored. A device session is used instead.</small>

          <button className="primary" type="submit" disabled={busy}>{busy ? "Signing in..." : "Sign In"}</button>
        </form>

        <div className="new-company-divider"><span>New to Travel Accounting?</span></div>
        <button className="create-company-login-button" type="button" onClick={() => { setAccountCreatedNotice(null); navigate("/setup"); }}>Create an Account</button>

        <div className="platform-ready-note">
          <b>Secure company access</b>
          <span>Company-based sign in, controlled user permissions and protected account sessions.</span>
        </div>
      </section>

      {accountCreatedNotice && (
        <div className="modal-backdrop account-created-backdrop" onMouseDown={closeAccountNotice}>
          <section className="modal-card account-created-modal" onMouseDown={e => e.stopPropagation()}>
            <button className="close-btn account-created-close" type="button" onClick={closeAccountNotice} aria-label="Close">×</button>

            {accountCreatedNotice.accountStatus === "ACTIVE" ? (
              <>
                <div className="account-created-check">✓</div>
                <span className="eyebrow blue">ACCOUNT CREATED SUCCESSFULLY</span>
                <h2>Your company account is ready</h2>
                <p className="account-created-intro">Keep the following login details in a safe place.</p>

                <div className="account-created-details">
                  <div><span>Company</span><b>{accountCreatedNotice.companyName}</b></div>
                  <div className="confidential-code-row"><span>Company Code</span><b>{accountCreatedNotice.companyCode}</b></div>
                  <div><span>Master Username</span><b>{accountCreatedNotice.username}</b></div>
                  <div><span>Email Address</span><b>{accountCreatedNotice.email}</b></div>
                </div>

                <div className="confidential-warning">
                  <b>Confidential Company Code</b>
                  <p>Your Company Code is confidential to your organization. Please write it down and keep it secure. You and your authorized company users will need it to sign in.</p>
                </div>

                <div className="account-created-actions">
                  <button className="secondary" type="button" onClick={() => void copyLoginDetails()}>Copy Login Details</button>
                  <button className="primary" type="button" onClick={closeAccountNotice}>Continue to Sign In</button>
                </div>
              </>
            ) : (
              <>
                <div className="account-created-check">✓</div>
                <span className="eyebrow blue">ACCOUNT REQUEST SUBMITTED</span>
                <h2>Company registration received</h2>
                <p className="account-created-intro">Your company account creation has been successfully completed.</p>
                <div className="confidential-warning neutral">
                  <p>Please wait while the relevant staff reviews your registration. You will be contacted with your Company Code and account credentials after activation.</p>
                </div>
                <div className="account-created-actions single">
                  <button className="primary" type="button" onClick={closeAccountNotice}>Close</button>
                </div>
              </>
            )}
          </section>
        </div>
      )}
    </main>
  );
}
