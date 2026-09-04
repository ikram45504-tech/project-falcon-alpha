import Database from "@tauri-apps/plugin-sql";
import { isCloudSyncEnabled } from "./appMode";
import { supabase } from "./supabaseClient";
import { createPasswordRecord, verifyPassword } from "./security";
import { hasPermission, Permission, UserRole } from "./permissions";
import {
  applyCloudOperation,
  isDeprecatedCloudTable,
  isDesktopApp,
  queueSync as enqueueCloudSync,
  syncClearBookingChildren,
  type SyncOperation as CloudSyncOperation,
} from "./cloudSync";
import { inferPaymentKind, signedPaymentSettlement } from "./accountBalance";
import type { PaymentTransactionKind } from "./PaymentV2Db";
import type { CompanyEntitlements } from "./companyEntitlements";
import { COMPANY_NAME } from "./brand";

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
  entitlements?: CompanyEntitlements | null;
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
  contact_person: string;
  phone: string;
  whatsapp: string;
  email: string;
  address: string;
  reference: string;
  /** @deprecated Prefer `reference`; kept in sync for older rows/sync. */
  notes: string;
  status: "ACTIVE" | "INACTIVE";
  account_type: "PARTY" | "VENDOR" | "UNASSIGNED";
  created_at: string;
  updated_at: string;
};

export type PartyInput = {
  name: string;
  contactPerson: string;
  /** Combined Phone / WhatsApp — persisted to both `phone` and `whatsapp`. */
  phone: string;
  whatsapp: string;
  email: string;
  address: string;
  reference: string;
  status: "ACTIVE" | "INACTIVE";
  accountType: "PARTY" | "VENDOR" | "UNASSIGNED";
};

export function blankPartyInput(
  accountType: PartyInput["accountType"] = "PARTY",
  status: PartyInput["status"] = "ACTIVE",
): PartyInput {
  return {
    name: "",
    contactPerson: "",
    phone: "",
    whatsapp: "",
    email: "",
    address: "",
    reference: "",
    status,
    accountType,
  };
}

export function partyToInput(party: Party): PartyInput {
  const phoneWhatsapp = (party.phone || party.whatsapp || "").trim();
  return {
    name: party.name,
    contactPerson: party.contact_person || "",
    phone: phoneWhatsapp,
    whatsapp: phoneWhatsapp,
    email: party.email || "",
    address: party.address || "",
    reference: (party.reference || party.notes || "").trim(),
    status: party.status,
    accountType: party.account_type,
  };
}

/** Normalize form input so phone and whatsapp stay combined. */
export function normalizePartyInput(input: PartyInput): PartyInput {
  const phoneWhatsapp = (input.phone || input.whatsapp || "").trim();
  return {
    ...input,
    name: input.name.trim(),
    contactPerson: (input.contactPerson || "").trim(),
    phone: phoneWhatsapp,
    whatsapp: phoneWhatsapp,
    email: (input.email || "").trim(),
    address: (input.address || "").trim(),
    reference: (input.reference || "").trim(),
  };
}

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

export function aggregatePartyPaymentTotals(
  rows: Array<{ party_id: string; paid_amount: number | string | null }>,
): PartyPaymentTotal[] {
  const map = new Map<string, number>();
  for (const row of rows) {
    const partyId = String(row.party_id || "");
    if (!partyId) continue;
    map.set(partyId, (map.get(partyId) || 0) + Number(row.paid_amount || 0));
  }
  return Array.from(map.entries()).map(([party_id, paid_amount]) => ({ party_id, paid_amount }));
}

export function aggregatePartySignedPaymentTotals(
  rows: Array<{ id?: string; party_id: string; paid_amount: number | string | null }>,
  metaByPayment: Map<string, PaymentTransactionKind>,
  accountTypeByParty: Map<string, Party["account_type"]>,
): PartyPaymentTotal[] {
  const map = new Map<string, number>();
  for (const row of rows) {
    const partyId = String(row.party_id || "");
    if (!partyId) continue;
    const kind = inferPaymentKind(
      row.id && metaByPayment.has(row.id) ? { transaction_kind: metaByPayment.get(row.id) } : null,
      accountTypeByParty.get(partyId) || "PARTY",
    );
    map.set(partyId, (map.get(partyId) || 0) + signedPaymentSettlement(Number(row.paid_amount || 0), kind));
  }
  return Array.from(map.entries()).map(([party_id, paid_amount]) => ({ party_id, paid_amount }));
}

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

// Phase 12A â€” independent Transport booking module.
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

