import Database from "@tauri-apps/plugin-sql";
import { supabase } from "./supabaseClient";
import { createPasswordRecord, verifyPassword } from "./security";
import { hasPermission, Permission, UserRole } from "./permissions";
import {
  applyCloudOperation,
  queueSync as enqueueCloudSync,
  syncPackageBookingVoid,
  type SyncOperation as CloudSyncOperation,
} from "./cloudSync";

const DB_PATH = "sqlite:travel-accounting.db";
let databasePromise: Promise<Database> | null = null;
let initializationPromise: Promise<void> | null = null;

export type Company = {
  id: string;
  company_code: string;
  name: string;
  dts_license: string;
  logo_data: string | null;
  address: string;
  phone: string;
  whatsapp: string;
  email: string;
  base_currency: string;
  foreign_currency: string;
  status: "ACTIVE" | "PENDING_APPROVAL" | "SUSPENDED" | "INACTIVE";
  created_at: string;
  updated_at: string;
};

export type UserSession = {
  userId: string;
  companyId: string;
  companyCode: string;
  companyName: string;
  fullName: string;
  username: string;
  email: string;
  phone: string;
  role: UserRole;
};

export type CompanyUser = {
  id: string;
  company_id: string;
  full_name: string;
  username: string;
  email: string;
  phone: string;
  role: UserRole;
  status: "ACTIVE" | "DISABLED";
  created_at: string;
  updated_at: string;
  last_login_at: string;
};

export type AuditLog = {
  id: string;
  company_id: string;
  user_id: string;
  user_name: string;
  action: string;
  module: string;
  record_id: string;
  details: string;
  created_at: string;
};

export type Party = {
  id: string;
  company_id: string;
  name: string;
  phone: string;
  whatsapp: string;
  address: string;
  notes: string;
  status: "ACTIVE" | "INACTIVE";
  account_type: "PARTY" | "VENDOR" | "UNASSIGNED";
  created_at: string;
  updated_at: string;
};

export type PartyInput = {
  name: string;
  phone: string;
  whatsapp: string;
  address: string;
  notes: string;
  status: "ACTIVE" | "INACTIVE";
  accountType: "PARTY" | "VENDOR" | "UNASSIGNED";
};

export type AccommodationEntry = {
  id: string;
  company_id: string;
  party_id: string;
  ledger_party_name: string;
  transaction_date: string;
  ub_number: string;
  booking_party_name: string;
  city: string;
  hotel_name: string;
  check_in: string;
  check_out: string;
  nights: number;
  rate: number;
  bed_room_count: number;
  currency: "PKR" | "SAR";
  roe: number;
  total_sar: number;
  total_pkr: number;
  status: "ACTIVE" | "VOID";
  created_at: string;
  updated_at: string;
};

export type AccommodationInput = {
  partyId: string;
  transactionDate: string;
  ubNumber: string;
  bookingPartyName: string;
  city: string;
  hotelName: string;
  checkIn: string;
  checkOut: string;
  nights: number;
  rate: number;
  bedRoomCount: number;
  currency: "PKR" | "SAR";
  roe: number;
};

export type ServiceEntry = {
  id: string;
  company_id: string;
  party_id: string;
  ledger_party_name: string;
  transaction_date: string;
  ub_number: string;
  booking_party_name: string;
  service_type: string;
  rate: number;
  pax: number;
  spt: number;
  shr: number;
  currency: "PKR" | "SAR";
  roe: number;
  total_sar: number;
  total_pkr: number;
  status: "ACTIVE" | "VOID";
  created_at: string;
  updated_at: string;
};

export type ServiceInput = {
  partyId: string;
  transactionDate: string;
  ubNumber: string;
  bookingPartyName: string;
  serviceType: string;
  rate: number;
  pax: number;
  spt: number;
  shr: number;
  currency: "PKR" | "SAR";
  roe: number;
};

export type PartyServiceTotal = {
  party_id: string;
  total_pkr: number;
};

export type PaymentEntry = {
  id: string;
  company_id: string;
  party_id: string;
  ledger_party_name: string;
  transaction_date: string;
  receipt_no: string;
  from_account: string;
  to_account: string;
  description: string;
  payment_type: "BANK" | "CASH";
  currency: "PKR" | "SAR";
  amount_entered: number;
  sar: number;
  roe: number;
  paid_amount: number;
  status: "ACTIVE" | "VOID";
  created_at: string;
  updated_at: string;
};

export type PaymentInput = {
  partyId: string;
  transactionDate: string;
  receiptNo: string;
  fromAccount: string;
  toAccount: string;
  description: string;
  paymentType: "BANK" | "CASH";
  currency: "PKR" | "SAR";
  amount: number;
  roe: number;
};

export type PartyPaymentTotal = {
  party_id: string;
  paid_amount: number;
};

export type PartyAccommodationTotal = {
  party_id: string;
  total_pkr: number;
};

export type BookingTransactionType = "SALE" | "PURCHASE";
export type PackagePassengerType = "ADULT" | "CHILD" | "INFANT";

