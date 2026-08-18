import { FormEvent, useEffect, useMemo, useState } from "react";
import "./App.css";
import {
  Company,
  Party,
  PartyInput,
  UserSession,
  createCompanyAccount,
  createParty,
  createRememberedSession,
  getCompanyById,
  getParties,
  getPartyAccommodationTotals,
  getPartyServiceTotals,
  getPartyPaymentTotals,
  initDatabase,
  loginUser,
  restoreRememberedSession,
  revokeRememberedSession,
  updateParty,
} from "./db";
import { AccommodationModule, formatMoney } from "./Accommodation";
import { ServicesModule } from "./Services";
import { PaymentsModule } from "./Payments";
import PartyLedger from "./PartyLedger";
import StatementsModule from "./Statements";
import BookingsModule from "./Bookings";
import SecurityCenter from "./SecurityCenter";
import { Permission, ROLE_LABELS, hasPermission } from "./permissions";

type Screen = "loading" | "setup" | "login" | "workspace";
type WorkspaceView = "dashboard" | "parties" | "party-ledger" | "bookings" | "accommodation" | "services" | "payments" | "statements" | "security";
type AccountView = "PARTY" | "VENDOR" | "UNASSIGNED";

const blankSetup = {
  companyName: "",
  username: "",
  email: "",
  dtsLicense: "",
  phone: "",
  password: "",
  confirmPassword: "",
};

function getOrCreateDeviceId() {
  const key = "travelAccountingDeviceId";
  const existing = localStorage.getItem(key);
  if (existing) return existing;
  const created = crypto.randomUUID();
  localStorage.setItem(key, created);
  return created;
}

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

const blankParty: PartyInput = {
  name: "",
  phone: "",
  whatsapp: "",
  address: "",
  notes: "",
  status: "ACTIVE",
  accountType: "PARTY",
};

