import { useEffect, useMemo, useState } from "react";
import { getHotelBookings, getPackageBookings, getTransportBookings, getVisaBookings } from "./db";
import { getTicketCommercialBookings } from "./TicketFlowDb";
import { getMiscBookings } from "./miscDb";
import { normalizeBookingUb } from "./bookingUb";
import "./BookingFinalization.css";

type Props = { companyId: string; onBack: () => void };
type ServiceName = "PACKAGE" | "TICKET" | "HOTEL" | "VISA" | "TRANSPORT" | "MISC";
type Row = {
  id: string;
  service: ServiceName;
  transactionType: "SALE" | "PURCHASE";
  ubNumber: string;
  counterpartyName: string;
  transactionDate: string;
  totalPkr: number;
};

type Umbrella = {
  ubNumber: string;
  rows: Row[];
  saleTotal: number;
  purchaseTotal: number;
  margin: number;
  latestDate: string;
};

function money(value: number) { return `Rs ${Number(value || 0).toLocaleString("en-PK", { maximumFractionDigits: 2 })}`; }

export default function UbControl({ companyId, onBack }: Props) {
  const [rows, setRows] = useState<Row[]>([]);
  const [search, setSearch] = useState("");
  const [selectedUb, setSelectedUb] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => { void load(); }, [companyId]);

  async function load() {
    setLoading(true); setError("");
    try {
      const [packages, tickets, hotels, visas, transports, misc] = await Promise.all([
        getPackageBookings(companyId, ""),
        getTicketCommercialBookings(companyId, ""),
        getHotelBookings(companyId, ""),
        getVisaBookings(companyId, ""),
        getTransportBookings(companyId, ""),
        getMiscBookings(companyId, ""),
      ]);
      const next: Row[] = [];
      const push = (service: ServiceName, entries: Array<{ id: string; transaction_type: "SALE" | "PURCHASE"; ub_number: string; counterparty_name: string; transaction_date: string; total_pkr: number; status: string }>) => {
        entries.filter((entry) => entry.status === "ACTIVE").forEach((entry) => next.push({ id: entry.id, service, transactionType: entry.transaction_type, ubNumber: normalizeBookingUb(entry.ub_number), counterpartyName: entry.counterparty_name, transactionDate: entry.transaction_date, totalPkr: Number(entry.total_pkr || 0) }));
      };
      push("PACKAGE", packages); push("TICKET", tickets); push("HOTEL", hotels); push("VISA", visas); push("TRANSPORT", transports); push("MISC", misc);
      setRows(next);
      if (!selectedUb && next.length) setSelectedUb(next[0].ubNumber);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }

  const umbrellas = useMemo<Umbrella[]>(() => {
    const grouped = new Map<string, Row[]>();
    rows.forEach((row) => { const current = grouped.get(row.ubNumber) || []; current.push(row); grouped.set(row.ubNumber, current); });
    return [...grouped.entries()].map(([ubNumber, entries]) => {
      const saleTotal = entries.filter((row) => row.transactionType === "SALE").reduce((sum, row) => sum + row.totalPkr, 0);
      const purchaseTotal = entries.filter((row) => row.transactionType === "PURCHASE").reduce((sum, row) => sum + row.totalPkr, 0);
      return { ubNumber, rows: entries, saleTotal, purchaseTotal, margin: saleTotal - purchaseTotal, latestDate: entries.map((row) => row.transactionDate).sort().reverse()[0] || "" };
    }).sort((a, b) => b.latestDate.localeCompare(a.latestDate) || a.ubNumber.localeCompare(b.ubNumber));
  }, [rows]);

  const filtered = umbrellas.filter((item) => !search.trim() || item.ubNumber.includes(search.trim().toUpperCase()) || item.rows.some((row) => row.counterpartyName.toLowerCase().includes(search.trim().toLowerCase())));
  const selected = umbrellas.find((item) => item.ubNumber === selectedUb) || filtered[0] || null;
  const saleRows = selected?.rows.filter((row) => row.transactionType === "SALE") || [];
  const purchaseRows = selected?.rows.filter((row) => row.transactionType === "PURCHASE") || [];
  const marginPercent = selected && selected.saleTotal > 0 ? (selected.margin / selected.saleTotal) * 100 : 0;

  return <section className="booking-entry-screen bf-page bf-ub-control">
    <div className="booking-screen-toolbar"><button className="booking-back-button" onClick={onBack}>← Back to Bookings</button><span className="booking-foundation-badge active-engine">UB CONTROL</span></div>
    <div className="bf-title"><div><span className="eyebrow blue">UB CONTROL</span><h2>Unified Booking Umbrella</h2><p>View every active Sale and Purchase connected to the same UB across Package, Ticket, Hotel, Visa, Transport and Misc.</p></div><button className="secondary" onClick={() => void load()} disabled={loading}>{loading ? "Refreshing..." : "Refresh UB Data"}</button></div>
    {error && <div className="alert error">{error}</div>}
    <section className="bf-card"><div className="bf-section-head"><div><span>UB</span><div><b>FIND BOOKING UMBRELLA</b><small>Search by UB or Party / Vendor name.</small></div></div></div><div className="bf-inline-toolbar bf-ub-search"><label>Search UB / Account<input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="e.g. UB-4555 or Muhammad Aslam" /></label><label>Select UB<select value={selected?.ubNumber || ""} onChange={(e) => setSelectedUb(e.target.value)}>{filtered.map((item) => <option key={item.ubNumber} value={item.ubNumber}>{item.ubNumber} · {item.rows.length} booking record{item.rows.length === 1 ? "" : "s"}</option>)}</select></label></div></section>

    {!selected ? <div className="package14-next-step">No active Booking UBs are available yet.</div> : <>
      <section className="bf-card"><div className="bf-section-head"><div><span>01</span><div><b>{selected.ubNumber}</b><small>Unified commercial position across all booking services.</small></div></div><span className="status active">ACTIVE</span></div><div className="bf-ub-position"><div><small>TOTAL SALES</small><b>{money(selected.saleTotal)}</b></div><div><small>TOTAL PURCHASES</small><b>{money(selected.purchaseTotal)}</b></div><div className="margin"><small>GROSS MARGIN</small><b>{money(selected.margin)}</b></div><div><small>MARGIN %</small><b>{marginPercent.toLocaleString("en-PK", { maximumFractionDigits: 2 })}%</b></div></div></section>
      <div className="bf-ub-grid">
        <section className="bf-ub-side"><h3>SALE SIDE</h3><div className="bf-table-wrap"><table className="bf-table" style={{ minWidth: 640 }}><thead><tr><th>SERVICE</th><th>PARTY / CUSTOMER</th><th>DATE</th><th>TOTAL PKR</th></tr></thead><tbody>{saleRows.length ? saleRows.map((row) => <tr key={`${row.service}-${row.id}`}><td><b>{row.service}</b></td><td>{row.counterpartyName}</td><td>{row.transactionDate}</td><td className="bf-money">{money(row.totalPkr)}</td></tr>) : <tr><td colSpan={4} className="bf-empty-cell">No Sale bookings under this UB.</td></tr>}</tbody></table></div><div className="bf-ub-total"><span>TOTAL SALES</span><b>{money(selected.saleTotal)}</b></div></section>
        <section className="bf-ub-side purchase"><h3>PURCHASE SIDE</h3><div className="bf-table-wrap"><table className="bf-table" style={{ minWidth: 640 }}><thead><tr><th>SERVICE</th><th>VENDOR / SUPPLIER</th><th>DATE</th><th>TOTAL PKR</th></tr></thead><tbody>{purchaseRows.length ? purchaseRows.map((row) => <tr key={`${row.service}-${row.id}`}><td><b>{row.service}</b></td><td>{row.counterpartyName}</td><td>{row.transactionDate}</td><td className="bf-money">{money(row.totalPkr)}</td></tr>) : <tr><td colSpan={4} className="bf-empty-cell">No Purchase bookings under this UB.</td></tr>}</tbody></table></div><div className="bf-ub-total"><span>TOTAL PURCHASES</span><b>{money(selected.purchaseTotal)}</b></div></section>
      </div>
      <div className="bf-note"><b>UB Control foundation:</b> this screen consolidates commercial Sale and Purchase totals under one UB. Payments, receivables/payables, vouchers, documents and passenger movement will be connected to this umbrella in the next accounting phases.</div>
    </>}
  </section>;
}
