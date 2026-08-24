import Database from "@tauri-apps/plugin-sql";
import type { BookingTransactionType, TicketPassengerType } from "./db";
import { runAtomicTransaction, type AtomicSqlStatement } from "./DatabaseSafety";

const DB_PATH = "sqlite:travel-accounting.db";
let databasePromise: Promise<Database> | null = null;
let schemaPromise: Promise<void> | null = null;

export type TicketFareFlightType = "ONE_WAY" | "RETURN" | "MULTI_CITY";

export type TicketCommercialLineInput = {
  passengerType: TicketPassengerType;
  passengerName: string;
  airlineName: string;
  pnr: string;
  flightType: TicketFareFlightType;
  ticketRoute: string;
  ratePerTicket: number;
  ticketCount: number;
  legacyEticketReference?: string;
};

export type TicketCommercialLine = {
  id: string;
  booking_id: string;
  passenger_type: TicketPassengerType;
  passenger_name: string;
  airline_name: string;
  pnr: string;
  flight_type: TicketFareFlightType;
  ticket_route: string;
  eticket_reference: string;
  rate_per_ticket: number;
  ticket_count: number;
  qty_is_explicit: number;
  line_total_pkr: number;
  sort_order: number;
};

export type TicketCommercialBooking = {
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
  ticket_status: string;
  customer_contact: string;
  notes: string;
  total_pkr: number;
  status: "ACTIVE" | "VOID";
  created_at: string;
  updated_at: string;
  lines: TicketCommercialLine[];
};

export type TicketCommercialInput = {
  transactionType: BookingTransactionType;
  counterpartyId: string;
  transactionDate: string;
  ubNumber: string;
  lines: TicketCommercialLineInput[];
};

type CalculatedLine = TicketCommercialLineInput & {
  lineTotalPkr: number;
  sortOrder: number;
};

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

async function ensureColumn(table: string, column: string, definition: string) {
  const database = await db();
  const rows = await database.select<Array<{ name: string }>>(`PRAGMA table_info(${table})`);
  if (rows.some((row) => row.name.toLowerCase() === column.toLowerCase())) return;
  try {
    await database.execute(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  } catch (error) {
    if (String(error).toLowerCase().includes("duplicate column name")) return;
    throw error;
  }
}

async function ensureSchema() {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      const database = await db();
      await database.execute("PRAGMA busy_timeout = 5000");
      await ensureColumn("ticket_booking_lines", "airline_name", "TEXT NOT NULL DEFAULT ''");
      await ensureColumn("ticket_booking_lines", "pnr", "TEXT NOT NULL DEFAULT ''");
      await ensureColumn("ticket_booking_lines", "flight_type", "TEXT NOT NULL DEFAULT 'RETURN'");
      await ensureColumn("ticket_booking_lines", "ticket_route", "TEXT NOT NULL DEFAULT ''");
    })().catch((error) => {
      schemaPromise = null;
      throw error;
    });
  }
  return schemaPromise;
}

import { requirePermission } from "./db";
function auditStatement(
  companyId: string,
  userId: string,
  action: string,
  bookingId: string,
  details: string,
  now: string,
): AtomicSqlStatement | null {
  if (!userId) return null;
  return {
    sql: `INSERT INTO audit_logs (id,company_id,user_id,user_name,action,module,record_id,details,created_at)
      VALUES ($1,$2,$3,
        COALESCE((SELECT full_name FROM users WHERE id=$3 AND company_id=$2 LIMIT 1),'Unknown User'),
        $4,'TICKET',$5,$6,$7)`,
    params: [crypto.randomUUID(), companyId, userId, action, bookingId, details, now],
  };
}

function normalizeUb(value: string) {
  return value.trim().toUpperCase();
}

function validateUb(value: string) {
  if (!/^UB-\d{4}$/.test(normalizeUb(value))) throw new Error("Booking number must be assigned in UB-0000 format.");
}

async function validateCounterparty(
  companyId: string,
  transactionType: BookingTransactionType,
  counterpartyId: string,
) {
  if (!counterpartyId)
    throw new Error(transactionType === "SALE" ? "Select a Party / Customer." : "Select a Vendor / Supplier.");
  const database = await db();
  const rows = await database.select<Array<{ account_type: string; status: string }>>(
    `SELECT account_type,status FROM parties WHERE id=$1 AND company_id=$2 LIMIT 1`,
    [counterpartyId, companyId],
  );
  const expected = transactionType === "SALE" ? "PARTY" : "VENDOR";
  if (!rows[0] || rows[0].status !== "ACTIVE" || rows[0].account_type !== expected) {
    throw new Error(
      transactionType === "SALE" ? "Select an active Party / Customer." : "Select an active Vendor / Supplier.",
    );
  }
}

