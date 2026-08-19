import Database from "@tauri-apps/plugin-sql";
import { runAtomicTransaction, type AtomicSqlStatement } from "./DatabaseSafety";
import { hasPermission, UserRole } from "./permissions";

const DB_PATH = "sqlite:travel-accounting.db";
let databasePromise: Promise<Database> | null = null;
let initPromise: Promise<void> | null = null;

export type MiscTransactionType = "SALE" | "PURCHASE";

export type MiscBookingLineInput = {
  serviceName: string;
  paxCount: number;
  ratePerPerson: number;
  roe: number | null;
};

export type MiscBookingInput = {
  transactionType: MiscTransactionType;
  counterpartyId: string;
  transactionDate: string;
  ubNumber: string;
  lines: MiscBookingLineInput[];
};

export type MiscBookingLine = {
  id: string;
  booking_id: string;
  service_name: string;
  pax_count: number;
  rate_per_person: number;
  roe: number;
  currency_mode: "PKR" | "SAR";
  line_total_sar: number;
  line_total_pkr: number;
  sort_order: number;
};

export type MiscBooking = {
  id: string;
  company_id: string;
  transaction_type: MiscTransactionType;
  counterparty_id: string;
  counterparty_name: string;
  transaction_date: string;
  ub_number: string;
  total_sar: number;
  total_pkr: number;
  unconverted_sar: number;
  status: "ACTIVE" | "VOID";
  created_at: string;
  updated_at: string;
  created_by_user_id: string;
  updated_by_user_id: string;
  lines: MiscBookingLine[];
};

async function db() {
  if (!databasePromise) databasePromise = Database.load(DB_PATH);
  return databasePromise;
}

async function ensureTablesOnce() {
  const database = await db();
  await database.execute("PRAGMA busy_timeout = 5000");

  await database.execute(`CREATE TABLE IF NOT EXISTS misc_bookings (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    transaction_type TEXT NOT NULL,
    counterparty_id TEXT NOT NULL,
    transaction_date TEXT NOT NULL,
    ub_number TEXT NOT NULL DEFAULT '',
    total_sar REAL NOT NULL DEFAULT 0,
    total_pkr REAL NOT NULL DEFAULT 0,
    unconverted_sar REAL NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'ACTIVE',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    created_by_user_id TEXT NOT NULL DEFAULT '',
    updated_by_user_id TEXT NOT NULL DEFAULT ''
  )`);

  await database.execute(`CREATE TABLE IF NOT EXISTS misc_booking_lines (
    id TEXT PRIMARY KEY,
    booking_id TEXT NOT NULL,
    service_name TEXT NOT NULL DEFAULT '',
    pax_count INTEGER NOT NULL DEFAULT 0,
    rate_per_person REAL NOT NULL DEFAULT 0,
    roe REAL NOT NULL DEFAULT 0,
    currency_mode TEXT NOT NULL DEFAULT 'PKR',
    line_total_sar REAL NOT NULL DEFAULT 0,
    line_total_pkr REAL NOT NULL DEFAULT 0,
    sort_order INTEGER NOT NULL DEFAULT 0
  )`);

  await database.execute(`CREATE INDEX IF NOT EXISTS idx_misc_company_date ON misc_bookings(company_id, transaction_date)`);
  await database.execute(`CREATE INDEX IF NOT EXISTS idx_misc_company_counterparty ON misc_bookings(company_id, counterparty_id)`);
  await database.execute(`CREATE INDEX IF NOT EXISTS idx_misc_company_ub ON misc_bookings(company_id, ub_number)`);
  await database.execute(`CREATE INDEX IF NOT EXISTS idx_misc_lines_booking ON misc_booking_lines(booking_id, sort_order)`);
}

export function initMiscDatabase() {
  if (!initPromise) {
    initPromise = ensureTablesOnce().catch((error) => {
      initPromise = null;
      throw error;
    });
  }
  return initPromise;
}

