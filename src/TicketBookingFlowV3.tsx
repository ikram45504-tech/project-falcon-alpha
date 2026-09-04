import { useEffect, useMemo, useState } from "react";
import type { BookingTransactionType, Party, TicketPassengerType } from "./db";
import ProgressiveBookingIdentity from "./ProgressiveBookingIdentity";
import { bookingDigitsFromUb, bookingUbFromDigits } from "./bookingUb";
import { useBookingFlowState } from "./useBookingFlowState";
import TicketOperationalDetails from "./TicketOperationalDetails";
import TicketRegister from "./TicketRegister";
import {
  createTicketCommercialBooking,
  getTicketCommercialBookings,
  type TicketCommercialBooking,
  type TicketCommercialLineInput,
  type TicketFareFlightType,
} from "./TicketFlowDb";
import "./TicketBookingFlow.css";
import { ticketRowHasData, ticketRowTotal, calculateTicketSummary } from "./pricingEngines";
import { useAuth } from "./AuthContext";
import { ADDITIONAL_BOOKING_DETAILS_UPGRADE, allowsAdditionalBookingDetails } from "./companyEntitlements";

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
  openBookingId?: string | null;
  onOpenBookingConsumed?: () => void;
};
type Row = {
  rowId: string;
  passengerType: TicketPassengerType;
  passengerName: string;
  airlineName: string;
  pnr: string;
  flightType: TicketFareFlightType;
  ticketRoute: string;
  rate: string;
  count: string;
  legacyEticketReference: string;
};

function newRow(): Row {
  return {
    rowId: crypto.randomUUID(),
    passengerType: "ADULT",
    passengerName: "",
    airlineName: "",
    pnr: "",
    flightType: "RETURN",
    ticketRoute: "",
    rate: "",
    count: "1",
    legacyEticketReference: "",
  };
}
function money(value: number) {
  return `Rs ${Number(value || 0).toLocaleString("en-PK", { maximumFractionDigits: 2 })}`;
}
function num(v: string) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
function whole(v: string) {
  return Math.max(0, Math.trunc(num(v)));
}

