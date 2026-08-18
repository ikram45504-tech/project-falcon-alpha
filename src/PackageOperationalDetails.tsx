import { useEffect, useMemo, useState } from "react";
import type { PackagePassengerType } from "./db";
import {
  buildPackageMovementEvents,
  getPackageOperationalDetails,
  savePackageOperationalDetails,
  type PackageOperationalFlight,
  type PackageOperationalHotel,
  type PackageOperationalPassenger,
} from "./PackageOperationalDb";
import "./PackageOperationalDetails.css";

type Props = {
  companyId: string;
  bookingId: string;
  ubNumber: string;
  adultPax: number;
  childPax: number;
  infantPax: number;
  canEdit: boolean;
  fallbackNotes?: string;
  onSaved?: () => void | Promise<void>;
};

type PassengerRow = Omit<PackageOperationalPassenger, "sortOrder">;
type HotelRow = Omit<PackageOperationalHotel, "sortOrder">;
type FlightRow = Omit<PackageOperationalFlight, "sortOrder">;

function blankPassenger(type: PackagePassengerType): PassengerRow {
  return {
    id: crypto.randomUUID(),
    passengerType: type,
    givenName: "",
    surname: "",
    passportNumber: "",
    visaNumber: "",
  };
}

function blankHotel(): HotelRow {
  return {
    id: crypto.randomUUID(),
    cityName: "",
    hotelName: "",
    checkIn: "",
    checkOut: "",
    nights: 0,
  };
}

function blankFlight(journey: "OUTBOUND" | "RETURN"): FlightRow {
  return {
    id: crypto.randomUUID(),
    journey,
    departureDate: "",
    pnr: "",
    flightNo: "",
    fromAirport: "",
    toAirport: "",
    departureTime: "",
    arrivalTime: "",
  };
}

function hotelNights(checkIn: string, checkOut: string) {
  if (!checkIn || !checkOut || checkOut <= checkIn) return 0;
  const [iy, im, id] = checkIn.split("-").map(Number);
  const [oy, om, od] = checkOut.split("-").map(Number);
  const start = Date.UTC(iy, im - 1, id);
  const end = Date.UTC(oy, om - 1, od);
  return Math.max(0, Math.floor((end - start) / 86400000));
}

function passengerTypeLabel(type: PackagePassengerType) {
  return type === "ADULT" ? "Adult" : type === "CHILD" ? "Child" : "Infant";
}

function movementLabel(type: string) {
  switch (type) {
    case "OUTBOUND_DEPARTURE": return "Depart Home Country";
    case "ARRIVAL_AND_TRANSFER": return "Arrive / Transfer";
    case "HOTEL_STAY_START": return "Hotel Stay";
    case "INTERCITY_TRANSFER": return "City Movement";
    case "RETURN_TRANSFER": return "Airport Transfer";
    case "RETURN_DEPARTURE": return "Return Departure";
    case "RETURN_ARRIVAL": return "Return Arrival";
    default: return "Movement";
  }
}

