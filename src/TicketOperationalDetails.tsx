import { useEffect, useMemo, useState } from "react";
import type { TicketPassengerType } from "./db";
import { passportValidityForTravel } from "./passportValidity";
import {
  getTicketOperationalDetails,
  saveTicketOperationalDetails,
  type TicketJourney,
  type TicketJourneyFlightType,
  type TicketOperationalFlight,
  type TicketOperationalPassenger,
} from "./TicketOperationalDb";
import "./TicketOperationalDetails.css";

type Props = {
  companyId: string;
  bookingId: string;
  ubNumber: string;
  adultPax: number;
  childPax: number;
  infantPax: number;
  canEdit: boolean;
  defaultAirline?: string;
  defaultPnr?: string;
  legacyDepartureDate?: string;
  legacyReturnDate?: string;
  legacyFlightNo?: string;
  legacyDepartureTime?: string;
  legacyArrivalTime?: string;
  fallbackNotes?: string;
  userId?: string;
  onSaved?: () => void | Promise<void>;
};

type PassengerRow = Omit<TicketOperationalPassenger, "sortOrder">;
type FlightRow = Omit<TicketOperationalFlight, "sortOrder">;

function blankPassenger(type: TicketPassengerType): PassengerRow {
  return { id: crypto.randomUUID(), passengerType: type, givenName: "", surname: "", passportNumber: "", eticketNumber: "", passportExpiry: "" };
}

function blankFlight(journey: TicketJourney, defaults?: Partial<FlightRow>): FlightRow {
  return {
    id: crypto.randomUUID(), journey, flightType: "DIRECT", departureDate: "", airlineName: "", pnr: "", flightNo: "",
    fromAirport: "", stopoverAirport: "", toAirport: "", originDeparture: "", stopoverDepartureDate: "", stopoverDepartureTime: "", destinationArrival: "", ...defaults,
  };
}

function typeLabel(type: TicketPassengerType) {
  return type === "ADULT" ? "Adult" : type === "CHILD" ? "Child" : "Infant";
}

