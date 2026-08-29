import Database from "@tauri-apps/plugin-sql";
import { isDesktopApp, flushDesktopSyncQueue } from "./cloudSync";
import { supabase } from "./supabaseClient";
import type { BookingLifecycleStatus } from "./BookingLifecycle";

const DB_PATH = "sqlite:travel-accounting.db";

export type SegmentAdjustmentType = "CORRECTION" | "AMENDMENT" | "PARTIAL_CANCELLATION" | "FULL_CANCELLATION";
export type SegmentAdjustmentRequestedBy = "CUSTOMER" | "VENDOR" | "INTERNAL";

export type SegmentAdjustmentRecord = {
  id: string;
  company_id: string;
  booking_id: string;
  adjustment_type: SegmentAdjustmentType;
  adjustment_date: string;
  requested_by: SegmentAdjustmentRequestedBy;
  category: string;
  reason: string;
  reference: string;
  notes: string;
  previous_total_pkr: number;
  previous_base_pkr: number;
  revised_base_pkr: number;
  charge_pkr: number;
  credit_pkr: number;
  account_delta_pkr: number;
  effective_total_pkr: number;
  before_snapshot_json: string;
  after_snapshot_json: string;
  cancelled_lines_json: string;
  revision_no: number;
  lifecycle_status: BookingLifecycleStatus;
  created_by_user_id: string;
  created_at: string;
};

export type SegmentAdjustmentSummary = {
  bookingId: string;
  revisionNo: number;
  adjustmentCount: number;
  lifecycleStatus: BookingLifecycleStatus;
};

export type SegmentAdjustmentInsert = {
  adjustmentType: SegmentAdjustmentType;
  adjustmentDate: string;
  requestedBy: SegmentAdjustmentRequestedBy;
  category: string;
  reason: string;
  reference: string;
  notes: string;
  previousTotal: number;
  previousBase: number;
  revisedBase: number;
  charge: number;
  credit: number;
  delta: number;
  effectiveTotal: number;
  beforeSnapshot: string;
  afterSnapshot: string;
  cancelledLines: string;
  revisionNo: number;
  lifecycleStatus: BookingLifecycleStatus;
};

const initPromises = new Map<string, Promise<void>>();

async function db() {
  const isTauri = "__TAURI_INTERNALS__" in window;
  if (isTauri) return Database.load(DB_PATH);
  return {
    execute: async () => ({ lastInsertId: 0, rowsAffected: 0 }),
    select: async () => [],
  } as any;
}

async function retry<T>(work: () => Promise<T>, attempts = 5): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await work();
    } catch (error) {
      lastError = error;
      const text = error instanceof Error ? error.message : String(error);
      if (!/database is locked|database is busy|SQLITE_BUSY|code:\s*5/i.test(text) || attempt === attempts - 1)
        throw error;
      await new Promise((resolve) => window.setTimeout(resolve, 120 * (attempt + 1)));
    }
  }
  throw lastError;
}

async function execute(database: Database, sql: string, bindValues: unknown[] = []) {
  return retry(() => database.execute(sql, bindValues));
}

async function select<T>(database: Database, sql: string, bindValues: unknown[] = []) {
  return retry(() => database.select<T>(sql, bindValues));
}

let legacyBookingAdjustmentsInit: Promise<void> | null = null;

export async function initLegacyBookingAdjustmentsTable() {
  if (legacyBookingAdjustmentsInit) return legacyBookingAdjustmentsInit;
  legacyBookingAdjustmentsInit = (async () => {
    const database = await db();
    await execute(database, "PRAGMA busy_timeout = 5000");
    await execute(
      database,
      `CREATE TABLE IF NOT EXISTS booking_adjustments (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL,
      service_type TEXT NOT NULL,
      booking_id TEXT NOT NULL,
      adjustment_type TEXT NOT NULL,
      adjustment_date TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT '',
      reason TEXT NOT NULL DEFAULT '',
      reference TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      previous_total_pkr REAL NOT NULL DEFAULT 0,
      previous_base_pkr REAL NOT NULL DEFAULT 0,
      revised_base_pkr REAL NOT NULL DEFAULT 0,
      charge_pkr REAL NOT NULL DEFAULT 0,
      credit_pkr REAL NOT NULL DEFAULT 0,
      account_delta_pkr REAL NOT NULL DEFAULT 0,
      effective_total_pkr REAL NOT NULL DEFAULT 0,
      before_snapshot_json TEXT NOT NULL DEFAULT '',
      after_snapshot_json TEXT NOT NULL DEFAULT '',
      cancelled_lines_json TEXT NOT NULL DEFAULT '',
      revision_no INTEGER NOT NULL DEFAULT 2,
      lifecycle_status TEXT NOT NULL DEFAULT 'ACTIVE',
      created_by_user_id TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    )`,
    );
  })();
  return legacyBookingAdjustmentsInit;
}