export default function PackageOperationalDetails({
  companyId,
  bookingId,
  ubNumber,
  adultPax,
  childPax,
  infantPax,
  canEdit,
  fallbackNotes = "",
  onSaved,
}: Props) {
  const [passengers, setPassengers] = useState<PassengerRow[]>([]);
  const [hotels, setHotels] = useState<HotelRow[]>([blankHotel()]);
  const [flights, setFlights] = useState<FlightRow[]>([blankFlight("OUTBOUND"), blankFlight("RETURN")]);
  const [notes, setNotes] = useState(fallbackNotes);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const totalPax = adultPax + childPax + infantPax;

  function syncPassengers(current: PassengerRow[]) {
    const desired: PackagePassengerType[] = [
      ...Array(Math.max(0, adultPax)).fill("ADULT" as PackagePassengerType),
      ...Array(Math.max(0, childPax)).fill("CHILD" as PackagePassengerType),
      ...Array(Math.max(0, infantPax)).fill("INFANT" as PackagePassengerType),
    ];

    const pools: Record<PackagePassengerType, PassengerRow[]> = {
      ADULT: current.filter((item) => item.passengerType === "ADULT"),
      CHILD: current.filter((item) => item.passengerType === "CHILD"),
      INFANT: current.filter((item) => item.passengerType === "INFANT"),
    };
    const used: Record<PackagePassengerType, number> = { ADULT: 0, CHILD: 0, INFANT: 0 };

    return desired.map((type) => {
      const existing = pools[type][used[type]];
      used[type] += 1;
      return existing || blankPassenger(type);
    });
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError("");
      try {
        const saved = await getPackageOperationalDetails(companyId, bookingId);
        if (cancelled) return;
        setPassengers(saved.passengers.length ? saved.passengers.map(({ sortOrder: _sort, ...item }) => item) : syncPassengers([]));
        setHotels(saved.hotels.length ? saved.hotels.map(({ sortOrder: _sort, ...item }) => item) : [blankHotel()]);
        const outbound = saved.flights.find((item) => item.journey === "OUTBOUND");
        const returning = saved.flights.find((item) => item.journey === "RETURN");
        setFlights([
          outbound ? (({ sortOrder: _sort, ...item }) => item)(outbound) : blankFlight("OUTBOUND"),
          returning ? (({ sortOrder: _sort, ...item }) => item)(returning) : blankFlight("RETURN"),
        ]);
        setNotes(saved.notes || fallbackNotes || "");
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [companyId, bookingId]);

  const movementPreview = useMemo(() => buildPackageMovementEvents(
    flights.map(({ id: _id, ...item }) => item),
    hotels.map(({ id: _id, ...item }) => item)
  ), [flights, hotels]);

  function updatePassenger(id: string, patch: Partial<PassengerRow>) {
    setPassengers((current) => current.map((row) => row.id === id ? { ...row, ...patch } : row));
  }

  function updateHotel(id: string, patch: Partial<HotelRow>) {
    setHotels((current) => current.map((row) => {
      if (row.id !== id) return row;
      const next = { ...row, ...patch };
      next.nights = hotelNights(next.checkIn, next.checkOut);
      return next;
    }));
  }

  function updateFlight(journey: "OUTBOUND" | "RETURN", patch: Partial<FlightRow>) {
    setFlights((current) => current.map((row) => row.journey === journey ? { ...row, ...patch } : row));
  }

  function addHotel() {
    setHotels((current) => [...current, blankHotel()]);
  }

  function removeHotel(id: string) {
    setHotels((current) => {
      const next = current.filter((row) => row.id !== id);
      return next.length ? next : [blankHotel()];
    });
  }

  async function save() {
    if (!canEdit) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await savePackageOperationalDetails(companyId, bookingId, {
        passengers: passengers.map(({ id: _id, ...item }) => item),
        hotels: hotels
          .filter((row) => row.cityName.trim() || row.hotelName.trim() || row.checkIn || row.checkOut)
          .map(({ id: _id, ...item }) => item),
        flights: flights.map(({ id: _id, ...item }) => item),
        notes,
      });
      setMessage(`Package travel & passenger details for ${ubNumber} saved successfully.`);
      await onSaved?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <div className="package15-loading">Loading Package travel details...</div>;

  return (
    <div className="package15-body">
      {message && <div className="alert success">{message}</div>}
      {error && <div className="alert error">{error}</div>}

      <section className="package15-pax-strip">
        <div><small>BOOKED PAX</small><b>{totalPax} Pax</b></div>
        <div className="adult"><span>Adults</span><b>{adultPax}</b></div>
        <div className="child"><span>Children</span><b>{childPax}</b></div>
        <div className="infant"><span>Infants</span><b>{infantPax}</b></div>
        <button type="button" disabled={!canEdit} onClick={() => setPassengers((current) => syncPassengers(current))}>↻ Generate / Sync from Booked Pax</button>
      </section>

      <section className="package15-panel">
        <div className="package15-panel-head"><div><span>1</span><b>PASSENGER DETAILS</b><small>Rows are generated from the Adult / Child / Infant quantities saved in Section 02.</small></div></div>
        <div className="package15-table-wrap">
          <table className="package15-table package15-passenger-table">
            <thead><tr><th>SR</th><th>TYPE</th><th>GIVEN NAME</th><th>SURNAME</th><th>PASSPORT NO.</th><th>VISA NO.</th></tr></thead>
            <tbody>{passengers.length ? passengers.map((row, index) => <tr key={row.id}>
              <td>{index + 1}</td><td><span className={`package15-type ${row.passengerType.toLowerCase()}`}>{passengerTypeLabel(row.passengerType)}</span></td>
              <td><input value={row.givenName} onChange={(e) => updatePassenger(row.id, { givenName: e.target.value })} placeholder="Given Name" /></td>
              <td><input value={row.surname} onChange={(e) => updatePassenger(row.id, { surname: e.target.value })} placeholder="Surname" /></td>
              <td><input value={row.passportNumber} onChange={(e) => updatePassenger(row.id, { passportNumber: e.target.value.toUpperCase() })} placeholder="Passport No." /></td>
              <td><input value={row.visaNumber} onChange={(e) => updatePassenger(row.id, { visaNumber: e.target.value.toUpperCase() })} placeholder="Visa No." /></td>
            </tr>) : <tr><td colSpan={6} className="package15-empty">No booked passengers found in Section 02.</td></tr>}</tbody>
          </table>
        </div>
      </section>

      <section className="package15-panel">
        <div className="package15-panel-head"><div><span>2</span><b>HOTEL DETAILS</b><small>Hotel order and dates are used to build the passenger movement schedule.</small></div><button type="button" disabled={!canEdit} onClick={addHotel}>+ Add Hotel Row</button></div>
        <div className="package15-table-wrap">
          <table className="package15-table package15-hotel-table">
            <thead><tr><th>SR</th><th>CITY NAME</th><th>HOTEL NAME</th><th>CHECK-IN</th><th>CHECK-OUT</th><th>NIGHTS</th><th>ACTION</th></tr></thead>
            <tbody>{hotels.map((row, index) => <tr key={row.id}>
              <td>{index + 1}</td><td><input value={row.cityName} onChange={(e) => updateHotel(row.id, { cityName: e.target.value })} placeholder="Makkah / Madinah" /></td>
              <td><input value={row.hotelName} onChange={(e) => updateHotel(row.id, { hotelName: e.target.value })} placeholder="Hotel Name" /></td>
              <td><input type="date" value={row.checkIn} onChange={(e) => updateHotel(row.id, { checkIn: e.target.value })} /></td>
              <td><input type="date" value={row.checkOut} onChange={(e) => updateHotel(row.id, { checkOut: e.target.value })} /></td>
              <td className="package15-nights"><b>{row.nights || "—"}</b></td>
              <td><button type="button" className="package15-remove" disabled={!canEdit} onClick={() => removeHotel(row.id)}>×</button></td>
            </tr>)}</tbody>
          </table>
        </div>
      </section>

      <section className="package15-panel">
        <div className="package15-panel-head"><div><span>3</span><b>FLIGHT DETAILS</b><small>Two fixed sectors: Outbound and Return. Overnight arrival is detected automatically from the times.</small></div></div>
        <div className="package15-table-wrap">
          <table className="package15-table package15-flight-table">
            <thead><tr><th>SR</th><th>JOURNEY</th><th>DEPARTURE DATE</th><th>PNR</th><th>FLIGHT NO.</th><th>FROM (AIRPORT)</th><th>TO (AIRPORT)</th><th>DEPARTURE TIME</th><th>ARRIVAL TIME</th></tr></thead>
            <tbody>{flights.map((row, index) => <tr key={row.journey}>
              <td>{index + 1}</td><td><span className="package15-journey">{row.journey}</span></td>
              <td><input type="date" value={row.departureDate} onChange={(e) => updateFlight(row.journey, { departureDate: e.target.value })} /></td>
              <td><input value={row.pnr} onChange={(e) => updateFlight(row.journey, { pnr: e.target.value.toUpperCase() })} placeholder="PNR" /></td>
              <td><input value={row.flightNo} onChange={(e) => updateFlight(row.journey, { flightNo: e.target.value.toUpperCase() })} placeholder="Flight No." /></td>
              <td><input value={row.fromAirport} onChange={(e) => updateFlight(row.journey, { fromAirport: e.target.value.toUpperCase() })} placeholder="LHE / ISB / KHI" /></td>
              <td><input value={row.toAirport} onChange={(e) => updateFlight(row.journey, { toAirport: e.target.value.toUpperCase() })} placeholder="JED / MED" /></td>
              <td><input type="time" value={row.departureTime} onChange={(e) => updateFlight(row.journey, { departureTime: e.target.value })} /></td>
              <td><input type="time" value={row.arrivalTime} onChange={(e) => updateFlight(row.journey, { arrivalTime: e.target.value })} /></td>
            </tr>)}</tbody>
          </table>
        </div>
      </section>

      <section className="package15-panel package15-movement-panel">
        <div className="package15-panel-head"><div><span>4</span><b>AUTO PASSENGER MOVEMENT PREVIEW</b><small>Generated automatically from flight timing and hotel city/date sequence for the future Passenger Movement dashboard.</small></div></div>
        {movementPreview.length ? <div className="package15-movement-line">{movementPreview.map((event, index) => <div className="package15-movement-event" key={`${event.eventType}-${index}`}>
          <span className="package15-dot">{index + 1}</span><small>{movementLabel(event.eventType)}</small><b>{event.eventDate || "Date pending"}{event.eventTime ? ` · ${event.eventTime}` : ""}</b><strong>{event.fromLocation || "—"}{event.toLocation ? ` → ${event.toLocation}` : ""}</strong><p>{event.description}</p>
        </div>)}</div> : <div className="package15-empty movement">Enter flight dates/times and hotel city dates to generate the movement schedule.</div>}
        <p className="package15-movement-note">Movement status is schedule-based operational tracking, not GPS location. The future dashboard can compare the current date/time with these saved events to show the passenger's expected location or next movement.</p>
      </section>

      <section className="package15-panel">
        <div className="package15-panel-head"><div><span>5</span><b>PACKAGE / TRAVEL NOTES</b></div></div>
        <textarea className="package15-notes" rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Special instructions, customer requirements, operational remarks or other Package notes..." />
      </section>

      <div className="package15-actions"><span>Section 03 is optional and does not change Package accounting totals.</span>{canEdit && <button type="button" className="primary" disabled={busy} onClick={() => void save()}>{busy ? "Saving..." : `Save Package Details — ${ubNumber}`}</button>}</div>
    </div>
  );
}