export default function TicketOperationalDetails({
  companyId, bookingId, ubNumber, adultPax, childPax, infantPax, canEdit, defaultAirline = "", defaultPnr = "",
  legacyDepartureDate = "", legacyReturnDate = "", legacyFlightNo = "", legacyDepartureTime = "", legacyArrivalTime = "",
  fallbackNotes = "", userId = "", onSaved,
}: Props) {
  const [passengers, setPassengers] = useState<PassengerRow[]>([]);
  const [flights, setFlights] = useState<FlightRow[]>([]);
  const [notes, setNotes] = useState(fallbackNotes);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const totalPax = adultPax + childPax + infantPax;

  function defaultFlights() {
    return [
      blankFlight("OUTBOUND", { airlineName: defaultAirline, pnr: defaultPnr, departureDate: legacyDepartureDate, flightNo: legacyFlightNo, originDeparture: legacyDepartureTime, destinationArrival: legacyArrivalTime }),
      blankFlight("RETURN", { airlineName: defaultAirline, pnr: defaultPnr, departureDate: legacyReturnDate }),
    ];
  }

  function syncPassengers(current: PassengerRow[]) {
    const desired: TicketPassengerType[] = [
      ...Array(Math.max(0, adultPax)).fill("ADULT" as TicketPassengerType),
      ...Array(Math.max(0, childPax)).fill("CHILD" as TicketPassengerType),
      ...Array(Math.max(0, infantPax)).fill("INFANT" as TicketPassengerType),
    ];
    const pools: Record<TicketPassengerType, PassengerRow[]> = {
      ADULT: current.filter((item) => item.passengerType === "ADULT"),
      CHILD: current.filter((item) => item.passengerType === "CHILD"),
      INFANT: current.filter((item) => item.passengerType === "INFANT"),
    };
    const used: Record<TicketPassengerType, number> = { ADULT: 0, CHILD: 0, INFANT: 0 };
    return desired.map((type) => {
      const existing = pools[type][used[type]];
      used[type] += 1;
      return existing || blankPassenger(type);
    });
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true); setError("");
      try {
        const saved = await getTicketOperationalDetails(companyId, bookingId);
        if (cancelled) return;
        setPassengers(saved.passengers.length ? saved.passengers.map(({ sortOrder: _sort, ...item }) => item) : syncPassengers([]));
        const defaults = defaultFlights();
        const outbound = saved.flights.find((item) => item.journey === "OUTBOUND");
        const returning = saved.flights.find((item) => item.journey === "RETURN");
        setFlights([
          outbound ? (({ sortOrder: _sort, ...item }) => item)(outbound) : defaults[0],
          returning ? (({ sortOrder: _sort, ...item }) => item)(returning) : defaults[1],
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

  const outboundTravelDate = useMemo(() => flights.find((item) => item.journey === "OUTBOUND")?.departureDate || "", [flights]);

  function updatePassenger(id: string, patch: Partial<PassengerRow>) {
    setPassengers((current) => current.map((row) => row.id === id ? { ...row, ...patch } : row));
  }

  function updateFlight(journey: TicketJourney, patch: Partial<FlightRow>) {
    setFlights((current) => current.map((row) => row.journey === journey ? { ...row, ...patch } : row));
  }

  function changeFlightType(row: FlightRow, nextType: TicketJourneyFlightType) {
    if (nextType === "DIRECT" && (row.stopoverAirport.trim() || row.stopoverDepartureDate || row.stopoverDepartureTime)) {
      if (!window.confirm(`Change ${row.journey === "OUTBOUND" ? "Outbound" : "Return"} to Direct and clear its Stopover details?`)) return;
      updateFlight(row.journey, { flightType: "DIRECT", stopoverAirport: "", stopoverDepartureDate: "", stopoverDepartureTime: "" });
      return;
    }
    updateFlight(row.journey, { flightType: nextType });
  }

  async function save() {
    if (!canEdit) return;
    setBusy(true); setError(""); setMessage("");
    try {
      await saveTicketOperationalDetails(companyId, bookingId, {
        passengers: passengers.map(({ id: _id, ...item }) => item),
        flights: flights.map(({ id: _id, ...item }) => item),
        notes,
      }, userId);
      setMessage(`Ticket Booking Details for ${ubNumber} saved successfully.`);
      await onSaved?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <div className="ticket17-loading">Loading Ticket booking details...</div>;

  return <div className="ticket17-body">
    {message && <div className="alert success">{message}</div>}
    {error && <div className="alert error">{error}</div>}

    <section className="ticket17-pax-strip">
      <div><small>BOOKED TICKETS</small><b>{totalPax}</b></div>
      <div><span>Adults</span><b>{adultPax}</b></div><div><span>Children</span><b>{childPax}</b></div><div><span>Infants</span><b>{infantPax}</b></div>
      <button type="button" disabled={!canEdit} onClick={() => setPassengers((current) => syncPassengers(current))}>↻ Generate / Sync Passenger Rows</button>
    </section>

    <section className="ticket17-panel">
      <div className="ticket17-panel-head"><div><b>A. PASSENGER TICKET DETAILS</b><small>Individual rows come from the quantities saved in Section 02. Passport validity uses the Outbound travel date.</small></div></div>
      <div className="ticket17-table-wrap"><table className="ticket17-table ticket17-passenger-table"><thead><tr><th>SR</th><th>TYPE</th><th>GIVEN NAME</th><th>SURNAME</th><th>PASSPORT NO.</th><th>E-TICKET NO.</th><th>PASSPORT EXPIRY</th></tr></thead><tbody>
        {passengers.length ? passengers.map((row, index) => {
          const validity = passportValidityForTravel(outboundTravelDate, row.passportExpiry);
          return <tr key={row.id}><td>{index + 1}</td><td><span className={`ticket17-type ${row.passengerType.toLowerCase()}`}>{typeLabel(row.passengerType)}</span></td>
            <td><input value={row.givenName} onChange={(e) => updatePassenger(row.id, { givenName: e.target.value })} placeholder="Given Name" /></td>
            <td><input value={row.surname} onChange={(e) => updatePassenger(row.id, { surname: e.target.value })} placeholder="Surname" /></td>
            <td><input value={row.passportNumber} onChange={(e) => updatePassenger(row.id, { passportNumber: e.target.value.toUpperCase() })} placeholder="Passport No." /></td>
            <td><input value={row.eticketNumber} onChange={(e) => updatePassenger(row.id, { eticketNumber: e.target.value.toUpperCase() })} placeholder="E-Ticket No." /></td>
            <td><div className="ticket17-expiry-cell"><input type="date" value={row.passportExpiry} onChange={(e) => updatePassenger(row.id, { passportExpiry: e.target.value })} /><small className={`passport-validity ${validity.level.toLowerCase()}`}>{validity.label}</small></div></td>
          </tr>;
        }) : <tr><td colSpan={7} className="ticket17-empty">No booked passenger quantity found in Section 02.</td></tr>}
      </tbody></table></div>
      <div className="ticket17-passport-note"><b>6-month rule:</b> passport expiry must be at least 6 calendar months after the Outbound travel date. Amber highlights approaching validity; red means less than 6 months.</div>
    </section>

    <section className="ticket17-panel">
      <div className="ticket17-panel-head"><div><b>B. FLIGHT JOURNEY DETAILS</b><small>Outbound and Return are independent. Direct rows show — under Stopover fields; Indirect / Via activates them.</small></div></div>
      <div className="ticket17-table-wrap"><table className="ticket17-table ticket17-flight-table"><thead><tr>
        <th>SR</th><th>JOURNEY</th><th>FLIGHT TYPE</th><th>DEPARTURE DATE</th><th>AIRLINE</th><th>PNR</th><th>FLIGHT NO.</th><th>FROM ORIGIN</th><th>STOPOVER</th><th>TO DESTINATION</th><th>ORIGIN DEPARTURE</th><th>STOPOVER DEPARTURE</th><th>DESTINATION ARRIVAL</th>
      </tr></thead><tbody>{flights.map((row, index) => {
        const indirect = row.flightType === "INDIRECT";
        return <tr key={row.journey} className={indirect ? "indirect" : "direct"}><td>{index + 1}</td><td><span className="ticket17-journey">{row.journey}</span></td>
          <td><select value={row.flightType} onChange={(e) => changeFlightType(row, e.target.value as TicketJourneyFlightType)}><option value="DIRECT">Direct</option><option value="INDIRECT">Indirect / Via</option></select></td>
          <td><input type="date" value={row.departureDate} onChange={(e) => updateFlight(row.journey, { departureDate: e.target.value })} /></td>
          <td><input value={row.airlineName} onChange={(e) => updateFlight(row.journey, { airlineName: e.target.value })} placeholder="Airline" /></td>
          <td><input value={row.pnr} onChange={(e) => updateFlight(row.journey, { pnr: e.target.value.toUpperCase() })} placeholder="PNR" /></td>
          <td><input value={row.flightNo} onChange={(e) => updateFlight(row.journey, { flightNo: e.target.value.toUpperCase() })} placeholder="Flight No." /></td>
          <td><input value={row.fromAirport} onChange={(e) => updateFlight(row.journey, { fromAirport: e.target.value.toUpperCase() })} placeholder="KHI / Karachi" /></td>
          <td>{indirect ? <input value={row.stopoverAirport} onChange={(e) => updateFlight(row.journey, { stopoverAirport: e.target.value.toUpperCase() })} placeholder="MCT / Muscat" /> : <span className="ticket17-dash">—</span>}</td>
          <td><input value={row.toAirport} onChange={(e) => updateFlight(row.journey, { toAirport: e.target.value.toUpperCase() })} placeholder="JED / Jeddah" /></td>
          <td><input type="time" value={row.originDeparture} onChange={(e) => updateFlight(row.journey, { originDeparture: e.target.value })} /></td>
          <td>{indirect ? <div className="ticket17-stop-time"><input type="date" value={row.stopoverDepartureDate} onChange={(e) => updateFlight(row.journey, { stopoverDepartureDate: e.target.value })} /><input type="time" value={row.stopoverDepartureTime} onChange={(e) => updateFlight(row.journey, { stopoverDepartureTime: e.target.value })} /></div> : <span className="ticket17-dash">—</span>}</td>
          <td><input type="time" value={row.destinationArrival} onChange={(e) => updateFlight(row.journey, { destinationArrival: e.target.value })} /></td>
        </tr>;
      })}</tbody></table></div>
    </section>

    <section className="ticket17-notes"><label>Ticket Notes / Internal Remarks<textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Ticketing instructions, passenger remarks or internal notes..." /></label></section>
    <div className="ticket17-actions"><span>Section 03 is optional and never changes Ticket fare totals.</span>{canEdit && <button type="button" className="primary" disabled={busy} onClick={() => void save()}>{busy ? "Saving..." : `Save Additional Ticket Details — ${ubNumber}`}</button>}</div>
  </div>;
}
