import { useEffect, useMemo, useState } from "react";
import type { TicketPassengerType } from "./db";
import type { TicketCommercialBooking, TicketFareFlightType } from "./TicketFlowDb";
import {
  getTicketAdjustmentHistory,
  saveTicketCancellation,
  saveTicketCorrectionOrAmendment,
  type TicketAdjustmentRecord,
  type TicketAdjustmentType,
} from "./TicketAdjustmentDb";
import { bookingAccountTerms, bookingLifecycleConfigs } from "./BookingLifecycle";
import "./PackageBookingAdjustment.css";

type Props = {
  companyId: string;
  booking: TicketCommercialBooking;
  userId?: string;
  canEdit?: boolean;
  initialView?: "ADJUSTMENT" | "HISTORY";
  onClose: () => void;
  onSaved?: (message: string) => void | Promise<void>;
};

type RowState = {
  rowId: string;
  sourceLineId: string;
  passengerType: TicketPassengerType;
  passengerName: string;
  airlineName: string;
  pnr: string;
  flightType: TicketFareFlightType;
  ticketRoute: string;
  rate: string;
  qty: string;
};

const amendmentCategories = bookingLifecycleConfigs.TICKET.amendmentTypes;
const flightOptions: Array<{ value: TicketFareFlightType; label: string }> = [
  { value: "ONE_WAY", label: "One Way" },
  { value: "RETURN", label: "Return" },
  { value: "MULTI_CITY", label: "Multi-City" },
];

function today() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function money(value: number) {
  return `Rs ${Number(value || 0).toLocaleString("en-PK", { maximumFractionDigits: 2 })}`;
}

