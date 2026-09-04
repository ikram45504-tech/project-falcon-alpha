import Database from "@tauri-apps/plugin-sql";
import type {
  BookingTransactionType,
  HotelBooking,
  HotelBookingInput,
  HotelBookingLine,
  HotelBookingLineInput,
  HotelRoomType,
} from "./db";
import {
  flushDesktopSyncQueue,
  isDesktopApp,
  syncHotelBookingBundle,
  syncHotelBookingVoid,
  type HotelBookingSyncHeader,
  type HotelBookingSyncLine,
} from "./cloudSync";
import { validateBookingCounterparty, fetchCounterpartyNameMap } from "./CounterpartyDb";
import { applyBookingListScope, bookingListScopeSql, type BookingListScope } from "./bookingListScope";
import { supabase } from "./supabaseClient";

const DB_PATH = "sqlite:travel-accounting.db";
let databasePromise: Promise<Database> | null = null;

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

import { createAuditLog, requirePermission } from "./db";

function normalizeHotelUb(value: string) {
  return value.trim().replace(/\s+/g, " ").toUpperCase();
}

function hotelStayNights(checkIn: string, checkOut: string) {
  if (!checkIn || !checkOut || checkOut <= checkIn) return 0;
  const [iy, im, id] = checkIn.split("-").map(Number);
  const [oy, om, od] = checkOut.split("-").map(Number);
  const start = Date.UTC(iy, im - 1, id);
  const end = Date.UTC(oy, om - 1, od);
  return Math.max(0, Math.floor((end - start) / 86400000));
}

export function calculateHotelLines(lines: HotelBookingLineInput[]) {
  const allowedRoomTypes: HotelRoomType[] = ["SHARING", "QUINT_SHARING", "QUAD", "TRIPLE", "DOUBLE", "SUITE_ROOM"];
  const calculated: Array<{
    city: string;
    hotelName: string;
    checkIn: string;
    checkOut: string;
    nights: number;
    roomType: HotelRoomType;
    ratePerNightSar: number;
    quantity: number;
    roe: number;
    lineTotalSar: number;
    lineTotalPkr: number;
    sortOrder: number;
  }> = [];

  lines.forEach((line, index) => {
    const rowNo = index + 1;
    const city = line.city.trim();
    const hotelName = line.hotelName.trim();
    const nights = hotelStayNights(line.checkIn, line.checkOut);
    const quantity = Math.trunc(Number(line.quantity));
    const ratePerNightSar = Number(line.ratePerNightSar);
    const roe = line.roe == null ? 0 : Number(line.roe);

    if (!city) throw new Error(`Hotel row ${rowNo}: City is required.`);
    if (!hotelName) throw new Error(`Hotel row ${rowNo}: Hotel Name is required.`);
    if (!line.checkIn) throw new Error(`Hotel row ${rowNo}: Check-In date is required.`);
    if (!line.checkOut) throw new Error(`Hotel row ${rowNo}: Check-Out date is required.`);
    if (line.checkOut <= line.checkIn) throw new Error(`Hotel row ${rowNo}: Check-Out must be after Check-In.`);
    if (!Number.isFinite(nights) || nights < 1 || nights > 99)
      throw new Error(`Hotel row ${rowNo}: No. of Nights must be between 1 and 99.`);
    if (!allowedRoomTypes.includes(line.roomType)) throw new Error(`Hotel row ${rowNo}: select a Room Type.`);
    if (!Number.isFinite(ratePerNightSar) || ratePerNightSar <= 0)
      throw new Error(`Hotel row ${rowNo}: enter a valid Per Night SAR rate.`);
    if (!Number.isFinite(quantity) || quantity < 1 || quantity > 99) {
      throw new Error(
        `Hotel row ${rowNo}: ${line.roomType === "SHARING" ? "No. of Beds" : "No. of Rooms"} must be between 1 and 99.`,
      );
    }
    if (!Number.isFinite(roe) || roe < 0) throw new Error(`Hotel row ${rowNo}: enter a valid ROE or leave it blank.`);

    const lineTotalSar = ratePerNightSar * nights * quantity;
    const lineTotalPkr = roe > 0 ? lineTotalSar * roe : 0;

    calculated.push({
      city,
      hotelName,
      checkIn: line.checkIn,
      checkOut: line.checkOut,
      nights,
      roomType: line.roomType,
      ratePerNightSar,
      quantity,
      roe,
      lineTotalSar,
      lineTotalPkr,
      sortOrder: index,
    });
  });

  if (!calculated.length) throw new Error("Add at least one Hotel stay row.");

  const totalSar = calculated.reduce((sum, line) => sum + line.lineTotalSar, 0);
  const totalPkr = calculated.reduce((sum, line) => sum + line.lineTotalPkr, 0);
  const unconvertedSar = calculated.filter((line) => line.roe <= 0).reduce((sum, line) => sum + line.lineTotalSar, 0);

  return { calculated, totalSar, totalPkr, unconvertedSar };
}

