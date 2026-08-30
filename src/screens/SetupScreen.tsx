import { useEffect, useMemo, useState } from "react";
import { createCompanyAccount, createOfflineCompanyAccount } from "../db";
import { isOfflineOnlyBuild } from "../appMode";
import { useNavigate } from "react-router-dom";
import TravelHisabLogo from "../TravelHisabLogo";
import { PRODUCT_BYLINE, PRODUCT_HIGHLIGHTS, PRODUCT_NAME, PRODUCT_TAGLINE } from "../brand";

const blankSetup = {
  companyName: "",
  username: "",
  email: "",
  dtsLicense: "",
  phone: "",
  password: "",
  confirmPassword: "",
};

function passwordChecks(value: string) {
  return {
    length: value.length >= 8,
    upper: /[A-Z]/.test(value),
    lower: /[a-z]/.test(value),
    number: /[0-9]/.test(value),
    special: /[!@#$%^&*]/.test(value),
  };
}

function passwordPolicyMessage(value: string) {
  const checks = passwordChecks(value);
  if (!checks.length) return "Password must be at least 8 characters.";
  if (!checks.upper) return "Password must contain at least 1 capital letter.";
  if (!checks.lower) return "Password must contain at least 1 small letter.";
  if (!checks.number) return "Password must contain at least 1 number.";
  if (!checks.special) return "Password must contain at least 1 special character: ! @ # $ % ^ & *";
  return "";
}

export default function SetupScreen({ onAccountCreated }: { onAccountCreated: (notice: any) => void }) {
  const navigate = useNavigate();
  const [setup, setSetup] = useState(blankSetup);
  const [showSetupPassword, setShowSetupPassword] = useState(false);
  const [showSetupConfirmPassword, setShowSetupConfirmPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const setupPasswordChecks = useMemo(() => passwordChecks(setup.password), [setup.password]);

  useEffect(() => {
    document.documentElement.classList.add("auth-screen");
    return () => document.documentElement.classList.remove("auth-screen");
  }, []);

  const updateSetup = (key: keyof typeof setup, value: string) => {
    setError("");
    setSetup((prev) => ({ ...prev, [key]: value }));
  };

  const finishSetup = async () => {
    if (!setup.companyName.trim()) return setError("Please enter the Company Name.");
    if (!setup.username.trim()) return setError("Please enter the Master Username.");
    if (!setup.email.trim()) return setError("Please enter the Email Address.");
    if (!/^\S+@\S+\.\S+$/.test(setup.email.trim())) return setError("Please enter a valid Email Address.");
    if (!setup.phone.trim()) return setError("Please enter the Phone / WhatsApp Number.");

    const passwordError = passwordPolicyMessage(setup.password);
    if (passwordError) return setError(passwordError);
    if (setup.password !== setup.confirmPassword) return setError("Passwords do not match.");

    setBusy(true);
    setError("");
    try {
      const created = isOfflineOnlyBuild()
        ? await createOfflineCompanyAccount({
            companyName: setup.companyName.trim(),
            ownerUsername: setup.username.trim(),
            ownerEmail: setup.email.trim(),
            ownerPhone: setup.phone.trim(),
            dtsLicense: setup.dtsLicense.trim(),
            password: setup.password,
          })
        : await createCompanyAccount({
            companyName: setup.companyName.trim(),
            ownerUsername: setup.username.trim(),
            ownerEmail: setup.email.trim(),
            ownerPhone: setup.phone.trim(),
            dtsLicense: setup.dtsLicense.trim(),
            password: setup.password,
          });

      onAccountCreated({
        companyName: setup.companyName.trim(),
        companyCode: created.companyCode,
        username: created.username,
        email: created.email,
        accountStatus: created.accountStatus,
      });

      navigate("/login");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="center auth-setup-page-compact">
      <div className="auth-setup-shell">
        <aside className="auth-setup-info">
          <div className="auth-setup-info-brand">
            <div className="mark product-logo-mark auth-setup-logo-mark">
              <TravelHisabLogo size={48} />
            </div>
            <div>
              <span className="eyebrow gold">{PRODUCT_NAME.toUpperCase()}</span>
              <h2>{PRODUCT_TAGLINE}</h2>
            </div>
          </div>

          <div className="auth-setup-info-copy">
            <p className="auth-setup-info-intro">
              Built for travel agencies to manage bookings, accounts and statements in one workspace.
            </p>

            <ul className="auth-setup-highlights">
              {PRODUCT_HIGHLIGHTS.map((item, index) => (
                <li key={item}>
                  <span className="auth-setup-highlight-no">{String(index + 1).padStart(2, "0")}</span>
                  <span className="auth-setup-highlight-text">{item}</span>
                </li>
              ))}
            </ul>
          </div>

          <p className="auth-setup-info-byline">{PRODUCT_BYLINE}</p>
        </aside>

        <section className="auth-setup-form-panel">
          <div className="auth-setup-form-head">
            <h1>Create company account</h1>
            <p className="muted">A unique Company Code is issued after registration.</p>
          </div>

          {error && <div className="alert error">{error}</div>}

          <form
            className="auth-setup-form-compact"
            onSubmit={(e) => {
              e.preventDefault();
              void finishSetup();
            }}
          >
            <label className="auth-setup-field auth-setup-field-hero">
              Company Name *
              <input
                autoFocus
                value={setup.companyName}
                onChange={(e) => updateSetup("companyName", e.target.value)}
                placeholder="e.g. ABC Travel & Tours"
              />
            </label>

            <label className="auth-setup-field auth-setup-field-hero">
              Email Address *
              <input
                type="email"
                value={setup.email}
                onChange={(e) => updateSetup("email", e.target.value)}
                placeholder="e.g. accounts@abctravel.com"
                autoComplete="email"
              />
            </label>

            <label className="auth-setup-field auth-setup-field-medium">
              Master Username *
              <input
                value={setup.username}
                onChange={(e) => updateSetup("username", e.target.value)}
                placeholder="e.g. admin"
                autoComplete="username"
              />
            </label>

            <label className="auth-setup-field auth-setup-field-medium">
              Phone / WhatsApp *
              <input
                value={setup.phone}
                onChange={(e) => updateSetup("phone", e.target.value)}
                placeholder="e.g. +92 300 1234567"
                inputMode="tel"
                autoComplete="tel"
              />
            </label>

            <label className="auth-setup-field auth-setup-field-small auth-setup-span-full">
              DTS License # <small>(Optional)</small>
              <input
                value={setup.dtsLicense}
                onChange={(e) => updateSetup("dtsLicense", e.target.value)}
                placeholder="License #"
              />
            </label>

            <div className="auth-setup-password-row">
              <label className="auth-setup-field auth-setup-field-password">
                Password *
                <div className="password-input-wrap-v8b">
                  <input
                    type={showSetupPassword ? "text" : "password"}
                    value={setup.password}
                    onChange={(e) => updateSetup("password", e.target.value)}
                    placeholder="Create password"
                    autoComplete="new-password"
                  />
                  <button
                    className="password-eye-v8b"
                    type="button"
                    onClick={() => setShowSetupPassword((v) => !v)}
                    aria-label={showSetupPassword ? "Hide password" : "Show password"}
                  >
                    {showSetupPassword ? "Hide" : "Show"}
                  </button>
                </div>
              </label>

              <label className="auth-setup-field auth-setup-field-password">
                Confirm Password *
                <div className="password-input-wrap-v8b">
                  <input
                    type={showSetupConfirmPassword ? "text" : "password"}
                    value={setup.confirmPassword}
                    onChange={(e) => updateSetup("confirmPassword", e.target.value)}
                    placeholder="Repeat password"
                    autoComplete="new-password"
                  />
                  <button
                    className="password-eye-v8b"
                    type="button"
                    onClick={() => setShowSetupConfirmPassword((v) => !v)}
                    aria-label={showSetupConfirmPassword ? "Hide confirm password" : "Show confirm password"}
                  >
                    {showSetupConfirmPassword ? "Hide" : "Show"}
                  </button>
                </div>
              </label>
            </div>

            <div className="password-rules-v8b auth-setup-rules-compact auth-setup-span-full">
              <span className={setupPasswordChecks.length ? "ok" : ""}>8+ chars</span>
              <span className={setupPasswordChecks.upper ? "ok" : ""}>A-Z</span>
              <span className={setupPasswordChecks.lower ? "ok" : ""}>a-z</span>
              <span className={setupPasswordChecks.number ? "ok" : ""}>0-9</span>
              <span className={setupPasswordChecks.special ? "ok" : ""}>!@#$</span>
            </div>

            <div className="auth-setup-actions auth-setup-span-full">
              <button className="primary" type="submit" disabled={busy}>
                {busy ? "Creating Account..." : "Create Account"}
              </button>
              <button className="signup-back-v8b" type="button" onClick={() => navigate("/login")}>
                Back to Sign In
              </button>
            </div>
          </form>
        </section>
      </div>
    </main>
  );
}
