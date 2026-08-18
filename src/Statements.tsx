import { useEffect, useMemo, useState } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";
import { downloadDir, join } from "@tauri-apps/api/path";

import { Company, Party, PaymentEntry, getPayments } from "./db";
import {
  BookingAccountingEntry,
  accountDirectionLabel,
  getBookingAccountingEntries,
} from "./BookingAccounting";
import { buildStatementPdf, StatementPdfData } from "./StatementJsPdf";

type PeriodType = "FULL_LEDGER" | "THIS_MONTH" | "LAST_MONTH" | "CUSTOM";

type Props = {
  company: Company;
  parties: Party[];
  initialPartyId?: string;
  onOpenLedger: (party: Party) => void;
};

function todayIso() {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function isoFromDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function thisMonthRange() {
  const now = new Date();
  return { from: isoFromDate(new Date(now.getFullYear(), now.getMonth(), 1)), to: todayIso() };
}

function lastMonthRange() {
  const now = new Date();
  return {
    from: isoFromDate(new Date(now.getFullYear(), now.getMonth() - 1, 1)),
    to: isoFromDate(new Date(now.getFullYear(), now.getMonth(), 0)),
  };
}

function generatedDate() {
  return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" })
    .format(new Date())
    .replace(/ /g, "-");
}

function makeStatementRef() {
  const now = new Date();
  const date = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
  const time = `${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}${String(now.getSeconds()).padStart(2, "0")}`;
  return `FT-${date}-${time}`;
}

function safeFileName(text: string) {
  return text.trim().replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, "_");
}

function inPeriod(date: string, from: string, to: string) {
  return date >= from && date <= to;
}

function beforePeriod(date: string, from: string) {
  return date < from;
}

function sum<T>(rows: T[], selector: (row: T) => number) {
  return rows.reduce((total, row) => total + Number(selector(row) || 0), 0);
}

function money(value: number) {
  return `Rs ${Number(value || 0).toLocaleString("en-PK", { maximumFractionDigits: 2 })}`;
}

