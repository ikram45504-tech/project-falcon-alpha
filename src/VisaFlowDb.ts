import Database from "@tauri-apps/plugin-sql";
import type {
  BookingTransactionType,
  VisaBooking,
  VisaBookingInput,
  VisaBookingLine,
  VisaPassengerType,
  VisaPassportDetail,
  VisaTransportFleetLine,
  VisaType,
  VisaVehicleType,
} from "./db";
import { createAuditLog, requirePermission } from "./db";
import {
  flushDesktopSyncQueue,
  isDesktopApp,
  syncVisaBookingBundle,
  syncVisaBookingVoid,
  type VisaBookingSyncHeader,
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

function normalizeVisaUb(value: string) {
  return value.trim().replace(/\s+/g, " ").toUpperCase();
}

function visaNeedsPrivateTransport(visaType: VisaType) {
  return visaType === "UMRAH_VISA_ONE_WAY_TRANSPORT" || visaType === "UMRAH_VISA_FULL_TRANSPORT";
}

function visaNeedsFullBus(visaType: VisaType) {
  return visaType === "UMRAH_VISA_FULL_TRANSPORT";
}

function visaVehicleCapacity(vehicle: VisaVehicleType) {
  if (vehicle === "CAR") return 3;
  if (vehicle === "STARIA") return 6;
  if (vehicle === "HIACE") return 10;
  if (vehicle === "COASTER") return 16;
  return 47;
}

export function calculateVisaBooking(input: VisaBookingInput) {
  const allowedPassengerTypes: VisaPassengerType[] = ["ADULT", "CHILD", "INFANT"];
  const allowedVisaTypes: VisaType[] = [
    "ONLY_UMRAH_VISA",
    "UMRAH_VISA_TRANSPORT",
    "UMRAH_VISA_ONE_WAY_TRANSPORT",
    "UMRAH_VISA_FULL_TRANSPORT",
  ];
  const allowedVehicles: VisaVehicleType[] = ["CAR", "STARIA", "HIACE", "COASTER", "BUS"];

  const baseRows = input.lines.map((line, index) => {
    const rowNo = index + 1;
    if (!allowedPassengerTypes.includes(line.passengerType))
      throw new Error(`Visa row ${rowNo}: select Adult, Child or Infant.`);
    if (!allowedVisaTypes.includes(line.visaType)) throw new Error(`Visa row ${rowNo}: select a Visa Type.`);
    const passengerName = line.passengerName.trim();
    if (!passengerName) throw new Error(`Visa row ${rowNo}: Passenger / Family Head Name is required.`);
    const visaRateSar = Number(line.visaRateSar);
    if (!Number.isFinite(visaRateSar) || visaRateSar < 0)
      throw new Error(`Visa row ${rowNo}: enter a valid Visa Rate (SAR).`);
    const paxCount = Math.trunc(Number(line.paxCount));
    if (!Number.isFinite(paxCount) || paxCount < 1 || paxCount > 999)
      throw new Error(`Visa row ${rowNo}: No. of Pax must be between 1 and 999.`);
    const roe = line.roe == null ? 0 : Number(line.roe);
    if (!Number.isFinite(roe) || roe < 0) throw new Error(`Visa row ${rowNo}: enter a valid ROE or leave it blank.`);
    return {
      passengerType: line.passengerType,
      passengerName,
      visaType: line.visaType,
      visaRateSar,
      paxCount,
      roe,
      visaTotalSar: visaRateSar * paxCount,
      sortOrder: index,
    };
  });

  if (!baseRows.length) throw new Error("Add at least one Visa row.");

  const applicablePrivatePax = baseRows
    .filter((row) => visaNeedsPrivateTransport(row.visaType))
    .reduce((sum, row) => sum + row.paxCount, 0);
  const applicableFullBusPax = baseRows
    .filter((row) => visaNeedsFullBus(row.visaType))
    .reduce((sum, row) => sum + row.paxCount, 0);

  const fleet =
    applicablePrivatePax > 0
      ? input.fleet.map((item, index) => {
          if (!allowedVehicles.includes(item.vehicleType))
            throw new Error(`Transport fleet row ${index + 1}: select a valid vehicle.`);
          const quantity = Math.trunc(Number(item.quantity));
          if (!Number.isFinite(quantity) || quantity < 1 || quantity > 99)
            throw new Error(`Transport fleet row ${index + 1}: Qty must be between 1 and 99.`);
          const ratePerVehicleSar = Number(item.ratePerVehicleSar || 0);
          if (!Number.isFinite(ratePerVehicleSar) || ratePerVehicleSar < 0)
            throw new Error(`Transport fleet row ${index + 1}: enter a valid SAR rate.`);
          const capacityPerVehicle = visaVehicleCapacity(item.vehicleType);
          return {
            vehicleType: item.vehicleType,
            quantity,
            capacityPerVehicle,
            totalCapacity: capacityPerVehicle * quantity,
            ratePerVehicleSar,
            lineTotalSar: ratePerVehicleSar * quantity,
            sortOrder: index,
          };
        })
      : [];

  const privateTransportTotalSar = fleet.reduce((sum, item) => sum + item.lineTotalSar, 0);
  const privateFleetCapacity = fleet.reduce((sum, item) => sum + item.totalCapacity, 0);
  const privateVehicleType: VisaVehicleType | "" = fleet[0]?.vehicleType || "";

  const intercityBusRateSar = applicableFullBusPax > 0 ? Number(input.intercityBusRateSar || 0) : 0;
  if (!Number.isFinite(intercityBusRateSar) || intercityBusRateSar < 0)
    throw new Error("Enter a valid Inter-City Bus SAR / Pax rate.");

  const privatePerPax = applicablePrivatePax > 0 ? privateTransportTotalSar / applicablePrivatePax : 0;
  const intercityBusTotalSar = intercityBusRateSar * applicableFullBusPax;

  const calculated = baseRows.map((row) => {
    const privateTransportAllocatedSar = visaNeedsPrivateTransport(row.visaType) ? privatePerPax * row.paxCount : 0;
    const rowBusSar = visaNeedsFullBus(row.visaType) ? intercityBusRateSar * row.paxCount : 0;
    const lineTotalSar = row.visaTotalSar + privateTransportAllocatedSar + rowBusSar;
    const lineTotalPkr = row.roe > 0 ? lineTotalSar * row.roe : 0;
    return {
      ...row,
      privateTransportAllocatedSar,
      intercityBusTotalSar: rowBusSar,
      lineTotalSar,
      lineTotalPkr,
    };
  });

  const passports = input.passports.map((item, index) => {
    if (!allowedPassengerTypes.includes(item.passengerType))
      throw new Error(`Passenger row ${index + 1}: invalid passenger type.`);
    if (!allowedVisaTypes.includes(item.visaType)) throw new Error(`Passenger row ${index + 1}: invalid Visa Type.`);
    const surname = item.surname.trim();
    const givenName = item.givenName.trim();
    return {
      sourceFamilyName: item.sourceFamilyName.trim(),
      passengerName: `${surname} ${givenName}`.trim(),
      passengerType: item.passengerType,
      visaType: item.visaType,
      surname,
      givenName,
      passportNumber: item.passportNumber.trim(),
      nationality: item.nationality.trim(),
      dateOfBirth: item.dateOfBirth.trim(),
      passportIssuance: item.passportIssuance.trim(),
      passportExpiry: item.passportExpiry.trim(),
      sortOrder: index,
    };
  });

  const visaTotalSar = calculated.reduce((sum, row) => sum + row.visaTotalSar, 0);
  const transportTotalSar = privateTransportTotalSar + intercityBusTotalSar;
  const totalSar = visaTotalSar + transportTotalSar;
  const totalPkr = calculated.reduce((sum, row) => sum + row.lineTotalPkr, 0);
  const unconvertedSar = calculated.filter((row) => row.roe <= 0).reduce((sum, row) => sum + row.lineTotalSar, 0);

  return {
    calculated,
    fleet,
    passports,
    privateVehicleType,
    privateTransportTotalSar,
    privateFleetCapacity,
    intercityBusRateSar,
    intercityBusTotalSar,
    applicablePrivatePax,
    applicableFullBusPax,
    visaTotalSar,
    transportTotalSar,
    totalSar,
    totalPkr,
    unconvertedSar,
  };
}

async function validateUniqueVisaUb(
  companyId: string,
  transactionType: BookingTransactionType,
  counterpartyId: string,
  ubNumber: string,
  editingBookingId = "",
) {
  const normalized = normalizeVisaUb(ubNumber);
  let rows: Array<{
    id: string;
    transaction_type: BookingTransactionType;
    counterparty_id: string;
    ub_number: string;
  }> = [];

  if (isDesktopApp()) {
    const database = await db();
    rows = await database.select(
      `SELECT id,transaction_type,counterparty_id,ub_number FROM visa_bookings WHERE company_id=$1`,
      [companyId],
    );
  } else {
    const { data, error } = await supabase
      .from("visa_bookings")
      .select("id,transaction_type,counterparty_id,ub_number")
      .eq("company_id", companyId);
    if (error) throw new Error(error.message);
    rows = (data || []) as typeof rows;
  }

  const duplicate = rows.find((row) => {
    if (row.id === editingBookingId || normalizeVisaUb(row.ub_number) !== normalized) return false;
    if (transactionType === "SALE") return row.transaction_type === "SALE";
    return row.transaction_type === "PURCHASE" && row.counterparty_id === counterpartyId;
  });

  if (duplicate) {
    if (transactionType === "SALE")
      throw new Error(
        `UB # / Booking "${ubNumber.trim()}" already has a Visa Sale booking. Edit the existing Visa booking or use another UB #.`,
      );
    throw new Error(
      `This Vendor already has a Visa Purchase booking for UB # "${ubNumber.trim()}". Edit that booking or select another Vendor.`,
    );
  }
}

async function validateVisaBooking(companyId: string, input: VisaBookingInput, editingBookingId = "") {
  if (!["SALE", "PURCHASE"].includes(input.transactionType)) throw new Error("Select Sale or Purchase first.");
  if (!input.transactionDate) throw new Error("Date of Booking is required.");
  if (!input.ubNumber.trim()) throw new Error("UB # / Booking is required.");
  await validateBookingCounterparty(companyId, input.transactionType, input.counterpartyId);
  await validateUniqueVisaUb(companyId, input.transactionType, input.counterpartyId, input.ubNumber, editingBookingId);
  return calculateVisaBooking(input);
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

function buildVisaChildRows(bookingId: string, result: ReturnType<typeof calculateVisaBooking>) {
  const lines = result.calculated.map((line) => ({
    id: crypto.randomUUID(),
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
  const fleet = result.fleet.map((item) => ({
    id: crypto.randomUUID(),
    booking_id: bookingId,
    vehicle_type: item.vehicleType,
    quantity: item.quantity,
    capacity_per_vehicle: item.capacityPerVehicle,
    total_capacity: item.totalCapacity,
    rate_per_vehicle_sar: item.ratePerVehicleSar,
    line_total_sar: item.lineTotalSar,
    sort_order: item.sortOrder,
  }));
  const passports = result.passports.map((item) => ({
    id: crypto.randomUUID(),
    booking_id: bookingId,
    source_family_name: item.sourceFamilyName,
    passenger_name: item.passengerName,
    passenger_type: item.passengerType,
    visa_type: item.visaType,
    surname: item.surname,
    given_name: item.givenName,
    passport_number: item.passportNumber,
    nationality: item.nationality,
    date_of_birth: item.dateOfBirth,
    passport_issuance: item.passportIssuance,
    passport_expiry: item.passportExpiry,
    sort_order: item.sortOrder,
  }));
  return { lines, fleet, passports };
}

async function insertVisaChildrenLocal(
  database: Database,
  bookingId: string,
  children: ReturnType<typeof buildVisaChildRows>,
) {
  for (const line of children.lines) {
    await database.execute(
      `INSERT INTO visa_booking_lines
       (id,booking_id,passenger_type,passenger_name,visa_type,visa_rate_sar,pax_count,roe,visa_total_sar,
        private_transport_allocated_sar,intercity_bus_total_sar,line_total_sar,line_total_pkr,sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [
        line.id,
        bookingId,
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
    );
  }
  for (const item of children.fleet) {
    await database.execute(
      `INSERT INTO visa_transport_fleet
       (id,booking_id,vehicle_type,quantity,capacity_per_vehicle,total_capacity,rate_per_vehicle_sar,line_total_sar,sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        item.id,
        bookingId,
        item.vehicle_type,
        item.quantity,
        item.capacity_per_vehicle,
        item.total_capacity,
        item.rate_per_vehicle_sar,
        item.line_total_sar,
        item.sort_order,
      ],
    );
  }
  for (const item of children.passports) {
    await database.execute(
      `INSERT INTO visa_passport_details
       (id,booking_id,source_family_name,passenger_name,passenger_type,visa_type,surname,given_name,passport_number,nationality,date_of_birth,passport_issuance,passport_expiry,sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [
        item.id,
        bookingId,
        item.source_family_name,
        item.passenger_name,
        item.passenger_type,
        item.visa_type,
        item.surname,
        item.given_name,
        item.passport_number,
        item.nationality,
        item.date_of_birth,
        item.passport_issuance,
        item.passport_expiry,
        item.sort_order,
      ],
    );
  }
}

function buildVisaHeader(
  id: string,
  companyId: string,
  input: VisaBookingInput,
  result: ReturnType<typeof calculateVisaBooking>,
  now: string,
  actorUserId: string,
): VisaBookingSyncHeader {
  return {
    id,
    company_id: companyId,
    transaction_type: input.transactionType,
    counterparty_id: input.counterpartyId,
    transaction_date: input.transactionDate,
    ub_number: input.ubNumber.trim(),
    expected_entry_date: input.expectedEntryDate.trim(),
    private_vehicle_type: result.privateVehicleType,
    private_transport_total_sar: result.privateTransportTotalSar,
    intercity_bus_rate_sar: result.intercityBusRateSar,
    intercity_bus_total_sar: result.intercityBusTotalSar,
    applicable_private_pax: result.applicablePrivatePax,
    applicable_full_bus_pax: result.applicableFullBusPax,
    visa_total_sar: result.visaTotalSar,
    transport_total_sar: result.transportTotalSar,
    total_sar: result.totalSar,
    total_pkr: result.totalPkr,
    unconverted_sar: result.unconvertedSar,
    notes: input.notes.trim(),
    status: "ACTIVE",
    created_at: now,
    updated_at: now,
    created_by_user_id: actorUserId,
    updated_by_user_id: actorUserId,
  };
}

export async function getVisaBookings(companyId: string, search = "", scope?: BookingListScope) {
  const clean = search.trim();

  if (!isDesktopApp()) {
    let query = applyBookingListScope(
      supabase
        .from("visa_bookings")
        .select("*")
        .eq("company_id", companyId)
        .order("transaction_date", { ascending: false })
        .order("created_at", { ascending: false }),
      scope,
    );

    if (clean) {
      const term = `%${clean}%`;
      query = query.or(`ub_number.ilike.${term},notes.ilike.${term}`);
    }

    const { data, error } = await query;
    if (error) throw new Error(error.message);
    if (!data?.length) return [] as VisaBooking[];

    const bookingIds = data.map((row) => String(row.id));
    const partyNames = scope?.counterpartyId ? new Map<string, string>() : await fetchCounterpartyNameMap(companyId);
    const [lines, fleet, passports] = await Promise.all([
      fetchChildRowsByBookingIds("visa_booking_lines", bookingIds),
      fetchChildRowsByBookingIds("visa_transport_fleet", bookingIds),
      fetchChildRowsByBookingIds("visa_passport_details", bookingIds),
    ]);
    const linesByBooking = groupRowsByBookingId(lines);
    const fleetByBooking = groupRowsByBookingId(fleet);
    const passportsByBooking = groupRowsByBookingId(passports);

    return data.map((b) => ({
      ...b,
      counterparty_name: partyNames.get(String(b.counterparty_id)) || "",
      lines: (linesByBooking.get(String(b.id)) || []) as VisaBookingLine[],
      fleet: (fleetByBooking.get(String(b.id)) || []) as VisaTransportFleetLine[],
      passports: (passportsByBooking.get(String(b.id)) || []) as VisaPassportDetail[],
    })) as VisaBooking[];
  }

  const database = await db();
  const term = `%${clean}%`;
  const scopeFilter = bookingListScopeSql(scope, 3);

  const headers = await database.select<Omit<VisaBooking, "lines" | "fleet" | "passports">[]>(
    `SELECT
       b.id,b.company_id,b.transaction_type,b.counterparty_id,COALESCE(p.name, v.name, '') AS counterparty_name,
       b.transaction_date,b.ub_number,b.expected_entry_date,b.private_vehicle_type,b.private_transport_total_sar,
       b.intercity_bus_rate_sar,b.intercity_bus_total_sar,b.applicable_private_pax,b.applicable_full_bus_pax,
       b.visa_total_sar,b.transport_total_sar,b.total_sar,b.total_pkr,b.unconverted_sar,b.notes,
       b.status,b.created_at,b.updated_at
     FROM visa_bookings b
     LEFT JOIN parties p ON p.id=b.counterparty_id AND p.company_id=b.company_id
     LEFT JOIN vendors v ON v.id=b.counterparty_id AND v.company_id=b.company_id
     WHERE b.company_id=$1
       AND (
         $2='' OR b.ub_number LIKE $3 COLLATE NOCASE OR b.notes LIKE $3 COLLATE NOCASE OR
         b.private_vehicle_type LIKE $3 COLLATE NOCASE OR COALESCE(p.name, v.name, '') LIKE $3 COLLATE NOCASE OR
         EXISTS (
           SELECT 1 FROM visa_booking_lines l
           WHERE l.booking_id=b.id
             AND (l.passenger_name LIKE $3 COLLATE NOCASE OR l.visa_type LIKE $3 COLLATE NOCASE OR l.passenger_type LIKE $3 COLLATE NOCASE)
         ) OR
         EXISTS (
           SELECT 1 FROM visa_passport_details d
           WHERE d.booking_id=b.id
             AND (d.passenger_name LIKE $3 COLLATE NOCASE OR d.surname LIKE $3 COLLATE NOCASE OR d.given_name LIKE $3 COLLATE NOCASE OR d.passport_number LIKE $3 COLLATE NOCASE OR d.nationality LIKE $3 COLLATE NOCASE)
         ) OR
         EXISTS (
           SELECT 1 FROM visa_transport_fleet f
           WHERE f.booking_id=b.id AND f.vehicle_type LIKE $3 COLLATE NOCASE
         )
       )
       ${scopeFilter.sql}
     ORDER BY b.transaction_date DESC,b.created_at DESC`,
    [companyId, clean, term, ...scopeFilter.params],
  );

  const lines = await database.select<VisaBookingLine[]>(
    `SELECT l.id,l.booking_id,l.passenger_type,l.passenger_name,l.visa_type,l.visa_rate_sar,l.pax_count,l.roe,
            l.visa_total_sar,l.private_transport_allocated_sar,l.intercity_bus_total_sar,l.line_total_sar,l.line_total_pkr,l.sort_order
     FROM visa_booking_lines l
     INNER JOIN visa_bookings b ON b.id=l.booking_id
     WHERE b.company_id=$1
     ORDER BY l.sort_order ASC`,
    [companyId],
  );

  const fleet = await database.select<VisaTransportFleetLine[]>(
    `SELECT f.id,f.booking_id,f.vehicle_type,f.quantity,f.capacity_per_vehicle,f.total_capacity,
            f.rate_per_vehicle_sar,f.line_total_sar,f.sort_order
     FROM visa_transport_fleet f
     INNER JOIN visa_bookings b ON b.id=f.booking_id
     WHERE b.company_id=$1
     ORDER BY f.sort_order ASC`,
    [companyId],
  );

  const passports = await database.select<VisaPassportDetail[]>(
    `SELECT d.id,d.booking_id,d.source_family_name,d.passenger_name,d.passenger_type,d.visa_type,
            d.surname,d.given_name,d.passport_number,d.nationality,d.date_of_birth,d.passport_issuance,d.passport_expiry,d.sort_order
     FROM visa_passport_details d
     INNER JOIN visa_bookings b ON b.id=d.booking_id
     WHERE b.company_id=$1
     ORDER BY d.sort_order ASC`,
    [companyId],
  );

  const groupedLines = new Map<string, VisaBookingLine[]>();
  for (const line of lines) {
    const current = groupedLines.get(line.booking_id) || [];
    current.push(line);
    groupedLines.set(line.booking_id, current);
  }

  const groupedFleet = new Map<string, VisaTransportFleetLine[]>();
  for (const item of fleet) {
    const current = groupedFleet.get(item.booking_id) || [];
    current.push(item);
    groupedFleet.set(item.booking_id, current);
  }

  const groupedPassports = new Map<string, VisaPassportDetail[]>();
  for (const item of passports) {
    const current = groupedPassports.get(item.booking_id) || [];
    current.push(item);
    groupedPassports.set(item.booking_id, current);
  }

  return headers.map((header) => ({
    ...header,
    lines: groupedLines.get(header.id) || [],
    fleet: groupedFleet.get(header.id) || [],
    passports: groupedPassports.get(header.id) || [],
  })) as VisaBooking[];
}

export async function createVisaBooking(companyId: string, input: VisaBookingInput, actorUserId = "") {
  await requirePermission(companyId, actorUserId, "create_bookings");
  const { enforceSegmentCreate } = await import("./companyAccess");
  await enforceSegmentCreate(companyId, "VISA");
  const result = await validateVisaBooking(companyId, input);
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const children = buildVisaChildRows(id, result);
  const header = buildVisaHeader(id, companyId, input, result, now, actorUserId);

  if (isDesktopApp()) {
    const database = await db();
    await database.execute(
      `INSERT INTO visa_bookings
       (id,company_id,transaction_type,counterparty_id,transaction_date,ub_number,expected_entry_date,private_vehicle_type,
        private_transport_total_sar,intercity_bus_rate_sar,intercity_bus_total_sar,applicable_private_pax,applicable_full_bus_pax,
        visa_total_sar,transport_total_sar,total_sar,total_pkr,unconverted_sar,notes,status,created_at,updated_at,created_by_user_id,updated_by_user_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,'ACTIVE',$20,$20,$21,$21)`,
      [
        id,
        companyId,
        input.transactionType,
        input.counterpartyId,
        input.transactionDate,
        input.ubNumber.trim(),
        input.expectedEntryDate.trim(),
        result.privateVehicleType,
        result.privateTransportTotalSar,
        result.intercityBusRateSar,
        result.intercityBusTotalSar,
        result.applicablePrivatePax,
        result.applicableFullBusPax,
        result.visaTotalSar,
        result.transportTotalSar,
        result.totalSar,
        result.totalPkr,
        result.unconvertedSar,
        input.notes.trim(),
        now,
        actorUserId,
      ],
    );
    await insertVisaChildrenLocal(database, id, children);
  }

  await syncVisaBookingBundle(header, children.lines, children.fleet, children.passports);
  if (isDesktopApp()) await flushDesktopSyncQueue();

  if (actorUserId)
    await createAuditLog(
      companyId,
      actorUserId,
      "BOOKING_CREATED",
      "VISA",
      id,
      `${input.transactionType} ${input.ubNumber.trim()} - SAR ${result.totalSar} / PKR ${result.totalPkr}`,
    );
  return id;
}

export async function updateVisaBooking(
  companyId: string,
  bookingId: string,
  input: VisaBookingInput,
  actorUserId = "",
) {
  await requirePermission(companyId, actorUserId, "edit_bookings");
  const result = await validateVisaBooking(companyId, input, bookingId);
  const now = new Date().toISOString();
  const children = buildVisaChildRows(bookingId, result);

  let current: { created_at: string; created_by_user_id: string };

  if (isDesktopApp()) {
    const database = await db();
    const rows = await database.select<Array<{ created_at: string; created_by_user_id: string }>>(
      `SELECT created_at,created_by_user_id FROM visa_bookings WHERE id=$1 AND company_id=$2 AND status='ACTIVE' LIMIT 1`,
      [bookingId, companyId],
    );
    const row = rows[0];
    if (!row) throw new Error("This Visa booking is no longer active.");
    current = row;

    await database.execute(
      `UPDATE visa_bookings
       SET transaction_type=$1,counterparty_id=$2,transaction_date=$3,ub_number=$4,expected_entry_date=$5,private_vehicle_type=$6,
           private_transport_total_sar=$7,intercity_bus_rate_sar=$8,intercity_bus_total_sar=$9,
           applicable_private_pax=$10,applicable_full_bus_pax=$11,visa_total_sar=$12,transport_total_sar=$13,
           total_sar=$14,total_pkr=$15,unconverted_sar=$16,notes=$17,updated_at=$18,updated_by_user_id=$19
       WHERE id=$20 AND company_id=$21 AND status='ACTIVE'`,
      [
        input.transactionType,
        input.counterpartyId,
        input.transactionDate,
        input.ubNumber.trim(),
        input.expectedEntryDate.trim(),
        result.privateVehicleType,
        result.privateTransportTotalSar,
        result.intercityBusRateSar,
        result.intercityBusTotalSar,
        result.applicablePrivatePax,
        result.applicableFullBusPax,
        result.visaTotalSar,
        result.transportTotalSar,
        result.totalSar,
        result.totalPkr,
        result.unconvertedSar,
        input.notes.trim(),
        now,
        actorUserId,
        bookingId,
        companyId,
      ],
    );
    await database.execute(`DELETE FROM visa_booking_lines WHERE booking_id=$1`, [bookingId]);
    await database.execute(`DELETE FROM visa_transport_fleet WHERE booking_id=$1`, [bookingId]);
    await database.execute(`DELETE FROM visa_passport_details WHERE booking_id=$1`, [bookingId]);
    await insertVisaChildrenLocal(database, bookingId, children);
  } else {
    const { data, error } = await supabase
      .from("visa_bookings")
      .select("created_at,created_by_user_id")
      .eq("id", bookingId)
      .eq("company_id", companyId)
      .eq("status", "ACTIVE")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new Error("This Visa booking is no longer active.");
    current = data;
  }

  const header = buildVisaHeader(bookingId, companyId, input, result, now, actorUserId);
  header.created_at = current.created_at;
  header.created_by_user_id = current.created_by_user_id || actorUserId;

  await syncVisaBookingBundle(header, children.lines, children.fleet, children.passports);
  if (isDesktopApp()) await flushDesktopSyncQueue();

  if (actorUserId)
    await createAuditLog(
      companyId,
      actorUserId,
      "BOOKING_UPDATED",
      "VISA",
      bookingId,
      `${input.transactionType} ${input.ubNumber.trim()} - SAR ${result.totalSar} / PKR ${result.totalPkr}`,
    );
}

export async function voidVisaBooking(companyId: string, bookingId: string, actorUserId = "") {
  await requirePermission(companyId, actorUserId, "void_bookings");
  const now = new Date().toISOString();
  let ubNumber: string;

  if (isDesktopApp()) {
    const database = await db();
    const rows = await database.select<Array<{ ub_number: string }>>(
      `SELECT ub_number FROM visa_bookings WHERE id=$1 AND company_id=$2 LIMIT 1`,
      [bookingId, companyId],
    );
    ubNumber = rows[0]?.ub_number || bookingId;
    await database.execute(
      `UPDATE visa_bookings SET status='VOID',updated_at=$1,updated_by_user_id=$2 WHERE id=$3 AND company_id=$4 AND status='ACTIVE'`,
      [now, actorUserId, bookingId, companyId],
    );
  } else {
    const { data, error } = await supabase
      .from("visa_bookings")
      .select("ub_number")
      .eq("id", bookingId)
      .eq("company_id", companyId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    ubNumber = data?.ub_number || bookingId;
  }

  await syncVisaBookingVoid(bookingId, now, actorUserId);
  if (isDesktopApp()) await flushDesktopSyncQueue();

  if (actorUserId)
    await createAuditLog(
      companyId,
      actorUserId,
      "BOOKING_VOIDED",
      "VISA",
      bookingId,
      `Visa booking ${ubNumber} voided.`,
    );
}
