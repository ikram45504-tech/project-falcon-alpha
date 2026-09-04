import { useEffect, useMemo, useState } from "react";
import type { BookingTransactionType, Party } from "./db";
import {
  createMiscBooking,
  getMiscBookings,
  initMiscDatabase,
  type MiscBooking,
  type MiscBookingLineInput,
} from "./miscDb";
import ProgressiveBookingIdentity from "./ProgressiveBookingIdentity";
import MiscRegister from "./MiscRegister";
import { bookingDigitsFromUb, bookingUbFromDigits } from "./bookingUb";
import { useBookingFlowState } from "./useBookingFlowState";
import {
  getMiscOperationalDetails,
  saveMiscFamilyHeads,
  saveMiscOperationalDetails,
  type MiscOperationalRow,
} from "./MiscOperationalDb";
import { miscRowCalc, miscRowHasData, calculateMiscSummary } from "./pricingEngines";
import { useAuth } from "./AuthContext";
import { ADDITIONAL_BOOKING_DETAILS_UPGRADE, allowsAdditionalBookingDetails } from "./companyEntitlements";
import "./BookingFinalization.css";
import "./BookingIdentity.css";

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
  serviceName: string;
  familyHead: string;
  paxCount: string;
  ratePerPerson: string;
  roe: string;
};
type OperationalRow = Omit<MiscOperationalRow, "id" | "sortOrder"> & { rowId: string };

function newRow(): Row {
  return { rowId: crypto.randomUUID(), serviceName: "", familyHead: "", paxCount: "", ratePerPerson: "", roe: "" };
}
function pkr(v: number) {
  return `Rs ${Number(v || 0).toLocaleString("en-PK", { maximumFractionDigits: 2 })}`;
}
function sar(v: number) {
  return `SAR ${Number(v || 0).toLocaleString("en-PK", { maximumFractionDigits: 2 })}`;
}

