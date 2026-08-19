import { useEffect, useMemo, useState } from "react";
import type { Party, PaymentEntry } from "./db";
import { getPayments } from "./db";
import {
  type BookingAccountingEntry,
  accountDirectionLabel,
  getBookingAccountingEntries,
} from "./BookingAccounting";

type Props = {
  companyId: string;
  party: Party;
  parties?: Party[];
  onBack: () => void;
  onEditParty: (party: Party) => void;
  onGenerateStatement: (party: Party) => void;
  onOpenPayments?: () => void;
  onChanged?: () => void | Promise<void>;
};

function formatDate(value: string) {
  if (!value) return "—";
  const [y, m, d] = value.split("-").map(Number);
  if (!y || !m || !d) return value;
  return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" })
    .format(new Date(y, m - 1, d))
    .replace(/ /g, "-");
}

function formatMoney(value: number) {
  return `Rs ${Number(value || 0).toLocaleString("en-PK", { maximumFractionDigits: 2 })}`;
}

function formatNumber(value: number) {
  return Number(value || 0).toLocaleString("en-PK", { maximumFractionDigits: 2 });
}

export default function PartyLedger({ companyId, party, onBack, onEditParty, onGenerateStatement, onOpenPayments }: Props) {
  const [bookings, setBookings] = useState<BookingAccountingEntry[]>([]);
  const [payments, setPayments] = useState<PaymentEntry[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const direction = accountDirectionLabel(party.account_type);
  const isVendor = party.account_type === "VENDOR";

  async function load() {
    setLoading(true);
    try {
      const [bookingRows, paymentRows] = await Promise.all([
        getBookingAccountingEntries(companyId, party.id),
        getPayments(companyId, "", party.id),
      ]);
      const relevant = party.account_type === "PARTY" ? "SALE" : party.account_type === "VENDOR" ? "PURCHASE" : null;
      setBookings(bookingRows.filter((row) => !relevant || row.transaction_type === relevant));
      setPayments(paymentRows);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, [companyId, party.id, party.account_type]);

  const activeBookings = useMemo(() => bookings.filter((entry) => entry.status === "ACTIVE"), [bookings]);
  const activePayments = useMemo(() => payments.filter((entry) => entry.status === "ACTIVE"), [payments]);
  const bookingTotal = useMemo(() => activeBookings.reduce((sum, entry) => sum + Number(entry.total_pkr || 0), 0), [activeBookings]);
  const paymentTotal = useMemo(() => activePayments.reduce((sum, entry) => sum + Number(entry.paid_amount || 0), 0), [activePayments]);
  const balance = bookingTotal - paymentTotal;

  return (
    <section className="ledger-page">
      <div className="ledger-top">
        <div>
          <button className="back-link" onClick={onBack}>← Back to {isVendor ? "Vendors" : "Parties"}</button>
          <span className="eyebrow blue">BOOKING ACCOUNT LEDGER</span>
          <h2>{party.name}</h2>
          <p>{party.address || "No address"} · {party.phone || party.whatsapp || "No contact"} · {direction}</p>
        </div>
        <div className="ledger-actions">
          <span className={`status ${party.status.toLowerCase()}`}>{party.status}</span>
          <button className="statement-ledger-btn" onClick={() => onGenerateStatement(party)}>Generate Statement</button>
          <button className="secondary" onClick={() => onEditParty(party)}>Edit {isVendor ? "Vendor" : "Party"}</button>
        </div>
      </div>

      {error && <div className="alert error ledger-alert">{error}</div>}
      {loading && <div className="alert info ledger-alert">Loading booking ledger...</div>}

      <div className="ledger-summary">
        <div className="purchase"><small>{isVendor ? "PURCHASE BOOKINGS" : "SALE BOOKINGS"}</small><b>{formatMoney(bookingTotal)}</b></div>
        <div className="paid"><small>PAYMENTS</small><b>{formatMoney(paymentTotal)}</b></div>
        <div className="balance"><small>{isVendor ? "PAYABLE BALANCE" : "RECEIVABLE BALANCE"}</small><b>{formatMoney(balance)}</b></div>
      </div>

      <div className="ledger-section blue-section services-ledger-section">
        <div className="ledger-section-title"><b>{isVendor ? "PURCHASE BOOKINGS" : "SALE BOOKINGS"} — PACKAGE / TICKET / HOTEL / VISA / TRANSPORT / MISC</b><div className="section-right"><strong>TOTAL: {formatMoney(bookingTotal)}</strong></div></div>
        {bookings.length === 0 ? <div className="coming-data">No booking transactions for this account yet. Create them from the Bookings module.</div> : <div className="ledger-table-wrap"><table className="ledger-service-table"><thead><tr><th>SR</th><th>DATE</th><th>UB #</th><th>SERVICE</th><th>TYPE</th><th>TOTAL SAR</th><th>PENDING SAR</th><th>TOTAL PKR</th><th>STATUS</th></tr></thead><tbody>{bookings.map((entry, index) => <tr key={`${entry.service_type}-${entry.id}`} className={entry.status === "VOID" ? "void-row" : ""}><td className="centered">{index + 1}</td><td>{formatDate(entry.transaction_date)}</td><td><b>{entry.ub_number || "—"}</b></td><td><b>{entry.service_type}</b></td><td className="centered">{entry.transaction_type}</td><td className="right">{entry.total_sar ? `SAR ${formatNumber(entry.total_sar)}` : "—"}</td><td className="right">{entry.unconverted_sar ? `SAR ${formatNumber(entry.unconverted_sar)}` : "—"}</td><td className="right total-pkr">{formatMoney(entry.total_pkr)}</td><td><span className={`status ${entry.status.toLowerCase()}`}>{entry.status}</span></td></tr>)}</tbody></table></div>}
      </div>

      <div className="ledger-section purple-section payments-ledger-section">
        <div className="ledger-section-title"><b>PAYMENTS</b><div className="section-right"><strong>TOTAL: {formatMoney(paymentTotal)}</strong>{onOpenPayments ? <button className="section-add-btn payment-section-add" onClick={onOpenPayments}>Manage in Payments</button> : <span className="booking-foundation-badge">Manage from Payments tab</span>}</div></div>
        {payments.length === 0 ? <div className="coming-data">No payment entries yet. Use the Payments module to record {isVendor ? "a Vendor payment" : "a Party receipt"}.</div> : <div className="ledger-table-wrap"><table className="ledger-payment-table"><thead><tr><th>SR</th><th>DATE</th><th>RECEIPT / VOUCHER #</th><th>FROM ACCOUNT</th><th>TO ACCOUNT</th><th>DESCRIPTION</th><th>METHOD</th><th>SAR</th><th>ROE</th><th>PKR AMOUNT</th></tr></thead><tbody>{payments.map((entry, index) => <tr key={entry.id} className={entry.status === "VOID" ? "void-row" : ""}><td className="centered">{index + 1}</td><td>{formatDate(entry.transaction_date)}</td><td>{entry.receipt_no || "—"}</td><td>{entry.from_account}</td><td>{entry.to_account}</td><td className="payment-description-cell">{entry.description || "—"}{entry.status === "VOID" && <small className="void-label">VOID</small>}</td><td className="centered">{entry.payment_type}</td><td className="right">{entry.currency === "SAR" ? formatNumber(entry.sar) : "—"}</td><td className="right">{entry.currency === "SAR" ? formatNumber(entry.roe) : "—"}</td><td className="right payment-paid-amount">{formatMoney(entry.paid_amount)}</td></tr>)}</tbody></table></div>}
      </div>

      <div className="bf-note"><b>Accounting source:</b> bookings remain the commercial source and Payments is the only settlement-entry workspace. Payment records are account-based and are not allocated to individual UBs.</div>
    </section>
  );
}
