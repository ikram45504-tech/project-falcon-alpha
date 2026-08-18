import { useEffect, useMemo, useState } from "react";
import {
  BookingTransactionType,
  Party,
  TicketBooking,
  TicketBookingInput,
  TicketBookingLineInput,
  TicketPassengerType,
  TicketTravelStatus,
  createTicketBooking,
  getTicketBookings,
  updateTicketBooking,
  voidTicketBooking,
} from "./db";

type Props = {
  companyId: string;
  parties: Party[];
  transactionType: BookingTransactionType;
  userId?: string;
  canCreate?: boolean;
  canEdit?: boolean;
  canVoid?: boolean;
  onBack: () => void;
  onChanged?: () => void | Promise<void>;
};

type TicketRowState = {
  rowId: string;
  passengerType: TicketPassengerType;
  passengerName: string;
  eticketReference: string;
  rate: string;
  count: string;
};

type ViewMode = "FORM" | "REGISTER";
type RegisterFilter = "ALL" | BookingTransactionType;

function localDate() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function newRow(type: TicketPassengerType): TicketRowState {
  return {
    rowId: crypto.randomUUID(),
    passengerType: type,
    passengerName: "",
    eticketReference: "",
    rate: "",
    count: "",
  };
}

function money(value: number) {
  return `Rs ${Number(value || 0).toLocaleString("en-PK", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })}`;
}

