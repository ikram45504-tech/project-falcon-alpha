import Database from "@tauri-apps/plugin-sql";
import {
  calculateVisaBooking,
  requirePermission,
  type VisaBookingInput,
  type VisaPassengerType,
  type VisaType,
  type VisaVehicleType,
} from "./db";
import { runAtomicTransaction, type AtomicSqlStatement } from "./DatabaseSafety";
import { isDesktopApp, syncVisaAdjustmentBundle, flushDesktopSyncQueue } from "./cloudSync";
import { supabase } from "./supabaseClient";

const DB_PATH = "sqlite:travel-accounting.db";
let databasePromise: Promise<Database> | null = null;
let initializationPromise: Promise<void> | null = null;

export type VisaAdjustmentType = "CORRECTION" | "AMENDMENT" | "PARTIAL_CANCELLATION" | "FULL_CANCELLATION";
export type VisaAdjustmentRequestedBy = "CUSTOMER" | "VENDOR" | "INTERNAL";
export type VisaLifecycleStatus = "ACTIVE" | "AMENDED" | "PARTIALLY_CANCELLED" | "CANCELLED";

export type VisaAdjustmentRecord = {
  id: string;
  company_id: string;
  booking_id: string;
  adjustment_type: VisaAdjustmentType;
  adjustment_date: string;
  requested_by: VisaAdjustmentRequestedBy;
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
  lifecycle_status: VisaLifecycleStatus;
  created_by_user_id: string;
  created_at: string;
};

export type VisaAdjustmentSummary = {
  bookingId: string;
  revisionNo: number;
  adjustmentCount: number;
  lifecycleStatus: VisaLifecycleStatus;
};

export type VisaAdjustmentLineInput = {
  lineId?: string;
  passengerType: VisaPassengerType;
  passengerName: string;
  visaType: VisaType;
  visaRateSar: number;
  paxCount: number;
  roe: number | null;
};

export type VisaCorrectionAmendmentInput = {
  adjustmentType: "CORRECTION" | "AMENDMENT";
  adjustmentDate: string;
  requestedBy: VisaAdjustmentRequestedBy;
  category: string;
  reason: string;
  reference: string;
  notes: string;
  amendmentChargePkr: number;
  creditPkr: number;
  lines: VisaAdjustmentLineInput[];
};

export type VisaCancellationInput = {
  adjustmentType: "PARTIAL_CANCELLATION" | "FULL_CANCELLATION";
  adjustmentDate: string;
  requestedBy: VisaAdjustmentRequestedBy;
  reason: string;
  reference: string;
  notes: string;
  cancellationChargePkr: number;
  cancelQuantities: Record<string, number>;
};

type VisaHeaderRow = {
  id: string;
  company_id: string;
  transaction_type: "SALE" | "PURCHASE";
  counterparty_id: string;
  transaction_date: string;
  ub_number: string;
  expected_entry_date: string;
  intercity_bus_rate_sar: number;
  notes: string;
  total_pkr: number;
  status: string;
};

type VisaLineRow = {
  id: string;
  booking_id: string;
  passenger_type: VisaPassengerType;
  passenger_name: string;
  visa_type: VisaType;
  visa_rate_sar: number;
  pax_count: number;
  roe: number;
  visa_total_sar: number;
  private_transport_allocated_sar: number;
  intercity_bus_total_sar: number;
  line_total_sar: number;
  line_total_pkr: number;
  sort_order: number;
};

type VisaFleetRow = {
  id: string;
  booking_id: string;
  vehicle_type: VisaVehicleType;
  quantity: number;
  capacity_per_vehicle: number;
  total_capacity: number;
  rate_per_vehicle_sar: number;
  line_total_sar: number;
  sort_order: number;
};

