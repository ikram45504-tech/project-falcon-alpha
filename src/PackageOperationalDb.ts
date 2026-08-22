import Database from "@tauri-apps/plugin-sql";
import type { PackagePassengerType } from "./db";

const DB_PATH = "sqlite:travel-accounting.db";
let databasePromise: Promise<Database> | null = null;
let tablesReady: Promise<void> | null = null;

export type PackageFlightType = "DIRECT" | "INDIRECT";
export type PackageFlightJourney = "OUTBOUND" | "RETURN";

export type PackageOperationalPassenger = {
  id: string;
  passengerType: PackagePassengerType;
  givenName: string;
  surname: string;
  passportNumber: string;
  visaNumber: string;
  passportExpiry: string;
  sortOrder: number;
};
export type PackageOperationalHotel = {
  id: string;
  cityName: string;
  hotelName: string;
  checkIn: string;
  checkOut: string;
  nights: number;
  sortOrder: number;
};
export type PackageOperationalFlight = {
  id: string;
  journey: PackageFlightJourney;
  flightType: PackageFlightType;
  departureDate: string;
  pnr: string;
  flightNo: string;
  fromAirport: string;
  toAirport: string;
  departureTime: string;
  arrivalTime: string;
  sortOrder: number;
};
export type PackageOperationalStopover = {
  id: string;
  journey: PackageFlightJourney;
  airport: string;
  departureDate: string;
  departureTime: string;
  sortOrder: number;
};
export type PackageMovementEvent = {
  id: string;
  eventType: string;
  eventDate: string;
  eventTime: string;
  fromLocation: string;
  toLocation: string;
  description: string;
  sortOrder: number;
};
export type PackageOperationalDetails = {
  passengers: PackageOperationalPassenger[];
  hotels: PackageOperationalHotel[];
  flights: PackageOperationalFlight[];
  stopovers: PackageOperationalStopover[];
  movementEvents: PackageMovementEvent[];
  notes: string;
};
export type SavePackageOperationalInput = {
  passengers: Array<Omit<PackageOperationalPassenger, "id" | "sortOrder">>;
  hotels: Array<Omit<PackageOperationalHotel, "id" | "sortOrder">>;
  flights: Array<Omit<PackageOperationalFlight, "id" | "sortOrder">>;
  stopovers: Array<Omit<PackageOperationalStopover, "id" | "sortOrder">>;
  notes: string;
};

