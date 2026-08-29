import { useEffect, useMemo, useState } from "react";
import {
  bookingAccountTerms,
  bookingLifecycleConfigs,
  type BookingAdjustmentKind,
  type BookingLifecycleStatus,
  type BookingServiceName,
} from "./BookingLifecycle";
import type { BookingTransactionType } from "./db";
import {
  getUniversalBookingAdjustmentHistory,
  recordUniversalBookingAdjustment,
  type UniversalAdjustmentRecord,
} from "./UniversalBookingAdjustmentDb";
import "./PackageBookingAdjustment.css";

export type UniversalAdjustmentOption = { value: string; label: string };
export type UniversalAdjustmentColumn = {
  key: string;
  label: string;
  type?: "text" | "number" | "date" | "select";
  options?: UniversalAdjustmentOption[];
  min?: number;
  step?: number;
  placeholder?: string;
};

export type UniversalAdjustmentRow = {
  id: string;
  values: Record<string, string>;
};

export type UniversalAdjustmentBooking = {
  id: string;
  transaction_type: BookingTransactionType;
  counterparty_name: string;
  transaction_date: string;
  ub_number: string;
  total_pkr: number;
};

type Props = {
  companyId: string;
  service: BookingServiceName;
  booking: UniversalAdjustmentBooking;
  userId?: string;
  canEdit?: boolean;
  initialView?: "ADJUSTMENT" | "HISTORY";
  columns: UniversalAdjustmentColumn[];
  initialRows: UniversalAdjustmentRow[];
  createRow?: () => UniversalAdjustmentRow;
  describeRow: (row: UniversalAdjustmentRow, index: number) => string;
  calculateLineTotalPkr: (row: UniversalAdjustmentRow) => number;
  quantityFor: (row: UniversalAdjustmentRow) => number;
  withQuantity: (row: UniversalAdjustmentRow, quantity: number) => UniversalAdjustmentRow;
  onApplyRows: (rows: UniversalAdjustmentRow[]) => Promise<number>;
  onClose: () => void;
  onSaved?: (message: string) => void | Promise<void>;
};

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function num(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function money(value: number) {
  return `Rs ${Number(value || 0).toLocaleString("en-PK", { maximumFractionDigits: 2 })}`;
}

function signedMoney(value: number) {
  if (Math.abs(value) < 0.005) return money(0);
  return `${value > 0 ? "+" : "−"}${money(Math.abs(value))}`;
}

function kindLabel(type: BookingAdjustmentKind) {
  if (type === "CORRECTION") return "Correction";
  if (type === "AMENDMENT") return "Amendment";
  if (type === "PARTIAL_CANCELLATION") return "Partial Cancellation";
  return "Full Cancellation";
}

function cloneRows(rows: UniversalAdjustmentRow[]) {
  return rows.map((row) => ({ id: row.id || crypto.randomUUID(), values: { ...row.values } }));
}

export default function UniversalBookingAdjustment({
  companyId,
  service,
  booking,
  userId = "",
  canEdit = true,
  initialView = "ADJUSTMENT",
  columns,
  initialRows,
  createRow,
  describeRow,
  calculateLineTotalPkr,
  quantityFor,
  withQuantity,
  onApplyRows,
  onClose,
  onSaved,
}: Props) {
  const config = bookingLifecycleConfigs[service];
  const accountTerms = bookingAccountTerms(booking.transaction_type);
  const [view, setView] = useState<"ADJUSTMENT" | "HISTORY">(initialView);
  const [adjustmentType, setAdjustmentType] = useState<BookingAdjustmentKind | "">("");
  const [adjustmentDate, setAdjustmentDate] = useState(today());
  const [category, setCategory] = useState("");
  const [reason, setReason] = useState("");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [charge, setCharge] = useState("");
  const [credit, setCredit] = useState("");
  const [rows, setRows] = useState<UniversalAdjustmentRow[]>(cloneRows(initialRows));
  const [cancelQuantities, setCancelQuantities] = useState<Record<string, string>>({});
  const [history, setHistory] = useState<UniversalAdjustmentRecord[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (view !== "HISTORY") return;
    void (async () => {
      try {
        setHistory(await getUniversalBookingAdjustmentHistory(companyId, service, booking.id));
        setError("");
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
  }, [view, companyId, service, booking.id]);

  const currentBase = useMemo(
    () => initialRows.reduce((sum, row) => sum + Math.max(0, calculateLineTotalPkr(row)), 0),
    [initialRows, calculateLineTotalPkr],
  );
  const revisedBasePreview = useMemo(
    () => rows.reduce((sum, row) => sum + Math.max(0, calculateLineTotalPkr(row)), 0),
    [rows, calculateLineTotalPkr],
  );
  const carriedAdjustment = Number(booking.total_pkr || 0) - currentBase;
  const chargeValue = Math.max(0, num(charge));
  const creditValue = Math.max(0, num(credit));
  const isCancellation = adjustmentType === "PARTIAL_CANCELLATION" || adjustmentType === "FULL_CANCELLATION";

  const cancelledValuePreview = useMemo(() => {
    if (adjustmentType === "FULL_CANCELLATION") return currentBase;
    if (adjustmentType !== "PARTIAL_CANCELLATION") return 0;
    return initialRows.reduce((sum, row) => {
      const available = Math.max(0, Math.trunc(quantityFor(row)));
      const cancelQty = Math.max(0, Math.min(available, Math.trunc(num(cancelQuantities[row.id] || "0"))));
      const total = Math.max(0, calculateLineTotalPkr(row));
      const perUnit = available > 0 ? total / available : 0;
      return sum + perUnit * cancelQty;
    }, 0);
  }, [adjustmentType, currentBase, initialRows, quantityFor, cancelQuantities, calculateLineTotalPkr]);

  const revisedEffectivePreview =
    adjustmentType === "CORRECTION"
      ? revisedBasePreview + carriedAdjustment
      : revisedBasePreview + carriedAdjustment + chargeValue - creditValue;
  const cancellationEffectivePreview =
    adjustmentType === "FULL_CANCELLATION"
      ? Math.max(0, carriedAdjustment + chargeValue)
      : Math.max(0, Number(booking.total_pkr || 0) - cancelledValuePreview + chargeValue);
  const previewTotal = isCancellation ? cancellationEffectivePreview : revisedEffectivePreview;
  const previewDelta = previewTotal - Number(booking.total_pkr || 0);
  const cancellationCreditPreview = Math.max(0, Number(booking.total_pkr || 0) - cancellationEffectivePreview);

  function chooseType(type: BookingAdjustmentKind) {
    setAdjustmentType(type);
    setAdjustmentDate(today());
    setCategory(type === "CORRECTION" ? "Data / Entry Correction" : type === "AMENDMENT" ? "" : kindLabel(type));
    setReason("");
    setReference("");
    setNotes("");
    setCharge("");
    setCredit("");
    setRows(cloneRows(initialRows));
    setCancelQuantities({});
    setError("");
  }

  function updateCell(rowId: string, key: string, value: string) {
    setRows((current) =>
      current.map((row) => (row.id === rowId ? { ...row, values: { ...row.values, [key]: value } } : row)),
    );
  }

  function removeRow(rowId: string) {
    setRows((current) => current.filter((row) => row.id !== rowId));
  }

  async function save() {
    if (!canEdit || !adjustmentType || busy) return;
    if (!reason.trim()) return setError("Reason for adjustment is required.");
    if (adjustmentType === "AMENDMENT" && !category) return setError("Select an Amendment Type.");
    setBusy(true);
    setError("");
    try {
      const previousTotal = Number(booking.total_pkr || 0);
      const beforeSnapshot = JSON.stringify(initialRows);
      let revisedBase = 0;
      let afterRows = cloneRows(rows);
      let cancelledRows: Array<{ row: UniversalAdjustmentRow; quantity: number }> = [];
      let effectiveTotal = 0;
      let appliedCharge = 0;
      let appliedCredit = 0;

      if (adjustmentType === "CORRECTION" || adjustmentType === "AMENDMENT") {
        if (!rows.length) throw new Error(`At least one ${config.label} commercial row is required.`);
        revisedBase = await onApplyRows(rows);
        appliedCharge = adjustmentType === "AMENDMENT" ? chargeValue : 0;
        appliedCredit = adjustmentType === "AMENDMENT" ? creditValue : 0;
        effectiveTotal = revisedBase + carriedAdjustment + appliedCharge - appliedCredit;
      } else if (adjustmentType === "PARTIAL_CANCELLATION") {
        let anyCancellation = false;
        const remaining: UniversalAdjustmentRow[] = [];
        cancelledRows = [];
        initialRows.forEach((row) => {
          const available = Math.max(0, Math.trunc(quantityFor(row)));
          const cancelQty = Math.max(0, Math.min(available, Math.trunc(num(cancelQuantities[row.id] || "0"))));
          if (cancelQty > 0) {
            anyCancellation = true;
            cancelledRows.push({ row, quantity: cancelQty });
          }
          const left = available - cancelQty;
          if (left > 0) remaining.push(withQuantity(row, left));
        });
        if (!anyCancellation) throw new Error(`Select at least one ${config.partialCancellationLabel} to cancel.`);
        if (!remaining.length)
          throw new Error("This would cancel every commercial row. Use Full Cancellation instead.");
        afterRows = remaining;
        revisedBase = await onApplyRows(remaining);
        appliedCharge = chargeValue;
        effectiveTotal = revisedBase + carriedAdjustment + appliedCharge;
      } else {
        revisedBase = 0;
        afterRows = [];
        cancelledRows = initialRows.map((row) => ({ row, quantity: Math.max(0, Math.trunc(quantityFor(row))) }));
        appliedCharge = chargeValue;
        effectiveTotal = Math.max(0, carriedAdjustment + appliedCharge);
      }

      if (!Number.isFinite(effectiveTotal) || effectiveTotal < 0) {
        throw new Error("This adjustment would make the booking value negative. Reduce the credit amount.");
      }

      const result = await recordUniversalBookingAdjustment(
        companyId,
        {
          service,
          bookingId: booking.id,
          adjustmentType,
          adjustmentDate,
          category,
          reason,
          reference,
          notes,
          previousTotalPkr: previousTotal,
          previousBasePkr: currentBase,
          revisedBasePkr: revisedBase,
          chargePkr: appliedCharge,
          creditPkr: appliedCredit,
          effectiveTotalPkr: effectiveTotal,
          beforeSnapshotJson: beforeSnapshot,
          afterSnapshotJson: JSON.stringify(afterRows),
          cancelledLinesJson: JSON.stringify(cancelledRows),
        },
        userId,
      );

      await onSaved?.(
        `${kindLabel(adjustmentType)} saved for ${booking.ub_number}. ${accountTerms.accountImpact} adjustment: ${signedMoney(result.accountDelta)}. Current ${config.label} value: ${money(result.effectiveTotal)}.`,
      );
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function renderSelection() {
    const choices: Array<{ type: BookingAdjustmentKind; title: string; text: string; badge: string }> = [
      {
        type: "CORRECTION",
        title: "Correction",
        text: "Fix an incorrect original entry. No amendment fee is added; only the correct commercial value is restored.",
        badge: "NO FEE",
      },
      {
        type: "AMENDMENT",
        title: "Amendment",
        text: `Record a genuine ${config.label} change. It may increase, reduce or leave the account value unchanged.`,
        badge: "COMMERCIAL",
      },
      {
        type: "PARTIAL_CANCELLATION",
        title: "Partial Cancellation",
        text: `Cancel selected ${config.partialCancellationLabel} while keeping the remaining booking active.`,
        badge: "SELECT ITEMS",
      },
      {
        type: "FULL_CANCELLATION",
        title: "Full Cancellation",
        text: `Cancel the complete ${config.label} booking while retaining any applicable cancellation charge.`,
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

  function renderRows() {
    return (
      <>
        <div className="adj-add-row-actions">
          <span>Revised {config.label} Commercial Rows</span>
          {createRow && (
            <button type="button" onClick={() => setRows((current) => [...current, createRow()])}>
              + Add Row
            </button>
          )}
        </div>
        <div className="adj-lines-table-wrap">
          <table className="adj-lines-table">
            <thead>
              <tr>
                {columns.map((column) => (
                  <th key={column.key}>{column.label}</th>
                ))}
                <th>PKR VALUE</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  {columns.map((column) => (
                    <td key={column.key}>
                      {column.type === "select" ? (
                        <select
                          value={row.values[column.key] || ""}
                          onChange={(e) => updateCell(row.id, column.key, e.target.value)}
                        >
                          {(column.options || []).map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          type={column.type || "text"}
                          min={column.min}
                          step={column.step}
                          value={row.values[column.key] || ""}
                          placeholder={column.placeholder || ""}
                          onChange={(e) => updateCell(row.id, column.key, e.target.value)}
                        />
                      )}
                    </td>
                  ))}
                  <td>
                    <b>{money(calculateLineTotalPkr(row))}</b>
                  </td>
                  <td>
                    <button type="button" className="adj-remove" onClick={() => removeRow(row.id)}>
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
              <th>{config.label.toUpperCase()} ITEM</th>
              <th>AVAILABLE QTY</th>
              <th>CURRENT PKR VALUE</th>
              <th>CANCEL QTY</th>
              <th>CANCELLED PKR VALUE</th>
            </tr>
          </thead>
          <tbody>
            {initialRows.map((row, index) => {
              const available = Math.max(0, Math.trunc(quantityFor(row)));
              const qty =
                adjustmentType === "FULL_CANCELLATION"
                  ? available
                  : Math.max(0, Math.min(available, Math.trunc(num(cancelQuantities[row.id] || "0"))));
              const total = Math.max(0, calculateLineTotalPkr(row));
              const cancelled = available > 0 ? (total / available) * qty : 0;
              return (
                <tr key={row.id}>
                  <td>
                    <b>{describeRow(row, index)}</b>
                  </td>
                  <td>{available}</td>
                  <td>{money(total)}</td>
                  <td>
                    {adjustmentType === "FULL_CANCELLATION" ? (
                      <b>{available}</b>
                    ) : (
                      <input
                        type="number"
                        min="0"
                        max={available}
                        step="1"
                        value={cancelQuantities[row.id] || ""}
                        placeholder="0"
                        onChange={(e) => setCancelQuantities((current) => ({ ...current, [row.id]: e.target.value }))}
                      />
                    )}
                  </td>
                  <td>
                    <b>{money(cancelled)}</b>
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
    const originalValue = history.length ? Number(history[0].previous_total_pkr || 0) : Number(booking.total_pkr || 0);
    const latest = history[history.length - 1];
    const lifecycle: BookingLifecycleStatus = latest?.lifecycle_status || "ACTIVE";
    const revision = latest ? Number(latest.revision_no || 1) : 1;
    return (
      <div className="adj-history-view">
        <div className="adj-history-summary">
          <div>
            <small>CURRENT STATUS</small>
            <b>{lifecycle}</b>
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
              <h4>Original {config.label} Booking</h4>
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
                <h4>{kindLabel(item.adjustment_type)}</h4>
                <p>
                  {item.category || "Booking adjustment"} — {item.reason}
                </p>
                {item.reference && <em>Ref: {item.reference}</em>}
                {item.notes && <em>{item.notes}</em>}
                <div className="adj-history-numbers">
                  <span>Previous {money(item.previous_total_pkr)}</span>
                  <span>Base after {money(item.revised_base_pkr)}</span>
                  {Number(item.charge_pkr) > 0 && <span>Charge/Cost +{money(item.charge_pkr)}</span>}
                  {Number(item.credit_pkr) > 0 && <span>Credit/Deduction {money(item.credit_pkr)}</span>}
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
            No booking adjustments yet. This is still the original {config.label} booking.
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="modal-backdrop adj-backdrop" onMouseDown={(e) => e.currentTarget === e.target && onClose()}>
      <section className="adj-shell" onMouseDown={(e) => e.stopPropagation()}>
        <div className="adj-toolbar">
          <div>
            <span className="eyebrow blue">{service} BOOKING</span>
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
                      Correction, Amendment and Cancellation all stay linked to the genuine UB. Refunds remain separate
                      cash/bank movements in Payments.
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
                        <b>{kindLabel(adjustmentType).toUpperCase()} DETAILS</b>
                        <small>The genuine UB and Party/Vendor account remain locked.</small>
                      </div>
                    </div>
                    <div className="adj-form-grid">
                      <label>
                        {isCancellation ? "Cancellation Date" : "Adjustment Date"} *
                        <input type="date" value={adjustmentDate} onChange={(e) => setAdjustmentDate(e.target.value)} />
                      </label>
                      {adjustmentType === "AMENDMENT" && (
                        <label>
                          Change Type *
                          <select value={category} onChange={(e) => setCategory(e.target.value)}>
                            <option value="">Select change type</option>
                            {config.amendmentTypes.map((item) => (
                              <option key={item} value={item}>
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
                              ? "What was entered incorrectly?"
                              : isCancellation
                                ? "Why is this booking being cancelled?"
                                : "What genuine post-booking change is being made?"
                          }
                        />
                      </label>
                    </div>
                  </section>

                  <section className="adj-section">
                    <div className="adj-section-title">
                      <span>02</span>
                      <div>
                        <b>
                          {isCancellation ? "CANCELLATION & ACCOUNTING" : `REVISED ${service} BOOKING & ACCOUNTING`}
                        </b>
                        <small>Review the commercial effect before saving. No payment or refund is created here.</small>
                      </div>
                    </div>
                    {isCancellation ? renderCancellationRows() : renderRows()}
                    {adjustmentType === "AMENDMENT" && (
                      <div className="adj-charge-grid">
                        <label>
                          {accountTerms.chargeLabel} (PKR)
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={charge}
                            onChange={(e) => setCharge(e.target.value)}
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
                          {booking.transaction_type === "SALE"
                            ? "Cancellation Charge Retained / Charged"
                            : "Supplier Cancellation Charge / Cost"}{" "}
                          (PKR)
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={charge}
                            onChange={(e) => setCharge(e.target.value)}
                            placeholder="0"
                          />
                          <small>Amount that remains commercially chargeable despite the cancellation.</small>
                        </label>
                        <div className="adj-credit-preview">
                          <small>NET ACCOUNT CREDIT</small>
                          <b>{money(cancellationCreditPreview)}</b>
                          <span>This is not a cash refund. Actual money returned is recorded later in Payments.</span>
                        </div>
                      </div>
                    )}
                    <div className="adj-accounting-preview">
                      <div>
                        <small>CURRENT EFFECTIVE VALUE</small>
                        <b>{money(booking.total_pkr)}</b>
                      </div>
                      <div>
                        <small>{isCancellation ? "CANCELLED VALUE" : "REVISED BASE"}</small>
                        <b>{money(isCancellation ? cancelledValuePreview : revisedBasePreview)}</b>
                      </div>
                      <div className={previewDelta > 0 ? "increase" : previewDelta < 0 ? "decrease" : "neutral"}>
                        <small>{accountTerms.accountImpact.toUpperCase()} IMPACT</small>
                        <b>{signedMoney(previewDelta)}</b>
                      </div>
                      <div className="effective">
                        <small>NEW EFFECTIVE BOOKING VALUE</small>
                        <strong>{money(previewTotal)}</strong>
                      </div>
                    </div>
                    {adjustmentType === "CORRECTION" && (
                      <div className="adj-rule-note">
                        <b>Correction:</b> no amendment fee is added. If only text/data changes and the amount stays the
                        same, the accounting impact is Rs 0.
                      </div>
                    )}
                    {adjustmentType === "AMENDMENT" && (
                      <div className="adj-rule-note">
                        <b>Amendment:</b> revised commercial rows plus any additional charge/cost or credit/deduction
                        determine the account impact.
                      </div>
                    )}
                  </section>

                  <section className="adj-section">
                    <div className="adj-section-title">
                      <span>03</span>
                      <div>
                        <b>SUPPORTING INFORMATION</b>
                        <small>
                          Reference and notes support the audit trail and do not independently change accounting.
                        </small>
                      </div>
                    </div>
                    <div className="adj-form-grid">
                      <label>
                        Reference
                        <input
                          value={reference}
                          onChange={(e) => setReference(e.target.value)}
                          placeholder="Airline / hotel / supplier / internal reference"
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
                {accountTerms.accountImpact}: {signedMoney(previewDelta)}
              </b>
              <span>Current value after save: {money(previewTotal)}</span>
            </div>
            <button type="button" className="primary" disabled={busy || !canEdit} onClick={() => void save()}>
              {busy ? "Saving Adjustment..." : `Save ${kindLabel(adjustmentType)}`}
            </button>
          </div>
        ) : null}
      </section>
    </div>
  );
}
