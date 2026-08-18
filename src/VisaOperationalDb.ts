import Database from "@tauri-apps/plugin-sql";
import type { VisaPassengerType, VisaType } from "./db";
import { hasPermission, type UserRole } from "./permissions";

const DB_PATH = "sqlite:travel-accounting.db";
let databasePromise: Promise<Database> | null = null;
let schemaPromise: Promise<void> | null = null;

export type VisaOperationalPassenger = {
  id: string;
  sourceFamilyName: string;
  passengerType: VisaPassengerType;
  visaType: VisaType;
  givenName: string;
  surname: string;
  passportNumber: string;
  nationality: string;
  dateOfBirth: string;
  passportIssuance: string;
  passportExpiry: string;
  visaNumber: string;
  mofaReference: string;
  sortOrder: number;
};

export type VisaOperationalDetails = {
  expectedEntryDate: string;
  passengers: VisaOperationalPassenger[];
  notes: string;
};

export type SaveVisaOperationalInput = {
  expectedEntryDate: string;
  passengers: Array<Omit<VisaOperationalPassenger, "id" | "sortOrder">>;
  notes: string;
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
      await database.execute(`CREATE TABLE IF NOT EXISTS visa_operational_meta (
        booking_id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        expected_entry_date TEXT NOT NULL DEFAULT '',
        notes TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`);
      await database.execute(`CREATE TABLE IF NOT EXISTS visa_operational_passengers (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        booking_id TEXT NOT NULL,
        source_family_name TEXT NOT NULL DEFAULT '',
        passenger_type TEXT NOT NULL,
        visa_type TEXT NOT NULL,
        given_name TEXT NOT NULL DEFAULT '',
        surname TEXT NOT NULL DEFAULT '',
        passport_number TEXT NOT NULL DEFAULT '',
        nationality TEXT NOT NULL DEFAULT '',
        date_of_birth TEXT NOT NULL DEFAULT '',
        passport_issuance TEXT NOT NULL DEFAULT '',
        passport_expiry TEXT NOT NULL DEFAULT '',
        visa_number TEXT NOT NULL DEFAULT '',
        mofa_reference TEXT NOT NULL DEFAULT '',
        sort_order INTEGER NOT NULL DEFAULT 0
      )`);
      await database.execute(`CREATE INDEX IF NOT EXISTS idx_visa_operational_passengers ON visa_operational_passengers(company_id,booking_id,sort_order)`);
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
    [userId, companyId]
  );
  const actor = rows[0];
  if (!actor || actor.status !== "ACTIVE" || !hasPermission(actor.role, "edit_bookings")) {
    throw new Error("You do not have permission to edit Visa booking details.");
  }
}

async function audit(companyId: string, userId: string, bookingId: string) {
  if (!userId) return;
  const database = await db();
  const users = await database.select<Array<{ full_name: string }>>(
    `SELECT full_name FROM users WHERE id=$1 AND company_id=$2 LIMIT 1`,
    [userId, companyId]
  );
  await database.execute(
    `INSERT INTO audit_logs (id,company_id,user_id,user_name,action,module,record_id,details,created_at)
     VALUES ($1,$2,$3,$4,'BOOKING_DETAILS_UPDATED','VISA',$5,$6,$7)`,
    [crypto.randomUUID(), companyId, userId, users[0]?.full_name || "Unknown User", bookingId, "Visa passenger, passport, Visa Number and MOFA reference details updated without changing Visa totals.", new Date().toISOString()]
  );
}

export async function getVisaOperationalDetails(companyId: string, bookingId: string): Promise<VisaOperationalDetails> {
  await ensureSchema();
  const database = await db();
  const passengers = await database.select<Array<{
    id: string; source_family_name: string; passenger_type: VisaPassengerType; visa_type: VisaType; given_name: string; surname: string;
    passport_number: string; nationality: string; date_of_birth: string; passport_issuance: string; passport_expiry: string; visa_number: string; mofa_reference: string; sort_order: number;
  }>>(
    `SELECT id,source_family_name,passenger_type,visa_type,given_name,surname,passport_number,nationality,date_of_birth,passport_issuance,passport_expiry,visa_number,mofa_reference,sort_order
     FROM visa_operational_passengers WHERE company_id=$1 AND booking_id=$2 ORDER BY sort_order`,
    [companyId, bookingId]
  );
  const meta = await database.select<Array<{ expected_entry_date: string; notes: string }>>(
    `SELECT expected_entry_date,notes FROM visa_operational_meta WHERE company_id=$1 AND booking_id=$2 LIMIT 1`,
    [companyId, bookingId]
  );
  return {
    expectedEntryDate: meta[0]?.expected_entry_date || "",
    notes: meta[0]?.notes || "",
    passengers: passengers.map((item) => ({
      id: item.id,
      sourceFamilyName: item.source_family_name,
      passengerType: item.passenger_type,
      visaType: item.visa_type,
      givenName: item.given_name,
      surname: item.surname,
      passportNumber: item.passport_number,
      nationality: item.nationality,
      dateOfBirth: item.date_of_birth,
      passportIssuance: item.passport_issuance,
      passportExpiry: item.passport_expiry,
      visaNumber: item.visa_number,
      mofaReference: item.mofa_reference,
      sortOrder: item.sort_order,
    })),
  };
}

export async function saveVisaOperationalDetails(companyId: string, bookingId: string, input: SaveVisaOperationalInput, userId = "") {
  await requireEdit(companyId, userId);
  await ensureSchema();
  const database = await db();
  const now = new Date().toISOString();
  await database.execute(`DELETE FROM visa_operational_passengers WHERE company_id=$1 AND booking_id=$2`, [companyId, bookingId]);
  for (const [index, passenger] of input.passengers.entries()) {
    await database.execute(
      `INSERT INTO visa_operational_passengers
       (id,company_id,booking_id,source_family_name,passenger_type,visa_type,given_name,surname,passport_number,nationality,date_of_birth,passport_issuance,passport_expiry,visa_number,mofa_reference,sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
      [crypto.randomUUID(), companyId, bookingId, passenger.sourceFamilyName.trim(), passenger.passengerType, passenger.visaType, passenger.givenName.trim(), passenger.surname.trim(), passenger.passportNumber.trim().toUpperCase(), passenger.nationality.trim(), passenger.dateOfBirth, passenger.passportIssuance, passenger.passportExpiry, passenger.visaNumber.trim().toUpperCase(), passenger.mofaReference.trim().toUpperCase(), index]
    );
  }
  await database.execute(
    `INSERT INTO visa_operational_meta (booking_id,company_id,expected_entry_date,notes,created_at,updated_at)
     VALUES ($1,$2,$3,$4,$5,$5)
     ON CONFLICT(booking_id) DO UPDATE SET company_id=excluded.company_id,expected_entry_date=excluded.expected_entry_date,notes=excluded.notes,updated_at=excluded.updated_at`,
    [bookingId, companyId, input.expectedEntryDate, input.notes.trim(), now]
  );
  await audit(companyId, userId, bookingId);
}
