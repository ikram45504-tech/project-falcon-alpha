import Database from "@tauri-apps/plugin-sql";
import { initMiscDatabase } from "./miscDb";
import { isDesktopApp } from "./cloudSync";
import { loadSegmentAdjustmentsForStatements, type StatementSegmentAdjustmentRow } from "./SegmentAdjustmentRecord";
import { supabase } from "./supabaseClient";

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
  if (!databasePromise) {
    const isTauri = "__TAURI_INTERNALS__" in window;
    if (isTauri) {
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

const WEB_BOOKING_SOURCES: Array<{
  table: string;
  service_type: BookingServiceName;
  includeSar: boolean;
}> = [
  { table: "package_bookings", service_type: "PACKAGE", includeSar: false },
  { table: "ticket_bookings", service_type: "TICKET", includeSar: false },
  { table: "hotel_bookings", service_type: "HOTEL", includeSar: true },
  { table: "visa_bookings", service_type: "VISA", includeSar: true },
  { table: "transport_bookings", service_type: "TRANSPORT", includeSar: true },
  { table: "misc_bookings", service_type: "MISC", includeSar: true },
];

const WEB_BOOKING_PKR_SELECT =
  "id,company_id,transaction_type,counterparty_id,transaction_date,ub_number,total_pkr,status,created_at" as const;
const WEB_BOOKING_SAR_SELECT =
  "id,company_id,transaction_type,counterparty_id,transaction_date,ub_number,total_pkr,status,created_at,total_sar,unconverted_sar" as const;

type WebBookingTableName =
  "package_bookings" | "ticket_bookings" | "hotel_bookings" | "visa_bookings" | "transport_bookings" | "misc_bookings";

type WebBookingRow = {
  id: string;
  company_id: string;
  transaction_type: string;
  counterparty_id: string;
  transaction_date: string;
  ub_number: string | null;
  total_pkr: number | null;
  status: string;
  created_at: string;
  total_sar?: number | null;
  unconverted_sar?: number | null;
};

export function webBookingSelectColumns(includeSar: boolean) {
  return includeSar ? WEB_BOOKING_SAR_SELECT : WEB_BOOKING_PKR_SELECT;
}

async function fetchWebBookingsForTable(table: WebBookingTableName, companyId: string, counterpartyId: string) {
  if (table === "package_bookings" || table === "ticket_bookings") {
    let query = supabase.from(table).select(WEB_BOOKING_PKR_SELECT).eq("company_id", companyId);
    if (counterpartyId) query = query.eq("counterparty_id", counterpartyId);
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return data || [];
  }

  let query = supabase.from(table).select(WEB_BOOKING_SAR_SELECT).eq("company_id", companyId);
  if (counterpartyId) query = query.eq("counterparty_id", counterpartyId);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data || [];
}

async function fetchWebBookingAccountingEntries(companyId: string, counterpartyId = "") {
  const counterpartyNames = new Map<string, string>();
  if (!counterpartyId) {
    const [{ data: parties, error: partyError }, { data: vendors, error: vendorError }] = await Promise.all([
      supabase.from("parties").select("id,name").eq("company_id", companyId),
      supabase.from("vendors").select("id,name").eq("company_id", companyId),
    ]);
    if (partyError) throw new Error(partyError.message);
    if (vendorError) throw new Error(vendorError.message);

    for (const row of parties || []) counterpartyNames.set(String(row.id), String(row.name || ""));
    for (const row of vendors || []) counterpartyNames.set(String(row.id), String(row.name || ""));
  }

  const bookingRows = await Promise.all(
    WEB_BOOKING_SOURCES.map((source) =>
      fetchWebBookingsForTable(source.table as WebBookingTableName, companyId, counterpartyId),
    ),
  );

  const entries: BookingAccountingEntry[] = [];
  WEB_BOOKING_SOURCES.forEach((source, index) => {
    for (const row of bookingRows[index]) {
      const sarRow = row as WebBookingRow;
      entries.push({
        id: String(row.id),
        company_id: companyId,
        service_type: source.service_type,
        transaction_type: row.transaction_type as BookingAccountingDirection,
        counterparty_id: String(row.counterparty_id),
        counterparty_name: counterpartyNames.get(String(row.counterparty_id)) || "",
        transaction_date: String(row.transaction_date),
        ub_number: String(row.ub_number || ""),
        total_sar: source.includeSar ? Number(sarRow.total_sar || 0) : 0,
        total_pkr: Number(row.total_pkr || 0),
        unconverted_sar: source.includeSar ? Number(sarRow.unconverted_sar || 0) : 0,
        status: row.status as "ACTIVE" | "VOID",
        created_at: String(row.created_at || ""),
      });
    }
  });

  return entries.sort(
    (a, b) =>
      a.transaction_date.localeCompare(b.transaction_date) ||
      a.created_at.localeCompare(b.created_at) ||
      a.service_type.localeCompare(b.service_type),
  );
}

export function buildLatestAdjustmentMap(adjustments: StatementSegmentAdjustmentRow[]) {
  const map = new Map<string, StatementSegmentAdjustmentRow>();
  for (const row of adjustments) {
    if (row.adjustment_type === "CORRECTION") continue;
    const key = `${row.service_type}:${row.booking_id}`;
    const existing = map.get(key);
    if (!existing || Number(row.revision_no || 0) >= Number(existing.revision_no || 0)) {
      map.set(key, row);
    }
  }
  return map;
}

export function bookingLedgerBaseAmount(
  entry: Pick<BookingAccountingEntry, "id" | "service_type" | "total_pkr">,
  adjustments: StatementSegmentAdjustmentRow[],
) {
  const commercial = adjustments
    .filter((row) => row.service_type === entry.service_type && row.booking_id === entry.id)
    .filter((row) => row.adjustment_type !== "CORRECTION")
    .sort(
      (a, b) => Number(a.revision_no || 0) - Number(b.revision_no || 0) || a.created_at.localeCompare(b.created_at),
    );
  if (!commercial.length) return Number(entry.total_pkr || 0);
  return Number(commercial[0].previous_total_pkr || entry.total_pkr || 0);
}

export function effectiveBookingAmount(
  entry: Pick<BookingAccountingEntry, "id" | "service_type" | "total_pkr">,
  latestAdjustments: Map<string, StatementSegmentAdjustmentRow>,
) {
  const latest = latestAdjustments.get(`${entry.service_type}:${entry.id}`);
  if (latest) return Number(latest.effective_total_pkr || 0);
  return Number(entry.total_pkr || 0);
}

export function aggregatePartyBookingTotalsWithAdjustments(
  entries: BookingAccountingEntry[],
  adjustments: StatementSegmentAdjustmentRow[],
): PartyBookingTotal[] {
  const latestAdjustments = buildLatestAdjustmentMap(adjustments);
  const map = new Map<string, { sale_total: number; purchase_total: number }>();
  for (const row of entries) {
    if (row.status !== "ACTIVE") continue;
    const amount = effectiveBookingAmount(row, latestAdjustments);
    const current = map.get(row.counterparty_id) || { sale_total: 0, purchase_total: 0 };
    if (row.transaction_type === "SALE") current.sale_total += amount;
    else current.purchase_total += amount;
    map.set(row.counterparty_id, current);
  }
  return Array.from(map.entries()).map(([counterparty_id, totals]) => ({
    counterparty_id,
    sale_total: totals.sale_total,
    purchase_total: totals.purchase_total,
  }));
}

export function aggregatePartyBookingTotals(entries: BookingAccountingEntry[]): PartyBookingTotal[] {
  const map = new Map<string, { sale_total: number; purchase_total: number }>();
  for (const row of entries) {
    if (row.status !== "ACTIVE") continue;
    const current = map.get(row.counterparty_id) || { sale_total: 0, purchase_total: 0 };
    if (row.transaction_type === "SALE") current.sale_total += Number(row.total_pkr || 0);
    else current.purchase_total += Number(row.total_pkr || 0);
    map.set(row.counterparty_id, current);
  }
  return Array.from(map.entries()).map(([counterparty_id, totals]) => ({
    counterparty_id,
    sale_total: totals.sale_total,
    purchase_total: totals.purchase_total,
  }));
}

export async function getBookingAccountingEntries(companyId: string, counterpartyId = "") {
  if (!isDesktopApp()) {
    return fetchWebBookingAccountingEntries(companyId, counterpartyId);
  }

  const database = await ready();
  return database.select<BookingAccountingEntry[]>(
    `SELECT * FROM (${bookingUnion}) q
     WHERE ($2='' OR q.counterparty_id=$2)
     ORDER BY q.transaction_date ASC,q.created_at ASC,q.service_type ASC`,
    [companyId, counterpartyId],
  );
}

export type DirectionBookingLedgerRow = BookingAccountingEntry & {
  effective_pkr: number;
  revision_no: number;
  lifecycle_status: string;
};

/** All bookings for one side (SALE = Party ledger, PURCHASE = Vendor ledger), all 6 segments. */
export async function getDirectionBookingLedger(
  companyId: string,
  direction: BookingAccountingDirection,
): Promise<DirectionBookingLedgerRow[]> {
  const [entries, adjustments] = await Promise.all([
    getBookingAccountingEntries(companyId),
    loadSegmentAdjustmentsForStatements(companyId),
  ]);
  const latest = buildLatestAdjustmentMap(adjustments);
  return entries
    .filter((entry) => entry.transaction_type === direction)
    .map((entry) => {
      const adj = latest.get(`${entry.service_type}:${entry.id}`);
      return {
        ...entry,
        effective_pkr: effectiveBookingAmount(entry, latest),
        revision_no: adj ? Number(adj.revision_no || 1) : 1,
        lifecycle_status: entry.status === "VOID" ? "VOID" : String(adj?.lifecycle_status || "ACTIVE").toUpperCase(),
      };
    })
    .sort(
      (a, b) =>
        b.transaction_date.localeCompare(a.transaction_date) ||
        b.created_at.localeCompare(a.created_at) ||
        a.service_type.localeCompare(b.service_type),
    );
}

export async function getPartyBookingTotals(companyId: string) {
  const adjustments = await loadSegmentAdjustmentsForStatements(companyId);
  if (!isDesktopApp()) {
    return aggregatePartyBookingTotalsWithAdjustments(await fetchWebBookingAccountingEntries(companyId), adjustments);
  }

  const database = await ready();
  const entries = await database.select<BookingAccountingEntry[]>(
    `SELECT * FROM (${bookingUnion}) q
     ORDER BY q.transaction_date ASC,q.created_at ASC,q.service_type ASC`,
    [companyId],
  );
  return aggregatePartyBookingTotalsWithAdjustments(entries, adjustments);
}

export async function getCompanyBookingSummary(companyId: string): Promise<CompanyBookingSummary> {
  // Load all entries once — avoids running the 6-table UNION twice.
  const rows = await getBookingAccountingEntries(companyId);
  let saleTotal = 0;
  let purchaseTotal = 0;
  let activeBookings = 0;
  for (const row of rows) {
    if (row.status !== "ACTIVE") continue;
    activeBookings += 1;
    if (row.transaction_type === "SALE") saleTotal += Number(row.total_pkr || 0);
    else purchaseTotal += Number(row.total_pkr || 0);
  }
  return { saleTotal, purchaseTotal, grossMargin: saleTotal - purchaseTotal, activeBookings };
}

export function accountBookingAmount(
  accountType: "PARTY" | "VENDOR" | "UNASSIGNED",
  totals?: { sale_total?: number; purchase_total?: number } | null,
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
