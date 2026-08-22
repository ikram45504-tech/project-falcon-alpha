import Database from "@tauri-apps/plugin-sql";
import type { TicketTravelStatus, VisaPassportDetailInput } from "./db";
import { hasPermission, type UserRole } from "./permissions";

const DB_PATH = "sqlite:travel-accounting.db";
let databasePromise: Promise<Database> | null = null;

async function db() {
  if (!databasePromise) databasePromise = Database.load(DB_PATH);
  return databasePromise;
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
    throw new Error("You do not have permission to edit booking details.");
  }
}

async function audit(companyId: string, userId: string, module: string, bookingId: string, details: string) {
  if (!userId) return;
  const database = await db();
  const users = await database.select<Array<{ full_name: string }>>(
    `SELECT full_name FROM users WHERE id=$1 AND company_id=$2 LIMIT 1`,
    [userId, companyId],
  );
  await database.execute(
    `INSERT INTO audit_logs (id,company_id,user_id,user_name,action,module,record_id,details,created_at)
     VALUES ($1,$2,$3,$4,'BOOKING_DETAILS_UPDATED',$5,$6,$7,$8)`,
    [
      crypto.randomUUID(),
      companyId,
      userId,
      users[0]?.full_name || "Unknown User",
      module,
      bookingId,
      details,
      new Date().toISOString(),
    ],
  );
}

export async function updateTicketAdditionalDetails(
  companyId: string,
  bookingId: string,
  input: {
    flightNo: string;
    departureTime: string;
    arrivalTime: string;
    baggage: string;
    ticketStatus: TicketTravelStatus;
    customerContact: string;
    notes: string;
  },
  userId = "",
) {
  await requireEdit(companyId, userId);
  const database = await db();
  await database.execute(
    `UPDATE ticket_bookings SET flight_no=$1,departure_time=$2,arrival_time=$3,baggage=$4,ticket_status=$5,customer_contact=$6,notes=$7,updated_at=$8,updated_by_user_id=$9
     WHERE id=$10 AND company_id=$11 AND status='ACTIVE'`,
    [
      input.flightNo.trim(),
      input.departureTime,
      input.arrivalTime,
      input.baggage.trim(),
      input.ticketStatus,
      input.customerContact.trim(),
      input.notes.trim(),
      new Date().toISOString(),
      userId,
      bookingId,
      companyId,
    ],
  );
  await audit(
    companyId,
    userId,
    "TICKET",
    bookingId,
    "Ticket operational details updated without changing fare totals.",
  );
}

export async function updateHotelAdditionalDetails(
  companyId: string,
  bookingId: string,
  input: {
    confirmationVoucher: string;
    mealPlan: string;
    guestFamilyName: string;
    guestCount: number;
    customerContact: string;
    specialRequests: string;
    notes: string;
  },
  userId = "",
) {
  await requireEdit(companyId, userId);
  const database = await db();
  await database.execute(
    `UPDATE hotel_bookings SET confirmation_voucher=$1,meal_plan=$2,guest_family_name=$3,guest_count=$4,customer_contact=$5,special_requests=$6,notes=$7,updated_at=$8,updated_by_user_id=$9
     WHERE id=$10 AND company_id=$11 AND status='ACTIVE'`,
    [
      input.confirmationVoucher.trim(),
      input.mealPlan.trim(),
      input.guestFamilyName.trim(),
      Math.max(0, Math.trunc(input.guestCount || 0)),
      input.customerContact.trim(),
      input.specialRequests.trim(),
      input.notes.trim(),
      new Date().toISOString(),
      userId,
      bookingId,
      companyId,
    ],
  );
  await audit(
    companyId,
    userId,
    "HOTEL",
    bookingId,
    "Hotel reservation details updated without changing hotel totals.",
  );
}

