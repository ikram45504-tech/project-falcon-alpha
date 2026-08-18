import { useEffect, useMemo, useState } from "react";
import type { PackagePassengerType } from "./db";
import {
  buildPackageMovementEvents,
  getPackageOperationalDetails,
  savePackageOperationalDetails,
  type PackageFlightJourney,
  type PackageFlightType,
  type PackageOperationalFlight,
  type PackageOperationalHotel,
  type PackageOperationalPassenger,
  type PackageOperationalStopover,
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
type StopoverRow = Omit<PackageOperationalStopover, "sortOrder">;

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

function blankFlight(journey: PackageFlightJourney): FlightRow {
  return {
    id: crypto.randomUUID(),
    journey,
    flightType: "DIRECT",
    departureDate: "",
    pnr: "",
    flightNo: "",
    fromAirport: "",
    toAirport: "",
    departureTime: "",
    arrivalTime: "",
  };
}

function blankStopover(journey: PackageFlightJourney, departureDate = ""): StopoverRow {
  return {
    id: crypto.randomUUID(),
    journey,
    airport: "",
    departureDate,
    departureTime: "",
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
    case "OUTBOUND_DEPARTURE": return "Outbound Departure";
    case "HOTEL_CHECKOUT_TRANSFER": return "Hotel Checkout / City Movement";
    case "FINAL_HOTEL_CHECKOUT": return "Final Hotel Checkout / Airport Movement";
    case "RETURN_DEPARTURE": return "Return Flight";
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
  const [stopovers, setStopovers] = useState<StopoverRow[]>([]);
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
        const loadedFlights: FlightRow[] = [
          outbound ? (({ sortOrder: _sort, ...item }) => item)(outbound) : blankFlight("OUTBOUND"),
          returning ? (({ sortOrder: _sort, ...item }) => item)(returning) : blankFlight("RETURN"),
        ];
        setFlights(loadedFlights);

        const loadedStops = saved.stopovers.map(({ sortOrder: _sort, ...item }) => item);
        const singleStops: StopoverRow[] = [];
        for (const flight of loadedFlights) {
          if (flight.flightType !== "INDIRECT") continue;
          const existing = loadedStops.find((item) => item.journey === flight.journey);
          singleStops.push(existing || blankStopover(flight.journey, flight.departureDate));
        }
        setStopovers(singleStops);
        setNotes(saved.notes || fallbackNotes || "");
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [companyId, bookingId]);

  const activeStopovers = useMemo(() => flights.flatMap((flight) => {
    if (flight.flightType !== "INDIRECT") return [];
    const stop = stopovers.find((item) => item.journey === flight.journey);
    return stop ? [stop] : [];
  }), [flights, stopovers]);

  const movementPreview = useMemo(() => buildPackageMovementEvents(
    flights.map(({ id: _id, ...item }) => item),
    hotels.map(({ id: _id, ...item }) => item),
    activeStopovers.map(({ id: _id, ...item }) => item)
  ), [flights, hotels, activeStopovers]);

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

  function updateFlight(journey: PackageFlightJourney, patch: Partial<FlightRow>) {
    setFlights((current) => current.map((row) => row.journey === journey ? { ...row, ...patch } : row));
  }

  function updateStopover(id: string, patch: Partial<StopoverRow>) {
    setStopovers((current) => current.map((row) => row.id === id ? { ...row, ...patch } : row));
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

  function changeFlightType(journey: PackageFlightJourney, nextType: PackageFlightType) {
    const journeyStop = stopovers.find((item) => item.journey === journey);
    if (nextType === "INDIRECT") {
      updateFlight(journey, { flightType: "INDIRECT" });
      if (!journeyStop) {
        const flight = flights.find((item) => item.journey === journey);
        setStopovers((current) => [...current, blankStopover(journey, flight?.departureDate || "")]);
      }
      return;
    }

    const hasStopoverData = !!journeyStop && Boolean(journeyStop.airport.trim() || journeyStop.departureDate || journeyStop.departureTime);
    if (hasStopoverData && !window.confirm(`Change ${journey === "OUTBOUND" ? "Outbound" : "Return"} flight to Direct and remove its Stopover / Via details?`)) return;
    setStopovers((current) => current.filter((item) => item.journey !== journey));
    updateFlight(journey, { flightType: "DIRECT" });
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
        stopovers: activeStopovers
          .filter((row) => row.airport.trim() || row.departureDate || row.departureTime)
          .map(({ id: _id, ...item }) => item),
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
        <div className="package15-panel-head"><div><span>2</span><b>HOTEL DETAILS</b><small>Each hotel Check-Out becomes a passenger movement trigger. The next Hotel City determines the destination.</small></div><button type="button" disabled={!canEdit} onClick={addHotel}>+ Add Hotel Row</button></div>
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

      <section className="package15-panel package16-flight-panel compact">
        <div className="package15-panel-head"><div><span>3</span><b>FLIGHT DETAILS</b><small>One compact header for Outbound and Return. Flight Type controls whether Stopover / Via fields are active.</small></div></div>
        <div className="package15-table-wrap package16-compact-wrap">
          <table className="package15-table package16-compact-flight-table">
            <thead><tr>
              <th>SR</th><th>JOURNEY</th><th>FLIGHT TYPE</th><th>DEPARTURE DATE</th><th>PNR</th><th>FLIGHT NO.</th>
              <th>FROM ORIGIN (AIRPORT)</th><th>STOPOVER (AIRPORT)</th><th>TO DESTINATION (AIRPORT)</th>
              <th>ORIGIN DEPARTURE</th><th>STOPOVER DEPARTURE</th><th>DESTINATION ARRIVAL</th>
            </tr></thead>
            <tbody>{flights.map((row, index) => {
              const stop = stopovers.find((item) => item.journey === row.journey);
              const indirect = row.flightType === "INDIRECT";
              return <tr key={row.journey} className={indirect ? "indirect" : "direct"}>
                <td className="package16-sr"><b>{index + 1}</b></td>
                <td><span className="package15-journey">{row.journey}</span></td>
                <td><select className="package16-flight-type" value={row.flightType} onChange={(e) => changeFlightType(row.journey, e.target.value as PackageFlightType)} disabled={!canEdit}><option value="DIRECT">Direct</option><option value="INDIRECT">Indirect / Via</option></select></td>
                <td><input type="date" value={row.departureDate} onChange={(e) => {
                  const value = e.target.value;
                  updateFlight(row.journey, { departureDate: value });
                  if (indirect && stop && !stop.departureDate) updateStopover(stop.id, { departureDate: value });
                }} /></td>
                <td><input value={row.pnr} onChange={(e) => updateFlight(row.journey, { pnr: e.target.value.toUpperCase() })} placeholder="PNR" /></td>
                <td><input value={row.flightNo} onChange={(e) => updateFlight(row.journey, { flightNo: e.target.value.toUpperCase() })} placeholder="Flight No." /></td>
                <td><input value={row.fromAirport} onChange={(e) => updateFlight(row.journey, { fromAirport: e.target.value.toUpperCase() })} placeholder="KARACHI / KHI" /></td>
                <td>{indirect && stop ? <input className="package16-stopover-airport" value={stop.airport} onChange={(e) => updateStopover(stop.id, { airport: e.target.value.toUpperCase() })} placeholder="MUSCAT / MCT" /> : <span className="package16-dash" title="Direct flight — no stopover">—</span>}</td>
                <td><input value={row.toAirport} onChange={(e) => updateFlight(row.journey, { toAirport: e.target.value.toUpperCase() })} placeholder="JEDDAH / JED" /></td>
                <td><input type="time" value={row.departureTime} onChange={(e) => updateFlight(row.journey, { departureTime: e.target.value })} /></td>
                <td>{indirect && stop ? <div className="package16-stopover-departure"><input type="date" value={stop.departureDate} onChange={(e) => updateStopover(stop.id, { departureDate: e.target.value })} /><input type="time" value={stop.departureTime} onChange={(e) => updateStopover(stop.id, { departureTime: e.target.value })} /></div> : <span className="package16-dash" title="Direct flight — no stopover departure">—</span>}</td>
                <td><input type="time" value={row.arrivalTime} onChange={(e) => updateFlight(row.journey, { arrivalTime: e.target.value })} /></td>
              </tr>;
            })}</tbody>
          </table>
        </div>
        <div className="package16-flight-help"><b>Direct:</b> Stopover fields remain as —. <b>Indirect / Via:</b> enter one Stopover Airport plus its onward departure date/time. Outbound and Return are independent.</div>
      </section>

      <section className="package15-panel package15-movement-panel">
        <div className="package15-panel-head"><div><span>4</span><b>AUTO PASSENGER MOVEMENT PREVIEW</b><small>Movement-focused timeline: outbound departure, every hotel check-out movement, final hotel-to-airport movement and return departure.</small></div></div>
        {movementPreview.length ? <div className="package15-movement-line">{movementPreview.map((event, index) => <div className="package15-movement-event" key={`${event.eventType}-${index}`}>
          <span className="package15-dot">{index + 1}</span><small>{movementLabel(event.eventType)}</small><b>{event.eventDate || "Date pending"}{event.eventTime ? ` · ${event.eventTime}` : ""}</b><strong>{event.fromLocation || "—"}{event.toLocation ? ` → ${event.toLocation}` : ""}</strong><p>{event.description}</p>
        </div>)}</div> : <div className="package15-empty movement">Enter outbound/return flight schedules and Hotel Check-Out dates to generate passenger movements.</div>}
        <p className="package15-movement-note"><b>Movement rule:</b> Stopovers stay inside the detailed flight journey and do not create separate main movement cards. Hotel Check-In/Check-Out intervals remain saved for expected-location logic, while Check-Out is the trigger for city-to-city or final airport movement. Tracking is schedule-based, not GPS.</p>
      </section>

      <section className="package15-panel">
        <div className="package15-panel-head"><div><span>5</span><b>PACKAGE / TRAVEL NOTES</b></div></div>
        <textarea className="package15-notes" rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Special instructions, customer requirements, operational remarks or other Package notes..." />
      </section>

      <div className="package15-actions"><span>Section 03 is optional and does not change Package accounting totals.</span>{canEdit && <button type="button" className="primary" disabled={busy} onClick={() => void save()}>{busy ? "Saving..." : `Save Package Details — ${ubNumber}`}</button>}</div>
    </div>
  );
}
