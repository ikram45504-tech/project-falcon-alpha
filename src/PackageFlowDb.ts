import Database from "@tauri-apps/plugin-sql";
import type { BookingTransactionType, PackageBookingLineInput } from "./db";
import { runAtomicTransaction, type AtomicSqlStatement } from "./DatabaseSafety";
import { hasPermission, type Permission, type UserRole } from "./permissions";

const DB_PATH = "sqlite:travel-accounting.db";
let packageDbPromise: Promise<Database> | null = null;

export type PackageCommercialInput = {
  transactionType: BookingTransactionType;
  counterpartyId: string;
  transactionDate: string;
  ubNumber: string;
  lines: PackageBookingLineInput[];
};

export type PackageAdditionalDetailsInput = {
  packageDescription: string;
  departureDate: string;
  returnDate: string;
  noOfDays: number;
  ziaratIncluded: "" | "YES" | "NO";
  customerContact: string;
  notes: string;
};

type CalculatedLine = {
  passengerType: "ADULT" | "CHILD" | "INFANT";
  passengerName: string;
  packageType: string;
  ratePerPerson: number;
  personCount: number;
  qtyIsExplicit: number;
  lineTotalPkr: number;
  sortOrder: number;
};

async function db() {
  if (!packageDbPromise) packageDbPromise = Database.load(DB_PATH);
  return packageDbPromise;
}

function normalizeUb(value: string) {
  return value.trim().replace(/\s+/g, " ").toUpperCase();
}

function validateNewUb(value: string) {
  if (!/^UB-\d{4}$/.test(value.trim().toUpperCase())) {
    throw new Error("Booking number must contain 1 to 4 digits and be assigned as UB-0000 format.");
  }
}

async function requirePermission(companyId: string, userId: string, permission: Permission) {
  if (!userId) return;
  const database = await db();
  const rows = await database.select<Array<{ role: UserRole; status: string }>>(
    `SELECT role,status FROM users WHERE id=$1 AND company_id=$2 LIMIT 1`,
    [userId, companyId]
  );
  const actor = rows[0];
  if (!actor || actor.status !== "ACTIVE" || !hasPermission(actor.role, permission)) {
    throw new Error("You do not have permission to perform this action.");
  }
}

function auditStatement(
  companyId: string,
  userId: string,
  action: string,
  recordId: string,
  details: string,
  now: string
): AtomicSqlStatement | null {
  if (!userId) return null;
  return {
    sql: `INSERT INTO audit_logs
      (id,company_id,user_id,user_name,action,module,record_id,details,created_at)
      VALUES ($1,$2,$3,
        COALESCE((SELECT full_name FROM users WHERE id=$3 AND company_id=$2 LIMIT 1),'Unknown User'),
        $4,'PACKAGE',$5,$6,$7)`,
    params: [crypto.randomUUID(), companyId, userId, action, recordId, details, now],
  };
}

async function validateCounterparty(companyId: string, transactionType: BookingTransactionType, counterpartyId: string) {
  if (!counterpartyId) throw new Error(transactionType === "SALE" ? "Select a Party / Customer." : "Select a Vendor / Supplier.");
  const database = await db();
  const rows = await database.select<Array<{ account_type: string; status: string }>>(
    `SELECT account_type,status FROM parties WHERE id=$1 AND company_id=$2 LIMIT 1`,
    [counterpartyId, companyId]
  );
  const account = rows[0];
  const expected = transactionType === "SALE" ? "PARTY" : "VENDOR";
  if (!account || account.status !== "ACTIVE" || account.account_type !== expected) {
    throw new Error(transactionType === "SALE" ? "Select an active Party / Customer." : "Select an active Vendor / Supplier.");
  }
}