export default function TicketBookingFlowV2({
  companyId,
  parties,
  transactionType,
  userId = "",
  canCreate = true,
  canEdit = true,
  canVoid = true,
  onBack,
  onChanged,
  openBookingId = null,
  onOpenBookingConsumed,
}: Props) {
  const [entries, setEntries] = useState<TicketCommercialBooking[]>([]);
  const {
    mode,
    setMode,
    tx,
    setTx,
    counterpartyId,
    setCounterpartyId,
    bookingDate,
    setBookingDate,
    ubDigits,
    setUbDigits,
    ubNumber,
    setUbNumber,
    saved,
    setSaved,
    detailsOpen,
    setDetailsOpen,
    editingId,
    setEditingId,
    busy,
    setBusy,
    error,
    setError,
    message,
    setMessage,
    validateBookingUb,
  } = useBookingFlowState(companyId, transactionType, entries, "Ticket");
  const { company } = useAuth();
  const canAdditionalDetails = allowsAdditionalBookingDetails(company?.entitlements);
  const [rows, setRows] = useState<Row[]>([newRow()]);

  useEffect(() => {
    void loadEntries();
  }, [companyId]);

  useEffect(() => {
    if (!openBookingId) return;
    let cancelled = false;
    void (async () => {
      try {
        await openEntryById(openBookingId);
      } finally {
        if (!cancelled) onOpenBookingConsumed?.();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [openBookingId, companyId]);

  const totals = useMemo(() => calculateTicketSummary(rows), [rows]);
  const currentEntry = editingId ? entries.find((entry) => entry.id === editingId) || null : null;
  const firstCommercialRow = rows.find(ticketRowHasData) || rows[0];
  const commercialLocked = Boolean(editingId);

  async function loadEntries() {
    try {
      setEntries(await getTicketCommercialBookings(companyId));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  function updateRow(id: string, patch: Partial<Row>) {
    if (commercialLocked) return;
    setRows((current) => current.map((row) => (row.rowId === id ? { ...row, ...patch } : row)));
  }
  function addRow() {
    if (commercialLocked) return;
    setRows((current) => [...current, newRow()]);
  }
  function removeRow(id: string) {
    if (commercialLocked) return;
    setRows((current) => {
      const next = current.filter((row) => row.rowId !== id);
      return next.length ? next : [newRow()];
    });
  }

  function lineInputs(): TicketCommercialLineInput[] {
    return rows.filter(ticketRowHasData).map((row) => ({
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

  const ubPreview = bookingUbFromDigits(ubDigits);

  async function saveCommercial() {
    if (editingId)
      return setError(
        "Commercial Ticket values are locked after saving. Use Ticket Booking Register → Booking Adjustment for Correction, Amendment or Cancellation.",
      );
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const formatted = ubPreview;
      const valid = await validateBookingUb(formatted);
      if (!valid) return;
      setUbNumber(formatted);
      const id = await createTicketCommercialBooking(
        companyId,
        { transactionType: tx, counterpartyId, transactionDate: bookingDate, ubNumber: formatted, lines: lineInputs() },
        userId,
      );
      setEditingId(id);
      setSaved(true);
      setMessage(`Ticket booking ${formatted} saved. Additional booking details are available below.`);
      await loadEntries();
      await onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function openEntry(entry: TicketCommercialBooking) {
    if (entry.status !== "ACTIVE") return;
    setTx(entry.transaction_type);
    setCounterpartyId(entry.counterparty_id);
    setBookingDate(entry.transaction_date);
    setUbNumber(entry.ub_number);
    setUbDigits(bookingDigitsFromUb(entry.ub_number));
    setSaved(true);
    setDetailsOpen(false);
    setRows(
      entry.lines.length
        ? entry.lines.map((line) => ({
            rowId: crypto.randomUUID(),
            passengerType: line.passenger_type,
            passengerName: line.passenger_name,
            airlineName: line.airline_name,
            pnr: line.pnr,
            flightType: line.flight_type,
            ticketRoute: line.ticket_route,
            rate: String(line.rate_per_ticket || ""),
            count: String(line.ticket_count || 1),
            legacyEticketReference: line.eticket_reference || "",
          }))
        : [newRow()],
    );
    setEditingId(entry.id);
    setMode("FORM");
    setError("");
    setMessage(
      `Opened Ticket booking ${entry.ub_number}. Commercial values are read-only here; use Booking Adjustment from the Ticket Booking Register. Section 03 operational details remain available.`,
    );
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function openEntryById(bookingId: string) {
    const latest = await getTicketCommercialBookings(companyId);
    setEntries(latest);
    const entry = latest.find((item) => item.id === bookingId);
    if (entry) openEntry(entry);
  }

  async function lifecycleChanged() {
    await loadEntries();
    await onChanged?.();
  }

  if (mode === "REGISTER")
    return (
      <TicketRegister
        companyId={companyId}
        transactionType={transactionType}
        userId={userId}
        canEdit={canEdit}
        canVoid={canVoid}
        onBack={() => setMode("FORM")}
        onOpenBooking={openEntryById}
        onChanged={lifecycleChanged}
      />
    );

  return (
    <section className="booking-entry-screen ticket9-screen package14-page">
      <div className="booking-screen-toolbar ticket9-toolbar">
        <button className="booking-back-button" onClick={onBack}>
          ← Back to Booking Services
        </button>
        <div className="ticket9-toolbar-right">
          <span className={`direction-badge ${tx === "SALE" ? "sale" : "purchase"}`}>
            {tx === "SALE" ? "SALE TO PARTY" : "PURCHASE FROM VENDOR / SUPPLIER"}
          </span>
          <button className="ticket9-register-button" onClick={() => setMode("REGISTER")}>
            Ticket Booking Register
          </button>
        </div>
      </div>
      <div className="ticket9-title-row">
        <div>
          <span className="eyebrow blue">TICKET BOOKING</span>
          <h2>{saved ? `Ticket Booking — ${ubNumber}` : "New Ticket Booking"}</h2>
          <p>
            {editingId
              ? "Review the current effective Ticket booking. Commercial changes are protected by Booking Adjustment history."
              : "Complete account, UB, and ticket fares on one form, then save once. Additional booking details are optional."}
          </p>
        </div>
      </div>
      {message && <div className="alert success">{message}</div>}
      {error && <div className="alert error">{error}</div>}

      <section className="ticket9-card ticket9-unified-form">
        <ProgressiveBookingIdentity
          companyId={companyId}
          userId={userId}
          transactionType={tx}
          parties={parties}
          counterpartyId={counterpartyId}
          onCounterpartyChange={setCounterpartyId}
          bookingDate={bookingDate}
          onBookingDateChange={setBookingDate}
          ubDigits={ubDigits}
          onUbDigitsChange={setUbDigits}
          ubNumber={ubNumber}
          saved={saved}
          onAccountsChanged={onChanged}
          onError={setError}
          onMessage={setMessage}
          serviceLabel="Ticket"
          headerGridClass="ticket9-header-grid"
          unifiedHint="Party, date, and UB are saved together with ticket fares when you click Save Booking."
          embedded
        />

        <div className="ticket9-section-head ticket9-commercial-head">
          <span>2</span>
          <b>TICKET DETAILS &amp; FARES</b>
          <small>
            {commercialLocked
              ? "Current effective commercial rows — use Booking Adjustment to change them."
              : "Enter fares below, then save the full booking in one step."}
          </small>
        </div>
        <div className="ticket17-fare-head">
          {!commercialLocked && (
            <button type="button" className="ticket17-add-row" disabled={!canCreate} onClick={addRow}>
              + Ticket Row
            </button>
          )}
        </div>
        <div className="ticket17-fare-wrap">
          <table className="ticket17-fare-table">
            <thead>
              <tr>
                <th>SR</th>
                <th>PAX TYPE</th>
                <th>PASSENGER / FAMILY HEAD</th>
                <th>AIRLINE</th>
                <th>PNR</th>
                <th>FLIGHT TYPE</th>
                <th>TICKET ROUTE</th>
                <th>RATE / TICKET (PKR)</th>
                <th>QTY</th>
                <th>SUB TOTAL</th>
                {!commercialLocked && <th>ACTION</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={row.rowId}>
                  <td className="ticket17-sr">{index + 1}</td>
                  <td>
                    <select
                      disabled={commercialLocked}
                      value={row.passengerType}
                      onChange={(e) => updateRow(row.rowId, { passengerType: e.target.value as TicketPassengerType })}
                    >
                      <option value="ADULT">Adult</option>
                      <option value="CHILD">Child</option>
                      <option value="INFANT">Infant</option>
                    </select>
                  </td>
                  <td>
                    <input
                      disabled={commercialLocked}
                      value={row.passengerName}
                      onChange={(e) => updateRow(row.rowId, { passengerName: e.target.value })}
                      placeholder="Passenger / Family Head"
                    />
                  </td>
                  <td>
                    <input
                      disabled={commercialLocked}
                      value={row.airlineName}
                      onChange={(e) => updateRow(row.rowId, { airlineName: e.target.value })}
                      placeholder="Airline"
                    />
                  </td>
                  <td>
                    <input
                      disabled={commercialLocked}
                      className="ticket17-pnr-input"
                      value={row.pnr}
                      onChange={(e) => updateRow(row.rowId, { pnr: e.target.value.toUpperCase() })}
                      placeholder="PNR"
                    />
                  </td>
                  <td>
                    <select
                      disabled={commercialLocked}
                      className="ticket17-flight-type-select"
                      value={row.flightType}
                      onChange={(e) => updateRow(row.rowId, { flightType: e.target.value as TicketFareFlightType })}
                    >
                      <option value="ONE_WAY">One Way</option>
                      <option value="RETURN">Return</option>
                      <option value="MULTI_CITY">Multi-City</option>
                    </select>
                  </td>
                  <td>
                    <input
                      disabled={commercialLocked}
                      value={row.ticketRoute}
                      onChange={(e) => updateRow(row.rowId, { ticketRoute: e.target.value.toUpperCase() })}
                      placeholder="KHI - JED - KHI"
                    />
                  </td>
                  <td>
                    <input
                      disabled={commercialLocked}
                      type="number"
                      min="0"
                      step="0.01"
                      value={row.rate}
                      onChange={(e) => updateRow(row.rowId, { rate: e.target.value })}
                      placeholder="0"
                    />
                  </td>
                  <td>
                    <input
                      disabled={commercialLocked}
                      type="number"
                      min="1"
                      step="1"
                      value={row.count}
                      onChange={(e) => updateRow(row.rowId, { count: e.target.value })}
                      placeholder="1"
                    />
                  </td>
                  <td className="money-cell">{money(ticketRowTotal(row))}</td>
                  {!commercialLocked && (
                    <td>
                      <button type="button" className="ticket17-remove" onClick={() => removeRow(row.rowId)}>
                        ×
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="ticket9-summary-grid ticket17-summary">
          <section className="ticket9-summary-card">
            <div className="ticket9-category adult">
              <span>Adults</span>
              <b>{totals.qty.ADULT}</b>
              <small>{money(totals.amount.ADULT)}</small>
            </div>
            <div className="ticket9-category child">
              <span>Children</span>
              <b>{totals.qty.CHILD}</b>
              <small>{money(totals.amount.CHILD)}</small>
            </div>
            <div className="ticket9-category infant">
              <span>Infants</span>
              <b>{totals.qty.INFANT}</b>
              <small>{money(totals.amount.INFANT)}</small>
            </div>
            <div className="ticket9-total-tickets">
              <span>Total Tickets</span>
              <b>{totals.total}</b>
            </div>
          </section>
          <section className="ticket9-grand">
            <span>GRAND TICKET TOTAL</span>
            <b>{money(totals.grand)}</b>
          </section>
        </div>
        <div className="ticket17-commercial-actions">
          {!editingId && canCreate && (
            <button type="button" className="primary" disabled={busy} onClick={() => void saveCommercial()}>
              {busy ? "Saving..." : `Save Ticket Booking — ${ubPreview || "UB-0000"}`}
            </button>
          )}
          {editingId && (
            <div className="adj-rule-note">
              <b>Commercial values locked:</b> use Ticket Booking Register → Booking Adjustment for Correction,
              Amendment, Partial Cancellation or Full Cancellation.
            </div>
          )}
        </div>
      </section>

      {saved && editingId && (
        <section className={`ticket17-additional ${detailsOpen ? "open" : ""}`}>
          <button
            type="button"
            className="ticket17-additional-toggle"
            disabled={!canAdditionalDetails}
            title={canAdditionalDetails ? undefined : ADDITIONAL_BOOKING_DETAILS_UPGRADE}
            onClick={() => {
              if (!canAdditionalDetails) {
                setMessage(ADDITIONAL_BOOKING_DETAILS_UPGRADE);
                return;
              }
              setDetailsOpen((value) => !value);
            }}
          >
            <div>
              <b>ADDITIONAL BOOKING DETAILS — {ubNumber}</b>
              <small>
                Optional passenger, passport and flight journey information. This does not change Ticket accounting
                totals.
              </small>
            </div>
            <span className="ticket17-optional">{detailsOpen ? "HIDE" : "SHOW"}</span>
          </button>
          {detailsOpen && (
            <TicketOperationalDetails
              companyId={companyId}
              bookingId={editingId}
              ubNumber={ubNumber}
              adultPax={totals.qty.ADULT}
              childPax={totals.qty.CHILD}
              infantPax={totals.qty.INFANT}
              canEdit={canEdit}
              defaultAirline={firstCommercialRow?.airlineName || currentEntry?.airline_name || ""}
              defaultPnr={firstCommercialRow?.pnr || currentEntry?.pnr || ""}
              legacyDepartureDate={currentEntry?.departure_date || ""}
              legacyReturnDate={currentEntry?.return_date || ""}
              legacyFlightNo={currentEntry?.flight_no || ""}
              legacyDepartureTime={currentEntry?.departure_time || ""}
              legacyArrivalTime={currentEntry?.arrival_time || ""}
              fallbackNotes={currentEntry?.notes || ""}
              userId={userId}
              onSaved={() => loadEntries()}
            />
          )}
        </section>
      )}
    </section>
  );
}
