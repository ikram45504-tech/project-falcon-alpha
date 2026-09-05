import { Navigate, Route, Routes, useNavigate } from "react-router-dom";
import DashboardScreen from "../screens/DashboardScreen";
import CounterpartiesScreen from "../screens/CounterpartiesScreen";
import PartiesScreen from "../screens/PartiesScreen";
import SettingsScreen from "../screens/SettingsScreen";
import BookingsModule from "../Bookings";
import { PaymentsModule } from "../Payments";
import StatementsModule from "../Statements";
import PartyLedger from "../PartyLedger";
import PnLPortfolio from "../PnLPortfolio";
import { hasPermission } from "../permissions";
import { useAuth } from "../AuthContext";
import type { WorkspaceLayoutState } from "./useWorkspaceLayoutState";
import { Party, Company } from "../db";
import { normalizeEntitlements } from "../companyEntitlements";
import { COMPANY_SUSPENDED_MESSAGE, companyAllowsWrites, notifyCompanySuspended } from "../companyStatus";
import { useParams } from "react-router-dom";

function SuspendedSectionNotice({ title }: { title: string }) {
  return (
    <section className="content-card">
      <h2>{title}</h2>
      <p>{COMPANY_SUSPENDED_MESSAGE}</p>
    </section>
  );
}

function LedgerRoute({
  company,
  companyId,
  parties,
  onChanged,
  setStatementPartyId,
}: {
  company: Company;
  companyId: string;
  parties: Party[];
  onChanged: () => void;
  setStatementPartyId: (id: string) => void;
}) {
  const { id } = useParams();
  const navigate = useNavigate();
  const { session } = useAuth();
  const can = (permission: Parameters<typeof hasPermission>[1]) => hasPermission(session?.role, permission);
  const party = parties.find((p) => p.id === id);

  if (!party) return <Navigate to="/parties/PARTY" />;

  return (
    <PartyLedger
      company={company}
      companyId={companyId}
      party={party}
      parties={parties}
      userId={session?.userId}
      preparedByName={session?.fullName}
      canEditPayments={can("edit_payments") && companyAllowsWrites(company.status)}
      onBack={() => navigate(`/parties/${party.account_type === "UNASSIGNED" ? "UNASSIGNED" : party.account_type}`)}
      onEditParty={() => {}}
      onGenerateStatement={(ledgerParty: Party) => {
        if (!can("view_statements")) return;
        if (!companyAllowsWrites(company.status)) {
          notifyCompanySuspended();
          return;
        }
        setStatementPartyId(ledgerParty.id);
        navigate("/statements");
      }}
      onOpenPayments={() => navigate("/payments")}
      onChanged={onChanged}
    />
  );
}

export function WorkspaceRoutes({ state }: { state: WorkspaceLayoutState }) {
  const navigate = useNavigate();
  const {
    company,
    session,
    parties,
    can,
    canMutate,
    location,
    statementPartyId,
    setStatementPartyId,
    bookingReset,
    paymentReset,
    loadParties,
    loadFinancialTotals,
    refreshDashboard,
  } = state;
  const planFeatures = normalizeEntitlements(company?.entitlements).features;

  return (
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
              company={company}
              companyId={company.id}
              parties={parties}
              onChanged={() => {
                void loadFinancialTotals();
                void refreshDashboard();
              }}
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
              canCreate={can("create_bookings") && canMutate}
              canEdit={can("edit_bookings") && canMutate}
              canVoid={can("void_bookings") && canMutate}
              onChanged={async () => {
                await loadParties();
                await loadFinancialTotals();
                await refreshDashboard();
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
              company={company}
              companyId={company.id}
              parties={parties}
              userId={session?.userId}
              preparedByName={session?.fullName}
              canEdit={can("edit_payments") && canMutate}
              onOpenLedger={(party) => navigate(`/parties/ledger/${party.id}`)}
              onChanged={() => {
                void loadFinancialTotals();
                void refreshDashboard();
              }}
            />
          ) : (
            <Navigate to="/" />
          )
        }
      />
      <Route
        path="/statements"
        element={
          company && can("view_statements") && planFeatures.statements ? (
            canMutate ? (
              <StatementsModule
                key={location.key}
                company={company}
                parties={parties}
                initialPartyId={statementPartyId}
                onConsumed={() => setStatementPartyId("")}
                onOpenLedger={(party) => navigate(`/parties/ledger/${party.id}`)}
              />
            ) : (
              <SuspendedSectionNotice title="Statements" />
            )
          ) : (
            <Navigate to="/" />
          )
        }
      />
      <Route
        path="/pnl"
        element={
          company && can("view_statements") && planFeatures.pnl ? (
            canMutate ? (
              <PnLPortfolio companyId={company.id} onBack={() => navigate("/")} />
            ) : (
              <SuspendedSectionNotice title="PnL Portfolio" />
            )
          ) : (
            <Navigate to="/" />
          )
        }
      />
    </Routes>
  );
}
