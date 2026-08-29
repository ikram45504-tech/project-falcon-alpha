import Database from "@tauri-apps/plugin-sql";
import { requirePermission } from "./db";
import { runAtomicTransaction, type AtomicSqlStatement } from "./DatabaseSafety";
import { isDesktopApp, syncMiscAdjustmentBundle, flushDesktopSyncQueue } from "./cloudSync";
import { supabase } from "./supabaseClient";

const DB_PATH = "sqlite:travel-accounting.db";
let databasePromise: Promise<Database> | null = null;
let initializationPromise: Promise<void> | null = null;

export type MiscAdjustmentType = "CORRECTION" | "AMENDMENT" | "PARTIAL_CANCELLATION" | "FULL_CANCELLATION";
export type MiscAdjustmentRequestedBy = "CUSTOMER" | "VENDOR" | "INTERNAL";
export type MiscLifecycleStatus = "ACTIVE" | "AMENDED" | "PARTIALLY_CANCELLED" | "CANCELLED";

export type MiscAdjustmentRecord = {
  id: string;
  company_id: string;
  booking_id: string;
  adjustment_type: MiscAdjustmentType;
  adjustment_date: string;
  requested_by: MiscAdjustmentRequestedBy;
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
  lifecycle_status: MiscLifecycleStatus;
  created_by_user_id: string;
  created_at: string;
};

export type MiscAdjustmentSummary = {
  bookingId: string;
  revisionNo: number;
  adjustmentCount: number;
  lifecycleStatus: MiscLifecycleStatus;
};

export type MiscAdjustmentLineInput = {
  lineId?: string;
  serviceName: string;
  paxCount: number;
  ratePerPerson: number;
  roe: number | null;
};

export type MiscCorrectionAmendmentInput = {
  adjustmentType: "CORRECTION" | "AMENDMENT";
  adjustmentDate: string;
  requestedBy: MiscAdjustmentRequestedBy;
  category: string;
  reason: string;
  reference: string;
  notes: string;
  amendmentChargePkr: number;
  creditPkr: number;
  lines: MiscAdjustmentLineInput[];
};

export type MiscCancellationInput = {
  adjustmentType: "PARTIAL_CANCELLATION" | "FULL_CANCELLATION";
  adjustmentDate: string;
  requestedBy: MiscAdjustmentRequestedBy;
  reason: string;
  reference: string;
  notes: string;
  cancellationChargePkr: number;
  cancelQuantities: Record<string, number>;
};

type MiscHeaderRow = {
  id: string;
  company_id: string;
  transaction_type: "SALE" | "PURCHASE";
  counterparty_id: string;
  transaction_date: string;
  ub_number: string;
  total_sar: number;
  total_pkr: number;
  unconverted_sar: number;
  status: string;
};

