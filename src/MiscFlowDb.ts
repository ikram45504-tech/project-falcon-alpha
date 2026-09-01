import Database from "@tauri-apps/plugin-sql";
import { createAuditLog, requirePermission } from "./db";
import {
  flushDesktopSyncQueue,
  isDesktopApp,
  syncMiscBookingBundle,
  syncMiscBookingVoid,
  type MiscBookingSyncHeader,
  type MiscBookingSyncLine,
} from "./cloudSync";
import { fetchCounterpartyNameMap, validateBookingCounterparty } from "./CounterpartyDb";
import { applyBookingListScope, bookingListScopeSql, type BookingListScope } from "./bookingListScope";
import { supabase } from "./supabaseClient";
import {
  initMiscDatabase,
  type MiscBooking,
  type MiscBookingInput,
  type MiscBookingLine,
  type MiscBookingLineInput,
  type MiscTransactionType,
} from "./miscDb";

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

function normalizeUb(value: string) {
  return value.trim().replace(/\s+/g, " ").toUpperCase();
}

export function calculateMiscLines(lines: MiscBookingLineInput[]) {
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
    return { serviceName, paxCount, ratePerPerson, roe, currencyMode, lineTotalSar, lineTotalPkr, sortOrder: index };
  });

  return {
    calculated,
    totalSar: calculated.reduce((sum, line) => sum + line.lineTotalSar, 0),
    totalPkr: calculated.reduce((sum, line) => sum + line.lineTotalPkr, 0),
    unconvertedSar: 0,
  };
}

async function validateUniqueUb(
  companyId: string,
  transactionType: MiscTransactionType,
  counterpartyId: string,
  ubNumber: string,
  editingId = "",
) {
  const normalized = normalizeUb(ubNumber);
  let rows: Array<{
    id: string;
    transaction_type: MiscTransactionType;
    counterparty_id: string;
    ub_number: string;
  }> = [];

  if (isDesktopApp()) {
    await initMiscDatabase();
    const database = await db();
    rows = await database.select(
      `SELECT id,transaction_type,counterparty_id,ub_number FROM misc_bookings WHERE company_id=$1`,
      [companyId],
    );
  } else {
    const { data, error } = await supabase
      .from("misc_bookings")
      .select("id,transaction_type,counterparty_id,ub_number")
      .eq("company_id", companyId);
    if (error) throw new Error(error.message);
    rows = (data || []) as typeof rows;
  }

  const duplicate = rows.find((row) => {
    if (row.id === editingId || normalizeUb(row.ub_number) !== normalized) return false;
    if (transactionType === "SALE") return row.transaction_type === "SALE";
    return row.transaction_type === "PURCHASE" && row.counterparty_id === counterpartyId;
  });
  if (duplicate) {
    if (transactionType === "SALE")
      throw new Error(`UB # / Booking "${ubNumber.trim()}" already has a Misc Sale booking.`);
    throw new Error(`This Vendor already has a Misc Purchase booking for UB # "${ubNumber.trim()}".`);
  }
}

async function validateBooking(companyId: string, input: MiscBookingInput, editingId = "") {
  if (!["SALE", "PURCHASE"].includes(input.transactionType)) throw new Error("Select Sale or Purchase first.");
  if (!input.transactionDate) throw new Error("Date of Booking is required.");
  if (!input.ubNumber.trim()) throw new Error("UB / Booking # is required.");
  await validateBookingCounterparty(companyId, input.transactionType, input.counterpartyId);
  await validateUniqueUb(companyId, input.transactionType, input.counterpartyId, input.ubNumber, editingId);
  return calculateMiscLines(input.lines);
}

