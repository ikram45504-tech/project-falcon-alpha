import { useEffect, useMemo, useState } from "react";
import type { BookingTransactionType, Party } from "./db";
import { getPartyById } from "./db";
import { getGlobalUbSaleOwner } from "./LedgerEngine";
import {
  createMiscBooking,
  getMiscBookings,
  initMiscDatabase,
  type MiscBooking,
  type MiscBookingInput,
  type MiscBookingLineInput,
} from "./miscDb";
import ProgressiveBookingIdentity from "./ProgressiveBookingIdentity";
import BookingLifecycleCenter from "./BookingLifecycleCenter";
import { bookingDigitsFromUb, normalizeBookingUb } from "./bookingUb";
import {
  getMiscOperationalDetails,
  saveMiscFamilyHeads,
  saveMiscOperationalDetails,
  type MiscOperationalRow,
} from "./MiscOperationalDb";
import { miscRowCalc, miscRowHasData, calculateMiscSummary } from "./pricingEngines";
import "./BookingFinalization.css";

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
type Row = {
  rowId: string;
  serviceName: string;
  familyHead: string;
  paxCount: string;
  ratePerPerson: string;
  roe: string;
};
type OperationalRow = Omit<MiscOperationalRow, "id" | "sortOrder"> & { rowId: string };
type Mode = "FORM" | "REGISTER";

function localDate() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
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
}: Props) {
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
  const [operationalRows, setOperationalRows] = useState<OperationalRow[]>([]);
  const [notes, setNotes] = useState("");
  const [entries, setEntries] = useState<MiscBooking[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!editingId) setTx(transactionType);
  }, [transactionType, editingId]);
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

  const summary = useMemo(() => calculateMiscSummary(rows), [rows]);
  const commercialLocked = Boolean(editingId);

  async function loadEntries() {
    try {
      setEntries(await getMiscBookings(companyId));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }
  function reset() {
    setTx(transactionType);
    setCounterpartyId("");
    setBookingDate(localDate());
    setUbDigits("");
    setUbNumber("");
    setAssigned(false);
    setSaved(false);
    setDetailsOpen(false);
    setRows([newRow()]);
    setOperationalRows([]);
    setNotes("");
    setEditingId(null);
    setError("");
    setMessage("");
  }
  async function assign(formatted: string) {
    setError("");
    if (!counterpartyId)
      return setError(tx === "SALE" ? "Select a Party / Customer first." : "Select a Vendor / Supplier first.");
    if (!bookingDate) return setError("Date of Booking is required.");
    if (!formatted) return setError("Enter a booking number using 1 to 4 digits.");
    const duplicate = entries.find(
      (entry) =>
        normalizeBookingUb(entry.ub_number) === formatted &&
        (tx === "SALE"
          ? entry.transaction_type === "SALE"
          : entry.transaction_type === "PURCHASE" && entry.counterparty_id === counterpartyId),
    );
    if (duplicate)
      return setError(
        tx === "SALE"
          ? `${formatted} already has a Misc Sale booking.`
          : `This Vendor already has a Misc Purchase booking for ${formatted}.`,
      );
    try {
      setBusy(true);
      const owner = await getGlobalUbSaleOwner(companyId, formatted);
      if (owner && tx === "SALE" && owner.partyId !== counterpartyId) {
        const partyInfo = await getPartyById(companyId, owner.partyId);
        const partyName = partyInfo?.name || "another customer";
        setError(
          `This Unique Booking # (${formatted}) is designed for ${partyName} only. Please change unique number.`,
        );
        setBusy(false);
        return;
      }
    } catch (e) {
      console.error(e);
    } finally {
      setBusy(false);
    }
    setUbNumber(formatted);
    setAssigned(true);
    setMessage(`${formatted} is ready. Enter Misc Service Details & Rates below.`);
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
  function input(): MiscBookingInput {
    return { transactionType: tx, counterpartyId, transactionDate: bookingDate, ubNumber, lines: lineInputs() };
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
    if (!assigned) return setError("Create / Assign the Booking UB first.");
    const active = rows.filter(miscRowHasData);
    if (active.some((row) => !row.familyHead.trim()))
      return setError("Passenger / Family Head is required for each Misc service row.");
    setBusy(true);
    setError("");
    try {
      const id = await createMiscBooking(companyId, input(), userId);
      setEditingId(id);
      setSaved(true);
      setMessage(`Misc booking ${ubNumber} saved. Optional service information is now available.`);
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
    setAssigned(true);
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
      <BookingLifecycleCenter
        service="MISC"
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
              : "Create the UB first, save Misc accounting second, then add optional service references / instructions."}
          </p>
        </div>
      </div>
      {message && <div className="alert success">{message}</div>}
      {error && <div className="alert error">{error}</div>}
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
        assigned={assigned}
        saved={saved}
        onAssign={assign}
        onEditHeader={() => {
          if (!editingId) {
            setAssigned(false);
            setMessage("");
          }
        }}
        onAccountsChanged={onChanged}
        onError={setError}
        onMessage={setMessage}
        serviceLabel="Misc"
      />

      {assigned && (
        <section className="bf-card">
          <div className="bf-section-head">
            <div>
              <span>02</span>
              <div>
                <b>MISC SERVICE DETAILS & RATES</b>
                <small>
                  {commercialLocked
                    ? "Current effective commercial services — use Booking Adjustment to change them."
                    : `Lightweight commercial / accounting services under ${ubNumber}`}
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
                {busy ? "Saving..." : `Save Misc Booking — ${ubNumber}`}
              </button>
            )}
            {editingId && (
              <div className="adj-rule-note">
                <b>Commercial values locked:</b> use Misc Booking Register → Booking Adjustment for Correction,
                Amendment, Partial Cancellation or Full Cancellation.
              </div>
            )}
          </div>
        </section>
      )}

      {saved && editingId && (
        <section className={`package14-additional ${detailsOpen ? "open" : "closed"}`}>
          <button
            className="package14-additional-toggle"
            onClick={() => {
              const next = !detailsOpen;
              setDetailsOpen(next);
              if (next) syncOperational();
            }}
          >
            <span className="package14-step-purple">03</span>
            <div>
              <b>MISC BOOKING DETAILS — {ubNumber}</b>
              <small>Optional service date, reference / voucher, contact and instructions.</small>
            </div>
            <span className="package14-optional">OPTIONAL</span>
            <strong>{detailsOpen ? "Close Details ▲" : "+ Open Details ▼"}</strong>
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

      {!assigned && (
        <div className="package14-next-step">Create / Assign a Booking UB to unlock Misc Service Details & Rates.</div>
      )}
      {assigned && !saved && (
        <div className="package14-next-step">
          Save Section 02 to activate the Misc booking and unlock Optional Misc Booking Details.
        </div>
      )}
    </section>
  );
}