function App() {
  const [screen, setScreen] = useState<Screen>("loading");
  const [workspaceView, setWorkspaceView] = useState<WorkspaceView>("dashboard");
  const [accountView, setAccountView] = useState<AccountView>("PARTY");
  const [setup, setSetup] = useState(blankSetup);
  const [showSetupPassword, setShowSetupPassword] = useState(false);
  const [showSetupConfirmPassword, setShowSetupConfirmPassword] = useState(false);
  const [showLoginPassword, setShowLoginPassword] = useState(false);

  const [loginCompanyCode, setLoginCompanyCode] = useState(() => localStorage.getItem("travelAccountingLastCompanyCode") || "");
  const [loginName, setLoginName] = useState(() => localStorage.getItem("travelAccountingLastIdentifier") || "");
  const [loginPassword, setLoginPassword] = useState("");
  const [rememberCredentials, setRememberCredentials] = useState(() => Boolean(localStorage.getItem("travelAccountingRememberToken")));
  const [session, setSession] = useState<UserSession | null>(null);
  const [company, setCompany] = useState<Company | null>(null);
  const [accountCreatedNotice, setAccountCreatedNotice] = useState<null | {
    companyName: string;
    companyCode: string;
    username: string;
    email: string;
    accountStatus: "ACTIVE" | "PENDING_APPROVAL";
  }>(null);

  const [parties, setParties] = useState<Party[]>([]);
  const [partySearch, setPartySearch] = useState("");
  const [partyModalOpen, setPartyModalOpen] = useState(false);
  const [partyForm, setPartyForm] = useState<PartyInput>(blankParty);
  const [editingParty, setEditingParty] = useState<Party | null>(null);
  const [selectedParty, setSelectedParty] = useState<Party | null>(null);
  const [statementPartyId, setStatementPartyId] = useState("");
  const [partyAccommodationTotals, setPartyAccommodationTotals] = useState<Record<string, number>>({});
  const [partyServiceTotals, setPartyServiceTotals] = useState<Record<string, number>>({});
  const [partyPaymentTotals, setPartyPaymentTotals] = useState<Record<string, number>>({});

  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

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
              setWorkspaceView("dashboard");
              setScreen("workspace");
              return;
            }
          }

          localStorage.removeItem("travelAccountingRememberToken");
          setRememberCredentials(false);
        }

        setScreen("login");
      } catch (e) {
        setError(`Workspace could not start: ${e instanceof Error ? e.message : String(e)}`);
      }
    })();
  }, []);

  useEffect(() => {
    if (!company || screen !== "workspace") return;
    loadParties();
    loadFinancialTotals();
  }, [company, screen]);

  const initials = useMemo(() => {
    const text = company?.name || setup.companyName || "TA";
    return text.split(/\s+/).filter(Boolean).slice(0, 2).map(x => x[0]?.toUpperCase()).join("");
  }, [company, setup.companyName]);

  const partyAccounts = useMemo(
    () => parties.filter((item) => item.account_type === "PARTY"),
    [parties]
  );

  const vendorAccounts = useMemo(
    () => parties.filter((item) => item.account_type === "VENDOR"),
    [parties]
  );

  const unassignedAccounts = useMemo(
    () => parties.filter((item) => item.account_type === "UNASSIGNED"),
    [parties]
  );

  const visibleAccounts = useMemo(() =>
    parties.filter((item) => item.account_type === accountView),
    [parties, accountView]
  );

  const companyAccommodationTotal = useMemo(
    () => Object.values(partyAccommodationTotals).reduce<number>((sum, value) => sum + Number(value), 0),
    [partyAccommodationTotals]
  );

  const companyServiceTotal = useMemo(
    () => Object.values(partyServiceTotals).reduce<number>((sum, value) => sum + Number(value), 0),
    [partyServiceTotals]
  );

  const companyPurchaseTotal = companyAccommodationTotal + companyServiceTotal;

  const companyPaidTotal = useMemo(
    () => Object.values(partyPaymentTotals).reduce<number>((sum, value) => sum + Number(value), 0),
    [partyPaymentTotals]
  );

  const companyBalance = companyPurchaseTotal - companyPaidTotal;

  const updateSetup = (key: keyof typeof setup, value: string) => {
    setError("");
    setSetup(prev => ({ ...prev, [key]: value }));
  };

  const setupPasswordChecks = useMemo(() => passwordChecks(setup.password), [setup.password]);

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
      setLoginCompanyCode(created.companyCode);
      setLoginName(created.username);
      setLoginPassword("");
      setSetup(blankSetup);
      setMessage("");
      setAccountCreatedNotice({
        companyName: setup.companyName.trim(),
        companyCode: created.companyCode,
        username: created.username,
        email: created.email,
        accountStatus: created.accountStatus,
      });
      setScreen("login");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

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

      setSession(loggedIn);
      setCompany(linkedCompany);
      setAccountCreatedNotice(null);
      setWorkspaceView("dashboard");
      setMessage("");
      setLoginPassword("");
      setScreen("workspace");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
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

    setRememberCredentials(false);
    setLoginCompanyCode("");
    setLoginName("");
    setSession(null);
    setCompany(null);
    setParties([]);
    setSelectedParty(null);
    setPartyAccommodationTotals({});
    setPartyServiceTotals({});
    setPartyPaymentTotals({});
    setLoginPassword("");
    setAccountCreatedNotice(null);
    setError("");
    setMessage("");
    setWorkspaceView("dashboard");
    setScreen("login");
  };

  async function loadParties(search = "") {
    if (!company) return;
    try {
      setParties(await getParties(company.id, search));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function loadFinancialTotals() {
    if (!company) return;
    try {
      const [accommodationRows, serviceRows, paymentRows] = await Promise.all([
        getPartyAccommodationTotals(company.id),
        getPartyServiceTotals(company.id),
        getPartyPaymentTotals(company.id),
      ]);

      const accommodationNext: Record<string, number> = {};
      for (const row of accommodationRows) {
        accommodationNext[row.party_id] = Number(row.total_pkr || 0);
      }

      const serviceNext: Record<string, number> = {};
      for (const row of serviceRows) {
        serviceNext[row.party_id] = Number(row.total_pkr || 0);
      }

      const paymentNext: Record<string, number> = {};
      for (const row of paymentRows) {
        paymentNext[row.party_id] = Number(row.paid_amount || 0);
      }

      setPartyAccommodationTotals(accommodationNext);
      setPartyServiceTotals(serviceNext);
      setPartyPaymentTotals(paymentNext);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function searchParties(value: string) {
    setPartySearch(value);
    await loadParties(value);
  }

  const can = (permission: Permission) => hasPermission(session?.role, permission);

  function newParty(type: "PARTY" | "VENDOR" = "PARTY") {
    if (!can("edit_parties")) { setError("Your role does not allow creating Party/Vendor accounts."); return; }
    setEditingParty(null);
    setPartyForm({ ...blankParty, accountType: type });
    setError("");
    setPartyModalOpen(true);
  }

  function editParty(party: Party) {
    if (!can("edit_parties")) { setError("Your role has read-only access to Party/Vendor accounts."); return; }
    setEditingParty(party);
    setPartyForm({
      name: party.name,
      phone: party.phone,
      whatsapp: party.whatsapp,
      address: party.address,
      notes: party.notes,
      status: party.status,
      accountType: party.account_type,
    });
    setError("");
    setPartyModalOpen(true);
  }

  async function saveParty() {
    if (!company || !session) return;
    if (!can("edit_parties")) return setError("Your role does not allow changing Party/Vendor accounts.");
    if (!partyForm.name.trim()) {
      setError(`${partyForm.accountType === "VENDOR" ? "Vendor" : "Party"} name is required.`);
      return;
    }

    setBusy(true);
    setError("");
    try {
      if (editingParty) {
        await updateParty(editingParty.id, company.id, partyForm, session.userId);
        setMessage(`${partyForm.accountType === "VENDOR" ? "Vendor" : "Party"} updated successfully.`);
      } else {
        await createParty(company.id, partyForm, session.userId);
        setMessage(`${partyForm.accountType === "VENDOR" ? "Vendor" : "Party"} created successfully.`);
      }

      setPartyModalOpen(false);
      if (editingParty && selectedParty?.id === editingParty.id) {
        setSelectedParty({
          ...selectedParty,
          name: partyForm.name.trim(),
          phone: partyForm.phone.trim(),
          whatsapp: partyForm.whatsapp.trim(),
          address: partyForm.address.trim(),
          notes: partyForm.notes.trim(),
          status: partyForm.status,
          account_type: partyForm.accountType,
          updated_at: new Date().toISOString(),
        });
      }
      setEditingParty(null);
      setPartyForm(blankParty);
      await loadParties(partySearch);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function openLedger(party: Party) {
    setSelectedParty(party);
    setWorkspaceView("party-ledger");
    setMessage("");
    setError("");
  }

  function renderHeader() {
    return (
      <header className="app-header">
        <div className="identity">
          <div className="header-logo">
            {company?.logo_data ? <img src={company.logo_data} alt="" /> : initials}
          </div>
          <div>
            <span className="eyebrow gold">ACTIVE COMPANY</span>
            <h1>{company?.name}</h1>
            <p>{company?.address}</p>
          </div>
        </div>

        <div className="header-actions">
          <div className="signed-user">
            <small>{company?.company_code} · {session ? ROLE_LABELS[session.role] : ""}</small>
            <b>{session?.fullName}</b>
          </div>
          <button className="ghost-btn" onClick={logout}>Sign Out</button>
        </div>
      </header>
    );
  }

  function renderNav() {
    const dashboardActive = ["dashboard", "parties", "party-ledger"].includes(workspaceView);
    const bookingsActive = ["bookings", "accommodation", "services"].includes(workspaceView);

    return (
      <nav className="workspace-nav main-workspace-nav">
        <button className={dashboardActive ? "active" : ""} onClick={() => setWorkspaceView("dashboard")}>Dashboard</button>
        {can("view_bookings") && <button className={bookingsActive ? "active" : ""} onClick={() => setWorkspaceView("bookings")}>Bookings</button>}
        {can("view_payments") && <button className={workspaceView === "payments" ? "active" : ""} onClick={() => setWorkspaceView("payments")}>Payments</button>}
        {can("view_statements") && <button className={workspaceView === "statements" ? "active" : ""} onClick={() => setWorkspaceView("statements")}>Statements</button>}
        <button className={workspaceView === "security" ? "active security-nav-button" : "security-nav-button"} onClick={() => setWorkspaceView("security")}>Account & Security</button>
      </nav>
    );
  }

  function openAccountView(next: AccountView) {
    setAccountView(next);
    setWorkspaceView("parties");
    setMessage("");
    setError("");
  }

  function renderDashboardTabs() {
    return (
      <div className="dashboard-subnav">
        <button className={workspaceView === "dashboard" ? "active" : ""} onClick={() => setWorkspaceView("dashboard")}>Overview</button>
        {can("view_parties") && <button className={workspaceView === "parties" && accountView === "PARTY" ? "active" : ""} onClick={() => openAccountView("PARTY")}>Parties <span>{partyAccounts.length}</span></button>}
        {can("view_parties") && <button className={workspaceView === "parties" && accountView === "VENDOR" ? "active" : ""} onClick={() => openAccountView("VENDOR")}>Vendors <span>{vendorAccounts.length}</span></button>}
        {can("view_parties") && unassignedAccounts.length > 0 && <button className={workspaceView === "parties" && accountView === "UNASSIGNED" ? "active warning" : "warning"} onClick={() => openAccountView("UNASSIGNED")}>Needs Classification <span>{unassignedAccounts.length}</span></button>}
      </div>
    );
  }

  if (screen === "loading") {
    return (
      <main className="center">
        <div className="card loading">
          <div className="mark">TA</div>
          <h1>Travel Accounting</h1>
          <p>{error || "Preparing your workspace..."}</p>
        </div>
      </main>
    );
  }

  if (screen === "setup") {
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

            <button className="signup-back-v8b" type="button" onClick={() => { setError(""); setSetup(blankSetup); setScreen("login"); }}>
              Back to Sign In
            </button>
          </form>
        </section>
      </main>
    );
  }

  if (screen === "login") {
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
          <button className="create-company-login-button" type="button" onClick={() => { setAccountCreatedNotice(null); setMessage(""); setError(""); setSetup(blankSetup); setScreen("setup"); }}>Create an Account</button>

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

  return (
    <main className="workspace">
      {renderHeader()}
      {renderNav()}
      {["dashboard", "parties"].includes(workspaceView) && renderDashboardTabs()}

      {workspaceView === "dashboard" && (
        <>
          <section className="welcome">
            <div>
              <span className="ready">COMPANY WORKSPACE</span>
              <h2>Travel accounting workspace</h2>
              <p>Company access, employee roles, permissions and audit controls are active for this workspace.</p>
            </div>

            <div className="stats phase5-stats">
              <div>
                <small>PARTIES</small>
                <b>{partyAccounts.length}</b>
              </div>
              <div className="purchase-stat">
                <small>TOTAL PURCHASE</small>
                <b className="stat-money">{formatMoney(companyPurchaseTotal)}</b>
              </div>
              <div className="paid-stat">
                <small>TOTAL PAID</small>
                <b className="stat-money">{formatMoney(companyPaidTotal)}</b>
              </div>
              <div className={companyBalance > 0 ? "balance-stat due" : "balance-stat clear"}>
                <small>BALANCE</small>
                <b className="stat-money">{formatMoney(companyBalance)}</b>
              </div>
            </div>
          </section>

          <section className="module-grid architecture-grid">
            {can("view_parties") && <article className="module-card live"><span>01</span><h3>Parties</h3><p>Customers / agents that you sell services to.</p><button className="primary small" onClick={() => openAccountView("PARTY")}>Open Parties</button></article>}
            {can("view_parties") && <article className="module-card live vendor-live"><span>02</span><h3>Vendors</h3><p>Suppliers that you purchase travel services from.</p><button className="primary small" onClick={() => openAccountView("VENDOR")}>Open Vendors</button></article>}
            {can("view_bookings") && <article className="module-card live services-live"><span>03</span><h3>Bookings</h3><p>Sale / Purchase first, then Package, Ticket, Hotel, Visa, Transport or Misc.</p><button className="primary small green-primary" onClick={() => setWorkspaceView("bookings")}>Open Bookings</button></article>}
            {can("view_payments") && <article className="module-card live payments-live"><span>04</span><h3>Payments</h3><p>Accounts roles can access the current payment workspace while it is redesigned later.</p><button className="primary small purple-primary" onClick={() => setWorkspaceView("payments")}>Open Payments</button></article>}
            {can("view_statements") && <article className="module-card live statements-live"><span>05</span><h3>Statements</h3><p>The approved V6 jsPDF statement engine remains unchanged.</p><button className="primary small statement-primary" onClick={() => setWorkspaceView("statements")}>Open Statements</button></article>}
            <article className="module-card live security-live"><span>06</span><h3>Account & Security</h3><p>{session?.role === "OWNER" ? "Create employee users, control access and review audit activity." : "View your login profile and change your password."}</p><button className="primary small security-primary" onClick={() => setWorkspaceView("security")}>Open Security</button></article>
          </section>
        </>
      )}

      {workspaceView === "parties" && (
        <section className="content-card parties-page">
          <div className="page-title">
            <div>
              <span className="eyebrow blue">MASTER ACCOUNTS</span>
              <h2>{accountView === "PARTY" ? "Parties" : accountView === "VENDOR" ? "Vendors" : "Accounts Needing Classification"}</h2>
              <p>{accountView === "PARTY" ? "Customers / agents that you sell services to." : accountView === "VENDOR" ? "Suppliers that you purchase services from." : "Existing accounts are kept safe until you classify each one as Party or Vendor."}</p>
            </div>
            {can("edit_parties") && accountView !== "UNASSIGNED" && (
              <button className="primary" onClick={() => newParty(accountView === "VENDOR" ? "VENDOR" : "PARTY")}>+ Add New {accountView === "PARTY" ? "Party" : "Vendor"}</button>
            )}
          </div>

          {message && <div className="alert success">{message}</div>}
          {error && !partyModalOpen && <div className="alert error">{error}</div>}

          <div className="party-toolbar">
            <div className="search-box">
              <span>⌕</span>
              <input
                value={partySearch}
                onChange={e => searchParties(e.target.value)}
                placeholder={`Search ${accountView === "PARTY" ? "parties" : accountView === "VENDOR" ? "vendors" : "accounts"} by name, phone, WhatsApp or address...`}
              />
            </div>
            <div className="party-count">
              <b>{visibleAccounts.length}</b>
              <span>records shown</span>
            </div>
          </div>

          {visibleAccounts.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">PV</div>
              <h3>{accountView === "UNASSIGNED" ? "No accounts need classification" : `No ${accountView === "PARTY" ? "parties" : "vendors"} created yet`}</h3>
              <p>{accountView === "UNASSIGNED" ? "All existing master accounts have been classified." : `Create your first ${accountView === "PARTY" ? "Party" : "Vendor"} account.`}</p>
              {can("edit_parties") && accountView !== "UNASSIGNED" && <button className="primary" onClick={() => newParty(accountView === "VENDOR" ? "VENDOR" : "PARTY")}>Create First {accountView === "PARTY" ? "Party" : "Vendor"}</button>}
            </div>
          ) : (
            <div className="party-table-wrap">
              <table className="party-table">
                <thead>
                  <tr>
                    <th>SR</th>
                    <th>{accountView === "PARTY" ? "PARTY NAME" : accountView === "VENDOR" ? "VENDOR NAME" : "ACCOUNT NAME"}</th>
                    <th>PHONE / WHATSAPP</th>
                    <th>ADDRESS</th>
                    <th>STATUS</th>
                    <th>ACCOUNT BALANCE</th>
                    <th>ACTIONS</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleAccounts.map((party, index) => (
                    <tr key={party.id}>
                      <td className="centered">{index + 1}</td>
                      <td>
                        <b className="party-name">{party.name}</b>
                        <small className={`account-type-chip ${party.account_type.toLowerCase()}`}>{party.account_type}</small>
                        {party.notes && <small className="table-note">{party.notes}</small>}
                      </td>
                      <td>
                        <span>{party.phone || "—"}</span>
                        {party.whatsapp && <small className="table-note">WA: {party.whatsapp}</small>}
                      </td>
                      <td>{party.address || "—"}</td>
                      <td>
                        <span className={`status ${party.status.toLowerCase()}`}>
                          {party.status}
                        </span>
                      </td>
                      <td className="amount">{formatMoney(
                        (partyAccommodationTotals[party.id] || 0) +
                        (partyServiceTotals[party.id] || 0) -
                        (partyPaymentTotals[party.id] || 0)
                      )}</td>
                      <td>
                        <div className="row-actions">
                          <button onClick={() => openLedger(party)}>Open Ledger</button>
                          {can("edit_parties") && <button onClick={() => editParty(party)}>Edit</button>}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {workspaceView === "bookings" && company && session && can("view_bookings") && (
        <BookingsModule
          companyId={company.id}
          parties={parties}
          userId={session.userId}
          canCreate={can("create_bookings")}
          canEdit={can("edit_bookings")}
          canVoid={can("void_bookings")}
          onChanged={async () => { await loadParties(partySearch); await loadFinancialTotals(); }}
        />
      )}

      {workspaceView === "accommodation" && company && (
        <AccommodationModule
          companyId={company.id}
          parties={parties}
          onOpenLedger={(party) => openLedger(party)}
          onChanged={loadFinancialTotals}
        />
      )}

      {workspaceView === "services" && company && (
        <ServicesModule
          companyId={company.id}
          parties={parties}
          onOpenLedger={(party) => openLedger(party)}
          onChanged={loadFinancialTotals}
        />
      )}

      {workspaceView === "payments" && company && can("view_payments") && (
        <PaymentsModule
          companyId={company.id}
          parties={parties}
          onOpenLedger={(party) => openLedger(party)}
          onChanged={loadFinancialTotals}
        />
      )}

      {workspaceView === "statements" && company && can("view_statements") && (
        <StatementsModule
          company={company}
          parties={parties}
          initialPartyId={statementPartyId}
          onOpenLedger={(party) => openLedger(party)}
        />
      )}

      {workspaceView === "security" && company && session && (
        <SecurityCenter company={company} session={session} onCompanyUpdated={setCompany} />
      )}

      {workspaceView === "party-ledger" && selectedParty && company && (
        <PartyLedger
          companyId={company.id}
          party={selectedParty}
          parties={parties}
          onBack={() => {
            setAccountView(selectedParty.account_type === "VENDOR" ? "VENDOR" : selectedParty.account_type === "UNASSIGNED" ? "UNASSIGNED" : "PARTY");
            setWorkspaceView("parties");
          }}
          onEditParty={editParty}
          onGenerateStatement={(party) => {
            if (!can("view_statements")) { setError("Your role does not allow Statements access."); return; }
            setStatementPartyId(party.id);
            setWorkspaceView("statements");
          }}
          onChanged={loadFinancialTotals}
        />
      )}

      {partyModalOpen && (
        <div className="modal-backdrop" onMouseDown={() => setPartyModalOpen(false)}>
          <section className="modal-card" onMouseDown={e => e.stopPropagation()}>
            <div className="modal-head">
              <div>
                <span className="eyebrow blue">ACCOUNT MASTER</span>
                <h3>{editingParty ? `Edit ${partyForm.accountType === "VENDOR" ? "Vendor" : partyForm.accountType === "PARTY" ? "Party" : "Account"}` : `Add New ${partyForm.accountType === "VENDOR" ? "Vendor" : "Party"}`}</h3>
              </div>
              <button className="close-btn" onClick={() => setPartyModalOpen(false)}>×</button>
            </div>

            {error && <div className="alert error">{error}</div>}

            <div className="form">
              <label>
                {partyForm.accountType === "VENDOR" ? "Vendor Name *" : partyForm.accountType === "PARTY" ? "Party Name *" : "Account Name *"}
                <input
                  autoFocus
                  value={partyForm.name}
                  onChange={e => setPartyForm(prev => ({ ...prev, name: e.target.value }))}
                  placeholder="e.g. Father Umrah Accounts"
                />
              </label>

              <div className="two">
                <label>
                  Phone
                  <input
                    value={partyForm.phone}
                    onChange={e => setPartyForm(prev => ({ ...prev, phone: e.target.value }))}
                    placeholder="+92..."
                  />
                </label>
                <label>
                  WhatsApp
                  <input
                    value={partyForm.whatsapp}
                    onChange={e => setPartyForm(prev => ({ ...prev, whatsapp: e.target.value }))}
                    placeholder="+92..."
                  />
                </label>
              </div>

              <label>
                Address
                <textarea
                  rows={2}
                  value={partyForm.address}
                  onChange={e => setPartyForm(prev => ({ ...prev, address: e.target.value }))}
                  placeholder="Optional address"
                />
              </label>

              <label>
                Notes
                <textarea
                  rows={3}
                  value={partyForm.notes}
                  onChange={e => setPartyForm(prev => ({ ...prev, notes: e.target.value }))}
                  placeholder="Optional internal note"
                />
              </label>

              <label>
                Account Type *
                <select
                  value={partyForm.accountType}
                  onChange={e => setPartyForm(prev => ({
                    ...prev,
                    accountType: e.target.value as "PARTY" | "VENDOR" | "UNASSIGNED"
                  }))}
                >
                  <option value="PARTY">PARTY — Sale / Receivable</option>
                  <option value="VENDOR">VENDOR — Purchase / Payable</option>
                  {editingParty?.account_type === "UNASSIGNED" && <option value="UNASSIGNED">UNASSIGNED — classify later</option>}
                </select>
              </label>

              <label>
                Status
                <select
                  value={partyForm.status}
                  onChange={e => setPartyForm(prev => ({
                    ...prev,
                    status: e.target.value as "ACTIVE" | "INACTIVE"
                  }))}
                >
                  <option value="ACTIVE">ACTIVE</option>
                  <option value="INACTIVE">INACTIVE</option>
                </select>
              </label>
            </div>

            <div className="modal-buttons">
              <button className="secondary" onClick={() => setPartyModalOpen(false)}>Cancel</button>
              <button className="primary" onClick={saveParty} disabled={busy}>
                {busy ? "Saving..." : editingParty ? "Save Changes" : `Create ${partyForm.accountType === "VENDOR" ? "Vendor" : "Party"}`}
              </button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}

export default App;