async function validateUbAvailability(
  companyId: string,
  transactionType: BookingTransactionType,
  counterpartyId: string,
  ubNumber: string,
) {
  const database = await db();
  const rows = await database.select<
    Array<{ transaction_type: BookingTransactionType; counterparty_id: string; ub_number: string }>
  >(`SELECT transaction_type,counterparty_id,ub_number FROM ticket_bookings WHERE company_id=$1`, [companyId]);
  const normalized = normalizeUb(ubNumber);
  const duplicate = rows.find(
    (row) =>
      normalizeUb(row.ub_number) === normalized &&
      (transactionType === "SALE"
        ? row.transaction_type === "SALE"
        : row.transaction_type === "PURCHASE" && row.counterparty_id === counterpartyId),
  );
  if (!duplicate) return;
  if (transactionType === "SALE")
    throw new Error(`${ubNumber} already has a Ticket Sale booking. Open it from the Ticket Register.`);
  throw new Error(
    `This Vendor already has a Ticket Purchase booking for ${ubNumber}. Open it from the Ticket Register.`,
  );
}

function calculateLines(lines: TicketCommercialLineInput[]) {
  if (!lines.length) throw new Error("Add at least one Ticket row.");
  const allowedFlightTypes: TicketFareFlightType[] = ["ONE_WAY", "RETURN", "MULTI_CITY"];
  const calculated: CalculatedLine[] = lines.map((line, index) => {
    if (!["ADULT", "CHILD", "INFANT"].includes(line.passengerType))
      throw new Error(`Ticket row ${index + 1}: select Adult, Child or Infant.`);
    const passengerName = line.passengerName.trim();
    const airlineName = line.airlineName.trim();
    const pnr = line.pnr.trim().toUpperCase();
    const ticketRoute = line.ticketRoute.trim().toUpperCase();
    const ratePerTicket = Number(line.ratePerTicket);
    const ticketCount = Math.trunc(Number(line.ticketCount));
    if (!passengerName) throw new Error(`Ticket row ${index + 1}: Passenger / Family Head is required.`);
    if (!airlineName) throw new Error(`Ticket row ${index + 1}: Airline is required.`);
    if (!allowedFlightTypes.includes(line.flightType))
      throw new Error(`Ticket row ${index + 1}: select a Flight Type.`);
    if (!ticketRoute) throw new Error(`Ticket row ${index + 1}: Ticket Route is required.`);
    if (!Number.isFinite(ratePerTicket))
      throw new Error(`Ticket row ${index + 1}: Rate / Ticket must be a valid number.`);
    if (!Number.isFinite(ticketCount) || ticketCount < 1)
      throw new Error(`Ticket row ${index + 1}: Qty must be at least 1.`);
    return {
      passengerType: line.passengerType,
      passengerName,
      airlineName,
      pnr,
      flightType: line.flightType,
      ticketRoute,
      ratePerTicket,
      ticketCount,
      legacyEticketReference: line.legacyEticketReference || "",
      lineTotalPkr: ratePerTicket * ticketCount,
      sortOrder: index,
    };
  });
  return { calculated, totalPkr: calculated.reduce((sum, line) => sum + line.lineTotalPkr, 0) };
}

function lineStatements(bookingId: string, lines: CalculatedLine[]) {
  return lines.map<AtomicSqlStatement>((line) => ({
    sql: `INSERT INTO ticket_booking_lines
      (id,booking_id,passenger_type,passenger_name,airline_name,pnr,flight_type,ticket_route,eticket_reference,rate_per_ticket,ticket_count,qty_is_explicit,line_total_pkr,sort_order)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,1,$12,$13)`,
    params: [
      crypto.randomUUID(),
      bookingId,
      line.passengerType,
      line.passengerName,
      line.airlineName,
      line.pnr,
      line.flightType,
      line.ticketRoute,
      line.legacyEticketReference || "",
      line.ratePerTicket,
      line.ticketCount,
      line.lineTotalPkr,
      line.sortOrder,
    ],
  }));
}

