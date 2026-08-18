import { useEffect, useMemo, useState } from "react";
import type { BookingTransactionType, Party, TicketPassengerType } from "./db";
import ProgressiveBookingIdentity from "./ProgressiveBookingIdentity";
import { bookingDigitsFromUb, normalizeBookingUb } from "./bookingUb";
import TicketOperationalDetails from "./TicketOperationalDetails";
import {
  createTicketCommercialBooking,
  getTicketCommercialBookings,
  updateTicketCommercialBooking,
  voidTicketCommercialBooking,
  type TicketCommercialBooking,
  type TicketCommercialLineInput,
  type TicketFareFlightType,
} from "./TicketFlowDb";
import "./TicketBookingFlow.css";

type Props = { companyId: string; parties: Party[]; transactionType: BookingTransactionType; userId?: string; canCreate?: boolean; canEdit?: boolean; canVoid?: boolean; onBack: () => void; onChanged?: () => void | Promise<void> };
type Row = { rowId: string; passengerType: TicketPassengerType; passengerName: string; airlineName: string; pnr: string; flightType: TicketFareFlightType; ticketRoute: string; rate: string; count: string; legacyEticketReference: string };
type Mode = "FORM" | "REGISTER";
type Filter = "ALL" | BookingTransactionType;

function localDate() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }
function newRow(): Row { return { rowId: crypto.randomUUID(), passengerType: "ADULT", passengerName: "", airlineName: "", pnr: "", flightType: "RETURN", ticketRoute: "", rate: "", count: "1", legacyEticketReference: "" }; }
function num(value: string) { const n = Number(value); return Number.isFinite(n) ? n : 0; }
function whole(value: string) { return Math.max(0, Math.trunc(num(value))); }
function hasData(row: Row) { return Boolean(row.passengerName.trim() || row.airlineName.trim() || row.pnr.trim() || row.ticketRoute.trim() || row.rate.trim()); }
function rowQty(row: Row) { return hasData(row) ? Math.max(1, whole(row.count || "1")) : 0; }
function rowTotal(row: Row) { return hasData(row) ? Math.max(0, num(row.rate)) * Math.max(1, whole(row.count || "1")) : 0; }
function money(value: number) { return `Rs ${Number(value || 0).toLocaleString("en-PK", { maximumFractionDigits: 2 })}`; }
function flightTypeLabel(value: TicketFareFlightType) { return value === "ONE_WAY" ? "One Way" : value === "MULTI_CITY" ? "Multi-City" : "Return"; }