export async function updateTransportAdditionalDetails(
  companyId: string,
  bookingId: string,
  input: { paxSaudiNumber: string; notes: string },
  userId = "",
) {
  await requireEdit(companyId, userId);
  const database = await db();
  await database.execute(
    `UPDATE transport_bookings SET pax_saudi_number=$1,notes=$2,updated_at=$3,updated_by_user_id=$4
     WHERE id=$5 AND company_id=$6 AND status='ACTIVE'`,
    [input.paxSaudiNumber.trim(), input.notes.trim(), new Date().toISOString(), userId, bookingId, companyId],
  );
  await audit(
    companyId,
    userId,
    "TRANSPORT",
    bookingId,
    "Transport operational details updated without changing transport totals.",
  );
}

export async function updateVisaAdditionalDetails(
  companyId: string,
  bookingId: string,
  input: {
    expectedEntryDate: string;
    notes: string;
    passports: VisaPassportDetailInput[];
  },
  userId = "",
) {
  await requireEdit(companyId, userId);
  const database = await db();
  await database.execute(
    `UPDATE visa_bookings SET expected_entry_date=$1,notes=$2,updated_at=$3,updated_by_user_id=$4
     WHERE id=$5 AND company_id=$6 AND status='ACTIVE'`,
    [input.expectedEntryDate, input.notes.trim(), new Date().toISOString(), userId, bookingId, companyId],
  );
  await database.execute(`DELETE FROM visa_passport_details WHERE booking_id=$1`, [bookingId]);
  for (const [index, passenger] of input.passports.entries()) {
    const passengerName = [passenger.givenName.trim(), passenger.surname.trim()].filter(Boolean).join(" ");
    await database.execute(
      `INSERT INTO visa_passport_details
       (id,booking_id,source_family_name,passenger_name,passenger_type,visa_type,surname,given_name,passport_number,nationality,date_of_birth,passport_issuance,passport_expiry,sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [
        crypto.randomUUID(),
        bookingId,
        passenger.sourceFamilyName.trim(),
        passengerName,
        passenger.passengerType,
        passenger.visaType,
        passenger.surname.trim(),
        passenger.givenName.trim(),
        passenger.passportNumber.trim(),
        passenger.nationality.trim(),
        passenger.dateOfBirth,
        passenger.passportIssuance,
        passenger.passportExpiry,
        index,
      ],
    );
  }
  await audit(
    companyId,
    userId,
    "VISA",
    bookingId,
    "Visa passenger/passport details updated without changing visa totals.",
  );
}

// ---------------------------------------------------------------------------
// DEPRECATED: The functions below target misc_booking_details, a legacy table
// that was superseded by MiscOperationalDb.ts (misc_operational_meta +
// misc_operational_services). New code should use MiscOperationalDb instead.
// These functions are kept only to avoid breaking any legacy callers.
// ---------------------------------------------------------------------------

async function ensureMiscDetails() {
  const database = await db();
  await database.execute(`CREATE TABLE IF NOT EXISTS misc_booking_details (
    booking_id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    notes TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`);
}

/** @deprecated Use getMiscOperationalDetails from MiscOperationalDb.ts instead. */
export async function getMiscAdditionalDetails(companyId: string, bookingId: string) {
  await ensureMiscDetails();
  const database = await db();
  const rows = await database.select<Array<{ notes: string }>>(
    `SELECT notes FROM misc_booking_details WHERE company_id=$1 AND booking_id=$2 LIMIT 1`,
    [companyId, bookingId],
  );
  return rows[0]?.notes || "";
}

/** @deprecated Use saveMiscOperationalDetails from MiscOperationalDb.ts instead. */
export async function updateMiscAdditionalDetails(companyId: string, bookingId: string, notes: string, userId = "") {
  await requireEdit(companyId, userId);
  await ensureMiscDetails();
  const database = await db();
  const now = new Date().toISOString();
  await database.execute(
    `INSERT INTO misc_booking_details (booking_id,company_id,notes,created_at,updated_at) VALUES ($1,$2,$3,$4,$4)
     ON CONFLICT(booking_id) DO UPDATE SET company_id=excluded.company_id,notes=excluded.notes,updated_at=excluded.updated_at`,
    [bookingId, companyId, notes.trim(), now],
  );
  await audit(companyId, userId, "MISC", bookingId, "Misc optional details updated without changing service totals.");
}