type MiscLineRow = {
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

type CalculatedLine = {
  lineId?: string;
  serviceName: string;
  paxCount: number;
  ratePerPerson: number;
  roe: number;
  currencyMode: "PKR" | "SAR";
  lineTotalSar: number;
  lineTotalPkr: number;
  sortOrder: number;
};

type AdjustmentInsert = {
  adjustmentType: MiscAdjustmentType;
  adjustmentDate: string;
  requestedBy: MiscAdjustmentRequestedBy;
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
  lifecycleStatus: MiscLifecycleStatus;
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
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await work();
    } catch (error) {
      lastError = error;
      if (!isBusyError(error) || attempt === attempts - 1) throw error;
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

function calculateMiscLines(lines: MiscAdjustmentLineInput[]) {
  if (!lines.length) throw new Error("Add at least one Misc service row.");
  const calculated = lines.map((line, index) => {
    const serviceName = line.serviceName.trim();
    const paxCount = Math.trunc(Number(line.paxCount));
    const ratePerPerson = Number(line.ratePerPerson);
    const roe = line.roe == null ? 0 : Number(line.roe);
    if (!serviceName) throw new Error(`Misc row ${index + 1}: Service Name is required.`);
    if (!Number.isFinite(paxCount) || paxCount < 1 || paxCount > 9999)
      throw new Error(`Misc row ${index + 1}: No. of Pax must be at least 1.`);
    if (!Number.isFinite(ratePerPerson))
      throw new Error(`Misc row ${index + 1}: Rate / Person must be a valid number.`);
    if (!Number.isFinite(roe) || roe < 0) throw new Error(`Misc row ${index + 1}: ROE cannot be negative.`);

    const currencyMode: "PKR" | "SAR" = roe > 0 ? "SAR" : "PKR";
    const base = ratePerPerson * paxCount;
    const lineTotalSar = currencyMode === "SAR" ? base : 0;
    const lineTotalPkr = currencyMode === "SAR" ? base * roe : base;
    return {
      serviceName,
      paxCount,
      ratePerPerson,
      roe,
      currencyMode,
      lineTotalSar,
      lineTotalPkr,
      sortOrder: index,
    };
  });
  return { calculated };
}

export async function initMiscAdjustmentDatabase() {
  if (initializationPromise) return initializationPromise;
  initializationPromise = (async () => {
    const database = await db();
    await execute(database, "PRAGMA busy_timeout = 5000");
    await execute(
      database,
      `CREATE TABLE IF NOT EXISTS misc_booking_adjustments (
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
      `CREATE INDEX IF NOT EXISTS idx_misc_booking_adjustments_lookup
      ON misc_booking_adjustments(company_id,booking_id,revision_no)`,
    );
    await execute(
      database,
      `CREATE INDEX IF NOT EXISTS idx_misc_booking_adjustments_date
      ON misc_booking_adjustments(company_id,adjustment_date)`,
    );
  })();
  return initializationPromise;
}

async function ready() {
  await initMiscAdjustmentDatabase();
  return db();
}

async function loadBooking(database: Database | null, companyId: string, bookingId: string) {
  if (!isDesktopApp()) {
    const { data: booking, error } = await supabase
      .from("misc_bookings")
      .select(
        "id,company_id,transaction_type,counterparty_id,transaction_date,ub_number,total_sar,total_pkr,unconverted_sar,status",
      )
      .eq("company_id", companyId)
      .eq("id", bookingId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!booking || booking.status !== "ACTIVE") throw new Error("This Misc booking is not active.");
    const { data: lines, error: lineError } = await supabase
      .from("misc_booking_lines")
      .select(
        "id,booking_id,service_name,pax_count,rate_per_person,roe,currency_mode,line_total_sar,line_total_pkr,sort_order",
      )
      .eq("booking_id", bookingId)
      .order("sort_order", { ascending: true });
    if (lineError) throw new Error(lineError.message);
    return { booking: booking as MiscHeaderRow, lines: (lines || []) as MiscLineRow[] };
  }

  const headers = await select<MiscHeaderRow[]>(
    database!,
    `SELECT id,company_id,transaction_type,counterparty_id,transaction_date,ub_number,total_sar,total_pkr,unconverted_sar,status
     FROM misc_bookings WHERE company_id=$1 AND id=$2 LIMIT 1`,
    [companyId, bookingId],
  );
  const booking = headers[0];
  if (!booking || booking.status !== "ACTIVE") throw new Error("This Misc booking is not active.");
  const lines = await select<MiscLineRow[]>(
    database!,
    `SELECT id,booking_id,service_name,pax_count,rate_per_person,roe,currency_mode,line_total_sar,line_total_pkr,sort_order
     FROM misc_booking_lines WHERE booking_id=$1 ORDER BY sort_order ASC`,
    [bookingId],
  );
  return { booking, lines };
}

function baseTotal(lines: Array<{ line_total_pkr: number }>) {
  return lines.reduce((sum, line) => sum + Number(line.line_total_pkr || 0), 0);
}

function lineTotals(lines: CalculatedLine[]) {
  const totalSar = lines.reduce((sum, line) => sum + line.lineTotalSar, 0);
  const totalPkr = lines.reduce((sum, line) => sum + line.lineTotalPkr, 0);
  return { totalSar, totalPkr, unconvertedSar: 0 };
}

function snapshot(lines: MiscLineRow[] | CalculatedLine[], totalPkr: number) {
  return JSON.stringify({ totalPkr, lines });
}

function toCalculatedLines(lines: MiscAdjustmentLineInput[]): CalculatedLine[] {
  const { calculated } = calculateMiscLines(lines);
  return calculated.map((line, index) => ({
    ...line,
    lineId: lines[index]?.lineId?.trim() || undefined,
  }));
}

async function latestState(database: Database | null, companyId: string, bookingId: string) {
  if (!isDesktopApp()) {
    const { data, error } = await supabase
      .from("misc_booking_adjustments")
      .select("revision_no,lifecycle_status,adjustment_type")
      .eq("company_id", companyId)
      .eq("booking_id", bookingId)
      .order("revision_no", { ascending: false })
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    const commercial = (data || []).find((row) => row.adjustment_type !== "CORRECTION");
    return {
      revisionNo: commercial ? Number(commercial.revision_no) : 1,
      lifecycleStatus: (commercial?.lifecycle_status || "ACTIVE") as MiscLifecycleStatus,
    };
  }
  const rows = await select<MiscAdjustmentRecord[]>(
    database!,
    `SELECT * FROM misc_booking_adjustments
     WHERE company_id=$1 AND booking_id=$2 ORDER BY revision_no DESC,created_at DESC`,
    [companyId, bookingId],
  );
  const commercial = rows.find((row) => row.adjustment_type !== "CORRECTION");
  return {
    revisionNo: commercial ? Number(commercial.revision_no) : 1,
    lifecycleStatus: commercial?.lifecycle_status || ("ACTIVE" as MiscLifecycleStatus),
  };
}

function nextLifecycle(current: MiscLifecycleStatus, type: MiscAdjustmentType): MiscLifecycleStatus {
  if (type === "FULL_CANCELLATION") return "CANCELLED";
  if (type === "PARTIAL_CANCELLATION") return "PARTIALLY_CANCELLED";
  if (current === "PARTIALLY_CANCELLED") return current;
  if (type === "AMENDMENT") return "AMENDED";
  return current === "AMENDED" ? "AMENDED" : "ACTIVE";
}

function auditStatement(
  companyId: string,
  userId: string,
  action: string,
  recordId: string,
  details: string,
  now: string,
): AtomicSqlStatement | null {
  if (!userId) return null;
  return {
    sql: `INSERT INTO audit_logs
      (id,company_id,user_id,user_name,action,module,record_id,details,created_at)
      VALUES ($1,$2,$3,
        COALESCE((SELECT full_name FROM users WHERE id=$3 AND company_id=$2 LIMIT 1),'Unknown User'),
        $4,'MISC',$5,$6,$7)`,
    params: [crypto.randomUUID(), companyId, userId, action, recordId, details, now],
  };
}

async function writeAdjustment(
  companyId: string,
  bookingId: string,
  _booking: MiscHeaderRow,
  lines: CalculatedLine[],
  effectiveTotal: number,
  adjustment: AdjustmentInsert,
  actorUserId: string,
  auditAction: string,
  auditDetails: string,
) {
  const now = new Date().toISOString();
  const adjustmentId = crypto.randomUUID();
  const { totalSar, unconvertedSar } = lineTotals(lines);
  const lineRows = lines.map((line) => ({
    id: line.lineId || crypto.randomUUID(),
    booking_id: bookingId,
    service_name: line.serviceName,
    pax_count: line.paxCount,
    rate_per_person: line.ratePerPerson,
    roe: line.roe,
    currency_mode: line.currencyMode,
    line_total_sar: line.lineTotalSar,
    line_total_pkr: line.lineTotalPkr,
    sort_order: line.sortOrder,
  }));

  if (isDesktopApp()) {
    const statements: AtomicSqlStatement[] = [
      { sql: `DELETE FROM misc_booking_lines WHERE booking_id=$1`, params: [bookingId] },
      ...lineRows.map((line) => ({
        sql: `INSERT INTO misc_booking_lines
      (id,booking_id,service_name,pax_count,rate_per_person,roe,currency_mode,line_total_sar,line_total_pkr,sort_order)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        params: [
          line.id,
          line.booking_id,
          line.service_name,
          line.pax_count,
          line.rate_per_person,
          line.roe,
          line.currency_mode,
          line.line_total_sar,
          line.line_total_pkr,
          line.sort_order,
        ],
      })),
      {
        sql: `UPDATE misc_bookings SET total_sar=$1,total_pkr=$2,unconverted_sar=$3,updated_at=$4,updated_by_user_id=$5
      WHERE company_id=$6 AND id=$7 AND status='ACTIVE'`,
        params: [totalSar, effectiveTotal, unconvertedSar, now, actorUserId, companyId, bookingId],
      },
      {
        sql: `INSERT INTO misc_booking_adjustments
      (id,company_id,booking_id,adjustment_type,adjustment_date,requested_by,category,reason,reference,notes,
       previous_total_pkr,previous_base_pkr,revised_base_pkr,charge_pkr,credit_pkr,account_delta_pkr,effective_total_pkr,
       before_snapshot_json,after_snapshot_json,cancelled_lines_json,revision_no,lifecycle_status,created_by_user_id,created_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)`,
        params: [
          adjustmentId,
          companyId,
          bookingId,
          adjustment.adjustmentType,
          adjustment.adjustmentDate,
          adjustment.requestedBy,
          adjustment.category.trim(),
          adjustment.reason.trim(),
          adjustment.reference.trim(),
          adjustment.notes.trim(),
          adjustment.previousTotal,
          adjustment.previousBase,
          adjustment.revisedBase,
          adjustment.charge,
          adjustment.credit,
          adjustment.delta,
          adjustment.effectiveTotal,
          adjustment.beforeSnapshot,
          adjustment.afterSnapshot,
          adjustment.cancelledLines,
          adjustment.revisionNo,
          adjustment.lifecycleStatus,
          actorUserId,
          now,
        ],
      },
    ];
    const audit = auditStatement(companyId, actorUserId, auditAction, bookingId, auditDetails, now);
    if (audit) statements.push(audit);
    await runAtomicTransaction(statements);
  }

  await syncMiscAdjustmentBundle({
    bookingId,
    companyId,
    totalSar,
    totalPkr: effectiveTotal,
    unconvertedSar,
    updatedAt: now,
    updatedByUserId: actorUserId,
    lines: lineRows,
    adjustment: {
      id: adjustmentId,
      company_id: companyId,
      booking_id: bookingId,
      adjustment_type: adjustment.adjustmentType,
      adjustment_date: adjustment.adjustmentDate,
      requested_by: adjustment.requestedBy,
      category: adjustment.category.trim(),
      reason: adjustment.reason.trim(),
      reference: adjustment.reference.trim(),
      notes: adjustment.notes.trim(),
      previous_total_pkr: adjustment.previousTotal,
      previous_base_pkr: adjustment.previousBase,
      revised_base_pkr: adjustment.revisedBase,
      charge_pkr: adjustment.charge,
      credit_pkr: adjustment.credit,
      account_delta_pkr: adjustment.delta,
      effective_total_pkr: adjustment.effectiveTotal,
      before_snapshot_json: adjustment.beforeSnapshot,
      after_snapshot_json: adjustment.afterSnapshot,
      cancelled_lines_json: adjustment.cancelledLines,
      revision_no: adjustment.revisionNo,
      lifecycle_status: adjustment.lifecycleStatus,
      created_by_user_id: actorUserId,
      created_at: now,
    },
  });

  if (isDesktopApp()) {
    await flushDesktopSyncQueue();
  }
}