function normalizeUb(value: string) {
  return value.trim().replace(/\s+/g, " ").toUpperCase();
}

async function requireBookingPermission(companyId: string, actorUserId: string, permission: "create_bookings" | "edit_bookings" | "void_bookings") {
  if (!actorUserId) return;
  const database = await db();
  const rows = await database.select<Array<{ role: UserRole; status: string }>>(
    `SELECT role,status FROM users WHERE id=$1 AND company_id=$2 LIMIT 1`,
    [actorUserId, companyId]
  );
  const user = rows[0];
  if (!user || user.status !== "ACTIVE" || !hasPermission(user.role, permission)) {
    throw new Error("Your role does not allow this booking action.");
  }
}

async function validateCounterparty(companyId: string, transactionType: MiscTransactionType, counterpartyId: string) {
  if (!counterpartyId) throw new Error(transactionType === "SALE" ? "Select a Party / Customer." : "Select a Vendor / Supplier.");
  const database = await db();
  const rows = await database.select<Array<{ account_type: string; status: string }>>(
    `SELECT account_type,status FROM parties WHERE id=$1 AND company_id=$2 LIMIT 1`,
    [counterpartyId, companyId]
  );
  const account = rows[0];
  const expected = transactionType === "SALE" ? "PARTY" : "VENDOR";
  if (!account || account.status !== "ACTIVE" || account.account_type !== expected) {
    throw new Error(transactionType === "SALE" ? "Misc Sale can only be saved against an active Party." : "Misc Purchase can only be saved against an active Vendor.");
  }
}

async function validateUniqueUb(companyId: string, transactionType: MiscTransactionType, counterpartyId: string, ubNumber: string, editingId = "") {
  const database = await db();
  const normalized = normalizeUb(ubNumber);
  const rows = await database.select<Array<{ id: string; transaction_type: MiscTransactionType; counterparty_id: string; ub_number: string }>>(
    `SELECT id,transaction_type,counterparty_id,ub_number FROM misc_bookings WHERE company_id=$1`,
    [companyId]
  );
  const duplicate = rows.find((row) => {
    if (row.id === editingId || normalizeUb(row.ub_number) !== normalized) return false;
    if (transactionType === "SALE") return row.transaction_type === "SALE";
    return row.transaction_type === "PURCHASE" && row.counterparty_id === counterpartyId;
  });
  if (duplicate) {
    if (transactionType === "SALE") throw new Error(`UB # / Booking "${ubNumber.trim()}" already has a Misc Sale booking.`);
    throw new Error(`This Vendor already has a Misc Purchase booking for UB # "${ubNumber.trim()}".`);
  }
}

function calculateLines(lines: MiscBookingLineInput[]) {
  if (!lines.length) throw new Error("Add at least one Misc service row.");
  const calculated = lines.map((line, index) => {
    const serviceName = line.serviceName.trim();
    const paxCount = Math.trunc(Number(line.paxCount));
    const ratePerPerson = Number(line.ratePerPerson);
    const roe = line.roe == null ? 0 : Number(line.roe);
    if (!serviceName) throw new Error(`Misc row ${index + 1}: Service Name is required.`);
    if (!Number.isFinite(paxCount) || paxCount < 1 || paxCount > 9999) throw new Error(`Misc row ${index + 1}: No. of Pax must be at least 1.`);
    if (!Number.isFinite(ratePerPerson) || ratePerPerson <= 0) throw new Error(`Misc row ${index + 1}: Rate / Person must be greater than zero.`);
    if (!Number.isFinite(roe) || roe < 0) throw new Error(`Misc row ${index + 1}: ROE cannot be negative.`);

    const currencyMode: "PKR" | "SAR" = roe > 0 ? "SAR" : "PKR";
    const base = ratePerPerson * paxCount;
    const lineTotalSar = currencyMode === "SAR" ? base : 0;
    const lineTotalPkr = currencyMode === "SAR" ? base * roe : base;
    return { serviceName, paxCount, ratePerPerson, roe, currencyMode, lineTotalSar, lineTotalPkr, sortOrder: index };
  });

  return {
    calculated,
    totalSar: calculated.reduce((sum, line) => sum + line.lineTotalSar, 0),
    totalPkr: calculated.reduce((sum, line) => sum + line.lineTotalPkr, 0),
    unconvertedSar: 0,
  };
}