export async function getTicketCommercialBookings(companyId: string, search = "") {
  const isTauri = "__TAURI_INTERNALS__" in window;
  if (!isTauri) {
    const { supabase } = await import("./supabaseClient");
    let query = supabase
      .from("ticket_bookings")
      .select(
        `
        *,
        ticket_booking_lines(*),
        parties(name)
      `,
      )
      .eq("company_id", companyId)
      .order("transaction_date", { ascending: false })
      .order("created_at", { ascending: false });

    if (search.trim()) {
      const term = `%${search.trim()}%`;
      query = query.or(`ub_number.ilike.${term}`);
    }

    const { data } = await query;
    if (!data) return [];

    return data.map((b: any) => ({
      ...b,
      counterparty_name: b.parties?.name || "",
      lines: b.ticket_booking_lines || [],
    })) as TicketCommercialBooking[];
  }

  await ensureSchema();
  const database = await db();
  const clean = search.trim();
  const term = `%${clean}%`;
  const headers = await database.select<Array<Omit<TicketCommercialBooking, "lines">>>(
    `SELECT b.id,b.company_id,b.transaction_type,b.counterparty_id,COALESCE(p.name,'') AS counterparty_name,
            b.transaction_date,b.ub_number,b.airline_name,b.pnr,b.sector,b.departure_date,b.return_date,b.flight_no,b.departure_time,b.arrival_time,b.baggage,b.ticket_status,b.customer_contact,b.notes,b.total_pkr,b.status,b.created_at,b.updated_at
     FROM ticket_bookings b
     LEFT JOIN parties p ON p.id=b.counterparty_id AND p.company_id=b.company_id
     WHERE b.company_id=$1 AND ($2='' OR b.ub_number LIKE $3 COLLATE NOCASE OR COALESCE(p.name,'') LIKE $3 COLLATE NOCASE OR EXISTS (
       SELECT 1 FROM ticket_booking_lines l WHERE l.booking_id=b.id AND (l.passenger_name LIKE $3 COLLATE NOCASE OR l.airline_name LIKE $3 COLLATE NOCASE OR l.pnr LIKE $3 COLLATE NOCASE OR l.ticket_route LIKE $3 COLLATE NOCASE)
     ))
     ORDER BY b.transaction_date DESC,b.created_at DESC`,
    [companyId, clean, term],
  );
  const lines = await database.select<
    Array<
      TicketCommercialLine & {
        legacy_airline: string;
        legacy_pnr: string;
        legacy_route: string;
        legacy_return_date: string;
      }
    >
  >(
    `SELECT l.id,l.booking_id,l.passenger_type,l.passenger_name,l.airline_name,l.pnr,l.flight_type,l.ticket_route,l.eticket_reference,l.rate_per_ticket,l.ticket_count,l.qty_is_explicit,l.line_total_pkr,l.sort_order,
            b.airline_name AS legacy_airline,b.pnr AS legacy_pnr,b.sector AS legacy_route,b.return_date AS legacy_return_date
     FROM ticket_booking_lines l INNER JOIN ticket_bookings b ON b.id=l.booking_id WHERE b.company_id=$1 ORDER BY l.sort_order`,
    [companyId],
  );
  const grouped = new Map<string, TicketCommercialLine[]>();
  for (const line of lines) {
    const normalizedType: TicketFareFlightType =
      line.flight_type === "ONE_WAY" || line.flight_type === "MULTI_CITY" || line.flight_type === "RETURN"
        ? line.flight_type
        : line.legacy_return_date
          ? "RETURN"
          : "ONE_WAY";
    const normalizedLine: TicketCommercialLine = {
      ...line,
      airline_name: line.airline_name || line.legacy_airline || "",
      pnr: line.pnr || line.legacy_pnr || "",
      flight_type: normalizedType,
      ticket_route: line.ticket_route || line.legacy_route || "",
    };
    const current = grouped.get(line.booking_id) || [];
    current.push(normalizedLine);
    grouped.set(line.booking_id, current);
  }
  return headers.map((header) => ({ ...header, lines: grouped.get(header.id) || [] })) as TicketCommercialBooking[];
}

