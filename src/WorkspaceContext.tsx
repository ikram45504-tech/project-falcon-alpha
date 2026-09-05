import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { Party, getParties } from "./db";
import { getPartyBookingTotals } from "./BookingAccounting";
import { getPartyPaymentTotals } from "./db";
import { useAuth } from "./AuthContext";
import { loadDashboardData, type DashboardMetrics, type RecentActivity } from "./DashboardDb";

type AccountBookingTotals = { sale_total: number; purchase_total: number };

type WorkspaceContextType = {
  parties: Party[];
  partySearch: string;
  partyBookingTotals: Record<string, AccountBookingTotals>;
  partyPaymentTotals: Record<string, number>;
  companySaleTotal: number;
  companyPurchaseTotal: number;
  companyGrossMargin: number;
  partyAccounts: Party[];
  vendorAccounts: Party[];
  unassignedAccounts: Party[];
  dashboardMetrics: DashboardMetrics | null;
  dashboardRecent: RecentActivity[];
  dashboardLoading: boolean;
  searchParties: (value: string) => Promise<void>;
  loadParties: (search?: string) => Promise<void>;
  loadFinancialTotals: () => Promise<void>;
  refreshDashboard: () => Promise<void>;
  error: string;
  setError: (msg: string) => void;
};

const WorkspaceContext = createContext<WorkspaceContextType | undefined>(undefined);

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const { company } = useAuth();

  const [parties, setParties] = useState<Party[]>([]);
  const [partySearch, setPartySearch] = useState("");
  const [partyBookingTotals, setPartyBookingTotals] = useState<Record<string, AccountBookingTotals>>({});
  const [partyPaymentTotals, setPartyPaymentTotals] = useState<Record<string, number>>({});
  const [dashboardMetrics, setDashboardMetrics] = useState<DashboardMetrics | null>(null);
  const [dashboardRecent, setDashboardRecent] = useState<RecentActivity[]>([]);
  const [dashboardLoading, setDashboardLoading] = useState(true);
  const [error, setError] = useState("");
  const dashboardHasDataRef = useRef(false);

  const companyId = company?.id ?? "";

  const loadParties = useCallback(
    async (search = "") => {
      if (!companyId) return;
      try {
        setParties(await getParties(companyId, search));
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [companyId],
  );

  const loadFinancialTotals = useCallback(async () => {
    if (!companyId) return;
    try {
      const [bookingRows, paymentRows] = await Promise.all([
        getPartyBookingTotals(companyId),
        getPartyPaymentTotals(companyId),
      ]);

      const bookingNext: Record<string, AccountBookingTotals> = {};
      for (const row of bookingRows) {
        bookingNext[row.counterparty_id] = {
          sale_total: Number(row.sale_total || 0),
          purchase_total: Number(row.purchase_total || 0),
        };
      }

      const paymentNext: Record<string, number> = {};
      for (const row of paymentRows) {
        paymentNext[row.party_id] = Number(row.paid_amount || 0);
      }

      setPartyBookingTotals(bookingNext);
      setPartyPaymentTotals(paymentNext);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [companyId]);

  const searchParties = useCallback(
    async (value: string) => {
      setPartySearch(value);
      await loadParties(value);
    },
    [loadParties],
  );

  const refreshDashboard = useCallback(async () => {
    if (!companyId) return;
    if (!dashboardHasDataRef.current) setDashboardLoading(true);
    try {
      const { metrics, recent } = await loadDashboardData(companyId, 6);
      dashboardHasDataRef.current = true;
      setDashboardMetrics(metrics);
      setDashboardRecent(recent);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setDashboardLoading(false);
    }
  }, [companyId]);

  useEffect(() => {
    dashboardHasDataRef.current = false;
    setDashboardMetrics(null);
    setDashboardRecent([]);
    setDashboardLoading(Boolean(companyId));
  }, [companyId]);

  useEffect(() => {
    if (!companyId) return;
    void loadParties();
    void loadFinancialTotals();
    void refreshDashboard();
  }, [companyId, loadParties, loadFinancialTotals, refreshDashboard]);

  // Auto-refresh UI after background cloud sync (no Sync button required).
  useEffect(() => {
    if (!company) return;

    const onSyncComplete = (event: Event) => {
      const detail = (event as CustomEvent<{ companyId?: string }>).detail;
      if (detail?.companyId && detail.companyId !== company.id) return;
      void loadParties(partySearch);
      void loadFinancialTotals();
      void refreshDashboard();
    };

    window.addEventListener("travel-accounting:sync-complete", onSyncComplete);
    return () => window.removeEventListener("travel-accounting:sync-complete", onSyncComplete);
  }, [company, loadParties, loadFinancialTotals, partySearch, refreshDashboard]);

  const partyAccounts = parties.filter((item) => item.account_type === "PARTY");
  const vendorAccounts = parties.filter((item) => item.account_type === "VENDOR");
  const unassignedAccounts = parties.filter((item) => item.account_type === "UNASSIGNED");

  const companySaleTotal = Object.values(partyBookingTotals).reduce<number>(
    (sum, value) => sum + Number(value.sale_total || 0),
    0,
  );
  const companyPurchaseTotal = Object.values(partyBookingTotals).reduce<number>(
    (sum, value) => sum + Number(value.purchase_total || 0),
    0,
  );
  const companyGrossMargin = companySaleTotal - companyPurchaseTotal;

  return (
    <WorkspaceContext.Provider
      value={{
        parties,
        partySearch,
        partyBookingTotals,
        partyPaymentTotals,
        companySaleTotal,
        companyPurchaseTotal,
        companyGrossMargin,
        partyAccounts,
        vendorAccounts,
        unassignedAccounts,
        dashboardMetrics,
        dashboardRecent,
        dashboardLoading,
        searchParties,
        loadParties,
        loadFinancialTotals,
        refreshDashboard,
        error,
        setError,
      }}
    >
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace() {
  const context = useContext(WorkspaceContext);
  if (context === undefined) {
    throw new Error("useWorkspace must be used within a WorkspaceProvider");
  }
  return context;
}