export default function TicketBookingFlowV2({ companyId, parties, transactionType, userId = "", canCreate = true, canEdit = true, canVoid = true, onBack, onChanged }: Props) {
  const [mode, setMode] = useState<Mode>("FORM");
  const [tx, setTx] = useState<BookingTransactionType>(transactionType);
  const [counterpartyId, setCounterpartyId] = useState("");
  const [bookingDate, setBookingDate] = useState(localDate());
  const [ubDigits, setUbDigits] = useState("");
  const [ubNumber, setUbNumber] = useState("");
  const [assigned, setAssigned] = useState(false);
  const [saved, setSaved] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [rows, setRows] = useState<Row[]>([newRow()]);
  const [entries, setEntries] = useState<TicketCommercialBooking[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("ALL");

  useEffect(() => { if (!editingId) setTx(transactionType); }, [transactionType, editingId]);
  useEffect(() => { void loadEntries(""); }, [companyId]);

  const totals = useMemo(() => {
    const qty = { ADULT: 0, CHILD: 0, INFANT: 0 }, amount = { ADULT: 0, CHILD: 0, INFANT: 0 };
    rows.forEach((row) => { qty[row.passengerType] += rowQty(row); amount[row.passengerType] += rowTotal(row); });
    return { qty, amount, total: qty.ADULT + qty.CHILD + qty.INFANT, grand: amount.ADULT + amount.CHILD + amount.INFANT };
  }, [rows]);
  const visible = entries.filter((entry) => filter === "ALL" || entry.transaction_type === filter);
  const activeCount = entries.filter((entry) => entry.status === "ACTIVE").length;
  const currentEntry = editingId ? entries.find((entry) => entry.id === editingId) || null : null;
  const firstCommercialRow = rows.find(hasData) || rows[0];

  async function loadEntries(query = search) {
    try { setEntries(await getTicketCommercialBookings(companyId, query)); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }

  function reset() {
    setTx(transactionType); setCounterpartyId(""); setBookingDate(localDate()); setUbDigits(""); setUbNumber(""); setAssigned(false); setSaved(false); setDetailsOpen(false); setRows([newRow()]); setEditingId(null); setError(""); setMessage("");
  }

  function assign(formatted: string) {
    setError("");
    if (!counterpartyId) return setError(tx === "SALE" ? "Select a Party / Customer first." : "Select a Vendor / Supplier first.");
    if (!bookingDate) return setError("Date of Booking is required.");
    if (!formatted) return setError("Enter a booking number using 1 to 4 digits.");
    const duplicate = entries.find((entry) => normalizeBookingUb(entry.ub_number) === formatted && (tx === "SALE" ? entry.transaction_type === "SALE" : entry.transaction_type === "PURCHASE" && entry.counterparty_id === counterpartyId));
    if (duplicate) return setError(tx === "SALE" ? `${formatted} already has a Ticket Sale booking.` : `This Vendor already has a Ticket Purchase booking for ${formatted}.`);
    setUbNumber(formatted); setAssigned(true); setMessage(`${formatted} is ready. Enter Ticket Details & Fares below.`);
  }

  function updateRow(id: string, patch: Partial<Row>) { setRows((current) => current.map((row) => row.rowId === id ? { ...row, ...patch } : row)); }
  function addRow() { setRows((current) => [...current, newRow()]); }
  function removeRow(id: string) { setRows((current) => { const next = current.filter((row) => row.rowId !== id); return next.length ? next : [newRow()]; }); }

  function lineInputs(): TicketCommercialLineInput[] {
    return rows.filter(hasData).map((row) => ({
      passengerType: row.passengerType,
      passengerName: row.passengerName.trim(),
      airlineName: row.airlineName.trim(),
      pnr: row.pnr.trim().toUpperCase(),
      flightType: row.flightType,
      ticketRoute: row.ticketRoute.trim().toUpperCase(),
      ratePerTicket: Math.max(0, num(row.rate)),
      ticketCount: Math.max(1, whole(row.count || "1")),
      legacyEticketReference: row.legacyEticketReference,
    }));
  }

  async function saveCommercial() {
    if (!assigned) return setError("Create / Assign the Booking UB first.");
    setBusy(true); setError(""); setMessage("");
    try {
      if (editingId) {
        await updateTicketCommercialBooking(companyId, editingId, { transactionDate: bookingDate, lines: lineInputs() }, userId);
        setMessage(`Ticket Details & Fares for ${ubNumber} updated.`);
      } else {
        const id = await createTicketCommercialBooking(companyId, { transactionType: tx, counterpartyId, transactionDate: bookingDate, ubNumber, lines: lineInputs() }, userId);
        setEditingId(id); setSaved(true); setMessage(`Ticket booking ${ubNumber} saved. Optional Ticket Booking Details are now available.`);
      }
      setSaved(true); await loadEntries(search); await onChanged?.();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  function edit(entry: TicketCommercialBooking) {
    if (!canEdit || entry.status !== "ACTIVE") return;
    setTx(entry.transaction_type); setCounterpartyId(entry.counterparty_id); setBookingDate(entry.transaction_date); setUbNumber(entry.ub_number); setUbDigits(bookingDigitsFromUb(entry.ub_number)); setAssigned(true); setSaved(true); setDetailsOpen(false);
    setRows(entry.lines.length ? entry.lines.map((line) => ({ rowId: crypto.randomUUID(), passengerType: line.passenger_type, passengerName: line.passenger_name, airlineName: line.airline_name, pnr: line.pnr, flightType: line.flight_type, ticketRoute: line.ticket_route, rate: String(line.rate_per_ticket || ""), count: String(line.ticket_count || 1), legacyEticketReference: line.eticket_reference || "" })) : [newRow()]);
    setEditingId(entry.id); setMode("FORM"); setError(""); setMessage(`Editing Ticket booking ${entry.ub_number}. Booking identity is locked; Section 02 and Section 03 save independently.`); window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function voidEntry(entry: TicketCommercialBooking) {
    if (!canVoid || entry.status !== "ACTIVE" || busy) return;
    if (!window.confirm(`Void Ticket booking ${entry.ub_number}?`)) return;
    setBusy(true);
    try { await voidTicketCommercialBooking(companyId, entry.id, userId); await loadEntries(search); await onChanged?.(); if (editingId === entry.id) reset(); setMessage(`Ticket booking ${entry.ub_number} voided.`); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  if (mode === "REGISTER") return <section className="booking-entry-screen ticket9-screen">
    <div className="booking-screen-toolbar"><button className="booking-back-button" onClick={() => setMode("FORM")}>← Back to Ticket Booking</button><span className="booking-foundation-badge active-engine">TICKET REGISTER</span></div>
    <div className="ticket9-title-row"><div><span className="eyebrow blue">TICKET BOOKING REGISTER</span><h2>Ticket Booking Register</h2><p>{activeCount} active Ticket booking{activeCount === 1 ? "" : "s"} · searchable Sale and Purchase records.</p></div></div>
    <div className="package14-register-controls"><div className="package-register-filter-tabs">{(["ALL", "SALE", "PURCHASE"] as Filter[]).map((item) => <button key={item} className={filter === item ? "active" : ""} onClick={() => setFilter(item)}>{item}</button>)}</div><div className="search-box"><input value={search} onChange={(e) => { setSearch(e.target.value); void loadEntries(e.target.value); }} placeholder="Search UB, airline, PNR, route, passenger..." /></div></div>
    <div className="party-table-wrap"><table className="party-table"><thead><tr><th>DATE</th><th>UB #</th><th>TYPE</th><th>PARTY / VENDOR</th><th>AIRLINE / ROUTE</th><th>TICKETS</th><th>TOTAL PKR</th><th>STATUS</th><th>ACTIONS</th></tr></thead><tbody>{visible.map((entry) => {
      const first = entry.lines[0];
      return <tr key={entry.id}><td>{entry.transaction_date}</td><td><b>{entry.ub_number}</b></td><td>{entry.transaction_type}</td><td>{entry.counterparty_name}</td><td><b>{first?.airline_name || entry.airline_name}</b><small className="table-note">{first?.ticket_route || entry.sector}{(first?.pnr || entry.pnr) ? ` · PNR ${first?.pnr || entry.pnr}` : ""}</small></td><td>{entry.lines.reduce((sum, line) => sum + Number(line.ticket_count || 0), 0)}</td><td>{money(entry.total_pkr)}</td><td><span className={`status ${entry.status.toLowerCase()}`}>{entry.status}</span></td><td><div className="row-actions"><button disabled={!canEdit || entry.status !== "ACTIVE"} onClick={() => edit(entry)}>Edit / Details</button><button disabled={!canVoid || entry.status !== "ACTIVE"} onClick={() => void voidEntry(entry)}>Void</button></div></td></tr>;
    })}</tbody></table></div>
  </section>;

  return <section className="booking-entry-screen ticket9-screen package14-page">
    <div className="booking-screen-toolbar ticket9-toolbar"><button className="booking-back-button" onClick={onBack}>← Back to Booking Services</button><div className="ticket9-toolbar-right"><span className={`direction-badge ${tx === "SALE" ? "sale" : "purchase"}`}>{tx === "SALE" ? "SALE TO PARTY" : "PURCHASE FROM VENDOR / SUPPLIER"}</span><button className="ticket9-register-button" onClick={() => { setMode("REGISTER"); void loadEntries(search); }}>Ticket Booking Register</button></div></div>
    <div className="ticket9-title-row"><div><span className="eyebrow blue">TICKET BOOKING</span><h2>{saved ? `Ticket Booking — ${ubNumber}` : "New Ticket Booking"}</h2><p>Create the UB first, save Ticket fares second, then add optional passenger and flight details.</p></div></div>
    {message && <div className="alert success">{message}</div>}{error && <div className="alert error">{error}</div>}

    <ProgressiveBookingIdentity companyId={companyId} userId={userId} transactionType={tx} parties={parties} counterpartyId={counterpartyId} onCounterpartyChange={setCounterpartyId} bookingDate={bookingDate} onBookingDateChange={setBookingDate} ubDigits={ubDigits} onUbDigitsChange={setUbDigits} ubNumber={ubNumber} assigned={assigned} saved={saved} onAssign={assign} onEditHeader={() => { setAssigned(false); setMessage(""); }} onAccountsChanged={onChanged} onError={setError} onMessage={setMessage} serviceLabel="Ticket" />

    {assigned && <section className="ticket9-card">
      <div className="ticket9-section-head"><span>2</span><b>TICKET DETAILS & FARES</b><small>Commercial / accounting data under {ubNumber}</small></div>
      <div className="ticket17-fare-head"><button type="button" className="ticket17-add-row" disabled={editingId ? !canEdit : !canCreate} onClick={addRow}>+ Ticket Row</button></div>
      <div className="ticket17-fare-wrap"><table className="ticket17-fare-table"><thead><tr><th>SR</th><th>PAX TYPE</th><th>PASSENGER / FAMILY HEAD</th><th>AIRLINE</th><th>PNR</th><th>FLIGHT TYPE</th><th>TICKET ROUTE</th><th>RATE / TICKET (PKR)</th><th>QTY</th><th>SUB TOTAL</th><th>ACTION</th></tr></thead><tbody>{rows.map((row, index) => <tr key={row.rowId}>
        <td className="ticket17-sr">{index + 1}</td>
        <td><select value={row.passengerType} onChange={(e) => updateRow(row.rowId, { passengerType: e.target.value as TicketPassengerType })}><option value="ADULT">Adult</option><option value="CHILD">Child</option><option value="INFANT">Infant</option></select></td>
        <td><input value={row.passengerName} onChange={(e) => updateRow(row.rowId, { passengerName: e.target.value })} placeholder="Passenger / Family Head" /></td>
        <td><input value={row.airlineName} onChange={(e) => updateRow(row.rowId, { airlineName: e.target.value })} placeholder="Airline" /></td>
        <td><input className="ticket17-pnr-input" value={row.pnr} onChange={(e) => updateRow(row.rowId, { pnr: e.target.value.toUpperCase() })} placeholder="PNR" /></td>
        <td><select className="ticket17-flight-type-select" value={row.flightType} onChange={(e) => updateRow(row.rowId, { flightType: e.target.value as TicketFareFlightType })}><option value="ONE_WAY">One Way</option><option value="RETURN">Return</option><option value="MULTI_CITY">Multi-City</option></select></td>
        <td><input value={row.ticketRoute} onChange={(e) => updateRow(row.rowId, { ticketRoute: e.target.value.toUpperCase() })} placeholder="KHI - JED - KHI" /></td>
        <td><input type="number" min="0" step="0.01" value={row.rate} onChange={(e) => updateRow(row.rowId, { rate: e.target.value })} placeholder="0" /></td>
        <td><input type="number" min="1" step="1" value={row.count} onChange={(e) => updateRow(row.rowId, { count: e.target.value })} placeholder="1" /></td>
        <td className="money-cell">{money(rowTotal(row))}</td>
        <td><button type="button" className="ticket17-remove" onClick={() => removeRow(row.rowId)}>×</button></td>
      </tr>)}</tbody></table></div>

      <div className="ticket9-summary-grid ticket17-summary"><section className="ticket9-summary-card"><div className="ticket9-category adult"><span>Adults</span><b>{totals.qty.ADULT}</b><small>{money(totals.amount.ADULT)}</small></div><div className="ticket9-category child"><span>Children</span><b>{totals.qty.CHILD}</b><small>{money(totals.amount.CHILD)}</small></div><div className="ticket9-category infant"><span>Infants</span><b>{totals.qty.INFANT}</b><small>{money(totals.amount.INFANT)}</small></div><div className="ticket9-total-tickets"><span>Total Tickets</span><b>{totals.total}</b></div></section><section className="ticket9-grand"><span>GRAND TICKET TOTAL</span><b>{money(totals.grand)}</b></section></div>
      <div className="ticket17-commercial-actions">{(editingId ? canEdit : canCreate) && <button type="button" className="primary" disabled={busy} onClick={() => void saveCommercial()}>{busy ? "Saving..." : `Save Ticket Booking — ${ubNumber}`}</button>}</div>
    </section>}

    {saved && editingId && <section className={`ticket17-additional ${detailsOpen ? "open" : ""}`}>
      <button type="button" className="ticket17-additional-toggle" onClick={() => setDetailsOpen((value) => !value)}><div><span>03</span><b>TICKET BOOKING DETAILS — {ubNumber}</b><small>Optional passenger, passport and flight journey information. This does not change Ticket accounting totals.</small></div><span className="ticket17-optional">{detailsOpen ? "CLOSE" : "OPTIONAL"}</span></button>
      {detailsOpen && <TicketOperationalDetails companyId={companyId} bookingId={editingId} ubNumber={ubNumber} adultPax={totals.qty.ADULT} childPax={totals.qty.CHILD} infantPax={totals.qty.INFANT} canEdit={canEdit} defaultAirline={firstCommercialRow?.airlineName || currentEntry?.airline_name || ""} defaultPnr={firstCommercialRow?.pnr || currentEntry?.pnr || ""} legacyDepartureDate={currentEntry?.departure_date || ""} legacyReturnDate={currentEntry?.return_date || ""} legacyFlightNo={currentEntry?.flight_no || ""} legacyDepartureTime={currentEntry?.departure_time || ""} legacyArrivalTime={currentEntry?.arrival_time || ""} fallbackNotes={currentEntry?.notes || ""} userId={userId} onSaved={() => loadEntries(search)} />}
    </section>}
  </section>;
}