export type PackageBookingLine = {
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

export type PackageBooking = {
  id: string;
  company_id: string;
  transaction_type: BookingTransactionType;
  counterparty_id: string;
  counterparty_name: string;
  transaction_date: string;
  ub_number: string;
  package_description: string;
  departure_date: string;
  return_date: string;
  no_of_days: number;
  ziarat_included: string;
  customer_contact: string;
  notes: string;
  total_pkr: number;
  status: "ACTIVE" | "VOID";
  created_at: string;
  updated_at: string;
  lines: PackageBookingLine[];
};

export type PackageBookingLineInput = {
  passengerType: PackagePassengerType;
  passengerName: string;
  packageType: string;
  ratePerPerson: number;
  personCount: number | null;
  qtyIsExplicit: boolean;
};

export type PackageBookingInput = {
  transactionType: BookingTransactionType;
  counterpartyId: string;
  transactionDate: string;
  ubNumber: string;
  packageDescription: string;
  departureDate: string;
  returnDate: string;
  noOfDays: number;
  ziaratIncluded: "" | "YES" | "NO";
  customerContact: string;
  notes: string;
  lines: PackageBookingLineInput[];
};

export type CompanyPackageSummary = {
  sale_total: number;
  purchase_total: number;
  active_count: number;
};

export type CounterpartyPackageTotal = {
  counterparty_id: string;
  sale_total: number;
  purchase_total: number;
};

export type TicketPassengerType = "ADULT" | "CHILD" | "INFANT";
export type TicketTravelStatus = "" | "RESERVED" | "ISSUED" | "CANCELLED" | "REFUNDED";

export type TicketBookingLine = {
  id: string;
  booking_id: string;
  passenger_type: TicketPassengerType;
  passenger_name: string;
  eticket_reference: string;
  rate_per_ticket: number;
  ticket_count: number;
  qty_is_explicit: number;
  line_total_pkr: number;
  sort_order: number;
};

export type TicketBooking = {
  id: string;
  company_id: string;
  transaction_type: BookingTransactionType;
  counterparty_id: string;
  counterparty_name: string;
  transaction_date: string;
  ub_number: string;
  airline_name: string;
  pnr: string;
  sector: string;
  departure_date: string;
  return_date: string;
  flight_no: string;
  departure_time: string;
  arrival_time: string;
  baggage: string;
  ticket_status: TicketTravelStatus;
  customer_contact: string;
  notes: string;
  total_pkr: number;
  status: "ACTIVE" | "VOID";
  created_at: string;
  updated_at: string;
  lines: TicketBookingLine[];
};

export type TicketBookingLineInput = {
  passengerType: TicketPassengerType;
  passengerName: string;
  eticketReference: string;
  ratePerTicket: number;
  ticketCount: number | null;
  qtyIsExplicit: boolean;
};

export type TicketBookingInput = {
  transactionType: BookingTransactionType;
  counterpartyId: string;
  transactionDate: string;
  ubNumber: string;
  airlineName: string;
  pnr: string;
  sector: string;
  departureDate: string;
  returnDate: string;
  flightNo: string;
  departureTime: string;
  arrivalTime: string;
  baggage: string;
  ticketStatus: TicketTravelStatus;
  customerContact: string;
  notes: string;
  lines: TicketBookingLineInput[];
};

export type HotelRoomType = "SHARING" | "QUINT_SHARING" | "QUAD" | "TRIPLE" | "DOUBLE" | "SUITE_ROOM";

export type HotelBookingLine = {
  id: string;
  booking_id: string;
  city: string;
  hotel_name: string;
  check_in: string;
  check_out: string;
  nights: number;
  room_type: HotelRoomType;
  rate_per_night_sar: number;
  quantity: number;
  roe: number;
  line_total_sar: number;
  line_total_pkr: number;
  sort_order: number;
};

export type HotelBooking = {
  id: string;
  company_id: string;
  transaction_type: BookingTransactionType;
  counterparty_id: string;
  counterparty_name: string;
  transaction_date: string;
  ub_number: string;
  confirmation_voucher: string;
  meal_plan: string;
  guest_family_name: string;
  guest_count: number;
  customer_contact: string;
  special_requests: string;
  notes: string;
  total_sar: number;
  total_pkr: number;
  unconverted_sar: number;
  status: "ACTIVE" | "VOID";
  created_at: string;
  updated_at: string;
  lines: HotelBookingLine[];
};

export type HotelBookingLineInput = {
  city: string;
  hotelName: string;
  checkIn: string;
  checkOut: string;
  nights: number;
  roomType: HotelRoomType;
  ratePerNightSar: number;
  quantity: number;
  roe: number | null;
};

export type HotelBookingInput = {
  transactionType: BookingTransactionType;
  counterpartyId: string;
  transactionDate: string;
  ubNumber: string;
  confirmationVoucher: string;
  mealPlan: string;
  guestFamilyName: string;
  guestCount: number;
  customerContact: string;
  specialRequests: string;
  notes: string;
  lines: HotelBookingLineInput[];
};

export type VisaPassengerType = "ADULT" | "CHILD" | "INFANT";
export type VisaType =
  "ONLY_UMRAH_VISA" | "UMRAH_VISA_TRANSPORT" | "UMRAH_VISA_ONE_WAY_TRANSPORT" | "UMRAH_VISA_FULL_TRANSPORT";
export type VisaVehicleType = "CAR" | "STARIA" | "HIACE" | "COASTER" | "BUS";

export type VisaBookingLine = {
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

export type VisaTransportFleetLine = {
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

export type VisaPassportDetail = {
  id: string;
  booking_id: string;
  source_family_name: string;
  passenger_name: string;
  passenger_type: VisaPassengerType;
  visa_type: VisaType;
  surname: string;
  given_name: string;
  passport_number: string;
  nationality: string;
  date_of_birth: string;
  passport_issuance: string;
  passport_expiry: string;
  sort_order: number;
};

export type VisaBooking = {
  id: string;
  company_id: string;
  transaction_type: BookingTransactionType;
  counterparty_id: string;
  counterparty_name: string;
  transaction_date: string;
  ub_number: string;
  expected_entry_date: string;
  private_vehicle_type: VisaVehicleType | "";
  private_transport_total_sar: number;
  intercity_bus_rate_sar: number;
  intercity_bus_total_sar: number;
  applicable_private_pax: number;
  applicable_full_bus_pax: number;
  visa_total_sar: number;
  transport_total_sar: number;
  total_sar: number;
  total_pkr: number;
  unconverted_sar: number;
  notes: string;
  status: "ACTIVE" | "VOID";
  created_at: string;
  updated_at: string;
  lines: VisaBookingLine[];
  fleet: VisaTransportFleetLine[];
  passports: VisaPassportDetail[];
};

export type VisaBookingLineInput = {
  passengerType: VisaPassengerType;
  passengerName: string;
  visaType: VisaType;
  visaRateSar: number;
  paxCount: number;
  roe: number | null;
};

export type VisaTransportFleetLineInput = {
  vehicleType: VisaVehicleType;
  quantity: number;
  ratePerVehicleSar: number;
};

export type VisaPassportDetailInput = {
  sourceFamilyName: string;
  passengerType: VisaPassengerType;
  visaType: VisaType;
  surname: string;
  givenName: string;
  passportNumber: string;
  nationality: string;
  dateOfBirth: string;
  passportIssuance: string;
  passportExpiry: string;
};

export type VisaBookingInput = {
  transactionType: BookingTransactionType;
  counterpartyId: string;
  transactionDate: string;
  ubNumber: string;
  fleet: VisaTransportFleetLineInput[];
  intercityBusRateSar: number;
  expectedEntryDate: string;
  notes: string;
  lines: VisaBookingLineInput[];
  passports: VisaPassportDetailInput[];
};

// Phase 12A — independent Transport booking module.
// Transport supplied/sold as its own service is separate from Visa-embedded transport logic.
export type TransportType = "SHARING_BUS" | "PRIVATE_VEHICLE";
export type TransportVehicleType =
  "SHARING_BUS" | "CAR" | "GMC_YUKON" | "STARIA" | "STAREX" | "HIACE" | "COASTER" | "BUS" | "OTHER";

export type TransportBookingLine = {
  id: string;
  booking_id: string;
  transport_date: string;
  transport_type: TransportType;
  from_location: string;
  to_location: string;
  vehicle_type: TransportVehicleType;
  custom_vehicle_name: string;
  vehicle_count: number;
  rate_sar: number;
  pax_count: number;
  roe: number;
  line_total_sar: number;
  line_total_pkr: number;
  sort_order: number;
};

export type TransportBooking = {
  id: string;
  company_id: string;
  transaction_type: BookingTransactionType;
  counterparty_id: string;
  counterparty_name: string;
  transaction_date: string;
  ub_number: string;
  pax_saudi_number: string;
  notes: string;
  total_sar: number;
  total_pkr: number;
  unconverted_sar: number;
  status: "ACTIVE" | "VOID";
  created_at: string;
  updated_at: string;
  lines: TransportBookingLine[];
};

export type TransportBookingLineInput = {
  transportDate: string;
  transportType: TransportType;
  fromLocation: string;
  toLocation: string;
  vehicleType: TransportVehicleType;
  customVehicleName: string;
  vehicleCount: number;
  rateSar: number;
  paxCount: number;
  roe: number | null;
};

export type TransportBookingInput = {
  transactionType: BookingTransactionType;
  counterpartyId: string;
  transactionDate: string;
  ubNumber: string;
  paxSaudiNumber: string;
  notes: string;
  lines: TransportBookingLineInput[];
};

type UserRow = {
  id: string;
  company_id: string;
  full_name: string;
  username: string;
  email: string;
  phone: string;
  phone_normalized: string;
  password_hash: string;
  password_salt: string;
  password_iterations: number;
  role: UserRole;
  status: "ACTIVE" | "DISABLED";
};

type CountRow = { count: number | string };

export type CreateCompanyAccountInput = {
  companyName: string;
  ownerUsername: string;
  ownerEmail: string;
  ownerPhone: string;
  dtsLicense: string;
  password: string;
};

export type CompanyUserInput = {
  fullName: string;
  username: string;
  email: string;
  phone: string;
  password: string;
  role: Exclude<UserRole, "OWNER">;
};

export type UpdateCompanyUserInput = {
  fullName: string;
  username: string;
  email: string;
  phone: string;
  role: Exclude<UserRole, "OWNER">;
};

export type CompanyProfileInput = {
  name: string;
  dtsLicense: string;
  logoData: string | null;
  address: string;
  phone: string;
  whatsapp: string;
  email: string;
  baseCurrency: string;
  foreignCurrency: string;
};

// Backward-compatible setup shape retained for any older local component.
type InitialSetupInput = {
  fullName: string;
  username: string;
  password: string;
  companyName: string;
  logoData: string | null;
  address: string;
  phone: string;
  whatsapp: string;
  email: string;
  baseCurrency: string;
  foreignCurrency: string;
};

async function db() {
  if (!databasePromise) {
    const isTauri = "__TAURI_INTERNALS__" in window;
    if (isTauri) {
      databasePromise = Database.load(DB_PATH);
    } else {
      console.warn("Running in Web Mode. Local database is not available.");
      databasePromise = Promise.resolve({
        execute: async () => ({ lastInsertId: 0, rowsAffected: 0 }),
        select: async () => [],
      } as any);
    }
  }
  return databasePromise;
}

async function ensureColumn(table: string, column: string, definition: string) {
  const database = await db();
  const columns = await database.select<Record<string, unknown>[]>(`PRAGMA table_info(${table})`);

  const exists = columns.some((item) => String(item["name"] ?? "").toLowerCase() === column.toLowerCase());

  if (exists) return;

  try {
    await database.execute(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  } catch (error) {
    const message = String(error).toLowerCase();

    // During development two startup checks can overlap. If the other one
    // already added the column, treat that as success.
    if (message.includes("duplicate column name")) return;

    throw error;
  }
}

function normalizePhone(value: string) {
  return value.replace(/\D/g, "");
}

function cleanUsername(value: string) {
  return value.trim().replace(/\s+/g, "");
}

function companyCodePrefixes(name: string) {
  const letters = name.toUpperCase().replace(/[^A-Z]/g, "");
  const base = (letters || "ABC").padEnd(3, "X");
  const prefixes: string[] = [];

  for (let index = 0; index <= Math.max(0, base.length - 3); index += 1) {
    const prefix = base.slice(index, index + 3).padEnd(3, "X");
    if (!prefixes.includes(prefix)) prefixes.push(prefix);
  }

  if (prefixes.length === 0) prefixes.push("ABC");
  return prefixes;
}

function randomLetters(length = 3) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
}

export function validateStrongPassword(value: string) {
  if (value.length < 8) throw new Error("Password must be at least 8 characters.");
  if (!/[A-Z]/.test(value)) throw new Error("Password must contain at least 1 capital letter.");
  if (!/[a-z]/.test(value)) throw new Error("Password must contain at least 1 small letter.");
  if (!/[0-9]/.test(value)) throw new Error("Password must contain at least 1 number.");
  if (!/[!@#$%^&*]/.test(value)) throw new Error("Password must contain at least 1 special character: ! @ # $ % ^ & *");
}

async function createAuthTables(database: Database) {
  await database.execute(`CREATE TABLE IF NOT EXISTS companies (
    id TEXT PRIMARY KEY,
    company_code TEXT NOT NULL COLLATE NOCASE UNIQUE,
    name TEXT NOT NULL,
    dts_license TEXT NOT NULL DEFAULT '',
    logo_data TEXT,
    address TEXT NOT NULL DEFAULT '',
    phone TEXT NOT NULL DEFAULT '',
    whatsapp TEXT NOT NULL DEFAULT '',
    email TEXT NOT NULL DEFAULT '',
    base_currency TEXT NOT NULL DEFAULT 'PKR',
    foreign_currency TEXT NOT NULL DEFAULT 'SAR',
    status TEXT NOT NULL DEFAULT 'ACTIVE',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`);

  await database.execute(`CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    full_name TEXT NOT NULL,
    username TEXT NOT NULL COLLATE NOCASE,
    email TEXT NOT NULL DEFAULT '' COLLATE NOCASE,
    phone TEXT NOT NULL DEFAULT '',
    phone_normalized TEXT NOT NULL DEFAULT '',
    password_hash TEXT NOT NULL,
    password_salt TEXT NOT NULL,
    password_iterations INTEGER NOT NULL,
    role TEXT NOT NULL DEFAULT 'VIEW_ONLY',
    status TEXT NOT NULL DEFAULT 'ACTIVE',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    last_login_at TEXT NOT NULL DEFAULT '',
    UNIQUE(company_id, username)
  )`);

  await database.execute(`CREATE UNIQUE INDEX IF NOT EXISTS idx_users_company_email_unique
    ON users(company_id, email) WHERE trim(email) <> ''`);
  await database.execute(`CREATE UNIQUE INDEX IF NOT EXISTS idx_users_company_phone_unique
    ON users(company_id, phone_normalized) WHERE trim(phone_normalized) <> ''`);
  await database.execute(`CREATE INDEX IF NOT EXISTS idx_users_company_status
    ON users(company_id, status, full_name)`);

  await database.execute(`CREATE TABLE IF NOT EXISTS remembered_sessions (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    device_id TEXT NOT NULL DEFAULT '',
    token_hash TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'ACTIVE',
    created_at TEXT NOT NULL,
    last_used_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  )`);

  await database.execute(`CREATE INDEX IF NOT EXISTS idx_remembered_sessions_user
    ON remembered_sessions(company_id, user_id, status)`);

  await database.execute(`CREATE INDEX IF NOT EXISTS idx_remembered_sessions_device
    ON remembered_sessions(company_id, user_id, device_id, status)`);

  await database.execute(`CREATE TABLE IF NOT EXISTS audit_logs (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    user_id TEXT NOT NULL DEFAULT '',
    user_name TEXT NOT NULL DEFAULT '',
    action TEXT NOT NULL,
    module TEXT NOT NULL,
    record_id TEXT NOT NULL DEFAULT '',
    details TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
  )`);

  await database.execute(`CREATE INDEX IF NOT EXISTS idx_audit_company_created
    ON audit_logs(company_id, created_at DESC)`);
}

async function createAuditLog(
  companyId: string,
  userId: string,
  action: string,
  module: string,
  recordId = "",
  details = "",
) {
  const database = await db();
  let userName = "SYSTEM";
  if (userId) {
    const rows = await database.select<Array<{ full_name: string }>>(
      `SELECT full_name FROM users WHERE id=$1 AND company_id=$2 LIMIT 1`,
      [userId, companyId],
    );
    userName = rows[0]?.full_name || "Unknown User";
  }

  await database.execute(
    `INSERT INTO audit_logs
     (id,company_id,user_id,user_name,action,module,record_id,details,created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [crypto.randomUUID(), companyId, userId, userName, action, module, recordId, details, new Date().toISOString()],
  );
}

export async function requirePermission(companyId: string, userId: string, permission: Permission) {
  if (!userId) return; // Backward compatibility for untouched legacy modules during the staged rebuild.
  const isTauri = "__TAURI_INTERNALS__" in window;
  let actorRole: UserRole;
  let actorStatus: string;

  if (isTauri) {
    const database = await db();
    const rows = await database.select<Array<{ role: UserRole; status: string }>>(
      `SELECT role,status FROM users WHERE id=$1 AND company_id=$2 LIMIT 1`,
      [userId, companyId],
    );
    const actor = rows[0];
    if (!actor) throw new Error("You do not have permission to perform this action.");
    actorRole = actor.role;
    actorStatus = actor.status;
  } else {
    // Web Mode (Browser)
    // Avoid querying `users` table directly because RLS blocks it for users whose metadata lacks company_id.
    const { data: sessionData } = await supabase.auth.getSession();
    const meta = sessionData.session?.user?.user_metadata;

    if (meta && meta.role) {
      actorRole = meta.role as UserRole;
      actorStatus = "ACTIVE"; // Trust the JWT for now since RLS blocks users table
    } else {
      const { data, error } = await supabase
        .from("users")
        .select("role, status")
        .eq("id", userId)
        .eq("company_id", companyId)
        .single();

      if (error || !data) throw new Error("You do not have permission to perform this action.");
      actorRole = data.role as UserRole;
      actorStatus = data.status;
    }
  }

  if (actorStatus !== "ACTIVE" || !hasPermission(actorRole, permission)) {
    throw new Error("You do not have permission to perform this action.");
  }
}

async function initDatabaseOnce() {
  const database = await db();

  await database.execute("PRAGMA busy_timeout = 5000");

  // Authentication tables are created/rebuilt at the end of this initializer.
  // This avoids touching old pre-Phase-8 auth indexes before the one-time reset.

  // Phase 3.2 - Offline First Sync Engine
  await database.execute(`CREATE TABLE IF NOT EXISTS sync_queue (
    id TEXT PRIMARY KEY,
    operation TEXT NOT NULL,
    table_name TEXT NOT NULL,
    record_id TEXT NOT NULL,
    payload TEXT NOT NULL,
    created_at TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'PENDING',
    error_message TEXT NOT NULL DEFAULT ''
  )`);

  // -- TEMPORARY FIX FOR CORRUPTED app_migrations --
  try {
    await database.select(`SELECT migration_key FROM app_migrations LIMIT 1`);
  } catch (e) {
    // If it throws, it means it's the corrupted table with 'key' and 'value'
    await database.execute(`DROP TABLE IF EXISTS app_migrations`);
  }

  await database.execute(`CREATE TABLE IF NOT EXISTS app_migrations (
    migration_key TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL
  )`);

  await database.execute(`CREATE TABLE IF NOT EXISTS sync_metadata (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`);

  await database.execute(`CREATE INDEX IF NOT EXISTS idx_sync_queue_status ON sync_queue(status, created_at)`);

  await database.execute(`CREATE TABLE IF NOT EXISTS parties (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    name TEXT NOT NULL,
    phone TEXT NOT NULL DEFAULT '',
    whatsapp TEXT NOT NULL DEFAULT '',
    address TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'ACTIVE',
    account_type TEXT NOT NULL DEFAULT 'UNASSIGNED',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`);

  // Safe migration for databases created by Phase 1.
  await ensureColumn("parties", "phone", "TEXT NOT NULL DEFAULT ''");
  await ensureColumn("parties", "whatsapp", "TEXT NOT NULL DEFAULT ''");
  await ensureColumn("parties", "address", "TEXT NOT NULL DEFAULT ''");
  await ensureColumn("parties", "notes", "TEXT NOT NULL DEFAULT ''");
  await ensureColumn("parties", "account_type", "TEXT NOT NULL DEFAULT 'UNASSIGNED'");

  await database.execute(`CREATE INDEX IF NOT EXISTS idx_parties_company_name
    ON parties(company_id, name)`);

  await database.execute(`CREATE INDEX IF NOT EXISTS idx_parties_company_type_name
    ON parties(company_id, account_type, name)`);

  await database.execute(`CREATE TABLE IF NOT EXISTS accommodation_entries (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    party_id TEXT,
    transaction_date TEXT NOT NULL,
    ub_number TEXT NOT NULL DEFAULT '',
    booking_party_name TEXT NOT NULL DEFAULT '',
    city TEXT NOT NULL DEFAULT '',
    hotel_name TEXT NOT NULL DEFAULT '',
    check_in TEXT NOT NULL DEFAULT '',
    check_out TEXT NOT NULL DEFAULT '',
    nights INTEGER NOT NULL DEFAULT 0,
    rate REAL NOT NULL DEFAULT 0,
    bed_room_count INTEGER NOT NULL DEFAULT 0,
    currency TEXT NOT NULL DEFAULT 'PKR',
    roe REAL NOT NULL DEFAULT 0,
    total_sar REAL NOT NULL DEFAULT 0,
    total_pkr REAL NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'ACTIVE',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`);

  // Safe migration for Phase 1 / Phase 2 databases.
  await ensureColumn("accommodation_entries", "ub_number", "TEXT NOT NULL DEFAULT ''");
  await ensureColumn("accommodation_entries", "booking_party_name", "TEXT NOT NULL DEFAULT ''");
  await ensureColumn("accommodation_entries", "city", "TEXT NOT NULL DEFAULT ''");
  await ensureColumn("accommodation_entries", "hotel_name", "TEXT NOT NULL DEFAULT ''");
  await ensureColumn("accommodation_entries", "check_in", "TEXT NOT NULL DEFAULT ''");
  await ensureColumn("accommodation_entries", "check_out", "TEXT NOT NULL DEFAULT ''");
  await ensureColumn("accommodation_entries", "nights", "INTEGER NOT NULL DEFAULT 0");
  await ensureColumn("accommodation_entries", "rate", "REAL NOT NULL DEFAULT 0");
  await ensureColumn("accommodation_entries", "bed_room_count", "INTEGER NOT NULL DEFAULT 0");
  await ensureColumn("accommodation_entries", "currency", "TEXT NOT NULL DEFAULT 'PKR'");
  await ensureColumn("accommodation_entries", "roe", "REAL NOT NULL DEFAULT 0");
  await ensureColumn("accommodation_entries", "total_sar", "REAL NOT NULL DEFAULT 0");
  await ensureColumn("accommodation_entries", "total_pkr", "REAL NOT NULL DEFAULT 0");

  await database.execute(`CREATE INDEX IF NOT EXISTS idx_accommodation_company_party_date
    ON accommodation_entries(company_id, party_id, transaction_date)`);

  await database.execute(`CREATE TABLE IF NOT EXISTS service_entries (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    party_id TEXT,
    transaction_date TEXT NOT NULL,
    ub_number TEXT NOT NULL DEFAULT '',
    booking_party_name TEXT NOT NULL DEFAULT '',
    service_type TEXT NOT NULL DEFAULT '',
    rate REAL NOT NULL DEFAULT 0,
    pax INTEGER NOT NULL DEFAULT 0,
    spt REAL NOT NULL DEFAULT 0,
    shr REAL NOT NULL DEFAULT 0,
    currency TEXT NOT NULL DEFAULT 'PKR',
    roe REAL NOT NULL DEFAULT 0,
    total_sar REAL NOT NULL DEFAULT 0,
    total_pkr REAL NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'ACTIVE',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`);

  // Safe migration for Phase 1 / Phase 2 / Phase 3 databases.
  await ensureColumn("service_entries", "ub_number", "TEXT NOT NULL DEFAULT ''");
  await ensureColumn("service_entries", "booking_party_name", "TEXT NOT NULL DEFAULT ''");
  await ensureColumn("service_entries", "service_type", "TEXT NOT NULL DEFAULT ''");
  await ensureColumn("service_entries", "rate", "REAL NOT NULL DEFAULT 0");
  await ensureColumn("service_entries", "pax", "INTEGER NOT NULL DEFAULT 0");
  await ensureColumn("service_entries", "spt", "REAL NOT NULL DEFAULT 0");
  await ensureColumn("service_entries", "shr", "REAL NOT NULL DEFAULT 0");
  await ensureColumn("service_entries", "currency", "TEXT NOT NULL DEFAULT 'PKR'");
  await ensureColumn("service_entries", "roe", "REAL NOT NULL DEFAULT 0");
  await ensureColumn("service_entries", "total_sar", "REAL NOT NULL DEFAULT 0");
  await ensureColumn("service_entries", "total_pkr", "REAL NOT NULL DEFAULT 0");

  await database.execute(`CREATE INDEX IF NOT EXISTS idx_service_company_party_date
    ON service_entries(company_id, party_id, transaction_date)`);

  await database.execute(`CREATE TABLE IF NOT EXISTS payment_entries (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    party_id TEXT,
    transaction_date TEXT NOT NULL,
    receipt_no TEXT NOT NULL DEFAULT '',
    from_account TEXT NOT NULL DEFAULT '',
    to_account TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    payment_type TEXT NOT NULL DEFAULT 'BANK',
    currency TEXT NOT NULL DEFAULT 'PKR',
    amount_entered REAL NOT NULL DEFAULT 0,
    sar REAL NOT NULL DEFAULT 0,
    roe REAL NOT NULL DEFAULT 0,
    paid_amount REAL NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'ACTIVE',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`);

  // Safe migration for databases created before the Payments module.
  await ensureColumn("payment_entries", "receipt_no", "TEXT NOT NULL DEFAULT ''");
  await ensureColumn("payment_entries", "from_account", "TEXT NOT NULL DEFAULT ''");
  await ensureColumn("payment_entries", "to_account", "TEXT NOT NULL DEFAULT ''");
  await ensureColumn("payment_entries", "description", "TEXT NOT NULL DEFAULT ''");
  await ensureColumn("payment_entries", "payment_type", "TEXT NOT NULL DEFAULT 'BANK'");
  await ensureColumn("payment_entries", "currency", "TEXT NOT NULL DEFAULT 'PKR'");
  await ensureColumn("payment_entries", "amount_entered", "REAL NOT NULL DEFAULT 0");
  await ensureColumn("payment_entries", "sar", "REAL NOT NULL DEFAULT 0");
  await ensureColumn("payment_entries", "roe", "REAL NOT NULL DEFAULT 0");
  await ensureColumn("payment_entries", "paid_amount", "REAL NOT NULL DEFAULT 0");

  await database.execute(`CREATE INDEX IF NOT EXISTS idx_payment_company_party_date
    ON payment_entries(company_id, party_id, transaction_date)`);

  // Phase 7B — new Package booking engine. Package amounts are PKR only.
  await database.execute(`CREATE TABLE IF NOT EXISTS package_bookings (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    transaction_type TEXT NOT NULL,
    counterparty_id TEXT NOT NULL,
    transaction_date TEXT NOT NULL,
    ub_number TEXT NOT NULL DEFAULT '',
    package_description TEXT NOT NULL DEFAULT '',
    departure_date TEXT NOT NULL DEFAULT '',
    return_date TEXT NOT NULL DEFAULT '',
    no_of_days INTEGER NOT NULL DEFAULT 0,
    ziarat_included TEXT NOT NULL DEFAULT '',
    customer_contact TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    total_pkr REAL NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'ACTIVE',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`);

  await database.execute(`CREATE TABLE IF NOT EXISTS package_booking_lines (
    id TEXT PRIMARY KEY,
    booking_id TEXT NOT NULL,
    passenger_type TEXT NOT NULL,
    passenger_name TEXT NOT NULL DEFAULT '',
    package_type TEXT NOT NULL DEFAULT '',
    rate_per_person REAL NOT NULL DEFAULT 0,
    person_count INTEGER NOT NULL DEFAULT 0,
    qty_is_explicit INTEGER NOT NULL DEFAULT 1,
    line_total_pkr REAL NOT NULL DEFAULT 0,
    sort_order INTEGER NOT NULL DEFAULT 0
  )`);

  await database.execute(`CREATE INDEX IF NOT EXISTS idx_package_company_date
    ON package_bookings(company_id, transaction_date)`);
  await database.execute(`CREATE INDEX IF NOT EXISTS idx_package_company_counterparty
    ON package_bookings(company_id, counterparty_id)`);
  await database.execute(`CREATE INDEX IF NOT EXISTS idx_package_company_ub
    ON package_bookings(company_id, ub_number)`);
  await database.execute(`CREATE INDEX IF NOT EXISTS idx_package_lines_booking
    ON package_booking_lines(booking_id, sort_order)`);

  // The user confirmed all old accounting/master records were only test data.
  // This migration runs ONCE and keeps login/company branding intact.
  await database.execute(`CREATE TABLE IF NOT EXISTS app_migrations (
    migration_key TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL
  )`);

  // Phase 7C — allow multiple Adult / Child / Infant rows inside one Package booking.
  // Phase 7B created a UNIQUE(booking_id, passenger_type) constraint, so SQLite needs
  // a one-time table rebuild to remove that old constraint safely.
  const packageRowsV2Key = "phase_7c_package_multiple_passenger_rows_v1";
  const packageRowsV2Done = await database.select<CountRow[]>(
    `SELECT COUNT(*) AS count FROM app_migrations WHERE migration_key=$1`,
    [packageRowsV2Key],
  );

  if (Number(packageRowsV2Done[0]?.count ?? 0) === 0) {
    await database.execute(`DROP TABLE IF EXISTS package_booking_lines_v2`);
    await database.execute(`CREATE TABLE package_booking_lines_v2 (
      id TEXT PRIMARY KEY,
      booking_id TEXT NOT NULL,
      passenger_type TEXT NOT NULL,
      package_type TEXT NOT NULL DEFAULT '',
      rate_per_person REAL NOT NULL DEFAULT 0,
      person_count INTEGER NOT NULL DEFAULT 0,
      line_total_pkr REAL NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 0
    )`);
    await database.execute(`INSERT INTO package_booking_lines_v2
      (id,booking_id,passenger_type,package_type,rate_per_person,person_count,line_total_pkr,sort_order)
      SELECT id,booking_id,passenger_type,package_type,rate_per_person,person_count,line_total_pkr,sort_order
      FROM package_booking_lines`);
    await database.execute(`DROP TABLE package_booking_lines`);
    await database.execute(`ALTER TABLE package_booking_lines_v2 RENAME TO package_booking_lines`);
    await database.execute(`CREATE INDEX IF NOT EXISTS idx_package_lines_booking
      ON package_booking_lines(booking_id, sort_order)`);
    await database.execute(`INSERT INTO app_migrations (migration_key, applied_at) VALUES ($1,$2)`, [
      packageRowsV2Key,
      new Date().toISOString(),
    ]);
  }

  // Phase 7D — richer Package entry details and optional quantity behavior.
  // These are safe additive columns; existing Package records remain readable.
  await ensureColumn("package_bookings", "package_description", "TEXT NOT NULL DEFAULT ''");
  await ensureColumn("package_bookings", "departure_date", "TEXT NOT NULL DEFAULT ''");
  await ensureColumn("package_bookings", "return_date", "TEXT NOT NULL DEFAULT ''");
  await ensureColumn("package_bookings", "no_of_days", "INTEGER NOT NULL DEFAULT 0");
  await ensureColumn("package_bookings", "ziarat_included", "TEXT NOT NULL DEFAULT ''");
  await ensureColumn("package_bookings", "customer_contact", "TEXT NOT NULL DEFAULT ''");
  await ensureColumn("package_booking_lines", "passenger_name", "TEXT NOT NULL DEFAULT ''");
  await ensureColumn("package_booking_lines", "qty_is_explicit", "INTEGER NOT NULL DEFAULT 1");

  // Phase 9A — dedicated Ticket booking engine.
  // Ticket Sale and Purchase records intentionally share the same UB linking reference.
  // This table is additive only: it does NOT reset current company/account data.
  await database.execute(`CREATE TABLE IF NOT EXISTS ticket_bookings (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    transaction_type TEXT NOT NULL,
    counterparty_id TEXT NOT NULL,
    transaction_date TEXT NOT NULL,
    ub_number TEXT NOT NULL DEFAULT '',
    airline_name TEXT NOT NULL DEFAULT '',
    pnr TEXT NOT NULL DEFAULT '',
    sector TEXT NOT NULL DEFAULT '',
    departure_date TEXT NOT NULL DEFAULT '',
    return_date TEXT NOT NULL DEFAULT '',
    flight_no TEXT NOT NULL DEFAULT '',
    departure_time TEXT NOT NULL DEFAULT '',
    arrival_time TEXT NOT NULL DEFAULT '',
    baggage TEXT NOT NULL DEFAULT '',
    ticket_status TEXT NOT NULL DEFAULT '',
    customer_contact TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    total_pkr REAL NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'ACTIVE',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    created_by_user_id TEXT NOT NULL DEFAULT '',
    updated_by_user_id TEXT NOT NULL DEFAULT ''
  )`);

  await database.execute(`CREATE TABLE IF NOT EXISTS ticket_booking_lines (
    id TEXT PRIMARY KEY,
    booking_id TEXT NOT NULL,
    passenger_type TEXT NOT NULL,
    passenger_name TEXT NOT NULL DEFAULT '',
    eticket_reference TEXT NOT NULL DEFAULT '',
    rate_per_ticket REAL NOT NULL DEFAULT 0,
    ticket_count INTEGER NOT NULL DEFAULT 1,
    qty_is_explicit INTEGER NOT NULL DEFAULT 0,
    line_total_pkr REAL NOT NULL DEFAULT 0,
    sort_order INTEGER NOT NULL DEFAULT 0
  )`);

  await database.execute(`CREATE INDEX IF NOT EXISTS idx_ticket_company_date
    ON ticket_bookings(company_id, transaction_date)`);
  await database.execute(`CREATE INDEX IF NOT EXISTS idx_ticket_company_counterparty
    ON ticket_bookings(company_id, counterparty_id)`);
  await database.execute(`CREATE INDEX IF NOT EXISTS idx_ticket_company_ub
    ON ticket_bookings(company_id, ub_number)`);
  await database.execute(`CREATE INDEX IF NOT EXISTS idx_ticket_lines_booking
    ON ticket_booking_lines(booking_id, sort_order)`);

  // Phase 10A — dedicated Hotel booking engine.
  // Hotel rates are stored in SAR; ROE is optional per stay row.
  // A blank ROE preserves the original SAR amount without pretending it is PKR.
  await database.execute(`CREATE TABLE IF NOT EXISTS hotel_bookings (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    transaction_type TEXT NOT NULL,
    counterparty_id TEXT NOT NULL,
    transaction_date TEXT NOT NULL,
    ub_number TEXT NOT NULL DEFAULT '',
    confirmation_voucher TEXT NOT NULL DEFAULT '',
    meal_plan TEXT NOT NULL DEFAULT '',
    guest_family_name TEXT NOT NULL DEFAULT '',
    guest_count INTEGER NOT NULL DEFAULT 0,
    customer_contact TEXT NOT NULL DEFAULT '',
    special_requests TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    total_sar REAL NOT NULL DEFAULT 0,
    total_pkr REAL NOT NULL DEFAULT 0,
    unconverted_sar REAL NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'ACTIVE',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    created_by_user_id TEXT NOT NULL DEFAULT '',
    updated_by_user_id TEXT NOT NULL DEFAULT ''
  )`);

  await database.execute(`CREATE TABLE IF NOT EXISTS hotel_booking_lines (
    id TEXT PRIMARY KEY,
    booking_id TEXT NOT NULL,
    city TEXT NOT NULL DEFAULT '',
    hotel_name TEXT NOT NULL DEFAULT '',
    check_in TEXT NOT NULL DEFAULT '',
    check_out TEXT NOT NULL DEFAULT '',
    nights INTEGER NOT NULL DEFAULT 0,
    room_type TEXT NOT NULL DEFAULT '',
    rate_per_night_sar REAL NOT NULL DEFAULT 0,
    quantity INTEGER NOT NULL DEFAULT 0,
    roe REAL NOT NULL DEFAULT 0,
    line_total_sar REAL NOT NULL DEFAULT 0,
    line_total_pkr REAL NOT NULL DEFAULT 0,
    sort_order INTEGER NOT NULL DEFAULT 0
  )`);

  await database.execute(`CREATE INDEX IF NOT EXISTS idx_hotel_company_date
    ON hotel_bookings(company_id, transaction_date)`);
  await database.execute(`CREATE INDEX IF NOT EXISTS idx_hotel_company_counterparty
    ON hotel_bookings(company_id, counterparty_id)`);
  await database.execute(`CREATE INDEX IF NOT EXISTS idx_hotel_company_ub
    ON hotel_bookings(company_id, ub_number)`);
  await database.execute(`CREATE INDEX IF NOT EXISTS idx_hotel_lines_booking
    ON hotel_booking_lines(booking_id, sort_order)`);

  // Phase 10B — booking-level guest count is informational and never changes hotel rate calculations.
  await ensureColumn("hotel_bookings", "guest_count", "INTEGER NOT NULL DEFAULT 0");

  // Phase 11A — dedicated Visa booking engine.
  // Visa rates are SAR-based. Private transport is shared at booking level for
  // One-Way / Full Transport rows. "Umrah Visa + Transport" is a combined per-pax
  // Visa Rate and intentionally does NOT activate separate transport fields.
  await database.execute(`CREATE TABLE IF NOT EXISTS visa_bookings (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    transaction_type TEXT NOT NULL,
    counterparty_id TEXT NOT NULL,
    transaction_date TEXT NOT NULL,
    ub_number TEXT NOT NULL DEFAULT '',
    private_vehicle_type TEXT NOT NULL DEFAULT '',
    private_transport_total_sar REAL NOT NULL DEFAULT 0,
    intercity_bus_rate_sar REAL NOT NULL DEFAULT 0,
    intercity_bus_total_sar REAL NOT NULL DEFAULT 0,
    applicable_private_pax INTEGER NOT NULL DEFAULT 0,
    applicable_full_bus_pax INTEGER NOT NULL DEFAULT 0,
    visa_total_sar REAL NOT NULL DEFAULT 0,
    transport_total_sar REAL NOT NULL DEFAULT 0,
    total_sar REAL NOT NULL DEFAULT 0,
    total_pkr REAL NOT NULL DEFAULT 0,
    unconverted_sar REAL NOT NULL DEFAULT 0,
    notes TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'ACTIVE',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    created_by_user_id TEXT NOT NULL DEFAULT '',
    updated_by_user_id TEXT NOT NULL DEFAULT ''
  )`);

  await database.execute(`CREATE TABLE IF NOT EXISTS visa_booking_lines (
    id TEXT PRIMARY KEY,
    booking_id TEXT NOT NULL,
    passenger_type TEXT NOT NULL,
    passenger_name TEXT NOT NULL DEFAULT '',
    visa_type TEXT NOT NULL DEFAULT '',
    visa_rate_sar REAL NOT NULL DEFAULT 0,
    pax_count INTEGER NOT NULL DEFAULT 0,
    roe REAL NOT NULL DEFAULT 0,
    visa_total_sar REAL NOT NULL DEFAULT 0,
    private_transport_allocated_sar REAL NOT NULL DEFAULT 0,
    intercity_bus_total_sar REAL NOT NULL DEFAULT 0,
    line_total_sar REAL NOT NULL DEFAULT 0,
    line_total_pkr REAL NOT NULL DEFAULT 0,
    sort_order INTEGER NOT NULL DEFAULT 0
  )`);

  await database.execute(`CREATE INDEX IF NOT EXISTS idx_visa_company_date
    ON visa_bookings(company_id, transaction_date)`);
  await database.execute(`CREATE INDEX IF NOT EXISTS idx_visa_company_counterparty
    ON visa_bookings(company_id, counterparty_id)`);
  await database.execute(`CREATE INDEX IF NOT EXISTS idx_visa_company_ub
    ON visa_bookings(company_id, ub_number)`);
  await database.execute(`CREATE INDEX IF NOT EXISTS idx_visa_lines_booking
    ON visa_booking_lines(booking_id, sort_order)`);

  // Phase 11B — multiple private transport vehicles + individual passport details.
  await database.execute(`CREATE TABLE IF NOT EXISTS visa_transport_fleet (
    id TEXT PRIMARY KEY,
    booking_id TEXT NOT NULL,
    vehicle_type TEXT NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 1,
    capacity_per_vehicle INTEGER NOT NULL DEFAULT 0,
    total_capacity INTEGER NOT NULL DEFAULT 0,
    rate_per_vehicle_sar REAL NOT NULL DEFAULT 0,
    line_total_sar REAL NOT NULL DEFAULT 0,
    sort_order INTEGER NOT NULL DEFAULT 0
  )`);

  await database.execute(`CREATE TABLE IF NOT EXISTS visa_passport_details (
    id TEXT PRIMARY KEY,
    booking_id TEXT NOT NULL,
    source_family_name TEXT NOT NULL DEFAULT '',
    passenger_name TEXT NOT NULL DEFAULT '',
    passenger_type TEXT NOT NULL DEFAULT 'ADULT',
    visa_type TEXT NOT NULL DEFAULT 'ONLY_UMRAH_VISA',
    passport_number TEXT NOT NULL DEFAULT '',
    nationality TEXT NOT NULL DEFAULT '',
    date_of_birth TEXT NOT NULL DEFAULT '',
    passport_expiry TEXT NOT NULL DEFAULT '',
    sort_order INTEGER NOT NULL DEFAULT 0
  )`);

  await database.execute(`CREATE INDEX IF NOT EXISTS idx_visa_fleet_booking
    ON visa_transport_fleet(booking_id, sort_order)`);
  await database.execute(`CREATE INDEX IF NOT EXISTS idx_visa_passports_booking
    ON visa_passport_details(booking_id, sort_order)`);

  // Phase 11C — SaaS-ready passenger passport details + travel eligibility date.
  await ensureColumn("visa_bookings", "expected_entry_date", "TEXT NOT NULL DEFAULT ''");
  await ensureColumn("visa_passport_details", "surname", "TEXT NOT NULL DEFAULT ''");
  await ensureColumn("visa_passport_details", "given_name", "TEXT NOT NULL DEFAULT ''");
  await ensureColumn("visa_passport_details", "passport_issuance", "TEXT NOT NULL DEFAULT ''");

  // Phase 12A — independent Transport booking engine.
  // Sharing Bus = SAR per pax. Private Vehicle = SAR per vehicle.
  await database.execute(`CREATE TABLE IF NOT EXISTS transport_bookings (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    transaction_type TEXT NOT NULL,
    counterparty_id TEXT NOT NULL,
    transaction_date TEXT NOT NULL,
    ub_number TEXT NOT NULL DEFAULT '',
    pax_saudi_number TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    total_sar REAL NOT NULL DEFAULT 0,
    total_pkr REAL NOT NULL DEFAULT 0,
    unconverted_sar REAL NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'ACTIVE',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    created_by_user_id TEXT NOT NULL DEFAULT '',
    updated_by_user_id TEXT NOT NULL DEFAULT ''
  )`);

  await database.execute(`CREATE TABLE IF NOT EXISTS transport_booking_lines (
    id TEXT PRIMARY KEY,
    booking_id TEXT NOT NULL,
    transport_date TEXT NOT NULL DEFAULT '',
    transport_type TEXT NOT NULL DEFAULT '',
    from_location TEXT NOT NULL DEFAULT '',
    to_location TEXT NOT NULL DEFAULT '',
    vehicle_type TEXT NOT NULL DEFAULT '',
    custom_vehicle_name TEXT NOT NULL DEFAULT '',
    vehicle_count INTEGER NOT NULL DEFAULT 0,
    rate_sar REAL NOT NULL DEFAULT 0,
    pax_count INTEGER NOT NULL DEFAULT 0,
    roe REAL NOT NULL DEFAULT 0,
    line_total_sar REAL NOT NULL DEFAULT 0,
    line_total_pkr REAL NOT NULL DEFAULT 0,
    sort_order INTEGER NOT NULL DEFAULT 0
  )`);

  await database.execute(`CREATE INDEX IF NOT EXISTS idx_transport_company_date
    ON transport_bookings(company_id, transaction_date)`);
  await database.execute(`CREATE INDEX IF NOT EXISTS idx_transport_company_counterparty
    ON transport_bookings(company_id, counterparty_id)`);
  await database.execute(`CREATE INDEX IF NOT EXISTS idx_transport_company_ub
    ON transport_bookings(company_id, ub_number)`);
  await database.execute(`CREATE INDEX IF NOT EXISTS idx_transport_lines_booking
    ON transport_booking_lines(booking_id, sort_order)`);

  const cleanResetKey = "phase_7b_clean_test_accounting_data_v1";
  const cleanResetDone = await database.select<CountRow[]>(
    `SELECT COUNT(*) AS count FROM app_migrations WHERE migration_key=$1`,
    [cleanResetKey],
  );

  if (Number(cleanResetDone[0]?.count ?? 0) === 0) {
    await database.execute(`DELETE FROM package_booking_lines`);
    await database.execute(`DELETE FROM package_bookings`);
    await database.execute(`DELETE FROM accommodation_entries`);
    await database.execute(`DELETE FROM service_entries`);
    await database.execute(`DELETE FROM payment_entries`);
    await database.execute(`DELETE FROM parties`);
    await database.execute(`INSERT INTO app_migrations (migration_key, applied_at) VALUES ($1,$2)`, [
      cleanResetKey,
      new Date().toISOString(),
    ]);
  }

  // SaaS-ready ownership/audit fields. These stay hidden from normal entry screens.
  await ensureColumn("parties", "created_by_user_id", "TEXT NOT NULL DEFAULT ''");
  await ensureColumn("parties", "updated_by_user_id", "TEXT NOT NULL DEFAULT ''");
  await ensureColumn("accommodation_entries", "created_by_user_id", "TEXT NOT NULL DEFAULT ''");
  await ensureColumn("accommodation_entries", "updated_by_user_id", "TEXT NOT NULL DEFAULT ''");
  await ensureColumn("service_entries", "created_by_user_id", "TEXT NOT NULL DEFAULT ''");
  await ensureColumn("service_entries", "updated_by_user_id", "TEXT NOT NULL DEFAULT ''");
  await ensureColumn("payment_entries", "created_by_user_id", "TEXT NOT NULL DEFAULT ''");
  await ensureColumn("payment_entries", "updated_by_user_id", "TEXT NOT NULL DEFAULT ''");
  await ensureColumn("package_bookings", "created_by_user_id", "TEXT NOT NULL DEFAULT ''");
  await ensureColumn("package_bookings", "updated_by_user_id", "TEXT NOT NULL DEFAULT ''");

  // Phase 8 — one-time AUTH + COMPANY reset requested by the user.
  // All previous records were test data. This intentionally removes old companies,
  // logins, parties, bookings, payments and legacy transaction records ONCE.
  // From this point every user belongs directly to one company and logs in with
  // Company Code + Username/Email + Password.
  const phase8AuthResetKey = "phase_8_company_scoped_auth_reset_v1";
  const phase8AuthResetDone = await database.select<CountRow[]>(
    `SELECT COUNT(*) AS count FROM app_migrations WHERE migration_key=$1`,
    [phase8AuthResetKey],
  );

  if (Number(phase8AuthResetDone[0]?.count ?? 0) === 0) {
    await database.execute(`DELETE FROM package_booking_lines`);
    await database.execute(`DELETE FROM package_bookings`);
    await database.execute(`DELETE FROM accommodation_entries`);
    await database.execute(`DELETE FROM service_entries`);
    await database.execute(`DELETE FROM payment_entries`);
    await database.execute(`DELETE FROM parties`);

    await database.execute(`DROP TABLE IF EXISTS remembered_sessions`);
    await database.execute(`DROP TABLE IF EXISTS audit_logs`);
    await database.execute(`DROP TABLE IF EXISTS company_users`);
    await database.execute(`DROP TABLE IF EXISTS users`);
    await database.execute(`DROP TABLE IF EXISTS companies`);

    await createAuthTables(database);

    await database.execute(`INSERT INTO app_migrations (migration_key, applied_at) VALUES ($1,$2)`, [
      phase8AuthResetKey,
      new Date().toISOString(),
    ]);
  } else {
    await createAuthTables(database);
  }

  // Phase 8B adds DTS License.
  await ensureColumn("companies", "dts_license", "TEXT NOT NULL DEFAULT ''");

  // Phase 8C — user-requested final FRESH START before creating the real company account.
  // This migration intentionally clears EVERY existing business/account record ONCE,
  // including companies, users, audit logs, parties/vendors, bookings and payments.
  // app_migrations is retained so the wipe cannot repeat on later startups.
  const phase8CFreshStartKey = "phase_8c_final_fresh_company_start_v1";
  const phase8CFreshStartDone = await database.select<CountRow[]>(
    `SELECT COUNT(*) AS count FROM app_migrations WHERE migration_key=$1`,
    [phase8CFreshStartKey],
  );

  if (Number(phase8CFreshStartDone[0]?.count ?? 0) === 0) {
    // Child/detail records first.
    await database.execute(`DELETE FROM package_booking_lines`);

    // All business/accounting records.
    await database.execute(`DELETE FROM package_bookings`);
    await database.execute(`DELETE FROM accommodation_entries`);
    await database.execute(`DELETE FROM service_entries`);
    await database.execute(`DELETE FROM payment_entries`);
    await database.execute(`DELETE FROM parties`);

    // All authentication/company/security records.
    await database.execute(`DROP TABLE IF EXISTS remembered_sessions`);
    await database.execute(`DROP TABLE IF EXISTS audit_logs`);
    await database.execute(`DROP TABLE IF EXISTS company_users`);
    await database.execute(`DROP TABLE IF EXISTS users`);
    await database.execute(`DROP TABLE IF EXISTS companies`);

    // Recreate only the empty SaaS-ready account/security structure.
    await createAuthTables(database);
    await ensureColumn("companies", "dts_license", "TEXT NOT NULL DEFAULT ''");

    await database.execute(`INSERT INTO app_migrations (migration_key, applied_at) VALUES ($1,$2)`, [
      phase8CFreshStartKey,
      new Date().toISOString(),
    ]);
  }

  // Phase 8D — final consolidated onboarding reset requested by the user.
  // Runs once so the real company starts from the final Company/Users/Session model.
  const phase8DFreshStartKey = "phase_8d_consolidated_account_fresh_start_v1";
  const phase8DFreshStartDone = await database.select<CountRow[]>(
    `SELECT COUNT(*) AS count FROM app_migrations WHERE migration_key=$1`,
    [phase8DFreshStartKey],
  );

  if (Number(phase8DFreshStartDone[0]?.count ?? 0) === 0) {
    await database.execute(`DELETE FROM package_booking_lines`);
    await database.execute(`DELETE FROM package_bookings`);
    await database.execute(`DELETE FROM accommodation_entries`);
    await database.execute(`DELETE FROM service_entries`);
    await database.execute(`DELETE FROM payment_entries`);
    await database.execute(`DELETE FROM parties`);

    await database.execute(`DROP TABLE IF EXISTS remembered_sessions`);
    await database.execute(`DROP TABLE IF EXISTS audit_logs`);
    await database.execute(`DROP TABLE IF EXISTS company_users`);
    await database.execute(`DROP TABLE IF EXISTS users`);
    await database.execute(`DROP TABLE IF EXISTS companies`);

    await createAuthTables(database);
    await ensureColumn("companies", "dts_license", "TEXT NOT NULL DEFAULT ''");

    await database.execute(`INSERT INTO app_migrations (migration_key, applied_at) VALUES ($1,$2)`, [
      phase8DFreshStartKey,
      new Date().toISOString(),
    ]);
  }
}

export function initDatabase() {
  if (!initializationPromise) {
    initializationPromise = initDatabaseOnce().catch((error) => {
      initializationPromise = null;
      throw error;
    });
  }

  return initializationPromise;
}

export async function needsFirstSetup() {
  const database = await db();
  const companies = await database.select<CountRow[]>("SELECT COUNT(*) AS count FROM companies");
  return Number(companies[0]?.count ?? 0) === 0;
}

async function generateUniqueCompanyCode(companyName: string) {
  const prefixes = companyCodePrefixes(companyName);

  for (const prefix of prefixes) {
    const candidate = prefix.toUpperCase();
    const { count, error } = await supabase
      .from("companies")
      .select("*", { count: "exact", head: true })
      .ilike("company_code", candidate);

    if (error) throw new Error(error.message);
    if (count === 0) return candidate;
  }

  for (let attempt = 0; attempt < 500; attempt += 1) {
    const candidate = randomLetters(3).toUpperCase();
    const { count, error } = await supabase
      .from("companies")
      .select("*", { count: "exact", head: true })
      .ilike("company_code", candidate);

    if (error) throw new Error(error.message);
    if (count === 0) return candidate;
  }

  throw new Error("Could not generate a unique 3-letter Company Code.");
}

function validateOwnerUsername(value: string) {
  const username = cleanUsername(value);
  if (!username) throw new Error("Owner username is required.");
  if (username.length < 3) throw new Error("Username must be at least 3 characters.");
  if (!/^[A-Za-z0-9._-]+$/.test(username)) {
    throw new Error("Username can use letters, numbers, dot, underscore and dash only.");
  }
  return username;
}

function validateEmail(value: string) {
  const email = value.trim().toLowerCase();
  if (email && !/^\S+@\S+\.\S+$/.test(email)) throw new Error("Enter a valid email address.");
  return email;
}

export async function createCompanyAccount(input: CreateCompanyAccountInput) {
  const username = validateOwnerUsername(input.ownerUsername);
  const ownerEmail = validateEmail(input.ownerEmail);
  const ownerPhone = input.ownerPhone.trim();
  const companyName = input.companyName.trim();
  const dtsLicense = input.dtsLicense.trim();

  if (!companyName) throw new Error("Company Name is required.");
  if (!ownerEmail) throw new Error("Email Address is required.");
  if (!ownerPhone) throw new Error("Phone / WhatsApp Number is required.");
  validateStrongPassword(input.password);

  const companyCode = await generateUniqueCompanyCode(companyName);
  const now = new Date().toISOString();

  // 1. Sign up Master User in Supabase Auth
  const { data: authData, error: authError } = await supabase.auth.signUp({
    email: ownerEmail,
    password: input.password,
    options: {
      data: {
        username,
        full_name: username,
        phone: ownerPhone,
        role: "OWNER",
        company_code: companyCode,
        company_name: companyName,
      },
    },
  });

  if (authError || !authData.user) {
    throw new Error(authError?.message || "Could not register cloud authentication.");
  }
  const userId = authData.user.id;
  const companyId = crypto.randomUUID();

  try {
    // 2. Insert Company Profile
    const { error: companyError } = await supabase.from("companies").insert({
      id: companyId,
      company_code: companyCode,
      name: companyName,
      dts_license: dtsLicense,
      phone: ownerPhone,
      whatsapp: ownerPhone,
      email: ownerEmail,
      base_currency: "PKR",
      foreign_currency: "SAR",
      status: "ACTIVE",
      created_at: now,
      updated_at: now,
    });
    if (companyError) throw new Error(companyError.message);

    // 3. Insert Master User Profile
    const { error: userError } = await supabase.from("users").insert({
      id: userId,
      company_id: companyId,
      full_name: username,
      username: username,
      email: ownerEmail,
      phone: ownerPhone,
      phone_normalized: normalizePhone(ownerPhone),
      password_hash: "SUPABASE_AUTH",
      password_salt: "SUPABASE_AUTH",
      password_iterations: 0,
      role: "OWNER",
      status: "ACTIVE",
      created_at: now,
      updated_at: now,
      last_login_at: "",
    });
    if (userError) throw new Error(userError.message);

    // 4. Update Auth metadata to securely link the correct Company ID
    await supabase.auth.updateUser({
      data: { company_id: companyId },
    });

    return { companyId, companyCode, userId, username, email: ownerEmail, accountStatus: "ACTIVE" as const };
  } catch (error) {
    // Attempt rollback if insert failed
    await supabase.from("users").delete().eq("id", userId);
    await supabase.from("companies").delete().eq("id", companyId);
    throw error;
  }
}

// Backward-compatible wrapper for older setup code.
export async function createInitialSetup(input: InitialSetupInput) {
  return createCompanyAccount({
    companyName: input.companyName,
    ownerUsername: input.username,
    ownerEmail: input.email,
    ownerPhone: input.phone || input.whatsapp,
    dtsLicense: "",
    password: input.password,
  });
}

export async function loginUser(
  companyCode: string,
  identifier: string,
  password: string,
): Promise<UserSession | null> {
  const database = await db();
  const cleanCode = companyCode.trim();
  const cleanIdentifier = identifier.trim();
  if (!cleanCode || !cleanIdentifier || !password) return null;

  const companies = await database.select<Company[]>(
    `SELECT id,company_code,name,dts_license,logo_data,address,phone,whatsapp,email,base_currency,foreign_currency,status,created_at,updated_at
     FROM companies
     WHERE company_code=$1 COLLATE NOCASE
     LIMIT 1`,
    [cleanCode],
  );
  const company = companies[0];
  if (!company) return null;
  if (company.status === "PENDING_APPROVAL") {
    throw new Error("This company account is pending activation. Please wait for account approval.");
  }
  if (company.status === "SUSPENDED") {
    throw new Error("This company account is suspended. Please contact support.");
  }
  if (company.status !== "ACTIVE") return null;

  const rows = await database.select<UserRow[]>(
    `SELECT id,company_id,full_name,username,email,phone,phone_normalized,password_hash,password_salt,password_iterations,role,status
     FROM users
     WHERE company_id=$1
       AND (
         username=$2 COLLATE NOCASE OR
         email=$2 COLLATE NOCASE
       )
     LIMIT 1`,
    [company.id, cleanIdentifier],
  );

  const user = rows[0];
  if (!user) return null;
  if (user.status !== "ACTIVE") throw new Error("This user account is disabled. Contact the company Owner / Master.");

  const valid = await verifyPassword(
    password,
    user.password_salt,
    user.password_hash,
    Number(user.password_iterations),
  );
  if (!valid) return null;

  const now = new Date().toISOString();
  await database.execute(`UPDATE users SET last_login_at=$1, updated_at=updated_at WHERE id=$2 AND company_id=$3`, [
    now,
    user.id,
    company.id,
  ]);
  await createAuditLog(company.id, user.id, "LOGIN", "SECURITY", user.id, "User signed in.");

  return {
    userId: user.id,
    companyId: company.id,
    companyCode: company.company_code,
    companyName: company.name,
    fullName: user.full_name,
    username: user.username,
    email: user.email,
    phone: user.phone,
    role: user.role,
  };
}

const REMEMBERED_SESSION_DAYS = 90;

function randomSessionToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function hashSessionToken(token: string) {
  const data = new TextEncoder().encode(token);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sessionForUser(companyId: string, userId: string): Promise<UserSession | null> {
  const database = await db();
  const companies = await database.select<Company[]>(
    `SELECT id,company_code,name,dts_license,logo_data,address,phone,whatsapp,email,base_currency,foreign_currency,status,created_at,updated_at
     FROM companies WHERE id=$1 LIMIT 1`,
    [companyId],
  );
  const company = companies[0];
  if (!company || company.status !== "ACTIVE") return null;

  const users = await database.select<UserRow[]>(
    `SELECT id,company_id,full_name,username,email,phone,phone_normalized,password_hash,password_salt,password_iterations,role,status
     FROM users WHERE id=$1 AND company_id=$2 LIMIT 1`,
    [userId, companyId],
  );
  const user = users[0];
  if (!user || user.status !== "ACTIVE") return null;

  return {
    userId: user.id,
    companyId: company.id,
    companyCode: company.company_code,
    companyName: company.name,
    fullName: user.full_name,
    username: user.username,
    email: user.email,
    phone: user.phone,
    role: user.role,
  };
}

export async function createRememberedSession(session: UserSession, deviceId: string) {
  const database = await db();
  const token = randomSessionToken();
  const tokenHash = await hashSessionToken(token);
  const now = new Date();
  const expires = new Date(now.getTime() + REMEMBERED_SESSION_DAYS * 24 * 60 * 60 * 1000);

  // Revoke only the previous session for THIS user on THIS device.
  // Other devices remain independently signed in — matching the future SaaS model.
  await database.execute(
    `UPDATE remembered_sessions SET status='REVOKED'
     WHERE company_id=$1 AND user_id=$2 AND device_id=$3 AND status='ACTIVE'`,
    [session.companyId, session.userId, deviceId],
  );

  await database.execute(
    `INSERT INTO remembered_sessions
     (id,company_id,user_id,device_id,token_hash,status,created_at,last_used_at,expires_at)
     VALUES ($1,$2,$3,$4,$5,'ACTIVE',$6,$6,$7)`,
    [
      crypto.randomUUID(),
      session.companyId,
      session.userId,
      deviceId,
      tokenHash,
      now.toISOString(),
      expires.toISOString(),
    ],
  );

  return token;
}

export async function restoreRememberedSession(token: string): Promise<UserSession | null> {
  if (!token) return null;
  const database = await db();
  const tokenHash = await hashSessionToken(token);

  const rows = await database.select<
    Array<{
      id: string;
      company_id: string;
      user_id: string;
      status: string;
      expires_at: string;
    }>
  >(
    `SELECT id,company_id,user_id,status,expires_at
     FROM remembered_sessions
     WHERE token_hash=$1
     LIMIT 1`,
    [tokenHash],
  );

  const remembered = rows[0];
  if (!remembered || remembered.status !== "ACTIVE") return null;

  const now = new Date();
  if (new Date(remembered.expires_at).getTime() <= now.getTime()) {
    await database.execute(`UPDATE remembered_sessions SET status='EXPIRED' WHERE id=$1`, [remembered.id]);
    return null;
  }

  const session = await sessionForUser(remembered.company_id, remembered.user_id);
  if (!session) {
    await database.execute(`UPDATE remembered_sessions SET status='REVOKED' WHERE id=$1`, [remembered.id]);
    return null;
  }

  const renewedExpiry = new Date(now.getTime() + REMEMBERED_SESSION_DAYS * 24 * 60 * 60 * 1000);
  await database.execute(`UPDATE remembered_sessions SET last_used_at=$1, expires_at=$2 WHERE id=$3`, [
    now.toISOString(),
    renewedExpiry.toISOString(),
    remembered.id,
  ]);
  await createAuditLog(
    session.companyId,
    session.userId,
    "SESSION_RESTORED",
    "SECURITY",
    session.userId,
    "Remembered device session restored.",
  );

  return session;
}

export async function revokeRememberedSession(token: string) {
  if (!token) return;
  const database = await db();
  const tokenHash = await hashSessionToken(token);
  await database.execute(`UPDATE remembered_sessions SET status='REVOKED' WHERE token_hash=$1`, [tokenHash]);
}

export async function getCompanyById(companyId: string) {
  const database = await db();
  const rows = await database.select<Company[]>(
    `SELECT id,company_code,name,dts_license,logo_data,address,phone,whatsapp,email,base_currency,foreign_currency,status,created_at,updated_at
     FROM companies WHERE id=$1 LIMIT 1`,
    [companyId],
  );
  return rows[0] ?? null;
}

export async function getCompaniesForUser(userId: string) {
  const database = await db();
  return database.select<Company[]>(
    `SELECT c.id,c.company_code,c.name,c.dts_license,c.logo_data,c.address,c.phone,c.whatsapp,c.email,
            c.base_currency,c.foreign_currency,c.status,c.created_at,c.updated_at
     FROM companies c
     INNER JOIN users u ON u.company_id=c.id
     WHERE u.id=$1
     ORDER BY c.name`,
    [userId],
  );
}

export async function getCompanyUsers(companyId: string) {
  const database = await db();
  return database.select<CompanyUser[]>(
    `SELECT id,company_id,full_name,username,email,phone,role,status,created_at,updated_at,last_login_at
     FROM users
     WHERE company_id=$1
     ORDER BY CASE role WHEN 'OWNER' THEN 0 WHEN 'ADMIN' THEN 1 WHEN 'ACCOUNTS' THEN 2 WHEN 'DATA_ENTRY' THEN 3 ELSE 4 END,
              full_name COLLATE NOCASE`,
    [companyId],
  );
}

async function ensureUserIdentityAvailable(
  companyId: string,
  username: string,
  email: string,
  phoneNormalized: string,
  excludeUserId = "",
) {
  const database = await db();
  const rows = await database.select<Array<{ id: string; username: string; email: string; phone_normalized: string }>>(
    `SELECT id,username,email,phone_normalized FROM users WHERE company_id=$1 AND ($2='' OR id<>$2)`,
    [companyId, excludeUserId],
  );

  if (rows.some((row) => row.username.toLowerCase() === username.toLowerCase())) {
    throw new Error("That username already exists inside this company.");
  }
  if (email && rows.some((row) => row.email.toLowerCase() === email.toLowerCase())) {
    throw new Error("That email is already used by another user inside this company.");
  }
  if (phoneNormalized && rows.some((row) => row.phone_normalized === phoneNormalized)) {
    throw new Error("That phone number is already used by another user inside this company.");
  }
}

function validateEmployeeRole(role: string): asserts role is Exclude<UserRole, "OWNER"> {
  if (!["ADMIN", "ACCOUNTS", "DATA_ENTRY", "VIEW_ONLY"].includes(role)) {
    throw new Error("Invalid employee role.");
  }
}

export async function createCompanyUser(companyId: string, actorUserId: string, input: CompanyUserInput) {
  await requirePermission(companyId, actorUserId, "manage_users");
  validateEmployeeRole(input.role);

  const database = await db();
  const fullName = input.fullName.trim();
  const username = validateOwnerUsername(input.username);
  const email = validateEmail(input.email);
  const phone = input.phone.trim();
  const phoneNormalized = normalizePhone(phone);
  if (!fullName) throw new Error("Employee full name is required.");
  validateStrongPassword(input.password);

  await ensureUserIdentityAvailable(companyId, username, email, phoneNormalized);

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const password = await createPasswordRecord(input.password);

  await database.execute(
    `INSERT INTO users
     (id,company_id,full_name,username,email,phone,phone_normalized,password_hash,password_salt,password_iterations,role,status,created_at,updated_at,last_login_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'ACTIVE',$12,$12,'')`,
    [
      id,
      companyId,
      fullName,
      username,
      email,
      phone,
      phoneNormalized,
      password.hash,
      password.salt,
      password.iterations,
      input.role,
      now,
    ],
  );

  await createAuditLog(companyId, actorUserId, "USER_CREATED", "SECURITY", id, `${fullName} created as ${input.role}.`);
  return id;
}

export async function updateCompanyUser(
  companyId: string,
  actorUserId: string,
  targetUserId: string,
  input: UpdateCompanyUserInput,
) {
  await requirePermission(companyId, actorUserId, "manage_users");
  validateEmployeeRole(input.role);
  const database = await db();

  const target = await database.select<CompanyUser[]>(
    `SELECT id,company_id,full_name,username,email,phone,role,status,created_at,updated_at,last_login_at
     FROM users WHERE id=$1 AND company_id=$2 LIMIT 1`,
    [targetUserId, companyId],
  );
  if (!target[0]) throw new Error("User not found.");
  if (target[0].role === "OWNER")
    throw new Error("The Owner / Master account cannot be changed from Employee Management.");

  const fullName = input.fullName.trim();
  const username = validateOwnerUsername(input.username);
  const email = validateEmail(input.email);
  const phone = input.phone.trim();
  const phoneNormalized = normalizePhone(phone);
  if (!fullName) throw new Error("Full name is required.");

  await ensureUserIdentityAvailable(companyId, username, email, phoneNormalized, targetUserId);
  await database.execute(
    `UPDATE users SET full_name=$1,username=$2,email=$3,phone=$4,phone_normalized=$5,role=$6,updated_at=$7
     WHERE id=$8 AND company_id=$9`,
    [fullName, username, email, phone, phoneNormalized, input.role, new Date().toISOString(), targetUserId, companyId],
  );
  await createAuditLog(
    companyId,
    actorUserId,
    "USER_UPDATED",
    "SECURITY",
    targetUserId,
    `${fullName} updated; role ${input.role}.`,
  );
}

export async function setCompanyUserStatus(
  companyId: string,
  actorUserId: string,
  targetUserId: string,
  status: "ACTIVE" | "DISABLED",
) {
  await requirePermission(companyId, actorUserId, "manage_users");
  const database = await db();
  const rows = await database.select<Array<{ full_name: string; role: UserRole }>>(
    `SELECT full_name,role FROM users WHERE id=$1 AND company_id=$2 LIMIT 1`,
    [targetUserId, companyId],
  );
  const target = rows[0];
  if (!target) throw new Error("User not found.");
  if (target.role === "OWNER") throw new Error("The Owner / Master account cannot be disabled.");

  await database.execute(`UPDATE users SET status=$1,updated_at=$2 WHERE id=$3 AND company_id=$4`, [
    status,
    new Date().toISOString(),
    targetUserId,
    companyId,
  ]);
  await createAuditLog(
    companyId,
    actorUserId,
    status === "ACTIVE" ? "USER_ENABLED" : "USER_DISABLED",
    "SECURITY",
    targetUserId,
    `${target.full_name} set to ${status}.`,
  );
}

export async function resetCompanyUserPassword(
  companyId: string,
  actorUserId: string,
  targetUserId: string,
  newPassword: string,
) {
  await requirePermission(companyId, actorUserId, "manage_users");
  validateStrongPassword(newPassword);
  const database = await db();
  const rows = await database.select<Array<{ full_name: string; role: UserRole }>>(
    `SELECT full_name,role FROM users WHERE id=$1 AND company_id=$2 LIMIT 1`,
    [targetUserId, companyId],
  );
  const target = rows[0];
  if (!target) throw new Error("User not found.");
  if (target.role === "OWNER") throw new Error("Use My Account to change the Owner password.");

  const password = await createPasswordRecord(newPassword);
  await database.execute(
    `UPDATE users SET password_hash=$1,password_salt=$2,password_iterations=$3,updated_at=$4 WHERE id=$5 AND company_id=$6`,
    [password.hash, password.salt, password.iterations, new Date().toISOString(), targetUserId, companyId],
  );
  await createAuditLog(
    companyId,
    actorUserId,
    "PASSWORD_RESET",
    "SECURITY",
    targetUserId,
    `Password reset for ${target.full_name}.`,
  );
}

export async function changeOwnPassword(
  companyId: string,
  userId: string,
  currentPassword: string,
  newPassword: string,
) {
  validateStrongPassword(newPassword);
  const database = await db();
  const rows = await database.select<UserRow[]>(
    `SELECT id,company_id,full_name,username,email,phone,phone_normalized,password_hash,password_salt,password_iterations,role,status
     FROM users WHERE id=$1 AND company_id=$2 LIMIT 1`,
    [userId, companyId],
  );
  const user = rows[0];
  if (!user || user.status !== "ACTIVE") throw new Error("Active user account not found.");
  const valid = await verifyPassword(
    currentPassword,
    user.password_salt,
    user.password_hash,
    Number(user.password_iterations),
  );
  if (!valid) throw new Error("Current password is incorrect.");

  const password = await createPasswordRecord(newPassword);
  await database.execute(
    `UPDATE users SET password_hash=$1,password_salt=$2,password_iterations=$3,updated_at=$4 WHERE id=$5 AND company_id=$6`,
    [password.hash, password.salt, password.iterations, new Date().toISOString(), userId, companyId],
  );
  await createAuditLog(companyId, userId, "PASSWORD_CHANGED", "SECURITY", userId, "User changed their own password.");
}

export async function updateCompanyProfile(companyId: string, actorUserId: string, input: CompanyProfileInput) {
  await requirePermission(companyId, actorUserId, "manage_company");
  if (!input.name.trim()) throw new Error("Company name is required.");
  const database = await db();
  await database.execute(
    `UPDATE companies SET name=$1,dts_license=$2,logo_data=$3,address=$4,phone=$5,whatsapp=$6,email=$7,base_currency=$8,foreign_currency=$9,updated_at=$10
     WHERE id=$11`,
    [
      input.name.trim(),
      input.dtsLicense.trim(),
      input.logoData,
      input.address.trim(),
      input.phone.trim(),
      input.whatsapp.trim(),
      validateEmail(input.email),
      input.baseCurrency || "PKR",
      input.foreignCurrency || "SAR",
      new Date().toISOString(),
      companyId,
    ],
  );
  await createAuditLog(companyId, actorUserId, "COMPANY_UPDATED", "SECURITY", companyId, "Company profile updated.");
}

export async function getAuditLogs(companyId: string, limit = 250) {
  const database = await db();
  const safeLimit = Math.max(1, Math.min(1000, Math.trunc(limit || 250)));
  return database.select<AuditLog[]>(
    `SELECT id,company_id,user_id,user_name,action,module,record_id,details,created_at
     FROM audit_logs WHERE company_id=$1 ORDER BY created_at DESC LIMIT ${safeLimit}`,
    [companyId],
  );
}

export async function getParties(companyId: string, search = "") {
  const isTauri = "__TAURI_INTERNALS__" in window;
  const clean = search.trim();

  if (!isTauri) {
    let query = supabase.from("parties").select("*").eq("company_id", companyId);
    if (clean) {
      query = query.or(
        `name.ilike.%${clean}%,phone.ilike.%${clean}%,whatsapp.ilike.%${clean}%,address.ilike.%${clean}%`,
      );
    }
    const { data, error } = await query;
    if (error) throw new Error(error.message);

    return (data as Party[]).sort((a, b) => {
      if (a.status === "ACTIVE" && b.status !== "ACTIVE") return -1;
      if (a.status !== "ACTIVE" && b.status === "ACTIVE") return 1;
      return a.name.localeCompare(b.name);
    });
  }

  const database = await db();

  if (!clean) {
    return database.select<Party[]>(
      `SELECT id,company_id,name,phone,whatsapp,address,notes,status,account_type,created_at,updated_at
       FROM parties
       WHERE company_id = $1
       ORDER BY CASE WHEN status='ACTIVE' THEN 0 ELSE 1 END, name COLLATE NOCASE`,
      [companyId],
    );
  }

  const term = `%${clean}%`;
  return database.select<Party[]>(
    `SELECT id,company_id,name,phone,whatsapp,address,notes,status,account_type,created_at,updated_at
     FROM parties
     WHERE company_id = $1
       AND (
         name LIKE $2 COLLATE NOCASE OR
         phone LIKE $2 OR
         whatsapp LIKE $2 OR
         address LIKE $2 COLLATE NOCASE
       )
     ORDER BY CASE WHEN status='ACTIVE' THEN 0 ELSE 1 END, name COLLATE NOCASE`,
    [companyId, term],
  );
}

function accountLabel(accountType: PartyInput["accountType"] | string) {
  if (accountType === "VENDOR") return "Vendor";
  if (accountType === "PARTY") return "Party";
  return "Account";
}

async function assertUniqueAccountName(
  companyId: string,
  accountType: PartyInput["accountType"],
  name: string,
  excludeId = "",
) {
  const cleanName = name.trim();
  const isTauri = "__TAURI_INTERNALS__" in window;

  if (!isTauri) {
    let query = supabase
      .from("parties")
      .select("id")
      .eq("company_id", companyId)
      .eq("account_type", accountType)
      .ilike("name", cleanName)
      .limit(1);
    if (excludeId) query = query.neq("id", excludeId);
    const { data: duplicate, error } = await query;
    if (error) throw new Error(error.message);
    if (duplicate && duplicate.length > 0) {
      throw new Error(
        `A ${accountLabel(accountType).toLowerCase()} named "${cleanName}" already exists. Party and Vendor can share the same name, but two ${accountLabel(accountType).toLowerCase()}s cannot.`,
      );
    }
    return;
  }

  const database = await db();
  const duplicate = await database.select<CountRow[]>(
    `SELECT COUNT(*) AS count
     FROM parties
     WHERE company_id = $1
       AND account_type = $2
       AND name = $3 COLLATE NOCASE
       AND ($4 = '' OR id <> $4)`,
    [companyId, accountType, cleanName, excludeId],
  );

  if (Number(duplicate[0]?.count ?? 0) > 0) {
    throw new Error(
      `A ${accountLabel(accountType).toLowerCase()} named "${cleanName}" already exists. Party and Vendor can share the same name, but two ${accountLabel(accountType).toLowerCase()}s cannot.`,
    );
  }
}

export async function createParty(companyId: string, input: PartyInput, actorUserId = "") {
  await requirePermission(companyId, actorUserId, "edit_parties");
  const database = await db();
  const now = new Date().toISOString();

  await assertUniqueAccountName(companyId, input.accountType, input.name);

  const id = crypto.randomUUID();

  await database.execute(
    `INSERT INTO parties
     (id,company_id,name,phone,whatsapp,address,notes,status,account_type,created_at,updated_at,created_by_user_id,updated_by_user_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10,$11,$11)`,
    [
      id,
      companyId,
      input.name.trim(),
      input.phone.trim(),
      input.whatsapp.trim(),
      input.address.trim(),
      input.notes.trim(),
      input.status,
      input.accountType,
      now,
      actorUserId,
    ],
  );

  if (actorUserId) {
    await createAuditLog(
      companyId,
      actorUserId,
      "ACCOUNT_CREATED",
      "PARTIES",
      id,
      `${input.accountType}: ${input.name.trim()}`,
    );
  }

  // Queue to Supabase
  await queueSync("INSERT", "parties", id, {
    id,
    company_id: companyId,
    name: input.name.trim(),
    phone: input.phone.trim(),
    whatsapp: input.whatsapp.trim(),
    address: input.address.trim(),
    notes: input.notes.trim(),
    status: input.status,
    account_type: input.accountType,
    created_at: now,
    updated_at: now,
    created_by_user_id: actorUserId,
    updated_by_user_id: actorUserId,
  });

  return id;
}

export async function updateParty(partyId: string, companyId: string, input: PartyInput, actorUserId = "") {
  await requirePermission(companyId, actorUserId, "edit_parties");
  const database = await db();

  await assertUniqueAccountName(companyId, input.accountType, input.name, partyId);

  await database.execute(
    `UPDATE parties
     SET name=$1, phone=$2, whatsapp=$3, address=$4, notes=$5,
         status=$6, account_type=$7, updated_at=$8, updated_by_user_id=$9
     WHERE id=$10 AND company_id=$11`,
    [
      input.name.trim(),
      input.phone.trim(),
      input.whatsapp.trim(),
      input.address.trim(),
      input.notes.trim(),
      input.status,
      input.accountType,
      new Date().toISOString(),
      actorUserId,
      partyId,
      companyId,
    ],
  );
  if (actorUserId) {
    await createAuditLog(
      companyId,
      actorUserId,
      "ACCOUNT_UPDATED",
      "PARTIES",
      partyId,
      `${input.accountType}: ${input.name.trim()}`,
    );
  }

  // Queue to Supabase
  await queueSync("UPDATE", "parties", partyId, {
    name: input.name.trim(),
    phone: input.phone.trim(),
    whatsapp: input.whatsapp.trim(),
    address: input.address.trim(),
    notes: input.notes.trim(),
    status: input.status,
    account_type: input.accountType,
    updated_at: new Date().toISOString(),
    updated_by_user_id: actorUserId,
  });
}

export async function getPartyById(companyId: string, partyId: string) {
  const isTauri = "__TAURI_INTERNALS__" in window;
  if (!isTauri) {
    const { data, error } = await supabase
      .from("parties")
      .select("id,company_id,name,phone,whatsapp,address,notes,status,account_type,created_at,updated_at")
      .eq("company_id", companyId)
      .eq("id", partyId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return (data as Party | null) ?? null;
  }

  const database = await db();

  const rows = await database.select<Party[]>(
    `SELECT id,company_id,name,phone,whatsapp,address,notes,status,account_type,created_at,updated_at
     FROM parties
     WHERE company_id=$1 AND id=$2
     LIMIT 1`,
    [companyId, partyId],
  );

  return rows[0] ?? null;
}

export async function deleteParty(partyId: string, companyId: string, actorUserId = "") {
  await requirePermission(companyId, actorUserId, "edit_parties");
  const isTauri = "__TAURI_INTERNALS__" in window;

  if (isTauri) {
    const database = await db();
    await database.execute(`DELETE FROM parties WHERE id=$1 AND company_id=$2`, [partyId, companyId]);
  }

  if (actorUserId) {
    await createAuditLog(companyId, actorUserId, "ACCOUNT_DELETED", "PARTIES", partyId, `Party/Vendor Deleted`);
  }

  // Always remove from Supabase so the other app can reconcile.
  await queueSync("DELETE", "parties", partyId, {});
}

export async function deleteBooking(bookingId: string, companyId: string, actorUserId = "") {
  await requirePermission(companyId, actorUserId, "edit_bookings");
  const isTauri = "__TAURI_INTERNALS__" in window;
  const database = await db();

  const bookingChildTables = [
    "package_booking_lines",
    "package_operational_meta",
    "package_operational_passengers",
    "package_operational_hotels",
    "package_operational_flights",
    "package_operational_flight_stopovers",
    "package_movement_events",
    "ticket_booking_lines",
    "ticket_operational_meta",
    "ticket_operational_passengers",
    "ticket_operational_flights",
    "hotel_booking_lines",
    "visa_booking_lines",
    "visa_passport_details",
    "visa_transport_fleet",
    "visa_operational_meta",
    "visa_operational_passengers",
    "transport_booking_lines",
    "transport_operational_meta",
    "transport_operational_sectors",
    "misc_booking_lines",
    "misc_booking_details",
    "misc_operational_meta",
    "misc_operational_services",
    "misc_commercial_family_refs",
  ];

  const bookingHeaderTables = [
    "package_bookings",
    "ticket_bookings",
    "hotel_bookings",
    "visa_bookings",
    "transport_bookings",
    "misc_bookings",
  ];

  for (const table of bookingChildTables) {
    try {
      if (isTauri) {
        await database.execute(`DELETE FROM ${table} WHERE booking_id=$1`, [bookingId]);
      } else {
        const { error } = await supabase.from(table).delete().eq("booking_id", bookingId);
        if (error) console.warn(`Could not delete from ${table} in cloud:`, error.message);
      }
    } catch (e) {
      console.warn(`Could not delete from ${table}`, e);
    }
  }

  for (const table of bookingHeaderTables) {
    try {
      if (isTauri) {
        await database.execute(`DELETE FROM ${table} WHERE id=$1 AND company_id=$2`, [bookingId, companyId]);
      }
      await queueSync("DELETE", table, bookingId, {});
    } catch (e) {
      console.warn(`Could not delete from ${table}`, e);
    }
  }
}

function calculateAccommodation(input: AccommodationInput) {
  const nights = Math.max(0, Math.trunc(Number(input.nights) || 0));
  const beds = Math.max(0, Math.trunc(Number(input.bedRoomCount) || 0));
  const rate = Math.max(0, Number(input.rate) || 0);
  const base = rate * nights * beds;

  if (input.currency === "SAR") {
    const roe = Math.max(0, Number(input.roe) || 0);
    return {
      nights,
      beds,
      rate,
      roe,
      totalSar: base,
      totalPkr: base * roe,
    };
  }

  return {
    nights,
    beds,
    rate,
    roe: 0,
    totalSar: 0,
    totalPkr: base,
  };
}

function validateAccommodation(input: AccommodationInput) {
  if (!input.partyId) throw new Error("Select a Party / Vendor account.");
  if (!input.transactionDate) throw new Error("Transaction date is required.");
  if (!input.bookingPartyName.trim()) throw new Error("Party Name is required.");
  if (!input.city.trim()) throw new Error("City is required.");
  if (!input.hotelName.trim()) throw new Error("Hotel Name is required.");
  if (!input.checkIn) throw new Error("Check-In date is required.");
  if (!input.checkOut) throw new Error("Check-Out date is required.");
  if ((Number(input.nights) || 0) <= 0) throw new Error("No. of Nights must be greater than zero.");
  if ((Number(input.rate) || 0) <= 0) throw new Error("Rate must be greater than zero.");
  if ((Number(input.bedRoomCount) || 0) <= 0) throw new Error("No. of Bed/Room must be greater than zero.");
  if (input.currency === "SAR" && (Number(input.roe) || 0) <= 0) {
    throw new Error("ROE is required for a SAR transaction.");
  }
}

export async function getAccommodations(companyId: string, search = "", partyId = "") {
  const database = await db();
  const clean = search.trim();
  const term = `%${clean}%`;

  return database.select<AccommodationEntry[]>(
    `SELECT
       a.id, a.company_id, a.party_id,
       COALESCE(p.name, '') AS ledger_party_name,
       a.transaction_date, a.ub_number, a.booking_party_name,
       a.city, a.hotel_name, a.check_in, a.check_out,
       a.nights, a.rate, a.bed_room_count, a.currency,
       a.roe, a.total_sar, a.total_pkr, a.status,
       a.created_at, a.updated_at
     FROM accommodation_entries a
     LEFT JOIN parties p ON p.id = a.party_id AND p.company_id = a.company_id
     WHERE a.company_id = $1
       AND ($2 = '' OR a.party_id = $2)
       AND (
         $3 = '' OR
         a.ub_number LIKE $4 COLLATE NOCASE OR
         a.booking_party_name LIKE $4 COLLATE NOCASE OR
         a.city LIKE $4 COLLATE NOCASE OR
         a.hotel_name LIKE $4 COLLATE NOCASE OR
         COALESCE(p.name, '') LIKE $4 COLLATE NOCASE
       )
     ORDER BY a.transaction_date DESC, a.created_at DESC`,
    [companyId, partyId, clean, term],
  );
}

export async function createAccommodation(companyId: string, input: AccommodationInput) {
  validateAccommodation(input);
  const database = await db();
  const calculated = calculateAccommodation(input);
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  await database.execute(
    `INSERT INTO accommodation_entries
     (id, company_id, party_id, transaction_date, ub_number,
      booking_party_name, city, hotel_name, check_in, check_out,
      nights, rate, bed_room_count, currency, roe,
      total_sar, total_pkr, status, created_at, updated_at)
     VALUES
     ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,'ACTIVE',$18,$18)`,
    [
      id,
      companyId,
      input.partyId,
      input.transactionDate,
      input.ubNumber.trim(),
      input.bookingPartyName.trim(),
      input.city.trim(),
      input.hotelName.trim(),
      input.checkIn,
      input.checkOut,
      calculated.nights,
      calculated.rate,
      calculated.beds,
      input.currency,
      calculated.roe,
      calculated.totalSar,
      calculated.totalPkr,
      now,
    ],
  );

  return id;
}

export async function updateAccommodation(companyId: string, entryId: string, input: AccommodationInput) {
  validateAccommodation(input);
  const database = await db();
  const calculated = calculateAccommodation(input);

  await database.execute(
    `UPDATE accommodation_entries
     SET party_id=$1,
         transaction_date=$2,
         ub_number=$3,
         booking_party_name=$4,
         city=$5,
         hotel_name=$6,
         check_in=$7,
         check_out=$8,
         nights=$9,
         rate=$10,
         bed_room_count=$11,
         currency=$12,
         roe=$13,
         total_sar=$14,
         total_pkr=$15,
         updated_at=$16
     WHERE id=$17 AND company_id=$18 AND status='ACTIVE'`,
    [
      input.partyId,
      input.transactionDate,
      input.ubNumber.trim(),
      input.bookingPartyName.trim(),
      input.city.trim(),
      input.hotelName.trim(),
      input.checkIn,
      input.checkOut,
      calculated.nights,
      calculated.rate,
      calculated.beds,
      input.currency,
      calculated.roe,
      calculated.totalSar,
      calculated.totalPkr,
      new Date().toISOString(),
      entryId,
      companyId,
    ],
  );
}

export async function voidAccommodation(companyId: string, entryId: string) {
  const database = await db();

  await database.execute(
    `UPDATE accommodation_entries
     SET status='VOID', updated_at=$1
     WHERE id=$2 AND company_id=$3 AND status='ACTIVE'`,
    [new Date().toISOString(), entryId, companyId],
  );
}

export async function getPartyAccommodationTotals(companyId: string) {
  const database = await db();

  return database.select<PartyAccommodationTotal[]>(
    `SELECT party_id, COALESCE(SUM(total_pkr), 0) AS total_pkr
     FROM accommodation_entries
     WHERE company_id=$1 AND status='ACTIVE'
     GROUP BY party_id`,
    [companyId],
  );
}

function calculateService(input: ServiceInput) {
  const rate = Math.max(0, Number(input.rate) || 0);
  const pax = Math.max(0, Math.trunc(Number(input.pax) || 0));
  const spt = Math.max(0, Number(input.spt) || 0);
  const shr = Math.max(0, Number(input.shr) || 0);
  const base = (rate + shr) * pax + spt;

  if (input.currency === "SAR") {
    const roe = Math.max(0, Number(input.roe) || 0);
    return { rate, pax, spt, shr, roe, totalSar: base, totalPkr: base * roe };
  }

  return { rate, pax, spt, shr, roe: 0, totalSar: 0, totalPkr: base };
}

function validateService(input: ServiceInput) {
  if (!input.partyId) throw new Error("Select a Party / Vendor account.");
  if (!input.transactionDate) throw new Error("Transaction date is required.");
  if (!input.bookingPartyName.trim()) throw new Error("Party Name is required.");
  if (!input.serviceType.trim()) throw new Error("Service Type is required.");
  if ((Number(input.rate) || 0) <= 0) throw new Error("Rate must be greater than zero.");
  if ((Number(input.pax) || 0) <= 0) throw new Error("No. of Pax must be greater than zero.");
  if ((Number(input.spt) || 0) < 0) throw new Error("SPT cannot be negative.");
  if ((Number(input.shr) || 0) < 0) throw new Error("SHR cannot be negative.");
  if (input.currency === "SAR" && (Number(input.roe) || 0) <= 0) {
    throw new Error("ROE is required for a SAR transaction.");
  }
}

export async function getServices(companyId: string, search = "", partyId = "") {
  const database = await db();
  const clean = search.trim();
  const term = `%${clean}%`;

  return database.select<ServiceEntry[]>(
    `SELECT
       s.id, s.company_id, s.party_id,
       COALESCE(p.name, '') AS ledger_party_name,
       s.transaction_date, s.ub_number, s.booking_party_name,
       s.service_type, s.rate, s.pax, s.spt, s.shr,
       s.currency, s.roe, s.total_sar, s.total_pkr,
       s.status, s.created_at, s.updated_at
     FROM service_entries s
     LEFT JOIN parties p ON p.id = s.party_id AND p.company_id = s.company_id
     WHERE s.company_id = $1
       AND ($2 = '' OR s.party_id = $2)
       AND (
         $3 = '' OR
         s.ub_number LIKE $4 COLLATE NOCASE OR
         s.booking_party_name LIKE $4 COLLATE NOCASE OR
         s.service_type LIKE $4 COLLATE NOCASE OR
         COALESCE(p.name, '') LIKE $4 COLLATE NOCASE
       )
     ORDER BY s.transaction_date DESC, s.created_at DESC`,
    [companyId, partyId, clean, term],
  );
}

export async function createService(companyId: string, input: ServiceInput) {
  validateService(input);
  const database = await db();
  const calculated = calculateService(input);
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  await database.execute(
    `INSERT INTO service_entries
     (id, company_id, party_id, transaction_date, ub_number,
      booking_party_name, service_type, rate, pax, spt, shr,
      currency, roe, total_sar, total_pkr, status, created_at, updated_at)
     VALUES
     ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'ACTIVE',$16,$16)`,
    [
      id,
      companyId,
      input.partyId,
      input.transactionDate,
      input.ubNumber.trim(),
      input.bookingPartyName.trim(),
      input.serviceType.trim(),
      calculated.rate,
      calculated.pax,
      calculated.spt,
      calculated.shr,
      input.currency,
      calculated.roe,
      calculated.totalSar,
      calculated.totalPkr,
      now,
    ],
  );
  return id;
}

export async function updateService(companyId: string, entryId: string, input: ServiceInput) {
  validateService(input);
  const database = await db();
  const calculated = calculateService(input);

  await database.execute(
    `UPDATE service_entries
     SET party_id=$1, transaction_date=$2, ub_number=$3, booking_party_name=$4,
         service_type=$5, rate=$6, pax=$7, spt=$8, shr=$9, currency=$10,
         roe=$11, total_sar=$12, total_pkr=$13, updated_at=$14
     WHERE id=$15 AND company_id=$16 AND status='ACTIVE'`,
    [
      input.partyId,
      input.transactionDate,
      input.ubNumber.trim(),
      input.bookingPartyName.trim(),
      input.serviceType.trim(),
      calculated.rate,
      calculated.pax,
      calculated.spt,
      calculated.shr,
      input.currency,
      calculated.roe,
      calculated.totalSar,
      calculated.totalPkr,
      new Date().toISOString(),
      entryId,
      companyId,
    ],
  );
}

export async function voidService(companyId: string, entryId: string) {
  const database = await db();
  await database.execute(
    `UPDATE service_entries SET status='VOID', updated_at=$1
     WHERE id=$2 AND company_id=$3 AND status='ACTIVE'`,
    [new Date().toISOString(), entryId, companyId],
  );
}

export async function getPartyServiceTotals(companyId: string) {
  const database = await db();
  return database.select<PartyServiceTotal[]>(
    `SELECT party_id, COALESCE(SUM(total_pkr), 0) AS total_pkr
     FROM service_entries
     WHERE company_id=$1 AND status='ACTIVE'
     GROUP BY party_id`,
    [companyId],
  );
}

function calculatePayment(input: PaymentInput) {
  const amount = Math.max(0, Number(input.amount) || 0);
  if (input.currency === "SAR") {
    const roe = Math.max(0, Number(input.roe) || 0);
    return { amount, sar: amount, roe, paidAmount: amount * roe };
  }
  return { amount, sar: 0, roe: 0, paidAmount: amount };
}

function validatePayment(input: PaymentInput) {
  if (!input.partyId) throw new Error("Select a Party / Vendor account.");
  if (!input.transactionDate) throw new Error("Payment date is required.");
  if (!input.fromAccount.trim()) throw new Error("From Account is required.");
  if (!input.toAccount.trim()) throw new Error("To Account is required.");
  if (!input.paymentType) throw new Error("Payment Type is required.");
  if ((Number(input.amount) || 0) <= 0) throw new Error("Amount must be greater than zero.");
  if (input.currency === "SAR" && (Number(input.roe) || 0) <= 0) {
    throw new Error("ROE is required for a SAR payment.");
  }
}

async function fetchPartyNameMap(companyId: string) {
  const { data, error } = await supabase.from("parties").select("id, name").eq("company_id", companyId);
  if (error) throw new Error(error.message);
  return new Map((data || []).map((row) => [String(row.id), String(row.name || "")]));
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

export async function getPayments(companyId: string, search = "", partyId = "") {
  const isTauri = "__TAURI_INTERNALS__" in window;
  if (!isTauri) {
    let query = supabase
      .from("payment_entries")
      .select("*")
      .eq("company_id", companyId)
      .order("transaction_date", { ascending: false })
      .order("created_at", { ascending: false });

    if (partyId) {
      query = query.eq("party_id", partyId);
    }

    if (search.trim()) {
      const term = `%${search.trim()}%`;
      query = query.or(
        `receipt_no.ilike.${term},from_account.ilike.${term},to_account.ilike.${term},description.ilike.${term},payment_type.ilike.${term}`,
      );
    }

    const { data, error } = await query;
    if (error) throw new Error(error.message);
    if (!data) return [];

    const partyNames = await fetchPartyNameMap(companyId);
    return data.map((pay: any) => ({
      ...pay,
      ledger_party_name: partyNames.get(String(pay.party_id)) || "",
    })) as PaymentEntry[];
  }

  const database = await db();
  const clean = search.trim();
  const term = `%${clean}%`;
  return database.select<PaymentEntry[]>(
    `SELECT pay.id, pay.company_id, pay.party_id,
            COALESCE(p.name, '') AS ledger_party_name,
            pay.transaction_date, pay.receipt_no, pay.from_account,
            pay.to_account, pay.description, pay.payment_type,
            pay.currency, pay.amount_entered, pay.sar, pay.roe,
            pay.paid_amount, pay.status, pay.created_at, pay.updated_at
     FROM payment_entries pay
     LEFT JOIN parties p ON p.id = pay.party_id AND p.company_id = pay.company_id
     WHERE pay.company_id = $1
       AND ($2 = '' OR pay.party_id = $2)
       AND (
         $3 = '' OR
         pay.receipt_no LIKE $4 COLLATE NOCASE OR
         pay.from_account LIKE $4 COLLATE NOCASE OR
         pay.to_account LIKE $4 COLLATE NOCASE OR
         pay.description LIKE $4 COLLATE NOCASE OR
         pay.payment_type LIKE $4 COLLATE NOCASE OR
         COALESCE(p.name, '') LIKE $4 COLLATE NOCASE
       )
     ORDER BY pay.transaction_date DESC, pay.created_at DESC`,
    [companyId, partyId, clean, term],
  );
}

export async function createPayment(companyId: string, input: PaymentInput) {
  validatePayment(input);
  const database = await db();
  const calculated = calculatePayment(input);
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await database.execute(
    `INSERT INTO payment_entries
     (id, company_id, party_id, transaction_date, receipt_no,
      from_account, to_account, description, payment_type, currency,
      amount_entered, sar, roe, paid_amount, status, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'ACTIVE',$15,$15)`,
    [
      id,
      companyId,
      input.partyId,
      input.transactionDate,
      input.receiptNo.trim(),
      input.fromAccount.trim(),
      input.toAccount.trim(),
      input.description.trim(),
      input.paymentType,
      input.currency,
      calculated.amount,
      calculated.sar,
      calculated.roe,
      calculated.paidAmount,
      now,
    ],
  );
  return id;
}

export async function updatePayment(companyId: string, entryId: string, input: PaymentInput) {
  validatePayment(input);
  const database = await db();
  const calculated = calculatePayment(input);
  await database.execute(
    `UPDATE payment_entries
     SET party_id=$1, transaction_date=$2, receipt_no=$3,
         from_account=$4, to_account=$5, description=$6,
         payment_type=$7, currency=$8, amount_entered=$9,
         sar=$10, roe=$11, paid_amount=$12, updated_at=$13
     WHERE id=$14 AND company_id=$15 AND status='ACTIVE'`,
    [
      input.partyId,
      input.transactionDate,
      input.receiptNo.trim(),
      input.fromAccount.trim(),
      input.toAccount.trim(),
      input.description.trim(),
      input.paymentType,
      input.currency,
      calculated.amount,
      calculated.sar,
      calculated.roe,
      calculated.paidAmount,
      new Date().toISOString(),
      entryId,
      companyId,
    ],
  );
}

export async function voidPayment(companyId: string, entryId: string) {
  const database = await db();
  await database.execute(
    `UPDATE payment_entries SET status='VOID', updated_at=$1
     WHERE id=$2 AND company_id=$3 AND status='ACTIVE'`,
    [new Date().toISOString(), entryId, companyId],
  );
}

export async function getPartyPaymentTotals(companyId: string) {
  const database = await db();
  return database.select<PartyPaymentTotal[]>(
    `SELECT party_id, COALESCE(SUM(paid_amount), 0) AS paid_amount
     FROM payment_entries
     WHERE company_id=$1 AND status='ACTIVE'
     GROUP BY party_id`,
    [companyId],
  );
}

function calculatePackageLines(lines: PackageBookingLineInput[]) {
  if (!lines.length) throw new Error("Add at least one package passenger row.");

  const occurrence: Record<PackagePassengerType, number> = { ADULT: 0, CHILD: 0, INFANT: 0 };

  const calculated = lines.map((line, index) => {
    if (!["ADULT", "CHILD", "INFANT"].includes(line.passengerType)) {
      throw new Error("Invalid passenger type in package booking.");
    }

    occurrence[line.passengerType] += 1;
    const rowLabel = `${line.passengerType} row ${occurrence[line.passengerType]}`;
    const passengerName = line.passengerName.trim();
    const packageType = line.packageType.trim();
    const rate = Number(line.ratePerPerson) || 0;
    const explicitQty = Boolean(line.qtyIsExplicit);
    const count = explicitQty ? Math.trunc(Number(line.personCount) || 0) : 1;

    if (!passengerName) throw new Error(`${rowLabel}: Passenger Name is required.`);
    if (!packageType) throw new Error(`${rowLabel}: Package Type is required.`);
    if (rate <= 0) throw new Error(`${rowLabel}: Rate Per Person must be greater than zero.`);
    if (explicitQty && count <= 0) throw new Error(`${rowLabel}: Qty must be greater than zero or left blank.`);

    return {
      passengerType: line.passengerType,
      passengerName,
      packageType,
      ratePerPerson: rate,
      personCount: count,
      qtyIsExplicit: explicitQty ? 1 : 0,
      lineTotalPkr: rate * count,
      sortOrder: index + 1,
    };
  });

  if (occurrence.ADULT === 0) {
    throw new Error("At least one Adult package row is required.");
  }

  const totalPkr = calculated.reduce((sum, line) => sum + line.lineTotalPkr, 0);
  return { calculated, totalPkr };
}

function normalizePackageUb(value: string) {
  return value.trim().replace(/\s+/g, " ").toUpperCase();
}

async function validateUniquePackageUb(companyId: string, ubNumber: string, editingBookingId?: string) {
  const database = await db();
  const normalized = normalizePackageUb(ubNumber);
  const rows = await database.select<Array<{ id: string; ub_number: string }>>(
    `SELECT id, ub_number FROM package_bookings WHERE company_id=$1`,
    [companyId],
  );

  const duplicate = rows.find((row) => row.id !== editingBookingId && normalizePackageUb(row.ub_number) === normalized);
  if (duplicate) {
    throw new Error(
      `UB # / Booking "${ubNumber.trim()}" already exists in Package Booking Register. Use a unique UB #.`,
    );
  }
}

async function validatePackageCounterparty(
  companyId: string,
  transactionType: BookingTransactionType,
  counterpartyId: string,
) {
  if (!counterpartyId) {
    throw new Error(transactionType === "SALE" ? "Select a Party." : "Select a Vendor.");
  }

  const database = await db();
  const rows = await database.select<Pick<Party, "id" | "account_type" | "status">[]>(
    `SELECT id, account_type, status
     FROM parties
     WHERE id=$1 AND company_id=$2
     LIMIT 1`,
    [counterpartyId, companyId],
  );

  const account = rows[0];
  const expected = transactionType === "SALE" ? "PARTY" : "VENDOR";

  if (!account || account.status !== "ACTIVE" || account.account_type !== expected) {
    throw new Error(
      transactionType === "SALE"
        ? "Sale bookings can only be saved against an active Party."
        : "Purchase bookings can only be saved against an active Vendor.",
    );
  }
}

async function validatePackageBooking(companyId: string, input: PackageBookingInput, editingBookingId?: string) {
  if (!["SALE", "PURCHASE"].includes(input.transactionType)) {
    throw new Error("Select Sale or Purchase first.");
  }
  if (!input.transactionDate) throw new Error("Date is required.");
  if (!input.ubNumber.trim()) throw new Error("UB # / Booking is required.");
  await validateUniquePackageUb(companyId, input.ubNumber, editingBookingId);
  await validatePackageCounterparty(companyId, input.transactionType, input.counterpartyId);

  if (input.departureDate && input.returnDate && input.returnDate < input.departureDate) {
    throw new Error("Date of Arrival / Return cannot be before Date of Departure.");
  }
  if (Number(input.noOfDays || 0) < 0) {
    throw new Error("No. of Days cannot be negative.");
  }
  if (!["", "YES", "NO"].includes(input.ziaratIncluded)) {
    throw new Error("Ziarat Included must be Yes, No, or left blank.");
  }

  return calculatePackageLines(input.lines);
}

export async function getPackageBookings(companyId: string, search = "") {
  const isTauri = "__TAURI_INTERNALS__" in window;
  const clean = search.trim();

  if (!isTauri) {
    let query = supabase
      .from("package_bookings")
      .select("*")
      .eq("company_id", companyId)
      .order("transaction_date", { ascending: false })
      .order("created_at", { ascending: false });

    if (clean) {
      query = query.or(
        `ub_number.ilike.%${clean}%,package_description.ilike.%${clean}%,customer_contact.ilike.%${clean}%,notes.ilike.%${clean}%`,
      );
    }

    const { data, error } = await query;
    if (error) throw new Error(error.message);

    const headers = data || [];
    const partyNames = await fetchPartyNameMap(companyId);
    const lines = await fetchChildRowsByBookingIds(
      "package_booking_lines",
      headers.map((row) => String(row.id)),
    );
    const linesByBooking = groupRowsByBookingId(lines);

    return headers.map((row: any) => ({
      ...row,
      counterparty_name: partyNames.get(String(row.counterparty_id)) || "",
      lines: (linesByBooking.get(String(row.id)) || [])
        .slice()
        .sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0)),
    })) as PackageBooking[];
  }

  const database = await db();
  const term = `%${clean}%`;

  const headers = await database.select<Omit<PackageBooking, "lines">[]>(
    `SELECT
       b.id, b.company_id, b.transaction_type, b.counterparty_id,
       COALESCE(p.name, '') AS counterparty_name,
       b.transaction_date, b.ub_number, b.package_description,
       b.departure_date, b.return_date, b.no_of_days, b.ziarat_included,
       b.customer_contact, b.notes, b.total_pkr,
       b.status, b.created_at, b.updated_at
     FROM package_bookings b
     LEFT JOIN parties p ON p.id=b.counterparty_id AND p.company_id=b.company_id
     WHERE b.company_id=$1
       AND (
         $2='' OR
         b.ub_number LIKE $3 COLLATE NOCASE OR
         b.package_description LIKE $3 COLLATE NOCASE OR
         b.customer_contact LIKE $3 COLLATE NOCASE OR
         b.notes LIKE $3 COLLATE NOCASE OR
         COALESCE(p.name, '') LIKE $3 COLLATE NOCASE OR
         EXISTS (
           SELECT 1 FROM package_booking_lines l
           WHERE l.booking_id=b.id AND (l.package_type LIKE $3 COLLATE NOCASE OR l.passenger_name LIKE $3 COLLATE NOCASE)
         )
       )
     ORDER BY b.transaction_date DESC, b.created_at DESC`,
    [companyId, clean, term],
  );

  const lines = await database.select<PackageBookingLine[]>(
    `SELECT l.id, l.booking_id, l.passenger_type, l.passenger_name, l.package_type,
            l.rate_per_person, l.person_count, l.qty_is_explicit, l.line_total_pkr, l.sort_order
     FROM package_booking_lines l
     INNER JOIN package_bookings b ON b.id=l.booking_id
     WHERE b.company_id=$1
     ORDER BY l.sort_order ASC`,
    [companyId],
  );

  const grouped = new Map<string, PackageBookingLine[]>();
  for (const line of lines) {
    const current = grouped.get(line.booking_id) || [];
    current.push(line);
    grouped.set(line.booking_id, current);
  }

  return headers.map((header) => ({
    ...header,
    lines: grouped.get(header.id) || [],
  })) as PackageBooking[];
}

export async function createPackageBooking(companyId: string, input: PackageBookingInput, actorUserId = "") {
  await requirePermission(companyId, actorUserId, "create_bookings");
  const { calculated, totalPkr } = await validatePackageBooking(companyId, input);
  const database = await db();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  await database.execute(
    `INSERT INTO package_bookings
     (id,company_id,transaction_type,counterparty_id,transaction_date,ub_number,
      package_description,departure_date,return_date,no_of_days,ziarat_included,customer_contact,notes,
      total_pkr,status,created_at,updated_at,created_by_user_id,updated_by_user_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'ACTIVE',$15,$15,$16,$16)`,
    [
      id,
      companyId,
      input.transactionType,
      input.counterpartyId,
      input.transactionDate,
      input.ubNumber.trim(),
      input.packageDescription.trim(),
      input.departureDate,
      input.returnDate,
      Math.max(0, Math.trunc(Number(input.noOfDays) || 0)),
      input.ziaratIncluded,
      input.customerContact.trim(),
      input.notes.trim(),
      totalPkr,
      now,
      actorUserId,
    ],
  );

  for (const line of calculated) {
    await database.execute(
      `INSERT INTO package_booking_lines
       (id,booking_id,passenger_type,passenger_name,package_type,rate_per_person,person_count,qty_is_explicit,line_total_pkr,sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        crypto.randomUUID(),
        id,
        line.passengerType,
        line.passengerName,
        line.packageType,
        line.ratePerPerson,
        line.personCount,
        line.qtyIsExplicit,
        line.lineTotalPkr,
        line.sortOrder,
      ],
    );
  }

  if (actorUserId)
    await createAuditLog(
      companyId,
      actorUserId,
      "BOOKING_CREATED",
      "PACKAGE",
      id,
      `${input.transactionType} ${input.ubNumber.trim()} - PKR ${totalPkr}`,
    );
  return id;
}

export async function updatePackageBooking(
  companyId: string,
  bookingId: string,
  input: PackageBookingInput,
  actorUserId = "",
) {
  await requirePermission(companyId, actorUserId, "edit_bookings");
  const { calculated, totalPkr } = await validatePackageBooking(companyId, input, bookingId);
  const database = await db();
  const now = new Date().toISOString();

  await database.execute(
    `UPDATE package_bookings
     SET transaction_type=$1, counterparty_id=$2, transaction_date=$3, ub_number=$4,
         package_description=$5, departure_date=$6, return_date=$7, no_of_days=$8,
         ziarat_included=$9, customer_contact=$10, notes=$11, total_pkr=$12, updated_at=$13, updated_by_user_id=$14
     WHERE id=$15 AND company_id=$16 AND status='ACTIVE'`,
    [
      input.transactionType,
      input.counterpartyId,
      input.transactionDate,
      input.ubNumber.trim(),
      input.packageDescription.trim(),
      input.departureDate,
      input.returnDate,
      Math.max(0, Math.trunc(Number(input.noOfDays) || 0)),
      input.ziaratIncluded,
      input.customerContact.trim(),
      input.notes.trim(),
      totalPkr,
      now,
      actorUserId,
      bookingId,
      companyId,
    ],
  );

  await database.execute(`DELETE FROM package_booking_lines WHERE booking_id=$1`, [bookingId]);

  for (const line of calculated) {
    await database.execute(
      `INSERT INTO package_booking_lines
       (id,booking_id,passenger_type,passenger_name,package_type,rate_per_person,person_count,qty_is_explicit,line_total_pkr,sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
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
    );
  }

  if (actorUserId)
    await createAuditLog(
      companyId,
      actorUserId,
      "BOOKING_UPDATED",
      "PACKAGE",
      bookingId,
      `${input.transactionType} ${input.ubNumber.trim()} - PKR ${totalPkr}`,
    );
}

export async function voidPackageBooking(companyId: string, bookingId: string, actorUserId = "") {
  await requirePermission(companyId, actorUserId, "void_bookings");
  const isTauri = "__TAURI_INTERNALS__" in window;
  const now = new Date().toISOString();
  let ubNumber = bookingId;

  if (!isTauri) {
    const { data } = await supabase
      .from("package_bookings")
      .select("ub_number")
      .eq("id", bookingId)
      .eq("company_id", companyId)
      .maybeSingle();
    ubNumber = data?.ub_number || bookingId;
  } else {
    const database = await db();
    const rows = await database.select<Array<{ ub_number: string }>>(
      `SELECT ub_number FROM package_bookings WHERE id=$1 AND company_id=$2 LIMIT 1`,
      [bookingId, companyId],
    );
    ubNumber = rows[0]?.ub_number || bookingId;
    await database.execute(
      `UPDATE package_bookings
       SET status='VOID', updated_at=$1, updated_by_user_id=$2
       WHERE id=$3 AND company_id=$4 AND status='ACTIVE'`,
      [now, actorUserId, bookingId, companyId],
    );
  }

  // Web writes cloud directly; desktop queues after local SQLite update.
  await syncPackageBookingVoid(bookingId, now, actorUserId);

  if (actorUserId)
    await createAuditLog(
      companyId,
      actorUserId,
      "BOOKING_VOIDED",
      "PACKAGE",
      bookingId,
      `Package booking ${ubNumber} voided.`,
    );
}

export async function getCompanyPackageSummary(companyId: string) {
  const database = await db();
  const rows = await database.select<CompanyPackageSummary[]>(
    `SELECT
       COALESCE(SUM(CASE WHEN transaction_type='SALE' THEN total_pkr ELSE 0 END),0) AS sale_total,
       COALESCE(SUM(CASE WHEN transaction_type='PURCHASE' THEN total_pkr ELSE 0 END),0) AS purchase_total,
       COUNT(*) AS active_count
     FROM package_bookings
     WHERE company_id=$1 AND status='ACTIVE'`,
    [companyId],
  );
  return rows[0] || { sale_total: 0, purchase_total: 0, active_count: 0 };
}

export async function getCounterpartyPackageTotals(companyId: string) {
  const database = await db();
  return database.select<CounterpartyPackageTotal[]>(
    `SELECT
       counterparty_id,
       COALESCE(SUM(CASE WHEN transaction_type='SALE' THEN total_pkr ELSE 0 END),0) AS sale_total,
       COALESCE(SUM(CASE WHEN transaction_type='PURCHASE' THEN total_pkr ELSE 0 END),0) AS purchase_total
     FROM package_bookings
     WHERE company_id=$1 AND status='ACTIVE'
     GROUP BY counterparty_id`,
    [companyId],
  );
}

// ===== PHASE 9A — TICKET BOOKING ENGINE =====

function normalizeTicketUb(value: string) {
  return value.trim().replace(/\s+/g, " ").toUpperCase();
}

function calculateTicketLines(lines: TicketBookingLineInput[]) {
  const calculated: Array<{
    passengerType: TicketPassengerType;
    passengerName: string;
    eticketReference: string;
    ratePerTicket: number;
    ticketCount: number;
    qtyIsExplicit: number;
    lineTotalPkr: number;
    sortOrder: number;
  }> = [];

  lines.forEach((line, index) => {
    if (!["ADULT", "CHILD", "INFANT"].includes(line.passengerType)) {
      throw new Error(`Ticket row ${index + 1}: select Adult, Child or Infant.`);
    }

    const passengerName = line.passengerName.trim();
    if (!passengerName) throw new Error(`Ticket row ${index + 1}: Passenger / Family Head Name is required.`);

    const ratePerTicket = Number(line.ratePerTicket);
    if (!Number.isFinite(ratePerTicket) || ratePerTicket < 0) {
      throw new Error(`Ticket row ${index + 1}: enter a valid Rate Per Ticket.`);
    }

    const explicit = Boolean(line.qtyIsExplicit);
    const ticketCount = explicit ? Math.trunc(Number(line.ticketCount)) : 1;
    if (!Number.isFinite(ticketCount) || ticketCount < 1) {
      throw new Error(`Ticket row ${index + 1}: Qty must be at least 1, or leave Qty blank for one ticket.`);
    }

    calculated.push({
      passengerType: line.passengerType,
      passengerName,
      eticketReference: line.eticketReference.trim(),
      ratePerTicket,
      ticketCount,
      qtyIsExplicit: explicit ? 1 : 0,
      lineTotalPkr: ratePerTicket * ticketCount,
      sortOrder: index,
    });
  });

  if (!calculated.length) throw new Error("Add at least one Ticket passenger / fare row.");
  const totalPkr = calculated.reduce((sum, line) => sum + line.lineTotalPkr, 0);
  return { calculated, totalPkr };
}

async function validateUniqueTicketUb(
  companyId: string,
  transactionType: BookingTransactionType,
  counterpartyId: string,
  ubNumber: string,
  editingBookingId = "",
) {
  const normalized = normalizeTicketUb(ubNumber);
  const database = await db();
  const rows = await database.select<
    Array<{ id: string; transaction_type: BookingTransactionType; counterparty_id: string; ub_number: string }>
  >(
    `SELECT id,transaction_type,counterparty_id,ub_number
     FROM ticket_bookings
     WHERE company_id=$1`,
    [companyId],
  );

  const duplicate = rows.find((row) => {
    if (row.id === editingBookingId || normalizeTicketUb(row.ub_number) !== normalized) return false;
    if (transactionType === "SALE") return row.transaction_type === "SALE";
    return row.transaction_type === "PURCHASE" && row.counterparty_id === counterpartyId;
  });

  if (duplicate) {
    if (transactionType === "SALE") {
      throw new Error(
        `UB # / Booking "${ubNumber.trim()}" already has a Ticket Sale booking. Use the existing Ticket booking or another UB #.`,
      );
    }
    throw new Error(
      `This Vendor already has a Ticket Purchase booking for UB # "${ubNumber.trim()}". Edit that booking or select another Vendor.`,
    );
  }
}

async function validateTicketBooking(companyId: string, input: TicketBookingInput, editingBookingId = "") {
  if (!["SALE", "PURCHASE"].includes(input.transactionType)) throw new Error("Select Sale or Purchase first.");
  if (!input.transactionDate) throw new Error("Date of Booking is required.");
  if (!input.ubNumber.trim()) throw new Error("UB # / Booking is required.");
  await validatePackageCounterparty(companyId, input.transactionType, input.counterpartyId);
  await validateUniqueTicketUb(
    companyId,
    input.transactionType,
    input.counterpartyId,
    input.ubNumber,
    editingBookingId,
  );

  if (!input.airlineName.trim()) throw new Error("Airline Name is required.");
  if (!input.sector.trim()) throw new Error("Sector / Route is required.");
  if (!input.departureDate) throw new Error("Departure Date is required.");
  if (input.returnDate && input.returnDate < input.departureDate) {
    throw new Error("Return Date cannot be before Departure Date.");
  }
  if (!["", "RESERVED", "ISSUED", "CANCELLED", "REFUNDED"].includes(input.ticketStatus)) {
    throw new Error("Invalid Ticket Status.");
  }

  return calculateTicketLines(input.lines);
}

export async function getTicketBookings(companyId: string, search = "") {
  const isTauri = "__TAURI_INTERNALS__" in window;
  if (!isTauri) {
    let query = supabase
      .from("ticket_bookings")
      .select("*")
      .eq("company_id", companyId)
      .order("transaction_date", { ascending: false })
      .order("created_at", { ascending: false });

    if (search.trim()) {
      const term = `%${search.trim()}%`;
      query = query.or(`ub_number.ilike.${term}`);
    }

    const { data, error } = await query;
    if (error) throw new Error(error.message);
    if (!data) return [];

    const partyNames = await fetchPartyNameMap(companyId);
    const lines = await fetchChildRowsByBookingIds(
      "ticket_booking_lines",
      data.map((row) => String(row.id)),
    );
    const linesByBooking = groupRowsByBookingId(lines);

    return data.map((b: any) => ({
      ...b,
      counterparty_name: partyNames.get(String(b.counterparty_id)) || "",
      lines: linesByBooking.get(String(b.id)) || [],
    })) as TicketBooking[];
  }

  const database = await db();
  const clean = search.trim();
  const term = `%${clean}%`;

  const headers = await database.select<Omit<TicketBooking, "lines">[]>(
    `SELECT
       b.id,b.company_id,b.transaction_type,b.counterparty_id,
       COALESCE(p.name,'') AS counterparty_name,
       b.transaction_date,b.ub_number,b.airline_name,b.pnr,b.sector,
       b.departure_date,b.return_date,b.flight_no,b.departure_time,b.arrival_time,
       b.baggage,b.ticket_status,b.customer_contact,b.notes,b.total_pkr,
       b.status,b.created_at,b.updated_at
     FROM ticket_bookings b
     LEFT JOIN parties p ON p.id=b.counterparty_id AND p.company_id=b.company_id
     WHERE b.company_id=$1
       AND (
         $2='' OR
         b.ub_number LIKE $3 COLLATE NOCASE OR
         b.airline_name LIKE $3 COLLATE NOCASE OR
         b.pnr LIKE $3 COLLATE NOCASE OR
         b.sector LIKE $3 COLLATE NOCASE OR
         b.flight_no LIKE $3 COLLATE NOCASE OR
         b.customer_contact LIKE $3 COLLATE NOCASE OR
         b.notes LIKE $3 COLLATE NOCASE OR
         COALESCE(p.name,'') LIKE $3 COLLATE NOCASE OR
         EXISTS (
           SELECT 1 FROM ticket_booking_lines l
           WHERE l.booking_id=b.id
             AND (l.passenger_name LIKE $3 COLLATE NOCASE OR l.eticket_reference LIKE $3 COLLATE NOCASE)
         )
       )
     ORDER BY b.transaction_date DESC,b.created_at DESC`,
    [companyId, clean, term],
  );

  const lines = await database.select<TicketBookingLine[]>(
    `SELECT l.id,l.booking_id,l.passenger_type,l.passenger_name,l.eticket_reference,
            l.rate_per_ticket,l.ticket_count,l.qty_is_explicit,l.line_total_pkr,l.sort_order
     FROM ticket_booking_lines l
     INNER JOIN ticket_bookings b ON b.id=l.booking_id
     WHERE b.company_id=$1
     ORDER BY l.sort_order ASC`,
    [companyId],
  );

  const grouped = new Map<string, TicketBookingLine[]>();
  for (const line of lines) {
    const current = grouped.get(line.booking_id) || [];
    current.push(line);
    grouped.set(line.booking_id, current);
  }

  return headers.map((header) => ({ ...header, lines: grouped.get(header.id) || [] })) as TicketBooking[];
}

export async function createTicketBooking(companyId: string, input: TicketBookingInput, actorUserId = "") {
  await requirePermission(companyId, actorUserId, "create_bookings");
  const { calculated, totalPkr } = await validateTicketBooking(companyId, input);
  const database = await db();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  await database.execute(
    `INSERT INTO ticket_bookings
     (id,company_id,transaction_type,counterparty_id,transaction_date,ub_number,
      airline_name,pnr,sector,departure_date,return_date,flight_no,departure_time,arrival_time,
      baggage,ticket_status,customer_contact,notes,total_pkr,status,created_at,updated_at,created_by_user_id,updated_by_user_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,'ACTIVE',$20,$20,$21,$21)`,
    [
      id,
      companyId,
      input.transactionType,
      input.counterpartyId,
      input.transactionDate,
      input.ubNumber.trim(),
      input.airlineName.trim(),
      input.pnr.trim(),
      input.sector.trim(),
      input.departureDate,
      input.returnDate,
      input.flightNo.trim(),
      input.departureTime,
      input.arrivalTime,
      input.baggage.trim(),
      input.ticketStatus,
      input.customerContact.trim(),
      input.notes.trim(),
      totalPkr,
      now,
      actorUserId,
    ],
  );

  for (const line of calculated) {
    await database.execute(
      `INSERT INTO ticket_booking_lines
       (id,booking_id,passenger_type,passenger_name,eticket_reference,rate_per_ticket,ticket_count,qty_is_explicit,line_total_pkr,sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        crypto.randomUUID(),
        id,
        line.passengerType,
        line.passengerName,
        line.eticketReference,
        line.ratePerTicket,
        line.ticketCount,
        line.qtyIsExplicit,
        line.lineTotalPkr,
        line.sortOrder,
      ],
    );
  }

  if (actorUserId)
    await createAuditLog(
      companyId,
      actorUserId,
      "BOOKING_CREATED",
      "TICKET",
      id,
      `${input.transactionType} ${input.ubNumber.trim()} - PKR ${totalPkr}`,
    );
  return id;
}

export async function updateTicketBooking(
  companyId: string,
  bookingId: string,
  input: TicketBookingInput,
  actorUserId = "",
) {
  await requirePermission(companyId, actorUserId, "edit_bookings");
  const { calculated, totalPkr } = await validateTicketBooking(companyId, input, bookingId);
  const database = await db();
  const now = new Date().toISOString();

  await database.execute(
    `UPDATE ticket_bookings
     SET transaction_type=$1,counterparty_id=$2,transaction_date=$3,ub_number=$4,
         airline_name=$5,pnr=$6,sector=$7,departure_date=$8,return_date=$9,flight_no=$10,
         departure_time=$11,arrival_time=$12,baggage=$13,ticket_status=$14,customer_contact=$15,
         notes=$16,total_pkr=$17,updated_at=$18,updated_by_user_id=$19
     WHERE id=$20 AND company_id=$21 AND status='ACTIVE'`,
    [
      input.transactionType,
      input.counterpartyId,
      input.transactionDate,
      input.ubNumber.trim(),
      input.airlineName.trim(),
      input.pnr.trim(),
      input.sector.trim(),
      input.departureDate,
      input.returnDate,
      input.flightNo.trim(),
      input.departureTime,
      input.arrivalTime,
      input.baggage.trim(),
      input.ticketStatus,
      input.customerContact.trim(),
      input.notes.trim(),
      totalPkr,
      now,
      actorUserId,
      bookingId,
      companyId,
    ],
  );

  await database.execute(`DELETE FROM ticket_booking_lines WHERE booking_id=$1`, [bookingId]);
  for (const line of calculated) {
    await database.execute(
      `INSERT INTO ticket_booking_lines
       (id,booking_id,passenger_type,passenger_name,eticket_reference,rate_per_ticket,ticket_count,qty_is_explicit,line_total_pkr,sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        crypto.randomUUID(),
        bookingId,
        line.passengerType,
        line.passengerName,
        line.eticketReference,
        line.ratePerTicket,
        line.ticketCount,
        line.qtyIsExplicit,
        line.lineTotalPkr,
        line.sortOrder,
      ],
    );
  }

  if (actorUserId)
    await createAuditLog(
      companyId,
      actorUserId,
      "BOOKING_UPDATED",
      "TICKET",
      bookingId,
      `${input.transactionType} ${input.ubNumber.trim()} - PKR ${totalPkr}`,
    );
}

export async function voidTicketBooking(companyId: string, bookingId: string, actorUserId = "") {
  await requirePermission(companyId, actorUserId, "void_bookings");
  const database = await db();
  const rows = await database.select<Array<{ ub_number: string }>>(
    `SELECT ub_number FROM ticket_bookings WHERE id=$1 AND company_id=$2 LIMIT 1`,
    [bookingId, companyId],
  );
  await database.execute(
    `UPDATE ticket_bookings
     SET status='VOID',updated_at=$1,updated_by_user_id=$2
     WHERE id=$3 AND company_id=$4 AND status='ACTIVE'`,
    [new Date().toISOString(), actorUserId, bookingId, companyId],
  );
  if (actorUserId)
    await createAuditLog(
      companyId,
      actorUserId,
      "BOOKING_VOIDED",
      "TICKET",
      bookingId,
      `Ticket booking ${rows[0]?.ub_number || bookingId} voided.`,
    );
}

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

function calculateHotelLines(lines: HotelBookingLineInput[]) {
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
  const database = await db();
  const rows = await database.select<
    Array<{ id: string; transaction_type: BookingTransactionType; counterparty_id: string; ub_number: string }>
  >(
    `SELECT id,transaction_type,counterparty_id,ub_number
     FROM hotel_bookings
     WHERE company_id=$1`,
    [companyId],
  );

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
  await validatePackageCounterparty(companyId, input.transactionType, input.counterpartyId);
  await validateUniqueHotelUb(companyId, input.transactionType, input.counterpartyId, input.ubNumber, editingBookingId);
  return calculateHotelLines(input.lines);
}

export async function getHotelBookings(companyId: string, search = "") {
  const isTauri = "__TAURI_INTERNALS__" in window;
  if (!isTauri) {
    let query = supabase
      .from("hotel_bookings")
      .select("*")
      .eq("company_id", companyId)
      .order("transaction_date", { ascending: false })
      .order("created_at", { ascending: false });

    if (search.trim()) {
      const term = `%${search.trim()}%`;
      query = query.or(`ub_number.ilike.${term}`);
    }

    const { data, error } = await query;
    if (error) throw new Error(error.message);
    if (!data) return [];

    const partyNames = await fetchPartyNameMap(companyId);
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

  const headers = await database.select<Omit<HotelBooking, "lines">[]>(
    `SELECT
       b.id,b.company_id,b.transaction_type,b.counterparty_id,
       COALESCE(p.name,'') AS counterparty_name,
       b.transaction_date,b.ub_number,b.confirmation_voucher,b.meal_plan,b.guest_family_name,b.guest_count,
       b.customer_contact,b.special_requests,b.notes,b.total_sar,b.total_pkr,b.unconverted_sar,
       b.status,b.created_at,b.updated_at
     FROM hotel_bookings b
     LEFT JOIN parties p ON p.id=b.counterparty_id AND p.company_id=b.company_id
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
         COALESCE(p.name,'') LIKE $3 COLLATE NOCASE OR
         EXISTS (
           SELECT 1 FROM hotel_booking_lines l
           WHERE l.booking_id=b.id
             AND (l.city LIKE $3 COLLATE NOCASE OR l.hotel_name LIKE $3 COLLATE NOCASE)
         )
       )
     ORDER BY b.transaction_date DESC,b.created_at DESC`,
    [companyId, clean, term],
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
  const { calculated, totalSar, totalPkr, unconvertedSar } = await validateHotelBooking(companyId, input);
  const database = await db();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

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

  for (const line of calculated) {
    await database.execute(
      `INSERT INTO hotel_booking_lines
       (id,booking_id,city,hotel_name,check_in,check_out,nights,room_type,rate_per_night_sar,quantity,roe,line_total_sar,line_total_pkr,sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [
        crypto.randomUUID(),
        id,
        line.city,
        line.hotelName,
        line.checkIn,
        line.checkOut,
        line.nights,
        line.roomType,
        line.ratePerNightSar,
        line.quantity,
        line.roe,
        line.lineTotalSar,
        line.lineTotalPkr,
        line.sortOrder,
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
  return id;
}

export async function updateHotelBooking(
  companyId: string,
  bookingId: string,
  input: HotelBookingInput,
  actorUserId = "",
) {
  await requirePermission(companyId, actorUserId, "edit_bookings");
  const { calculated, totalSar, totalPkr, unconvertedSar } = await validateHotelBooking(companyId, input, bookingId);
  const database = await db();
  const now = new Date().toISOString();

  await database.execute(
    `UPDATE hotel_bookings
     SET transaction_type=$1,counterparty_id=$2,transaction_date=$3,ub_number=$4,
         confirmation_voucher=$5,meal_plan=$6,guest_family_name=$7,guest_count=$8,customer_contact=$9,
         special_requests=$10,notes=$11,total_sar=$12,total_pkr=$13,unconverted_sar=$14,
         updated_at=$15,updated_by_user_id=$16
     WHERE id=$17 AND company_id=$18 AND status='ACTIVE'`,
    [
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
      bookingId,
      companyId,
    ],
  );

  await database.execute(`DELETE FROM hotel_booking_lines WHERE booking_id=$1`, [bookingId]);
  for (const line of calculated) {
    await database.execute(
      `INSERT INTO hotel_booking_lines
       (id,booking_id,city,hotel_name,check_in,check_out,nights,room_type,rate_per_night_sar,quantity,roe,line_total_sar,line_total_pkr,sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [
        crypto.randomUUID(),
        bookingId,
        line.city,
        line.hotelName,
        line.checkIn,
        line.checkOut,
        line.nights,
        line.roomType,
        line.ratePerNightSar,
        line.quantity,
        line.roe,
        line.lineTotalSar,
        line.lineTotalPkr,
        line.sortOrder,
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
      `${input.transactionType} ${input.ubNumber.trim()} - SAR ${totalSar} / PKR ${totalPkr}`,
    );
}

export async function voidHotelBooking(companyId: string, bookingId: string, actorUserId = "") {
  await requirePermission(companyId, actorUserId, "void_bookings");
  const database = await db();
  const rows = await database.select<Array<{ ub_number: string }>>(
    `SELECT ub_number FROM hotel_bookings WHERE id=$1 AND company_id=$2 LIMIT 1`,
    [bookingId, companyId],
  );
  await database.execute(
    `UPDATE hotel_bookings
     SET status='VOID',updated_at=$1,updated_by_user_id=$2
     WHERE id=$3 AND company_id=$4 AND status='ACTIVE'`,
    [new Date().toISOString(), actorUserId, bookingId, companyId],
  );
  if (actorUserId)
    await createAuditLog(
      companyId,
      actorUserId,
      "BOOKING_VOIDED",
      "HOTEL",
      bookingId,
      `Hotel booking ${rows[0]?.ub_number || bookingId} voided.`,
    );
}

// ===== PHASE 11B — VISA BOOKING ENGINE =====

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

function calculateVisaBooking(input: VisaBookingInput) {
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
  const database = await db();
  const rows = await database.select<
    Array<{ id: string; transaction_type: BookingTransactionType; counterparty_id: string; ub_number: string }>
  >(`SELECT id,transaction_type,counterparty_id,ub_number FROM visa_bookings WHERE company_id=$1`, [companyId]);

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
  await validatePackageCounterparty(companyId, input.transactionType, input.counterpartyId);
  await validateUniqueVisaUb(companyId, input.transactionType, input.counterpartyId, input.ubNumber, editingBookingId);
  return calculateVisaBooking(input);
}

export async function getVisaBookings(companyId: string, search = "") {
  const isTauri = "__TAURI_INTERNALS__" in window;
  if (!isTauri) {
    let query = supabase
      .from("visa_bookings")
      .select("*")
      .eq("company_id", companyId)
      .order("transaction_date", { ascending: false })
      .order("created_at", { ascending: false });

    if (search.trim()) {
      const term = `%${search.trim()}%`;
      query = query.or(`ub_number.ilike.${term}`);
    }

    const { data, error } = await query;
    if (error) throw new Error(error.message);
    if (!data) return [];

    const partyNames = await fetchPartyNameMap(companyId);
    const lines = await fetchChildRowsByBookingIds(
      "visa_booking_lines",
      data.map((row) => String(row.id)),
    );
    const linesByBooking = groupRowsByBookingId(lines);

    return data.map((b: any) => ({
      ...b,
      counterparty_name: partyNames.get(String(b.counterparty_id)) || "",
      lines: linesByBooking.get(String(b.id)) || [],
    })) as VisaBooking[];
  }

  const database = await db();
  const clean = search.trim();
  const term = `%${clean}%`;

  const headers = await database.select<Omit<VisaBooking, "lines" | "fleet" | "passports">[]>(
    `SELECT
       b.id,b.company_id,b.transaction_type,b.counterparty_id,COALESCE(p.name,'') AS counterparty_name,
       b.transaction_date,b.ub_number,b.expected_entry_date,b.private_vehicle_type,b.private_transport_total_sar,
       b.intercity_bus_rate_sar,b.intercity_bus_total_sar,b.applicable_private_pax,b.applicable_full_bus_pax,
       b.visa_total_sar,b.transport_total_sar,b.total_sar,b.total_pkr,b.unconverted_sar,b.notes,
       b.status,b.created_at,b.updated_at
     FROM visa_bookings b
     LEFT JOIN parties p ON p.id=b.counterparty_id AND p.company_id=b.company_id
     WHERE b.company_id=$1
       AND (
         $2='' OR b.ub_number LIKE $3 COLLATE NOCASE OR b.notes LIKE $3 COLLATE NOCASE OR
         b.private_vehicle_type LIKE $3 COLLATE NOCASE OR COALESCE(p.name,'') LIKE $3 COLLATE NOCASE OR
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
     ORDER BY b.transaction_date DESC,b.created_at DESC`,
    [companyId, clean, term],
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

async function insertVisaChildren(
  database: Awaited<ReturnType<typeof db>>,
  bookingId: string,
  result: ReturnType<typeof calculateVisaBooking>,
) {
  for (const line of result.calculated) {
    await database.execute(
      `INSERT INTO visa_booking_lines
       (id,booking_id,passenger_type,passenger_name,visa_type,visa_rate_sar,pax_count,roe,visa_total_sar,
        private_transport_allocated_sar,intercity_bus_total_sar,line_total_sar,line_total_pkr,sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [
        crypto.randomUUID(),
        bookingId,
        line.passengerType,
        line.passengerName,
        line.visaType,
        line.visaRateSar,
        line.paxCount,
        line.roe,
        line.visaTotalSar,
        line.privateTransportAllocatedSar,
        line.intercityBusTotalSar,
        line.lineTotalSar,
        line.lineTotalPkr,
        line.sortOrder,
      ],
    );
  }

  for (const item of result.fleet) {
    await database.execute(
      `INSERT INTO visa_transport_fleet
       (id,booking_id,vehicle_type,quantity,capacity_per_vehicle,total_capacity,rate_per_vehicle_sar,line_total_sar,sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        crypto.randomUUID(),
        bookingId,
        item.vehicleType,
        item.quantity,
        item.capacityPerVehicle,
        item.totalCapacity,
        item.ratePerVehicleSar,
        item.lineTotalSar,
        item.sortOrder,
      ],
    );
  }

  for (const item of result.passports) {
    await database.execute(
      `INSERT INTO visa_passport_details
       (id,booking_id,source_family_name,passenger_name,passenger_type,visa_type,surname,given_name,passport_number,nationality,date_of_birth,passport_issuance,passport_expiry,sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [
        crypto.randomUUID(),
        bookingId,
        item.sourceFamilyName,
        item.passengerName,
        item.passengerType,
        item.visaType,
        item.surname,
        item.givenName,
        item.passportNumber,
        item.nationality,
        item.dateOfBirth,
        item.passportIssuance,
        item.passportExpiry,
        item.sortOrder,
      ],
    );
  }
}

export async function createVisaBooking(companyId: string, input: VisaBookingInput, actorUserId = "") {
  await requirePermission(companyId, actorUserId, "create_bookings");
  const result = await validateVisaBooking(companyId, input);
  const database = await db();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

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

  await insertVisaChildren(database, id, result);

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
  const database = await db();
  const now = new Date().toISOString();

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

  await insertVisaChildren(database, bookingId, result);

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
  const database = await db();
  const rows = await database.select<Array<{ ub_number: string }>>(
    `SELECT ub_number FROM visa_bookings WHERE id=$1 AND company_id=$2 LIMIT 1`,
    [bookingId, companyId],
  );
  await database.execute(
    `UPDATE visa_bookings SET status='VOID',updated_at=$1,updated_by_user_id=$2 WHERE id=$3 AND company_id=$4 AND status='ACTIVE'`,
    [new Date().toISOString(), actorUserId, bookingId, companyId],
  );
  if (actorUserId)
    await createAuditLog(
      companyId,
      actorUserId,
      "BOOKING_VOIDED",
      "VISA",
      bookingId,
      `Visa booking ${rows[0]?.ub_number || bookingId} voided.`,
    );
}

// -----------------------------------------------------------------------------
// PHASE 12A — TRANSPORT BOOKING ENGINE
// -----------------------------------------------------------------------------
function normalizeTransportUb(value: string) {
  return value.trim().replace(/\s+/g, " ").toUpperCase();
}

function calculateTransportLines(lines: TransportBookingLineInput[]) {
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
  const database = await db();
  const rows = await database.select<
    Array<{ id: string; transaction_type: BookingTransactionType; counterparty_id: string; ub_number: string }>
  >(`SELECT id,transaction_type,counterparty_id,ub_number FROM transport_bookings WHERE company_id=$1`, [companyId]);
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
  await validatePackageCounterparty(companyId, input.transactionType, input.counterpartyId);
  await validateUniqueTransportUb(
    companyId,
    input.transactionType,
    input.counterpartyId,
    input.ubNumber,
    editingBookingId,
  );
  return calculateTransportLines(input.lines);
}

export async function getTransportBookings(companyId: string, search = "") {
  const isTauri = "__TAURI_INTERNALS__" in window;
  if (!isTauri) {
    let query = supabase
      .from("transport_bookings")
      .select("*")
      .eq("company_id", companyId)
      .order("transaction_date", { ascending: false })
      .order("created_at", { ascending: false });

    if (search.trim()) {
      const term = `%${search.trim()}%`;
      query = query.or(`ub_number.ilike.${term}`);
    }

    const { data, error } = await query;
    if (error) throw new Error(error.message);
    if (!data) return [];

    const partyNames = await fetchPartyNameMap(companyId);
    const lines = await fetchChildRowsByBookingIds(
      "transport_booking_lines",
      data.map((row) => String(row.id)),
    );
    const linesByBooking = groupRowsByBookingId(lines);

    return data.map((b: any) => ({
      ...b,
      counterparty_name: partyNames.get(String(b.counterparty_id)) || "",
      lines: linesByBooking.get(String(b.id)) || [],
    })) as TransportBooking[];
  }

  const database = await db();
  const clean = search.trim();
  const term = `%${clean}%`;
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
     ORDER BY b.transaction_date DESC,b.created_at DESC`,
    [companyId, clean, term],
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

async function insertTransportLines(
  database: Awaited<ReturnType<typeof db>>,
  bookingId: string,
  calculated: ReturnType<typeof calculateTransportLines>["calculated"],
) {
  for (const line of calculated) {
    await database.execute(
      `INSERT INTO transport_booking_lines
       (id,booking_id,transport_date,transport_type,from_location,to_location,vehicle_type,custom_vehicle_name,
        vehicle_count,rate_sar,pax_count,roe,line_total_sar,line_total_pkr,sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [
        crypto.randomUUID(),
        bookingId,
        line.transportDate,
        line.transportType,
        line.fromLocation,
        line.toLocation,
        line.vehicleType,
        line.customVehicleName,
        line.vehicleCount,
        line.rateSar,
        line.paxCount,
        line.roe,
        line.lineTotalSar,
        line.lineTotalPkr,
        line.sortOrder,
      ],
    );
  }
}

export async function createTransportBooking(companyId: string, input: TransportBookingInput, actorUserId = "") {
  await requirePermission(companyId, actorUserId, "create_bookings");
  const result = await validateTransportBooking(companyId, input);
  const database = await db();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
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
  await insertTransportLines(database, id, result.calculated);
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
  const database = await db();
  const now = new Date().toISOString();
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
  await insertTransportLines(database, bookingId, result.calculated);
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
  const database = await db();
  const rows = await database.select<Array<{ ub_number: string }>>(
    `SELECT ub_number FROM transport_bookings WHERE id=$1 AND company_id=$2 LIMIT 1`,
    [bookingId, companyId],
  );
  await database.execute(
    `UPDATE transport_bookings SET status='VOID',updated_at=$1,updated_by_user_id=$2 WHERE id=$3 AND company_id=$4 AND status='ACTIVE'`,
    [new Date().toISOString(), actorUserId, bookingId, companyId],
  );
  if (actorUserId)
    await createAuditLog(
      companyId,
      actorUserId,
      "BOOKING_VOIDED",
      "TRANSPORT",
      bookingId,
      `Transport booking ${rows[0]?.ub_number || bookingId} voided.`,
    );
}

export async function dangerouslyEraseAllData(companyId: string) {
  const database = await db();

  const tables = [
    "package_bookings",
    "package_booking_lines",
    "package_booking_lines_v2",
    "package_operational_meta",
    "package_operational_passengers",
    "package_operational_hotels",
    "package_operational_flights",
    "package_operational_flight_stopovers",
    "package_movement_events",
    "package_booking_adjustments",

    "ticket_bookings",
    "ticket_booking_lines",
    "ticket_operational_meta",
    "ticket_operational_passengers",
    "ticket_operational_flights",

    "hotel_bookings",
    "hotel_booking_lines",
    "hotel_commercial_guest_refs",
    "hotel_operational_reservations",
    "hotel_operational_guests",
    "hotel_operational_meta",

    "visa_bookings",
    "visa_booking_lines",
    "visa_transport_fleet",
    "visa_passport_details",
    "visa_operational_meta",
    "visa_operational_passengers",

    "transport_bookings",
    "transport_booking_lines",
    "transport_operational_sectors",
    "transport_operational_meta",

    "misc_bookings",
    "misc_booking_lines",
    "misc_commercial_family_refs",
    "misc_operational_services",
    "misc_operational_meta",

    "booking_adjustments",

    "payments",
    "payment_entries",
    "payment_v2_meta",

    "parties",
    "accommodation_entries",
    "service_entries",

    "audit_logs",
    "remembered_sessions",
    "users",
    "companies",
  ];

  for (const table of tables) {
    try {
      if (table === "users" || table === "companies" || table === "remembered_sessions") {
        await database.execute(`DELETE FROM ${table}`);
      } else {
        await database.execute(`DELETE FROM ${table} WHERE company_id = $1`, [companyId]);
      }
    } catch (e) {
      console.warn(`Could not erase table ${table}`, e);
    }
  }
}

// --- Phase 3.2 Offline-First Sync Engine ---

export type SyncOperation = CloudSyncOperation;

export type SyncQueueEntry = {
  id: string;
  operation: SyncOperation;
  table_name: string;
  record_id: string;
  payload: string;
  created_at: string;
  status: "PENDING" | "FAILED";
  error_message: string;
};

/**
 * Desktop: enqueue for background push. Web: push to Supabase immediately.
 */
export async function queueSync(
  operation: SyncOperation,
  tableName: string,
  recordId: string,
  payload: Record<string, any>,
) {
  await enqueueCloudSync(operation, tableName, recordId, payload);
}

let isSyncRunning = false;
let backgroundCompanyId = "";
let syncPassInFlight = false;

/** Keep background sync tied to the signed-in company. */
export function setBackgroundSyncCompanyId(companyId: string) {
  backgroundCompanyId = companyId.trim();
}

/**
 * Polls the sync_queue and pushes changes to Supabase when online.
 */
export async function processSyncQueue() {
  if (!navigator.onLine) return;

  try {
    const database = await db();
    const pending = await database.select<SyncQueueEntry[]>(
      "SELECT * FROM sync_queue WHERE status = 'PENDING' ORDER BY created_at ASC",
    );

    if (pending.length === 0) return;

    for (const job of pending) {
      try {
        const payload = JSON.parse(job.payload) as Record<string, unknown>;
        await applyCloudOperation(job.operation, job.table_name, job.record_id, payload);
        await database.execute("DELETE FROM sync_queue WHERE id = $1", [job.id]);
      } catch (jobError: any) {
        console.error("Sync job failed:", jobError);
        await database.execute("UPDATE sync_queue SET status = 'FAILED', error_message = $1 WHERE id = $2", [
          String(jobError.message || jobError),
          job.id,
        ]);
      }
    }
  } catch (e) {
    console.error("Background sync error:", e);
    throw e;
  }
}

function notifySyncComplete(detail: { companyId: string; partiesPulled: number; source: string }) {
  window.dispatchEvent(new CustomEvent("travel-accounting:sync-complete", { detail }));
}

async function runSyncPass(source: "interval" | "focus" | "online" | "manual", fullResync = false) {
  if (!navigator.onLine) return null;
  if (syncPassInFlight) return null;
  syncPassInFlight = true;
  try {
    await processSyncQueue();
    const result = await executePullSync({
      companyId: backgroundCompanyId || undefined,
      fullResync,
    });
    if (result) {
      notifySyncComplete({
        companyId: result.companyId,
        partiesPulled: result.partiesPulled,
        source,
      });
    }
    return result;
  } finally {
    syncPassInFlight = false;
  }
}

/**
 * Starts automatic push/pull sync for desktop.
 * Runs every few seconds, and also when the window is focused or comes back online.
 */
export async function startBackgroundSync(companyId = "") {
  if (companyId) backgroundCompanyId = companyId.trim();
  if (isSyncRunning) return;
  isSyncRunning = true;

  const tick = () => {
    void runSyncPass("interval").catch((e) => console.error("Interval sync failed:", e));
  };

  // First pass soon after login, then every 5 seconds.
  window.setTimeout(tick, 1500);
  window.setInterval(tick, 5000);

  window.addEventListener("focus", () => {
    void runSyncPass("focus").catch((e) => console.error("Focus sync failed:", e));
  });
  window.addEventListener("online", () => {
    void runSyncPass("online").catch((e) => console.error("Online sync failed:", e));
  });
}

/** Manual Sync button helper. Forces a full company pull on desktop. */
export async function runManualSyncAndRefresh(companyId: string) {
  backgroundCompanyId = companyId.trim();
  return runSyncPass("manual", true);
}

/**
 * Phase 3: Desktop Pull Sync Engine
 * Fetches data modified on the Cloud (via Web App) and merges it into the local SQLite database.
 */
export async function executePullSync(options?: { companyId?: string; fullResync?: boolean }) {
  const isTauri = "__TAURI_INTERNALS__" in window;
  if (!isTauri || !navigator.onLine) return; // Only runs on Desktop when online

  const database = await db();

  // Prefer the signed-in company. Falling back to "first user" can pull the wrong tenant.
  let companyId = options?.companyId?.trim() || "";
  if (!companyId) {
    const users = await database.select<UserRow[]>("SELECT company_id FROM users LIMIT 1");
    companyId = users[0]?.company_id || "";
  }
  if (!companyId) {
    console.warn("Pull sync skipped: no company id available.");
    return;
  }

  const metaRows = await database.select<Array<{ value: string }>>(
    `SELECT value FROM sync_metadata WHERE key = 'last_pull_sync'`,
  );

  // Apply a 24-hour skew window to catch updates and clock differences
  let lastSync = metaRows[0]?.value || "2000-01-01T00:00:00.000Z";
  if (!options?.fullResync) {
    const lastSyncDate = new Date(lastSync);
    if (lastSyncDate.getFullYear() > 2000) {
      lastSyncDate.setHours(lastSyncDate.getHours() - 24);
      lastSync = lastSyncDate.toISOString();
    }
  } else {
    // Manual Sync & Refresh: re-pull everything for this company.
    lastSync = "2000-01-01T00:00:00.000Z";
  }

  const ROOT_TABLES = [
    "parties",
    "payment_entries",
    "booking_adjustments",
    "accommodation_entries",
    "service_entries",
    "payment_v2_meta",
    "package_bookings",
    "ticket_bookings",
    "hotel_bookings",
    "visa_bookings",
    "transport_bookings",
    "misc_bookings",
  ];

  const CHILD_TABLES: Record<string, string[]> = {
    package_bookings: [
      "package_booking_lines",
      "package_operational_meta",
      "package_operational_passengers",
      "package_operational_hotels",
      "package_operational_flights",
      "package_operational_flight_stopovers",
      "package_movement_events",
      "package_booking_adjustments",
    ],
    ticket_bookings: [
      "ticket_booking_lines",
      "ticket_operational_meta",
      "ticket_operational_passengers",
      "ticket_operational_flights",
    ],
    hotel_bookings: [
      "hotel_booking_lines",
      "hotel_commercial_guest_refs",
      "hotel_operational_reservations",
      "hotel_operational_guests",
      "hotel_operational_meta",
    ],
    visa_bookings: [
      "visa_booking_lines",
      "visa_transport_fleet",
      "visa_passport_details",
      "visa_operational_meta",
      "visa_operational_passengers",
    ],
    transport_bookings: ["transport_booking_lines", "transport_operational_sectors", "transport_operational_meta"],
    misc_bookings: [
      "misc_booking_lines",
      "misc_commercial_family_refs",
      "misc_operational_services",
      "misc_operational_meta",
    ],
  };

  const columnCache = new Map<string, Set<string>>();
  async function localColumns(table: string) {
    const cached = columnCache.get(table);
    if (cached) return cached;
    const info = await database.select<Array<{ name: string }>>(`PRAGMA table_info(${table})`);
    const set = new Set(info.map((col) => col.name));
    columnCache.set(table, set);
    return set;
  }

  async function upsertCloudRow(table: string, row: Record<string, unknown>) {
    const allowed = await localColumns(table);
    if (!allowed.size) {
      console.warn(`Pull sync skipped unknown local table: ${table}`);
      return;
    }
    const keys = Object.keys(row).filter((key) => allowed.has(key));
    if (!keys.length) return;
    const values = keys.map((key) => {
      const value = row[key];
      // SQLite plugin cannot bind plain objects/arrays.
      if (value !== null && typeof value === "object") return JSON.stringify(value);
      return value;
    });
    const placeholders = keys.map((_, i) => `$${i + 1}`).join(", ");
    await database.execute(`INSERT OR REPLACE INTO ${table} (${keys.join(", ")}) VALUES (${placeholders})`, values);
  }

  let highestTimestampSeen = metaRows[0]?.value || "2000-01-01T00:00:00.000Z";
  let partiesPulled = 0;
  let partiesRemoved = 0;
  let bookingsRemoved = 0;

  async function reconcileDeletedRows(table: string, childTables: string[] = []) {
    const { data: cloudRows, error: cloudError } = await supabase
      .from(table)
      .select("id")
      .eq("company_id", companyId)
      .limit(5000);

    if (cloudError) {
      console.error(`${table} delete reconcile failed:`, cloudError.message);
      return 0;
    }

    const cloudIds = new Set((cloudRows || []).map((row) => String(row.id)));
    const localRows = await database.select<Array<{ id: string }>>(
      `SELECT id FROM ${table} WHERE company_id = $1`,
      [companyId],
    );

    let removed = 0;
    for (const local of localRows) {
      if (cloudIds.has(local.id)) continue;
      for (const childTable of childTables) {
        try {
          await database.execute(`DELETE FROM ${childTable} WHERE booking_id = $1`, [local.id]);
        } catch (err) {
          console.warn(`Could not delete orphaned rows from ${childTable}:`, err);
        }
      }
      await database.execute(`DELETE FROM ${table} WHERE id = $1 AND company_id = $2`, [local.id, companyId]);
      removed += 1;
    }
    return removed;
  }

  for (const table of ROOT_TABLES) {
    let query = supabase.from(table).select("*").eq("company_id", companyId).limit(1000);

    // Prefer updated_at, but also catch rows that only have created_at (or null updated_at).
    if (lastSync !== "2000-01-01T00:00:00.000Z") {
      query = query.or(`updated_at.gt."${lastSync}",created_at.gt."${lastSync}"`);
    }

    const { data, error } = await query.order("created_at", { ascending: true });

    if (error) {
      console.error(`Pull sync query failed for ${table}:`, error.message);
      continue;
    }
    if (!data || data.length === 0) continue;

    for (const row of data) {
      try {
        await upsertCloudRow(table, row as Record<string, unknown>);
        if (table === "parties") partiesPulled += 1;

        const stamp = String((row as any).updated_at || (row as any).created_at || "");
        if (stamp && stamp > highestTimestampSeen) highestTimestampSeen = stamp;

        const children = CHILD_TABLES[table];
        if (children && (row as any).id) {
          for (const childTable of children) {
            const { data: childData, error: childError } = await supabase
              .from(childTable)
              .select("*")
              .eq("booking_id", (row as any).id);

            if (childError) {
              console.error(`Pull sync child query failed for ${childTable}:`, childError.message);
              continue;
            }
            if (!childData || childData.length === 0) continue;

            for (const childRow of childData) {
              await upsertCloudRow(childTable, childRow as Record<string, unknown>);
            }
          }
        }
      } catch (err) {
        console.error(`Pull Sync Error on table ${table}:`, err);
      }
    }
  }

  // Reconcile deletes: remove local parties/vendors that no longer exist in cloud.
  // Incremental pull never "sees" deleted rows, so this must run every sync.
  try {
    const { data: cloudPartyIds, error: cloudIdsError } = await supabase
      .from("parties")
      .select("id")
      .eq("company_id", companyId)
      .limit(5000);

    if (cloudIdsError) {
      console.error("Party delete reconcile failed:", cloudIdsError.message);
    } else {
      const cloudIds = new Set((cloudPartyIds || []).map((row) => String(row.id)));
      const localRows = await database.select<Array<{ id: string }>>(
        `SELECT id FROM parties WHERE company_id = $1`,
        [companyId],
      );
      for (const local of localRows) {
        if (cloudIds.has(local.id)) continue;
        await database.execute(`DELETE FROM parties WHERE id = $1 AND company_id = $2`, [local.id, companyId]);
        partiesRemoved += 1;
      }
    }
  } catch (err) {
    console.error("Party delete reconcile error:", err);
  }

  // Reconcile deletes for booking headers removed in cloud (e.g. web test delete).
  for (const table of Object.keys(CHILD_TABLES)) {
    try {
      bookingsRemoved += await reconcileDeletedRows(table, CHILD_TABLES[table]);
    } catch (err) {
      console.error(`${table} delete reconcile error:`, err);
    }
  }

  if (highestTimestampSeen !== (metaRows[0]?.value || "2000-01-01T00:00:00.000Z")) {
    await database.execute(`INSERT OR REPLACE INTO sync_metadata (key, value) VALUES ('last_pull_sync', $1)`, [
      highestTimestampSeen,
    ]);
  }

  return { companyId, partiesPulled, partiesRemoved, bookingsRemoved };
}

/**
 * Ensures the currently logged-in Supabase user and company exist in the local SQLite db
 * so that offline-first functions (like requirePermission) work properly.
 */
export async function syncCloudSessionToLocal(company: Company, session: UserSession) {
  const database = await db();
  const now = new Date().toISOString();

  // Prevent UNIQUE constraint failed: companies.company_code if the ID changed
  // (e.g. wiped Supabase but kept local SQLite cache)
  await database.execute(`DELETE FROM companies WHERE company_code = $1 AND id != $2`, [
    company.company_code,
    company.id,
  ]);

  await database.execute(
    `INSERT INTO companies (id, company_code, name, dts_license, address, phone, whatsapp, email, base_currency, foreign_currency, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     ON CONFLICT(id) DO UPDATE SET
     name=excluded.name,
     updated_at=excluded.updated_at`,
    [
      company.id,
      company.company_code,
      company.name,
      company.dts_license,
      company.address,
      company.phone,
      company.whatsapp,
      company.email,
      company.base_currency,
      company.foreign_currency,
      now,
      now,
    ],
  );

  await database.execute(
    `INSERT INTO users (id, company_id, full_name, username, email, phone, phone_normalized, password_hash, password_salt, password_iterations, role, status, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, '', '', 0, $8, 'ACTIVE', $9, $10)
     ON CONFLICT(id) DO UPDATE SET
     role=excluded.role,
     status='ACTIVE',
     full_name=excluded.full_name,
     updated_at=excluded.updated_at`,
    [
      session.userId,
      session.companyId,
      session.fullName,
      session.username,
      session.email,
      session.phone,
      normalizePhone(session.phone),
      session.role,
      now,
      now,
    ],
  );
}
