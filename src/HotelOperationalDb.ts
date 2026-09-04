import Database from "@tauri-apps/plugin-sql";
import {
  flushDesktopSyncQueue,
  isDesktopApp,
  queueSync,
  syncHotelGuestRefs,
  syncHotelOperationalBundle,
} from "./cloudSync";
import { requirePermission } from "./db";
import { supabase } from "./supabaseClient";

const DB_PATH = "sqlite:travel-accounting.db";
let databasePromise: Promise<Database> | null = null;
let schemaPromise: Promise<void> | null = null;

export type HotelReservationStatus = "" | "PENDING" | "CONFIRMED" | "CANCELLED";

export type HotelReservationDetail = {
  hotelSortOrder: number;
  confirmationVoucher: string;
  mealPlan: string;
  reservationStatus: HotelReservationStatus;
};

export type HotelRoomingGuest = {
  id: string;
  givenName: string;
  surname: string;
  passportNumber: string;
  hotelSortOrder: number;
  roomAllocation: string;
  sortOrder: number;
};

export type HotelOperationalDetails = {
  guestRefs: string[];
  reservations: HotelReservationDetail[];
  guests: HotelRoomingGuest[];
  customerContact: string;
  specialRequests: string;
  checkinInstructions: string;
  notes: string;
};

export type SaveHotelOperationalInput = Omit<HotelOperationalDetails, "guestRefs" | "guests"> & {
  guests: Array<Omit<HotelRoomingGuest, "id" | "sortOrder">>;
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
      } as any);
    }
  }
  return databasePromise;
}

async function ensureSchema() {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      const database = await db();
      await database.execute("PRAGMA busy_timeout = 5000");
      await database.execute(`CREATE TABLE IF NOT EXISTS hotel_commercial_guest_refs (
        company_id TEXT NOT NULL,
        booking_id TEXT NOT NULL,
        sort_order INTEGER NOT NULL DEFAULT 0,
        guest_name TEXT NOT NULL DEFAULT '',
        PRIMARY KEY (company_id, booking_id, sort_order)
      )`);
      await database.execute(`CREATE TABLE IF NOT EXISTS hotel_operational_reservations (
        company_id TEXT NOT NULL,
        booking_id TEXT NOT NULL,
        hotel_sort_order INTEGER NOT NULL DEFAULT 0,
        confirmation_voucher TEXT NOT NULL DEFAULT '',
        meal_plan TEXT NOT NULL DEFAULT '',
        reservation_status TEXT NOT NULL DEFAULT '',
        PRIMARY KEY (company_id, booking_id, hotel_sort_order)
      )`);
      await database.execute(`CREATE TABLE IF NOT EXISTS hotel_operational_guests (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        booking_id TEXT NOT NULL,
        given_name TEXT NOT NULL DEFAULT '',
        surname TEXT NOT NULL DEFAULT '',
        passport_number TEXT NOT NULL DEFAULT '',
        hotel_sort_order INTEGER NOT NULL DEFAULT 0,
        room_allocation TEXT NOT NULL DEFAULT '',
        sort_order INTEGER NOT NULL DEFAULT 0
      )`);
      await database.execute(`CREATE TABLE IF NOT EXISTS hotel_operational_meta (
        booking_id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        customer_contact TEXT NOT NULL DEFAULT '',
        special_requests TEXT NOT NULL DEFAULT '',
        checkin_instructions TEXT NOT NULL DEFAULT '',
        notes TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`);
      await database.execute(
        `CREATE INDEX IF NOT EXISTS idx_hotel_operational_guests ON hotel_operational_guests(company_id,booking_id,sort_order)`,
      );
    })().catch((error) => {
      schemaPromise = null;
      throw error;
    });
  }
  return schemaPromise;
}

async function audit(companyId: string, userId: string, bookingId: string, details: string) {
  if (!userId || !isDesktopApp()) return;
  const database = await db();
  const users = await database.select<Array<{ full_name: string }>>(
    `SELECT full_name FROM users WHERE id=$1 AND company_id=$2 LIMIT 1`,
    [userId, companyId],
  );
  await database.execute(
    `INSERT INTO audit_logs (id,company_id,user_id,user_name,action,module,record_id,details,created_at)
     VALUES ($1,$2,$3,$4,'BOOKING_DETAILS_UPDATED','HOTEL',$5,$6,$7)`,
    [
      crypto.randomUUID(),
      companyId,
      userId,
      users[0]?.full_name || "Unknown User",
      bookingId,
      details,
      new Date().toISOString(),
    ],
  );
}