export async function initSegmentAdjustmentTable(tableName: string) {
  const existing = initPromises.get(tableName);
  if (existing) return existing;
  const promise = (async () => {
    const database = await db();
    await execute(database, "PRAGMA busy_timeout = 5000");
    await execute(
      database,
      `CREATE TABLE IF NOT EXISTS ${tableName} (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL,
      booking_id TEXT NOT NULL,
      adjustment_type TEXT NOT NULL,
      adjustment_date TEXT NOT NULL,
      requested_by TEXT NOT NULL DEFAULT 'INTERNAL',
      category TEXT NOT NULL DEFAULT '',
      reason TEXT NOT NULL DEFAULT '',
      reference TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      previous_total_pkr REAL NOT NULL DEFAULT 0,
      previous_base_pkr REAL NOT NULL DEFAULT 0,
      revised_base_pkr REAL NOT NULL DEFAULT 0,
      charge_pkr REAL NOT NULL DEFAULT 0,
      credit_pkr REAL NOT NULL DEFAULT 0,
      account_delta_pkr REAL NOT NULL DEFAULT 0,
      effective_total_pkr REAL NOT NULL DEFAULT 0,
      before_snapshot_json TEXT NOT NULL DEFAULT '',
      after_snapshot_json TEXT NOT NULL DEFAULT '',
      cancelled_lines_json TEXT NOT NULL DEFAULT '',
      revision_no INTEGER NOT NULL DEFAULT 2,
      lifecycle_status TEXT NOT NULL DEFAULT 'ACTIVE',
      created_by_user_id TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    )`,
    );
    await execute(
      database,
      `CREATE INDEX IF NOT EXISTS idx_${tableName}_lookup ON ${tableName}(company_id,booking_id,revision_no)`,
    );
    await execute(
      database,
      `CREATE INDEX IF NOT EXISTS idx_${tableName}_date ON ${tableName}(company_id,adjustment_date)`,
    );
  })();
  initPromises.set(tableName, promise);
  return promise;
}

export function nextSegmentLifecycle(
  current: BookingLifecycleStatus,
  type: SegmentAdjustmentType,
): BookingLifecycleStatus {
  if (type === "FULL_CANCELLATION") return "CANCELLED";
  if (type === "PARTIAL_CANCELLATION") return "PARTIALLY_CANCELLED";
  if (current === "PARTIALLY_CANCELLED") return current;
  if (type === "AMENDMENT") return "AMENDED";
  return current === "AMENDED" ? "AMENDED" : "ACTIVE";
}

export async function latestSegmentAdjustmentState(tableName: string, companyId: string, bookingId: string) {
  if (!isDesktopApp()) {
    const { data, error } = await supabase
      .from(tableName)
      .select("revision_no,lifecycle_status,adjustment_type")
      .eq("company_id", companyId)
      .eq("booking_id", bookingId)
      .order("revision_no", { ascending: false })
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    const commercial = (data || []).find((row) => row.adjustment_type !== "CORRECTION");
    return {
      revisionNo: commercial ? Number(commercial.revision_no) : 1,
      lifecycleStatus: (commercial?.lifecycle_status || "ACTIVE") as BookingLifecycleStatus,
    };
  }
  await initSegmentAdjustmentTable(tableName);
  const database = await db();
  const rows = await select<SegmentAdjustmentRecord[]>(
    database,
    `SELECT * FROM ${tableName} WHERE company_id=$1 AND booking_id=$2 ORDER BY revision_no DESC,created_at DESC`,
    [companyId, bookingId],
  );
  const commercial = rows.find((row) => row.adjustment_type !== "CORRECTION");
  return {
    revisionNo: commercial ? Number(commercial.revision_no) : 1,
    lifecycleStatus: commercial?.lifecycle_status || ("ACTIVE" as BookingLifecycleStatus),
  };
}

export async function getSegmentAdjustmentHistory(tableName: string, companyId: string, bookingId: string) {
  const columns =
    "id,company_id,booking_id,adjustment_type,adjustment_date,requested_by,category,reason,reference,notes,previous_total_pkr,previous_base_pkr,revised_base_pkr,charge_pkr,credit_pkr,account_delta_pkr,effective_total_pkr,before_snapshot_json,after_snapshot_json,cancelled_lines_json,revision_no,lifecycle_status,created_by_user_id,created_at";
  if (!isDesktopApp()) {
    const { data, error } = await supabase
      .from(tableName)
      .select(columns)
      .eq("company_id", companyId)
      .eq("booking_id", bookingId)
      .order("revision_no", { ascending: true })
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return (data || []) as SegmentAdjustmentRecord[];
  }
  await initSegmentAdjustmentTable(tableName);
  const database = await db();
  return select<SegmentAdjustmentRecord[]>(
    database,
    `SELECT ${columns} FROM ${tableName} WHERE company_id=$1 AND booking_id=$2 ORDER BY revision_no ASC,created_at ASC`,
    [companyId, bookingId],
  );
}

