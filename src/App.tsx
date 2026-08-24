import { useMemo, useState } from "react";
import "./App.css";
import { BrowserRouter, Routes, Route, Navigate, NavLink, useNavigate, useLocation } from "react-router-dom";
import { AuthProvider, useAuth } from "./AuthContext";
import { WorkspaceProvider, useWorkspace } from "./WorkspaceContext";
import { ROLE_LABELS, hasPermission } from "./permissions";
import { check } from "@tauri-apps/plugin-updater";
import { ask, message } from "@tauri-apps/plugin-dialog";
import { useEffect } from "react";

// Screens
import LoginScreen from "./screens/LoginScreen";
import SetupScreen from "./screens/SetupScreen";
import DashboardScreen from "./screens/DashboardScreen";
import CounterpartiesScreen from "./screens/CounterpartiesScreen";
import PartiesScreen from "./screens/PartiesScreen";
import SettingsScreen from "./screens/SettingsScreen";

// Modules
import BookingsModule from "./Bookings";
import { PaymentsModule } from "./Payments";
import StatementsModule from "./Statements";
import PartyLedger from "./PartyLedger";
import PnLPortfolio from "./PnLPortfolio";

function AppLayout() {
  const { session, company, logout } = useAuth();
  const { parties, loadFinancialTotals, loadParties } = useWorkspace();
  const navigate = useNavigate();
  const location = useLocation();

  const [statementPartyId, setStatementPartyId] = useState("");
  const [bookingReset, setBookingReset] = useState(0);
  const [paymentReset, setPaymentReset] = useState(0);

  useEffect(() => {
    // Only run the auto-updater check if we are inside the Tauri desktop app
    const isTauri = "__TAURI_INTERNALS__" in window;
    if (!isTauri) return;

    let active = true;
    const runCheck = async () => {
      try {
        const update = await check();
        if (active && update) {
          const yes = await ask(`Update to ${update.version} is available!\n\nRelease notes: ${update.body}`, {
            title: "Update Available",
            kind: "info",
          });
          if (yes) {
            await update.downloadAndInstall();
            await message("Update installed successfully! Please restart the application to apply changes.", {
              title: "Update Complete",
              kind: "info",
            });
          }
        }
      } catch (err) {
        console.error("Auto update check failed:", err);
      }
    };
    runCheck();
    return () => {
      active = false;
    };
  }, []);

  const initials = useMemo(() => {
    const text = company?.name || "TA";
    return text
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((x) => x[0]?.toUpperCase())
      .join("");
  }, [company]);

  const can = (permission: any) => hasPermission(session?.role, permission);

  return (
    <main className="workspace">
      <header className="app-header">
        <div className="identity">
          <div className="header-logo">{company?.logo_data ? <img src={company.logo_data} alt="" /> : initials}</div>
          <div>
            <h1>{company?.name}</h1>
          </div>
        </div>

        <div className="header-actions">
          <div className="minimal-user-row">
            <div className="minimal-user-text">
              <b>{session?.username || session?.fullName}</b>
              <small>
                {session ? ROLE_LABELS[session.role] : ""} · {company?.company_code}
              </small>
            </div>
            <button className="minimal-signout-btn" onClick={logout} title="Sign Out">
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
                <polyline points="16 17 21 12 16 7"></polyline>
                <line x1="21" y1="12" x2="9" y2="12"></line>
              </svg>
              Sign Out
            </button>
          </div>
        </div>
      </header>

      <nav className="workspace-nav main-workspace-nav">
        <NavLink to="/" end className={({ isActive }) => (isActive ? "active" : "")}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: "10px" }}>
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="3" y="3" width="7" height="9"></rect>
              <rect x="14" y="3" width="7" height="5"></rect>
              <rect x="14" y="12" width="7" height="9"></rect>
              <rect x="3" y="16" width="7" height="5"></rect>
            </svg>
            Dashboard
          </span>
        </NavLink>
        {can("view_parties") && (
          <NavLink
            to="/parties"
            className={({ isActive }) => (isActive || window.location.pathname.startsWith("/parties/") ? "active" : "")}
          >
            <span style={{ display: "inline-flex", alignItems: "center", gap: "10px" }}>
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                <circle cx="9" cy="7" r="4"></circle>
                <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
                <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
              </svg>
              Counterparties
            </span>
          </NavLink>
        )}
        {can("view_bookings") && (
          <NavLink
            to="/bookings"
            className={({ isActive }) => (isActive ? "active" : "")}
            onClick={() => {
              if (location.pathname === "/bookings") setBookingReset((r) => r + 1);
            }}
          >
            <span style={{ display: "inline-flex", alignItems: "center", gap: "10px" }}>
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.2-1.1.6L2.5 9l8.1 4.5-3.6 3.6-3.4-.6c-.4-.1-.9.2-1.1.6l-.8 2 5.1 1.4 1.4 5.1 2-.8c.4-.2.7-.7.6-1.1l-.6-3.4 3.6-3.6 4.5 8.1c.4.7 1.3.8 2 .1.4-.4.8-1 .6-1.5z"></path>
              </svg>
              Bookings
            </span>
          </NavLink>
        )}
        {can("view_payments") && (
          <NavLink
            to="/payments"
            className={({ isActive }) => (isActive ? "active" : "")}
            onClick={() => {
              if (location.pathname === "/payments") setPaymentReset((r) => r + 1);
            }}
          >
            <span style={{ display: "inline-flex", alignItems: "center", gap: "10px" }}>
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <rect x="1" y="4" width="22" height="16" rx="2" ry="2"></rect>
                <line x1="1" y1="10" x2="23" y2="10"></line>
              </svg>
              Payments
            </span>
          </NavLink>
        )}
        {can("view_statements") && (
          <NavLink to="/statements" className={({ isActive }) => (isActive ? "active" : "")}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: "10px" }}>
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                <polyline points="14 2 14 8 20 8"></polyline>
                <line x1="16" y1="13" x2="8" y2="13"></line>
                <line x1="16" y1="17" x2="8" y2="17"></line>
                <polyline points="10 9 9 9 8 9"></polyline>
              </svg>
              Statements
            </span>
          </NavLink>
        )}
        {can("view_statements") && (
          <NavLink to="/pnl" className={({ isActive }) => (isActive ? "active" : "")}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: "10px" }}>
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="23 6 13.5 15.5 8.5 10.5 1 18"></polyline>
                <polyline points="17 6 23 6 23 12"></polyline>
              </svg>
              PnL Portfolio
            </span>
          </NavLink>
        )}
        <NavLink
          to="/settings"
          className={({ isActive }) =>
            isActive || window.location.pathname.startsWith("/settings")
              ? "active security-nav-button"
              : "security-nav-button"
          }
        >
          <span style={{ display: "inline-flex", alignItems: "center", gap: "10px" }}>
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="3"></circle>
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
            </svg>
            Settings
          </span>
        </NavLink>
      </nav>

      <div className="layout-content-wrapper">
        <Routes>
          <Route path="/" element={<DashboardScreen />} />
          <Route path="/settings/*" element={<SettingsScreen />} />

          <Route path="/parties" element={<CounterpartiesScreen />} />

          <Route path="/parties/:view" element={<PartiesScreen />} />

          <Route
            path="/parties/ledger/:id"
            element={
              company ? (
                <LedgerRoute
                  companyId={company.id}
                  parties={parties}
                  onChanged={loadFinancialTotals}
                  setStatementPartyId={setStatementPartyId}
                />
              ) : null
            }
          />

          <Route
            path="/bookings"
            element={
              company && session && can("view_bookings") ? (
                <BookingsModule
                  key={`bookings-${bookingReset}`}
                  companyId={company.id}
                  parties={parties}
                  userId={session.userId}
                  canCreate={can("create_bookings")}
                  canEdit={can("edit_bookings")}
                  canVoid={can("void_bookings")}
                  onChanged={async () => {
                    await loadParties();
                    await loadFinancialTotals();
                  }}
                />
              ) : (
                <Navigate to="/" />
              )
            }
          />

          <Route
            path="/payments"
            element={
              company && can("view_payments") ? (
                <PaymentsModule
                  key={`payments-${paymentReset}`}
                  companyId={company.id}
                  parties={parties}
                  onOpenLedger={(party) => navigate(`/parties/ledger/${party.id}`)}
                  onChanged={loadFinancialTotals}
                />
              ) : (
                <Navigate to="/" />
              )
            }
          />

          <Route
            path="/statements"
            element={
              company && can("view_statements") ? (
                <StatementsModule
                  key={location.key}
                  company={company}
                  parties={parties}
                  initialPartyId={statementPartyId}
                  onConsumed={() => setStatementPartyId("")}
                  onOpenLedger={(party) => navigate(`/parties/ledger/${party.id}`)}
                />
              ) : (
                <Navigate to="/" />
              )
            }
          />

          <Route
            path="/pnl"
            element={
              company && can("view_statements") ? (
                <PnLPortfolio companyId={company.id} onBack={() => navigate("/")} />
              ) : (
                <Navigate to="/" />
              )
            }
          />
        </Routes>
      </div>
    </main>
  );
}

