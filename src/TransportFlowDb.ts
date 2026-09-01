import Database from "@tauri-apps/plugin-sql";
import type {
  BookingTransactionType,
  TransportBooking,
  TransportBookingInput,
  TransportBookingLine,
  TransportBookingLineInput,
  TransportType,
  TransportVehicleType,
} from "./db";
import { createAuditLog, requirePermission } from "./db";
import {
  flushDesktopSyncQueue,
  isDesktopApp,
  syncTransportBookingBundle,
  syncTransportBookingVoid,
  type TransportBookingSyncHeader,
  type TransportBookingSyncLine,
} from "./cloudSync";
import { fetchCounterpartyNameMap, validateBookingCounterparty } from "./CounterpartyDb";
import { applyBookingListScope, bookingListScopeSql, type BookingListScope } from "./bookingListScope";
import { supabase } from "./supabaseClient";

const DB_PATH = "sqlite:travel-accounting.db";
let databasePromise: Promise<Database> | null = null;

async function db() {
  if (!databasePromise) {
    if (isDesktopApp()) {
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

function normalizeTransportUb(value: string) {
  return value.trim().replace(/\s+/g, " ").toUpperCase();
}

export function calculateTransportLines(lines: TransportBookingLineInput[]) {
  const allowedTypes: TransportType[] = ["SHARING_BUS", "PRIVATE_VEHICLE"];
  const privateVehicles: TransportVehicleType[] = [
    "CAR",
    "GMC_YUKON",
    "STARIA",
    "STAREX",
    "HIACE",
    "COASTER",
    "BUS",
    "OTHER",
  ];
  const calculated: Array<{
    transportDate: string;
    transportType: TransportType;
    fromLocation: string;
    toLocation: string;
    vehicleType: TransportVehicleType;
    customVehicleName: string;
    vehicleCount: number;
    rateSar: number;
    paxCount: number;
    roe: number;
    lineTotalSar: number;
    lineTotalPkr: number;
    sortOrder: number;
  }> = [];

  lines.forEach((line, index) => {
    const rowNo = index + 1;
    const transportDate = line.transportDate.trim();
    const fromLocation = line.fromLocation.trim();
    const toLocation = line.toLocation.trim();
    const rateSar = Number(line.rateSar);
    const paxCount = Math.trunc(Number(line.paxCount));
    const roe = line.roe == null ? 0 : Number(line.roe);

    if (!transportDate) throw new Error(`Transport row ${rowNo}: Transport Date is required.`);
    if (!allowedTypes.includes(line.transportType))
      throw new Error(`Transport row ${rowNo}: select Sharing Bus or Private Vehicle.`);
    if (!fromLocation) throw new Error(`Transport row ${rowNo}: From route is required.`);
    if (!toLocation) throw new Error(`Transport row ${rowNo}: To route is required.`);
    if (fromLocation.toLowerCase() === toLocation.toLowerCase())
      throw new Error(`Transport row ${rowNo}: From and To cannot be the same.`);
    if (!Number.isFinite(rateSar) || rateSar <= 0) throw new Error(`Transport row ${rowNo}: enter a valid SAR rate.`);
    if (!Number.isFinite(paxCount) || paxCount < 1 || paxCount > 999)
      throw new Error(`Transport row ${rowNo}: No. of Pax must be between 1 and 999.`);
    if (!Number.isFinite(roe) || roe < 0)
      throw new Error(`Transport row ${rowNo}: enter a valid ROE or leave it blank.`);

    let vehicleType: TransportVehicleType = "SHARING_BUS";
    let customVehicleName = "";
    let vehicleCount = 0;
    let lineTotalSar = rateSar * paxCount;

    if (line.transportType === "PRIVATE_VEHICLE") {
      if (!privateVehicles.includes(line.vehicleType))
        throw new Error(`Transport row ${rowNo}: select a Private Vehicle type.`);
      vehicleType = line.vehicleType;
      customVehicleName = line.customVehicleName.trim();
      if (vehicleType === "OTHER" && !customVehicleName)
        throw new Error(`Transport row ${rowNo}: enter the Custom Vehicle name.`);
      vehicleCount = Math.trunc(Number(line.vehicleCount));
      if (!Number.isFinite(vehicleCount) || vehicleCount < 1 || vehicleCount > 99)
        throw new Error(`Transport row ${rowNo}: No. of Vehicles must be between 1 and 99.`);
      lineTotalSar = rateSar * vehicleCount;
    }

    const lineTotalPkr = roe > 0 ? lineTotalSar * roe : 0;
    calculated.push({
      transportDate,
      transportType: line.transportType,
      fromLocation,
      toLocation,
      vehicleType,
      customVehicleName,
      vehicleCount,
      rateSar,
      paxCount,
      roe,
      lineTotalSar,
      lineTotalPkr,
      sortOrder: index,
    });
  });

  if (!calculated.length) throw new Error("Add at least one Transport row.");
  const totalSar = calculated.reduce((sum, line) => sum + line.lineTotalSar, 0);
  const totalPkr = calculated.reduce((sum, line) => sum + line.lineTotalPkr, 0);
  const unconvertedSar = calculated.filter((line) => line.roe <= 0).reduce((sum, line) => sum + line.lineTotalSar, 0);
  return { calculated, totalSar, totalPkr, unconvertedSar };
}

async function validateUniqueTransportUb(
  companyId: string,
  transactionType: BookingTransactionType,
  counterpartyId: string,
  ubNumber: string,
  editingBookingId = "",
) {
  const normalized = normalizeTransportUb(ubNumber);
  let rows: Array<{
    id: string;
    transaction_type: BookingTransactionType;
    counterparty_id: string;
    ub_number: string;
  }> = [];

  if (isDesktopApp()) {
    const database = await db();
    rows = await database.select(
      `SELECT id,transaction_type,counterparty_id,ub_number FROM transport_bookings WHERE company_id=$1`,
      [companyId],
    );
  } else {
    const { data, error } = await supabase
      .from("transport_bookings")
      .select("id,transaction_type,counterparty_id,ub_number")
      .eq("company_id", companyId);
    if (error) throw new Error(error.message);
    rows = (data || []) as typeof rows;
  }

  const duplicate = rows.find((row) => {
    if (row.id === editingBookingId || normalizeTransportUb(row.ub_number) !== normalized) return false;
    if (transactionType === "SALE") return row.transaction_type === "SALE";
    return row.transaction_type === "PURCHASE" && row.counterparty_id === counterpartyId;
  });
  if (duplicate) {
    if (transactionType === "SALE")
      throw new Error(
        `UB # / Booking "${ubNumber.trim()}" already has a Transport Sale booking. Edit the existing Transport booking or use another UB #.`,
      );
    throw new Error(
      `This Vendor already has a Transport Purchase booking for UB # "${ubNumber.trim()}". Edit that booking or select another Vendor.`,
    );
  }
}

async function validateTransportBooking(companyId: string, input: TransportBookingInput, editingBookingId = "") {
  if (!["SALE", "PURCHASE"].includes(input.transactionType)) throw new Error("Select Sale or Purchase first.");
  if (!input.transactionDate) throw new Error("Date of Booking is required.");
  if (!input.ubNumber.trim()) throw new Error("UB # / Booking is required.");
  await validateBookingCounterparty(companyId, input.transactionType, input.counterpartyId);
  await validateUniqueTransportUb(
    companyId,
    input.transactionType,
    input.counterpartyId,
    input.ubNumber,
    editingBookingId,
  );
  return calculateTransportLines(input.lines);
}

async function fetchChildRowsByBookingIds(table: string, bookingIds: string[]) {
  if (!bookingIds.length) return [] as Record<string, unknown>[];
  const { data, error } = await supabase.from(table).select("*").in("booking_id", bookingIds);
  if (error) throw new Error(error.message);
  return (data || []) as Record<string, unknown>[];
}

function groupRowsByBookingId(rows: Record<string, unknown>[]) {
  const grouped = new Map<string, Record<string, unknown>[]>();
  for (const row of rows) {
    const bookingId = String(row.booking_id || "");
    const current = grouped.get(bookingId) || [];
    current.push(row);
    grouped.set(bookingId, current);
  }
  return grouped;
}

function buildLineRows(bookingId: string, calculated: ReturnType<typeof calculateTransportLines>["calculated"]) {
  return calculated.map<TransportBookingSyncLine>((line) => ({
    id: crypto.randomUUID(),
    booking_id: bookingId,
    transport_date: line.transportDate,
    transport_type: line.transportType,
    from_location: line.fromLocation,
    to_location: line.toLocation,
    vehicle_type: line.vehicleType,
    custom_vehicle_name: line.customVehicleName,
    vehicle_count: line.vehicleCount,
    rate_sar: line.rateSar,
    pax_count: line.paxCount,
    roe: line.roe,
    line_total_sar: line.lineTotalSar,
    line_total_pkr: line.lineTotalPkr,
    sort_order: line.sortOrder,
  }));
}

function buildHeader(
  bookingId: string,
  companyId: string,
  input: TransportBookingInput,
  totals: ReturnType<typeof calculateTransportLines>,
  now: string,
  actorUserId: string,
  createdAt?: string,
  createdByUserId?: string,
): TransportBookingSyncHeader {
  return {
    id: bookingId,
    company_id: companyId,
    transaction_type: input.transactionType,
    counterparty_id: input.counterpartyId,
    transaction_date: input.transactionDate,
    ub_number: input.ubNumber.trim(),
    pax_saudi_number: input.paxSaudiNumber.trim(),
    notes: input.notes.trim(),
    total_sar: totals.totalSar,
    total_pkr: totals.totalPkr,
    unconverted_sar: totals.unconvertedSar,
    status: "ACTIVE",
    created_at: createdAt || now,
    updated_at: now,
    created_by_user_id: createdByUserId || actorUserId,
    updated_by_user_id: actorUserId,
  };
}

async function insertTransportLinesLocal(database: Database, bookingId: string, lineRows: TransportBookingSyncLine[]) {
  for (const line of lineRows) {
    await database.execute(
      `INSERT INTO transport_booking_lines
       (id,booking_id,transport_date,transport_type,from_location,to_location,vehicle_type,custom_vehicle_name,
        vehicle_count,rate_sar,pax_count,roe,line_total_sar,line_total_pkr,sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [
        line.id,
        bookingId,
        line.transport_date,
        line.transport_type,
        line.from_location,
        line.to_location,
        line.vehicle_type,
        line.custom_vehicle_name,
        line.vehicle_count,
        line.rate_sar,
        line.pax_count,
        line.roe,
        line.line_total_sar,
        line.line_total_pkr,
        line.sort_order,
      ],
    );
  }
}

export async function getTransportBookings(companyId: string, search = "", scope?: BookingListScope) {
  if (!isDesktopApp()) {
    let query = applyBookingListScope(
      supabase
        .from("transport_bookings")
        .select("*")
        .eq("company_id", companyId)
        .order("transaction_date", { ascending: false })
        .order("created_at", { ascending: false }),
      scope,
    );

    if (search.trim()) {
      const term = `%${search.trim()}%`;
      query = query.or(`ub_number.ilike.${term}`);
    }

    const { data, error } = await query;
    if (error) throw new Error(error.message);
    if (!data) return [];

    const partyNames = scope?.counterpartyId ? new Map<string, string>() : await fetchCounterpartyNameMap(companyId);
    const lines = await fetchChildRowsByBookingIds(
      "transport_booking_lines",
      data.map((row) => String(row.id)),
    );
    const linesByBooking = groupRowsByBookingId(lines);

    return data.map((b) => ({
      ...b,
      counterparty_name: partyNames.get(String(b.counterparty_id)) || "",
      lines: (linesByBooking.get(String(b.id)) || []) as TransportBookingLine[],
    })) as TransportBooking[];
  }

  const database = await db();
  const clean = search.trim();
  const term = `%${clean}%`;
  const scopeFilter = bookingListScopeSql(scope, 3);
  const headers = await database.select<Omit<TransportBooking, "lines">[]>(
    `SELECT b.id,b.company_id,b.transaction_type,b.counterparty_id,COALESCE(p.name,'') AS counterparty_name,
            b.transaction_date,b.ub_number,b.pax_saudi_number,b.notes,b.total_sar,b.total_pkr,b.unconverted_sar,
            b.status,b.created_at,b.updated_at
     FROM transport_bookings b
     LEFT JOIN parties p ON p.id=b.counterparty_id AND p.company_id=b.company_id
     WHERE b.company_id=$1
       AND ($2='' OR b.ub_number LIKE $3 COLLATE NOCASE OR b.pax_saudi_number LIKE $3 COLLATE NOCASE OR
            b.notes LIKE $3 COLLATE NOCASE OR COALESCE(p.name,'') LIKE $3 COLLATE NOCASE OR
            EXISTS (SELECT 1 FROM transport_booking_lines l WHERE l.booking_id=b.id AND
              (l.from_location LIKE $3 COLLATE NOCASE OR l.to_location LIKE $3 COLLATE NOCASE OR
               l.transport_type LIKE $3 COLLATE NOCASE OR l.vehicle_type LIKE $3 COLLATE NOCASE OR
               l.custom_vehicle_name LIKE $3 COLLATE NOCASE)))
       ${scopeFilter.sql}
     ORDER BY b.transaction_date DESC,b.created_at DESC`,
    [companyId, clean, term, ...scopeFilter.params],
  );
  const lines = await database.select<TransportBookingLine[]>(
    `SELECT l.id,l.booking_id,l.transport_date,l.transport_type,l.from_location,l.to_location,l.vehicle_type,
            l.custom_vehicle_name,l.vehicle_count,l.rate_sar,l.pax_count,l.roe,l.line_total_sar,l.line_total_pkr,l.sort_order
     FROM transport_booking_lines l
     INNER JOIN transport_bookings b ON b.id=l.booking_id
     WHERE b.company_id=$1 ORDER BY l.sort_order ASC`,
    [companyId],
  );
  const grouped = new Map<string, TransportBookingLine[]>();
  for (const line of lines) {
    const current = grouped.get(line.booking_id) || [];
    current.push(line);
    grouped.set(line.booking_id, current);
  }
  return headers.map((header) => ({ ...header, lines: grouped.get(header.id) || [] })) as TransportBooking[];
}

export async function createTransportBooking(companyId: string, input: TransportBookingInput, actorUserId = "") {
  await requirePermission(companyId, actorUserId, "create_bookings");
  const result = await validateTransportBooking(companyId, input);
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const lineRows = buildLineRows(id, result.calculated);
  const header = buildHeader(id, companyId, input, result, now, actorUserId);

  if (isDesktopApp()) {
    const database = await db();
    await database.execute(
      `INSERT INTO transport_bookings
       (id,company_id,transaction_type,counterparty_id,transaction_date,ub_number,pax_saudi_number,notes,
        total_sar,total_pkr,unconverted_sar,status,created_at,updated_at,created_by_user_id,updated_by_user_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'ACTIVE',$12,$12,$13,$13)`,
      [
        id,
        companyId,
        input.transactionType,
        input.counterpartyId,
        input.transactionDate,
        input.ubNumber.trim(),
        input.paxSaudiNumber.trim(),
        input.notes.trim(),
        result.totalSar,
        result.totalPkr,
        result.unconvertedSar,
        now,
        actorUserId,
      ],
    );
    await insertTransportLinesLocal(database, id, lineRows);
  }

  await syncTransportBookingBundle(header, lineRows);
  if (isDesktopApp()) await flushDesktopSyncQueue();

  if (actorUserId)
    await createAuditLog(
      companyId,
      actorUserId,
      "BOOKING_CREATED",
      "TRANSPORT",
      id,
      `${input.transactionType} ${input.ubNumber.trim()} - SAR ${result.totalSar} / PKR ${result.totalPkr}`,
    );
  return id;
}

export async function updateTransportBooking(
  companyId: string,
  bookingId: string,
  input: TransportBookingInput,
  actorUserId = "",
) {
  await requirePermission(companyId, actorUserId, "edit_bookings");
  const result = await validateTransportBooking(companyId, input, bookingId);
  const now = new Date().toISOString();
  const lineRows = buildLineRows(bookingId, result.calculated);

  let current: { created_at: string; created_by_user_id: string };

  if (isDesktopApp()) {
    const database = await db();
    const rows = await database.select<Array<{ created_at: string; created_by_user_id: string }>>(
      `SELECT created_at,created_by_user_id FROM transport_bookings WHERE id=$1 AND company_id=$2 AND status='ACTIVE' LIMIT 1`,
      [bookingId, companyId],
    );
    const row = rows[0];
    if (!row) throw new Error("This Transport booking is no longer active.");
    current = row;

    await database.execute(
      `UPDATE transport_bookings SET transaction_type=$1,counterparty_id=$2,transaction_date=$3,ub_number=$4,
       pax_saudi_number=$5,notes=$6,total_sar=$7,total_pkr=$8,unconverted_sar=$9,updated_at=$10,updated_by_user_id=$11
     WHERE id=$12 AND company_id=$13 AND status='ACTIVE'`,
      [
        input.transactionType,
        input.counterpartyId,
        input.transactionDate,
        input.ubNumber.trim(),
        input.paxSaudiNumber.trim(),
        input.notes.trim(),
        result.totalSar,
        result.totalPkr,
        result.unconvertedSar,
        now,
        actorUserId,
        bookingId,
        companyId,
      ],
    );
    await database.execute(`DELETE FROM transport_booking_lines WHERE booking_id=$1`, [bookingId]);
    await insertTransportLinesLocal(database, bookingId, lineRows);
  } else {
    const { data, error } = await supabase
      .from("transport_bookings")
      .select("created_at,created_by_user_id")
      .eq("id", bookingId)
      .eq("company_id", companyId)
      .eq("status", "ACTIVE")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new Error("This Transport booking is no longer active.");
    current = data;
  }

  const header = buildHeader(
    bookingId,
    companyId,
    input,
    result,
    now,
    actorUserId,
    current.created_at,
    current.created_by_user_id || actorUserId,
  );

  await syncTransportBookingBundle(header, lineRows);
  if (isDesktopApp()) await flushDesktopSyncQueue();

  if (actorUserId)
    await createAuditLog(
      companyId,
      actorUserId,
      "BOOKING_UPDATED",
      "TRANSPORT",
      bookingId,
      `${input.transactionType} ${input.ubNumber.trim()} - SAR ${result.totalSar} / PKR ${result.totalPkr}`,
    );
}

export async function voidTransportBooking(companyId: string, bookingId: string, actorUserId = "") {
  await requirePermission(companyId, actorUserId, "void_bookings");
  const now = new Date().toISOString();
  let ubNumber: string;

  if (isDesktopApp()) {
    const database = await db();
    const rows = await database.select<Array<{ ub_number: string }>>(
      `SELECT ub_number FROM transport_bookings WHERE id=$1 AND company_id=$2 LIMIT 1`,
      [bookingId, companyId],
    );
    ubNumber = rows[0]?.ub_number || bookingId;
    await database.execute(
      `UPDATE transport_bookings SET status='VOID',updated_at=$1,updated_by_user_id=$2 WHERE id=$3 AND company_id=$4 AND status='ACTIVE'`,
      [now, actorUserId, bookingId, companyId],
    );
  } else {
    const { data, error } = await supabase
      .from("transport_bookings")
      .select("ub_number")
      .eq("id", bookingId)
      .eq("company_id", companyId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    ubNumber = data?.ub_number || bookingId;
  }

  await syncTransportBookingVoid(bookingId, now, actorUserId);
  if (isDesktopApp()) await flushDesktopSyncQueue();

  if (actorUserId)
    await createAuditLog(
      companyId,
      actorUserId,
      "BOOKING_VOIDED",
      "TRANSPORT",
      bookingId,
      `Transport booking ${ubNumber} voided.`,
    );
}