type AdjustmentInsert = {
  adjustmentType: VisaAdjustmentType;
  adjustmentDate: string;
  requestedBy: VisaAdjustmentRequestedBy;
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
  lifecycleStatus: VisaLifecycleStatus;
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

export async function initVisaAdjustmentDatabase() {
  if (initializationPromise) return initializationPromise;
  initializationPromise = (async () => {
    const database = await db();
    await execute(database, "PRAGMA busy_timeout = 5000");
    await execute(
      database,
      `CREATE TABLE IF NOT EXISTS visa_booking_adjustments (
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
      `CREATE INDEX IF NOT EXISTS idx_visa_booking_adjustments_lookup
      ON visa_booking_adjustments(company_id,booking_id,revision_no)`,
    );
    await execute(
      database,
      `CREATE INDEX IF NOT EXISTS idx_visa_booking_adjustments_date
      ON visa_booking_adjustments(company_id,adjustment_date)`,
    );
  })();
  return initializationPromise;
}

async function ready() {
  await initVisaAdjustmentDatabase();
  return db();
}

async function loadBooking(database: Database | null, companyId: string, bookingId: string) {
  if (!isDesktopApp()) {
    const { data: booking, error } = await supabase
      .from("visa_bookings")
      .select(
        "id,company_id,transaction_type,counterparty_id,transaction_date,ub_number,expected_entry_date,intercity_bus_rate_sar,notes,total_pkr,status",
      )
      .eq("company_id", companyId)
      .eq("id", bookingId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!booking || booking.status !== "ACTIVE") throw new Error("This Visa booking is not active.");
    const { data: lines, error: lineError } = await supabase
      .from("visa_booking_lines")
      .select(
        "id,booking_id,passenger_type,passenger_name,visa_type,visa_rate_sar,pax_count,roe,visa_total_sar,private_transport_allocated_sar,intercity_bus_total_sar,line_total_sar,line_total_pkr,sort_order",
      )
      .eq("booking_id", bookingId)
      .order("sort_order", { ascending: true });
    if (lineError) throw new Error(lineError.message);
    const { data: fleet, error: fleetError } = await supabase
      .from("visa_transport_fleet")
      .select(
        "id,booking_id,vehicle_type,quantity,capacity_per_vehicle,total_capacity,rate_per_vehicle_sar,line_total_sar,sort_order",
      )
      .eq("booking_id", bookingId)
      .order("sort_order", { ascending: true });
    if (fleetError) throw new Error(fleetError.message);
    return {
      booking: booking as VisaHeaderRow,
      lines: (lines || []) as VisaLineRow[],
      fleet: (fleet || []) as VisaFleetRow[],
    };
  }

  const headers = await select<VisaHeaderRow[]>(
    database!,
    `SELECT id,company_id,transaction_type,counterparty_id,transaction_date,ub_number,expected_entry_date,
            intercity_bus_rate_sar,notes,total_pkr,status
     FROM visa_bookings WHERE company_id=$1 AND id=$2 LIMIT 1`,
    [companyId, bookingId],
  );
  const booking = headers[0];
  if (!booking || booking.status !== "ACTIVE") throw new Error("This Visa booking is not active.");
  const lines = await select<VisaLineRow[]>(
    database!,
    `SELECT id,booking_id,passenger_type,passenger_name,visa_type,visa_rate_sar,pax_count,roe,visa_total_sar,
            private_transport_allocated_sar,intercity_bus_total_sar,line_total_sar,line_total_pkr,sort_order
     FROM visa_booking_lines WHERE booking_id=$1 ORDER BY sort_order ASC`,
    [bookingId],
  );
  const fleet = await select<VisaFleetRow[]>(
    database!,
    `SELECT id,booking_id,vehicle_type,quantity,capacity_per_vehicle,total_capacity,rate_per_vehicle_sar,
            line_total_sar,sort_order
     FROM visa_transport_fleet WHERE booking_id=$1 ORDER BY sort_order ASC`,
    [bookingId],
  );
  return { booking, lines, fleet };
}

function baseTotal(lines: Array<{ line_total_pkr: number }>) {
  return lines.reduce((sum, line) => sum + Number(line.line_total_pkr || 0), 0);
}

function snapshot(lines: VisaLineRow[] | ReturnType<typeof calculateVisaBooking>["calculated"], totalPkr: number) {
  return JSON.stringify({ totalPkr, lines });
}

function buildCommercialInput(
  booking: VisaHeaderRow,
  fleet: VisaFleetRow[],
  lineInputs: VisaAdjustmentLineInput[],
): VisaBookingInput {
  return {
    transactionType: booking.transaction_type,
    counterpartyId: booking.counterparty_id,
    transactionDate: booking.transaction_date,
    ubNumber: booking.ub_number,
    fleet: fleet.map((item) => ({
      vehicleType: item.vehicle_type,
      quantity: Number(item.quantity || 1),
      ratePerVehicleSar: Number(item.rate_per_vehicle_sar || 0),
    })),
    intercityBusRateSar: Number(booking.intercity_bus_rate_sar || 0),
    expectedEntryDate: booking.expected_entry_date || "",
    notes: booking.notes || "",
    lines: lineInputs.map((line) => ({
      passengerType: line.passengerType,
      passengerName: line.passengerName,
      visaType: line.visaType,
      visaRateSar: line.visaRateSar,
      paxCount: line.paxCount,
      roe: line.roe,
    })),
    passports: [],
  };
}

function recalculate(
  booking: VisaHeaderRow,
  fleet: VisaFleetRow[],
  lineInputs: VisaAdjustmentLineInput[],
  lineIds: string[],
) {
  const result = calculateVisaBooking(buildCommercialInput(booking, fleet, lineInputs));
  if (result.applicablePrivatePax > 0 && result.privateFleetCapacity < result.applicablePrivatePax) {
    throw new Error(
      `Private transport capacity is ${result.privateFleetCapacity} Pax but ${result.applicablePrivatePax} Pax require private transport. Adjust fleet before saving.`,
    );
  }
  return result.calculated.map((line, index) => ({
    ...line,
    lineId: lineIds[index]?.trim() || undefined,
  }));
}

async function latestState(database: Database | null, companyId: string, bookingId: string) {
  if (!isDesktopApp()) {
    const { data, error } = await supabase
      .from("visa_booking_adjustments")
      .select("revision_no,lifecycle_status,adjustment_type")
      .eq("company_id", companyId)
      .eq("booking_id", bookingId)
      .order("revision_no", { ascending: false })
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    const commercial = (data || []).find((row) => row.adjustment_type !== "CORRECTION");
    return {
      revisionNo: commercial ? Number(commercial.revision_no) : 1,
      lifecycleStatus: (commercial?.lifecycle_status || "ACTIVE") as VisaLifecycleStatus,
    };
  }
  const rows = await select<VisaAdjustmentRecord[]>(
    database!,
    `SELECT * FROM visa_booking_adjustments
     WHERE company_id=$1 AND booking_id=$2 ORDER BY revision_no DESC,created_at DESC`,
    [companyId, bookingId],
  );
  const commercial = rows.find((row) => row.adjustment_type !== "CORRECTION");
  return {
    revisionNo: commercial ? Number(commercial.revision_no) : 1,
    lifecycleStatus: commercial?.lifecycle_status || ("ACTIVE" as VisaLifecycleStatus),
  };
}

function nextLifecycle(current: VisaLifecycleStatus, type: VisaAdjustmentType): VisaLifecycleStatus {
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
        $4,'VISA',$5,$6,$7)`,
    params: [crypto.randomUUID(), companyId, userId, action, recordId, details, now],
  };
}

async function writeAdjustment(
  companyId: string,
  bookingId: string,
  fleet: VisaFleetRow[],
  calculated: ReturnType<typeof recalculate>,
  commercial: ReturnType<typeof calculateVisaBooking>,
  effectiveTotal: number,
  adjustment: AdjustmentInsert,
  actorUserId: string,
  auditAction: string,
  auditDetails: string,
) {
  const { enforceBookingAdjustmentCreate } = await import("./companyAccess");
  await enforceBookingAdjustmentCreate(companyId, "visa_booking_adjustments", bookingId, adjustment.adjustmentType);
  const now = new Date().toISOString();
  const adjustmentId = crypto.randomUUID();
  const lineRows = calculated.map((line) => ({
    id: line.lineId || crypto.randomUUID(),
    booking_id: bookingId,
    passenger_type: line.passengerType,
    passenger_name: line.passengerName,
    visa_type: line.visaType,
    visa_rate_sar: line.visaRateSar,
    pax_count: line.paxCount,
    roe: line.roe,
    visa_total_sar: line.visaTotalSar,
    private_transport_allocated_sar: line.privateTransportAllocatedSar,
    intercity_bus_total_sar: line.intercityBusTotalSar,
    line_total_sar: line.lineTotalSar,
    line_total_pkr: line.lineTotalPkr,
    sort_order: line.sortOrder,
  }));
  const fleetRows = commercial.fleet.map((item, index) => ({
    id: fleet[index]?.id || crypto.randomUUID(),
    booking_id: bookingId,
    vehicle_type: item.vehicleType,
    quantity: item.quantity,
    capacity_per_vehicle: item.capacityPerVehicle,
    total_capacity: item.totalCapacity,
    rate_per_vehicle_sar: item.ratePerVehicleSar,
    line_total_sar: item.lineTotalSar,
    sort_order: item.sortOrder,
  }));

  if (isDesktopApp()) {
    const statements: AtomicSqlStatement[] = [
      { sql: `DELETE FROM visa_booking_lines WHERE booking_id=$1`, params: [bookingId] },
      { sql: `DELETE FROM visa_transport_fleet WHERE booking_id=$1`, params: [bookingId] },
      ...lineRows.map((line) => ({
        sql: `INSERT INTO visa_booking_lines
      (id,booking_id,passenger_type,passenger_name,visa_type,visa_rate_sar,pax_count,roe,visa_total_sar,
       private_transport_allocated_sar,intercity_bus_total_sar,line_total_sar,line_total_pkr,sort_order)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        params: [
          line.id,
          line.booking_id,
          line.passenger_type,
          line.passenger_name,
          line.visa_type,
          line.visa_rate_sar,
          line.pax_count,
          line.roe,
          line.visa_total_sar,
          line.private_transport_allocated_sar,
          line.intercity_bus_total_sar,
          line.line_total_sar,
          line.line_total_pkr,
          line.sort_order,
        ],
      })),
      ...fleetRows.map((item) => ({
        sql: `INSERT INTO visa_transport_fleet
      (id,booking_id,vehicle_type,quantity,capacity_per_vehicle,total_capacity,rate_per_vehicle_sar,line_total_sar,sort_order)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        params: [
          item.id,
          item.booking_id,
          item.vehicle_type,
          item.quantity,
          item.capacity_per_vehicle,
          item.total_capacity,
          item.rate_per_vehicle_sar,
          item.line_total_sar,
          item.sort_order,
        ],
      })),
      {
        sql: `UPDATE visa_bookings SET private_vehicle_type=$1,private_transport_total_sar=$2,intercity_bus_rate_sar=$3,
      intercity_bus_total_sar=$4,applicable_private_pax=$5,applicable_full_bus_pax=$6,visa_total_sar=$7,
      transport_total_sar=$8,total_sar=$9,total_pkr=$10,unconverted_sar=$11,updated_at=$12,updated_by_user_id=$13
      WHERE company_id=$14 AND id=$15 AND status='ACTIVE'`,
        params: [
          commercial.privateVehicleType,
          commercial.privateTransportTotalSar,
          commercial.intercityBusRateSar,
          commercial.intercityBusTotalSar,
          commercial.applicablePrivatePax,
          commercial.applicableFullBusPax,
          commercial.visaTotalSar,
          commercial.transportTotalSar,
          commercial.totalSar,
          effectiveTotal,
          commercial.unconvertedSar,
          now,
          actorUserId,
          companyId,
          bookingId,
        ],
      },
      {
        sql: `INSERT INTO visa_booking_adjustments
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

  await syncVisaAdjustmentBundle({
    bookingId,
    companyId,
    privateVehicleType: commercial.privateVehicleType,
    privateTransportTotalSar: commercial.privateTransportTotalSar,
    intercityBusRateSar: commercial.intercityBusRateSar,
    intercityBusTotalSar: commercial.intercityBusTotalSar,
    applicablePrivatePax: commercial.applicablePrivatePax,
    applicableFullBusPax: commercial.applicableFullBusPax,
    visaTotalSar: commercial.visaTotalSar,
    transportTotalSar: commercial.transportTotalSar,
    totalSar: commercial.totalSar,
    totalPkr: effectiveTotal,
    unconvertedSar: commercial.unconvertedSar,
    updatedAt: now,
    updatedByUserId: actorUserId,
    lines: lineRows,
    fleet: fleetRows,
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

export async function saveVisaCorrectionOrAmendment(
  companyId: string,
  bookingId: string,
  input: VisaCorrectionAmendmentInput,
  actorUserId = "",
) {
  await requirePermission(companyId, actorUserId, "edit_bookings");
  if (!input.adjustmentDate) throw new Error("Adjustment Date is required.");
  if (!input.reason.trim()) throw new Error("Reason for adjustment is required.");
  const database = await ready();
  const { booking, lines: currentLines, fleet } = await loadBooking(database, companyId, bookingId);
  const state = await latestState(database, companyId, bookingId);
  if (state.lifecycleStatus === "CANCELLED")
    throw new Error("A fully cancelled booking cannot be amended. Review its History instead.");

  const lineIds = input.lines.map((line) => line.lineId || "");
  const calculated = recalculate(booking, fleet, input.lines, lineIds);
  const commercial = calculateVisaBooking(buildCommercialInput(booking, fleet, input.lines));
  const previousBase = baseTotal(currentLines);
  const revisedBase = calculated.reduce((sum, line) => sum + line.lineTotalPkr, 0);
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
    afterSnapshot: snapshot(calculated, effectiveTotal),
    cancelledLines: "",
    revisionNo,
    lifecycleStatus,
  };

  await writeAdjustment(
    companyId,
    bookingId,
    fleet,
    calculated,
    commercial,
    effectiveTotal,
    adjustment,
    actorUserId,
    `BOOKING_${input.adjustmentType}`,
    `${booking.ub_number} ${input.adjustmentType} ${delta >= 0 ? "+" : ""}${delta.toFixed(2)} PKR; effective ${effectiveTotal.toFixed(2)} PKR.`,
  );
  return { effectiveTotal, delta, revisionNo, lifecycleStatus };
}

export async function saveVisaCancellation(
  companyId: string,
  bookingId: string,
  input: VisaCancellationInput,
  actorUserId = "",
) {
  await requirePermission(companyId, actorUserId, "edit_bookings");
  if (!input.adjustmentDate) throw new Error("Cancellation Date is required.");
  if (!input.reason.trim()) throw new Error("Cancellation reason is required.");
  const database = await ready();
  const { booking, lines: currentLines, fleet } = await loadBooking(database, companyId, bookingId);
  const state = await latestState(database, companyId, bookingId);
  if (state.lifecycleStatus === "CANCELLED") throw new Error("This booking is already fully cancelled.");
  if (!currentLines.length) throw new Error("This booking has no active Visa rows to cancel.");

  const previousBase = baseTotal(currentLines);
  const carriedFinancialAdjustments = Number(booking.total_pkr || 0) - previousBase;
  const cancelled: Array<{
    lineId: string;
    passengerName: string;
    visaType: VisaType;
    qty: number;
    valuePkr: number;
  }> = [];
  const remainingInputs: VisaAdjustmentLineInput[] = [];

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
        passengerName: line.passenger_name,
        visaType: line.visa_type,
        qty: requestedQty,
        valuePkr: unitPkr * requestedQty,
      });
    }
    const remainingQty = availableQty - requestedQty;
    if (remainingQty > 0) {
      remainingInputs.push({
        lineId: line.id,
        passengerType: line.passenger_type,
        passengerName: line.passenger_name,
        visaType: line.visa_type,
        visaRateSar: Number(line.visa_rate_sar || 0),
        paxCount: remainingQty,
        roe: Number(line.roe || 0) > 0 ? Number(line.roe) : null,
      });
    }
  }

  if (!cancelled.length) throw new Error("Select at least one Visa row / quantity to cancel.");
  if (input.adjustmentType === "PARTIAL_CANCELLATION" && !remainingInputs.length) {
    throw new Error("All Visa rows are selected. Use Full Cancellation instead.");
  }

  const lineIds = remainingInputs.map((line) => line.lineId || "");
  const calculated = remainingInputs.length ? recalculate(booking, fleet, remainingInputs, lineIds) : [];
  const emptyCommercial: ReturnType<typeof calculateVisaBooking> = {
    calculated: [],
    fleet: [],
    passports: [],
    privateVehicleType: "CAR",
    privateTransportTotalSar: 0,
    privateFleetCapacity: 0,
    intercityBusRateSar: Number(booking.intercity_bus_rate_sar || 0),
    intercityBusTotalSar: 0,
    applicablePrivatePax: 0,
    applicableFullBusPax: 0,
    visaTotalSar: 0,
    transportTotalSar: 0,
    totalSar: 0,
    totalPkr: 0,
    unconvertedSar: 0,
  };
  const commercial = remainingInputs.length
    ? calculateVisaBooking(buildCommercialInput(booking, fleet, remainingInputs))
    : emptyCommercial;

  const cancelledValue = cancelled.reduce((sum, item) => sum + item.valuePkr, 0);
  const charge = Math.max(0, Number(input.cancellationChargePkr) || 0);
  if (charge > cancelledValue)
    throw new Error("Cancellation charge cannot be greater than the cancelled commercial value.");
  const revisedBase = calculated.reduce((sum, line) => sum + line.lineTotalPkr, 0);
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
    afterSnapshot: snapshot(calculated, effectiveTotal),
    cancelledLines: JSON.stringify(cancelled),
    revisionNo,
    lifecycleStatus,
  };

  await writeAdjustment(
    companyId,
    bookingId,
    fleet,
    calculated,
    commercial,
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

export async function getVisaAdjustmentHistory(companyId: string, bookingId: string) {
  if (!isDesktopApp()) {
    const { data, error } = await supabase
      .from("visa_booking_adjustments")
      .select(
        "id,company_id,booking_id,adjustment_type,adjustment_date,requested_by,category,reason,reference,notes,previous_total_pkr,previous_base_pkr,revised_base_pkr,charge_pkr,credit_pkr,account_delta_pkr,effective_total_pkr,before_snapshot_json,after_snapshot_json,cancelled_lines_json,revision_no,lifecycle_status,created_by_user_id,created_at",
      )
      .eq("company_id", companyId)
      .eq("booking_id", bookingId)
      .order("revision_no", { ascending: true })
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return (data || []) as VisaAdjustmentRecord[];
  }
  const database = await ready();
  return select<VisaAdjustmentRecord[]>(
    database,
    `SELECT id,company_id,booking_id,adjustment_type,adjustment_date,requested_by,category,reason,reference,notes,
            previous_total_pkr,previous_base_pkr,revised_base_pkr,charge_pkr,credit_pkr,account_delta_pkr,effective_total_pkr,
            before_snapshot_json,after_snapshot_json,cancelled_lines_json,revision_no,lifecycle_status,created_by_user_id,created_at
     FROM visa_booking_adjustments
     WHERE company_id=$1 AND booking_id=$2
     ORDER BY revision_no ASC,created_at ASC`,
    [companyId, bookingId],
  );
}

export async function getVisaAdjustmentSummaryMap(companyId: string) {
  if (!isDesktopApp()) {
    const { data, error } = await supabase
      .from("visa_booking_adjustments")
      .select("booking_id,revision_no,lifecycle_status,adjustment_type")
      .eq("company_id", companyId)
      .order("booking_id", { ascending: true })
      .order("revision_no", { ascending: true });
    if (error) throw new Error(error.message);
    const result: Record<string, VisaAdjustmentSummary> = {};
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
  const rows = await select<VisaAdjustmentRecord[]>(
    database,
    `SELECT id,company_id,booking_id,adjustment_type,adjustment_date,requested_by,category,reason,reference,notes,
            previous_total_pkr,previous_base_pkr,revised_base_pkr,charge_pkr,credit_pkr,account_delta_pkr,effective_total_pkr,
            before_snapshot_json,after_snapshot_json,cancelled_lines_json,revision_no,lifecycle_status,created_by_user_id,created_at
     FROM visa_booking_adjustments
     WHERE company_id=$1 ORDER BY booking_id ASC,revision_no ASC,created_at ASC`,
    [companyId],
  );
  const result: Record<string, VisaAdjustmentSummary> = {};
  for (const row of rows) {
    const existing = result[row.booking_id];
    const isCorrection = row.adjustment_type === "CORRECTION";
    result[row.booking_id] = {
      bookingId: row.booking_id,
      revisionNo: isCorrection ? existing?.revisionNo || 1 : Number(row.revision_no || 1),
      adjustmentCount: (existing?.adjustmentCount || 0) + 1,
      lifecycleStatus: isCorrection
        ? existing?.lifecycleStatus || ("ACTIVE" as VisaLifecycleStatus)
        : row.lifecycle_status,
    };
  }
  return result;
}
