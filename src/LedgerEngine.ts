import Database from "@tauri-apps/plugin-sql";
import { initMiscDatabase } from "./miscDb";
import type { Party } from "./db";
import { bookingServiceDisplayLabel, type BookingServiceName } from "./BookingLifecycle";
import { bookingLedgerBaseAmount, getBookingAccountingEntries, type BookingAccountingEntry } from "./BookingAccounting";
import { isDesktopApp } from "./cloudSync";
import { loadSegmentAdjustmentsForStatements } from "./SegmentAdjustmentRecord";
import { supabase } from "./supabaseClient";

const DB_PATH = "sqlite:travel-accounting.db";
let databasePromise: Promise<Database> | null = null;

async function db() {
  if (!databasePromise) {
    if (isDesktopApp()) {
      databasePromise = Database.load(DB_PATH);
    } else {
      console.warn("Running in Web Mode. Local database is not available for " + DB_PATH);
      databasePromise = Promise.resolve({
        execute: async () => ({ lastInsertId: 0, rowsAffected: 0 }),
        select: async () => [],
      } as any);
    }
  }
  return databasePromise;
}

export type LedgerTransaction = {
  id: string;
  transaction_date: string;
  created_at: string;
  kind: "SALE_BOOKING" | "PURCHASE_BOOKING" | "PAYMENT" | "BOOKING_ADJUSTMENT";
  service_type: string;
  ref_no: string;
  description: string;
  total_pkr: number;
  status: "ACTIVE" | "VOID";
  payment_kind?: string;
};

export type LedgerRow = LedgerTransaction & {
  debit: number;
  credit: number;
  running_balance: number;
};

const bookingUnion = `
  SELECT b.id,b.company_id,'PACKAGE' AS service_type,b.transaction_type,b.counterparty_id,
         b.transaction_date,b.ub_number AS ref_no,
         b.total_pkr,b.status,b.created_at
  FROM package_bookings b
  UNION ALL
  SELECT b.id,b.company_id,'TICKET' AS service_type,b.transaction_type,b.counterparty_id,
         b.transaction_date,b.ub_number AS ref_no,
         b.total_pkr,b.status,b.created_at
  FROM ticket_bookings b
  UNION ALL
  SELECT b.id,b.company_id,'HOTEL' AS service_type,b.transaction_type,b.counterparty_id,
         b.transaction_date,b.ub_number AS ref_no,
         b.total_pkr,b.status,b.created_at
  FROM hotel_bookings b
  UNION ALL
  SELECT b.id,b.company_id,'VISA' AS service_type,b.transaction_type,b.counterparty_id,
         b.transaction_date,b.ub_number AS ref_no,
         b.total_pkr,b.status,b.created_at
  FROM visa_bookings b
  UNION ALL
  SELECT b.id,b.company_id,'TRANSPORT' AS service_type,b.transaction_type,b.counterparty_id,
         b.transaction_date,b.ub_number AS ref_no,
         b.total_pkr,b.status,b.created_at
  FROM transport_bookings b
  UNION ALL
  SELECT b.id,b.company_id,'MISC' AS service_type,b.transaction_type,b.counterparty_id,
         b.transaction_date,b.ub_number AS ref_no,
         b.total_pkr,b.status,b.created_at
  FROM misc_bookings b
`;

function sortLedgerTransactions(transactions: LedgerTransaction[]) {
  return [...transactions].sort((a, b) => {
    const dateCmp = String(a.transaction_date).localeCompare(String(b.transaction_date));
    if (dateCmp !== 0) return dateCmp;
    return String(a.created_at).localeCompare(String(b.created_at));
  });
}

