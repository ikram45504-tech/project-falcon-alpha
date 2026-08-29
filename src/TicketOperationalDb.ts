import Database from "@tauri-apps/plugin-sql";
import type { TicketPassengerType } from "./db";
import { hasPermission, type UserRole } from "./permissions";
import { flushDesktopSyncQueue, isDesktopApp, queueSync, syncTicketOperationalBundle } from "./cloudSync";
import { supabase } from "./supabaseClient";

const DB_PATH = "sqlite:travel-accounting.db";
let databasePromise: Promise<Database> | null = null;
let tablesPromise: Promise<void> | null = null;

export type TicketJourney = "OUTBOUND" | "RETURN";
export type TicketJourneyFlightType = "DIRECT" | "INDIRECT";

export type TicketOperationalPassenger = {
  id: string;
  passengerType: TicketPassengerType;
  givenName: string;
  surname: string;
  passportNumber: string;
  eticketNumber: string;
  passportExpiry: string;
  sortOrder: number;
};

export type TicketOperationalFlight = {
  id: string;
  journey: TicketJourney;
  flightType: TicketJourneyFlightType;
  departureDate: string;
  airlineName: string;
  pnr: string;
  flightNo: string;
  fromAirport: string;
  stopoverAirport: string;
  toAirport: string;
  originDeparture: string;
  stopoverDepartureDate: string;
  stopoverDepartureTime: string;
  destinationArrival: string;
  sortOrder: number;
};

export type TicketOperationalDetails = {
  passengers: TicketOperationalPassenger[];
  flights: TicketOperationalFlight[];
  notes: string;
};