export default function MiscBookingFlowV3({
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
  const [entries, setEntries] = useState<MiscBooking[]>([]);
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
    resetState,
  } = useBookingFlowState(companyId, transactionType, entries, "Misc");
  const { company } = useAuth();
  const canAdditionalDetails = allowsAdditionalBookingDetails(company?.entitlements);

  const [rows, setRows] = useState<Row[]>([newRow()]);
  const [operationalRows, setOperationalRows] = useState<OperationalRow[]>([]);
  const [notes, setNotes] = useState("");

  useEffect(() => {
    void (async () => {
      try {
        await initMiscDatabase();
        await loadEntries();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
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

  const summary = useMemo(() => calculateMiscSummary(rows), [rows]);
  const commercialLocked = Boolean(editingId);
  const ubPreview = bookingUbFromDigits(ubDigits);

  async function loadEntries() {
    try {
      setEntries(await getMiscBookings(companyId));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }
  function reset() {
    resetState();
    setRows([newRow()]);
    setOperationalRows([]);
    setNotes("");
  }
  function update(rowId: string, patch: Partial<Row>) {
    if (commercialLocked) return;
    setRows((current) => current.map((row) => (row.rowId === rowId ? { ...row, ...patch } : row)));
  }
  function add() {
    if (commercialLocked) return;
    setRows((current) => [...current, newRow()]);
  }
  function remove(rowId: string) {
    if (commercialLocked) return;
    setRows((current) => {
      const next = current.filter((row) => row.rowId !== rowId);
      return next.length ? next : [newRow()];
    });
  }
  function lineInputs(): MiscBookingLineInput[] {
    return rows.filter(miscRowHasData).map((row) => ({
      serviceName: row.serviceName.trim(),
      paxCount: Math.max(0, Math.floor(Number(row.paxCount) || 0)),
      ratePerPerson: Math.max(0, Number(row.ratePerPerson) || 0),
      roe: row.roe.trim() ? Math.max(0, Number(row.roe) || 0) : null,
    }));
  }
  function syncOperational(existing = operationalRows) {
    setOperationalRows(
      rows.filter(miscRowHasData).map(
        (_, index) =>
          existing.find((item) => item.serviceSortOrder === index) || {
            rowId: crypto.randomUUID(),
            serviceSortOrder: index,
            serviceDate: "",
            referenceVoucher: "",
            contact: "",
            instructions: "",
          },
      ),
    );
  }

  async function saveCommercial() {
    if (editingId)
      return setError(
        "Commercial Misc values are locked after saving. Use Misc Booking Register → Booking Adjustment for Correction, Amendment or Cancellation.",
      );
    const active = rows.filter(miscRowHasData);
    if (active.some((row) => !row.familyHead.trim()))
      return setError("Passenger / Family Head is required for each Misc service row.");
    setBusy(true);
    setError("");
    try {
      const formatted = ubPreview;
      const valid = await validateBookingUb(formatted);
      if (!valid) return;
      setUbNumber(formatted);
      const id = await createMiscBooking(
        companyId,
        { transactionType: tx, counterpartyId, transactionDate: bookingDate, ubNumber: formatted, lines: lineInputs() },
        userId,
      );
      setEditingId(id);
      setSaved(true);
      setMessage(`Misc booking ${formatted} saved. Additional booking details are available below.`);
      await saveMiscFamilyHeads(
        companyId,
        id,
        active.map((row) => row.familyHead),
        userId,
      );
      syncOperational();
      await loadEntries();
      await onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function saveDetails() {
    if (!editingId) return;
    setBusy(true);
    setError("");
    try {
      await saveMiscOperationalDetails(
        companyId,
        editingId,
        {
          services: operationalRows.map((row) => ({
            serviceSortOrder: row.serviceSortOrder,
            serviceDate: row.serviceDate,
            referenceVoucher: row.referenceVoucher,
            contact: row.contact,
            instructions: row.instructions,
          })),
          notes,
        },
        userId,
      );
      setMessage(`Misc Booking Details for ${ubNumber} saved.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function openEntry(entry: MiscBooking) {
    if (entry.status !== "ACTIVE") return;
    setTx(entry.transaction_type as BookingTransactionType);
    setCounterpartyId(entry.counterparty_id);
    setBookingDate(entry.transaction_date);
    setUbNumber(entry.ub_number);
    setUbDigits(bookingDigitsFromUb(entry.ub_number));
    setSaved(true);
    setDetailsOpen(false);
    setEditingId(entry.id);
    const details = await getMiscOperationalDetails(companyId, entry.id);
    setRows(
      entry.lines.length
        ? entry.lines.map((line, index) => ({
            rowId: crypto.randomUUID(),
            serviceName: line.service_name,
            familyHead: details.familyHeads[index] || "",
            paxCount: String(line.pax_count || ""),
            ratePerPerson: String(line.rate_per_person || ""),
            roe: line.currency_mode === "SAR" && Number(line.roe || 0) > 0 ? String(line.roe) : "",
          }))
        : [newRow()],
    );
    setOperationalRows(details.services.map((item) => ({ ...item, rowId: crypto.randomUUID() })));
    setNotes(details.notes);
    setMode("FORM");
    setMessage(
      `Opened Misc booking ${entry.ub_number}. Commercial values are read-only here; use Booking Adjustment from the Misc Booking Register. Section 03 operational details remain available.`,
    );
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function openEntryById(bookingId: string) {
    const latest = await getMiscBookings(companyId);
    setEntries(latest);
    const entry = latest.find((item) => item.id === bookingId);
    if (entry) await openEntry(entry);
  }
  async function lifecycleChanged() {
    await loadEntries();
    await onChanged?.();
  }
  function updateOperational(rowId: string, patch: Partial<OperationalRow>) {
    setOperationalRows((current) => current.map((row) => (row.rowId === rowId ? { ...row, ...patch } : row)));
  }

  if (mode === "REGISTER")
    return (
      <MiscRegister
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
    <section className="booking-entry-screen bf-page package14-page">
      <div className="booking-screen-toolbar">
        <button className="booking-back-button" onClick={onBack}>
          ← Back to Booking Services
        </button>
        <div className="bf-toolbar-actions">
          <span className={`direction-badge ${tx === "SALE" ? "sale" : "purchase"}`}>
            {tx === "SALE" ? "SALE TO PARTY" : "PURCHASE FROM VENDOR / SUPPLIER"}
          </span>
          <button className="booking-foundation-badge active-engine" onClick={() => setMode("REGISTER")}>
            Misc Booking Register
          </button>
        </div>
      </div>
      <div className="bf-title">
        <div>
          <span className="eyebrow blue">MISC BOOKING</span>
          <h2>{saved ? `Misc Booking — ${ubNumber}` : "New Misc Booking"}</h2>
          <p>
            {editingId
              ? "Review the current effective Misc booking. Commercial changes are protected by Booking Adjustment history."
              : "Complete account, UB, and misc services on one form, then save once. Additional booking details are optional."}
          </p>
        </div>
      </div>
      {message && <div className="alert success">{message}</div>}
      {error && <div className="alert error">{error}</div>}
      <section className="bf-card misc13-card misc-unified-form">
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
          serviceLabel="Misc"
          headerGridClass="package14-identity-grid"
          unifiedHint="Party, date, and UB are saved together with misc service rates when you click Save Booking."
          embedded
        />

        <div className="bf-section-head misc13-section-head misc-commercial-head">
          <div>
            <span>2</span>
            <div>
              <b>MISC SERVICE DETAILS &amp; RATES</b>
              <small>
                {commercialLocked
                  ? "Current effective commercial services — use Booking Adjustment to change them."
                  : "Enter misc services below, then save the full booking in one step."}
              </small>
            </div>
          </div>
          {!commercialLocked && (
            <button className="primary small" onClick={add}>
              + Service Row
            </button>
          )}
        </div>
        <div className="bf-table-wrap">
          <table className="bf-table misc-v3-table">
            <thead>
              <tr>
                <th>SR</th>
                <th>SERVICE NAME</th>
                <th>PASSENGER / FAMILY HEAD</th>
                <th>NO. OF PAX</th>
                <th>RATE / PERSON</th>
                <th>ROE</th>
                <th>TOTAL</th>
                {!commercialLocked && <th>ACTION</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => {
                const c = miscRowCalc(row);
                return (
                  <tr key={row.rowId}>
                    <td>{index + 1}</td>
                    <td>
                      <input
                        disabled={commercialLocked}
                        value={row.serviceName}
                        onChange={(e) => update(row.rowId, { serviceName: e.target.value })}
                      />
                    </td>
                    <td>
                      <input
                        disabled={commercialLocked}
                        value={row.familyHead}
                        onChange={(e) => update(row.rowId, { familyHead: e.target.value })}
                      />
                    </td>
                    <td>
                      <input
                        disabled={commercialLocked}
                        type="number"
                        min="1"
                        value={row.paxCount}
                        onChange={(e) => update(row.rowId, { paxCount: e.target.value })}
                      />
                    </td>
                    <td>
                      <div style={{ display: "grid", gridTemplateColumns: "46px 1fr", gap: 5, alignItems: "center" }}>
                        <b>{c.mode}</b>
                        <input
                          disabled={commercialLocked}
                          type="number"
                          min="0"
                          value={row.ratePerPerson}
                          onChange={(e) => update(row.rowId, { ratePerPerson: e.target.value })}
                        />
                      </div>
                    </td>
                    <td>
                      <input
                        disabled={commercialLocked}
                        type="number"
                        min="0"
                        value={row.roe}
                        onChange={(e) => update(row.rowId, { roe: e.target.value })}
                        placeholder="Blank = PKR"
                      />
                    </td>
                    <td className="bf-money">
                      <b>{pkr(c.totalPkr)}</b>
                      {c.mode === "SAR" && <small style={{ display: "block" }}>{sar(c.totalSar)}</small>}
                    </td>
                    {!commercialLocked && (
                      <td>
                        <button className="bf-remove" onClick={() => remove(row.rowId)}>
                          ×
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="bf-summary">
          <div>
            <small>MISC SERVICES</small>
            <b>{summary.services}</b>
          </div>
          <div>
            <small>TOTAL PAX ENTRIES</small>
            <b>{summary.paxEntries}</b>
          </div>
          <div>
            <small>TOTAL SAR</small>
            <b>{sar(summary.totalSar)}</b>
          </div>
          <div className="grand">
            <small>GRAND TOTAL PKR</small>
            <b>{pkr(summary.totalPkr)}</b>
          </div>
        </div>
        <div className="package14-commercial-actions">
          {saved && (
            <button className="secondary" onClick={reset}>
              + New Misc Booking
            </button>
          )}
          {!editingId && (
            <button className="primary" disabled={busy || !canCreate} onClick={() => void saveCommercial()}>
              {busy ? "Saving..." : `Save Misc Booking — ${ubPreview || "UB-0000"}`}
            </button>
          )}
          {editingId && (
            <div className="adj-rule-note">
              <b>Commercial values locked:</b> use Misc Booking Register → Booking Adjustment for Correction, Amendment,
              Partial Cancellation or Full Cancellation.
            </div>
          )}
        </div>
      </section>

      {saved && editingId && (
        <section className={`package14-additional ${detailsOpen ? "open" : "closed"}`}>
          <button
            type="button"
            className="package14-additional-toggle"
            disabled={!canAdditionalDetails}
            title={canAdditionalDetails ? undefined : ADDITIONAL_BOOKING_DETAILS_UPGRADE}
            onClick={() => {
              if (!canAdditionalDetails) {
                setMessage(ADDITIONAL_BOOKING_DETAILS_UPGRADE);
                return;
              }
              const next = !detailsOpen;
              setDetailsOpen(next);
              if (next) syncOperational();
            }}
          >
            <div>
              <b>ADDITIONAL BOOKING DETAILS — {ubNumber}</b>
              <small>Optional service date, reference / voucher, contact and instructions.</small>
            </div>
            <strong>{detailsOpen ? "Hide ▲" : "Show ▼"}</strong>
          </button>
          {detailsOpen && (
            <div className="package14-additional-body bf-operational-body">
              <div className="bf-subsection">
                <div className="bf-subsection-head">
                  <div>
                    <b>MISC SERVICE INFORMATION</b>
                    <small>One information row is synchronized from each Section 02 service.</small>
                  </div>
                  <button className="primary small" onClick={() => syncOperational()}>
                    Sync from Section 02
                  </button>
                </div>
                <div className="bf-table-wrap">
                  <table className="bf-table">
                    <thead>
                      <tr>
                        <th>SR</th>
                        <th>SERVICE</th>
                        <th>SERVICE DATE</th>
                        <th>REFERENCE / VOUCHER</th>
                        <th>CONTACT</th>
                        <th>INSTRUCTIONS</th>
                      </tr>
                    </thead>
                    <tbody>
                      {operationalRows.map((op, index) => {
                        const source = rows.filter(miscRowHasData)[op.serviceSortOrder];
                        return (
                          <tr key={op.rowId}>
                            <td>{index + 1}</td>
                            <td>
                              <b>{source?.serviceName || "—"}</b>
                            </td>
                            <td>
                              <input
                                type="date"
                                value={op.serviceDate}
                                onChange={(e) => updateOperational(op.rowId, { serviceDate: e.target.value })}
                              />
                            </td>
                            <td>
                              <input
                                value={op.referenceVoucher}
                                onChange={(e) => updateOperational(op.rowId, { referenceVoucher: e.target.value })}
                              />
                            </td>
                            <td>
                              <input
                                value={op.contact}
                                onChange={(e) => updateOperational(op.rowId, { contact: e.target.value })}
                              />
                            </td>
                            <td>
                              <input
                                value={op.instructions}
                                onChange={(e) => updateOperational(op.rowId, { instructions: e.target.value })}
                              />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
              <div className="bf-details-grid">
                <label className="wide">
                  General Notes
                  <textarea rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} />
                </label>
              </div>
              <div className="package14-details-actions">
                <span>Misc remains intentionally lightweight and general-purpose.</span>
                <button className="primary" disabled={busy || !canEdit} onClick={() => void saveDetails()}>
                  {busy ? "Saving..." : `Save Misc Details — ${ubNumber}`}
                </button>
              </div>
            </div>
          )}
        </section>
      )}
    </section>
  );
}
