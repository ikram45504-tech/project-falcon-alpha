import Database from "@tauri-apps/plugin-sql";
import type { BookingTransactionType, PackageBookingLineInput, PackageBooking, PackageBookingLine } from "./db";
import { runAtomicTransaction, type AtomicSqlStatement } from "./DatabaseSafety";
import { isDesktopApp, queueSync, syncPackageBookingBundle, syncPackageBookingVoid } from "./cloudSync";

import { applyBookingListScope, bookingListScopeSql, type BookingListScope } from "./bookingListScope";
import { validateBookingCounterparty } from "./CounterpartyDb";
import { supabase } from "./supabaseClient";

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
  if (!packageDbPromise) {
    const isTauri = "__TAURI_INTERNALS__" in window;
    if (isTauri) {
      packageDbPromise = Database.load(DB_PATH);
    } else {
      console.warn("Running in Web Mode. Local database is not available for " + DB_PATH);
      packageDbPromise = Promise.resolve({
        execute: async () => ({ lastInsertId: 0, rowsAffected: 0 }),
        select: async () => [],
      } as any);
    }
  }
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

import { createAuditLog, requirePermission } from "./db";
function auditStatement(
  companyId: string,
  userId: string,
  action: string,
  recordId: string,
  details: string,
  now: string,
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

async function validatePackageUbAvailability(
  companyId: string,
  transactionType: BookingTransactionType,
  counterpartyId: string,
  ubNumber: string,
) {
  const normalized = normalizeUb(ubNumber);
  let rows: Array<{ transaction_type: BookingTransactionType; counterparty_id: string; ub_number: string }> = [];

  if (isDesktopApp()) {
    const database = await db();
    rows = await database.select(
      `SELECT transaction_type,counterparty_id,ub_number FROM package_bookings WHERE company_id=$1 AND status='ACTIVE'`,
      [companyId],
    );
  } else {
    const { data, error } = await supabase
      .from("package_bookings")
      .select("transaction_type,counterparty_id,ub_number")
      .eq("company_id", companyId)
      .eq("status", "ACTIVE");
    if (error) throw new Error(error.message);
    rows = (data || []) as typeof rows;
  }

  const duplicate = rows.find((row) => {
    if (normalizeUb(row.ub_number) !== normalized) return false;
    if (transactionType === "SALE") return row.transaction_type === "SALE";
    return row.transaction_type === "PURCHASE" && row.counterparty_id === counterpartyId;
  });

  if (!duplicate) return;
  if (transactionType === "SALE") {
    throw new Error(
      `${ubNumber} already has a Package Sale booking. Open that booking from the Package Register instead.`,
    );
  }
  throw new Error(
    `This Vendor already has a Package Purchase booking for ${ubNumber}. Open that booking from the Package Register instead.`,
  );
}

function buildPackageLinePayloads(bookingId: string, calculated: CalculatedLine[]) {
  return calculated.map((line) => ({
    id: crypto.randomUUID(),
    booking_id: bookingId,
    passenger_type: line.passengerType,
    passenger_name: line.passengerName,
    package_type: line.packageType,
    rate_per_person: line.ratePerPerson,
    person_count: line.personCount,
    qty_is_explicit: line.qtyIsExplicit,
    line_total_pkr: line.lineTotalPkr,
    sort_order: line.sortOrder,
  }));
}

async function fetchPartyNameMap(companyId: string) {
  const { fetchCounterpartyNameMap } = await import("./CounterpartyDb");
  return fetchCounterpartyNameMap(companyId);
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

export async function getPackageBookings(companyId: string, search = "", scope?: BookingListScope) {
  const isTauri = "__TAURI_INTERNALS__" in window;
  const clean = search.trim();

  if (!isTauri) {
    let query = applyBookingListScope(
      supabase
        .from("package_bookings")
        .select("*")
        .eq("company_id", companyId)
        .order("transaction_date", { ascending: false })
        .order("created_at", { ascending: false }),
      scope,
    );

    if (clean) {
      query = query.or(
        `ub_number.ilike.%${clean}%,package_description.ilike.%${clean}%,customer_contact.ilike.%${clean}%,notes.ilike.%${clean}%`,
      );
    }

    const { data, error } = await query;
    if (error) throw new Error(error.message);

    const headers = data || [];
    const partyNames = scope?.counterpartyId ? new Map<string, string>() : await fetchPartyNameMap(companyId);
    const lines = await fetchChildRowsByBookingIds(
      "package_booking_lines",
      headers.map((row) => String(row.id)),
    );
    const linesByBooking = groupRowsByBookingId(lines);

    return headers.map((row: Record<string, unknown>) => ({
      ...row,
      counterparty_name: partyNames.get(String(row.counterparty_id)) || "",
      lines: (linesByBooking.get(String(row.id)) || [])
        .slice()
        .sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0)),
    })) as PackageBooking[];
  }

  const database = await db();
  const term = `%${clean}%`;
  const scopeFilter = bookingListScopeSql(scope, 3);

  const headers = await database.select<Omit<PackageBooking, "lines">[]>(
    `SELECT
       b.id, b.company_id, b.transaction_type, b.counterparty_id,
       COALESCE(p.name, v.name, '') AS counterparty_name,
       b.transaction_date, b.ub_number, b.package_description,
       b.departure_date, b.return_date, b.no_of_days, b.ziarat_included,
       b.customer_contact, b.notes, b.total_pkr,
       b.status, b.created_at, b.updated_at
     FROM package_bookings b
     LEFT JOIN parties p ON p.id=b.counterparty_id AND p.company_id=b.company_id
     LEFT JOIN vendors v ON v.id=b.counterparty_id AND v.company_id=b.company_id
     WHERE b.company_id=$1
       AND (
         $2='' OR
         b.ub_number LIKE $3 COLLATE NOCASE OR
         b.package_description LIKE $3 COLLATE NOCASE OR
         b.customer_contact LIKE $3 COLLATE NOCASE OR
         b.notes LIKE $3 COLLATE NOCASE OR
         COALESCE(p.name, v.name, '') LIKE $3 COLLATE NOCASE OR
         EXISTS (
           SELECT 1 FROM package_booking_lines l
           WHERE l.booking_id=b.id AND (l.package_type LIKE $3 COLLATE NOCASE OR l.passenger_name LIKE $3 COLLATE NOCASE)
         )
       )
       ${scopeFilter.sql}
     ORDER BY b.transaction_date DESC, b.created_at DESC`,
    [companyId, clean, term, ...scopeFilter.params],
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

export async function voidPackageBooking(companyId: string, bookingId: string, actorUserId = "") {
  await requirePermission(companyId, actorUserId, "void_bookings");
  const isTauri = "__TAURI_INTERNALS__" in window;
  const now = new Date().toISOString();
  let ubNumber: string;

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

  await syncPackageBookingVoid(bookingId, now, actorUserId);

  if (actorUserId) {
    await createAuditLog(
      companyId,
      actorUserId,
      "BOOKING_VOIDED",
      "PACKAGE",
      bookingId,
      `Package booking ${ubNumber} voided.`,
    );
  }
}

export async function getPackageBookingById(companyId: string, bookingId: string) {
  const isTauri = "__TAURI_INTERNALS__" in window;
  if (!isTauri) {
    const { data } = await supabase
      .from("package_bookings")
      .select("*")
      .eq("id", bookingId)
      .eq("company_id", companyId)
      .single();
    if (!data) throw new Error("Booking not found");
    const { data: lines } = await supabase
      .from("package_booking_lines")
      .select("*")
      .eq("booking_id", bookingId)
      .order("sort_order", { ascending: true });
    return { ...data, lines: lines || [] } as PackageBooking;
  }

  const database = await db();
  const headers = await database.select<Omit<PackageBooking, "lines">[]>(
    `SELECT id,company_id,transaction_type,counterparty_id,transaction_date,ub_number,total_pkr,status,created_at,updated_at
     FROM package_bookings
     WHERE id=$1 AND company_id=$2
     LIMIT 1`,
    [bookingId, companyId],
  );

  const header = headers[0];
  if (!header) throw new Error("Booking not found");

  const lines = await database.select<PackageBookingLine[]>(
    `SELECT id,booking_id,company_id,passenger_type,passenger_name,package_type,rate_per_person,person_count,qty_is_explicit,line_total_pkr,sort_order
     FROM package_booking_lines
     WHERE booking_id=$1 AND company_id=$2
     ORDER BY sort_order ASC`,
    [bookingId, companyId],
  );

  return {
    ...header,
    lines,
  } as PackageBooking;
}

function calculateLines(lines: PackageBookingLineInput[]) {
  if (!lines.length) throw new Error("Add at least one package passenger row.");
  const occurrence = { ADULT: 0, CHILD: 0, INFANT: 0 };
  const calculated: CalculatedLine[] = lines.map((line, index) => {
    if (!["ADULT", "CHILD", "INFANT"].includes(line.passengerType))
      throw new Error("Invalid passenger type in package booking.");
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

function insertLineStatements(bookingId: string, lines: Array<CalculatedLine & { id: string }>): AtomicSqlStatement[] {
  return lines.map((line) => ({
    sql: `INSERT INTO package_booking_lines
      (id,booking_id,passenger_type,passenger_name,package_type,rate_per_person,person_count,qty_is_explicit,line_total_pkr,sort_order)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    params: [
      line.id,
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
  }));
}

export async function createPackageCommercialBooking(
  companyId: string,
  input: PackageCommercialInput,
  actorUserId = "",
) {
  await requirePermission(companyId, actorUserId, "create_bookings");
  const { enforceSegmentCreate } = await import("./companyAccess");
  await enforceSegmentCreate(companyId, "PACKAGE", {
    transactionType: input.transactionType,
    counterpartyId: input.counterpartyId,
  });
  if (!["SALE", "PURCHASE"].includes(input.transactionType)) throw new Error("Select Sale or Purchase first.");
  if (!input.transactionDate) throw new Error("Date of Booking is required.");
  validateNewUb(input.ubNumber);
  await validateBookingCounterparty(companyId, input.transactionType, input.counterpartyId);
  await validatePackageUbAvailability(companyId, input.transactionType, input.counterpartyId, input.ubNumber);
  const { calculated, totalPkr } = calculateLines(input.lines);
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const ubNumber = input.ubNumber.trim().toUpperCase();
  const lineRows = buildPackageLinePayloads(id, calculated);
  const lineStatements = insertLineStatements(
    id,
    lineRows.map((line) => ({
      id: line.id,
      passengerType: line.passenger_type as CalculatedLine["passengerType"],
      passengerName: line.passenger_name,
      packageType: line.package_type,
      ratePerPerson: line.rate_per_person,
      personCount: line.person_count,
      qtyIsExplicit: line.qty_is_explicit,
      lineTotalPkr: line.line_total_pkr,
      sortOrder: line.sort_order,
    })),
  );

  const header = {
    id,
    company_id: companyId,
    transaction_type: input.transactionType,
    counterparty_id: input.counterpartyId,
    transaction_date: input.transactionDate,
    ub_number: ubNumber,
    package_description: "",
    departure_date: "",
    return_date: "",
    no_of_days: 0,
    ziarat_included: "",
    customer_contact: "",
    notes: "",
    total_pkr: totalPkr,
    status: "ACTIVE",
    created_at: now,
    updated_at: now,
    created_by_user_id: actorUserId,
    updated_by_user_id: actorUserId,
  };

  if (isDesktopApp()) {
    const statements: AtomicSqlStatement[] = [
      {
        sql: `INSERT INTO package_bookings
          (id,company_id,transaction_type,counterparty_id,transaction_date,ub_number,
           package_description,departure_date,return_date,no_of_days,ziarat_included,customer_contact,notes,
           total_pkr,status,created_at,updated_at,created_by_user_id,updated_by_user_id)
          VALUES ($1,$2,$3,$4,$5,$6,'','','',0,'','','',$7,'ACTIVE',$8,$8,$9,$9)`,
        params: [
          id,
          companyId,
          input.transactionType,
          input.counterpartyId,
          input.transactionDate,
          ubNumber,
          totalPkr,
          now,
          actorUserId,
        ],
      },
      ...lineStatements,
    ];
    const audit = auditStatement(
      companyId,
      actorUserId,
      "BOOKING_CREATED",
      id,
      `${input.transactionType} ${input.ubNumber} - PKR ${totalPkr}`,
      now,
    );
    if (audit) statements.push(audit);
    await runAtomicTransaction(statements);
  }

  await syncPackageBookingBundle(header, lineRows);
  return id;
}

export async function updatePackageCommercialBooking(
  companyId: string,
  bookingId: string,
  input: Pick<PackageCommercialInput, "transactionDate" | "lines">,
  actorUserId = "",
) {
  await requirePermission(companyId, actorUserId, "edit_bookings");
  if (!input.transactionDate) throw new Error("Date of Booking is required.");
  const { calculated, totalPkr } = calculateLines(input.lines);
  const now = new Date().toISOString();

  type CurrentBooking = {
    ub_number: string;
    status: string;
    created_at: string;
    transaction_type: string;
    counterparty_id: string;
    package_description?: string | null;
    departure_date?: string | null;
    return_date?: string | null;
    no_of_days?: number | null;
    ziarat_included?: string | null;
    customer_contact?: string | null;
    notes?: string | null;
    created_by_user_id?: string | null;
  };
  let current: CurrentBooking | null;

  if (isDesktopApp()) {
    const database = await db();
    const rows = await database.select<
      Array<{
        ub_number: string;
        status: string;
        created_at: string;
        transaction_type: string;
        counterparty_id: string;
        package_description: string | null;
        departure_date: string | null;
        return_date: string | null;
        no_of_days: number | null;
        ziarat_included: string | null;
        customer_contact: string | null;
        notes: string | null;
        created_by_user_id: string | null;
      }>
    >(
      `SELECT ub_number,status,created_at,transaction_type,counterparty_id,
              package_description,departure_date,return_date,no_of_days,ziarat_included,
              customer_contact,notes,created_by_user_id
       FROM package_bookings WHERE id=$1 AND company_id=$2 LIMIT 1`,
      [bookingId, companyId],
    );
    current = rows[0] || null;
  } else {
    const { data, error } = await supabase
      .from("package_bookings")
      .select(
        "ub_number,status,created_at,transaction_type,counterparty_id,package_description,departure_date,return_date,no_of_days,ziarat_included,customer_contact,notes,created_by_user_id",
      )
      .eq("id", bookingId)
      .eq("company_id", companyId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    current = data;
  }

  if (!current || current.status !== "ACTIVE") throw new Error("This Package booking is no longer active.");

  const lineRows = buildPackageLinePayloads(bookingId, calculated);
  const lineStatements = insertLineStatements(
    bookingId,
    lineRows.map((line) => ({
      id: line.id,
      passengerType: line.passenger_type as CalculatedLine["passengerType"],
      passengerName: line.passenger_name,
      packageType: line.package_type,
      ratePerPerson: line.rate_per_person,
      personCount: line.person_count,
      qtyIsExplicit: line.qty_is_explicit,
      lineTotalPkr: line.line_total_pkr,
      sortOrder: line.sort_order,
    })),
  );

  if (isDesktopApp()) {
    const statements: AtomicSqlStatement[] = [
      {
        sql: `UPDATE package_bookings SET transaction_date=$1,total_pkr=$2,updated_at=$3,updated_by_user_id=$4
          WHERE id=$5 AND company_id=$6 AND status='ACTIVE'`,
        params: [input.transactionDate, totalPkr, now, actorUserId, bookingId, companyId],
      },
      { sql: `DELETE FROM package_booking_lines WHERE booking_id=$1`, params: [bookingId] },
      ...lineStatements,
    ];
    const audit = auditStatement(
      companyId,
      actorUserId,
      "BOOKING_UPDATED",
      bookingId,
      `${current.ub_number} commercial Package details updated - PKR ${totalPkr}`,
      now,
    );
    if (audit) statements.push(audit);
    await runAtomicTransaction(statements);
  }

  await syncPackageBookingBundle(
    {
      id: bookingId,
      company_id: companyId,
      transaction_type: current.transaction_type,
      counterparty_id: current.counterparty_id,
      transaction_date: input.transactionDate,
      ub_number: current.ub_number,
      package_description: current.package_description || "",
      departure_date: current.departure_date || "",
      return_date: current.return_date || "",
      no_of_days: Math.max(0, Math.trunc(Number(current.no_of_days) || 0)),
      ziarat_included: current.ziarat_included || "",
      customer_contact: current.customer_contact || "",
      notes: current.notes || "",
      total_pkr: totalPkr,
      status: "ACTIVE",
      created_at: current.created_at,
      updated_at: now,
      created_by_user_id: current.created_by_user_id || actorUserId,
      updated_by_user_id: actorUserId,
    },
    lineRows,
  );
}

export async function updatePackageAdditionalDetails(
  companyId: string,
  bookingId: string,
  input: PackageAdditionalDetailsInput,
  actorUserId = "",
) {
  await requirePermission(companyId, actorUserId, "edit_bookings");
  if (input.departureDate && input.returnDate && input.returnDate < input.departureDate) {
    throw new Error("Travel End / Return Date cannot be before Travel Start Date.");
  }
  if (Number(input.noOfDays || 0) < 0) throw new Error("No. of Days cannot be negative.");
  if (!["", "YES", "NO"].includes(input.ziaratIncluded))
    throw new Error("Ziarat Included must be Yes, No, or left blank.");

  const now = new Date().toISOString();
  let current: {
    ub_number: string;
    status: string;
    created_at: string;
    transaction_type: string;
    counterparty_id: string;
    transaction_date: string;
    total_pkr: number;
    created_by_user_id?: string;
  } | null = null;

  if (isDesktopApp()) {
    const database = await db();
    const rows = await database.select<NonNullable<typeof current>[]>(
      `SELECT ub_number,status,created_at,transaction_type,counterparty_id,transaction_date,total_pkr,created_by_user_id
       FROM package_bookings WHERE id=$1 AND company_id=$2 LIMIT 1`,
      [bookingId, companyId],
    );
    current = rows[0] || null;
  } else {
    const { data, error } = await supabase
      .from("package_bookings")
      .select(
        "ub_number,status,created_at,transaction_type,counterparty_id,transaction_date,total_pkr,created_by_user_id",
      )
      .eq("id", bookingId)
      .eq("company_id", companyId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    current = data;
  }

  if (!current || current.status !== "ACTIVE") throw new Error("This Package booking is no longer active.");

  const details = {
    package_description: input.packageDescription.trim(),
    departure_date: input.departureDate,
    return_date: input.returnDate,
    no_of_days: Math.max(0, Math.trunc(Number(input.noOfDays) || 0)),
    ziarat_included: input.ziaratIncluded,
    customer_contact: input.customerContact.trim(),
    notes: input.notes.trim(),
    updated_at: now,
    updated_by_user_id: actorUserId,
  };

  if (isDesktopApp()) {
    const statements: AtomicSqlStatement[] = [
      {
        sql: `UPDATE package_bookings
          SET package_description=$1,departure_date=$2,return_date=$3,no_of_days=$4,
              ziarat_included=$5,customer_contact=$6,notes=$7,updated_at=$8,updated_by_user_id=$9
          WHERE id=$10 AND company_id=$11 AND status='ACTIVE'`,
        params: [
          details.package_description,
          details.departure_date,
          details.return_date,
          details.no_of_days,
          details.ziarat_included,
          details.customer_contact,
          details.notes,
          now,
          actorUserId,
          bookingId,
          companyId,
        ],
      },
    ];
    const audit = auditStatement(
      companyId,
      actorUserId,
      "BOOKING_DETAILS_UPDATED",
      bookingId,
      `${current.ub_number} additional Package details updated.`,
      now,
    );
    if (audit) statements.push(audit);
    await runAtomicTransaction(statements);
  }

  await queueSync("UPSERT", "package_bookings", bookingId, {
    id: bookingId,
    company_id: companyId,
    transaction_type: current.transaction_type,
    counterparty_id: current.counterparty_id,
    transaction_date: current.transaction_date,
    ub_number: current.ub_number,
    total_pkr: current.total_pkr,
    status: "ACTIVE",
    created_at: current.created_at,
    created_by_user_id: current.created_by_user_id || actorUserId,
    ...details,
  });
}
