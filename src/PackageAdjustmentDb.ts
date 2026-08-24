import Database from "@tauri-apps/plugin-sql";
import type { PackageBookingLineInput, PackagePassengerType } from "./db";
import { runAtomicTransaction, type AtomicSqlStatement } from "./DatabaseSafety";
import { hasPermission, type Permission, type UserRole } from "./permissions";

const DB_PATH = "sqlite:travel-accounting.db";
let databasePromise: Promise<Database> | null = null;
let initializationPromise: Promise<void> | null = null;

export type PackageAdjustmentType = "CORRECTION" | "AMENDMENT" | "PARTIAL_CANCELLATION" | "FULL_CANCELLATION";
export type PackageAdjustmentRequestedBy = "CUSTOMER" | "VENDOR" | "INTERNAL";
export type PackageLifecycleStatus = "ACTIVE" | "AMENDED" | "PARTIALLY_CANCELLED" | "CANCELLED";

export type PackageAdjustmentRecord = {
  id: string;
  company_id: string;
  booking_id: string;
  adjustment_type: PackageAdjustmentType;
  adjustment_date: string;
  requested_by: PackageAdjustmentRequestedBy;
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
  lifecycle_status: PackageLifecycleStatus;
  created_by_user_id: string;
  created_at: string;
};

export type PackageAdjustmentSummary = {
  bookingId: string;
  revisionNo: number;
  adjustmentCount: number;
  lifecycleStatus: PackageLifecycleStatus;
};

export type PackageAdjustmentLineInput = {
  passengerType: PackagePassengerType;
  passengerName: string;
  packageType: string;
  ratePerPerson: number;
  personCount: number;
};

export type PackageCorrectionAmendmentInput = {
  adjustmentType: "CORRECTION" | "AMENDMENT";
  adjustmentDate: string;
  requestedBy: PackageAdjustmentRequestedBy;
  category: string;
  reason: string;
  reference: string;
  notes: string;
  amendmentChargePkr: number;
  creditPkr: number;
  lines: PackageAdjustmentLineInput[];
};

export type PackageCancellationInput = {
  adjustmentType: "PARTIAL_CANCELLATION" | "FULL_CANCELLATION";
  adjustmentDate: string;
  requestedBy: PackageAdjustmentRequestedBy;
  reason: string;
  reference: string;
  notes: string;
  cancellationChargePkr: number;
  cancelQuantities: Record<string, number>;
};

type PackageHeaderRow = {
  id: string;
  company_id: string;
  transaction_type: "SALE" | "PURCHASE";
  counterparty_id: string;
  transaction_date: string;
  ub_number: string;
  total_pkr: number;
  status: string;
};

type PackageLineRow = {
  id: string;
  booking_id: string;
  passenger_type: PackagePassengerType;
  passenger_name: string;
  package_type: string;
  rate_per_person: number;
  person_count: number;
  qty_is_explicit: number;
  line_total_pkr: number;
  sort_order: number;
};

type CalculatedLine = {
  passengerType: PackagePassengerType;
  passengerName: string;
  packageType: string;
  ratePerPerson: number;
  personCount: number;
  qtyIsExplicit: number;
  lineTotalPkr: number;
  sortOrder: number;
};

