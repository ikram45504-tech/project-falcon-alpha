import { useEffect, useMemo, useState } from "react";
import type { BookingTransactionType, Party } from "./db";
import {
  MiscBooking,
  MiscBookingInput,
  MiscBookingLineInput,
  createMiscBooking,
  getMiscBookings,
  initMiscDatabase,
  updateMiscBooking,
  voidMiscBooking,
} from "./miscDb";

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

type RowState = {
  rowId: string;
  serviceName: string;
  paxCount: string;
  ratePerPerson: string;
  roe: string;
};

type ViewMode = "FORM" | "REGISTER";
type RegisterFilter = "ALL" | BookingTransactionType;

function localDate() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function newRow(): RowState {
  return { rowId: crypto.randomUUID(), serviceName: "", paxCount: "", ratePerPerson: "", roe: "" };
}

function num(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function whole(value: string) {
  return Math.max(0, Math.trunc(num(value)));
}

function pkr(value: number) {
  return `Rs ${Number(value || 0).toLocaleString("en-PK", { maximumFractionDigits: 2 })}`;
}

function sar(value: number) {
  return `SAR ${Number(value || 0).toLocaleString("en-PK", { maximumFractionDigits: 2 })}`;
}

function calcRow(row: RowState) {
  const pax = whole(row.paxCount);
  const rate = Math.max(0, num(row.ratePerPerson));
  const roe = Math.max(0, num(row.roe));
  const base = rate * pax;
  if (roe > 0) return { mode: "SAR" as const, pax, rate, roe, totalSar: base, totalPkr: base * roe };
  return { mode: "PKR" as const, pax, rate, roe: 0, totalSar: 0, totalPkr: base };
}

function rowHasData(row: RowState) {
  return Boolean(row.serviceName.trim() || row.paxCount.trim() || row.ratePerPerson.trim() || row.roe.trim());
}

export default function MiscBookingModule({
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
  const [rows, setRows] = useState<RowState[]>([newRow()]);
  const [entries, setEntries] = useState<MiscBooking[]>([]);
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
    void (async () => {
      try {
        await initMiscDatabase();
        await loadEntries("");
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
  }, [companyId]);

  const eligibleAccounts = useMemo(() => {
    const wanted = activeTransactionType === "SALE" ? "PARTY" : "VENDOR";
    return parties.filter((item) => item.status === "ACTIVE" && item.account_type === wanted);
  }, [parties, activeTransactionType]);

  const summary = useMemo(() => {
    let services = 0;
    let paxEntries = 0;
    let totalSar = 0;
    let totalPkr = 0;
    for (const row of rows) {
      if (!rowHasData(row)) continue;
      const c = calcRow(row);
      services += 1;
      paxEntries += c.pax;
      totalSar += c.totalSar;
      totalPkr += c.totalPkr;
    }
    return { services, paxEntries, totalSar, totalPkr };
  }, [rows]);

  const visibleEntries = entries.filter((entry) => registerFilter === "ALL" || entry.transaction_type === registerFilter);
  const activeEntries = entries.filter((entry) => entry.status === "ACTIVE");
  const activeSalePkr = activeEntries.filter((entry) => entry.transaction_type === "SALE").reduce((sum, entry) => sum + Number(entry.total_pkr || 0), 0);
  const activePurchasePkr = activeEntries.filter((entry) => entry.transaction_type === "PURCHASE").reduce((sum, entry) => sum + Number(entry.total_pkr || 0), 0);

  async function loadEntries(nextSearch = search) {
    try {
      setEntries(await getMiscBookings(companyId, nextSearch));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  function updateRow(rowId: string, patch: Partial<RowState>) {
    setRows((current) => current.map((row) => row.rowId === rowId ? { ...row, ...patch } : row));
  }

  function addRow() {
    setRows((current) => [...current, newRow()]);
  }

  function removeRow(rowId: string) {
    setRows((current) => {
      const next = current.filter((row) => row.rowId !== rowId);
      return next.length ? next : [newRow()];
    });
  }

  function resetForm(options?: { keepDirection?: boolean }) {
    if (!options?.keepDirection) setActiveTransactionType(transactionType);
    setCounterpartyId("");
    setBookingDate(localDate());
    setUbNumber("");
    setRows([newRow()]);
    setEditingId(null);
    setError("");
  }

  function makeInput(): MiscBookingInput {
    const lines: MiscBookingLineInput[] = rows.filter(rowHasData).map((row) => ({
      serviceName: row.serviceName.trim(),
      paxCount: whole(row.paxCount),
      ratePerPerson: Math.max(0, num(row.ratePerPerson)),
      roe: row.roe.trim() ? Math.max(0, num(row.roe)) : null,
    }));
    return {
      transactionType: activeTransactionType,
      counterpartyId,
      transactionDate: bookingDate,
      ubNumber,
      lines,
    };
  }

  async function saveBooking() {
    if (busy) return;
    if (editingId && !canEdit) return setError("Your role does not allow editing bookings.");
    if (!editingId && !canCreate) return setError("Your role does not allow creating bookings.");
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const input = makeInput();
      if (editingId) {
        await updateMiscBooking(companyId, editingId, input, userId);
        setMessage(`Misc booking ${input.ubNumber.trim()} updated successfully.`);
      } else {
        await createMiscBooking(companyId, input, userId);
        setMessage(`Misc booking ${input.ubNumber.trim()} saved successfully.`);
      }
      await loadEntries("");
      await onChanged?.();
      resetForm({ keepDirection: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function edit(entry: MiscBooking) {
    if (!canEdit || entry.status !== "ACTIVE") return;
    setActiveTransactionType(entry.transaction_type);
    setCounterpartyId(entry.counterparty_id);
    setBookingDate(entry.transaction_date);
    setUbNumber(entry.ub_number);
    setRows(entry.lines.length ? entry.lines.map((line) => ({
      rowId: crypto.randomUUID(),
      serviceName: line.service_name,
      paxCount: String(line.pax_count || ""),
      ratePerPerson: String(line.rate_per_person || ""),
      roe: line.currency_mode === "SAR" && Number(line.roe || 0) > 0 ? String(line.roe) : "",
    })) : [newRow()]);
    setEditingId(entry.id);
    setMode("FORM");
    setError("");
    setMessage(`Editing Misc booking ${entry.ub_number}.`);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function voidEntry(entry: MiscBooking) {
    if (!canVoid || entry.status !== "ACTIVE" || busy) return;
    if (!window.confirm(`Void Misc booking ${entry.ub_number}?`)) return;
    setBusy(true);
    setError("");
    try {
      await voidMiscBooking(companyId, entry.id, userId);
      await loadEntries(search);
      await onChanged?.();
      setMessage(`Misc booking ${entry.ub_number} voided.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function renderForm() {
    return (
      <section className="booking-entry-screen misc13-page">
        <div className="booking-screen-toolbar">
          <button type="button" className="booking-back-button" onClick={onBack}>← Back to Booking Services</button>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <span className={`direction-badge ${activeTransactionType === "SALE" ? "sale" : "purchase"}`}>
              {activeTransactionType === "SALE" ? "SALE TO PARTY" : "PURCHASE FROM VENDOR / SUPPLIER"}
            </span>
            <button type="button" className="booking-foundation-badge active-engine" onClick={() => { setMode("REGISTER"); void loadEntries(); }}>▣ Misc Booking Register</button>
          </div>
        </div>

        <div className="misc13-title">
          <div><span className="eyebrow blue">MISC BOOKING</span><h2>{editingId ? "Edit Misc Booking" : "New Misc Booking"}</h2><p>Simple general-purpose per-person services in PKR, or SAR when an ROE is entered.</p></div>
        </div>

        {message && <div className="alert success">{message}</div>}
        {error && <div className="alert error">{error}</div>}

        <section className="booking-identity-card">
          <div className="booking-identity-head"><span className="booking-identity-step">1</span><b>CREATE BOOKING / ASSIGN UB</b></div>
          <div className="booking-identity-grid">
            <label>
              {activeTransactionType === "SALE" ? "Party / Customer *" : "Vendor / Supplier *"}
              <select value={counterpartyId} onChange={(e) => setCounterpartyId(e.target.value)}>
                <option value="">Select {activeTransactionType === "SALE" ? "Party / Customer" : "Vendor / Supplier"}</option>
                {eligibleAccounts.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
              <small className="booking-identity-helper">The account this Misc booking belongs to.</small>
            </label>
            <label>
              Date of Booking *
              <input type="date" value={bookingDate} onChange={(e) => setBookingDate(e.target.value)} />
              <small className="booking-identity-helper">Accounting date for this booking.</small>
            </label>
            <label>
              UB / Booking # *
              <input value={ubNumber} onChange={(e) => setUbNumber(e.target.value)} placeholder="e.g. UB-1300" />
              <small className="booking-identity-helper">Common booking reference used across services.</small>
            </label>
          </div>
        </section>

        <section className="misc13-card">
          <div className="misc13-section-head misc13-row-head">
            <div><span>2</span><b>MISC SERVICE DETAILS</b></div>
            <button type="button" className="primary small" onClick={addRow}>+ Add Service Row</button>
          </div>
          <div className="misc13-table-wrap">
            <table className="misc13-table">
              <thead><tr><th>SR</th><th>SERVICE NAME</th><th>NO. OF PAX OBTAINING</th><th>RATE / PERSON</th><th>ROE</th><th>TOTAL</th><th>ACTION</th></tr></thead>
              <tbody>{rows.map((row, index) => {
                const c = calcRow(row);
                return <tr key={row.rowId}>
                  <td>{index + 1}</td>
                  <td><input className="misc13-service" value={row.serviceName} onChange={(e) => updateRow(row.rowId, { serviceName: e.target.value })} placeholder="e.g. Makkah Ziarat" /></td>
                  <td><input type="number" min="1" step="1" value={row.paxCount} onChange={(e) => updateRow(row.rowId, { paxCount: e.target.value })} placeholder="0" /></td>
                  <td className="misc13-rate-wrap"><span className={`misc13-currency-chip ${c.mode === "SAR" ? "sar" : ""}`}>{c.mode}</span><input type="number" min="0" step="0.01" value={row.ratePerPerson} onChange={(e) => updateRow(row.rowId, { ratePerPerson: e.target.value })} placeholder="0" /><small>{c.mode === "SAR" ? "SAR / Person because ROE is entered" : "PKR / Person while ROE is blank"}</small></td>
                  <td><input type="number" min="0" step="0.01" value={row.roe} onChange={(e) => updateRow(row.rowId, { roe: e.target.value })} placeholder="Blank = PKR" /></td>
                  <td className="misc13-total"><b>{pkr(c.totalPkr)}</b>{c.mode === "SAR" && <small>{sar(c.totalSar)} · ROE {c.roe}</small>}</td>
                  <td><button type="button" className="misc13-remove" onClick={() => removeRow(row.rowId)} aria-label="Remove Misc row">×</button></td>
                </tr>;
              })}</tbody>
            </table>
          </div>
        </section>

        <section className="misc13-summary">
          <div><small>MISC SERVICES</small><b>{summary.services}</b></div>
          <div><small>TOTAL PAX ENTRIES</small><b>{summary.paxEntries}</b></div>
          <div><small>TOTAL SAR</small><b>{sar(summary.totalSar)}</b></div>
          <div className="grand"><small>GRAND TOTAL PKR</small><b>{pkr(summary.totalPkr)}</b></div>
        </section>

        <div className="misc13-actions">
          <button type="button" className="secondary" onClick={() => resetForm({ keepDirection: true })}>Clear</button>
          {((editingId && canEdit) || (!editingId && canCreate)) && <button type="button" className="primary" disabled={busy} onClick={() => void saveBooking()}>{busy ? "Saving..." : editingId ? "Update MISC Booking" : "Save MISC Booking"}</button>}
        </div>
      </section>
    );
  }

  function renderRegister() {
    return (
      <section className="booking-entry-screen misc13-page">
        <div className="booking-screen-toolbar"><button type="button" className="booking-back-button" onClick={() => setMode("FORM")}>← Back to Misc Booking</button><span className="booking-foundation-badge active-engine">MISC REGISTER</span></div>
        <div className="misc13-title"><div><span className="eyebrow blue">MISC BOOKING REGISTER</span><h2>Misc Booking Register</h2><p>General-purpose Misc Sale and Purchase bookings.</p></div></div>
        {message && <div className="alert success">{message}</div>}
        {error && <div className="alert error">{error}</div>}
        <section className="misc13-summary">
          <div><small>ACTIVE</small><b>{activeEntries.length}</b></div>
          <div><small>SALES PKR</small><b>{pkr(activeSalePkr)}</b></div>
          <div><small>PURCHASES PKR</small><b>{pkr(activePurchasePkr)}</b></div>
          <div className="grand"><small>ALL ACTIVE PKR</small><b>{pkr(activeSalePkr + activePurchasePkr)}</b></div>
        </section>
        <div className="misc13-register-controls">
          <div>{(["ALL", "SALE", "PURCHASE"] as RegisterFilter[]).map((item) => <button type="button" key={item} className={registerFilter === item ? "active" : ""} onClick={() => setRegisterFilter(item)}>{item === "ALL" ? "All Misc Bookings" : item === "SALE" ? "Sales" : "Purchases"}</button>)}</div>
          <div className="search-box"><span>⌕</span><input value={search} onChange={(e) => { setSearch(e.target.value); void loadEntries(e.target.value); }} placeholder="Search UB, Party/Vendor or Service Name..." /></div>
        </div>
        {visibleEntries.length === 0 ? <div className="empty-state compact-empty"><div className="empty-icon">MSC</div><h3>No Misc bookings found</h3><p>Create a Misc booking or change the filter/search.</p></div> : (
          <div className="party-table-wrap"><table className="party-table"><thead><tr><th>DATE</th><th>UB #</th><th>TYPE</th><th>PARTY / VENDOR</th><th>SERVICE ROWS</th><th>TOTAL SAR</th><th>TOTAL PKR</th><th>STATUS</th><th>ACTIONS</th></tr></thead><tbody>
            {visibleEntries.map((entry) => <tr key={entry.id} className={entry.status === "VOID" ? "void-row" : ""}>
              <td>{entry.transaction_date}</td><td><b>{entry.ub_number}</b></td><td><span className={`direction-badge ${entry.transaction_type === "SALE" ? "sale" : "purchase"}`}>{entry.transaction_type}</span></td><td><b>{entry.counterparty_name || "—"}</b></td>
              <td><div className="misc13-register-lines">{entry.lines.map((line) => <div key={line.id}><b>{line.service_name}</b><span>{line.pax_count} Pax × {line.currency_mode === "SAR" ? sar(line.rate_per_person) : pkr(line.rate_per_person)}</span><small>{line.currency_mode === "SAR" ? `${sar(line.line_total_sar)} · ROE ${line.roe} → ${pkr(line.line_total_pkr)}` : pkr(line.line_total_pkr)}</small></div>)}</div></td>
              <td><b>{sar(entry.total_sar)}</b></td><td className="amount"><b>{pkr(entry.total_pkr)}</b></td><td><span className={`status ${entry.status.toLowerCase()}`}>{entry.status}</span></td>
              <td><div className="row-actions"><button type="button" disabled={!canEdit || entry.status !== "ACTIVE" || busy} onClick={() => edit(entry)}>Edit</button><button type="button" disabled={!canVoid || entry.status !== "ACTIVE" || busy} onClick={() => void voidEntry(entry)}>Void</button></div></td>
            </tr>)}
          </tbody></table></div>
        )}
      </section>
    );
  }

  return mode === "REGISTER" ? renderRegister() : renderForm();
}