export async function saveMiscCorrectionOrAmendment(
  companyId: string,
  bookingId: string,
  input: MiscCorrectionAmendmentInput,
  actorUserId = "",
) {
  await requirePermission(companyId, actorUserId, "edit_bookings");
  if (!input.adjustmentDate) throw new Error("Adjustment Date is required.");
  if (!input.reason.trim()) throw new Error("Reason for adjustment is required.");
  const database = await ready();
  const { booking, lines: currentLines } = await loadBooking(database, companyId, bookingId);
  const state = await latestState(database, companyId, bookingId);
  if (state.lifecycleStatus === "CANCELLED")
    throw new Error("A fully cancelled booking cannot be amended. Review its History instead.");

  const revisedLines = toCalculatedLines(input.lines);
  const previousBase = baseTotal(currentLines);
  const revisedBase = revisedLines.reduce((sum, line) => sum + line.lineTotalPkr, 0);
  const carriedFinancialAdjustments = Number(booking.total_pkr || 0) - previousBase;
  const charge = input.adjustmentType === "AMENDMENT" ? Math.max(0, Number(input.amendmentChargePkr) || 0) : 0;
  const credit = input.adjustmentType === "AMENDMENT" ? Math.max(0, Number(input.creditPkr) || 0) : 0;
  const effectiveTotal = revisedBase + carriedFinancialAdjustments + charge - credit;
  if (effectiveTotal < 0)
    throw new Error("This adjustment would make the booking value negative. Reduce the credit amount.");
  const delta = effectiveTotal - Number(booking.total_pkr || 0);
  const lifecycleStatus = nextLifecycle(state.lifecycleStatus, input.adjustmentType);
  const revisionNo = input.adjustmentType === "CORRECTION" ? state.revisionNo : state.revisionNo + 1;

  const adjustment: AdjustmentInsert = {
    adjustmentType: input.adjustmentType,
    adjustmentDate: input.adjustmentDate,
    requestedBy: input.requestedBy,
    category: input.category,
    reason: input.reason,
    reference: input.reference,
    notes: input.notes,
    previousTotal: Number(booking.total_pkr || 0),
    previousBase,
    revisedBase,
    charge,
    credit,
    delta,
    effectiveTotal,
    beforeSnapshot: snapshot(currentLines, Number(booking.total_pkr || 0)),
    afterSnapshot: snapshot(revisedLines, effectiveTotal),
    cancelledLines: "",
    revisionNo,
    lifecycleStatus,
  };

  await writeAdjustment(
    companyId,
    bookingId,
    booking,
    revisedLines,
    effectiveTotal,
    adjustment,
    actorUserId,
    `BOOKING_${input.adjustmentType}`,
    `${booking.ub_number} ${input.adjustmentType} ${delta >= 0 ? "+" : ""}${delta.toFixed(2)} PKR; effective ${effectiveTotal.toFixed(2)} PKR.`,
  );
  return { effectiveTotal, delta, revisionNo, lifecycleStatus };
}

