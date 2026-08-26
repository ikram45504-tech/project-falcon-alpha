import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { Party, getParties } from "./db";
import { getPartyBookingTotals } from "./BookingAccounting";
import { getPartyPaymentTotals } from "./db";
import { useAuth } from "./AuthContext";

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
  searchParties: (value: string) => Promise<void>;
  loadParties: (search?: string) => Promise<void>;
  loadFinancialTotals: () => Promise<void>;
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
  const [error, setError] = useState("");

  const loadParties = useCallback(
    async (search = "") => {
      if (!company) return;
      try {
        setParties(await getParties(company.id, search));
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [company],
  );

  const loadFinancialTotals = useCallback(async () => {
    if (!company) return;
    try {
      const [bookingRows, paymentRows] = await Promise.all([
        getPartyBookingTotals(company.id),
        getPartyPaymentTotals(company.id),
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
  }, [company]);

  const searchParties = useCallback(
    async (value: string) => {
      setPartySearch(value);
      await loadParties(value);
    },
    [loadParties],
  );

  useEffect(() => {
    if (!company) return;
    void loadParties();
    void loadFinancialTotals();
  }, [company, loadParties, loadFinancialTotals]);

  // Auto-refresh UI after background cloud sync (no Sync button required).
  useEffect(() => {
    if (!company) return;

    const onSyncComplete = (event: Event) => {
      const detail = (event as CustomEvent<{ companyId?: string }>).detail;
      if (detail?.companyId && detail.companyId !== company.id) return;
      void loadParties(partySearch);
      void loadFinancialTotals();
    };

    window.addEventListener("travel-accounting:sync-complete", onSyncComplete);
    return () => window.removeEventListener("travel-accounting:sync-complete", onSyncComplete);
  }, [company, loadParties, loadFinancialTotals, partySearch]);

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
        searchParties,
        loadParties,
        loadFinancialTotals,
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