export async function saveHotelGuestRefs(companyId: string, bookingId: string, guestNames: string[], userId = "") {
  await requirePermission(companyId, userId, "edit_bookings");
  await ensureSchema();
  const rows = guestNames.map((guestName, index) => ({
    company_id: companyId,
    booking_id: bookingId,
    sort_order: index,
    guest_name: guestName.trim(),
  }));

  if (isDesktopApp()) {
    const database = await db();
    await database.execute(`DELETE FROM hotel_commercial_guest_refs WHERE company_id=$1 AND booking_id=$2`, [
      companyId,
      bookingId,
    ]);
    for (const row of rows) {
      await database.execute(
        `INSERT INTO hotel_commercial_guest_refs (company_id,booking_id,sort_order,guest_name) VALUES ($1,$2,$3,$4)`,
        [row.company_id, row.booking_id, row.sort_order, row.guest_name],
      );
    }
  }

  await syncHotelGuestRefs(bookingId, companyId, rows);
  if (isDesktopApp()) await flushDesktopSyncQueue();
}

export async function getHotelGuestRefsByBookingIds(
  companyId: string,
  bookingIds: string[],
): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  const ids = bookingIds.filter(Boolean);
  if (!ids.length) return map;

  await ensureSchema();

  if (!isDesktopApp()) {
    const { data, error } = await supabase
      .from("hotel_commercial_guest_refs")
      .select("booking_id,sort_order,guest_name")
      .eq("company_id", companyId)
      .in("booking_id", ids)
      .order("sort_order");
    if (error) throw new Error(error.message);

    for (const row of data || []) {
      const bookingId = String(row.booking_id);
      const current = map.get(bookingId) || [];
      current.push(String(row.guest_name || ""));
      map.set(bookingId, current);
    }
    return map;
  }

  const database = await db();
  const placeholders = ids.map((_, index) => `$${index + 2}`).join(",");
  const rows = await database.select<Array<{ booking_id: string; guest_name: string; sort_order: number }>>(
    `SELECT booking_id,sort_order,guest_name FROM hotel_commercial_guest_refs
     WHERE company_id=$1 AND booking_id IN (${placeholders})
     ORDER BY booking_id,sort_order`,
    [companyId, ...ids],
  );
  for (const row of rows) {
    const bookingId = String(row.booking_id);
    const current = map.get(bookingId) || [];
    current.push(String(row.guest_name || ""));
    map.set(bookingId, current);
  }
  return map;
}