export async function saveMiscCancellation(
  companyId: string,
  bookingId: string,
  input: MiscCancellationInput,
  actorUserId = "",
) {
  await requirePermission(companyId, actorUserId, "edit_bookings");
  if (!input.adjustmentDate) throw new Error("Cancellation Date is required.");
  if (!input.reason.trim()) throw new Error("Cancellation reason is required.");
  const database = await ready();
  const { booking, lines: currentLines } = await loadBooking(database, companyId, bookingId);
  const state = await latestState(database, companyId, bookingId);
  if (state.lifecycleStatus === "CANCELLED") throw new Error("This booking is already fully cancelled.");
  if (!currentLines.length) throw new Error("This booking has no active Misc rows to cancel.");

  const previousBase = baseTotal(currentLines);
  const carriedFinancialAdjustments = Number(booking.total_pkr || 0) - previousBase;
  const cancelled: Array<{
    lineId: string;
    serviceName: string;
    qty: number;
    valuePkr: number;
  }> = [];
  const remaining: CalculatedLine[] = [];

  for (const line of currentLines) {
    const availableQty = Math.max(1, Math.trunc(Number(line.pax_count) || 1));
    const requestedQty =
      input.adjustmentType === "FULL_CANCELLATION"
        ? availableQty
        : Math.max(0, Math.min(availableQty, Math.trunc(Number(input.cancelQuantities[line.id]) || 0)));
    if (requestedQty > 0) {
      const unitPkr = availableQty > 0 ? Number(line.line_total_pkr || 0) / availableQty : 0;
      cancelled.push({
        lineId: line.id,
        serviceName: line.service_name,
        qty: requestedQty,
        valuePkr: unitPkr * requestedQty,
      });
    }
    const remainingQty = availableQty - requestedQty;
    if (remainingQty > 0) {
      const ratePerPerson = Number(line.rate_per_person || 0);
      const roe = Number(line.roe || 0);
      const currencyMode = line.currency_mode;
      const base = ratePerPerson * remainingQty;
      const lineTotalSar = currencyMode === "SAR" ? base : 0;
      const lineTotalPkr = currencyMode === "SAR" ? base * roe : base;
      remaining.push({
        lineId: line.id,
        serviceName: line.service_name,
        paxCount: remainingQty,
        ratePerPerson,
        roe,
        currencyMode,
        lineTotalSar,
        lineTotalPkr,
        sortOrder: remaining.length,
      });
    }
  }

  if (!cancelled.length) throw new Error("Select at least one Misc row / quantity to cancel.");
  if (input.adjustmentType === "PARTIAL_CANCELLATION" && !remaining.length) {
    throw new Error("All Misc rows are selected. Use Full Cancellation instead.");
  }

  const cancelledValue = cancelled.reduce((sum, item) => sum + item.valuePkr, 0);
  const charge = Math.max(0, Number(input.cancellationChargePkr) || 0);
  if (charge > cancelledValue)
    throw new Error("Cancellation charge cannot be greater than the cancelled commercial value.");
  const revisedBase = remaining.reduce((sum, line) => sum + line.lineTotalPkr, 0);
  const effectiveTotal = Math.max(0, revisedBase + carriedFinancialAdjustments + charge);
  const delta = effectiveTotal - Number(booking.total_pkr || 0);
  const lifecycleStatus = nextLifecycle(state.lifecycleStatus, input.adjustmentType);
  const revisionNo = state.revisionNo + 1;

  const adjustment: AdjustmentInsert = {
    adjustmentType: input.adjustmentType,
    adjustmentDate: input.adjustmentDate,
    requestedBy: input.requestedBy,
    category: input.adjustmentType === "FULL_CANCELLATION" ? "Full Cancellation" : "Partial Cancellation",
    reason: input.reason,
    reference: input.reference,
    notes: input.notes,
    previousTotal: Number(booking.total_pkr || 0),
    previousBase,
    revisedBase,
    charge,
    credit: cancelledValue - charge,
    delta,
    effectiveTotal,
    beforeSnapshot: snapshot(currentLines, Number(booking.total_pkr || 0)),
    afterSnapshot: snapshot(remaining, effectiveTotal),
    cancelledLines: JSON.stringify(cancelled),
    revisionNo,
    lifecycleStatus,
  };

  await writeAdjustment(
    companyId,
    bookingId,
    booking,
    remaining,
    effectiveTotal,
    adjustment,
    actorUserId,
    `BOOKING_${input.adjustmentType}`,
    `${booking.ub_number} ${input.adjustmentType}; cancelled ${cancelledValue.toFixed(2)} PKR, charge ${charge.toFixed(2)} PKR, effective ${effectiveTotal.toFixed(2)} PKR.`,
  );
  return {
    effectiveTotal,
    delta,
    revisionNo,
    lifecycleStatus,
    cancelledValue,
    cancellationCharge: charge,
    accountCredit: cancelledValue - charge,
  };
}

