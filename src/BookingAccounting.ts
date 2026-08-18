import Database from "@tauri-apps/plugin-sql";
import { initMiscDatabase } from "./miscDb";

const DB_PATH = "sqlite:travel-accounting.db";
let databasePromise: Promise<Database> | null = null;

export type BookingServiceName = "PACKAGE" | "TICKET" | "HOTEL" | "VISA" | "TRANSPORT" | "MISC";
export type BookingAccountingDirection = "SALE" | "PURCHASE";

export type BookingAccountingEntry = {
  id: string;
  company_id: string;
  service_type: BookingServiceName;
  transaction_type: BookingAccountingDirection;
  counterparty_id: string;
  counterparty_name: string;
  transaction_date: string;
  ub_number: string;
  total_sar: number;
  total_pkr: number;
  unconverted_sar: number;
  status: "ACTIVE" | "VOID";
  created_at: string;
};

export type PartyBookingTotal = {
  counterparty_id: string;
  sale_total: number;
  purchase_total: number;
};

export type CompanyBookingSummary = {
  saleTotal: number;
  purchaseTotal: number;
  grossMargin: number;
  activeBookings: number;
};

async function db() {
  if (!databasePromise) databasePromise = Database.load(DB_PATH);
  return databasePromise;
}

async function ready() {
  // Misc has its own staged schema initializer. Calling it here makes the
  // accounting union safe even before the user has opened the Misc module.
  await initMiscDatabase();
  const database = await db();
  await database.execute("PRAGMA busy_timeout = 5000");
  return database;
}

const bookingUnion = `
  SELECT b.id,b.company_id,'PACKAGE' AS service_type,b.transaction_type,b.counterparty_id,
         COALESCE(p.name,'') AS counterparty_name,b.transaction_date,b.ub_number,
         0 AS total_sar,b.total_pkr,0 AS unconverted_sar,b.status,b.created_at
  FROM package_bookings b
  LEFT JOIN parties p ON p.id=b.counterparty_id AND p.company_id=b.company_id
  WHERE b.company_id=$1
  UNION ALL
  SELECT b.id,b.company_id,'TICKET' AS service_type,b.transaction_type,b.counterparty_id,
         COALESCE(p.name,'') AS counterparty_name,b.transaction_date,b.ub_number,
         0 AS total_sar,b.total_pkr,0 AS unconverted_sar,b.status,b.created_at
  FROM ticket_bookings b
  LEFT JOIN parties p ON p.id=b.counterparty_id AND p.company_id=b.company_id
  WHERE b.company_id=$1
  UNION ALL
  SELECT b.id,b.company_id,'HOTEL' AS service_type,b.transaction_type,b.counterparty_id,
         COALESCE(p.name,'') AS counterparty_name,b.transaction_date,b.ub_number,
         b.total_sar,b.total_pkr,b.unconverted_sar,b.status,b.created_at
  FROM hotel_bookings b
  LEFT JOIN parties p ON p.id=b.counterparty_id AND p.company_id=b.company_id
  WHERE b.company_id=$1
  UNION ALL
  SELECT b.id,b.company_id,'VISA' AS service_type,b.transaction_type,b.counterparty_id,
         COALESCE(p.name,'') AS counterparty_name,b.transaction_date,b.ub_number,
         b.total_sar,b.total_pkr,b.unconverted_sar,b.status,b.created_at
  FROM visa_bookings b
  LEFT JOIN parties p ON p.id=b.counterparty_id AND p.company_id=b.company_id
  WHERE b.company_id=$1
  UNION ALL
  SELECT b.id,b.company_id,'TRANSPORT' AS service_type,b.transaction_type,b.counterparty_id,
         COALESCE(p.name,'') AS counterparty_name,b.transaction_date,b.ub_number,
         b.total_sar,b.total_pkr,b.unconverted_sar,b.status,b.created_at
  FROM transport_bookings b
  LEFT JOIN parties p ON p.id=b.counterparty_id AND p.company_id=b.company_id
  WHERE b.company_id=$1
  UNION ALL
  SELECT b.id,b.company_id,'MISC' AS service_type,b.transaction_type,b.counterparty_id,
         COALESCE(p.name,'') AS counterparty_name,b.transaction_date,b.ub_number,
         b.total_sar,b.total_pkr,b.unconverted_sar,b.status,b.created_at
  FROM misc_bookings b
  LEFT JOIN parties p ON p.id=b.counterparty_id AND p.company_id=b.company_id
  WHERE b.company_id=$1
`;

export async function getBookingAccountingEntries(companyId: string, counterpartyId = "") {
  const database = await ready();
  return database.select<BookingAccountingEntry[]>(
    `SELECT * FROM (${bookingUnion}) q
     WHERE ($2='' OR q.counterparty_id=$2)
     ORDER BY q.transaction_date ASC,q.created_at ASC,q.service_type ASC`,
    [companyId, counterpartyId]
  );
}

export async function getActiveBookingAccountingEntries(companyId: string, counterpartyId = "") {
  const rows = await getBookingAccountingEntries(companyId, counterpartyId);
  return rows.filter((row) => row.status === "ACTIVE");
}

export async function getPartyBookingTotals(companyId: string) {
  const database = await ready();
  return database.select<PartyBookingTotal[]>(
    `SELECT q.counterparty_id,
            COALESCE(SUM(CASE WHEN q.transaction_type='SALE' THEN q.total_pkr ELSE 0 END),0) AS sale_total,
            COALESCE(SUM(CASE WHEN q.transaction_type='PURCHASE' THEN q.total_pkr ELSE 0 END),0) AS purchase_total
     FROM (${bookingUnion}) q
     WHERE q.status='ACTIVE'
     GROUP BY q.counterparty_id`,
    [companyId]
  );
}

export async function getCompanyBookingSummary(companyId: string): Promise<CompanyBookingSummary> {
  const rows = await getPartyBookingTotals(companyId);
  const saleTotal = rows.reduce((sum, row) => sum + Number(row.sale_total || 0), 0);
  const purchaseTotal = rows.reduce((sum, row) => sum + Number(row.purchase_total || 0), 0);
  const activeBookings = (await getActiveBookingAccountingEntries(companyId)).length;
  return { saleTotal, purchaseTotal, grossMargin: saleTotal - purchaseTotal, activeBookings };
}

export function accountBookingAmount(
  accountType: "PARTY" | "VENDOR" | "UNASSIGNED",
  totals?: { sale_total?: number; purchase_total?: number } | null
) {
  if (!totals) return 0;
  if (accountType === "PARTY") return Number(totals.sale_total || 0);
  if (accountType === "VENDOR") return Number(totals.purchase_total || 0);
  return 0;
}

export function accountDirectionLabel(accountType: "PARTY" | "VENDOR" | "UNASSIGNED") {
  if (accountType === "PARTY") return "SALE";
  if (accountType === "VENDOR") return "PURCHASE";
  return "BOOKING";
}
