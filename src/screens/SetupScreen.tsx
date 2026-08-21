import { useState, useMemo } from "react";
import { createCompanyAccount } from "../db";
import { useNavigate } from "react-router-dom";

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

  const updateSetup = (key: keyof typeof setup, value: string) => {
    setError("");
    setSetup(prev => ({ ...prev, [key]: value }));
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
      const created = await createCompanyAccount({
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
    <main className="setup auth-setup-v8 auth-setup-v8d">
      <section className="hero">
        <div>
          <span className="eyebrow gold">CREATE ACCOUNT</span>
          <h1>Create your company account and secure master access.</h1>
          <p>Start with the essential account details. Company branding, address, currencies and additional profile information can be completed after sign in.</p>
          <div className="features">
            <b>01 <small>Unique Company Identity</small></b>
            <b>02 <small>Master Username or Email Sign In</small></b>
            <b>03 <small>Role-Based Team Access</small></b>
          </div>
        </div>
      </section>

      <section className="panel signup-panel-v8b">
        <div className="panel-head signup-head-v8b">
          <div>
            <span className="eyebrow blue">NEW COMPANY ACCOUNT</span>
            <h2>Create Account</h2>
            <p>A unique Company Code will be issued after your account is successfully created.</p>
          </div>
        </div>

        {error && <div className="alert error">{error}</div>}

        <form className="form signup-form-v8b" onSubmit={(e) => { e.preventDefault(); void finishSetup(); }}>
          <label>
            Company Name *
            <input autoFocus value={setup.companyName} onChange={e => updateSetup("companyName", e.target.value)} placeholder="e.g. ABC Travel & Tours" />
          </label>

          <label>
            Master Username *
            <input value={setup.username} onChange={e => updateSetup("username", e.target.value)} placeholder="e.g. admin" autoComplete="username" />
            <small className="field-help">This username will be used to sign in to the Master account.</small>
          </label>

          <label>
            Email Address *
            <input type="email" value={setup.email} onChange={e => updateSetup("email", e.target.value)} placeholder="e.g. accounts@abctravel.com" autoComplete="email" />
            <small className="field-help">You can also use this email address to sign in.</small>
          </label>

          <label>
            DTS License # <small>(Optional)</small>
            <input value={setup.dtsLicense} onChange={e => updateSetup("dtsLicense", e.target.value)} placeholder="Enter DTS License #" />
          </label>

          <label>
            Phone / WhatsApp Number *
            <input value={setup.phone} onChange={e => updateSetup("phone", e.target.value)} placeholder="e.g. +92 300 1234567" inputMode="tel" autoComplete="tel" />
            <small className="field-help">Company will contact you on this number.</small>
          </label>

          <div className="two signup-password-grid-v8b">
            <label>
              Password *
              <div className="password-input-wrap-v8b">
                <input
                  type={showSetupPassword ? "text" : "password"}
                  value={setup.password}
                  onChange={e => updateSetup("password", e.target.value)}
                  placeholder="Create a strong password"
                  autoComplete="new-password"
                />
                <button className="password-eye-v8b" type="button" onClick={() => setShowSetupPassword(v => !v)} aria-label={showSetupPassword ? "Hide password" : "Show password"}>
                  {showSetupPassword ? "Hide" : "Show"}
                </button>
              </div>
            </label>
            <label>
              Confirm Password *
              <div className="password-input-wrap-v8b">
                <input
                  type={showSetupConfirmPassword ? "text" : "password"}
                  value={setup.confirmPassword}
                  onChange={e => updateSetup("confirmPassword", e.target.value)}
                  placeholder="Repeat password"
                  autoComplete="new-password"
                />
                <button className="password-eye-v8b" type="button" onClick={() => setShowSetupConfirmPassword(v => !v)} aria-label={showSetupConfirmPassword ? "Hide confirm password" : "Show confirm password"}>
                  {showSetupConfirmPassword ? "Hide" : "Show"}
                </button>
              </div>
            </label>
          </div>

          <div className="password-rules-v8b">
            <span className={setupPasswordChecks.length ? "ok" : ""}>✓ Minimum 8 characters</span>
            <span className={setupPasswordChecks.upper ? "ok" : ""}>✓ 1 capital letter</span>
            <span className={setupPasswordChecks.lower ? "ok" : ""}>✓ 1 small letter</span>
            <span className={setupPasswordChecks.number ? "ok" : ""}>✓ 1 number</span>
            <span className={setupPasswordChecks.special ? "ok" : ""}>✓ 1 special character (! @ # $ % ^ & *)</span>
          </div>

          <button className="primary signup-submit-v8b" type="submit" disabled={busy}>
            {busy ? "Creating Account..." : "Create an Account"}
          </button>

          <button className="signup-back-v8b" type="button" onClick={() => navigate("/login")}>
            Back to Sign In
          </button>
        </form>
      </section>
    </main>
  );
}