export type SaveTicketOperationalInput = {
  passengers: Array<Omit<TicketOperationalPassenger, "id" | "sortOrder">>;
  flights: Array<Omit<TicketOperationalFlight, "id" | "sortOrder">>;
  notes: string;
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

async function ensureTables() {
  if (!tablesPromise) {
    tablesPromise = (async () => {
      const database = await db();
      await database.execute("PRAGMA busy_timeout = 5000");
      await database.execute(`CREATE TABLE IF NOT EXISTS ticket_operational_meta (
        booking_id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        notes TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`);
      await database.execute(`CREATE TABLE IF NOT EXISTS ticket_operational_passengers (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        booking_id TEXT NOT NULL,
        passenger_type TEXT NOT NULL,
        given_name TEXT NOT NULL DEFAULT '',
        surname TEXT NOT NULL DEFAULT '',
        passport_number TEXT NOT NULL DEFAULT '',
        eticket_number TEXT NOT NULL DEFAULT '',
        passport_expiry TEXT NOT NULL DEFAULT '',
        sort_order INTEGER NOT NULL DEFAULT 0
      )`);
      await database.execute(`CREATE TABLE IF NOT EXISTS ticket_operational_flights (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        booking_id TEXT NOT NULL,
        journey TEXT NOT NULL,
        flight_type TEXT NOT NULL DEFAULT 'DIRECT',
        departure_date TEXT NOT NULL DEFAULT '',
        airline_name TEXT NOT NULL DEFAULT '',
        pnr TEXT NOT NULL DEFAULT '',
        flight_no TEXT NOT NULL DEFAULT '',
        from_airport TEXT NOT NULL DEFAULT '',
        stopover_airport TEXT NOT NULL DEFAULT '',
        to_airport TEXT NOT NULL DEFAULT '',
        origin_departure TEXT NOT NULL DEFAULT '',
        stopover_departure_date TEXT NOT NULL DEFAULT '',
        stopover_departure_time TEXT NOT NULL DEFAULT '',
        destination_arrival TEXT NOT NULL DEFAULT '',
        sort_order INTEGER NOT NULL DEFAULT 0
      )`);
      await database.execute(
        `CREATE INDEX IF NOT EXISTS idx_ticket_operational_passengers_booking ON ticket_operational_passengers(company_id,booking_id,sort_order)`,
      );
      await database.execute(
        `CREATE INDEX IF NOT EXISTS idx_ticket_operational_flights_booking ON ticket_operational_flights(company_id,booking_id,sort_order)`,
      );
    })().catch((error) => {
      tablesPromise = null;
      throw error;
    });
  }
  return tablesPromise;
}

async function requireEdit(companyId: string, userId: string) {
  if (!userId) return;
  const database = await db();
  const rows = await database.select<Array<{ role: UserRole; status: string }>>(
    `SELECT role,status FROM users WHERE id=$1 AND company_id=$2 LIMIT 1`,
    [userId, companyId],
  );
  const actor = rows[0];
  if (!actor || actor.status !== "ACTIVE" || !hasPermission(actor.role, "edit_bookings"))
    throw new Error("You do not have permission to edit booking details.");
}

async function audit(companyId: string, userId: string, bookingId: string) {
  if (!userId) return;
  const database = await db();
  const users = await database.select<Array<{ full_name: string }>>(
    `SELECT full_name FROM users WHERE id=$1 AND company_id=$2 LIMIT 1`,
    [userId, companyId],
  );
  await database.execute(
    `INSERT INTO audit_logs (id,company_id,user_id,user_name,action,module,record_id,details,created_at)
     VALUES ($1,$2,$3,$4,'BOOKING_DETAILS_UPDATED','TICKET',$5,$6,$7)`,
    [
      crypto.randomUUID(),
      companyId,
      userId,
      users[0]?.full_name || "Unknown User",
      bookingId,
      "Ticket passenger and flight details updated without changing fare totals.",
      new Date().toISOString(),
    ],
  );
}

export async function getTicketOperationalDetails(
  companyId: string,
  bookingId: string,
): Promise<TicketOperationalDetails> {
  await ensureTables();

  if (!isDesktopApp()) {
    const [passengersRes, flightsRes, metaRes] = await Promise.all([
      supabase
        .from("ticket_operational_passengers")
        .select("id,passenger_type,given_name,surname,passport_number,eticket_number,passport_expiry,sort_order")
        .eq("company_id", companyId)
        .eq("booking_id", bookingId)
        .order("sort_order", { ascending: true }),
      supabase
        .from("ticket_operational_flights")
        .select(
          "id,journey,flight_type,departure_date,airline_name,pnr,flight_no,from_airport,stopover_airport,to_airport,origin_departure,stopover_departure_date,stopover_departure_time,destination_arrival,sort_order",
        )
        .eq("company_id", companyId)
        .eq("booking_id", bookingId)
        .order("sort_order", { ascending: true }),
      supabase
        .from("ticket_operational_meta")
        .select("notes")
        .eq("company_id", companyId)
        .eq("booking_id", bookingId)
        .maybeSingle(),
    ]);
    if (passengersRes.error) throw new Error(passengersRes.error.message);
    if (flightsRes.error) throw new Error(flightsRes.error.message);
    if (metaRes.error) throw new Error(metaRes.error.message);
    return {
      passengers: (passengersRes.data || []).map((row) => ({
        id: row.id,
        passengerType: row.passenger_type as TicketPassengerType,
        givenName: row.given_name,
        surname: row.surname,
        passportNumber: row.passport_number,
        eticketNumber: row.eticket_number,
        passportExpiry: row.passport_expiry,
        sortOrder: row.sort_order,
      })),
      flights: (flightsRes.data || []).map((row) => ({
        id: row.id,
        journey: row.journey as TicketJourney,
        flightType: row.flight_type === "INDIRECT" ? "INDIRECT" : "DIRECT",
        departureDate: row.departure_date,
        airlineName: row.airline_name,
        pnr: row.pnr,
        flightNo: row.flight_no,
        fromAirport: row.from_airport,
        stopoverAirport: row.stopover_airport,
        toAirport: row.to_airport,
        originDeparture: row.origin_departure,
        stopoverDepartureDate: row.stopover_departure_date,
        stopoverDepartureTime: row.stopover_departure_time,
        destinationArrival: row.destination_arrival,
        sortOrder: row.sort_order,
      })),
      notes: metaRes.data?.notes || "",
    };
  }

  const database = await db();
  const passengers = await database.select<
    Array<{
      id: string;
      passenger_type: TicketPassengerType;
      given_name: string;
      surname: string;
      passport_number: string;
      eticket_number: string;
      passport_expiry: string;
      sort_order: number;
    }>
  >(
    `SELECT id,passenger_type,given_name,surname,passport_number,eticket_number,passport_expiry,sort_order FROM ticket_operational_passengers WHERE company_id=$1 AND booking_id=$2 ORDER BY sort_order`,
    [companyId, bookingId],
  );
  const flights = await database.select<
    Array<{
      id: string;
      journey: TicketJourney;
      flight_type: TicketJourneyFlightType;
      departure_date: string;
      airline_name: string;
      pnr: string;
      flight_no: string;
      from_airport: string;
      stopover_airport: string;
      to_airport: string;
      origin_departure: string;
      stopover_departure_date: string;
      stopover_departure_time: string;
      destination_arrival: string;
      sort_order: number;
    }>
  >(
    `SELECT id,journey,flight_type,departure_date,airline_name,pnr,flight_no,from_airport,stopover_airport,to_airport,origin_departure,stopover_departure_date,stopover_departure_time,destination_arrival,sort_order FROM ticket_operational_flights WHERE company_id=$1 AND booking_id=$2 ORDER BY sort_order`,
    [companyId, bookingId],
  );
  const meta = await database.select<Array<{ notes: string }>>(
    `SELECT notes FROM ticket_operational_meta WHERE company_id=$1 AND booking_id=$2 LIMIT 1`,
    [companyId, bookingId],
  );
  return {
    passengers: passengers.map((row) => ({
      id: row.id,
      passengerType: row.passenger_type,
      givenName: row.given_name,
      surname: row.surname,
      passportNumber: row.passport_number,
      eticketNumber: row.eticket_number,
      passportExpiry: row.passport_expiry,
      sortOrder: row.sort_order,
    })),
    flights: flights.map((row) => ({
      id: row.id,
      journey: row.journey,
      flightType: row.flight_type === "INDIRECT" ? "INDIRECT" : "DIRECT",
      departureDate: row.departure_date,
      airlineName: row.airline_name,
      pnr: row.pnr,
      flightNo: row.flight_no,
      fromAirport: row.from_airport,
      stopoverAirport: row.stopover_airport,
      toAirport: row.to_airport,
      originDeparture: row.origin_departure,
      stopoverDepartureDate: row.stopover_departure_date,
      stopoverDepartureTime: row.stopover_departure_time,
      destinationArrival: row.destination_arrival,
      sortOrder: row.sort_order,
    })),
    notes: meta[0]?.notes || "",
  };
}

export async function saveTicketOperationalDetails(
  companyId: string,
  bookingId: string,
  input: SaveTicketOperationalInput,
  userId = "",
) {
  await requireEdit(companyId, userId);
  await ensureTables();
  const now = new Date().toISOString();

  const passengers = input.passengers.map((passenger, index) => ({
    id: crypto.randomUUID(),
    company_id: companyId,
    booking_id: bookingId,
    passenger_type: passenger.passengerType,
    given_name: passenger.givenName.trim(),
    surname: passenger.surname.trim(),
    passport_number: passenger.passportNumber.trim().toUpperCase(),
    eticket_number: passenger.eticketNumber.trim().toUpperCase(),
    passport_expiry: passenger.passportExpiry,
    sort_order: index,
  }));
  const flights = input.flights.map((flight, index) => ({
    id: crypto.randomUUID(),
    company_id: companyId,
    booking_id: bookingId,
    journey: flight.journey,
    flight_type: flight.flightType,
    departure_date: flight.departureDate,
    airline_name: flight.airlineName.trim(),
    pnr: flight.pnr.trim().toUpperCase(),
    flight_no: flight.flightNo.trim().toUpperCase(),
    from_airport: flight.fromAirport.trim().toUpperCase(),
    stopover_airport: flight.flightType === "INDIRECT" ? flight.stopoverAirport.trim().toUpperCase() : "",
    to_airport: flight.toAirport.trim().toUpperCase(),
    origin_departure: flight.originDeparture,
    stopover_departure_date: flight.flightType === "INDIRECT" ? flight.stopoverDepartureDate : "",
    stopover_departure_time: flight.flightType === "INDIRECT" ? flight.stopoverDepartureTime : "",
    destination_arrival: flight.destinationArrival,
    sort_order: index,
  }));

  if (isDesktopApp()) {
    const database = await db();
    await database.execute(`DELETE FROM ticket_operational_passengers WHERE company_id=$1 AND booking_id=$2`, [
      companyId,
      bookingId,
    ]);
    await database.execute(`DELETE FROM ticket_operational_flights WHERE company_id=$1 AND booking_id=$2`, [
      companyId,
      bookingId,
    ]);
    for (const passenger of passengers) {
      await database.execute(
        `INSERT INTO ticket_operational_passengers (id,company_id,booking_id,passenger_type,given_name,surname,passport_number,eticket_number,passport_expiry,sort_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          passenger.id,
          passenger.company_id,
          passenger.booking_id,
          passenger.passenger_type,
          passenger.given_name,
          passenger.surname,
          passenger.passport_number,
          passenger.eticket_number,
          passenger.passport_expiry,
          passenger.sort_order,
        ],
      );
    }
    for (const flight of flights) {
      await database.execute(
        `INSERT INTO ticket_operational_flights (id,company_id,booking_id,journey,flight_type,departure_date,airline_name,pnr,flight_no,from_airport,stopover_airport,to_airport,origin_departure,stopover_departure_date,stopover_departure_time,destination_arrival,sort_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
        [
          flight.id,
          flight.company_id,
          flight.booking_id,
          flight.journey,
          flight.flight_type,
          flight.departure_date,
          flight.airline_name,
          flight.pnr,
          flight.flight_no,
          flight.from_airport,
          flight.stopover_airport,
          flight.to_airport,
          flight.origin_departure,
          flight.stopover_departure_date,
          flight.stopover_departure_time,
          flight.destination_arrival,
          flight.sort_order,
        ],
      );
    }
    await database.execute(
      `INSERT INTO ticket_operational_meta (booking_id,company_id,notes,created_at,updated_at) VALUES ($1,$2,$3,$4,$4)
       ON CONFLICT(booking_id) DO UPDATE SET company_id=excluded.company_id,notes=excluded.notes,updated_at=excluded.updated_at`,
      [bookingId, companyId, input.notes.trim(), now],
    );
    await audit(companyId, userId, bookingId);
  }

  await syncTicketOperationalBundle(bookingId, companyId, {
    notes: input.notes.trim(),
    createdAt: now,
    updatedAt: now,
    passengers,
    flights,
  });
  await queueSync("UPDATE", "ticket_bookings", bookingId, { updated_at: now });
  if (isDesktopApp()) await flushDesktopSyncQueue();
}
