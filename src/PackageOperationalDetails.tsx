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
        setFlights([
          outbound ? (({ sortOrder: _sort, ...item }) => item)(outbound) : blankFlight("OUTBOUND"),
          returning ? (({ sortOrder: _sort, ...item }) => item)(returning) : blankFlight("RETURN"),
        ]);
        setStopovers(saved.stopovers.map(({ sortOrder: _sort, ...item }) => item));
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
    hotels.map(({ id: _id, ...item }) => item),
    stopovers.map(({ id: _id, ...item }) => item)
  ), [flights, hotels, stopovers]);

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

  function addStopover(journey: PackageFlightJourney) {
    const flight = flights.find((item) => item.journey === journey);
    const existing = stopovers.filter((item) => item.journey === journey);
    const defaultDate = existing[existing.length - 1]?.departureDate || flight?.departureDate || "";
    setStopovers((current) => [...current, blankStopover(journey, defaultDate)]);
    updateFlight(journey, { flightType: "INDIRECT" });
  }

  function removeStopover(id: string, journey: PackageFlightJourney) {
    setStopovers((current) => {
      const next = current.filter((row) => row.id !== id);
      if (!next.some((row) => row.journey === journey)) {
        setFlights((flightRows) => flightRows.map((flight) => flight.journey === journey ? { ...flight, flightType: "DIRECT" } : flight));
      }
      return next;
    });
  }

  function changeFlightType(journey: PackageFlightJourney, nextType: PackageFlightType) {
    const journeyStops = stopovers.filter((item) => item.journey === journey);
    if (nextType === "INDIRECT") {
      updateFlight(journey, { flightType: "INDIRECT" });
      if (!journeyStops.length) addStopover(journey);
      return;
    }

    const hasStopoverData = journeyStops.some((item) => item.airport.trim() || item.departureDate || item.departureTime);
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
        stopovers: stopovers
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

      <section className="package15-panel package16-flight-panel">
        <div className="package15-panel-head"><div><span>3</span><b>FLIGHT DETAILS</b><small>Outbound and Return are independent. Each can be Direct or Indirect / Via with its own Stopover segments.</small></div></div>
        <div className="package16-flight-journeys">
          {flights.map((row, index) => {
            const journeyStops = stopovers.filter((item) => item.journey === row.journey);
            return <section className={`package16-flight-card ${row.flightType.toLowerCase()}`} key={row.journey}>
              <div className="package16-flight-card-head">
                <div><span className="package16-flight-number">{index + 1}</span><span className="package15-journey">{row.journey}</span></div>
                <label>FLIGHT TYPE<select value={row.flightType} onChange={(e) => changeFlightType(row.journey, e.target.value as PackageFlightType)} disabled={!canEdit}><option value="DIRECT">Direct</option><option value="INDIRECT">Indirect / Via</option></select></label>
              </div>

              <div className="package16-flight-grid">
                <label>DEPARTURE DATE<input type="date" value={row.departureDate} onChange={(e) => updateFlight(row.journey, { departureDate: e.target.value })} /></label>
                <label>PNR<input value={row.pnr} onChange={(e) => updateFlight(row.journey, { pnr: e.target.value.toUpperCase() })} placeholder="PNR" /></label>
                <label>FLIGHT NO.<input value={row.flightNo} onChange={(e) => updateFlight(row.journey, { flightNo: e.target.value.toUpperCase() })} placeholder="Flight No." /></label>
                <label>FROM ORIGIN (AIRPORT)<input value={row.fromAirport} onChange={(e) => updateFlight(row.journey, { fromAirport: e.target.value.toUpperCase() })} placeholder="KARACHI / KHI" /></label>
                <label>TO DESTINATION (AIRPORT)<input value={row.toAirport} onChange={(e) => updateFlight(row.journey, { toAirport: e.target.value.toUpperCase() })} placeholder="JEDDAH / JED" /></label>
                <label>ORIGIN DEPARTURE<input type="time" value={row.departureTime} onChange={(e) => updateFlight(row.journey, { departureTime: e.target.value })} /></label>
                <label>DESTINATION ARRIVAL<input type="time" value={row.arrivalTime} onChange={(e) => updateFlight(row.journey, { arrivalTime: e.target.value })} /></label>
              </div>

              <div className="package16-stopover-zone">
                <div className="package16-stopover-title"><div><b>TO STOPOVER / VIA (AIRPORT)</b><small>For an indirect journey, record each Stopover Airport and when the onward flight departs that stopover.</small></div><button type="button" disabled={!canEdit} onClick={() => addStopover(row.journey)}>+ Add Stopover</button></div>
                {journeyStops.length === 0 ? (
                  <div className="package16-no-stopover"><b>—</b><span>No Stopover / Direct Journey</span><button type="button" disabled={!canEdit} onClick={() => addStopover(row.journey)}>+</button></div>
                ) : (
                  <div className="package16-stopover-list">
                    {journeyStops.map((stop, stopIndex) => <div className="package16-stopover-row" key={stop.id}>
                      <span className="package16-via-badge">VIA {stopIndex + 1}</span>
                      <label>STOPOVER AIRPORT<input value={stop.airport} onChange={(e) => updateStopover(stop.id, { airport: e.target.value.toUpperCase() })} placeholder="MUSCAT / MCT" /></label>
                      <label>STOPOVER DEPARTURE DATE<input type="date" value={stop.departureDate} onChange={(e) => updateStopover(stop.id, { departureDate: e.target.value })} /></label>
                      <label>STOPOVER DEPARTURE TIME<input type="time" value={stop.departureTime} onChange={(e) => updateStopover(stop.id, { departureTime: e.target.value })} /></label>
                      <button type="button" className="package16-minus" disabled={!canEdit} onClick={() => removeStopover(stop.id, row.journey)} aria-label="Remove stopover">−</button>
                    </div>)}
                  </div>
                )}
              </div>
            </section>;
          })}
        </div>
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