async function validateUniqueHotelUb(
  companyId: string,
  transactionType: BookingTransactionType,
  counterpartyId: string,
  ubNumber: string,
  editingBookingId = "",
) {
  const normalized = normalizeHotelUb(ubNumber);
  let rows: Array<{
    id: string;
    transaction_type: BookingTransactionType;
    counterparty_id: string;
    ub_number: string;
  }> = [];

  if (isDesktopApp()) {
    const database = await db();
    rows = await database.select(
      `SELECT id,transaction_type,counterparty_id,ub_number
       FROM hotel_bookings
       WHERE company_id=$1 AND status='ACTIVE'`,
      [companyId],
    );
  } else {
    const { data, error } = await supabase
      .from("hotel_bookings")
      .select("id,transaction_type,counterparty_id,ub_number")
      .eq("company_id", companyId)
      .eq("status", "ACTIVE");
    if (error) throw new Error(error.message);
    rows = (data || []) as typeof rows;
  }

  const duplicate = rows.find((row) => {
    if (row.id === editingBookingId || normalizeHotelUb(row.ub_number) !== normalized) return false;
    if (transactionType === "SALE") return row.transaction_type === "SALE";
    return row.transaction_type === "PURCHASE" && row.counterparty_id === counterpartyId;
  });

  if (duplicate) {
    if (transactionType === "SALE") {
      throw new Error(
        `UB # / Booking "${ubNumber.trim()}" already has a Hotel Sale booking. Edit the existing Hotel booking or use another UB #.`,
      );
    }
    throw new Error(
      `This Vendor already has a Hotel Purchase booking for UB # "${ubNumber.trim()}". Edit that booking or select another Vendor.`,
    );
  }
}

async function validateHotelBooking(companyId: string, input: HotelBookingInput, editingBookingId = "") {
  if (!["SALE", "PURCHASE"].includes(input.transactionType)) throw new Error("Select Sale or Purchase first.");
  if (!input.transactionDate) throw new Error("Date of Booking is required.");
  if (!input.ubNumber.trim()) throw new Error("UB # / Booking is required.");
  const guestCount = Math.trunc(Number(input.guestCount || 0));
  if (!Number.isFinite(guestCount) || guestCount < 0 || guestCount > 99)
    throw new Error("No. of Guests must be between 1 and 99, or left blank.");
  await validateBookingCounterparty(companyId, input.transactionType, input.counterpartyId);
  await validateUniqueHotelUb(companyId, input.transactionType, input.counterpartyId, input.ubNumber, editingBookingId);
  return calculateHotelLines(input.lines);
}

async function fetchChildRowsByBookingIds(table: string, bookingIds: string[]) {
  if (!bookingIds.length) return [] as Record<string, any>[];
  const { data, error } = await supabase.from(table).select("*").in("booking_id", bookingIds);
  if (error) throw new Error(error.message);
  return (data || []) as Record<string, any>[];
}

function groupRowsByBookingId(rows: Record<string, any>[]) {
  const grouped = new Map<string, Record<string, any>[]>();
  for (const row of rows) {
    const bookingId = String(row.booking_id || "");
    const current = grouped.get(bookingId) || [];
    current.push(row);
    grouped.set(bookingId, current);
  }
  return grouped;
}