export async function getMiscAdjustmentHistory(companyId: string, bookingId: string) {
  if (!isDesktopApp()) {
    const { data, error } = await supabase
      .from("misc_booking_adjustments")
      .select(
        "id,company_id,booking_id,adjustment_type,adjustment_date,requested_by,category,reason,reference,notes,previous_total_pkr,previous_base_pkr,revised_base_pkr,charge_pkr,credit_pkr,account_delta_pkr,effective_total_pkr,before_snapshot_json,after_snapshot_json,cancelled_lines_json,revision_no,lifecycle_status,created_by_user_id,created_at",
      )
      .eq("company_id", companyId)
      .eq("booking_id", bookingId)
      .order("revision_no", { ascending: true })
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return (data || []) as MiscAdjustmentRecord[];
  }
  const database = await ready();
  return select<MiscAdjustmentRecord[]>(
    database,
    `SELECT id,company_id,booking_id,adjustment_type,adjustment_date,requested_by,category,reason,reference,notes,
            previous_total_pkr,previous_base_pkr,revised_base_pkr,charge_pkr,credit_pkr,account_delta_pkr,effective_total_pkr,
            before_snapshot_json,after_snapshot_json,cancelled_lines_json,revision_no,lifecycle_status,created_by_user_id,created_at
     FROM misc_booking_adjustments
     WHERE company_id=$1 AND booking_id=$2
     ORDER BY revision_no ASC,created_at ASC`,
    [companyId, bookingId],
  );
}