async function db() {
  if (!databasePromise) databasePromise = Database.load(DB_PATH);
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

async function ensureTables() {
  if (!tablesReady) {
    tablesReady = (async () => {
      const database = await db();
      await database.execute("PRAGMA busy_timeout = 5000");
      await database.execute(
        `CREATE TABLE IF NOT EXISTS package_operational_meta (booking_id TEXT PRIMARY KEY,company_id TEXT NOT NULL,notes TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL,updated_at TEXT NOT NULL)`,
      );
      await database.execute(
        `CREATE TABLE IF NOT EXISTS package_operational_passengers (id TEXT PRIMARY KEY,company_id TEXT NOT NULL,booking_id TEXT NOT NULL,passenger_type TEXT NOT NULL,given_name TEXT NOT NULL DEFAULT '',surname TEXT NOT NULL DEFAULT '',passport_number TEXT NOT NULL DEFAULT '',visa_number TEXT NOT NULL DEFAULT '',passport_expiry TEXT NOT NULL DEFAULT '',sort_order INTEGER NOT NULL DEFAULT 0)`,
      );
      await ensureColumn("package_operational_passengers", "passport_expiry", "TEXT NOT NULL DEFAULT ''");
      await database.execute(
        `CREATE TABLE IF NOT EXISTS package_operational_hotels (id TEXT PRIMARY KEY,company_id TEXT NOT NULL,booking_id TEXT NOT NULL,city_name TEXT NOT NULL DEFAULT '',hotel_name TEXT NOT NULL DEFAULT '',check_in TEXT NOT NULL DEFAULT '',check_out TEXT NOT NULL DEFAULT '',nights INTEGER NOT NULL DEFAULT 0,sort_order INTEGER NOT NULL DEFAULT 0)`,
      );
      await database.execute(
        `CREATE TABLE IF NOT EXISTS package_operational_flights (id TEXT PRIMARY KEY,company_id TEXT NOT NULL,booking_id TEXT NOT NULL,journey TEXT NOT NULL,flight_type TEXT NOT NULL DEFAULT 'DIRECT',departure_date TEXT NOT NULL DEFAULT '',pnr TEXT NOT NULL DEFAULT '',flight_no TEXT NOT NULL DEFAULT '',from_airport TEXT NOT NULL DEFAULT '',to_airport TEXT NOT NULL DEFAULT '',departure_time TEXT NOT NULL DEFAULT '',arrival_time TEXT NOT NULL DEFAULT '',sort_order INTEGER NOT NULL DEFAULT 0)`,
      );
      await ensureColumn("package_operational_flights", "flight_type", "TEXT NOT NULL DEFAULT 'DIRECT'");
      await database.execute(
        `CREATE TABLE IF NOT EXISTS package_operational_flight_stopovers (id TEXT PRIMARY KEY,company_id TEXT NOT NULL,booking_id TEXT NOT NULL,journey TEXT NOT NULL,airport TEXT NOT NULL DEFAULT '',departure_date TEXT NOT NULL DEFAULT '',departure_time TEXT NOT NULL DEFAULT '',sort_order INTEGER NOT NULL DEFAULT 0)`,
      );
      await database.execute(
        `CREATE TABLE IF NOT EXISTS package_movement_events (id TEXT PRIMARY KEY,company_id TEXT NOT NULL,booking_id TEXT NOT NULL,event_type TEXT NOT NULL DEFAULT '',event_date TEXT NOT NULL DEFAULT '',event_time TEXT NOT NULL DEFAULT '',from_location TEXT NOT NULL DEFAULT '',to_location TEXT NOT NULL DEFAULT '',description TEXT NOT NULL DEFAULT '',sort_order INTEGER NOT NULL DEFAULT 0)`,
      );
      await database.execute(
        `CREATE INDEX IF NOT EXISTS idx_package_operational_passengers_booking ON package_operational_passengers(company_id,booking_id,sort_order)`,
      );
      await database.execute(
        `CREATE INDEX IF NOT EXISTS idx_package_operational_hotels_booking ON package_operational_hotels(company_id,booking_id,sort_order)`,
      );
      await database.execute(
        `CREATE INDEX IF NOT EXISTS idx_package_operational_flights_booking ON package_operational_flights(company_id,booking_id,sort_order)`,
      );
      await database.execute(
        `CREATE INDEX IF NOT EXISTS idx_package_operational_stopovers_booking ON package_operational_flight_stopovers(company_id,booking_id,journey,sort_order)`,
      );
      await database.execute(
        `CREATE INDEX IF NOT EXISTS idx_package_movement_booking ON package_movement_events(company_id,booking_id,event_date,event_time,sort_order)`,
      );
    })().catch((error) => {
      tablesReady = null;
      throw error;
    });
  }
  return tablesReady;
}

function viaText(
  journey: PackageFlightJourney,
  stopovers: Array<Omit<PackageOperationalStopover, "id" | "sortOrder">>,
) {
  const airports = stopovers
    .filter((item) => item.journey === journey && item.airport.trim())
    .map((item) => item.airport.trim());
  return airports.length ? ` via ${airports.join(" → ")}` : "";
}

export function buildPackageMovementEvents(
  flights: Array<Omit<PackageOperationalFlight, "id" | "sortOrder">>,
  hotels: Array<Omit<PackageOperationalHotel, "id" | "sortOrder">>,
  stopovers: Array<Omit<PackageOperationalStopover, "id" | "sortOrder">> = [],
): Array<Omit<PackageMovementEvent, "id" | "sortOrder">> {
  const events: Array<Omit<PackageMovementEvent, "id" | "sortOrder">> = [];
  const outbound = flights.find((item) => item.journey === "OUTBOUND");
  const returning = flights.find((item) => item.journey === "RETURN");
  const orderedHotels = hotels
    .filter((item) => item.cityName.trim() || item.hotelName.trim() || item.checkIn || item.checkOut)
    .slice()
    .sort((a, b) => (a.checkIn || "9999-99-99").localeCompare(b.checkIn || "9999-99-99"));

  if (outbound?.departureDate)
    events.push({
      eventType: "OUTBOUND_DEPARTURE",
      eventDate: outbound.departureDate,
      eventTime: outbound.departureTime,
      fromLocation: outbound.fromAirport,
      toLocation: outbound.toAirport,
      description: `Outbound departure ${outbound.fromAirport || "origin"} → ${outbound.toAirport || "destination"}${viaText("OUTBOUND", stopovers)}`,
    });
  orderedHotels.forEach((hotel, index) => {
    if (!hotel.checkOut) return;
    const nextHotel = orderedHotels[index + 1];
    if (nextHotel) {
      events.push({
        eventType: "HOTEL_CHECKOUT_TRANSFER",
        eventDate: hotel.checkOut,
        eventTime: "",
        fromLocation: hotel.cityName,
        toLocation: nextHotel.cityName,
        description: `Hotel checkout and expected passenger movement ${hotel.cityName || "current city"} → ${nextHotel.cityName || "next city"}`,
      });
    } else {
      events.push({
        eventType: "FINAL_HOTEL_CHECKOUT",
        eventDate: hotel.checkOut,
        eventTime: "",
        fromLocation: hotel.cityName,
        toLocation: returning?.fromAirport || "",
        description: returning?.fromAirport
          ? `Final hotel checkout and expected airport movement ${hotel.cityName || "last hotel"} → ${returning.fromAirport}`
          : `Final hotel checkout from ${hotel.cityName || hotel.hotelName || "last hotel"}`,
      });
    }
  });
  if (returning?.departureDate)
    events.push({
      eventType: "RETURN_DEPARTURE",
      eventDate: returning.departureDate,
      eventTime: returning.departureTime,
      fromLocation: returning.fromAirport,
      toLocation: returning.toAirport,
      description: `Return departure ${returning.fromAirport || "origin"} → ${returning.toAirport || "home"}${viaText("RETURN", stopovers)}`,
    });
  return events
    .filter((item) => item.eventDate || item.fromLocation || item.toLocation)
    .sort((a, b) => `${a.eventDate} ${a.eventTime}`.localeCompare(`${b.eventDate} ${b.eventTime}`));
}

export async function getPackageOperationalDetails(
  companyId: string,
  bookingId: string,
): Promise<PackageOperationalDetails> {
  await ensureTables();
  const database = await db();
  const passengers = await database.select<
    Array<{
      id: string;
      passenger_type: PackagePassengerType;
      given_name: string;
      surname: string;
      passport_number: string;
      visa_number: string;
      passport_expiry: string;
      sort_order: number;
    }>
  >(
    `SELECT id,passenger_type,given_name,surname,passport_number,visa_number,passport_expiry,sort_order FROM package_operational_passengers WHERE company_id=$1 AND booking_id=$2 ORDER BY sort_order`,
    [companyId, bookingId],
  );
  const hotels = await database.select<
    Array<{
      id: string;
      city_name: string;
      hotel_name: string;
      check_in: string;
      check_out: string;
      nights: number;
      sort_order: number;
    }>
  >(
    `SELECT id,city_name,hotel_name,check_in,check_out,nights,sort_order FROM package_operational_hotels WHERE company_id=$1 AND booking_id=$2 ORDER BY sort_order`,
    [companyId, bookingId],
  );
  const flights = await database.select<
    Array<{
      id: string;
      journey: PackageFlightJourney;
      flight_type: PackageFlightType;
      departure_date: string;
      pnr: string;
      flight_no: string;
      from_airport: string;
      to_airport: string;
      departure_time: string;
      arrival_time: string;
      sort_order: number;
    }>
  >(
    `SELECT id,journey,flight_type,departure_date,pnr,flight_no,from_airport,to_airport,departure_time,arrival_time,sort_order FROM package_operational_flights WHERE company_id=$1 AND booking_id=$2 ORDER BY sort_order`,
    [companyId, bookingId],
  );
  const stopovers = await database.select<
    Array<{
      id: string;
      journey: PackageFlightJourney;
      airport: string;
      departure_date: string;
      departure_time: string;
      sort_order: number;
    }>
  >(
    `SELECT id,journey,airport,departure_date,departure_time,sort_order FROM package_operational_flight_stopovers WHERE company_id=$1 AND booking_id=$2 ORDER BY journey,sort_order`,
    [companyId, bookingId],
  );
  const movementEvents = await database.select<
    Array<{
      id: string;
      event_type: string;
      event_date: string;
      event_time: string;
      from_location: string;
      to_location: string;
      description: string;
      sort_order: number;
    }>
  >(
    `SELECT id,event_type,event_date,event_time,from_location,to_location,description,sort_order FROM package_movement_events WHERE company_id=$1 AND booking_id=$2 ORDER BY event_date,event_time,sort_order`,
    [companyId, bookingId],
  );
  const meta = await database.select<Array<{ notes: string }>>(
    `SELECT notes FROM package_operational_meta WHERE company_id=$1 AND booking_id=$2 LIMIT 1`,
    [companyId, bookingId],
  );
  return {
    passengers: passengers.map((row) => ({
      id: row.id,
      passengerType: row.passenger_type,
      givenName: row.given_name,
      surname: row.surname,
      passportNumber: row.passport_number,
      visaNumber: row.visa_number,
      passportExpiry: row.passport_expiry,
      sortOrder: row.sort_order,
    })),
    hotels: hotels.map((row) => ({
      id: row.id,
      cityName: row.city_name,
      hotelName: row.hotel_name,
      checkIn: row.check_in,
      checkOut: row.check_out,
      nights: Number(row.nights || 0),
      sortOrder: row.sort_order,
    })),
    flights: flights.map((row) => ({
      id: row.id,
      journey: row.journey,
      flightType: row.flight_type === "INDIRECT" ? "INDIRECT" : "DIRECT",
      departureDate: row.departure_date,
      pnr: row.pnr,
      flightNo: row.flight_no,
      fromAirport: row.from_airport,
      toAirport: row.to_airport,
      departureTime: row.departure_time,
      arrivalTime: row.arrival_time,
      sortOrder: row.sort_order,
    })),
    stopovers: stopovers.map((row) => ({
      id: row.id,
      journey: row.journey,
      airport: row.airport,
      departureDate: row.departure_date,
      departureTime: row.departure_time,
      sortOrder: row.sort_order,
    })),
    movementEvents: movementEvents.map((row) => ({
      id: row.id,
      eventType: row.event_type,
      eventDate: row.event_date,
      eventTime: row.event_time,
      fromLocation: row.from_location,
      toLocation: row.to_location,
      description: row.description,
      sortOrder: row.sort_order,
    })),
    notes: meta[0]?.notes || "",
  };
}

export async function savePackageOperationalDetails(
  companyId: string,
  bookingId: string,
  input: SavePackageOperationalInput,
) {
  await ensureTables();
  const database = await db();
  const now = new Date().toISOString();
  const movement = buildPackageMovementEvents(input.flights, input.hotels, input.stopovers);
  await database.execute(`DELETE FROM package_operational_passengers WHERE company_id=$1 AND booking_id=$2`, [
    companyId,
    bookingId,
  ]);
  await database.execute(`DELETE FROM package_operational_hotels WHERE company_id=$1 AND booking_id=$2`, [
    companyId,
    bookingId,
  ]);
  await database.execute(`DELETE FROM package_operational_flights WHERE company_id=$1 AND booking_id=$2`, [
    companyId,
    bookingId,
  ]);
  await database.execute(`DELETE FROM package_operational_flight_stopovers WHERE company_id=$1 AND booking_id=$2`, [
    companyId,
    bookingId,
  ]);
  await database.execute(`DELETE FROM package_movement_events WHERE company_id=$1 AND booking_id=$2`, [
    companyId,
    bookingId,
  ]);
  for (const [index, passenger] of input.passengers.entries())
    await database.execute(
      `INSERT INTO package_operational_passengers (id,company_id,booking_id,passenger_type,given_name,surname,passport_number,visa_number,passport_expiry,sort_order) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        crypto.randomUUID(),
        companyId,
        bookingId,
        passenger.passengerType,
        passenger.givenName.trim(),
        passenger.surname.trim(),
        passenger.passportNumber.trim().toUpperCase(),
        passenger.visaNumber.trim().toUpperCase(),
        passenger.passportExpiry,
        index,
      ],
    );
  for (const [index, hotel] of input.hotels.entries())
    await database.execute(
      `INSERT INTO package_operational_hotels (id,company_id,booking_id,city_name,hotel_name,check_in,check_out,nights,sort_order) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        crypto.randomUUID(),
        companyId,
        bookingId,
        hotel.cityName.trim(),
        hotel.hotelName.trim(),
        hotel.checkIn,
        hotel.checkOut,
        Math.max(0, Math.trunc(Number(hotel.nights) || 0)),
        index,
      ],
    );
  for (const [index, flight] of input.flights.entries())
    await database.execute(
      `INSERT INTO package_operational_flights (id,company_id,booking_id,journey,flight_type,departure_date,pnr,flight_no,from_airport,to_airport,departure_time,arrival_time,sort_order) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [
        crypto.randomUUID(),
        companyId,
        bookingId,
        flight.journey,
        flight.flightType,
        flight.departureDate,
        flight.pnr.trim().toUpperCase(),
        flight.flightNo.trim().toUpperCase(),
        flight.fromAirport.trim().toUpperCase(),
        flight.toAirport.trim().toUpperCase(),
        flight.departureTime,
        flight.arrivalTime,
        index,
      ],
    );
  for (const journey of ["OUTBOUND", "RETURN"] as PackageFlightJourney[]) {
    const stops = input.stopovers.filter((item) => item.journey === journey);
    for (const [index, stop] of stops.entries())
      await database.execute(
        `INSERT INTO package_operational_flight_stopovers (id,company_id,booking_id,journey,airport,departure_date,departure_time,sort_order) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          crypto.randomUUID(),
          companyId,
          bookingId,
          journey,
          stop.airport.trim().toUpperCase(),
          stop.departureDate,
          stop.departureTime,
          index,
        ],
      );
  }
  for (const [index, event] of movement.entries())
    await database.execute(
      `INSERT INTO package_movement_events (id,company_id,booking_id,event_type,event_date,event_time,from_location,to_location,description,sort_order) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        crypto.randomUUID(),
        companyId,
        bookingId,
        event.eventType,
        event.eventDate,
        event.eventTime,
        event.fromLocation.trim(),
        event.toLocation.trim(),
        event.description,
        index,
      ],
    );
  await database.execute(
    `INSERT INTO package_operational_meta (booking_id,company_id,notes,created_at,updated_at) VALUES ($1,$2,$3,$4,$4) ON CONFLICT(booking_id) DO UPDATE SET company_id=excluded.company_id,notes=excluded.notes,updated_at=excluded.updated_at`,
    [bookingId, companyId, input.notes.trim(), now],
  );
  return movement;
}
