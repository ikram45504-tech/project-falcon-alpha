import Database from "@tauri-apps/plugin-sql";
import { runAtomicTransaction, type AtomicSqlStatement } from "./DatabaseSafety";
import { flushDesktopSyncQueue, isDesktopApp, queueSync } from "./cloudSync";

import type { BookingAdjustmentKind, BookingLifecycleStatus, BookingServiceName } from "./BookingLifecycle";

const DB_PATH = "sqlite:travel-accounting.db";
let databasePromise: Promise<Database> | null = null;
let initializationPromise: Promise<void> | null = null;

const bookingTables: Record<BookingServiceName, string> = {
  PACKAGE: "package_bookings",
  TICKET: "ticket_bookings",
  HOTEL: "hotel_bookings",
  VISA: "visa_bookings",
  TRANSPORT: "transport_bookings",
  MISC: "misc_bookings",
};

export type UniversalAdjustmentRecord = {
  id: string;
  company_id: string;
  service_type: BookingServiceName;
  booking_id: string;
  adjustment_type: BookingAdjustmentKind;
  adjustment_date: string;
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

export type UniversalAdjustmentSummary = {
  bookingId: string;
  revisionNo: number;
  adjustmentCount: number;
  lifecycleStatus: BookingLifecycleStatus;
};

export type RecordUniversalAdjustmentInput = {
  service: BookingServiceName;
  bookingId: string;
  adjustmentType: BookingAdjustmentKind;
  adjustmentDate: string;
  category: string;
  reason: string;
  reference: string;
  notes: string;
  previousTotalPkr: number;
  previousBasePkr: number;
  revisedBasePkr: number;
  chargePkr: number;
  creditPkr: number;
  effectiveTotalPkr: number;
  beforeSnapshotJson: string;
  afterSnapshotJson: string;
  cancelledLinesJson: string;
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

function isBusyError(error: unknown) {
  const text = error instanceof Error ? error.message : String(error);
  return /database is locked|database is busy|SQLITE_BUSY|code:\s*5/i.test(text);
}

async function retry<T>(work: () => Promise<T>, attempts = 5): Promise<T> {
  let lastError: unknown;
  const delays = [120, 250, 500, 900];
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await work();
    } catch (error) {
      lastError = error;
      if (!isBusyError(error) || attempt === attempts - 1) throw error;
      await new Promise((resolve) => window.setTimeout(resolve, delays[Math.min(attempt, delays.length - 1)]));
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

import { requirePermission } from "./db";
export async function initUniversalBookingAdjustmentDatabase() {
  if (initializationPromise) return initializationPromise;
  initializationPromise = (async () => {
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
    await execute(
      database,
      `CREATE INDEX IF NOT EXISTS idx_booking_adjustments_lookup
      ON booking_adjustments(company_id,service_type,booking_id,revision_no)`,
    );
    await execute(
      database,
      `CREATE INDEX IF NOT EXISTS idx_booking_adjustments_service_date
      ON booking_adjustments(company_id,service_type,adjustment_date)`,
    );
  })().catch((error) => {
    initializationPromise = null;
    throw error;
  });
  return initializationPromise;
}

function nextLifecycle(current: BookingLifecycleStatus, type: BookingAdjustmentKind): BookingLifecycleStatus {
  if (type === "FULL_CANCELLATION") return "CANCELLED";
  if (type === "PARTIAL_CANCELLATION") return "PARTIALLY_CANCELLED";
  if (current === "PARTIALLY_CANCELLED") return current;
  if (type === "AMENDMENT") return "AMENDED";
  return current === "AMENDED" ? "AMENDED" : "ACTIVE";
}

async function latestState(
  database: Database | null,
  companyId: string,
  service: BookingServiceName,
  bookingId: string,
) {
  if (!isDesktopApp()) {
    const { supabase } = await import("./supabaseClient");
    const { data, error } = await supabase
      .from("booking_adjustments")
      .select("revision_no,lifecycle_status,adjustment_type,created_at")
      .eq("company_id", companyId)
      .eq("service_type", service)
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
  const rows = await select<UniversalAdjustmentRecord[]>(
    database!,
    `SELECT * FROM booking_adjustments
     WHERE company_id=$1 AND service_type=$2 AND booking_id=$3
     ORDER BY revision_no DESC,created_at DESC`,
    [companyId, service, bookingId],
  );
  const commercial = rows.find((row) => row.adjustment_type !== "CORRECTION");
  return {
    revisionNo: commercial ? Number(commercial.revision_no) : 1,
    lifecycleStatus: (commercial?.lifecycle_status || "ACTIVE") as BookingLifecycleStatus,
  };
}

export async function getUniversalBookingAdjustmentHistory(
  companyId: string,
  service: BookingServiceName,
  bookingId: string,
) {
  const isTauri = "__TAURI_INTERNALS__" in window;
  if (!isTauri) {
    const { supabase } = await import("./supabaseClient");
    const { data } = await supabase
      .from("booking_adjustments")
      .select("*")
      .eq("company_id", companyId)
      .eq("service_type", service)
      .eq("booking_id", bookingId)
      .order("revision_no", { ascending: true })
      .order("created_at", { ascending: true });
    return (data || []) as UniversalAdjustmentRecord[];
  }

  await initUniversalBookingAdjustmentDatabase();
  const database = await db();
  return select<UniversalAdjustmentRecord[]>(
    database,
    `SELECT * FROM booking_adjustments
     WHERE company_id=$1 AND service_type=$2 AND booking_id=$3
     ORDER BY revision_no ASC,created_at ASC`,
    [companyId, service, bookingId],
  );
}

export async function getUniversalBookingAdjustmentSummaryMap(companyId: string, service: BookingServiceName) {
  const isTauri = "__TAURI_INTERNALS__" in window;
  if (!isTauri) {
    const { supabase } = await import("./supabaseClient");
    // Since we don't have a direct view in Supabase for this grouped query, we fetch all adjustments for the service and group in memory
    const { data } = await supabase
      .from("booking_adjustments")
      .select("*")
      .eq("company_id", companyId)
      .eq("service_type", service);

    const rows = data || [];
    const grouped = new Map<string, UniversalAdjustmentRecord[]>();
    for (const r of rows) {
      const g = grouped.get(r.booking_id) || [];
      g.push(r as UniversalAdjustmentRecord);
      grouped.set(r.booking_id, g);
    }

    const out: Record<string, UniversalAdjustmentSummary> = {};
    for (const [bId, groupRows] of grouped.entries()) {
      groupRows.sort(
        (a, b) => Number(b.revision_no) - Number(a.revision_no) || b.created_at.localeCompare(a.created_at),
      );
      const commercial = groupRows.filter((row) => row.adjustment_type !== "CORRECTION");
      const latestCommercial = commercial[0];
      out[bId] = {
        bookingId: bId,
        revisionNo: latestCommercial ? Number(latestCommercial.revision_no || 1) : 1,
        adjustmentCount: groupRows.length,
        lifecycleStatus: (latestCommercial?.lifecycle_status || "ACTIVE") as BookingLifecycleStatus,
      };
    }
    return out;
  }

  await initUniversalBookingAdjustmentDatabase();
  const database = await db();
  const rows = await select<UniversalAdjustmentRecord[]>(
    database,
    `SELECT *
     FROM booking_adjustments
     WHERE company_id=$1 AND service_type=$2
     ORDER BY booking_id ASC, revision_no ASC, created_at ASC`,
    [companyId, service],
  );
  const grouped = new Map<string, UniversalAdjustmentRecord[]>();
  for (const row of rows) {
    const g = grouped.get(row.booking_id) || [];
    g.push(row);
    grouped.set(row.booking_id, g);
  }
  const out: Record<string, UniversalAdjustmentSummary> = {};
  for (const [bId, groupRows] of grouped.entries()) {
    const commercial = [...groupRows]
      .filter((row) => row.adjustment_type !== "CORRECTION")
      .sort((a, b) => Number(b.revision_no) - Number(a.revision_no) || b.created_at.localeCompare(a.created_at));
    const latestCommercial = commercial[0];
    out[bId] = {
      bookingId: bId,
      revisionNo: latestCommercial ? Number(latestCommercial.revision_no || 1) : 1,
      adjustmentCount: groupRows.length,
      lifecycleStatus: (latestCommercial?.lifecycle_status || "ACTIVE") as BookingLifecycleStatus,
    };
  }
  return out;
}

function auditStatement(
  companyId: string,
  userId: string,
  service: BookingServiceName,
  bookingId: string,
  details: string,
  now: string,
): AtomicSqlStatement | null {
  if (!userId) return null;
  return {
    sql: `INSERT INTO audit_logs (id,company_id,user_id,user_name,action,module,record_id,details,created_at)
      VALUES ($1,$2,$3,
        COALESCE((SELECT full_name FROM users WHERE id=$3 AND company_id=$2 LIMIT 1),'Unknown User'),
        'BOOKING_ADJUSTED',$4,$5,$6,$7)`,
    params: [crypto.randomUUID(), companyId, userId, service, bookingId, details, now],
  };
}

export async function recordUniversalBookingAdjustment(
  companyId: string,
  input: RecordUniversalAdjustmentInput,
  actorUserId = "",
) {
  await initUniversalBookingAdjustmentDatabase();
  await requirePermission(companyId, actorUserId, "edit_bookings");
  if (!input.adjustmentDate) throw new Error("Adjustment Date is required.");
  if (!input.reason.trim()) throw new Error("Reason for adjustment is required.");
  const effectiveTotal = Number(input.effectiveTotalPkr || 0);
  if (!Number.isFinite(effectiveTotal) || effectiveTotal < 0)
    throw new Error("Effective booking value cannot be negative.");

  const table = bookingTables[input.service];
  let booking: { status: string; ub_number: string } | null;

  if (isDesktopApp()) {
    const database = await db();
    const bookingRows = await select<Array<{ status: string; ub_number: string }>>(
      database,
      `SELECT status,ub_number FROM ${table} WHERE id=$1 AND company_id=$2 LIMIT 1`,
      [input.bookingId, companyId],
    );
    booking = bookingRows[0] || null;
  } else {
    const { supabase } = await import("./supabaseClient");
    const { data, error } = await supabase
      .from(table)
      .select("status,ub_number")
      .eq("id", input.bookingId)
      .eq("company_id", companyId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    booking = data;
  }

  if (!booking || booking.status !== "ACTIVE") throw new Error("This booking is no longer active.");

  const state = await latestState(isDesktopApp() ? await db() : null, companyId, input.service, input.bookingId);
  if (state.lifecycleStatus === "CANCELLED") throw new Error("A fully cancelled booking cannot be adjusted again.");
  // Correction = typo/data fix only — keep current commercial REV (not a chargeable revision).
  const revisionNo = input.adjustmentType === "CORRECTION" ? state.revisionNo : state.revisionNo + 1;
  const lifecycleStatus = nextLifecycle(state.lifecycleStatus, input.adjustmentType);
  const accountDelta = effectiveTotal - Number(input.previousTotalPkr || 0);
  const now = new Date().toISOString();
  const adjustmentId = crypto.randomUUID();

  const adjustmentRow = {
    id: adjustmentId,
    company_id: companyId,
    service_type: input.service,
    booking_id: input.bookingId,
    adjustment_type: input.adjustmentType,
    adjustment_date: input.adjustmentDate,
    category: input.category.trim(),
    reason: input.reason.trim(),
    reference: input.reference.trim(),
    notes: input.notes.trim(),
    previous_total_pkr: Number(input.previousTotalPkr || 0),
    previous_base_pkr: Number(input.previousBasePkr || 0),
    revised_base_pkr: Number(input.revisedBasePkr || 0),
    charge_pkr: Math.max(0, Number(input.chargePkr || 0)),
    credit_pkr: Math.max(0, Number(input.creditPkr || 0)),
    account_delta_pkr: accountDelta,
    effective_total_pkr: effectiveTotal,
    before_snapshot_json: input.beforeSnapshotJson,
    after_snapshot_json: input.afterSnapshotJson,
    cancelled_lines_json: input.cancelledLinesJson,
    revision_no: revisionNo,
    lifecycle_status: lifecycleStatus,
    created_by_user_id: actorUserId,
    created_at: now,
  };

  if (isDesktopApp()) {
    const statements: AtomicSqlStatement[] = [
      {
        sql: `UPDATE ${table} SET total_pkr=$1,updated_at=$2,updated_by_user_id=$3
        WHERE id=$4 AND company_id=$5 AND status='ACTIVE'`,
        params: [effectiveTotal, now, actorUserId, input.bookingId, companyId],
      },
      {
        sql: `INSERT INTO booking_adjustments
        (id,company_id,service_type,booking_id,adjustment_type,adjustment_date,category,reason,reference,notes,
         previous_total_pkr,previous_base_pkr,revised_base_pkr,charge_pkr,credit_pkr,account_delta_pkr,effective_total_pkr,
         before_snapshot_json,after_snapshot_json,cancelled_lines_json,revision_no,lifecycle_status,created_by_user_id,created_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)`,
        params: [
          adjustmentId,
          companyId,
          input.service,
          input.bookingId,
          input.adjustmentType,
          input.adjustmentDate,
          adjustmentRow.category,
          adjustmentRow.reason,
          adjustmentRow.reference,
          adjustmentRow.notes,
          adjustmentRow.previous_total_pkr,
          adjustmentRow.previous_base_pkr,
          adjustmentRow.revised_base_pkr,
          adjustmentRow.charge_pkr,
          adjustmentRow.credit_pkr,
          accountDelta,
          effectiveTotal,
          input.beforeSnapshotJson,
          input.afterSnapshotJson,
          input.cancelledLinesJson,
          revisionNo,
          lifecycleStatus,
          actorUserId,
          now,
        ],
      },
    ];

    const audit = auditStatement(
      companyId,
      actorUserId,
      input.service,
      input.bookingId,
      `${input.adjustmentType} ${booking.ub_number || input.bookingId} · PKR ${input.previousTotalPkr} → ${effectiveTotal}`,
      now,
    );
    if (audit) statements.push(audit);

    await runAtomicTransaction(statements);
  }

  await queueSync("UPDATE", table, input.bookingId, {
    total_pkr: effectiveTotal,
    updated_at: now,
    updated_by_user_id: actorUserId,
  });
  await queueSync("UPSERT", "booking_adjustments", adjustmentId, adjustmentRow);
  if (isDesktopApp()) await flushDesktopSyncQueue();

  return { revisionNo, lifecycleStatus, accountDelta, effectiveTotal };
}