export async function getSegmentAdjustmentSummaryMap(tableName: string, companyId: string) {
  if (!isDesktopApp()) {
    const { data, error } = await supabase
      .from(tableName)
      .select("booking_id,revision_no,lifecycle_status,adjustment_type")
      .eq("company_id", companyId)
      .order("booking_id", { ascending: true })
      .order("revision_no", { ascending: true });
    if (error) throw new Error(error.message);
    const result: Record<string, SegmentAdjustmentSummary> = {};
    for (const row of data || []) {
      const existing = result[row.booking_id];
      const isCorrection = row.adjustment_type === "CORRECTION";
      result[row.booking_id] = {
        bookingId: row.booking_id,
        revisionNo: isCorrection ? existing?.revisionNo || 1 : Number(row.revision_no || 1),
        adjustmentCount: (existing?.adjustmentCount || 0) + 1,
        lifecycleStatus: isCorrection ? existing?.lifecycleStatus || "ACTIVE" : row.lifecycle_status,
      };
    }
    return result;
  }
  await initSegmentAdjustmentTable(tableName);
  const database = await db();
  const rows = await select<SegmentAdjustmentRecord[]>(
    database,
    `SELECT id,company_id,booking_id,adjustment_type,revision_no,lifecycle_status,created_at
     FROM ${tableName} WHERE company_id=$1 ORDER BY booking_id ASC,revision_no ASC,created_at ASC`,
    [companyId],
  );
  const result: Record<string, SegmentAdjustmentSummary> = {};
  for (const row of rows) {
    const existing = result[row.booking_id];
    const isCorrection = row.adjustment_type === "CORRECTION";
    result[row.booking_id] = {
      bookingId: row.booking_id,
      revisionNo: isCorrection ? existing?.revisionNo || 1 : Number(row.revision_no || 1),
      adjustmentCount: (existing?.adjustmentCount || 0) + 1,
      lifecycleStatus: isCorrection
        ? existing?.lifecycleStatus || ("ACTIVE" as BookingLifecycleStatus)
        : row.lifecycle_status,
    };
  }
  return result;
}

export async function persistSegmentAdjustmentRecord(input: {
  tableName: string;
  companyId: string;
  bookingId: string;
  actorUserId: string;
  adjustment: SegmentAdjustmentInsert;
  syncAdjustment: (adjustmentId: string, row: Record<string, unknown>, now: string) => Promise<void>;
}) {
  const now = new Date().toISOString();
  const adjustmentId = crypto.randomUUID();
  const row = {
    id: adjustmentId,
    company_id: input.companyId,
    booking_id: input.bookingId,
    adjustment_type: input.adjustment.adjustmentType,
    adjustment_date: input.adjustment.adjustmentDate,
    requested_by: input.adjustment.requestedBy,
    category: input.adjustment.category.trim(),
    reason: input.adjustment.reason.trim(),
    reference: input.adjustment.reference.trim(),
    notes: input.adjustment.notes.trim(),
    previous_total_pkr: input.adjustment.previousTotal,
    previous_base_pkr: input.adjustment.previousBase,
    revised_base_pkr: input.adjustment.revisedBase,
    charge_pkr: input.adjustment.charge,
    credit_pkr: input.adjustment.credit,
    account_delta_pkr: input.adjustment.delta,
    effective_total_pkr: input.adjustment.effectiveTotal,
    before_snapshot_json: input.adjustment.beforeSnapshot,
    after_snapshot_json: input.adjustment.afterSnapshot,
    cancelled_lines_json: input.adjustment.cancelledLines,
    revision_no: input.adjustment.revisionNo,
    lifecycle_status: input.adjustment.lifecycleStatus,
    created_by_user_id: input.actorUserId,
    created_at: now,
  };

  if (isDesktopApp()) {
    await initSegmentAdjustmentTable(input.tableName);
    const database = await db();
    await execute(
      database,
      `INSERT INTO ${input.tableName}
      (id,company_id,booking_id,adjustment_type,adjustment_date,requested_by,category,reason,reference,notes,
       previous_total_pkr,previous_base_pkr,revised_base_pkr,charge_pkr,credit_pkr,account_delta_pkr,effective_total_pkr,
       before_snapshot_json,after_snapshot_json,cancelled_lines_json,revision_no,lifecycle_status,created_by_user_id,created_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)`,
      [
        row.id,
        row.company_id,
        row.booking_id,
        row.adjustment_type,
        row.adjustment_date,
        row.requested_by,
        row.category,
        row.reason,
        row.reference,
        row.notes,
        row.previous_total_pkr,
        row.previous_base_pkr,
        row.revised_base_pkr,
        row.charge_pkr,
        row.credit_pkr,
        row.account_delta_pkr,
        row.effective_total_pkr,
        row.before_snapshot_json,
        row.after_snapshot_json,
        row.cancelled_lines_json,
        row.revision_no,
        row.lifecycle_status,
        row.created_by_user_id,
        row.created_at,
      ],
    );
  }

  await input.syncAdjustment(adjustmentId, row, now);
  if (isDesktopApp()) await flushDesktopSyncQueue();
}