type AdjustmentInsert = {
  adjustmentType: PackageAdjustmentType;
  adjustmentDate: string;
  requestedBy: PackageAdjustmentRequestedBy;
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
  lifecycleStatus: PackageLifecycleStatus;
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

async function requirePermission(companyId: string, userId: string, permission: Permission) {
  if (!userId) return;
  const database = await db();
  const rows = await select<Array<{ role: UserRole; status: string }>>(
    database,
    `SELECT role,status FROM users WHERE id=$1 AND company_id=$2 LIMIT 1`,
    [userId, companyId],
  );
  const actor = rows[0];
  if (!actor || actor.status !== "ACTIVE" || !hasPermission(actor.role, permission)) {
    throw new Error("You do not have permission to perform this action.");
  }
}

export async function initPackageAdjustmentDatabase() {
  if (initializationPromise) return initializationPromise;
  initializationPromise = (async () => {
    const database = await db();
    await execute(database, "PRAGMA busy_timeout = 5000");
    await execute(
      database,
      `CREATE TABLE IF NOT EXISTS package_booking_adjustments (
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
      `CREATE INDEX IF NOT EXISTS idx_package_adjustments_booking_revision
      ON package_booking_adjustments(company_id,booking_id,revision_no)`,
    );
    await execute(
      database,
      `CREATE INDEX IF NOT EXISTS idx_package_adjustments_date
      ON package_booking_adjustments(company_id,adjustment_date)`,
    );
  })();
  return initializationPromise;
}

async function ready() {
  await initPackageAdjustmentDatabase();
  return db();
}

async function loadBooking(database: Database, companyId: string, bookingId: string) {
  const headers = await select<PackageHeaderRow[]>(
    database,
    `SELECT id,company_id,transaction_type,counterparty_id,transaction_date,ub_number,total_pkr,status
     FROM package_bookings WHERE company_id=$1 AND id=$2 LIMIT 1`,
    [companyId, bookingId],
  );
  const booking = headers[0];
  if (!booking || booking.status !== "ACTIVE") throw new Error("This Package booking is not active.");
  const lines = await select<PackageLineRow[]>(
    database,
    `SELECT id,booking_id,passenger_type,passenger_name,package_type,rate_per_person,
            person_count,qty_is_explicit,line_total_pkr,sort_order
     FROM package_booking_lines WHERE booking_id=$1 ORDER BY sort_order ASC`,
    [bookingId],
  );
  return { booking, lines };
}

function baseTotal(lines: Array<{ line_total_pkr: number }>) {
  return lines.reduce((sum, line) => sum + Number(line.line_total_pkr || 0), 0);
}

function snapshot(lines: PackageLineRow[] | CalculatedLine[], totalPkr: number) {
  return JSON.stringify({ totalPkr, lines });
}

function calculateLines(lines: PackageAdjustmentLineInput[]) {
  if (!lines.length) throw new Error("Add at least one Package passenger row.");
  const occurrence: Record<PackagePassengerType, number> = { ADULT: 0, CHILD: 0, INFANT: 0 };
  const calculated = lines.map<CalculatedLine>((line, index) => {
    occurrence[line.passengerType] += 1;
    const label = `${line.passengerType} row ${occurrence[line.passengerType]}`;
    const passengerName = line.passengerName.trim();
    const packageType = line.packageType.trim();
    const rate = Math.max(0, Number(line.ratePerPerson) || 0);
    const qty = Math.max(0, Math.trunc(Number(line.personCount) || 0));
    if (!passengerName) throw new Error(`${label}: Passenger / Family Head is required.`);
    if (!packageType) throw new Error(`${label}: Package Type is required.`);
    if (!Number.isFinite(rate)) throw new Error(`${label}: Rate must be a valid number.`);
    if (qty <= 0) throw new Error(`${label}: Qty must be greater than zero.`);
    return {
      passengerType: line.passengerType,
      passengerName,
      packageType,
      ratePerPerson: rate,
      personCount: qty,
      qtyIsExplicit: 1,
      lineTotalPkr: rate * qty,
      sortOrder: index + 1,
    };
  });
  if (occurrence.ADULT === 0) throw new Error("At least one Adult Package row is required.");
  return calculated;
}

async function latestState(database: Database, companyId: string, bookingId: string) {
  const rows = await select<PackageAdjustmentRecord[]>(
    database,
    `SELECT * FROM package_booking_adjustments
     WHERE company_id=$1 AND booking_id=$2 ORDER BY revision_no DESC,created_at DESC LIMIT 1`,
    [companyId, bookingId],
  );
  const latest = rows[0];
  return {
    revisionNo: latest ? Number(latest.revision_no) : 1,
    lifecycleStatus: latest?.lifecycle_status || ("ACTIVE" as PackageLifecycleStatus),
  };
}

function nextLifecycle(current: PackageLifecycleStatus, type: PackageAdjustmentType): PackageLifecycleStatus {
  if (type === "FULL_CANCELLATION") return "CANCELLED";
  if (type === "PARTIAL_CANCELLATION") return "PARTIALLY_CANCELLED";
  if (current === "PARTIALLY_CANCELLED") return current;
  if (type === "AMENDMENT") return "AMENDED";
  return current === "AMENDED" ? "AMENDED" : "ACTIVE";
}

function lineStatements(bookingId: string, lines: CalculatedLine[]): AtomicSqlStatement[] {
  const statements: AtomicSqlStatement[] = [
    { sql: `DELETE FROM package_booking_lines WHERE booking_id=$1`, params: [bookingId] },
  ];
  lines.forEach((line) =>
    statements.push({
      sql: `INSERT INTO package_booking_lines
      (id,booking_id,passenger_type,passenger_name,package_type,rate_per_person,person_count,qty_is_explicit,line_total_pkr,sort_order)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      params: [
        crypto.randomUUID(),
        bookingId,
        line.passengerType,
        line.passengerName,
        line.packageType,
        line.ratePerPerson,
        line.personCount,
        line.qtyIsExplicit,
        line.lineTotalPkr,
        line.sortOrder,
      ],
    }),
  );
  return statements;
}

function adjustmentStatement(
  companyId: string,
  bookingId: string,
  input: AdjustmentInsert,
  actorUserId: string,
  now: string,
): AtomicSqlStatement {
  return {
    sql: `INSERT INTO package_booking_adjustments
      (id,company_id,booking_id,adjustment_type,adjustment_date,requested_by,category,reason,reference,notes,
       previous_total_pkr,previous_base_pkr,revised_base_pkr,charge_pkr,credit_pkr,account_delta_pkr,effective_total_pkr,
       before_snapshot_json,after_snapshot_json,cancelled_lines_json,revision_no,lifecycle_status,created_by_user_id,created_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)`,
    params: [
      crypto.randomUUID(),
      companyId,
      bookingId,
      input.adjustmentType,
      input.adjustmentDate,
      input.requestedBy,
      input.category.trim(),
      input.reason.trim(),
      input.reference.trim(),
      input.notes.trim(),
      input.previousTotal,
      input.previousBase,
      input.revisedBase,
      input.charge,
      input.credit,
      input.delta,
      input.effectiveTotal,
      input.beforeSnapshot,
      input.afterSnapshot,
      input.cancelledLines,
      input.revisionNo,
      input.lifecycleStatus,
      actorUserId,
      now,
    ],
  };
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
        $4,'PACKAGE',$5,$6,$7)`,
    params: [crypto.randomUUID(), companyId, userId, action, recordId, details, now],
  };
}

async function writeAdjustment(
  companyId: string,
  bookingId: string,
  lines: CalculatedLine[],
  effectiveTotal: number,
  adjustment: AdjustmentInsert,
  actorUserId: string,
  auditAction: string,
  auditDetails: string,
) {
  const now = new Date().toISOString();
  const statements = lineStatements(bookingId, lines);
  statements.push({
    sql: `UPDATE package_bookings SET total_pkr=$1,updated_at=$2,updated_by_user_id=$3
      WHERE company_id=$4 AND id=$5 AND status='ACTIVE'`,
    params: [effectiveTotal, now, actorUserId, companyId, bookingId],
  });
  statements.push(adjustmentStatement(companyId, bookingId, adjustment, actorUserId, now));
  const audit = auditStatement(companyId, actorUserId, auditAction, bookingId, auditDetails, now);
  if (audit) statements.push(audit);
  await runAtomicTransaction(statements);
}

export async function savePackageCorrectionOrAmendment(
  companyId: string,
  bookingId: string,
  input: PackageCorrectionAmendmentInput,
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

  const revisedLines = calculateLines(input.lines);
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
  const revisionNo = state.revisionNo + 1;

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
    revisedLines,
    effectiveTotal,
    adjustment,
    actorUserId,
    `BOOKING_${input.adjustmentType}`,
    `${booking.ub_number} ${input.adjustmentType} ${delta >= 0 ? "+" : ""}${delta.toFixed(2)} PKR; effective ${effectiveTotal.toFixed(2)} PKR.`,
  );
  return { effectiveTotal, delta, revisionNo, lifecycleStatus };
}

export async function savePackageCancellation(
  companyId: string,
  bookingId: string,
  input: PackageCancellationInput,
  actorUserId = "",
) {
  await requirePermission(companyId, actorUserId, "edit_bookings");
  if (!input.adjustmentDate) throw new Error("Cancellation Date is required.");
  if (!input.reason.trim()) throw new Error("Cancellation reason is required.");
  const database = await ready();
  const { booking, lines: currentLines } = await loadBooking(database, companyId, bookingId);
  const state = await latestState(database, companyId, bookingId);
  if (state.lifecycleStatus === "CANCELLED") throw new Error("This booking is already fully cancelled.");
  if (!currentLines.length) throw new Error("This booking has no active Package rows to cancel.");

  const previousBase = baseTotal(currentLines);
  const carriedFinancialAdjustments = Number(booking.total_pkr || 0) - previousBase;
  const cancelled: Array<{
    lineId: string;
    passengerName: string;
    packageType: string;
    qty: number;
    valuePkr: number;
  }> = [];
  const remaining: CalculatedLine[] = [];

  for (const line of currentLines) {
    const availableQty = Math.max(1, Math.trunc(Number(line.person_count) || 1));
    const requestedQty =
      input.adjustmentType === "FULL_CANCELLATION"
        ? availableQty
        : Math.max(0, Math.min(availableQty, Math.trunc(Number(input.cancelQuantities[line.id]) || 0)));
    if (requestedQty > 0) {
      cancelled.push({
        lineId: line.id,
        passengerName: line.passenger_name,
        packageType: line.package_type,
        qty: requestedQty,
        valuePkr: Number(line.rate_per_person || 0) * requestedQty,
      });
    }
    const remainingQty = availableQty - requestedQty;
    if (remainingQty > 0) {
      remaining.push({
        passengerType: line.passenger_type,
        passengerName: line.passenger_name,
        packageType: line.package_type,
        ratePerPerson: Number(line.rate_per_person || 0),
        personCount: remainingQty,
        qtyIsExplicit: 1,
        lineTotalPkr: Number(line.rate_per_person || 0) * remainingQty,
        sortOrder: remaining.length + 1,
      });
    }
  }

  if (!cancelled.length) throw new Error("Select at least one Package row / quantity to cancel.");
  if (input.adjustmentType === "PARTIAL_CANCELLATION" && !remaining.length) {
    throw new Error("All Package rows are selected. Use Full Cancellation instead.");
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

export async function getPackageAdjustmentHistory(companyId: string, bookingId: string) {
  const database = await ready();
  return select<PackageAdjustmentRecord[]>(
    database,
    `SELECT id,company_id,booking_id,adjustment_type,adjustment_date,requested_by,category,reason,reference,notes,
            previous_total_pkr,previous_base_pkr,revised_base_pkr,charge_pkr,credit_pkr,account_delta_pkr,effective_total_pkr,
            before_snapshot_json,after_snapshot_json,cancelled_lines_json,revision_no,lifecycle_status,created_by_user_id,created_at
     FROM package_booking_adjustments
     WHERE company_id=$1 AND booking_id=$2
     ORDER BY revision_no ASC,created_at ASC`,
    [companyId, bookingId],
  );
}

export async function getPackageAdjustmentSummaryMap(companyId: string) {
  const database = await ready();
  const rows = await select<PackageAdjustmentRecord[]>(
    database,
    `SELECT id,company_id,booking_id,adjustment_type,adjustment_date,requested_by,category,reason,reference,notes,
            previous_total_pkr,previous_base_pkr,revised_base_pkr,charge_pkr,credit_pkr,account_delta_pkr,effective_total_pkr,
            before_snapshot_json,after_snapshot_json,cancelled_lines_json,revision_no,lifecycle_status,created_by_user_id,created_at
     FROM package_booking_adjustments
     WHERE company_id=$1 ORDER BY booking_id ASC,revision_no ASC,created_at ASC`,
    [companyId],
  );
  const result: Record<string, PackageAdjustmentSummary> = {};
  for (const row of rows) {
    const existing = result[row.booking_id];
    result[row.booking_id] = {
      bookingId: row.booking_id,
      revisionNo: Number(row.revision_no || 1),
      adjustmentCount: (existing?.adjustmentCount || 0) + 1,
      lifecycleStatus: row.lifecycle_status,
    };
  }
  return result;
}

export function toPackageLineInputs(lines: PackageLineRow[]): PackageBookingLineInput[] {
  return lines.map((line) => ({
    passengerType: line.passenger_type,
    passengerName: line.passenger_name,
    packageType: line.package_type,
    ratePerPerson: Number(line.rate_per_person || 0),
    personCount: Number(line.person_count || 0),
    qtyIsExplicit: true,
  }));
}