export async function getMiscAdjustmentSummaryMap(companyId: string) {
  if (!isDesktopApp()) {
    const { data, error } = await supabase
      .from("misc_booking_adjustments")
      .select("booking_id,revision_no,lifecycle_status,adjustment_type")
      .eq("company_id", companyId)
      .order("booking_id", { ascending: true })
      .order("revision_no", { ascending: true });
    if (error) throw new Error(error.message);
    const result: Record<string, MiscAdjustmentSummary> = {};
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
  const database = await ready();
  const rows = await select<MiscAdjustmentRecord[]>(
    database,
    `SELECT id,company_id,booking_id,adjustment_type,adjustment_date,requested_by,category,reason,reference,notes,
            previous_total_pkr,previous_base_pkr,revised_base_pkr,charge_pkr,credit_pkr,account_delta_pkr,effective_total_pkr,
            before_snapshot_json,after_snapshot_json,cancelled_lines_json,revision_no,lifecycle_status,created_by_user_id,created_at
     FROM misc_booking_adjustments
     WHERE company_id=$1 ORDER BY booking_id ASC,revision_no ASC,created_at ASC`,
    [companyId],
  );
  const result: Record<string, MiscAdjustmentSummary> = {};
  for (const row of rows) {
    const existing = result[row.booking_id];
    const isCorrection = row.adjustment_type === "CORRECTION";
    result[row.booking_id] = {
      bookingId: row.booking_id,
      revisionNo: isCorrection ? existing?.revisionNo || 1 : Number(row.revision_no || 1),
      adjustmentCount: (existing?.adjustmentCount || 0) + 1,
      lifecycleStatus: isCorrection
        ? existing?.lifecycleStatus || ("ACTIVE" as MiscLifecycleStatus)
        : row.lifecycle_status,
    };
  }
  return result;
}