export type CreateCompanyAccountForAuthUserInput = {
  companyName: string;
  ownerUsername: string;
  ownerPhone: string;
  dtsLicense: string;
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
  if (columns.length === 0) return;

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

export async function createAuditLog(
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
  await ensureColumn("parties", "contact_person", "TEXT NOT NULL DEFAULT ''");
  await ensureColumn("parties", "email", "TEXT NOT NULL DEFAULT ''");
  await ensureColumn("parties", "reference", "TEXT NOT NULL DEFAULT ''");
  await ensureColumn("parties", "account_type", "TEXT NOT NULL DEFAULT 'UNASSIGNED'");

  await database.execute(`CREATE INDEX IF NOT EXISTS idx_parties_company_name
    ON parties(company_id, name)`);

  await database.execute(`CREATE INDEX IF NOT EXISTS idx_parties_company_type_name
    ON parties(company_id, account_type, name)`);

  await ensureColumn("parties", "created_by_user_id", "TEXT NOT NULL DEFAULT ''");
  await ensureColumn("parties", "updated_by_user_id", "TEXT NOT NULL DEFAULT ''");

  const { initCounterpartyTables } = await import("./CounterpartyDb");
  await initCounterpartyTables(database);

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

  // Phase 7B â€” new Package booking engine. Package amounts are PKR only.
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

  // Phase 7C â€” allow multiple Adult / Child / Infant rows inside one Package booking.
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

  // Phase 7D â€” richer Package entry details and optional quantity behavior.
  // These are safe additive columns; existing Package records remain readable.
  await ensureColumn("package_bookings", "package_description", "TEXT NOT NULL DEFAULT ''");
  await ensureColumn("package_bookings", "departure_date", "TEXT NOT NULL DEFAULT ''");
  await ensureColumn("package_bookings", "return_date", "TEXT NOT NULL DEFAULT ''");
  await ensureColumn("package_bookings", "no_of_days", "INTEGER NOT NULL DEFAULT 0");
  await ensureColumn("package_bookings", "ziarat_included", "TEXT NOT NULL DEFAULT ''");
  await ensureColumn("package_bookings", "customer_contact", "TEXT NOT NULL DEFAULT ''");
  await ensureColumn("package_booking_lines", "passenger_name", "TEXT NOT NULL DEFAULT ''");
  await ensureColumn("package_booking_lines", "qty_is_explicit", "INTEGER NOT NULL DEFAULT 1");

  // Phase 9A â€” dedicated Ticket booking engine.
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
    airline_name TEXT NOT NULL DEFAULT '',
    pnr TEXT NOT NULL DEFAULT '',
    flight_type TEXT NOT NULL DEFAULT 'RETURN',
    ticket_route TEXT NOT NULL DEFAULT '',
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

  // Phase 10A â€” dedicated Hotel booking engine.
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

  // Phase 10B â€” booking-level guest count is informational and never changes hotel rate calculations.
  await ensureColumn("hotel_bookings", "guest_count", "INTEGER NOT NULL DEFAULT 0");

  // Phase 11A â€” dedicated Visa booking engine.
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

  // Phase 11B â€” multiple private transport vehicles + individual passport details.
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

  // Phase 11C â€” SaaS-ready passenger passport details + travel eligibility date.
  await ensureColumn("visa_bookings", "expected_entry_date", "TEXT NOT NULL DEFAULT ''");
  await ensureColumn("visa_passport_details", "surname", "TEXT NOT NULL DEFAULT ''");
  await ensureColumn("visa_passport_details", "given_name", "TEXT NOT NULL DEFAULT ''");
  await ensureColumn("visa_passport_details", "passport_issuance", "TEXT NOT NULL DEFAULT ''");

  // Phase 12A â€” independent Transport booking engine.
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
    await database.execute(`DELETE FROM payment_entries`);
    await database.execute(`DELETE FROM parties`);
    await database.execute(`INSERT INTO app_migrations (migration_key, applied_at) VALUES ($1,$2)`, [
      cleanResetKey,
      new Date().toISOString(),
    ]);
  }

  // SaaS-ready ownership/audit fields. These stay hidden from normal entry screens.
  const ownershipTables = [
    "parties",
    "payment_entries",
    "package_bookings",
    "ticket_bookings",
    "hotel_bookings",
    "visa_bookings",
    "transport_bookings",
    "misc_bookings",
  ] as const;
  for (const table of ownershipTables) {
    await ensureColumn(table, "created_by_user_id", "TEXT NOT NULL DEFAULT ''");
    await ensureColumn(table, "updated_by_user_id", "TEXT NOT NULL DEFAULT ''");
  }

  // Phase 8 â€” one-time AUTH + COMPANY reset requested by the user.
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

  // Phase 8C â€” user-requested final FRESH START before creating the real company account.
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

  // Phase 8D â€” final consolidated onboarding reset requested by the user.
  // Runs once so the real company starts from the final Company/Users/Session model.
  const phase8DFreshStartKey = "phase_8d_consolidated_account_fresh_start_v1";
  const phase8DFreshStartDone = await database.select<CountRow[]>(
    `SELECT COUNT(*) AS count FROM app_migrations WHERE migration_key=$1`,
    [phase8DFreshStartKey],
  );

  if (Number(phase8DFreshStartDone[0]?.count ?? 0) === 0) {
    await database.execute(`DELETE FROM package_booking_lines`);
    await database.execute(`DELETE FROM package_bookings`);
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

  const legacyCleanupKey = "legacy_v3_drop_obsolete_tables_v1";
  const legacyCleanupDone = await database.select<CountRow[]>(
    `SELECT COUNT(*) AS count FROM app_migrations WHERE migration_key=$1`,
    [legacyCleanupKey],
  );
  if (Number(legacyCleanupDone[0]?.count ?? 0) === 0) {
    await database.execute(`DROP TABLE IF EXISTS booking_adjustments`);
    await database.execute(`DROP TABLE IF EXISTS accommodation_entries`);
    await database.execute(`DROP TABLE IF EXISTS service_entries`);
    await database.execute(`INSERT INTO app_migrations (migration_key, applied_at) VALUES ($1,$2)`, [
      legacyCleanupKey,
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

let companyCodeRpcAvailable: boolean | null = null;

function isMissingCompanyCodeRpcError(message: string) {
  return /could not find the function|schema cache/i.test(message);
}

async function isCompanyCodeAvailable(candidate: string) {
  if (companyCodeRpcAvailable === false) return true;

  const { data, error } = await supabase.rpc("is_company_code_available", {
    p_company_code: candidate,
  });
  if (error) {
    if (isMissingCompanyCodeRpcError(error.message)) {
      companyCodeRpcAvailable = false;
      return true;
    }
    throw new Error(error.message);
  }

  companyCodeRpcAvailable = true;
  return Boolean(data);
}

async function generateUniqueCompanyCode(companyName: string, exclude = new Set<string>()) {
  const prefixes = companyCodePrefixes(companyName);

  for (const prefix of prefixes) {
    const candidate = prefix.toUpperCase();
    if (exclude.has(candidate)) continue;
    if (await isCompanyCodeAvailable(candidate)) return candidate;
  }

  for (let attempt = 0; attempt < 500; attempt += 1) {
    const candidate = randomLetters(3).toUpperCase();
    if (exclude.has(candidate)) continue;
    if (await isCompanyCodeAvailable(candidate)) return candidate;
  }

  throw new Error("Could not generate a unique 3-letter Company Code.");
}

function isDuplicateCompanyCodeError(message: string) {
  return /companies_company_code_key|duplicate key.*company_code/i.test(message);
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

function isExistingAuthUserError(message: string) {
  return /already registered|already exists|user already/i.test(message);
}

const SETUP_IN_PROGRESS_KEY = "travelAccountingSetupInProgress";

export function isCompanySetupInProgress() {
  return sessionStorage.getItem(SETUP_IN_PROGRESS_KEY) === "1";
}

function setCompanySetupInProgress(active: boolean) {
  if (active) sessionStorage.setItem(SETUP_IN_PROGRESS_KEY, "1");
  else sessionStorage.removeItem(SETUP_IN_PROGRESS_KEY);
}

async function ensureAuthSession(email: string, password: string) {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (session) return;

  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    throw new Error(
      error.message ||
        "Account was created but could not start a sign-in session. Confirm your email if required, then sign in from the login screen.",
    );
  }
}

async function settleAuthAfterProvision(signOutAfter: boolean) {
  if (signOutAfter) {
    try {
      await Promise.race([
        supabase.auth.signOut({ scope: "local" }),
        new Promise((_, reject) => setTimeout(() => reject(new Error("sign-out timeout")), 4000)),
      ]);
    } catch {
      // Registration already succeeded; local sign-out is best-effort.
    }
    return;
  }

  try {
    await Promise.race([
      supabase.auth.refreshSession(),
      new Promise((_, reject) => setTimeout(() => reject(new Error("refresh timeout")), 4000)),
    ]);
  } catch {
    // Session refresh is best-effort after company provisioning.
  }
}

async function acquireAuthUserIdForSetup(
  ownerEmail: string,
  password: string,
  metadata: Record<string, string>,
): Promise<string> {
  const { data: authData, error: authError } = await supabase.auth.signUp({
    email: ownerEmail,
    password,
    options: { data: metadata },
  });

  if (!authError && authData.user?.id) {
    return authData.user.id;
  }

  if (!authError || !isExistingAuthUserError(authError.message)) {
    throw new Error(authError?.message || "Could not register cloud authentication.");
  }

  const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
    email: ownerEmail,
    password,
  });
  if (signInError || !signInData.user?.id) {
    throw new Error(
      "This email is already registered. Sign in with your existing password on the login screen, or use a different email.",
    );
  }

  return signInData.user.id;
}

async function prepareAuthUserForFreshCompany(userId: string) {
  const { data: existingUser, error } = await supabase
    .from("users")
    .select("company_id")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!existingUser) return;

  if (existingUser.company_id) {
    const { data: existingCompany, error: companyError } = await supabase
      .from("companies")
      .select("company_code")
      .eq("id", existingUser.company_id)
      .maybeSingle();
    if (companyError) throw new Error(companyError.message);
    if (existingCompany?.company_code) {
      throw new Error(
        `An account already exists for this email. Sign in with Company Code ${existingCompany.company_code}.`,
      );
    }
  }

  const { error: deleteError } = await supabase.from("users").delete().eq("id", userId);
  if (deleteError) throw new Error(deleteError.message);
}

async function provisionCompanyForAuthUser(input: {
  userId: string;
  ownerEmail: string;
  username: string;
  ownerPhone: string;
  companyName: string;
  dtsLicense: string;
  ensurePasswordSession?: { email: string; password: string };
  signOutAfter: boolean;
}) {
  const now = new Date().toISOString();
  const companyId = crypto.randomUUID();

  let companyCode = "";
  let companyInserted = false;
  const triedCodes = new Set<string>();
  for (let attempt = 0; attempt < 20; attempt += 1) {
    companyCode = await generateUniqueCompanyCode(input.companyName, triedCodes);
    triedCodes.add(companyCode);
    const { error: companyError } = await supabase.from("companies").insert({
      id: companyId,
      company_code: companyCode,
      name: input.companyName,
      dts_license: input.dtsLicense,
      phone: input.ownerPhone,
      whatsapp: input.ownerPhone,
      email: input.ownerEmail,
      base_currency: "PKR",
      foreign_currency: "SAR",
      status: "PENDING_APPROVAL",
      created_at: now,
      updated_at: now,
    });
    if (!companyError) {
      companyInserted = true;
      break;
    }
    if (!isDuplicateCompanyCodeError(companyError.message)) {
      throw new Error(companyError.message);
    }
  }
  if (!companyInserted || !companyCode) {
    throw new Error("Could not allocate a unique Company Code. Please try again.");
  }

  try {
    const { error: userError } = await supabase.from("users").insert({
      id: input.userId,
      company_id: companyId,
      full_name: input.username,
      username: input.username,
      email: input.ownerEmail,
      phone: input.ownerPhone,
      phone_normalized: normalizePhone(input.ownerPhone),
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

    // Company + owner rows are committed. Auth metadata / sign-out must not undo registration.
    try {
      if (input.ensurePasswordSession) {
        await ensureAuthSession(input.ensurePasswordSession.email, input.ensurePasswordSession.password);
      }

      const { error: metadataError } = await supabase.auth.updateUser({
        data: {
          company_id: companyId,
          company_code: companyCode,
          company_name: input.companyName,
          username: input.username,
          full_name: input.username,
          phone: input.ownerPhone,
          role: "OWNER",
        },
      });
      if (metadataError) {
        console.warn("Could not write auth metadata after company create:", metadataError.message);
      }

      await settleAuthAfterProvision(input.signOutAfter);
    } catch (authSettleError) {
      console.warn("Auth settle after company create failed:", authSettleError);
    }

    return {
      companyId,
      companyCode,
      userId: input.userId,
      username: input.username,
      email: input.ownerEmail,
      accountStatus: "PENDING_APPROVAL" as const,
    };
  } catch (error) {
    await supabase.from("users").delete().eq("id", input.userId);
    await supabase.from("companies").delete().eq("id", companyId);
    throw error;
  }
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

  setCompanySetupInProgress(true);
  try {
    const { assertEmailNotReservedForMaster } = await import("./companyAccess");
    await assertEmailNotReservedForMaster(ownerEmail);

    const userId = await acquireAuthUserIdForSetup(ownerEmail, input.password, {
      username,
      full_name: username,
      phone: ownerPhone,
      role: "OWNER",
      company_name: companyName,
    });

    await ensureAuthSession(ownerEmail, input.password);
    await prepareAuthUserForFreshCompany(userId);
    return await provisionCompanyForAuthUser({
      userId,
      ownerEmail,
      username,
      ownerPhone,
      companyName,
      dtsLicense,
      ensurePasswordSession: { email: ownerEmail, password: input.password },
      signOutAfter: true,
    });
  } finally {
    setCompanySetupInProgress(false);
  }
}

/** Create a company for the currently signed-in Auth user (Google), without a password. */
export async function createCompanyAccountForCurrentAuthUser(input: CreateCompanyAccountForAuthUserInput) {
  const username = validateOwnerUsername(input.ownerUsername);
  const ownerPhone = input.ownerPhone.trim();
  const companyName = input.companyName.trim();
  const dtsLicense = input.dtsLicense.trim();

  if (!companyName) throw new Error("Company Name is required.");
  if (!ownerPhone) throw new Error("Phone / WhatsApp Number is required.");

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError || !user?.id) {
    throw new Error("Sign in with Google first, then create your company.");
  }
  const ownerEmail = validateEmail(user.email || "");
  if (!ownerEmail) throw new Error("Your Google account did not share an email address.");

  setCompanySetupInProgress(true);
  try {
    const { assertEmailNotReservedForMaster } = await import("./companyAccess");
    await assertEmailNotReservedForMaster(ownerEmail);
    await prepareAuthUserForFreshCompany(user.id);
    return await provisionCompanyForAuthUser({
      userId: user.id,
      ownerEmail,
      username,
      ownerPhone,
      companyName,
      dtsLicense,
      signOutAfter: false,
    });
  } finally {
    setCompanySetupInProgress(false);
  }
}

async function isLocalCompanyCodeAvailable(candidate: string) {
  const database = await db();
  const rows = await database.select<Array<{ id: string }>>(
    `SELECT id FROM companies WHERE company_code=$1 COLLATE NOCASE LIMIT 1`,
    [candidate.toUpperCase()],
  );
  return rows.length === 0;
}

async function generateUniqueLocalCompanyCode(companyName: string) {
  const tried = new Set<string>();
  const prefixes = companyCodePrefixes(companyName);
  for (const prefix of prefixes) {
    const candidate = prefix.toUpperCase();
    if (tried.has(candidate)) continue;
    tried.add(candidate);
    if (await isLocalCompanyCodeAvailable(candidate)) return candidate;
  }
  for (let attempt = 0; attempt < 500; attempt += 1) {
    const candidate = randomLetters(3).toUpperCase();
    if (tried.has(candidate)) continue;
    tried.add(candidate);
    if (await isLocalCompanyCodeAvailable(candidate)) return candidate;
  }
  throw new Error("Could not generate a unique 3-letter Company Code.");
}

/** Offline desktop build: create company + owner entirely in local SQLite (no Supabase). */
export async function createOfflineCompanyAccount(input: CreateCompanyAccountInput) {
  const username = validateOwnerUsername(input.ownerUsername);
  const ownerEmail = validateEmail(input.ownerEmail);
  const ownerPhone = input.ownerPhone.trim();
  const companyName = input.companyName.trim();
  const dtsLicense = input.dtsLicense.trim();

  if (!companyName) throw new Error("Company Name is required.");
  if (!ownerEmail) throw new Error("Email Address is required.");
  if (!ownerPhone) throw new Error("Phone / WhatsApp Number is required.");
  validateStrongPassword(input.password);

  const database = await db();
  const now = new Date().toISOString();
  const companyId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  const companyCode = await generateUniqueLocalCompanyCode(companyName);
  const passwordRecord = await createPasswordRecord(input.password);

  await database.execute(
    `INSERT INTO companies
     (id, company_code, name, dts_license, address, phone, whatsapp, email, base_currency, foreign_currency, status, created_at, updated_at)
     VALUES ($1, $2, $3, $4, '', $5, $5, $6, 'PKR', 'SAR', 'ACTIVE', $7, $7)`,
    [companyId, companyCode, companyName, dtsLicense, ownerPhone, ownerEmail, now],
  );

  await database.execute(
    `INSERT INTO users
     (id, company_id, full_name, username, email, phone, phone_normalized, password_hash, password_salt, password_iterations, role, status, created_at, updated_at, last_login_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'OWNER', 'ACTIVE', $11, $11, '')`,
    [
      userId,
      companyId,
      username,
      username,
      ownerEmail,
      ownerPhone,
      normalizePhone(ownerPhone),
      passwordRecord.hash,
      passwordRecord.salt,
      passwordRecord.iterations,
      now,
    ],
  );

  await createAuditLog(companyId, userId, "CREATE", "COMPANY", companyId, `Offline company ${companyName} created.`);

  return { companyId, companyCode, userId, username, email: ownerEmail, accountStatus: "ACTIVE" as const };
}

export async function restoreLocalSession(userId: string, companyId: string) {
  const session = await sessionForUser(companyId, userId);
  if (!session) return null;
  const company = await getCompanyById(companyId);
  if (!company) return null;
  return { session, company };
}

export const OFFLINE_SESSION_STORAGE_KEY = "travelHisabOfflineSession";

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
    throw new Error(
      `Your registration is under review. ${COMPANY_NAME} will contact you shortly once your account is activated.`,
    );
  }
  if (company.status === "SUSPENDED") {
    throw new Error(`This company account is suspended. Please contact ${COMPANY_NAME} for help.`);
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
  // Other devices remain independently signed in â€” matching the future SaaS model.
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
  const { enforceStaffCreate } = await import("./companyAccess");
  await enforceStaffCreate(companyId);

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
  const { getAllAccounts } = await import("./CounterpartyDb");
  return getAllAccounts(companyId, search);
}

export async function createParty(companyId: string, input: PartyInput, actorUserId = "") {
  await requirePermission(companyId, actorUserId, "edit_parties");
  const { enforcePartyCreate } = await import("./companyAccess");
  await enforcePartyCreate(companyId, input.accountType);
  const { createAccount } = await import("./CounterpartyDb");
  const id = await createAccount(companyId, input, actorUserId);
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
  return id;
}

export async function updateParty(partyId: string, companyId: string, input: PartyInput, actorUserId = "") {
  await requirePermission(companyId, actorUserId, "edit_parties");
  const { updateAccount } = await import("./CounterpartyDb");
  await updateAccount(partyId, companyId, input, actorUserId);
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
}

export async function getPartyById(companyId: string, partyId: string) {
  const { getAccountById } = await import("./CounterpartyDb");
  return getAccountById(companyId, partyId);
}

export async function deleteParty(partyId: string, companyId: string, actorUserId = "") {
  await requirePermission(companyId, actorUserId, "edit_parties");
  const { deleteAccount } = await import("./CounterpartyDb");
  await deleteAccount(partyId, companyId);
  if (actorUserId) {
    await createAuditLog(companyId, actorUserId, "ACCOUNT_DELETED", "PARTIES", partyId, `Party/Vendor Deleted`);
  }
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
    "package_booking_adjustments",
    "ticket_booking_lines",
    "ticket_booking_adjustments",
    "ticket_operational_meta",
    "ticket_operational_passengers",
    "ticket_operational_flights",
    "hotel_booking_adjustments",
    "hotel_booking_lines",
    "hotel_commercial_guest_refs",
    "hotel_operational_reservations",
    "hotel_operational_guests",
    "hotel_operational_meta",
    "visa_booking_lines",
    "visa_booking_adjustments",
    "visa_passport_details",
    "visa_transport_fleet",
    "visa_operational_meta",
    "visa_operational_passengers",
    "transport_booking_lines",
    "transport_booking_adjustments",
    "transport_operational_meta",
    "transport_operational_sectors",
    "misc_booking_lines",
    "misc_booking_adjustments",
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

  // Always clear cloud children first (desktop previously only deleted locally).
  await syncClearBookingChildren(bookingId, bookingChildTables);

  for (const table of bookingChildTables) {
    try {
      if (isTauri) {
        if (
          table === "package_operational_meta" ||
          table === "ticket_operational_meta" ||
          table === "hotel_operational_meta"
        ) {
          await database.execute(`DELETE FROM ${table} WHERE booking_id=$1`, [bookingId]);
        } else if (table === "hotel_commercial_guest_refs") {
          await database.execute(`DELETE FROM ${table} WHERE booking_id=$1`, [bookingId]);
        } else if (table.includes("bookings") && !table.includes("lines") && !table.includes("adjustments")) {
          // skip headers
        } else {
          await database.execute(`DELETE FROM ${table} WHERE booking_id=$1`, [bookingId]);
        }
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
  const { fetchCounterpartyNameMap } = await import("./CounterpartyDb");
  return fetchCounterpartyNameMap(companyId);
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

    if (partyId) {
      return data as PaymentEntry[];
    }

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
            COALESCE(p.name, v.name, '') AS ledger_party_name,
            pay.transaction_date, pay.receipt_no, pay.from_account,
            pay.to_account, pay.description, pay.payment_type,
            pay.currency, pay.amount_entered, pay.sar, pay.roe,
            pay.paid_amount, pay.status, pay.created_at, pay.updated_at
     FROM payment_entries pay
     LEFT JOIN parties p ON p.id = pay.party_id AND p.company_id = pay.company_id
     LEFT JOIN vendors v ON v.id = pay.party_id AND v.company_id = pay.company_id
     WHERE pay.company_id = $1
       AND ($2 = '' OR pay.party_id = $2)
       AND (
         $3 = '' OR
         pay.receipt_no LIKE $4 COLLATE NOCASE OR
         pay.from_account LIKE $4 COLLATE NOCASE OR
         pay.to_account LIKE $4 COLLATE NOCASE OR
         pay.description LIKE $4 COLLATE NOCASE OR
         pay.payment_type LIKE $4 COLLATE NOCASE OR
         COALESCE(p.name, v.name, '') LIKE $4 COLLATE NOCASE
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
  if (!isDesktopApp()) {
    const [{ data: payments, error }, { data: metas, error: metaError }, { data: parties, error: partyError }] =
      await Promise.all([
        supabase
          .from("payment_entries")
          .select("id,party_id,paid_amount")
          .eq("company_id", companyId)
          .eq("status", "ACTIVE"),
        supabase.from("payment_v2_meta").select("payment_id,transaction_kind").eq("company_id", companyId),
        supabase.from("parties").select("id,account_type").eq("company_id", companyId),
      ]);
    if (error) throw new Error(error.message);
    if (metaError) throw new Error(metaError.message);
    if (partyError) throw new Error(partyError.message);

    const metaByPayment = new Map<string, PaymentTransactionKind>();
    for (const row of metas || []) {
      metaByPayment.set(String(row.payment_id), row.transaction_kind as PaymentTransactionKind);
    }
    const accountTypeByParty = new Map<string, Party["account_type"]>();
    for (const row of parties || []) {
      accountTypeByParty.set(String(row.id), row.account_type as Party["account_type"]);
    }

    return aggregatePartySignedPaymentTotals(payments || [], metaByPayment, accountTypeByParty);
  }

  const database = await db();
  const rows = await database.select<
    Array<{ id: string; party_id: string; paid_amount: number; transaction_kind: string | null; account_type: string }>
  >(
    `SELECT p.id,p.party_id,p.paid_amount,m.transaction_kind,a.account_type
     FROM payment_entries p
     LEFT JOIN payment_v2_meta m ON m.payment_id=p.id
     LEFT JOIN parties a ON a.id=p.party_id AND a.company_id=p.company_id
     WHERE p.company_id=$1 AND p.status='ACTIVE'`,
    [companyId],
  );

  const metaByPayment = new Map<string, PaymentTransactionKind>();
  const accountTypeByParty = new Map<string, Party["account_type"]>();
  for (const row of rows) {
    if (row.transaction_kind) metaByPayment.set(row.id, row.transaction_kind as PaymentTransactionKind);
    accountTypeByParty.set(row.party_id, (row.account_type || "PARTY") as Party["account_type"]);
  }
  return aggregatePartySignedPaymentTotals(rows, metaByPayment, accountTypeByParty);
}

export async function getCompanyPackageSummary(companyId: string) {
  const isTauri = "__TAURI_INTERNALS__" in window;
  if (!isTauri) {
    const { data, error } = await supabase
      .from("package_bookings")
      .select("transaction_type,total_pkr,status")
      .eq("company_id", companyId)
      .eq("status", "ACTIVE");
    if (error) throw new Error(error.message);
    const rows = data || [];
    return {
      sale_total: rows.filter((r) => r.transaction_type === "SALE").reduce((s, r) => s + Number(r.total_pkr || 0), 0),
      purchase_total: rows
        .filter((r) => r.transaction_type === "PURCHASE")
        .reduce((s, r) => s + Number(r.total_pkr || 0), 0),
      active_count: rows.length,
    } as CompanyPackageSummary;
  }

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
  const isTauri = "__TAURI_INTERNALS__" in window;
  if (!isTauri) {
    const { data, error } = await supabase
      .from("package_bookings")
      .select("counterparty_id,transaction_type,total_pkr,status")
      .eq("company_id", companyId)
      .eq("status", "ACTIVE");
    if (error) throw new Error(error.message);
    const map = new Map<string, CounterpartyPackageTotal>();
    for (const row of data || []) {
      const id = String(row.counterparty_id);
      const current = map.get(id) || { counterparty_id: id, sale_total: 0, purchase_total: 0 };
      if (row.transaction_type === "SALE") current.sale_total += Number(row.total_pkr || 0);
      else current.purchase_total += Number(row.total_pkr || 0);
      map.set(id, current);
    }
    return Array.from(map.values());
  }

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

export { getPackageBookings, voidPackageBooking } from "./PackageFlowDb";

export {
  getHotelBookings,
  createHotelBooking,
  updateHotelBooking,
  voidHotelBooking,
  calculateHotelLines,
} from "./HotelFlowDb";

export {
  calculateVisaBooking,
  getVisaBookings,
  createVisaBooking,
  updateVisaBooking,
  voidVisaBooking,
} from "./VisaFlowDb";

export {
  calculateTransportLines,
  getTransportBookings,
  createTransportBooking,
  updateTransportBooking,
  voidTransportBooking,
} from "./TransportFlowDb";

export async function dangerouslyEraseAllData(companyId: string) {
  const database = await db();

  const tables = [
    "package_booking_lines",
    "package_booking_adjustments",
    "package_operational_meta",
    "package_operational_passengers",
    "package_operational_hotels",
    "package_operational_flights",
    "package_operational_flight_stopovers",
    "package_movement_events",
    "package_bookings",

    "ticket_booking_lines",
    "ticket_booking_adjustments",
    "ticket_operational_meta",
    "ticket_operational_passengers",
    "ticket_operational_flights",
    "ticket_bookings",

    "hotel_booking_lines",
    "hotel_booking_adjustments",
    "hotel_commercial_guest_refs",
    "hotel_operational_reservations",
    "hotel_operational_guests",
    "hotel_operational_meta",
    "hotel_bookings",

    "visa_booking_lines",
    "visa_booking_adjustments",
    "visa_transport_fleet",
    "visa_passport_details",
    "visa_operational_meta",
    "visa_operational_passengers",
    "visa_bookings",

    "transport_booking_lines",
    "transport_booking_adjustments",
    "transport_operational_sectors",
    "transport_operational_meta",
    "transport_bookings",

    "misc_booking_lines",
    "misc_booking_adjustments",
    "misc_commercial_family_refs",
    "misc_operational_services",
    "misc_operational_meta",
    "misc_bookings",

    "payment_v2_meta",
    "payment_entries",
    "parties",
    "vendors",
    "unassigned_accounts",
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
 * Retries FAILED jobs as well so a transient error does not permanently stall amendments.
 */
export async function processSyncQueue() {
  if (!isCloudSyncEnabled() || !navigator.onLine) return;

  try {
    const database = await db();
    // Re-queue previously failed jobs so amendments/cancellations can recover after a transient error.
    await database.execute(`UPDATE sync_queue SET status = 'PENDING' WHERE status = 'FAILED'`);

    const pending = await database.select<SyncQueueEntry[]>(
      "SELECT * FROM sync_queue WHERE status = 'PENDING' ORDER BY created_at ASC",
    );

    if (pending.length === 0) return;

    for (const job of pending) {
      try {
        if (isDeprecatedCloudTable(job.table_name)) {
          await database.execute("DELETE FROM sync_queue WHERE id = $1", [job.id]);
          continue;
        }
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
  if (!isCloudSyncEnabled() || !navigator.onLine) return null;
  if (syncPassInFlight) return null;
  syncPassInFlight = true;
  try {
    await processSyncQueue();
    // Manual Sync also re-pushes local package adjustments that never reached the cloud
    // (e.g. amendments saved while queue jobs failed or before sync wiring).
    if (source === "manual" && backgroundCompanyId) {
      await pushLocalPackageAdjustmentRepair(backgroundCompanyId);
    }
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

/** Push local package totals/lines/adjustments for bookings that have adjustment history. */
async function pushLocalPackageAdjustmentRepair(companyId: string) {
  const database = await db();
  const adjustments = await database.select<Record<string, unknown>[]>(
    `SELECT * FROM package_booking_adjustments WHERE company_id = $1 ORDER BY revision_no ASC, created_at ASC`,
    [companyId],
  );
  if (!adjustments.length) return;

  const bookingIds = Array.from(new Set(adjustments.map((row) => String(row.booking_id || ""))));
  for (const bookingId of bookingIds) {
    if (!bookingId) continue;
    const headers = await database.select<Record<string, unknown>[]>(
      `SELECT id, total_pkr, updated_at, updated_by_user_id FROM package_bookings WHERE company_id = $1 AND id = $2 LIMIT 1`,
      [companyId, bookingId],
    );
    const header = headers[0];
    if (!header) continue;

    const lines = await database.select<Record<string, unknown>[]>(
      `SELECT id, booking_id, passenger_type, passenger_name, package_type, rate_per_person, person_count,
              qty_is_explicit, line_total_pkr, sort_order
       FROM package_booking_lines WHERE booking_id = $1 ORDER BY sort_order ASC`,
      [bookingId],
    );

    await applyCloudOperation("UPDATE", "package_bookings", bookingId, {
      total_pkr: header.total_pkr,
      updated_at: header.updated_at || new Date().toISOString(),
      updated_by_user_id: header.updated_by_user_id || "",
    });
    await applyCloudOperation("REPLACE_CHILDREN", "package_booking_lines", bookingId, {
      parent_column: "booking_id",
      rows: lines,
    });
  }

  for (const adjustment of adjustments) {
    const id = String(adjustment.id || "");
    if (!id) continue;
    await applyCloudOperation("UPSERT", "package_booking_adjustments", id, adjustment);
  }
}

/**
 * Starts automatic push/pull sync for desktop.
 * Runs every few seconds, and also when the window is focused or comes back online.
 */
export async function startBackgroundSync(companyId = "") {
  if (!isCloudSyncEnabled()) return;
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
  if (!isTauri || !isCloudSyncEnabled() || !navigator.onLine) return;

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
    "vendors",
    "unassigned_accounts",
    "payment_entries",
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
      "ticket_booking_adjustments",
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
      "hotel_booking_adjustments",
    ],
    visa_bookings: [
      "visa_booking_lines",
      "visa_transport_fleet",
      "visa_passport_details",
      "visa_operational_meta",
      "visa_operational_passengers",
      "visa_booking_adjustments",
    ],
    transport_bookings: [
      "transport_booking_lines",
      "transport_operational_sectors",
      "transport_operational_meta",
      "transport_booking_adjustments",
    ],
    misc_bookings: [
      "misc_booking_lines",
      "misc_booking_adjustments",
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

  // Ensure segment adjustment tables exist before pull upserts.
  const { initPackageAdjustmentDatabase } = await import("./PackageAdjustmentDb");
  await initPackageAdjustmentDatabase();
  columnCache.delete("package_booking_adjustments");
  const { initHotelAdjustmentDatabase } = await import("./HotelAdjustmentDb");
  await initHotelAdjustmentDatabase();
  columnCache.delete("hotel_booking_adjustments");
  const { initTicketAdjustmentDatabase } = await import("./TicketAdjustmentDb");
  await initTicketAdjustmentDatabase();
  columnCache.delete("ticket_booking_adjustments");
  const { initVisaAdjustmentDatabase } = await import("./VisaAdjustmentDb");
  await initVisaAdjustmentDatabase();
  columnCache.delete("visa_booking_adjustments");
  const { initMiscAdjustmentDatabase } = await import("./MiscAdjustmentDb");
  await initMiscAdjustmentDatabase();
  columnCache.delete("misc_booking_adjustments");
  const { initTransportAdjustmentDatabase } = await import("./TransportAdjustmentDb");
  await initTransportAdjustmentDatabase();
  columnCache.delete("transport_booking_adjustments");

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
    const localRows = await database.select<Array<{ id: string }>>(`SELECT id FROM ${table} WHERE company_id = $1`, [
      companyId,
    ]);

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

    // Incremental pull uses updated_at/created_at when present on the root table.
    if (lastSync !== "2000-01-01T00:00:00.000Z") {
      const cols = await localColumns(table);
      if (cols.has("updated_at") && cols.has("created_at")) {
        query = query.or(`updated_at.gt."${lastSync}",created_at.gt."${lastSync}"`);
      } else if (cols.has("updated_at")) {
        query = query.gt("updated_at", lastSync);
      } else if (cols.has("created_at")) {
        query = query.gt("created_at", lastSync);
      }
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
          const bookingId = String((row as any).id);
          for (const childTable of children) {
            const { data: childData, error: childError } = await supabase
              .from(childTable)
              .select("*")
              .eq("booking_id", bookingId);

            if (childError) {
              console.error(`Pull sync child query failed for ${childTable}:`, childError.message);
              continue;
            }

            // Replace local children with cloud snapshot (including empty = all cancelled).
            await database.execute(`DELETE FROM ${childTable} WHERE booking_id = $1`, [bookingId]);

            for (const childRow of childData || []) {
              await upsertCloudRow(childTable, childRow as Record<string, unknown>);
            }
          }
        }
      } catch (err) {
        console.error(`Pull Sync Error on table ${table}:`, err);
      }
    }
  }

  // Reconcile deletes: remove local accounts that no longer exist in cloud.
  async function reconcileCounterpartyTable(table: "parties" | "vendors" | "unassigned_accounts") {
    const { data: cloudIds, error: cloudIdsError } = await supabase
      .from(table)
      .select("id")
      .eq("company_id", companyId)
      .limit(5000);
    if (cloudIdsError) {
      console.error(`${table} delete reconcile failed:`, cloudIdsError.message);
      return 0;
    }
    const cloudIdSet = new Set((cloudIds || []).map((row) => String(row.id)));
    const localRows = await database.select<Array<{ id: string }>>(`SELECT id FROM ${table} WHERE company_id = $1`, [
      companyId,
    ]);
    let removed = 0;
    for (const local of localRows) {
      if (cloudIdSet.has(local.id)) continue;
      await database.execute(`DELETE FROM ${table} WHERE id = $1 AND company_id = $2`, [local.id, companyId]);
      removed += 1;
    }
    return removed;
  }

  try {
    partiesRemoved += await reconcileCounterpartyTable("parties");
    partiesRemoved += await reconcileCounterpartyTable("vendors");
    partiesRemoved += await reconcileCounterpartyTable("unassigned_accounts");
  } catch (err) {
    console.error("Counterparty delete reconcile error:", err);
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