async function validateBooking(companyId: string, input: MiscBookingInput, editingId = "") {
  if (!["SALE", "PURCHASE"].includes(input.transactionType)) throw new Error("Select Sale or Purchase first.");
  if (!input.transactionDate) throw new Error("Date of Booking is required.");
  if (!input.ubNumber.trim()) throw new Error("UB / Booking # is required.");
  await validateCounterparty(companyId, input.transactionType, input.counterpartyId);
  await validateUniqueUb(companyId, input.transactionType, input.counterpartyId, input.ubNumber, editingId);
  return calculateLines(input.lines);
}

function auditStatement(companyId: string, actorUserId: string, action: string, recordId: string, details: string, now: string): AtomicSqlStatement | null {
  if (!actorUserId) return null;
  return {
    sql: `INSERT INTO audit_logs (id,company_id,user_id,user_name,action,module,record_id,details,created_at)
      VALUES ($1,$2,$3,
        COALESCE((SELECT full_name FROM users WHERE id=$3 AND company_id=$2 LIMIT 1),''),
        $4,'MISC',$5,$6,$7)`,
    params: [crypto.randomUUID(), companyId, actorUserId, action, recordId, details, now],
  };
}

function lineStatements(bookingId: string, calculated: ReturnType<typeof calculateLines>["calculated"]) {
  return calculated.map<AtomicSqlStatement>((line) => ({
    sql: `INSERT INTO misc_booking_lines
      (id,booking_id,service_name,pax_count,rate_per_person,roe,currency_mode,line_total_sar,line_total_pkr,sort_order)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    params: [crypto.randomUUID(), bookingId, line.serviceName, line.paxCount, line.ratePerPerson, line.roe, line.currencyMode, line.lineTotalSar, line.lineTotalPkr, line.sortOrder],
  }));
}

export async function getMiscBookings(companyId: string, search = "") {
  await initMiscDatabase();
  const database = await db();
  const clean = search.trim();
  const term = `%${clean}%`;
  const headers = await database.select<Omit<MiscBooking, "lines">[]>(
    `SELECT b.id,b.company_id,b.transaction_type,b.counterparty_id,COALESCE(p.name,'') AS counterparty_name,
            b.transaction_date,b.ub_number,b.total_sar,b.total_pkr,b.unconverted_sar,b.status,
            b.created_at,b.updated_at,b.created_by_user_id,b.updated_by_user_id
     FROM misc_bookings b
     LEFT JOIN parties p ON p.id=b.counterparty_id AND p.company_id=b.company_id
     WHERE b.company_id=$1
       AND ($2='' OR b.ub_number LIKE $3 COLLATE NOCASE OR COALESCE(p.name,'') LIKE $3 COLLATE NOCASE OR
            EXISTS (SELECT 1 FROM misc_booking_lines l WHERE l.booking_id=b.id AND l.service_name LIKE $3 COLLATE NOCASE))
     ORDER BY b.transaction_date DESC,b.created_at DESC`,
    [companyId, clean, term]
  );
  const lines = await database.select<MiscBookingLine[]>(
    `SELECT l.id,l.booking_id,l.service_name,l.pax_count,l.rate_per_person,l.roe,l.currency_mode,l.line_total_sar,l.line_total_pkr,l.sort_order
     FROM misc_booking_lines l INNER JOIN misc_bookings b ON b.id=l.booking_id
     WHERE b.company_id=$1 ORDER BY l.sort_order ASC`,
    [companyId]
  );
  const grouped = new Map<string, MiscBookingLine[]>();
  for (const line of lines) {
    const current = grouped.get(line.booking_id) || [];
    current.push(line);
    grouped.set(line.booking_id, current);
  }
  return headers.map((header) => ({ ...header, lines: grouped.get(header.id) || [] })) as MiscBooking[];
}

export async function createMiscBooking(companyId: string, input: MiscBookingInput, actorUserId = "") {
  await initMiscDatabase();
  await requireBookingPermission(companyId, actorUserId, "create_bookings");
  const result = await validateBooking(companyId, input);
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const statements: AtomicSqlStatement[] = [
    {
      sql: `INSERT INTO misc_bookings
        (id,company_id,transaction_type,counterparty_id,transaction_date,ub_number,total_sar,total_pkr,unconverted_sar,status,created_at,updated_at,created_by_user_id,updated_by_user_id)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'ACTIVE',$10,$10,$11,$11)`,
      params: [id, companyId, input.transactionType, input.counterpartyId, input.transactionDate, input.ubNumber.trim(), result.totalSar, result.totalPkr, result.unconvertedSar, now, actorUserId],
    },
    ...lineStatements(id, result.calculated),
  ];
  const audit = auditStatement(companyId, actorUserId, "BOOKING_CREATED", id, `${input.transactionType} ${input.ubNumber.trim()} - PKR ${result.totalPkr}`, now);
  if (audit) statements.push(audit);
  await runAtomicTransaction(statements);
  return id;
}

export async function updateMiscBooking(companyId: string, bookingId: string, input: MiscBookingInput, actorUserId = "") {
  await initMiscDatabase();
  await requireBookingPermission(companyId, actorUserId, "edit_bookings");
  const result = await validateBooking(companyId, input, bookingId);
  const now = new Date().toISOString();
  const statements: AtomicSqlStatement[] = [
    {
      sql: `UPDATE misc_bookings SET transaction_type=$1,counterparty_id=$2,transaction_date=$3,ub_number=$4,total_sar=$5,total_pkr=$6,unconverted_sar=$7,updated_at=$8,updated_by_user_id=$9
        WHERE id=$10 AND company_id=$11 AND status='ACTIVE'`,
      params: [input.transactionType, input.counterpartyId, input.transactionDate, input.ubNumber.trim(), result.totalSar, result.totalPkr, result.unconvertedSar, now, actorUserId, bookingId, companyId],
    },
    { sql: `DELETE FROM misc_booking_lines WHERE booking_id=$1`, params: [bookingId] },
    ...lineStatements(bookingId, result.calculated),
  ];
  const audit = auditStatement(companyId, actorUserId, "BOOKING_UPDATED", bookingId, `${input.transactionType} ${input.ubNumber.trim()} - PKR ${result.totalPkr}`, now);
  if (audit) statements.push(audit);
  await runAtomicTransaction(statements);
}

export async function voidMiscBooking(companyId: string, bookingId: string, actorUserId = "") {
  await initMiscDatabase();
  await requireBookingPermission(companyId, actorUserId, "void_bookings");
  const database = await db();
  const rows = await database.select<Array<{ ub_number: string }>>(`SELECT ub_number FROM misc_bookings WHERE id=$1 AND company_id=$2 LIMIT 1`, [bookingId, companyId]);
  const now = new Date().toISOString();
  const statements: AtomicSqlStatement[] = [
    {
      sql: `UPDATE misc_bookings SET status='VOID',updated_at=$1,updated_by_user_id=$2 WHERE id=$3 AND company_id=$4 AND status='ACTIVE'`,
      params: [now, actorUserId, bookingId, companyId],
    },
  ];
  const audit = auditStatement(companyId, actorUserId, "BOOKING_VOIDED", bookingId, `Misc booking ${rows[0]?.ub_number || bookingId} voided.`, now);
  if (audit) statements.push(audit);
  await runAtomicTransaction(statements);
}
