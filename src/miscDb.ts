import Database from "@tauri-apps/plugin-sql";

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
  if (!databasePromise) {
    const isTauri = "__TAURI_INTERNALS__" in window;
    if (isTauri) {
      databasePromise = Database.load(DB_PATH);
    } else {
      databasePromise = Promise.resolve({
        execute: async () => ({ lastInsertId: 0, rowsAffected: 0 }),
        select: async () => [],
      } as unknown as Database);
    }
  }
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

  await database.execute(
    `CREATE INDEX IF NOT EXISTS idx_misc_company_date ON misc_bookings(company_id, transaction_date)`,
  );
  await database.execute(
    `CREATE INDEX IF NOT EXISTS idx_misc_company_counterparty ON misc_bookings(company_id, counterparty_id)`,
  );
  await database.execute(`CREATE INDEX IF NOT EXISTS idx_misc_company_ub ON misc_bookings(company_id, ub_number)`);
  await database.execute(
    `CREATE INDEX IF NOT EXISTS idx_misc_lines_booking ON misc_booking_lines(booking_id, sort_order)`,
  );
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

export {
  calculateMiscLines,
  getMiscBookings,
  createMiscBooking,
  updateMiscBooking,
  voidMiscBooking,
} from "./MiscFlowDb";