function numberValue(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function explicitCount(value: string) {
  return Math.max(0, Math.trunc(numberValue(value)));
}

function effectiveCount(value: string) {
  return value.trim() === "" ? 1 : explicitCount(value);
}

function rowHasData(row: TicketRowState) {
  return Boolean(
    row.passengerName.trim() ||
    row.eticketReference.trim() ||
    row.rate.trim() ||
    row.count.trim()
  );
}

function rowTickets(row: TicketRowState) {
  return rowHasData(row) ? effectiveCount(row.count) : 0;
}

function rowTotal(row: TicketRowState) {
  return rowHasData(row) ? Math.max(0, numberValue(row.rate)) * effectiveCount(row.count) : 0;
}

function typeLabel(type: TicketPassengerType) {
  if (type === "ADULT") return "Adult";
  if (type === "CHILD") return "Child";
  return "Infant";
}

export default function TicketBookingModule({
  companyId,
  parties,
  transactionType,
  userId = "",
  canCreate = true,
  canEdit = true,
  canVoid = true,
  onBack,
  onChanged,
}: Props) {
  const [mode, setMode] = useState<ViewMode>("FORM");
  const [activeTransactionType, setActiveTransactionType] = useState<BookingTransactionType>(transactionType);
  const [counterpartyId, setCounterpartyId] = useState("");
  const [bookingDate, setBookingDate] = useState(localDate());
  const [ubNumber, setUbNumber] = useState("");

  const [airlineName, setAirlineName] = useState("");
  const [pnr, setPnr] = useState("");
  const [sector, setSector] = useState("");
  const [departureDate, setDepartureDate] = useState("");
  const [returnDate, setReturnDate] = useState("");

  const [rows, setRows] = useState<TicketRowState[]>([newRow("ADULT")]);

  const [flightNo, setFlightNo] = useState("");
  const [departureTime, setDepartureTime] = useState("");
  const [arrivalTime, setArrivalTime] = useState("");
  const [baggage, setBaggage] = useState("");
  const [ticketStatus, setTicketStatus] = useState<TicketTravelStatus>("");
  const [customerContact, setCustomerContact] = useState("");
  const [notes, setNotes] = useState("");

  const [entries, setEntries] = useState<TicketBooking[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [search, setSearch] = useState("");
  const [registerFilter, setRegisterFilter] = useState<RegisterFilter>("ALL");

  useEffect(() => {
    if (!editingId) setActiveTransactionType(transactionType);
  }, [transactionType, editingId]);

  useEffect(() => {
    void loadEntries("");
  }, [companyId]);

  const eligibleAccounts = useMemo(() => {
    const wanted = activeTransactionType === "SALE" ? "PARTY" : "VENDOR";
    return parties.filter((item) => item.status === "ACTIVE" && item.account_type === wanted);
  }, [parties, activeTransactionType]);

  const airlineSuggestions = useMemo(() => {
    const values = new Set<string>();
    for (const entry of entries) if (entry.airline_name.trim()) values.add(entry.airline_name.trim());
    return Array.from(values).sort((a, b) => a.localeCompare(b));
  }, [entries]);

  const totals = useMemo(() => {
    const qty = { ADULT: 0, CHILD: 0, INFANT: 0 };
    const amount = { ADULT: 0, CHILD: 0, INFANT: 0 };
    for (const row of rows) {
      qty[row.passengerType] += rowTickets(row);
      amount[row.passengerType] += rowTotal(row);
    }
    return { qty, amount };
  }, [rows]);

  const totalTickets = totals.qty.ADULT + totals.qty.CHILD + totals.qty.INFANT;
  const grandTotal = totals.amount.ADULT + totals.amount.CHILD + totals.amount.INFANT;

  const activeEntries = entries.filter((entry) => entry.status === "ACTIVE");
  const saleTotal = activeEntries
    .filter((entry) => entry.transaction_type === "SALE")
    .reduce((sum, entry) => sum + Number(entry.total_pkr || 0), 0);
  const purchaseTotal = activeEntries
    .filter((entry) => entry.transaction_type === "PURCHASE")
    .reduce((sum, entry) => sum + Number(entry.total_pkr || 0), 0);
  const registerTickets = activeEntries.reduce(
    (sum, entry) => sum + entry.lines.reduce((lineSum, line) => lineSum + Number(line.ticket_count || 0), 0),
    0
  );
  const visibleEntries = entries.filter(
    (entry) => registerFilter === "ALL" || entry.transaction_type === registerFilter
  );

  async function loadEntries(nextSearch = search) {
    try {
      setEntries(await getTicketBookings(companyId, nextSearch));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  function resetForm(options?: { keepDirection?: boolean }) {
    if (!options?.keepDirection) setActiveTransactionType(transactionType);
    setCounterpartyId("");
    setBookingDate(localDate());
    setUbNumber("");
    setAirlineName("");
    setPnr("");
    setSector("");
    setDepartureDate("");
    setReturnDate("");
    setRows([newRow("ADULT")]);
    setFlightNo("");
    setDepartureTime("");
    setArrivalTime("");
    setBaggage("");
    setTicketStatus("");
    setCustomerContact("");
    setNotes("");
    setEditingId(null);
    setError("");
  }

  function addRow(type: TicketPassengerType) {
    setRows((current) => [...current, newRow(type)]);
  }

  function updateRow(rowId: string, patch: Partial<TicketRowState>) {
    setRows((current) => current.map((row) => (row.rowId === rowId ? { ...row, ...patch } : row)));
  }

  function removeRow(rowId: string) {
    setRows((current) => {
      const next = current.filter((row) => row.rowId !== rowId);
      return next.length ? next : [newRow("ADULT")];
    });
  }

  function buildInput(): TicketBookingInput {
    const lineInputs: TicketBookingLineInput[] = rows
      .filter(rowHasData)
      .map((row) => ({
        passengerType: row.passengerType,
        passengerName: row.passengerName.trim(),
        eticketReference: row.eticketReference.trim(),
        ratePerTicket: Math.max(0, numberValue(row.rate)),
        ticketCount: row.count.trim() === "" ? null : explicitCount(row.count),
        qtyIsExplicit: row.count.trim() !== "",
      }));

    return {
      transactionType: activeTransactionType,
      counterpartyId,
      transactionDate: bookingDate,
      ubNumber,
      airlineName,
      pnr,
      sector,
      departureDate,
      returnDate,
      flightNo,
      departureTime,
      arrivalTime,
      baggage,
      ticketStatus,
      customerContact,
      notes,
      lines: lineInputs,
    };
  }

  async function save() {
    if (busy) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const input = buildInput();
      if (editingId) {
        await updateTicketBooking(companyId, editingId, input, userId);
        setMessage(`Ticket booking ${input.ubNumber.trim()} updated successfully.`);
      } else {
        await createTicketBooking(companyId, input, userId);
        setMessage(`Ticket booking ${input.ubNumber.trim()} saved successfully.`);
      }
      await loadEntries("");
      if (onChanged) await onChanged();
      resetForm({ keepDirection: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function edit(entry: TicketBooking) {
    setActiveTransactionType(entry.transaction_type);
    setCounterpartyId(entry.counterparty_id);
    setBookingDate(entry.transaction_date);
    setUbNumber(entry.ub_number);
    setAirlineName(entry.airline_name);
    setPnr(entry.pnr);
    setSector(entry.sector);
    setDepartureDate(entry.departure_date);
    setReturnDate(entry.return_date);
    setFlightNo(entry.flight_no);
    setDepartureTime(entry.departure_time);
    setArrivalTime(entry.arrival_time);
    setBaggage(entry.baggage);
    setTicketStatus((entry.ticket_status || "") as TicketTravelStatus);
    setCustomerContact(entry.customer_contact);
    setNotes(entry.notes);
    setRows(
      entry.lines.length
        ? entry.lines.map((line) => ({
            rowId: crypto.randomUUID(),
            passengerType: line.passenger_type,
            passengerName: line.passenger_name,
            eticketReference: line.eticket_reference,
            rate: String(line.rate_per_ticket || ""),
            count: Number(line.qty_is_explicit || 0) === 1 ? String(line.ticket_count || "") : "",
          }))
        : [newRow("ADULT")]
    );
    setEditingId(entry.id);
    setError("");
    setMessage("");
    setMode("FORM");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function voidEntry(entry: TicketBooking) {
    if (!canVoid || entry.status !== "ACTIVE" || busy) return;
    if (!window.confirm(`Void Ticket booking ${entry.ub_number}? This keeps the audit record but removes it from active totals.`)) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await voidTicketBooking(companyId, entry.id, userId);
      await loadEntries(search);
      if (onChanged) await onChanged();
      setMessage(`Ticket booking ${entry.ub_number} voided.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function changeSearch(value: string) {
    setSearch(value);
    await loadEntries(value);
  }

  function renderForm() {
    const accountLabel = activeTransactionType === "SALE" ? "Party Name" : "Vendor / Supplier Name";
    return (
      <section className="booking-entry-screen ticket9-screen">
        <div className="booking-screen-toolbar ticket9-toolbar">
          <button type="button" className="booking-back-button" onClick={onBack}>← Back to Booking Services</button>
          <div className="ticket9-toolbar-right">
            <span className={`direction-badge ${activeTransactionType === "SALE" ? "sale" : "purchase"}`}>
              {activeTransactionType === "SALE" ? "SALE TO PARTY" : "PURCHASE FROM VENDOR / SUPPLIER"}
            </span>
            <button type="button" className="ticket9-register-button" onClick={() => { setMode("REGISTER"); setMessage(""); setError(""); }}>
              Ticket Booking Register
            </button>
          </div>
        </div>

        <div className="ticket9-title-row">
          <div>
            <span className="eyebrow blue">TICKET BOOKING</span>
            <h2>{editingId ? "Edit Ticket Booking" : "New Ticket Booking"}</h2>
            <p>PKR ticket booking with flexible Adult, Child and Infant fare rows. Qty left blank is treated as 1 ticket.</p>
          </div>
        </div>

        {message && <div className="alert success">{message}</div>}
        {error && <div className="alert error">{error}</div>}

        <section className="ticket9-card">
          <div className="ticket9-section-head"><span>1</span><b>BOOKING HEADER</b></div>
          <div className="ticket9-header-grid">
            <label>{accountLabel} *
              <select value={counterpartyId} onChange={(e) => setCounterpartyId(e.target.value)}>
                <option value="">Select {activeTransactionType === "SALE" ? "Party" : "Vendor / Supplier"}</option>
                {eligibleAccounts.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
            </label>
            <label>Date of Booking *<input type="date" value={bookingDate} onChange={(e) => setBookingDate(e.target.value)} /></label>
            <label>UB / Booking # *<input value={ubNumber} onChange={(e) => setUbNumber(e.target.value)} placeholder="e.g. UB-1050" /></label>
          </div>
        </section>

        <section className="ticket9-card">
          <div className="ticket9-section-head"><span>2</span><b>TICKET / JOURNEY DETAILS</b><small>Common for the whole booking</small></div>
          <div className="ticket9-journey-grid">
            <label>Airline Name *
              <input list="ticket-airlines" value={airlineName} onChange={(e) => setAirlineName(e.target.value)} placeholder="e.g. Saudi Airlines" />
              <datalist id="ticket-airlines">{airlineSuggestions.map((item) => <option value={item} key={item} />)}</datalist>
            </label>
            <label>PNR<input value={pnr} onChange={(e) => setPnr(e.target.value)} placeholder="e.g. X7KLM2" /></label>
            <label>Sector / Route *<input value={sector} onChange={(e) => setSector(e.target.value)} placeholder="e.g. LHE-JED-LHE" /></label>
            <label>Departure Date *<input type="date" value={departureDate} onChange={(e) => setDepartureDate(e.target.value)} /></label>
            <label>Return Date<input type="date" value={returnDate} onChange={(e) => setReturnDate(e.target.value)} /></label>
          </div>
        </section>

        <section className="ticket9-card">
          <div className="ticket9-passenger-head">
            <div className="ticket9-section-head no-margin"><span>3</span><b>PASSENGER / FARE DETAILS</b></div>
            <div className="ticket9-add-buttons">
              <button type="button" onClick={() => addRow("ADULT")}>+ Adult</button>
              <button type="button" onClick={() => addRow("CHILD")}>+ Child</button>
              <button type="button" onClick={() => addRow("INFANT")}>+ Infant</button>
            </div>
          </div>
          <p className="ticket9-section-help">Use a passenger name for a single ticket, or a family head name with Qty for multiple passengers of the same type and rate.</p>

          <div className="ticket9-table-wrap">
            <table className="ticket9-fare-table">
              <thead><tr><th>#</th><th>Type *</th><th>Passenger / Family Head Name *</th><th>E-Ticket / Reference</th><th>Rate Per Ticket (PKR) *</th><th>Qty (Optional)</th><th>Sub Total (PKR)</th><th>Action</th></tr></thead>
              <tbody>
                {rows.map((row, index) => (
                  <tr key={row.rowId}>
                    <td className="ticket9-row-number">{index + 1}</td>
                    <td><select value={row.passengerType} onChange={(e) => updateRow(row.rowId, { passengerType: e.target.value as TicketPassengerType })}><option value="ADULT">Adult</option><option value="CHILD">Child</option><option value="INFANT">Infant</option></select></td>
                    <td><input value={row.passengerName} onChange={(e) => updateRow(row.rowId, { passengerName: e.target.value })} placeholder="Passenger or family head" /></td>
                    <td><input value={row.eticketReference} onChange={(e) => updateRow(row.rowId, { eticketReference: e.target.value })} placeholder="Optional" /></td>
                    <td><input type="number" min="0" step="0.01" value={row.rate} onChange={(e) => updateRow(row.rowId, { rate: e.target.value })} placeholder="0" /></td>
                    <td><input type="number" min="1" step="1" value={row.count} onChange={(e) => updateRow(row.rowId, { count: e.target.value })} placeholder="Blank = 1" /></td>
                    <td className="ticket9-row-total">{money(rowTotal(row))}</td>
                    <td><button type="button" className="ticket9-remove" onClick={() => removeRow(row.rowId)} aria-label={`Remove ${typeLabel(row.passengerType)} row`}>×</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="ticket9-qty-note">Qty blank = 1 ticket. If Qty is entered, Sub Total = Rate Per Ticket × Qty.</div>
        </section>

        <div className="ticket9-summary-grid">
          <section className="ticket9-summary-card">
            <div className="ticket9-category adult"><span>Adults</span><b>{totals.qty.ADULT}</b><small>Sub Total <strong>{money(totals.amount.ADULT)}</strong></small></div>
            <div className="ticket9-category child"><span>Children</span><b>{totals.qty.CHILD}</b><small>Sub Total <strong>{money(totals.amount.CHILD)}</strong></small></div>
            <div className="ticket9-category infant"><span>Infants</span><b>{totals.qty.INFANT}</b><small>Sub Total <strong>{money(totals.amount.INFANT)}</strong></small></div>
            <div className="ticket9-category total"><span>Total Tickets</span><b>{totalTickets}</b><small>All fare rows</small></div>
          </section>
          <section className="ticket9-grand-total"><span>GRAND TICKET TOTAL</span><b>{money(grandTotal)}</b><small>Adults + Children + Infants · PKR only</small></section>
        </div>

        <section className="ticket9-card ticket9-optional-card">
          <div className="ticket9-section-head"><span>4</span><b>TICKET BOOKING DETAILS</b><small>Optional information for this UB / Booking</small><em>OPTIONAL</em></div>
          <div className="ticket9-optional-grid">
            <label>Flight No.<input value={flightNo} onChange={(e) => setFlightNo(e.target.value)} placeholder="e.g. SV-739 / SV-738" /></label>
            <label>Departure Time<input type="time" value={departureTime} onChange={(e) => setDepartureTime(e.target.value)} /></label>
            <label>Arrival Time<input type="time" value={arrivalTime} onChange={(e) => setArrivalTime(e.target.value)} /></label>
            <label>Baggage<input value={baggage} onChange={(e) => setBaggage(e.target.value)} placeholder="e.g. 30 KG / 2 Pieces" /></label>
            <label>Ticket Status
              <select value={ticketStatus} onChange={(e) => setTicketStatus(e.target.value as TicketTravelStatus)}>
                <option value="">Not specified</option>
                <option value="RESERVED">Reserved</option>
                <option value="ISSUED">Issued</option>
                <option value="CANCELLED">Cancelled</option>
                <option value="REFUNDED">Refunded</option>
              </select>
              <small className="ticket9-field-help">Information only. Void controls the accounting record.</small>
            </label>
            <label>Contact of Customer<input value={customerContact} onChange={(e) => setCustomerContact(e.target.value)} placeholder="Customer / family contact" /></label>
            <label className="ticket9-notes">Notes<textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional notes about this Ticket booking" /></label>
          </div>
        </section>

        <div className="ticket9-actions">
          {editingId && <button type="button" className="secondary" disabled={busy} onClick={() => { resetForm({ keepDirection: false }); setMessage(""); }}>Cancel Edit</button>}
          {((editingId && canEdit) || (!editingId && canCreate)) && (
            <button type="button" className={`primary ${activeTransactionType === "PURCHASE" ? "package-purchase-save" : "package-sale-save"}`} disabled={busy} onClick={() => void save()}>
              {busy ? "Saving..." : editingId ? `Update ${activeTransactionType}` : `Save ${activeTransactionType}`}
            </button>
          )}
        </div>
      </section>
    );
  }

  function renderRegister() {
    return (
      <section className="booking-entry-screen ticket9-screen ticket9-register-screen">
        <div className="booking-screen-toolbar ticket9-toolbar">
          <button type="button" className="booking-back-button" onClick={() => { setMode("FORM"); setError(""); }}>← Back to Ticket Booking</button>
          <span className="booking-foundation-badge active-engine">TICKET REGISTER</span>
        </div>

        <div className="ticket9-register-title">
          <div><span className="eyebrow blue">TICKET BOOKING REGISTER</span><h2>Ticket Booking Register</h2><p>Ticket Sale and Purchase bookings are kept together and remain linked by UB # for future cost and margin reporting.</p></div>
          <div className="ticket9-mini-stats"><div><small>ACTIVE</small><b>{activeEntries.length}</b></div><div className="sale"><small>SALES</small><b>{money(saleTotal)}</b></div><div className="purchase"><small>PURCHASES</small><b>{money(purchaseTotal)}</b></div><div><small>TICKETS</small><b>{registerTickets}</b></div></div>
        </div>

        {message && <div className="alert success">{message}</div>}
        {error && <div className="alert error">{error}</div>}

        <div className="ticket9-register-controls">
          <div className="package-register-filter-tabs">
            {(["ALL", "SALE", "PURCHASE"] as RegisterFilter[]).map((item) => <button type="button" key={item} className={registerFilter === item ? "active" : ""} onClick={() => setRegisterFilter(item)}>{item === "ALL" ? "All Ticket Bookings" : item === "SALE" ? "Sales" : "Purchases"}</button>)}
          </div>
          <div className="search-box package-search"><span>⌕</span><input value={search} onChange={(e) => void changeSearch(e.target.value)} placeholder="Search UB #, Party/Vendor, Airline, PNR, Sector, Passenger or E-Ticket..." /></div>
        </div>

        {visibleEntries.length === 0 ? (
          <div className="empty-state compact-empty"><div className="empty-icon">TKT</div><h3>No ticket bookings found</h3><p>Create a Ticket booking or change the register filter/search.</p></div>
        ) : (
          <div className="party-table-wrap ticket9-register-wrap">
            <table className="party-table ticket9-register-table">
              <thead><tr><th>DATE</th><th>UB #</th><th>TYPE</th><th>PARTY / VENDOR</th><th>AIRLINE / JOURNEY</th><th>PASSENGER / FARE ROWS</th><th>TICKETS</th><th>TOTAL PKR</th><th>STATUS</th><th>ACTIONS</th></tr></thead>
              <tbody>{visibleEntries.map((entry) => {
                const ticketCount = entry.lines.reduce((sum, line) => sum + Number(line.ticket_count || 0), 0);
                return <tr key={entry.id} className={entry.status === "VOID" ? "void-row" : ""}>
                  <td>{entry.transaction_date}</td>
                  <td><b>{entry.ub_number}</b></td>
                  <td><span className={`direction-badge ${entry.transaction_type === "SALE" ? "sale" : "purchase"}`}>{entry.transaction_type}</span></td>
                  <td><b>{entry.counterparty_name || "—"}</b></td>
                  <td><div className="ticket9-journey-cell"><b>{entry.airline_name}</b><span>{entry.sector}</span><small>{entry.pnr ? `PNR: ${entry.pnr}` : "PNR: —"} · {entry.departure_date || "—"}{entry.return_date ? ` → ${entry.return_date}` : ""}</small></div></td>
                  <td><div className="ticket9-history-lines">{entry.lines.map((line) => <div key={line.id}><span className={`passenger-chip ${line.passenger_type.toLowerCase()}`}>{line.passenger_type}</span><b>{line.passenger_name}</b><small>{line.ticket_count} × {money(line.rate_per_ticket)} = {money(line.line_total_pkr)}{line.eticket_reference ? ` · ${line.eticket_reference}` : ""}</small></div>)}</div></td>
                  <td className="centered"><b>{ticketCount}</b></td>
                  <td className="amount"><b>{money(entry.total_pkr)}</b></td>
                  <td><span className={`status ${entry.status.toLowerCase()}`}>{entry.status}</span></td>
                  <td><div className="row-actions"><button type="button" disabled={!canEdit || entry.status !== "ACTIVE" || busy} onClick={() => edit(entry)}>Edit</button><button type="button" disabled={!canVoid || entry.status !== "ACTIVE" || busy} onClick={() => void voidEntry(entry)}>Void</button></div></td>
                </tr>;
              })}</tbody>
            </table>
          </div>
        )}
      </section>
    );
  }

  return mode === "REGISTER" ? renderRegister() : renderForm();
}