export async function getHotelOperationalDetails(
  companyId: string,
  bookingId: string,
): Promise<HotelOperationalDetails> {
  await ensureSchema();

  if (!isDesktopApp()) {
    const [guestRefRes, reservationRes, guestRes, metaRes] = await Promise.all([
      supabase
        .from("hotel_commercial_guest_refs")
        .select("sort_order,guest_name")
        .eq("company_id", companyId)
        .eq("booking_id", bookingId)
        .order("sort_order"),
      supabase
        .from("hotel_operational_reservations")
        .select("hotel_sort_order,confirmation_voucher,meal_plan,reservation_status")
        .eq("company_id", companyId)
        .eq("booking_id", bookingId)
        .order("hotel_sort_order"),
      supabase
        .from("hotel_operational_guests")
        .select("id,given_name,surname,passport_number,hotel_sort_order,room_allocation,sort_order")
        .eq("company_id", companyId)
        .eq("booking_id", bookingId)
        .order("sort_order"),
      supabase
        .from("hotel_operational_meta")
        .select("customer_contact,special_requests,checkin_instructions,notes")
        .eq("company_id", companyId)
        .eq("booking_id", bookingId)
        .maybeSingle(),
    ]);
    if (guestRefRes.error) throw new Error(guestRefRes.error.message);
    if (reservationRes.error) throw new Error(reservationRes.error.message);
    if (guestRes.error) throw new Error(guestRes.error.message);
    if (metaRes.error) throw new Error(metaRes.error.message);

    return {
      guestRefs: (guestRefRes.data || []).map((item) => item.guest_name),
      reservations: (reservationRes.data || []).map((item) => ({
        hotelSortOrder: item.hotel_sort_order,
        confirmationVoucher: item.confirmation_voucher,
        mealPlan: item.meal_plan,
        reservationStatus: item.reservation_status as HotelReservationStatus,
      })),
      guests: (guestRes.data || []).map((item) => ({
        id: item.id,
        givenName: item.given_name,
        surname: item.surname,
        passportNumber: item.passport_number,
        hotelSortOrder: item.hotel_sort_order,
        roomAllocation: item.room_allocation,
        sortOrder: item.sort_order,
      })),
      customerContact: metaRes.data?.customer_contact || "",
      specialRequests: metaRes.data?.special_requests || "",
      checkinInstructions: metaRes.data?.checkin_instructions || "",
      notes: metaRes.data?.notes || "",
    };
  }

  const database = await db();
  const guestRefs = await database.select<Array<{ sort_order: number; guest_name: string }>>(
    `SELECT sort_order,guest_name FROM hotel_commercial_guest_refs WHERE company_id=$1 AND booking_id=$2 ORDER BY sort_order`,
    [companyId, bookingId],
  );
  const reservations = await database.select<
    Array<{
      hotel_sort_order: number;
      confirmation_voucher: string;
      meal_plan: string;
      reservation_status: HotelReservationStatus;
    }>
  >(
    `SELECT hotel_sort_order,confirmation_voucher,meal_plan,reservation_status FROM hotel_operational_reservations WHERE company_id=$1 AND booking_id=$2 ORDER BY hotel_sort_order`,
    [companyId, bookingId],
  );
  const guests = await database.select<
    Array<{
      id: string;
      given_name: string;
      surname: string;
      passport_number: string;
      hotel_sort_order: number;
      room_allocation: string;
      sort_order: number;
    }>
  >(
    `SELECT id,given_name,surname,passport_number,hotel_sort_order,room_allocation,sort_order FROM hotel_operational_guests WHERE company_id=$1 AND booking_id=$2 ORDER BY sort_order`,
    [companyId, bookingId],
  );
  const meta = await database.select<
    Array<{ customer_contact: string; special_requests: string; checkin_instructions: string; notes: string }>
  >(
    `SELECT customer_contact,special_requests,checkin_instructions,notes FROM hotel_operational_meta WHERE company_id=$1 AND booking_id=$2 LIMIT 1`,
    [companyId, bookingId],
  );
  return {
    guestRefs: guestRefs.map((item) => item.guest_name),
    reservations: reservations.map((item) => ({
      hotelSortOrder: item.hotel_sort_order,
      confirmationVoucher: item.confirmation_voucher,
      mealPlan: item.meal_plan,
      reservationStatus: item.reservation_status,
    })),
    guests: guests.map((item) => ({
      id: item.id,
      givenName: item.given_name,
      surname: item.surname,
      passportNumber: item.passport_number,
      hotelSortOrder: item.hotel_sort_order,
      roomAllocation: item.room_allocation,
      sortOrder: item.sort_order,
    })),
    customerContact: meta[0]?.customer_contact || "",
    specialRequests: meta[0]?.special_requests || "",
    checkinInstructions: meta[0]?.checkin_instructions || "",
    notes: meta[0]?.notes || "",
  };
}