export default function StatementsModule({ company, parties, initialPartyId = "", onOpenLedger }: Props) {
  const [partyId, setPartyId] = useState(initialPartyId || parties[0]?.id || "");
  const [periodType, setPeriodType] = useState<PeriodType>("FULL_LEDGER");
  const [fromDate, setFromDate] = useState(todayIso());
  const [toDate, setToDate] = useState(todayIso());
  const [bookings, setBookings] = useState<BookingAccountingEntry[]>([]);
  const [payments, setPayments] = useState<PaymentEntry[]>([]);
  const [statementRef, setStatementRef] = useState(makeStatementRef());
  const [generatedOn, setGeneratedOn] = useState(generatedDate());
  const [previewUrl, setPreviewUrl] = useState("");
  const [pdfBlob, setPdfBlob] = useState<Blob | null>(null);
  const [loading, setLoading] = useState(false);
  const [buildingPdf, setBuildingPdf] = useState(false);
  const [savingPdf, setSavingPdf] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const selectedParty = useMemo(() => parties.find((party) => party.id === partyId) ?? null, [parties, partyId]);
  const accountDirection = selectedParty ? accountDirectionLabel(selectedParty.account_type) : "BOOKING";

  useEffect(() => {
    if (initialPartyId && parties.some((party) => party.id === initialPartyId)) {
      setPartyId(initialPartyId);
    } else if (!partyId && parties[0]) {
      setPartyId(parties[0].id);
    }
  }, [initialPartyId, parties, partyId]);

  useEffect(() => {
    if (!partyId || !selectedParty) {
      setBookings([]);
      setPayments([]);
      return;
    }
    void loadPartyTransactions(partyId, selectedParty.account_type);
  }, [company.id, partyId, selectedParty?.account_type]);

  async function loadPartyTransactions(selectedPartyId: string, accountType: Party["account_type"]) {
    setLoading(true);
    setError("");
    setMessage("");
    try {
      const [bookingRows, paymentRows] = await Promise.all([
        getBookingAccountingEntries(company.id, selectedPartyId),
        getPayments(company.id, "", selectedPartyId),
      ]);

      const relevantDirection = accountType === "PARTY" ? "SALE" : accountType === "VENDOR" ? "PURCHASE" : null;
      const activeBookings = bookingRows.filter(
        (row) => row.status === "ACTIVE" && (!relevantDirection || row.transaction_type === relevantDirection)
      );
      const activePayments = paymentRows.filter((row) => row.status === "ACTIVE");

      setBookings(activeBookings);
      setPayments(activePayments);
      applyAutomaticPeriod(periodType, activeBookings, activePayments);
      refreshStatementIdentity();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  function applyAutomaticPeriod(type: PeriodType, bookingRows = bookings, paymentRows = payments) {
    if (type === "CUSTOM") return;
    if (type === "THIS_MONTH") {
      const range = thisMonthRange();
      setFromDate(range.from);
      setToDate(range.to);
      return;
    }
    if (type === "LAST_MONTH") {
      const range = lastMonthRange();
      setFromDate(range.from);
      setToDate(range.to);
      return;
    }

    const dates = [
      ...bookingRows.map((row) => row.transaction_date),
      ...paymentRows.map((row) => row.transaction_date),
    ].filter(Boolean).sort();
    if (dates.length) {
      setFromDate(dates[0]);
      setToDate(dates[dates.length - 1]);
    } else {
      const today = todayIso();
      setFromDate(today);
      setToDate(today);
    }
  }

  function changePeriod(type: PeriodType) {
    setPeriodType(type);
    setError("");
    setMessage("");
    applyAutomaticPeriod(type);
    refreshStatementIdentity();
  }

  function refreshStatementIdentity() {
    setStatementRef(makeStatementRef());
    setGeneratedOn(generatedDate());
  }

  function validatePeriod() {
    if (!partyId) return setError("Select a Party / Vendor."), false;
    if (!fromDate || !toDate) return setError("Select both From Date and To Date."), false;
    if (fromDate > toDate) return setError("From Date cannot be after To Date."), false;
    return true;
  }

  const periodBookings = useMemo(
    () => bookings.filter((row) => inPeriod(row.transaction_date, fromDate, toDate)),
    [bookings, fromDate, toDate]
  );
  const periodPayments = useMemo(
    () => payments.filter((row) => inPeriod(row.transaction_date, fromDate, toDate)),
    [payments, fromDate, toDate]
  );

  const openingBooked = useMemo(
    () => sum(bookings.filter((row) => beforePeriod(row.transaction_date, fromDate)), (row) => row.total_pkr),
    [bookings, fromDate]
  );
  const openingPayments = useMemo(
    () => sum(payments.filter((row) => beforePeriod(row.transaction_date, fromDate)), (row) => row.paid_amount),
    [payments, fromDate]
  );
  const openingBalance = openingBooked - openingPayments;
  const bookingsDuringPeriod = sum(periodBookings, (row) => row.total_pkr);
  const paymentsDuringPeriod = sum(periodPayments, (row) => row.paid_amount);
  const closingBalance = openingBalance + bookingsDuringPeriod - paymentsDuringPeriod;

  const pdfData = useMemo<StatementPdfData | null>(() => {
    if (!selectedParty || !fromDate || !toDate) return null;
    return {
      company,
      party: selectedParty,
      accountDirection,
      fromDate,
      toDate,
      generatedOn,
      statementRef,
      openingBalance,
      bookingsDuringPeriod,
      paymentsDuringPeriod,
      closingBalance,
      bookings: periodBookings,
      payments: periodPayments,
    };
  }, [company, selectedParty, accountDirection, fromDate, toDate, generatedOn, statementRef, openingBalance, bookingsDuringPeriod, paymentsDuringPeriod, closingBalance, periodBookings, periodPayments]);

  useEffect(() => {
    let cancelled = false;
    let nextUrl = "";
    async function buildPreview() {
      if (!pdfData) {
        setPdfBlob(null);
        setPreviewUrl("");
        return;
      }
      setBuildingPdf(true);
      setError("");
      try {
        const doc = buildStatementPdf(pdfData);
        const blob = doc.output("blob");
        if (cancelled) return;
        nextUrl = URL.createObjectURL(blob);
        setPdfBlob(blob);
        setPreviewUrl(nextUrl);
      } catch (e) {
        if (!cancelled) setError(`Could not build statement PDF: ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        if (!cancelled) setBuildingPdf(false);
      }
    }
    void buildPreview();
    return () => {
      cancelled = true;
      if (nextUrl) URL.revokeObjectURL(nextUrl);
    };
  }, [pdfData]);

  async function savePdf() {
    if (!pdfBlob || !pdfData || !selectedParty) return setError("Statement PDF is not ready yet.");
    if (!validatePeriod()) return;
    setSavingPdf(true);
    setError("");
    setMessage("");
    try {
      const bytes = new Uint8Array(await pdfBlob.arrayBuffer());
      const fileName = `${safeFileName(company.name)}_Statement_${safeFileName(selectedParty.name)}_${fromDate}_to_${toDate}.pdf`;
      const defaultPath = await join(await downloadDir(), fileName);
      const filePath = await save({ title: "Save Statement PDF", defaultPath, filters: [{ name: "PDF Document", extensions: ["pdf"] }] });
      if (!filePath) return;
      await writeFile(filePath, bytes);
      setMessage("PDF saved successfully.");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingPdf(false);
    }
  }

  const accountLabel = selectedParty?.account_type === "VENDOR" ? "Vendor / Supplier" : "Party / Customer";
  const bookedLabel = selectedParty?.account_type === "VENDOR" ? "PURCHASE BOOKINGS" : "SALE BOOKINGS";
  const balanceLabel = selectedParty?.account_type === "VENDOR" ? "PAYABLE BALANCE" : "RECEIVABLE BALANCE";

  return (
    <section className="content-card statements-page">
      <div className="page-title">
        <div>
          <span className="eyebrow blue">BOOKING ACCOUNT STATEMENT</span>
          <h2>Statements</h2>
          <p>Statements now use Package, Ticket, Hotel, Visa, Transport and Misc bookings as the commercial source of truth.</p>
        </div>
        {selectedParty && <button className="secondary" onClick={() => onOpenLedger(selectedParty)}>Open Account Ledger</button>}
      </div>

      {message && <div className="alert success">{message}</div>}
      {error && <div className="alert error">{error}</div>}

      <div className="statement-controls">
        <label>{accountLabel}
          <select value={partyId} onChange={(e) => setPartyId(e.target.value)}>
            <option value="">Select account...</option>
            {parties.filter((party) => party.account_type !== "UNASSIGNED").map((party) => <option key={party.id} value={party.id}>{party.name} · {party.account_type}</option>)}
          </select>
        </label>
        <div className="statement-period-tabs">
          {(["FULL_LEDGER", "THIS_MONTH", "LAST_MONTH", "CUSTOM"] as PeriodType[]).map((type) => (
            <button key={type} type="button" className={periodType === type ? "active" : ""} onClick={() => changePeriod(type)}>
              {type === "FULL_LEDGER" ? "Full Ledger" : type === "THIS_MONTH" ? "This Month" : type === "LAST_MONTH" ? "Last Month" : "Custom"}
            </button>
          ))}
        </div>
        <label>From Date<input type="date" value={fromDate} onChange={(e) => { setPeriodType("CUSTOM"); setFromDate(e.target.value); refreshStatementIdentity(); }} /></label>
        <label>To Date<input type="date" value={toDate} onChange={(e) => { setPeriodType("CUSTOM"); setToDate(e.target.value); refreshStatementIdentity(); }} /></label>
      </div>

      <div className="module-summary-row statement-summary-row">
        <div><small>OPENING BALANCE</small><b>{money(openingBalance)}</b></div>
        <div><small>{bookedLabel}</small><b>{money(bookingsDuringPeriod)}</b></div>
        <div><small>PAYMENTS</small><b>{money(paymentsDuringPeriod)}</b></div>
        <div><small>{balanceLabel}</small><b>{money(closingBalance)}</b></div>
      </div>

      <div className="statement-accounting-note">
        <b>{selectedParty ? `${selectedParty.name} · ${accountDirection}` : "Select an account"}</b>
        <span>{selectedParty?.account_type === "VENDOR" ? "Purchase bookings increase payable; payments reduce payable." : "Sale bookings increase receivable; payments reduce receivable."}</span>
      </div>

      <div className="statement-preview-shell">
        <div className="statement-preview-head">
          <div><b>PDF Preview</b><span>{loading ? "Loading booking data..." : buildingPdf ? "Building preview..." : `${periodBookings.length} booking(s) · ${periodPayments.length} payment(s)`}</span></div>
          <button className="primary statement-primary" disabled={!pdfBlob || savingPdf || buildingPdf} onClick={() => void savePdf()}>{savingPdf ? "Saving..." : "Save PDF"}</button>
        </div>
        {previewUrl ? <iframe className="statement-pdf-preview" src={previewUrl} title="Statement PDF Preview" /> : <div className="empty-state"><h3>No statement preview yet</h3><p>Select an account with booking or payment activity.</p></div>}
      </div>
    </section>
  );
}