function numberValue(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function signedMoney(value: number) {
  if (Math.abs(value) < 0.005) return money(0);
  return `${value > 0 ? "+" : "−"}${money(Math.abs(value))}`;
}

function lineTotalPkr(row: RowState) {
  return Math.max(0, numberValue(row.rate)) * Math.max(1, Math.trunc(numberValue(row.qty)));
}

function rowFromBooking(line: TicketCommercialBooking["lines"][number]): RowState {
  return {
    rowId: crypto.randomUUID(),
    sourceLineId: line.id,
    passengerType: line.passenger_type,
    passengerName: line.passenger_name,
    airlineName: line.airline_name,
    pnr: line.pnr,
    flightType: line.flight_type,
    ticketRoute: line.ticket_route,
    rate: String(Number(line.rate_per_ticket || 0)),
    qty: String(Math.max(1, Number(line.ticket_count || 1))),
  };
}

function newRow(): RowState {
  return {
    rowId: crypto.randomUUID(),
    sourceLineId: "",
    passengerType: "ADULT",
    passengerName: "",
    airlineName: "",
    pnr: "",
    flightType: "RETURN",
    ticketRoute: "",
    rate: "",
    qty: "1",
  };
}

function adjustmentLabel(type: TicketAdjustmentType) {
  if (type === "CORRECTION") return "Correction";
  if (type === "AMENDMENT") return "Amendment";
  if (type === "PARTIAL_CANCELLATION") return "Partial Cancellation";
  return "Full Cancellation";
}

export default function TicketBookingAdjustment({
  companyId,
  booking,
  userId = "",
  canEdit = true,
  initialView = "ADJUSTMENT",
  onClose,
  onSaved,
}: Props) {
  const [view, setView] = useState<"ADJUSTMENT" | "HISTORY">(initialView);
  const [adjustmentType, setAdjustmentType] = useState<TicketAdjustmentType | "">("");
  const [adjustmentDate, setAdjustmentDate] = useState(today());
  const [category, setCategory] = useState("");
  const [reason, setReason] = useState("");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [amendmentCharge, setAmendmentCharge] = useState("");
  const [credit, setCredit] = useState("");
  const [rows, setRows] = useState<RowState[]>(booking.lines.map(rowFromBooking));
  const [cancelQuantities, setCancelQuantities] = useState<Record<string, string>>({});
  const [history, setHistory] = useState<TicketAdjustmentRecord[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (view !== "HISTORY") return;
    void loadHistory();
  }, [view, companyId, booking.id]);

  async function loadHistory() {
    try {
      setHistory(await getTicketAdjustmentHistory(companyId, booking.id));
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const currentBase = useMemo(
    () => booking.lines.reduce((sum, line) => sum + Number(line.line_total_pkr || 0), 0),
    [booking.lines],
  );
  const carriedAdjustment = Number(booking.total_pkr || 0) - currentBase;
  const revisedBase = useMemo(() => rows.reduce((sum, row) => sum + lineTotalPkr(row), 0), [rows]);
  const chargeValue = Math.max(0, numberValue(amendmentCharge));
  const creditValue = Math.max(0, numberValue(credit));
  const revisedEffective =
    adjustmentType === "CORRECTION"
      ? revisedBase + carriedAdjustment
      : revisedBase + carriedAdjustment + chargeValue - creditValue;
  const baseDifference = revisedBase - currentBase;

  const cancelledValue = useMemo(() => {
    if (adjustmentType === "FULL_CANCELLATION") return currentBase;
    if (adjustmentType !== "PARTIAL_CANCELLATION") return 0;
    return booking.lines.reduce((sum, line) => {
      const available = Math.max(1, Math.trunc(Number(line.ticket_count || 1)));
      const qty = Math.max(0, Math.min(available, Math.trunc(numberValue(cancelQuantities[line.id] || "0"))));
      const unitPkr = available > 0 ? Number(line.line_total_pkr || 0) / available : 0;
      return sum + qty * unitPkr;
    }, 0);
  }, [adjustmentType, booking.lines, cancelQuantities, currentBase]);
  const cancellationCharge = Math.max(0, chargeValue);
  const cancellationEffective =
    adjustmentType === "FULL_CANCELLATION"
      ? Math.max(0, carriedAdjustment + cancellationCharge)
      : Math.max(0, Number(booking.total_pkr || 0) - cancelledValue + cancellationCharge);
  const cancellationCredit = Math.max(0, Number(booking.total_pkr || 0) - cancellationEffective);
  const accountTerms = bookingAccountTerms(booking.transaction_type);
  const accountNoun = accountTerms.accountImpact;
  const requestedBy = booking.transaction_type === "SALE" ? ("CUSTOMER" as const) : ("VENDOR" as const);

  function chooseType(type: TicketAdjustmentType) {
    setAdjustmentType(type);
    setAdjustmentDate(today());
    setCategory(type === "CORRECTION" ? "Data / Entry Correction" : type === "AMENDMENT" ? "" : adjustmentLabel(type));
    setReason("");
    setReference("");
    setNotes("");
    setAmendmentCharge("");
    setCredit("");
    setRows(booking.lines.map(rowFromBooking));
    setCancelQuantities({});
    setError("");
  }

  function updateRow(rowId: string, patch: Partial<RowState>) {
    setRows((current) => current.map((row) => (row.rowId === rowId ? { ...row, ...patch } : row)));
  }

  function removeRow(rowId: string) {
    setRows((current) => current.filter((row) => row.rowId !== rowId));
  }

  async function save() {
    if (!canEdit || !adjustmentType) return;
    setBusy(true);
    setError("");
    try {
      if (adjustmentType === "CORRECTION" || adjustmentType === "AMENDMENT") {
        const result = await saveTicketCorrectionOrAmendment(
          companyId,
          booking.id,
          {
            adjustmentType,
            adjustmentDate,
            requestedBy,
            category,
            reason,
            reference,
            notes,
            amendmentChargePkr: adjustmentType === "AMENDMENT" ? chargeValue : 0,
            creditPkr: adjustmentType === "AMENDMENT" ? creditValue : 0,
            lines: rows.map((row) => ({
              lineId: row.sourceLineId || undefined,
              passengerType: row.passengerType,
              passengerName: row.passengerName.trim(),
              airlineName: row.airlineName.trim(),
              pnr: row.pnr.trim().toUpperCase(),
              flightType: row.flightType,
              ticketRoute: row.ticketRoute.trim().toUpperCase(),
              ratePerTicket: numberValue(row.rate),
              ticketCount: Math.max(1, Math.trunc(numberValue(row.qty))),
            })),
          },
          userId,
        );
        await onSaved?.(
          `${adjustmentLabel(adjustmentType)} saved for ${booking.ub_number}. ${accountNoun} adjustment: ${signedMoney(result.delta)}. Current Ticket value: ${money(result.effectiveTotal)}.`,
        );
      } else {
        const result = await saveTicketCancellation(
          companyId,
          booking.id,
          {
            adjustmentType,
            adjustmentDate,
            requestedBy,
            reason,
            reference,
            notes,
            cancellationChargePkr: cancellationCharge,
            cancelQuantities: Object.fromEntries(
              Object.entries(cancelQuantities).map(([id, value]) => [id, Math.max(0, Math.trunc(numberValue(value)))]),
            ),
          },
          userId,
        );
        await onSaved?.(
          `${adjustmentLabel(adjustmentType)} saved for ${booking.ub_number}. Account credit: ${money(result.accountCredit)}. Current Ticket value: ${money(result.effectiveTotal)}.`,
        );
      }
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function renderSelection() {
    const choices: Array<{ type: TicketAdjustmentType; title: string; text: string; badge: string }> = [
      {
        type: "CORRECTION",
        title: "Correction",
        text: "Fix staff typing / data mistakes only. No fee, not a chargeable revision, and does not appear on Statements.",
        badge: "NO FEE · NOT A REVISION",
      },
      {
        type: "AMENDMENT",
        title: "Amendment",
        text: "Record a genuine post-booking commercial change. The result may be an extra charge, a credit, or no financial change.",
        badge: "COMMERCIAL",
      },
      {
        type: "PARTIAL_CANCELLATION",
        title: "Partial Cancellation",
        text: "Cancel selected Ticket rows / quantities and calculate cancellation charges and account credit.",
        badge: "SELECT ITEMS",
      },
      {
        type: "FULL_CANCELLATION",
        title: "Full Cancellation",
        text: "Cancel the complete Ticket booking while retaining any applicable cancellation charge.",
        badge: "FULL BOOKING",
      },
    ];
    return (
      <div className="adj-choice-grid">
        {choices.map((choice) => (
          <button
            type="button"
            key={choice.type}
            className={`adj-choice ${choice.type.toLowerCase()}`}
            onClick={() => chooseType(choice.type)}
            disabled={!canEdit}
          >
            <span>{choice.badge}</span>
            <b>{choice.title}</b>
            <p>{choice.text}</p>
            <strong>Continue →</strong>
          </button>
        ))}
      </div>
    );
  }

  function renderEditableRows() {
    return (
      <>
        <div className="adj-add-row-actions">
          <span>Revised Ticket Rows</span>
          <div>
            <button type="button" onClick={() => setRows((current) => [...current, newRow()])}>
              + Ticket Row
            </button>
          </div>
        </div>
        <div className="adj-lines-table-wrap">
          <table className="adj-lines-table">
            <thead>
              <tr>
                <th>PAX TYPE</th>
                <th>PASSENGER</th>
                <th>AIRLINE</th>
                <th>PNR</th>
                <th>FLIGHT TYPE</th>
                <th>ROUTE</th>
                <th>RATE / TICKET</th>
                <th>QTY</th>
                <th>LINE TOTAL PKR</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.rowId}>
                  <td>
                    <select
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
                      value={row.passengerName}
                      onChange={(e) => updateRow(row.rowId, { passengerName: e.target.value })}
                    />
                  </td>
                  <td>
                    <input
                      value={row.airlineName}
                      onChange={(e) => updateRow(row.rowId, { airlineName: e.target.value })}
                    />
                  </td>
                  <td>
                    <input
                      value={row.pnr}
                      onChange={(e) => updateRow(row.rowId, { pnr: e.target.value.toUpperCase() })}
                    />
                  </td>
                  <td>
                    <select
                      value={row.flightType}
                      onChange={(e) => updateRow(row.rowId, { flightType: e.target.value as TicketFareFlightType })}
                    >
                      {flightOptions.map((option) => (
                        <option value={option.value} key={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input
                      value={row.ticketRoute}
                      onChange={(e) => updateRow(row.rowId, { ticketRoute: e.target.value.toUpperCase() })}
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={row.rate}
                      onChange={(e) => updateRow(row.rowId, { rate: e.target.value })}
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      min="1"
                      step="1"
                      value={row.qty}
                      onChange={(e) => updateRow(row.rowId, { qty: e.target.value })}
                    />
                  </td>
                  <td>
                    <b>{money(lineTotalPkr(row))}</b>
                  </td>
                  <td>
                    <button type="button" className="adj-remove" onClick={() => removeRow(row.rowId)}>
                      ×
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </>
    );
  }

  function renderCancellationRows() {
    return (
      <div className="adj-lines-table-wrap">
        <table className="adj-lines-table cancellation">
          <thead>
            <tr>
              <th>PAX TYPE</th>
              <th>PASSENGER</th>
              <th>AIRLINE</th>
              <th>ROUTE</th>
              <th>AVAILABLE QTY</th>
              <th>CANCEL QTY</th>
              <th>CANCELLED VALUE</th>
            </tr>
          </thead>
          <tbody>
            {booking.lines.map((line) => {
              const available = Math.max(1, Math.trunc(Number(line.ticket_count || 1)));
              const qty =
                adjustmentType === "FULL_CANCELLATION"
                  ? available
                  : Math.max(0, Math.min(available, Math.trunc(numberValue(cancelQuantities[line.id] || "0"))));
              const unitPkr = available > 0 ? Number(line.line_total_pkr || 0) / available : 0;
              return (
                <tr key={line.id}>
                  <td>{line.passenger_type}</td>
                  <td>
                    <b>{line.passenger_name}</b>
                  </td>
                  <td>{line.airline_name}</td>
                  <td>{line.ticket_route}</td>
                  <td>{available}</td>
                  <td>
                    {adjustmentType === "FULL_CANCELLATION" ? (
                      <b>{available}</b>
                    ) : (
                      <input
                        type="number"
                        min="0"
                        max={available}
                        step="1"
                        value={cancelQuantities[line.id] || ""}
                        placeholder="0"
                        onChange={(e) => setCancelQuantities((current) => ({ ...current, [line.id]: e.target.value }))}
                      />
                    )}
                  </td>
                  <td>
                    <b>{money(qty * unitPkr)}</b>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }

  function renderHistory() {
    const first = history[0];
    const originalValue = first ? Number(first.previous_total_pkr || 0) : Number(booking.total_pkr || 0);
    const latestStatus = history.length ? history[history.length - 1].lifecycle_status : "ACTIVE";
    const revision = history.length ? Number(history[history.length - 1].revision_no || 1) : 1;
    return (
      <div className="adj-history-view">
        <div className="adj-history-summary">
          <div>
            <small>CURRENT STATUS</small>
            <b>{latestStatus}</b>
          </div>
          <div>
            <small>CURRENT REVISION</small>
            <b>REV {revision}</b>
          </div>
          <div>
            <small>CURRENT VALUE</small>
            <b>{money(booking.total_pkr)}</b>
          </div>
        </div>
        <div className="adj-timeline">
          <article className="adj-history-item original">
            <span>REV 1</span>
            <div>
              <small>{booking.transaction_date}</small>
              <h4>Original Ticket Booking</h4>
              <p>
                {booking.transaction_type} · {booking.counterparty_name || "Account"}
              </p>
            </div>
            <strong>{money(originalValue)}</strong>
          </article>
          {history.map((item) => (
            <article className={`adj-history-item ${item.adjustment_type.toLowerCase()}`} key={item.id}>
              <span>REV {item.revision_no}</span>
              <div>
                <small>{item.adjustment_date}</small>
                <h4>{adjustmentLabel(item.adjustment_type)}</h4>
                <p>
                  {item.category || "Booking adjustment"} — {item.reason}
                </p>
                {item.reference && <em>Ref: {item.reference}</em>}
                {item.notes && <em>{item.notes}</em>}
                <div className="adj-history-numbers">
                  <span>Previous {money(item.previous_total_pkr)}</span>
                  <span>Base after {money(item.revised_base_pkr)}</span>
                  {Number(item.charge_pkr) > 0 && <span>Charge +{money(item.charge_pkr)}</span>}
                  {Number(item.credit_pkr) > 0 && <span>Credit {money(item.credit_pkr)}</span>}
                </div>
              </div>
              <strong className={Number(item.account_delta_pkr) >= 0 ? "positive" : "negative"}>
                {signedMoney(Number(item.account_delta_pkr))}
                <small>→ {money(item.effective_total_pkr)}</small>
              </strong>
            </article>
          ))}
        </div>
        {!history.length && (
          <div className="adj-empty-history">
            No booking adjustments yet. This is still the original Ticket booking.
          </div>
        )}
      </div>
    );
  }

  const isCancellation = adjustmentType === "PARTIAL_CANCELLATION" || adjustmentType === "FULL_CANCELLATION";
  const previewTotal = isCancellation ? cancellationEffective : revisedEffective;
  const previewDelta = previewTotal - Number(booking.total_pkr || 0);

  return (
    <div className="modal-backdrop adj-backdrop" onMouseDown={(e) => e.currentTarget === e.target && onClose()}>
      <section className="adj-shell" onMouseDown={(e) => e.stopPropagation()}>
        <div className="adj-toolbar">
          <div>
            <span className="eyebrow blue">TICKET BOOKING</span>
            <h2>
              {view === "HISTORY"
                ? `Booking History — ${booking.ub_number}`
                : `Booking Adjustment — ${booking.ub_number}`}
            </h2>
            <p>
              {booking.counterparty_name || "Account"} · {booking.transaction_type} · Current Value{" "}
              {money(booking.total_pkr)}
            </p>
          </div>
          <div className="adj-toolbar-actions">
            {view === "ADJUSTMENT" ? (
              <button type="button" onClick={() => setView("HISTORY")}>
                History
              </button>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setView("ADJUSTMENT");
                  setAdjustmentType("");
                }}
              >
                Booking Adjustment
              </button>
            )}
            <button type="button" className="adj-close" onClick={onClose}>
              ×
            </button>
          </div>
        </div>
        {error && <div className="alert error adj-alert">{error}</div>}
        <div className="adj-body">
          {view === "HISTORY" ? (
            renderHistory()
          ) : (
            <>
              <div className="adj-identity-strip">
                <div>
                  <small>UB</small>
                  <b>{booking.ub_number}</b>
                </div>
                <div>
                  <small>ACCOUNT</small>
                  <b>{booking.counterparty_name || "—"}</b>
                </div>
                <div>
                  <small>BOOKING DATE</small>
                  <b>{booking.transaction_date}</b>
                </div>
                <div>
                  <small>TRANSACTION</small>
                  <b>{booking.transaction_type}</b>
                </div>
                <div>
                  <small>CURRENT VALUE</small>
                  <b>{money(booking.total_pkr)}</b>
                </div>
              </div>
              {!adjustmentType ? (
                <>
                  <div className="adj-intro">
                    <h3>What do you want to do?</h3>
                    <p>
                      Every option preserves the original UB and records a revision in Booking History. Refunds remain a
                      separate cash/bank movement in Payments.
                    </p>
                  </div>
                  {renderSelection()}
                </>
              ) : (
                <>
                  <button
                    type="button"
                    className="adj-back-choice"
                    onClick={() => {
                      setAdjustmentType("");
                      setError("");
                    }}
                  >
                    ← Change Adjustment Type
                  </button>
                  <section className="adj-section">
                    <div className="adj-section-title">
                      <span>01</span>
                      <div>
                        <b>{adjustmentLabel(adjustmentType).toUpperCase()} DETAILS</b>
                        <small>The genuine UB, Party/Vendor and original booking identity remain locked.</small>
                      </div>
                    </div>
                    <div className="adj-form-grid polished-header">
                      <label>
                        {isCancellation
                          ? "Cancellation Date"
                          : adjustmentType === "AMENDMENT"
                            ? "Amendment Date"
                            : "Correction Date"}{" "}
                        *
                        <input type="date" value={adjustmentDate} onChange={(e) => setAdjustmentDate(e.target.value)} />
                      </label>
                      {adjustmentType === "AMENDMENT" && (
                        <label>
                          Change Type *
                          <select value={category} onChange={(e) => setCategory(e.target.value)}>
                            <option value="">Select change type</option>
                            {amendmentCategories.map((item) => (
                              <option value={item} key={item}>
                                {item}
                              </option>
                            ))}
                          </select>
                        </label>
                      )}
                      <label className="wide">
                        Reason / Remarks *
                        <textarea
                          rows={2}
                          value={reason}
                          onChange={(e) => setReason(e.target.value)}
                          placeholder={
                            adjustmentType === "CORRECTION"
                              ? "e.g. Incorrect rate entered when booking was created"
                              : isCancellation
                                ? "Why is this booking being cancelled?"
                                : "Describe the genuine post-booking change"
                          }
                        />
                      </label>
                    </div>
                  </section>
                  <section className="adj-section">
                    <div className="adj-section-title">
                      <span>02</span>
                      <div>
                        <b>{isCancellation ? "CANCELLATION & ACCOUNTING" : "REVISED BOOKING & ACCOUNTING"}</b>
                        <small>
                          Review the commercial effect before saving. Payments/refunds are not created here.
                        </small>
                      </div>
                    </div>
                    {isCancellation ? renderCancellationRows() : renderEditableRows()}
                    {adjustmentType === "AMENDMENT" && (
                      <div className="adj-charge-grid">
                        <label>
                          {accountTerms.chargeLabel} (PKR)
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={amendmentCharge}
                            onChange={(e) => setAmendmentCharge(e.target.value)}
                            placeholder="0"
                          />
                          <small>{accountTerms.chargeHelp}</small>
                        </label>
                        <label>
                          {accountTerms.creditLabel} (PKR)
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={credit}
                            onChange={(e) => setCredit(e.target.value)}
                            placeholder="0"
                          />
                          <small>{accountTerms.creditHelp}</small>
                        </label>
                      </div>
                    )}
                    {isCancellation && (
                      <div className="adj-charge-grid">
                        <label>
                          Cancellation Charge (PKR)
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={amendmentCharge}
                            onChange={(e) => setAmendmentCharge(e.target.value)}
                            placeholder="0"
                          />
                          <small>Amount retained/charged despite cancellation.</small>
                        </label>
                        <div className="adj-credit-preview">
                          <small>NET ACCOUNT CREDIT</small>
                          <b>{money(cancellationCredit)}</b>
                          <span>
                            This is not a cash refund. Refund movement is recorded later in Payments if money is
                            returned.
                          </span>
                        </div>
                      </div>
                    )}
                    {adjustmentType === "AMENDMENT" ? (
                      <div className="adj-financial-breakdown">
                        <div>
                          <small>CURRENT EFFECTIVE VALUE</small>
                          <b>{money(booking.total_pkr)}</b>
                        </div>
                        <div>
                          <small>REVISED BASE VALUE</small>
                          <b>{money(revisedBase)}</b>
                        </div>
                        <div className={baseDifference > 0 ? "increase" : baseDifference < 0 ? "decrease" : "neutral"}>
                          <small>BASE DIFFERENCE</small>
                          <b>{signedMoney(baseDifference)}</b>
                        </div>
                        <div>
                          <small>{accountTerms.chargeLabel.toUpperCase()}</small>
                          <b>{chargeValue > 0 ? `+${money(chargeValue)}` : money(0)}</b>
                        </div>
                        <div>
                          <small>{accountTerms.creditLabel.toUpperCase()}</small>
                          <b>{creditValue > 0 ? `−${money(creditValue)}` : money(0)}</b>
                        </div>
                        <div className={previewDelta > 0 ? "increase" : previewDelta < 0 ? "decrease" : "neutral"}>
                          <small>FINAL {accountNoun.toUpperCase()} IMPACT</small>
                          <b>{signedMoney(previewDelta)}</b>
                        </div>
                        <div className="effective">
                          <small>NEW EFFECTIVE BOOKING VALUE</small>
                          <strong>{money(previewTotal)}</strong>
                        </div>
                      </div>
                    ) : (
                      <div className="adj-accounting-preview">
                        <div>
                          <small>BEFORE</small>
                          <b>{money(booking.total_pkr)}</b>
                        </div>
                        <div>
                          <small>{isCancellation ? "CANCELLED VALUE" : "REVISED BASE"}</small>
                          <b>{money(isCancellation ? cancelledValue : revisedBase)}</b>
                        </div>
                        <div className={previewDelta > 0 ? "increase" : previewDelta < 0 ? "decrease" : "neutral"}>
                          <small>{accountNoun.toUpperCase()} IMPACT</small>
                          <b>{signedMoney(previewDelta)}</b>
                        </div>
                        <div className="effective">
                          <small>NEW EFFECTIVE BOOKING VALUE</small>
                          <strong>{money(previewTotal)}</strong>
                        </div>
                      </div>
                    )}
                    {adjustmentType === "CORRECTION" && (
                      <div className="adj-rule-note">
                        <b>Correction:</b> typo/data fix only. No amendment fee. Kept in Booking History for audit, but
                        it does not bump commercial REV and does not appear on desktop Statements.
                      </div>
                    )}
                    {adjustmentType === "AMENDMENT" && (
                      <div className="adj-rule-note">
                        <b>Amendment:</b> revised base difference + {accountTerms.chargeLabel.toLowerCase()} −{" "}
                        {accountTerms.creditLabel.toLowerCase()} = final {accountNoun.toLowerCase()} impact. A genuine
                        change can therefore increase, decrease or leave the account unchanged.
                      </div>
                    )}
                  </section>
                  <section className="adj-section">
                    <div className="adj-section-title">
                      <span>03</span>
                      <div>
                        <b>SUPPORTING INFORMATION</b>
                        <small>
                          Reference and internal notes support the audit trail and do not independently change
                          accounting.
                        </small>
                      </div>
                    </div>
                    <div className="adj-form-grid">
                      <label>
                        Reference
                        <input
                          value={reference}
                          onChange={(e) => setReference(e.target.value)}
                          placeholder="Airline / supplier / internal reference"
                        />
                      </label>
                      <label className="wide">
                        Supporting / Internal Notes
                        <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
                      </label>
                    </div>
                  </section>
                </>
              )}
            </>
          )}
        </div>
        {view === "ADJUSTMENT" && adjustmentType ? (
          <div className="adj-savebar">
            <div>
              <small>FINAL PREVIEW</small>
              <b>
                {accountNoun}: {signedMoney(previewDelta)}
              </b>
              <span>Current value after save: {money(previewTotal)}</span>
            </div>
            <button type="button" className="primary" disabled={busy || !canEdit} onClick={() => void save()}>
              {busy ? "Saving Adjustment..." : `Save ${adjustmentLabel(adjustmentType)}`}
            </button>
          </div>
        ) : null}
      </section>
    </div>
  );
}
