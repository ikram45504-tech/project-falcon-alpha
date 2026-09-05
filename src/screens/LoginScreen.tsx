import { FormEvent, useState, useEffect } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useBodyScrollLock } from "../useBodyScrollLock";
import { supabase } from "../supabaseClient";
import { useAuth } from "../AuthContext";
import TravelHisabLogo from "../TravelHisabLogo";
import { COMPANY_NAME, PRODUCT_NAME, PRODUCT_TAGLINE } from "../brand";
import { resolveLoginEmail } from "../loginAuth";
import { isOfflineOnlyBuild } from "../appMode";
import { getCompanyById, loginUser, OFFLINE_SESSION_STORAGE_KEY } from "../db";
import { googleAuthErrorFromUrl, signInWithGoogle } from "../cloudAuth";
import { consumePasswordUpdatedNotice } from "../authSessionFlags";
import type { UserRole } from "../permissions";
import type { Company } from "../db";
import { COMPANY_REVOKED_MESSAGE, companyAllowsWorkspace, isCompanyRevoked } from "../companyStatus";

export default function LoginScreen({
  accountCreatedNotice,
  setAccountCreatedNotice,
}: {
  accountCreatedNotice: any;
  setAccountCreatedNotice: (n: any) => void;
}) {
  useBodyScrollLock(Boolean(accountCreatedNotice));

  const navigate = useNavigate();
  const location = useLocation();
  const { error: globalAuthError, setError: setGlobalAuthError, setSessionData } = useAuth();
  const cloudAuth = !isOfflineOnlyBuild();

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
    const oauthError = googleAuthErrorFromUrl(location.search);
    if (oauthError) {
      setError(oauthError);
    }
    const navState = location.state as { passwordUpdated?: boolean } | null;
    if (navState?.passwordUpdated || consumePasswordUpdatedNotice()) {
      setMessage("Password updated. Sign in with your new password.");
      navigate(location.pathname, { replace: true, state: {} });
    }
  }, [location.pathname, location.search, location.state, navigate, setGlobalAuthError]);

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

        const { data: userRow } = await supabase
          .from("users")
          .select("company_id")
          .eq("id", data.user.id)
          .maybeSingle();

        if (userRow?.company_id) {
          const { data: companyRow } = await supabase
            .from("companies")
            .select(
              "id, company_code, name, dts_license, logo_data, address, phone, whatsapp, email, base_currency, foreign_currency, status, entitlements, access_ends_at, created_at, updated_at",
            )
            .eq("id", userRow.company_id)
            .maybeSingle();

          const status = String(companyRow?.status || "").toUpperCase();
          if (companyRow && isCompanyRevoked(status)) {
            await supabase.auth.signOut();
            throw new Error(COMPANY_REVOKED_MESSAGE);
          }
          if (companyRow && status && !companyAllowsWorkspace(status)) {
            if (rememberCredentials) {
              localStorage.setItem("travelAccountingLastCompanyCode", loginCompanyCode.trim());
              localStorage.setItem("travelAccountingLastIdentifier", loginName.trim());
            } else {
              localStorage.removeItem("travelAccountingLastCompanyCode");
              localStorage.removeItem("travelAccountingLastIdentifier");
            }

            const metadata = (data.user.user_metadata || {}) as Record<string, unknown>;
            const roleRaw = String(metadata.role || "OWNER").toUpperCase();
            const role = (
              ["OWNER", "ADMIN", "ACCOUNTS", "DATA_ENTRY", "VIEW_ONLY"].includes(roleRaw) ? roleRaw : "OWNER"
            ) as UserRole;
            const pendingCompany: Company = {
              id: String(companyRow.id),
              company_code: String(companyRow.company_code || ""),
              name: String(companyRow.name || ""),
              dts_license: String(companyRow.dts_license || ""),
              logo_data: (companyRow.logo_data as string | null) ?? null,
              address: String(companyRow.address || ""),
              phone: String(companyRow.phone || ""),
              whatsapp: String(companyRow.whatsapp || ""),
              email: String(companyRow.email || ""),
              base_currency: String(companyRow.base_currency || "PKR"),
              foreign_currency: String(companyRow.foreign_currency || "SAR"),
              status: status as Company["status"],
              entitlements: (companyRow.entitlements as Company["entitlements"]) ?? null,
              created_at: String(companyRow.created_at || ""),
              updated_at: String(companyRow.updated_at || ""),
            };
            setSessionData(
              {
                userId: data.user.id,
                companyId: pendingCompany.id,
                companyCode: pendingCompany.company_code,
                companyName: pendingCompany.name,
                fullName: String(metadata.full_name || metadata.username || loginName.trim()),
                username: String(metadata.username || loginName.trim()),
                email: data.user.email || emailToUse,
                phone: String(metadata.phone || pendingCompany.phone || ""),
                role,
              },
              pendingCompany,
            );
            setAccountCreatedNotice(null);
            setGlobalAuthError("");
            setError("");
            navigate("/", { replace: true });
            return;
          }
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
      `Owner Username: ${accountCreatedNotice.username}`,
      `Email Address: ${accountCreatedNotice.email}`,
    ].join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setMessage("Login details copied. Your password is never included in copied details.");
    } catch {
      setMessage("Please write down your Company Code, Owner Username and Email Address.");
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

          {cloudAuth && (
            <div className="auth-forgot-row">
              <Link
                className="auth-forgot-link"
                to="/forgot-password"
                state={{ companyCode: loginCompanyCode, identifier: loginName }}
              >
                Forgot password?
              </Link>
            </div>
          )}

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

        {cloudAuth && (
          <>
            <div className="new-company-divider">
              <span>Or continue with</span>
            </div>
            <button
              className="google-login-button"
              type="button"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                setError("");
                void signInWithGoogle().catch((err) => {
                  setError(err instanceof Error ? err.message : String(err));
                  setBusy(false);
                });
              }}
            >
              <GoogleMark />
              Continue with Google
            </button>
          </>
        )}

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
                    <span>Owner Username</span>
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
                <span className="eyebrow blue">REGISTRATION RECEIVED</span>
                <h2>Company registration received</h2>
                <p className="account-created-intro">
                  Your request has been delivered to the relevant department at {COMPANY_NAME}.
                </p>
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
                    <span>Username</span>
                    <b>{accountCreatedNotice.username}</b>
                  </div>
                  <div>
                    <span>Email Address</span>
                    <b>{accountCreatedNotice.email}</b>
                  </div>
                </div>
                <div className="confidential-warning neutral">
                  <p>
                    Please save your Company Code and password. {COMPANY_NAME} will contact you shortly once your
                    account is activated. After activation, sign in as usual or use Continue with Google with the same
                    email.
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

function GoogleMark() {
  return (
    <svg className="google-login-mark" viewBox="0 0 48 48" aria-hidden="true">
      <path
        fill="#FFC107"
        d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.1 8 3l5.7-5.7C34.2 6.1 29.4 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.2-.1-2.3-.4-3.5z"
      />
      <path
        fill="#FF3D00"
        d="M6.3 14.7l6.6 4.8C14.7 16 19 12 24 12c3.1 0 5.8 1.1 8 3l5.7-5.7C34.2 6.1 29.4 4 24 4 16.3 4 9.6 8.3 6.3 14.7z"
      />
      <path
        fill="#4CAF50"
        d="M24 44c5.2 0 10-2 13.6-5.2l-6.3-5.3C29.2 35.1 26.7 36 24 36c-5.3 0-9.7-3.3-11.3-8.1l-6.5 5C9.5 39.6 16.2 44 24 44z"
      />
      <path
        fill="#1976D2"
        d="M43.6 20.5H42V20H24v8h11.3c-1.1 3.1-3.5 5.6-6.7 7.1l6.3 5.3C38.2 37.3 44 32 44 24c0-1.2-.1-2.3-.4-3.5z"
      />
    </svg>
  );
}