async function validatePackageUbAvailability(
  companyId: string,
  transactionType: BookingTransactionType,
  counterpartyId: string,
  ubNumber: string
) {
  const database = await db();
  const normalized = normalizeUb(ubNumber);
  const rows = await database.select<Array<{ transaction_type: BookingTransactionType; counterparty_id: string; ub_number: string }>>(
    `SELECT transaction_type,counterparty_id,ub_number FROM package_bookings WHERE company_id=$1`,
    [companyId]
  );

  const duplicate = rows.find((row) => {
    if (normalizeUb(row.ub_number) !== normalized) return false;
    if (transactionType === "SALE") return row.transaction_type === "SALE";
    return row.transaction_type === "PURCHASE" && row.counterparty_id === counterpartyId;
  });

  if (!duplicate) return;
  if (transactionType === "SALE") {
    throw new Error(`${ubNumber} already has a Package Sale booking. Open that booking from the Package Register instead.`);
  }
  throw new Error(`This Vendor already has a Package Purchase booking for ${ubNumber}. Open that booking from the Package Register instead.`);
}

function calculateLines(lines: PackageBookingLineInput[]) {
  if (!lines.length) throw new Error("Add at least one package passenger row.");
  const occurrence = { ADULT: 0, CHILD: 0, INFANT: 0 };
  const calculated: CalculatedLine[] = lines.map((line, index) => {
    if (!["ADULT", "CHILD", "INFANT"].includes(line.passengerType)) throw new Error("Invalid passenger type in package booking.");
    occurrence[line.passengerType] += 1;
    const label = `${line.passengerType} row ${occurrence[line.passengerType]}`;
    const passengerName = line.passengerName.trim();
    const packageType = line.packageType.trim();
    const rate = Number(line.ratePerPerson) || 0;
    const explicit = Boolean(line.qtyIsExplicit);
    const qty = explicit ? Math.trunc(Number(line.personCount) || 0) : 1;
    if (!passengerName) throw new Error(`${label}: Passenger Name is required.`);
    if (!packageType) throw new Error(`${label}: Package Type is required.`);
    if (!Number.isFinite(rate)) throw new Error(`${label}: Rate Per Person must be a valid number.`);
    if (explicit && qty <= 0) throw new Error(`${label}: Qty must be greater than zero or left blank.`);
    return {
      passengerType: line.passengerType,
      passengerName,
      packageType,
      ratePerPerson: rate,
      personCount: qty,
      qtyIsExplicit: explicit ? 1 : 0,
      lineTotalPkr: rate * qty,
      sortOrder: index + 1,
    };
  });
  if (occurrence.ADULT === 0) throw new Error("At least one Adult package row is required.");
  return { calculated, totalPkr: calculated.reduce((sum, line) => sum + line.lineTotalPkr, 0) };
}