export async function getHotelBookings(companyId: string, search = "", scope?: BookingListScope) {
  const isTauri = "__TAURI_INTERNALS__" in window;
  if (!isTauri) {
    let query = applyBookingListScope(
      supabase
        .from("hotel_bookings")
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
      "hotel_booking_lines",
      data.map((row) => String(row.id)),
    );
    const linesByBooking = groupRowsByBookingId(lines);

    return data.map((b: any) => ({
      ...b,
      counterparty_name: partyNames.get(String(b.counterparty_id)) || "",
      lines: linesByBooking.get(String(b.id)) || [],
    })) as HotelBooking[];
  }

  const database = await db();
  const clean = search.trim();
  const term = `%${clean}%`;
  const scopeFilter = bookingListScopeSql(scope, 3);

  const headers = await database.select<Omit<HotelBooking, "lines">[]>(
    `SELECT
       b.id,b.company_id,b.transaction_type,b.counterparty_id,
       COALESCE(p.name, v.name, '') AS counterparty_name,
       b.transaction_date,b.ub_number,b.confirmation_voucher,b.meal_plan,b.guest_family_name,b.guest_count,
       b.customer_contact,b.special_requests,b.notes,b.total_sar,b.total_pkr,b.unconverted_sar,
       b.status,b.created_at,b.updated_at
     FROM hotel_bookings b
     LEFT JOIN parties p ON p.id=b.counterparty_id AND p.company_id=b.company_id
     LEFT JOIN vendors v ON v.id=b.counterparty_id AND v.company_id=b.company_id
     WHERE b.company_id=$1
       AND (
         $2='' OR
         b.ub_number LIKE $3 COLLATE NOCASE OR
         b.confirmation_voucher LIKE $3 COLLATE NOCASE OR
         b.meal_plan LIKE $3 COLLATE NOCASE OR
         b.guest_family_name LIKE $3 COLLATE NOCASE OR
         b.customer_contact LIKE $3 COLLATE NOCASE OR
         b.special_requests LIKE $3 COLLATE NOCASE OR
         b.notes LIKE $3 COLLATE NOCASE OR
         COALESCE(p.name, v.name, '') LIKE $3 COLLATE NOCASE OR
         EXISTS (
           SELECT 1 FROM hotel_booking_lines l
           WHERE l.booking_id=b.id
             AND (l.city LIKE $3 COLLATE NOCASE OR l.hotel_name LIKE $3 COLLATE NOCASE)
         )
       )
       ${scopeFilter.sql}
     ORDER BY b.transaction_date DESC,b.created_at DESC`,
    [companyId, clean, term, ...scopeFilter.params],
  );

  const lines = await database.select<HotelBookingLine[]>(
    `SELECT l.id,l.booking_id,l.city,l.hotel_name,l.check_in,l.check_out,l.nights,l.room_type,
            l.rate_per_night_sar,l.quantity,l.roe,l.line_total_sar,l.line_total_pkr,l.sort_order
     FROM hotel_booking_lines l
     INNER JOIN hotel_bookings b ON b.id=l.booking_id
     WHERE b.company_id=$1
     ORDER BY l.sort_order ASC`,
    [companyId],
  );

  const grouped = new Map<string, HotelBookingLine[]>();
  for (const line of lines) {
    const current = grouped.get(line.booking_id) || [];
    current.push(line);
    grouped.set(line.booking_id, current);
  }

  return headers.map((header) => ({ ...header, lines: grouped.get(header.id) || [] })) as HotelBooking[];
}