import { useParams } from "react-router-dom";
import { Party } from "./db";

function LedgerRoute({
  companyId,
  parties,
  onChanged,
  setStatementPartyId,
}: {
  companyId: string;
  parties: Party[];
  onChanged: () => void;
  setStatementPartyId: (id: string) => void;
}) {
  const { id } = useParams();
  const navigate = useNavigate();
  const { session } = useAuth();
  const can = (permission: any) => hasPermission(session?.role, permission);
  const party = parties.find((p) => p.id === id);

  if (!party) return <Navigate to="/parties/PARTY" />;

  return (
    <PartyLedger
      companyId={companyId}
      party={party}
      parties={parties}
      onBack={() => navigate(`/parties/${party.account_type === "UNASSIGNED" ? "UNASSIGNED" : party.account_type}`)}
      onEditParty={() => {}} // We'll disable edit from ledger route for now or pass it through
      onGenerateStatement={(party: Party) => {
        if (!can("view_statements")) return;
        setStatementPartyId(party.id);
        navigate("/statements");
      }}
      onChanged={onChanged}
    />
  );
}

function RouterContent() {
  const { isInitialized, session, company, error } = useAuth();
  const [accountCreatedNotice, setAccountCreatedNotice] = useState<any>(null);
  const location = useLocation();

  if (!isInitialized) {
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

  // If session is loaded but we are stuck on the login route, push to dashboard!
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
