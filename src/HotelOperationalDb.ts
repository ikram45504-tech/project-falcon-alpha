import Database from "@tauri-apps/plugin-sql";
import { hasPermission, type UserRole } from "./permissions";

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
  if (!databasePromise) databasePromise = Database.load(DB_PATH);
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

async function requireEdit(companyId: string, userId: string) {
  if (!userId) return;
  const database = await db();
  const rows = await database.select<Array<{ role: UserRole; status: string }>>(
    `SELECT role,status FROM users WHERE id=$1 AND company_id=$2 LIMIT 1`,
    [userId, companyId],
  );
  const actor = rows[0];
  if (!actor || actor.status !== "ACTIVE" || !hasPermission(actor.role, "edit_bookings")) {
    throw new Error("You do not have permission to edit Hotel booking details.");
  }
}

async function audit(companyId: string, userId: string, bookingId: string, details: string) {
  if (!userId) return;
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
  await requireEdit(companyId, userId);
  await ensureSchema();
  const database = await db();
  await database.execute(`DELETE FROM hotel_commercial_guest_refs WHERE company_id=$1 AND booking_id=$2`, [
    companyId,
    bookingId,
  ]);
  for (const [index, guestName] of guestNames.entries()) {
    await database.execute(
      `INSERT INTO hotel_commercial_guest_refs (company_id,booking_id,sort_order,guest_name) VALUES ($1,$2,$3,$4)`,
      [companyId, bookingId, index, guestName.trim()],
    );
  }
}

export async function getHotelOperationalDetails(
  companyId: string,
  bookingId: string,
): Promise<HotelOperationalDetails> {
  await ensureSchema();
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
  await requireEdit(companyId, userId);
  await ensureSchema();
  const database = await db();
  const now = new Date().toISOString();
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
  for (const [index, guest] of input.guests.entries()) {
    await database.execute(
      `INSERT INTO hotel_operational_guests (id,company_id,booking_id,given_name,surname,passport_number,hotel_sort_order,room_allocation,sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        crypto.randomUUID(),
        companyId,
        bookingId,
        guest.givenName.trim(),
        guest.surname.trim(),
        guest.passportNumber.trim().toUpperCase(),
        guest.hotelSortOrder,
        guest.roomAllocation.trim(),
        index,
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