export async function createHotelBooking(companyId: string, input: HotelBookingInput, actorUserId = "") {
  await requirePermission(companyId, actorUserId, "create_bookings");
  const { enforceSegmentCreate } = await import("./companyAccess");
  await enforceSegmentCreate(companyId, "HOTEL");
  const { calculated, totalSar, totalPkr, unconvertedSar } = await validateHotelBooking(companyId, input);
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const lineRows: HotelBookingSyncLine[] = calculated.map((line) => ({
    id: crypto.randomUUID(),
    booking_id: id,
    city: line.city,
    hotel_name: line.hotelName,
    check_in: line.checkIn,
    check_out: line.checkOut,
    nights: line.nights,
    room_type: line.roomType,
    rate_per_night_sar: line.ratePerNightSar,
    quantity: line.quantity,
    roe: line.roe,
    line_total_sar: line.lineTotalSar,
    line_total_pkr: line.lineTotalPkr,
    sort_order: line.sortOrder,
  }));
  const header: HotelBookingSyncHeader = {
    id,
    company_id: companyId,
    transaction_type: input.transactionType,
    counterparty_id: input.counterpartyId,
    transaction_date: input.transactionDate,
    ub_number: input.ubNumber.trim(),
    confirmation_voucher: input.confirmationVoucher.trim(),
    meal_plan: input.mealPlan.trim(),
    guest_family_name: input.guestFamilyName.trim(),
    guest_count: Math.trunc(Number(input.guestCount || 0)),
    customer_contact: input.customerContact.trim(),
    special_requests: input.specialRequests.trim(),
    notes: input.notes.trim(),
    total_sar: totalSar,
    total_pkr: totalPkr,
    unconverted_sar: unconvertedSar,
    status: "ACTIVE",
    created_at: now,
    updated_at: now,
    created_by_user_id: actorUserId,
    updated_by_user_id: actorUserId,
  };

  if (isDesktopApp()) {
    const database = await db();
    await database.execute(
      `INSERT INTO hotel_bookings
       (id,company_id,transaction_type,counterparty_id,transaction_date,ub_number,
        confirmation_voucher,meal_plan,guest_family_name,guest_count,customer_contact,special_requests,notes,
        total_sar,total_pkr,unconverted_sar,status,created_at,updated_at,created_by_user_id,updated_by_user_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,'ACTIVE',$17,$17,$18,$18)`,
      [
        id,
        companyId,
        input.transactionType,
        input.counterpartyId,
        input.transactionDate,
        input.ubNumber.trim(),
        input.confirmationVoucher.trim(),
        input.mealPlan.trim(),
        input.guestFamilyName.trim(),
        Math.trunc(Number(input.guestCount || 0)),
        input.customerContact.trim(),
        input.specialRequests.trim(),
        input.notes.trim(),
        totalSar,
        totalPkr,
        unconvertedSar,
        now,
        actorUserId,
      ],
    );

    for (const line of lineRows) {
      await database.execute(
        `INSERT INTO hotel_booking_lines
         (id,booking_id,city,hotel_name,check_in,check_out,nights,room_type,rate_per_night_sar,quantity,roe,line_total_sar,line_total_pkr,sort_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [
          line.id,
          id,
          line.city,
          line.hotel_name,
          line.check_in,
          line.check_out,
          line.nights,
          line.room_type,
          line.rate_per_night_sar,
          line.quantity,
          line.roe,
          line.line_total_sar,
          line.line_total_pkr,
          line.sort_order,
        ],
      );
    }

    if (actorUserId)
      await createAuditLog(
        companyId,
        actorUserId,
        "BOOKING_CREATED",
        "HOTEL",
        id,
        `${input.transactionType} ${input.ubNumber.trim()} - SAR ${totalSar} / PKR ${totalPkr}`,
      );
  }

  await syncHotelBookingBundle(header, lineRows);
  if (isDesktopApp()) await flushDesktopSyncQueue();
  return id;
}

export async function updateHotelBooking(
  companyId: string,
  bookingId: string,
  input: Pick<HotelBookingInput, "transactionDate" | "lines">,
  actorUserId = "",
) {
  await requirePermission(companyId, actorUserId, "edit_bookings");
  if (!input.transactionDate) throw new Error("Date of Booking is required.");
  const { calculated, totalSar, totalPkr, unconvertedSar } = calculateHotelLines(input.lines);
  const now = new Date().toISOString();

  let current: {
    status: string;
    created_at: string;
    created_by_user_id: string;
    transaction_type: BookingTransactionType;
    counterparty_id: string;
    ub_number: string;
    confirmation_voucher: string;
    meal_plan: string;
    guest_family_name: string;
    guest_count: number;
    customer_contact: string;
    special_requests: string;
    notes: string;
  } | null = null;
  if (isDesktopApp()) {
    const database = await db();
    const currentRows = await database.select<NonNullable<typeof current>[]>(
      `SELECT status,created_at,created_by_user_id,transaction_type,counterparty_id,ub_number,
              confirmation_voucher,meal_plan,guest_family_name,guest_count,customer_contact,special_requests,notes
       FROM hotel_bookings WHERE id=$1 AND company_id=$2 LIMIT 1`,
      [bookingId, companyId],
    );
    current = currentRows[0] || null;
  } else {
    const { data, error } = await supabase
      .from("hotel_bookings")
      .select(
        "status,created_at,created_by_user_id,transaction_type,counterparty_id,ub_number,confirmation_voucher,meal_plan,guest_family_name,guest_count,customer_contact,special_requests,notes",
      )
      .eq("id", bookingId)
      .eq("company_id", companyId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    current = data;
  }
  if (!current || current.status !== "ACTIVE") throw new Error("This Hotel booking is no longer active.");

  const lineRows: HotelBookingSyncLine[] = calculated.map((line) => ({
    id: crypto.randomUUID(),
    booking_id: bookingId,
    city: line.city,
    hotel_name: line.hotelName,
    check_in: line.checkIn,
    check_out: line.checkOut,
    nights: line.nights,
    room_type: line.roomType,
    rate_per_night_sar: line.ratePerNightSar,
    quantity: line.quantity,
    roe: line.roe,
    line_total_sar: line.lineTotalSar,
    line_total_pkr: line.lineTotalPkr,
    sort_order: line.sortOrder,
  }));

  if (isDesktopApp()) {
    const database = await db();
    await database.execute(
      `UPDATE hotel_bookings
       SET transaction_date=$1,total_sar=$2,total_pkr=$3,unconverted_sar=$4,updated_at=$5,updated_by_user_id=$6
       WHERE id=$7 AND company_id=$8 AND status='ACTIVE'`,
      [input.transactionDate, totalSar, totalPkr, unconvertedSar, now, actorUserId, bookingId, companyId],
    );

    await database.execute(`DELETE FROM hotel_booking_lines WHERE booking_id=$1`, [bookingId]);
    for (const line of lineRows) {
      await database.execute(
        `INSERT INTO hotel_booking_lines
         (id,booking_id,city,hotel_name,check_in,check_out,nights,room_type,rate_per_night_sar,quantity,roe,line_total_sar,line_total_pkr,sort_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [
          line.id,
          bookingId,
          line.city,
          line.hotel_name,
          line.check_in,
          line.check_out,
          line.nights,
          line.room_type,
          line.rate_per_night_sar,
          line.quantity,
          line.roe,
          line.line_total_sar,
          line.line_total_pkr,
          line.sort_order,
        ],
      );
    }

    if (actorUserId)
      await createAuditLog(
        companyId,
        actorUserId,
        "BOOKING_UPDATED",
        "HOTEL",
        bookingId,
        `${current.transaction_type} ${current.ub_number} - SAR ${totalSar} / PKR ${totalPkr}`,
      );
  }

  await syncHotelBookingBundle(
    {
      id: bookingId,
      company_id: companyId,
      transaction_type: current.transaction_type,
      counterparty_id: current.counterparty_id,
      transaction_date: input.transactionDate,
      ub_number: current.ub_number,
      confirmation_voucher: current.confirmation_voucher || "",
      meal_plan: current.meal_plan || "",
      guest_family_name: current.guest_family_name || "",
      guest_count: Math.trunc(Number(current.guest_count || 0)),
      customer_contact: current.customer_contact || "",
      special_requests: current.special_requests || "",
      notes: current.notes || "",
      total_sar: totalSar,
      total_pkr: totalPkr,
      unconverted_sar: unconvertedSar,
      status: "ACTIVE",
      created_at: current.created_at,
      updated_at: now,
      created_by_user_id: current.created_by_user_id || actorUserId,
      updated_by_user_id: actorUserId,
    },
    lineRows,
  );
  if (isDesktopApp()) await flushDesktopSyncQueue();
}

export async function voidHotelBooking(companyId: string, bookingId: string, actorUserId = "") {
  await requirePermission(companyId, actorUserId, "void_bookings");
  const now = new Date().toISOString();

  if (isDesktopApp()) {
    const database = await db();
    const rows = await database.select<Array<{ ub_number: string }>>(
      `SELECT ub_number FROM hotel_bookings WHERE id=$1 AND company_id=$2 LIMIT 1`,
      [bookingId, companyId],
    );
    const ubNumber = rows[0]?.ub_number || bookingId;
    await database.execute(
      `UPDATE hotel_bookings
       SET status='VOID',updated_at=$1,updated_by_user_id=$2
       WHERE id=$3 AND company_id=$4 AND status='ACTIVE'`,
      [now, actorUserId, bookingId, companyId],
    );
    if (actorUserId)
      await createAuditLog(
        companyId,
        actorUserId,
        "BOOKING_VOIDED",
        "HOTEL",
        bookingId,
        `Hotel booking ${ubNumber} voided.`,
      );
  } else {
    const { error } = await supabase
      .from("hotel_bookings")
      .select("id")
      .eq("id", bookingId)
      .eq("company_id", companyId)
      .maybeSingle();
    if (error) throw new Error(error.message);
  }

  await syncHotelBookingVoid(bookingId, now, actorUserId);
  if (isDesktopApp()) await flushDesktopSyncQueue();
}