export async function saveHotelOperationalDetails(
  companyId: string,
  bookingId: string,
  input: SaveHotelOperationalInput,
  userId = "",
) {
  await requirePermission(companyId, userId, "edit_bookings");
  const { enforceFeature } = await import("./companyAccess");
  await enforceFeature(companyId, "additional_booking_details", "Additional booking details");
  await ensureSchema();
  const now = new Date().toISOString();

  let createdAt: string;
  let guestRefRows: Array<{ sort_order: number; guest_name: string }>;

  if (isDesktopApp()) {
    const database = await db();
    const existingMeta = await database.select<Array<{ created_at: string }>>(
      `SELECT created_at FROM hotel_operational_meta WHERE booking_id=$1 LIMIT 1`,
      [bookingId],
    );
    createdAt = existingMeta[0]?.created_at || now;
    guestRefRows = await database.select<Array<{ sort_order: number; guest_name: string }>>(
      `SELECT sort_order,guest_name FROM hotel_commercial_guest_refs WHERE company_id=$1 AND booking_id=$2 ORDER BY sort_order`,
      [companyId, bookingId],
    );
  } else {
    const [metaRes, guestRefRes] = await Promise.all([
      supabase.from("hotel_operational_meta").select("created_at").eq("booking_id", bookingId).maybeSingle(),
      supabase
        .from("hotel_commercial_guest_refs")
        .select("sort_order,guest_name")
        .eq("company_id", companyId)
        .eq("booking_id", bookingId)
        .order("sort_order"),
    ]);
    if (metaRes.error) throw new Error(metaRes.error.message);
    if (guestRefRes.error) throw new Error(guestRefRes.error.message);
    createdAt = metaRes.data?.created_at || now;
    guestRefRows = guestRefRes.data || [];
  }

  const reservationRows = input.reservations.map((item) => ({
    company_id: companyId,
    booking_id: bookingId,
    hotel_sort_order: item.hotelSortOrder,
    confirmation_voucher: item.confirmationVoucher.trim(),
    meal_plan: item.mealPlan.trim(),
    reservation_status: item.reservationStatus,
  }));
  const guestRows = input.guests.map((guest, index) => ({
    id: crypto.randomUUID(),
    company_id: companyId,
    booking_id: bookingId,
    given_name: guest.givenName.trim(),
    surname: guest.surname.trim(),
    passport_number: guest.passportNumber.trim().toUpperCase(),
    hotel_sort_order: guest.hotelSortOrder,
    room_allocation: guest.roomAllocation.trim(),
    sort_order: index,
  }));

  if (isDesktopApp()) {
    const database = await db();
    await database.execute(`DELETE FROM hotel_operational_reservations WHERE company_id=$1 AND booking_id=$2`, [
      companyId,
      bookingId,
    ]);
    await database.execute(`DELETE FROM hotel_operational_guests WHERE company_id=$1 AND booking_id=$2`, [
      companyId,
      bookingId,
    ]);
    for (const item of input.reservations) {
      await database.execute(
        `INSERT INTO hotel_operational_reservations (company_id,booking_id,hotel_sort_order,confirmation_voucher,meal_plan,reservation_status)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [
          companyId,
          bookingId,
          item.hotelSortOrder,
          item.confirmationVoucher.trim(),
          item.mealPlan.trim(),
          item.reservationStatus,
        ],
      );
    }
    for (const guest of guestRows) {
      await database.execute(
        `INSERT INTO hotel_operational_guests (id,company_id,booking_id,given_name,surname,passport_number,hotel_sort_order,room_allocation,sort_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          guest.id,
          guest.company_id,
          guest.booking_id,
          guest.given_name,
          guest.surname,
          guest.passport_number,
          guest.hotel_sort_order,
          guest.room_allocation,
          guest.sort_order,
        ],
      );
    }
    await database.execute(
      `INSERT INTO hotel_operational_meta (booking_id,company_id,customer_contact,special_requests,checkin_instructions,notes,created_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$7)
       ON CONFLICT(booking_id) DO UPDATE SET company_id=excluded.company_id,customer_contact=excluded.customer_contact,special_requests=excluded.special_requests,checkin_instructions=excluded.checkin_instructions,notes=excluded.notes,updated_at=excluded.updated_at`,
      [
        bookingId,
        companyId,
        input.customerContact.trim(),
        input.specialRequests.trim(),
        input.checkinInstructions.trim(),
        input.notes.trim(),
        now,
      ],
    );
    await audit(
      companyId,
      userId,
      bookingId,
      "Hotel reservation, voucher and rooming details updated without changing hotel totals.",
    );
  }

  await syncHotelOperationalBundle(bookingId, companyId, {
    customerContact: input.customerContact.trim(),
    specialRequests: input.specialRequests.trim(),
    checkinInstructions: input.checkinInstructions.trim(),
    notes: input.notes.trim(),
    createdAt,
    updatedAt: now,
    guestRefs: guestRefRows.map((row) => ({
      company_id: companyId,
      booking_id: bookingId,
      sort_order: row.sort_order,
      guest_name: row.guest_name,
    })),
    reservations: reservationRows,
    guests: guestRows,
  });
  await queueSync("UPDATE", "hotel_bookings", bookingId, { updated_at: now });
  if (isDesktopApp()) await flushDesktopSyncQueue();
}