export async function createTicketCommercialBooking(companyId: string, input: TicketCommercialInput, actorUserId = "") {
  await ensureSchema();
  await requirePermission(companyId, actorUserId, "create_bookings");
  if (!["SALE", "PURCHASE"].includes(input.transactionType)) throw new Error("Select Sale or Purchase first.");
  if (!input.transactionDate) throw new Error("Date of Booking is required.");
  validateUb(input.ubNumber);
  await validateCounterparty(companyId, input.transactionType, input.counterpartyId);
  await validateUbAvailability(companyId, input.transactionType, input.counterpartyId, input.ubNumber);
  const { calculated, totalPkr } = calculateLines(input.lines);
  const first = calculated[0];
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const statements: AtomicSqlStatement[] = [
    {
      sql: `INSERT INTO ticket_bookings
        (id,company_id,transaction_type,counterparty_id,transaction_date,ub_number,airline_name,pnr,sector,departure_date,return_date,flight_no,departure_time,arrival_time,baggage,ticket_status,customer_contact,notes,total_pkr,status,created_at,updated_at,created_by_user_id,updated_by_user_id)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'','','','','','','','','',$10,'ACTIVE',$11,$11,$12,$12)`,
      params: [
        id,
        companyId,
        input.transactionType,
        input.counterpartyId,
        input.transactionDate,
        normalizeUb(input.ubNumber),
        first.airlineName,
        first.pnr,
        first.ticketRoute,
        totalPkr,
        now,
        actorUserId,
      ],
    },
    ...lineStatements(id, calculated),
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
  return id;
}

export async function updateTicketCommercialBooking(
  companyId: string,
  bookingId: string,
  input: Pick<TicketCommercialInput, "transactionDate" | "lines">,
  actorUserId = "",
) {
  await ensureSchema();
  await requirePermission(companyId, actorUserId, "edit_bookings");
  if (!input.transactionDate) throw new Error("Date of Booking is required.");
  const { calculated, totalPkr } = calculateLines(input.lines);
  const first = calculated[0];
  const database = await db();
  const rows = await database.select<Array<{ ub_number: string; status: string }>>(
    `SELECT ub_number,status FROM ticket_bookings WHERE id=$1 AND company_id=$2 LIMIT 1`,
    [bookingId, companyId],
  );
  if (!rows[0] || rows[0].status !== "ACTIVE") throw new Error("This Ticket booking is no longer active.");
  const now = new Date().toISOString();
  const statements: AtomicSqlStatement[] = [
    {
      sql: `UPDATE ticket_bookings SET transaction_date=$1,airline_name=$2,pnr=$3,sector=$4,total_pkr=$5,updated_at=$6,updated_by_user_id=$7 WHERE id=$8 AND company_id=$9 AND status='ACTIVE'`,
      params: [
        input.transactionDate,
        first.airlineName,
        first.pnr,
        first.ticketRoute,
        totalPkr,
        now,
        actorUserId,
        bookingId,
        companyId,
      ],
    },
    { sql: `DELETE FROM ticket_booking_lines WHERE booking_id=$1`, params: [bookingId] },
    ...lineStatements(bookingId, calculated),
  ];
  const audit = auditStatement(
    companyId,
    actorUserId,
    "BOOKING_UPDATED",
    bookingId,
    `${rows[0].ub_number} Ticket commercial details updated - PKR ${totalPkr}`,
    now,
  );
  if (audit) statements.push(audit);
  await runAtomicTransaction(statements);
}

export async function voidTicketCommercialBooking(companyId: string, bookingId: string, actorUserId = "") {
  await ensureSchema();
  await requirePermission(companyId, actorUserId, "void_bookings");
  const database = await db();
  const rows = await database.select<Array<{ ub_number: string }>>(
    `SELECT ub_number FROM ticket_bookings WHERE id=$1 AND company_id=$2 LIMIT 1`,
    [bookingId, companyId],
  );
  const now = new Date().toISOString();
  const statements: AtomicSqlStatement[] = [
    {
      sql: `UPDATE ticket_bookings SET status='VOID',updated_at=$1,updated_by_user_id=$2 WHERE id=$3 AND company_id=$4 AND status='ACTIVE'`,
      params: [now, actorUserId, bookingId, companyId],
    },
  ];
  const audit = auditStatement(
    companyId,
    actorUserId,
    "BOOKING_VOIDED",
    bookingId,
    `Ticket booking ${rows[0]?.ub_number || bookingId} voided.`,
    now,
  );
  if (audit) statements.push(audit);
  await runAtomicTransaction(statements);
}