export function buildLedgerRows(transactions: LedgerTransaction[], party: Party): LedgerRow[] {
  const isVendor = party.account_type === "VENDOR";
  let running_balance = 0;

  return transactions.map((tx) => {
    let debit = 0;
    let credit = 0;
    let description = tx.description;
    if (tx.kind === "SALE_BOOKING" || tx.kind === "PURCHASE_BOOKING") {
      const service = tx.service_type as BookingServiceName;
      description = `${bookingServiceDisplayLabel(service)} Booking`;
    } else if (tx.kind === "BOOKING_ADJUSTMENT") {
      description = "Booking Adjustment";
    }

    if (tx.status === "ACTIVE") {
      if (isVendor) {
        if (tx.kind === "PURCHASE_BOOKING") {
          credit = tx.total_pkr;
          running_balance += credit;
        } else if (tx.kind === "PAYMENT") {
          if (tx.payment_kind === "VENDOR_REFUND") {
            credit = tx.total_pkr;
            running_balance += credit;
          } else {
            debit = tx.total_pkr;
            running_balance -= debit;
          }
        } else if (tx.kind === "BOOKING_ADJUSTMENT") {
          const delta = Number(tx.total_pkr || 0);
          if (delta > 0) {
            credit = delta;
            running_balance += credit;
          } else if (delta < 0) {
            debit = -delta;
            running_balance -= debit;
          }
        } else if (tx.kind === "SALE_BOOKING") {
          debit = tx.total_pkr;
          running_balance -= debit;
          description = `${tx.description} [Cross-type: SALE on VENDOR]`;
        }
      } else if (tx.kind === "SALE_BOOKING") {
        debit = tx.total_pkr;
        running_balance += debit;
      } else if (tx.kind === "PAYMENT") {
        if (tx.payment_kind === "PARTY_REFUND") {
          debit = tx.total_pkr;
          running_balance += debit;
        } else {
          credit = tx.total_pkr;
          running_balance -= credit;
        }
      } else if (tx.kind === "BOOKING_ADJUSTMENT") {
        const delta = Number(tx.total_pkr || 0);
        if (delta > 0) {
          debit = delta;
          running_balance += debit;
        } else if (delta < 0) {
          credit = -delta;
          running_balance -= credit;
        }
      } else if (tx.kind === "PURCHASE_BOOKING") {
        credit = tx.total_pkr;
        running_balance -= credit;
        description = `${tx.description} [Cross-type: PURCHASE on PARTY]`;
      }
    }

    return {
      ...tx,
      description,
      debit,
      credit,
      running_balance,
    };
  });
}

/**
 * Period view of a full chronological ledger: keeps row debit/credit,
 * but recomputes running balance from the statement opening balance so the
 * first in-period row ties to opening and the last ties to closing.
 */
export function sliceLedgerRowsForPeriod(
  rows: LedgerRow[],
  fromDate: string,
  toDate: string,
  openingBalance: number,
  accountType: Party["account_type"],
): LedgerRow[] {
  const isVendor = accountType === "VENDOR";
  let running = Number(openingBalance || 0);

  return rows
    .filter((row) => row.status === "ACTIVE" && row.transaction_date >= fromDate && row.transaction_date <= toDate)
    .map((row) => {
      const debit = Number(row.debit || 0);
      const credit = Number(row.credit || 0);
      running += isVendor ? credit - debit : debit - credit;
      return {
        ...row,
        running_balance: running,
      };
    });
}

async function fetchWebPaymentLedgerTransactions(companyId: string, partyId: string) {
  const { data: payments, error: paymentError } = await supabase
    .from("payment_entries")
    .select("id,transaction_date,created_at,payment_type,receipt_no,description,paid_amount,status")
    .eq("company_id", companyId)
    .eq("party_id", partyId);
  if (paymentError) throw new Error(paymentError.message);

  const paymentIds = (payments || []).map((p) => p.id);
  const metaByPayment = new Map<string, string>();
  if (paymentIds.length) {
    const { data: metas, error: metaError } = await supabase
      .from("payment_v2_meta")
      .select("payment_id,transaction_kind")
      .in("payment_id", paymentIds);
    if (metaError) throw new Error(metaError.message);
    for (const meta of metas || []) {
      metaByPayment.set(meta.payment_id, meta.transaction_kind);
    }
  }

  return (payments || []).map((row): LedgerTransaction => {
    const kind = metaByPayment.get(row.id);
    const isRefund = kind === "PARTY_REFUND" || kind === "VENDOR_REFUND";
    return {
      id: row.id,
      transaction_date: row.transaction_date,
      created_at: row.created_at,
      kind: "PAYMENT",
      service_type: row.payment_type,
      ref_no: row.receipt_no,
      description: row.description || (isRefund ? "Refund" : "Payment"),
      total_pkr: Number(row.paid_amount) || 0,
      status: row.status as "ACTIVE" | "VOID",
      payment_kind: kind,
    };
  });
}