function insertLineStatements(bookingId: string, lines: CalculatedLine[]): AtomicSqlStatement[] {
  return lines.map((line) => ({
    sql: `INSERT INTO package_booking_lines
      (id,booking_id,passenger_type,passenger_name,package_type,rate_per_person,person_count,qty_is_explicit,line_total_pkr,sort_order)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    params: [
      crypto.randomUUID(), bookingId, line.passengerType, line.passengerName, line.packageType,
      line.ratePerPerson, line.personCount, line.qtyIsExplicit, line.lineTotalPkr, line.sortOrder,
    ],
  }));
}

export async function createPackageCommercialBooking(companyId: string, input: PackageCommercialInput, actorUserId = "") {
  await requirePermission(companyId, actorUserId, "create_bookings");
  if (!["SALE", "PURCHASE"].includes(input.transactionType)) throw new Error("Select Sale or Purchase first.");
  if (!input.transactionDate) throw new Error("Date of Booking is required.");
  validateNewUb(input.ubNumber);
  await validateCounterparty(companyId, input.transactionType, input.counterpartyId);
  await validatePackageUbAvailability(companyId, input.transactionType, input.counterpartyId, input.ubNumber);
  const { calculated, totalPkr } = calculateLines(input.lines);
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const statements: AtomicSqlStatement[] = [
    {
      sql: `INSERT INTO package_bookings
        (id,company_id,transaction_type,counterparty_id,transaction_date,ub_number,
         package_description,departure_date,return_date,no_of_days,ziarat_included,customer_contact,notes,
         total_pkr,status,created_at,updated_at,created_by_user_id,updated_by_user_id)
        VALUES ($1,$2,$3,$4,$5,$6,'','','',0,'','','',$7,'ACTIVE',$8,$8,$9,$9)`,
      params: [id, companyId, input.transactionType, input.counterpartyId, input.transactionDate, input.ubNumber.trim().toUpperCase(), totalPkr, now, actorUserId],
    },
    ...insertLineStatements(id, calculated),
  ];
  const audit = auditStatement(companyId, actorUserId, "BOOKING_CREATED", id, `${input.transactionType} ${input.ubNumber} - PKR ${totalPkr}`, now);
  if (audit) statements.push(audit);
  await runAtomicTransaction(statements);
  return id;
}

export async function updatePackageCommercialBooking(companyId: string, bookingId: string, input: Pick<PackageCommercialInput, "transactionDate" | "lines">, actorUserId = "") {
  await requirePermission(companyId, actorUserId, "edit_bookings");
  if (!input.transactionDate) throw new Error("Date of Booking is required.");
  const { calculated, totalPkr } = calculateLines(input.lines);
  const database = await db();
  const rows = await database.select<Array<{ ub_number: string; status: string }>>(
    `SELECT ub_number,status FROM package_bookings WHERE id=$1 AND company_id=$2 LIMIT 1`,
    [bookingId, companyId]
  );
  const current = rows[0];
  if (!current || current.status !== "ACTIVE") throw new Error("This Package booking is no longer active.");

  const now = new Date().toISOString();
  const statements: AtomicSqlStatement[] = [
    {
      sql: `UPDATE package_bookings SET transaction_date=$1,total_pkr=$2,updated_at=$3,updated_by_user_id=$4
        WHERE id=$5 AND company_id=$6 AND status='ACTIVE'`,
      params: [input.transactionDate, totalPkr, now, actorUserId, bookingId, companyId],
    },
    { sql: `DELETE FROM package_booking_lines WHERE booking_id=$1`, params: [bookingId] },
    ...insertLineStatements(bookingId, calculated),
  ];
  const audit = auditStatement(companyId, actorUserId, "BOOKING_UPDATED", bookingId, `${current.ub_number} commercial Package details updated - PKR ${totalPkr}`, now);
  if (audit) statements.push(audit);
  await runAtomicTransaction(statements);
}

export async function updatePackageAdditionalDetails(companyId: string, bookingId: string, input: PackageAdditionalDetailsInput, actorUserId = "") {
  await requirePermission(companyId, actorUserId, "edit_bookings");
  if (input.departureDate && input.returnDate && input.returnDate < input.departureDate) {
    throw new Error("Travel End / Return Date cannot be before Travel Start Date.");
  }
  if (Number(input.noOfDays || 0) < 0) throw new Error("No. of Days cannot be negative.");
  if (!["", "YES", "NO"].includes(input.ziaratIncluded)) throw new Error("Ziarat Included must be Yes, No, or left blank.");

  const database = await db();
  const rows = await database.select<Array<{ ub_number: string; status: string }>>(
    `SELECT ub_number,status FROM package_bookings WHERE id=$1 AND company_id=$2 LIMIT 1`,
    [bookingId, companyId]
  );
  const current = rows[0];
  if (!current || current.status !== "ACTIVE") throw new Error("This Package booking is no longer active.");

  const now = new Date().toISOString();
  const statements: AtomicSqlStatement[] = [
    {
      sql: `UPDATE package_bookings
        SET package_description=$1,departure_date=$2,return_date=$3,no_of_days=$4,
            ziarat_included=$5,customer_contact=$6,notes=$7,updated_at=$8,updated_by_user_id=$9
        WHERE id=$10 AND company_id=$11 AND status='ACTIVE'`,
      params: [
        input.packageDescription.trim(), input.departureDate, input.returnDate,
        Math.max(0, Math.trunc(Number(input.noOfDays) || 0)), input.ziaratIncluded,
        input.customerContact.trim(), input.notes.trim(), now, actorUserId,
        bookingId, companyId,
      ],
    },
  ];
  const audit = auditStatement(companyId, actorUserId, "BOOKING_DETAILS_UPDATED", bookingId, `${current.ub_number} additional Package details updated.`, now);
  if (audit) statements.push(audit);
  await runAtomicTransaction(statements);
}