function buildLineRows(bookingId: string, calculated: ReturnType<typeof calculateMiscLines>["calculated"]) {
  return calculated.map<MiscBookingSyncLine>((line) => ({
    id: crypto.randomUUID(),
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
}

function buildHeader(
  bookingId: string,
  companyId: string,
  input: MiscBookingInput,
  totals: ReturnType<typeof calculateMiscLines>,
  now: string,
  actorUserId: string,
  createdAt?: string,
  createdByUserId?: string,
): MiscBookingSyncHeader {
  return {
    id: bookingId,
    company_id: companyId,
    transaction_type: input.transactionType,
    counterparty_id: input.counterpartyId,
    transaction_date: input.transactionDate,
    ub_number: input.ubNumber.trim(),
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

async function insertMiscLinesLocal(database: Database, bookingId: string, lineRows: MiscBookingSyncLine[]) {
  for (const line of lineRows) {
    await database.execute(
      `INSERT INTO misc_booking_lines
      (id,booking_id,service_name,pax_count,rate_per_person,roe,currency_mode,line_total_sar,line_total_pkr,sort_order)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        line.id,
        bookingId,
        line.service_name,
        line.pax_count,
        line.rate_per_person,
        line.roe,
        line.currency_mode,
        line.line_total_sar,
        line.line_total_pkr,
        line.sort_order,
      ],
    );
  }
}

export async function getMiscBookings(companyId: string, search = "", scope?: BookingListScope) {
  if (!isDesktopApp()) {
    let query = applyBookingListScope(
      supabase
        .from("misc_bookings")
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
    const bookingIds = data.map((row) => String(row.id));
    const { data: lineRows, error: lineError } = bookingIds.length
      ? await supabase.from("misc_booking_lines").select("*").in("booking_id", bookingIds)
      : { data: [], error: null };
    if (lineError) throw new Error(lineError.message);

    const linesByBooking = new Map<string, MiscBookingLine[]>();
    for (const line of lineRows || []) {
      const id = String(line.booking_id);
      const current = linesByBooking.get(id) || [];
      current.push(line as MiscBookingLine);
      linesByBooking.set(id, current);
    }

    return data.map((b) => ({
      ...b,
      counterparty_name: partyNames.get(String(b.counterparty_id)) || "",
      lines: linesByBooking.get(String(b.id)) || [],
    })) as MiscBooking[];
  }

  await initMiscDatabase();
  const database = await db();
  const clean = search.trim();
  const term = `%${clean}%`;
  const scopeFilter = bookingListScopeSql(scope, 3);
  const headers = await database.select<Omit<MiscBooking, "lines">[]>(
    `SELECT b.id,b.company_id,b.transaction_type,b.counterparty_id,COALESCE(p.name,'') AS counterparty_name,
            b.transaction_date,b.ub_number,b.total_sar,b.total_pkr,b.unconverted_sar,b.status,
            b.created_at,b.updated_at,b.created_by_user_id,b.updated_by_user_id
     FROM misc_bookings b
     LEFT JOIN parties p ON p.id=b.counterparty_id AND p.company_id=b.company_id
     WHERE b.company_id=$1
       AND ($2='' OR b.ub_number LIKE $3 COLLATE NOCASE OR COALESCE(p.name,'') LIKE $3 COLLATE NOCASE OR
            EXISTS (SELECT 1 FROM misc_booking_lines l WHERE l.booking_id=b.id AND l.service_name LIKE $3 COLLATE NOCASE))
       ${scopeFilter.sql}
     ORDER BY b.transaction_date DESC,b.created_at DESC`,
    [companyId, clean, term, ...scopeFilter.params],
  );
  const lines = await database.select<MiscBookingLine[]>(
    `SELECT l.id,l.booking_id,l.service_name,l.pax_count,l.rate_per_person,l.roe,l.currency_mode,l.line_total_sar,l.line_total_pkr,l.sort_order
     FROM misc_booking_lines l INNER JOIN misc_bookings b ON b.id=l.booking_id
     WHERE b.company_id=$1 ORDER BY l.sort_order ASC`,
    [companyId],
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
  await requirePermission(companyId, actorUserId, "create_bookings");
  const result = await validateBooking(companyId, input);
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const lineRows = buildLineRows(id, result.calculated);
  const header = buildHeader(id, companyId, input, result, now, actorUserId);

  if (isDesktopApp()) {
    const database = await db();
    await database.execute(
      `INSERT INTO misc_bookings
        (id,company_id,transaction_type,counterparty_id,transaction_date,ub_number,total_sar,total_pkr,unconverted_sar,status,created_at,updated_at,created_by_user_id,updated_by_user_id)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'ACTIVE',$10,$10,$11,$11)`,
      [
        id,
        companyId,
        input.transactionType,
        input.counterpartyId,
        input.transactionDate,
        input.ubNumber.trim(),
        result.totalSar,
        result.totalPkr,
        result.unconvertedSar,
        now,
        actorUserId,
      ],
    );
    await insertMiscLinesLocal(database, id, lineRows);
  }

  await syncMiscBookingBundle(header, lineRows);
  if (isDesktopApp()) await flushDesktopSyncQueue();

  if (actorUserId)
    await createAuditLog(
      companyId,
      actorUserId,
      "BOOKING_CREATED",
      "MISC",
      id,
      `${input.transactionType} ${input.ubNumber.trim()} - PKR ${result.totalPkr}`,
    );
  return id;
}

export async function updateMiscBooking(
  companyId: string,
  bookingId: string,
  input: MiscBookingInput,
  actorUserId = "",
) {
  await initMiscDatabase();
  await requirePermission(companyId, actorUserId, "edit_bookings");
  const result = await validateBooking(companyId, input, bookingId);
  const now = new Date().toISOString();
  const lineRows = buildLineRows(bookingId, result.calculated);

  let current: { created_at: string; created_by_user_id: string };

  if (isDesktopApp()) {
    const database = await db();
    const rows = await database.select<Array<{ created_at: string; created_by_user_id: string }>>(
      `SELECT created_at,created_by_user_id FROM misc_bookings WHERE id=$1 AND company_id=$2 AND status='ACTIVE' LIMIT 1`,
      [bookingId, companyId],
    );
    const row = rows[0];
    if (!row) throw new Error("This Misc booking is no longer active.");
    current = row;

    await database.execute(
      `UPDATE misc_bookings SET transaction_type=$1,counterparty_id=$2,transaction_date=$3,ub_number=$4,total_sar=$5,total_pkr=$6,unconverted_sar=$7,updated_at=$8,updated_by_user_id=$9
        WHERE id=$10 AND company_id=$11 AND status='ACTIVE'`,
      [
        input.transactionType,
        input.counterpartyId,
        input.transactionDate,
        input.ubNumber.trim(),
        result.totalSar,
        result.totalPkr,
        result.unconvertedSar,
        now,
        actorUserId,
        bookingId,
        companyId,
      ],
    );
    await database.execute(`DELETE FROM misc_booking_lines WHERE booking_id=$1`, [bookingId]);
    await insertMiscLinesLocal(database, bookingId, lineRows);
  } else {
    const { data, error } = await supabase
      .from("misc_bookings")
      .select("created_at,created_by_user_id")
      .eq("id", bookingId)
      .eq("company_id", companyId)
      .eq("status", "ACTIVE")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new Error("This Misc booking is no longer active.");
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

  await syncMiscBookingBundle(header, lineRows);
  if (isDesktopApp()) await flushDesktopSyncQueue();

  if (actorUserId)
    await createAuditLog(
      companyId,
      actorUserId,
      "BOOKING_UPDATED",
      "MISC",
      bookingId,
      `${input.transactionType} ${input.ubNumber.trim()} - PKR ${result.totalPkr}`,
    );
}

export async function voidMiscBooking(companyId: string, bookingId: string, actorUserId = "") {
  await initMiscDatabase();
  await requirePermission(companyId, actorUserId, "void_bookings");
  const now = new Date().toISOString();
  let ubNumber: string;

  if (isDesktopApp()) {
    const database = await db();
    const rows = await database.select<Array<{ ub_number: string }>>(
      `SELECT ub_number FROM misc_bookings WHERE id=$1 AND company_id=$2 LIMIT 1`,
      [bookingId, companyId],
    );
    ubNumber = rows[0]?.ub_number || bookingId;
    await database.execute(
      `UPDATE misc_bookings SET status='VOID',updated_at=$1,updated_by_user_id=$2 WHERE id=$3 AND company_id=$4 AND status='ACTIVE'`,
      [now, actorUserId, bookingId, companyId],
    );
  } else {
    const { data, error } = await supabase
      .from("misc_bookings")
      .select("ub_number")
      .eq("id", bookingId)
      .eq("company_id", companyId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    ubNumber = data?.ub_number || bookingId;
  }

  await syncMiscBookingVoid(bookingId, now, actorUserId);
  if (isDesktopApp()) await flushDesktopSyncQueue();

  if (actorUserId)
    await createAuditLog(
      companyId,
      actorUserId,
      "BOOKING_VOIDED",
      "MISC",
      bookingId,
      `Misc booking ${ubNumber} voided.`,
    );
}