async function enrichLedgerTransactions(companyId: string, transactions: LedgerTransaction[]) {
  const bookingTransactions = transactions.filter((tx) => tx.kind === "SALE_BOOKING" || tx.kind === "PURCHASE_BOOKING");
  const paymentTransactions = transactions.filter((tx) => tx.kind === "PAYMENT");
  const bookingIds = bookingTransactions.map((tx) => tx.id);
  if (!bookingIds.length) return transactions;

  const adjustments = await loadSegmentAdjustmentsForStatements(companyId, bookingIds);
  const visible = adjustments.filter((row) => row.adjustment_type !== "CORRECTION");

  const adjustedBookings = bookingTransactions.map((tx) => ({
    ...tx,
    total_pkr: bookingLedgerBaseAmount(
      {
        id: tx.id,
        service_type: tx.service_type as BookingAccountingEntry["service_type"],
        total_pkr: tx.total_pkr,
      },
      visible,
    ),
  }));

  const adjustmentTransactions: LedgerTransaction[] = visible
    .filter((row) => Number(row.account_delta_pkr || 0) !== 0)
    .map((row) => {
      const booking = bookingTransactions.find(
        (tx) => tx.id === row.booking_id && tx.service_type === row.service_type,
      );
      return {
        id: row.id,
        transaction_date: row.adjustment_date,
        created_at: row.created_at,
        kind: "BOOKING_ADJUSTMENT" as const,
        service_type: row.service_type,
        ref_no: booking?.ref_no || "",
        description: "Booking Adjustment",
        total_pkr: Number(row.account_delta_pkr || 0),
        status: "ACTIVE" as const,
      };
    });

  return sortLedgerTransactions([...adjustedBookings, ...adjustmentTransactions, ...paymentTransactions]);
}

async function fetchWebLedgerTransactions(companyId: string, partyId: string) {
  const [bookings, payments] = await Promise.all([
    getBookingAccountingEntries(companyId, partyId),
    fetchWebPaymentLedgerTransactions(companyId, partyId),
  ]);

  const bookingTransactions: LedgerTransaction[] = bookings.map((row) => ({
    id: row.id,
    transaction_date: row.transaction_date,
    created_at: row.created_at,
    kind: (row.transaction_type === "SALE" ? "SALE_BOOKING" : "PURCHASE_BOOKING") as LedgerTransaction["kind"],
    service_type: row.service_type,
    ref_no: row.ub_number,
    description: `${bookingServiceDisplayLabel(row.service_type)} Booking`,
    total_pkr: Number(row.total_pkr) || 0,
    status: row.status,
  }));

  return sortLedgerTransactions([...bookingTransactions, ...payments]);
}

export async function getChronologicalLedger(companyId: string, party: Party): Promise<LedgerRow[]> {
  await initMiscDatabase();

  let transactions: LedgerTransaction[];

  if (!isDesktopApp()) {
    transactions = await fetchWebLedgerTransactions(companyId, party.id);
  } else {
    const database = await db();
    transactions = await database.select<LedgerTransaction[]>(
      `SELECT * FROM (
      SELECT 
        id,
        transaction_date,
        created_at,
        CASE 
          WHEN transaction_type = 'SALE' THEN 'SALE_BOOKING'
          ELSE 'PURCHASE_BOOKING'
        END AS kind,
        service_type,
        ref_no,
        service_type || ' Booking' AS description,
        total_pkr,
        status,
        NULL AS payment_kind
      FROM (${bookingUnion}) b
      WHERE b.company_id = $1 AND b.counterparty_id = $2
      
      UNION ALL
      
      SELECT 
        id,
        transaction_date,
        created_at,
        'PAYMENT' AS kind,
        payment_type AS service_type,
        receipt_no AS ref_no,
        description,
        paid_amount AS total_pkr,
        status,
        (SELECT transaction_kind FROM payment_v2_meta WHERE payment_id = p.id LIMIT 1) AS payment_kind
      FROM payment_entries p
      WHERE p.company_id = $1 AND p.party_id = $2
    ) q
    ORDER BY q.transaction_date ASC, q.created_at ASC`,
      [companyId, party.id],
    );
  }

  transactions = await enrichLedgerTransactions(companyId, transactions);
  return buildLedgerRows(transactions, party);
}

export async function getGlobalUbSaleOwner(
  companyId: string,
  ubNumber: string,
): Promise<{ partyId: string; service: string } | null> {
  if (!isDesktopApp()) {
    const entries = await getBookingAccountingEntries(companyId);
    const owner = entries.find(
      (row) => row.ub_number === ubNumber && row.transaction_type === "SALE" && row.status === "ACTIVE",
    );
    return owner ? { partyId: owner.counterparty_id, service: owner.service_type } : null;
  }

  const database = await db();
  const owners = await database.select<{ party_id: string; service: string }[]>(
    `SELECT counterparty_id AS party_id, service_type AS service
     FROM (${bookingUnion}) b
     WHERE b.company_id = $1 
       AND b.ref_no = $2 
       AND b.transaction_type = 'SALE'
       AND b.status = 'ACTIVE'
     LIMIT 1`,
    [companyId, ubNumber],
  );
  return owners.length > 0 ? { partyId: owners[0].party_id, service: owners[0].service } : null;
}
