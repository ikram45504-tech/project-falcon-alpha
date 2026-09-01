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
import { Party } from "../db";
import { useParams } from "react-router-dom";

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
  const can = (permission: Parameters<typeof hasPermission>[1]) => hasPermission(session?.role, permission);
  const party = parties.find((p) => p.id === id);

  if (!party) return <Navigate to="/parties/PARTY" />;

  return (
    <PartyLedger
      companyId={companyId}
      party={party}
      parties={parties}
      onBack={() => navigate(`/parties/${party.account_type === "UNASSIGNED" ? "UNASSIGNED" : party.account_type}`)}
      onEditParty={() => {}}
      onGenerateStatement={(ledgerParty: Party) => {
        if (!can("view_statements")) return;
        setStatementPartyId(ledgerParty.id);
        navigate("/statements");
      }}
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
    location,
    statementPartyId,
    setStatementPartyId,
    bookingReset,
    paymentReset,
    loadParties,
    loadFinancialTotals,
  } = state;

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
              company={company}
              companyId={company.id}
              parties={parties}
              userId={session?.userId}
              preparedByName={session?.fullName}
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
  );
}
