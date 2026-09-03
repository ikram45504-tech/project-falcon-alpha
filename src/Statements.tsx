import { useEffect, useMemo, useState } from "react";

import { Company, Party, PaymentEntry, getPayments } from "./db";
import { accountDirectionLabel } from "./BookingAccounting";
import { inferPaymentKind, signedPaymentSettlement } from "./accountBalance";
import {
  countStatementBookings,
  filterStatementSections,
  getStatementBookingSections,
  statementBookingHeaders,
  type StatementBookingSections,
} from "./StatementBookingData";
import { buildStatementPdf, StatementPdfData } from "./StatementJsPdf";
import StatementDocument from "./StatementDocument";
import {
  hasSarFigure,
  statementClosingBalanceDisplayPkr,
  statementClosingBalanceLabel,
  statementPeriodActivitySar,
  sumSignedPaymentSar,
} from "./StatementSummary";
import { getChronologicalLedger, type LedgerRow } from "./LedgerEngine";
import { getPaymentV2MetaForPayments, type PaymentV2Meta } from "./PaymentV2Db";
import { downloadExcel } from "./exportUtils";

type PeriodType = "FULL_LEDGER" | "THIS_MONTH" | "LAST_MONTH" | "CUSTOM";

type Props = {
  company: Company;
  parties: Party[];
  initialPartyId?: string;
  onOpenLedger: (party: Party) => void;
  onConsumed?: () => void;
};

function emptySections(): StatementBookingSections {
  return {
    packageBookings: [],
    ticketBookings: [],
    hotelBookings: [],
    visaBookings: [],
    transportBookings: [],
    miscBookings: [],
  };
}

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
  return text
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, "_");
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

function formatDate(value: string) {
  if (!value) return "—";
  const [y, m, d] = value.split("-").map(Number);
  if (!y || !m || !d) return value;
  return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" })
    .format(new Date(y, m - 1, d))
    .replace(/ /g, "-");
}

function sar(value: number) {
  return `SAR ${Number(value || 0).toLocaleString("en-PK", { maximumFractionDigits: 2 })}`;
}

export default function StatementsModule({ company, parties, initialPartyId = "", onOpenLedger, onConsumed }: Props) {
  const initialParty = parties.find((p) => p.id === initialPartyId);
  const [statementDirection, setStatementDirection] = useState<"PARTY" | "VENDOR" | null>(
    (initialParty?.account_type as "PARTY" | "VENDOR") || null,
  );
  const [partyId, setPartyId] = useState(initialPartyId || "");

  // Once we've consumed the initialPartyId, clear it in the parent so
  // subsequent visits to Statements start with the direction-selection screen.
  useEffect(() => {
    if (initialPartyId && onConsumed) {
      onConsumed();
    }
  }, []);
  const [periodType, setPeriodType] = useState<PeriodType>("FULL_LEDGER");
  const [fromDate, setFromDate] = useState(todayIso());
  const [toDate, setToDate] = useState(todayIso());
  const [sections, setSections] = useState<StatementBookingSections>(() => emptySections());
  const [payments, setPayments] = useState<PaymentEntry[]>([]);
  const [ledgerRows, setLedgerRows] = useState<LedgerRow[]>([]);
  const [paymentMeta, setPaymentMeta] = useState<Map<string, PaymentV2Meta>>(() => new Map());
  const [includeLedger, setIncludeLedger] = useState(false);
  const [includeReconciliation, setIncludeReconciliation] = useState(false);
  const [previewMode, setPreviewMode] = useState<"pdf" | "print">("pdf");
  const [statementRef, setStatementRef] = useState(makeStatementRef());
  const [generatedOn, setGeneratedOn] = useState(generatedDate());
  const [loading, setLoading] = useState(false);
  const [savingPdf, setSavingPdf] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const selectedParty = useMemo(() => parties.find((party) => party.id === partyId) ?? null, [parties, partyId]);
  const accountDirection = selectedParty ? accountDirectionLabel(selectedParty.account_type) : "BOOKING";
  const bookingHeaders = useMemo(() => statementBookingHeaders(sections), [sections]);

  useEffect(() => {
    if (initialPartyId && parties.some((party) => party.id === initialPartyId)) {
      setPartyId(initialPartyId);
    }
  }, [initialPartyId, parties]);

  useEffect(() => {
    if (!partyId || !selectedParty) {
      setSections(emptySections());
      setPayments([]);
      return;
    }
    void loadPartyTransactions(partyId, selectedParty.account_type, selectedParty);
  }, [company.id, partyId, selectedParty?.account_type]);

  async function loadPartyTransactions(selectedPartyId: string, accountType: Party["account_type"], party: Party) {
    setLoading(true);
    setError("");
    setMessage("");
    try {
      const [bookingSections, paymentRows, fullLedger] = await Promise.all([
        getStatementBookingSections(company.id, selectedPartyId, accountType),
        getPayments(company.id, "", selectedPartyId),
        getChronologicalLedger(company.id, party),
      ]);

      const activePayments = paymentRows.filter((row) => row.status === "ACTIVE");
      const meta = await getPaymentV2MetaForPayments(
        company.id,
        activePayments.map((row) => row.id),
      );
      const headers = statementBookingHeaders(bookingSections);
      setSections(bookingSections);
      setPayments(activePayments);
      setPaymentMeta(meta);
      setLedgerRows(fullLedger);
      applyAutomaticPeriod(periodType, headers, activePayments);
      refreshStatementIdentity();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  function applyAutomaticPeriod(type: PeriodType, headers = bookingHeaders, paymentRows = payments) {
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

    const dates = [...headers.map((row) => row.transaction_date), ...paymentRows.map((row) => row.transaction_date)]
      .filter(Boolean)
      .sort();
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
    if (!partyId) return (setError("Select a Party / Vendor."), false);
    if (!fromDate || !toDate) return (setError("Select both From Date and To Date."), false);
    if (fromDate > toDate) return (setError("From Date cannot be after To Date."), false);
    return true;
  }

  const periodSections = useMemo(
    () => filterStatementSections(sections, fromDate, toDate),
    [sections, fromDate, toDate],
  );
  const periodBookingHeaders = useMemo(() => statementBookingHeaders(periodSections), [periodSections]);
  const periodPayments = useMemo(
    () => payments.filter((row) => inPeriod(row.transaction_date, fromDate, toDate)),
    [payments, fromDate, toDate],
  );

  const signedPaymentAmount = (entry: PaymentEntry) =>
    selectedParty
      ? signedPaymentSettlement(
          entry.paid_amount,
          inferPaymentKind(paymentMeta.get(entry.id), selectedParty.account_type),
        )
      : Number(entry.paid_amount || 0);

  const openingBooked = useMemo(
    () =>
      sum(
        bookingHeaders.filter((row) => beforePeriod(row.transaction_date, fromDate)),
        (row) => row.total_pkr,
      ),
    [bookingHeaders, fromDate],
  );
  const openingPayments = useMemo(
    () =>
      sum(
        payments.filter((row) => beforePeriod(row.transaction_date, fromDate)),
        (row) => signedPaymentAmount(row),
      ),
    [payments, fromDate, paymentMeta, selectedParty?.account_type],
  );
  const openingBalance = openingBooked - openingPayments;
  const bookingsDuringPeriod = sum(periodBookingHeaders, (row) => row.total_pkr);
  const paymentsDuringPeriod = sum(periodPayments, (row) => signedPaymentAmount(row));
  const closingBalance = openingBalance + bookingsDuringPeriod - paymentsDuringPeriod;
  const openingSar = sum(
    bookingHeaders.filter((row) => beforePeriod(row.transaction_date, fromDate)),
    (row) => row.unconverted_sar,
  );
  const bookingsDuringPeriodSar = statementPeriodActivitySar(periodSections);
  const paymentsDuringPeriodSar = selectedParty
    ? sumSignedPaymentSar(periodPayments, paymentMeta, selectedParty.account_type)
    : 0;
  const pendingSarBalance = sum(
    bookingHeaders.filter((row) => row.transaction_date <= toDate),
    (row) => row.unconverted_sar,
  );

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
      openingSar,
      bookingsDuringPeriod,
      bookingsDuringPeriodSar,
      paymentsDuringPeriod,
      paymentsDuringPeriodSar,
      closingBalance,
      pendingSarBalance,
      sections: periodSections,
      payments: periodPayments,
      paymentMeta,
      ledgerRows: includeLedger
        ? ledgerRows.filter((row) => row.status === "ACTIVE" && inPeriod(row.transaction_date, fromDate, toDate))
        : [],
      includeLedger,
      includeReconciliation,
      previewMode,
    };
  }, [
    company,
    selectedParty,
    accountDirection,
    fromDate,
    toDate,
    generatedOn,
    statementRef,
    openingBalance,
    openingSar,
    bookingsDuringPeriod,
    bookingsDuringPeriodSar,
    paymentsDuringPeriod,
    paymentsDuringPeriodSar,
    closingBalance,
    pendingSarBalance,
    periodSections,
    periodPayments,
    paymentMeta,
    ledgerRows,
    includeLedger,
    includeReconciliation,
    previewMode,
  ]);

  async function savePdf() {
    if (!pdfData || !selectedParty) return setError("Statement is not ready yet.");
    if (!validatePeriod()) return;
    setSavingPdf(true);
    setError("");
    setMessage("");
    try {
      const doc = buildStatementPdf(pdfData);
      const pdfBytes = new Uint8Array(doc.output("arraybuffer"));
      const fileName = `${safeFileName(company.name)}_Statement_${safeFileName(selectedParty.name)}_${fromDate}_to_${toDate}.pdf`;
      const isTauri = "__TAURI_INTERNALS__" in window;

      if (!isTauri) {
        const blob = new Blob([pdfBytes], { type: "application/pdf" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        return;
      }

      const { downloadDir, join } = await import("@tauri-apps/api/path");
      const { save } = await import("@tauri-apps/plugin-dialog");
      const { writeFile } = await import("@tauri-apps/plugin-fs");

      const defaultPath = await join(await downloadDir(), fileName);
      const filePath = await save({
        defaultPath,
        filters: [{ name: "PDF Document", extensions: ["pdf"] }],
      });
      if (filePath) {
        await writeFile(filePath, pdfBytes);
      }
      setMessage("PDF saved successfully.");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingPdf(false);
    }
  }

  function handleExport() {
    if (!selectedParty) return setError("Select an account first.");
    const filteredLedger = ledgerRows.filter(
      (row) => row.status === "ACTIVE" && inPeriod(row.transaction_date, fromDate, toDate),
    );

    const bookingData = filteredLedger.map((b, i) => ({
      "SR #": i + 1,
      Date: b.transaction_date,
      "UB #": b.ref_no || "-",
      Service: b.service_type,
      Description: b.description || "-",
      "Debit (PKR)": b.debit || 0,
      "Credit (PKR)": b.credit || 0,
      "Balance (PKR)": b.running_balance || 0,
    }));

    const paymentData = periodPayments.map((p, i) => ({
      "SR #": i + 1,
      Date: p.transaction_date,
      "Receipt #": p.receipt_no || "-",
      "From Account": p.from_account,
      "To Account": p.to_account,
      Description: p.description || "-",
      Method: p.payment_type,
      SAR: p.currency === "SAR" ? p.sar || 0 : "",
      ROE: p.currency === "SAR" ? p.roe || 0 : "",
      "PKR Amount": p.paid_amount || 0,
    }));

    const summaryData = [
      {
        "Account Name": selectedParty.name,
        "Account Type": selectedParty.account_type,
        "Period From": fromDate,
        "Period To": toDate,
        "Opening Balance (PKR)": openingBalance,
        ...(hasSarFigure(openingSar) ? { "Opening (SAR)": openingSar } : {}),
        [statementDirection === "VENDOR" ? "Total Purchase (PKR)" : "Total Sales (PKR)"]: bookingsDuringPeriod,
        ...(hasSarFigure(bookingsDuringPeriodSar)
          ? {
              [statementDirection === "VENDOR" ? "Total Purchase (SAR)" : "Total Sales (SAR)"]: bookingsDuringPeriodSar,
            }
          : {}),
        "Paid Amount (PKR)": paymentsDuringPeriod,
        ...(hasSarFigure(paymentsDuringPeriodSar) ? { "Paid Amount (SAR)": paymentsDuringPeriodSar } : {}),
        [statementClosingBalanceLabel(selectedParty.account_type, closingBalance)]:
          statementClosingBalanceDisplayPkr(closingBalance),
        ...(hasSarFigure(pendingSarBalance) ? { "Pending SAR": pendingSarBalance } : {}),
      },
    ];

    downloadExcel(
      [
        { name: "Summary", data: summaryData },
        { name: "Ledger", data: bookingData },
        { name: "Payments", data: paymentData },
      ],
      `${safeFileName(company.name)}_Excel_Statement_${safeFileName(selectedParty.name)}_${fromDate}_to_${toDate}`,
    );
  }

  const accountLabel = statementDirection === "VENDOR" ? "Vendor / Supplier" : "Party / Customer";
  const bookedLabel = statementDirection === "VENDOR" ? "TOTAL PURCHASE" : "TOTAL SALES";
  const balanceLabel = selectedParty
    ? statementClosingBalanceLabel(selectedParty.account_type, closingBalance)
    : statementDirection === "VENDOR"
      ? "PAYABLE BALANCE"
      : "RECEIVABLE BALANCE";
  const periodBookingCount = countStatementBookings(periodSections);

  if (!statementDirection) {
    return (
      <section className="booking-entry-screen booking-direction-screen">
        <div className="booking-screen-toolbar">
          <span></span>
        </div>
        <div className="booking-screen-heading centered-heading">
          <span className="eyebrow blue">STATEMENT OF ACCOUNT</span>
          <h2>Which statement do you need?</h2>
          <p>Select whether you want to generate a statement for a Party (Customer) or a Vendor (Supplier).</p>
        </div>
        <div className="booking-direction-grid">
          <button type="button" className="booking-direction-card sale" onClick={() => setStatementDirection("PARTY")}>
            <span className="direction-card-icon" aria-hidden="true">
              ↗
            </span>
            <div>
              <small>PARTY / CUSTOMER</small>
              <b>Customer Statement</b>
              <p>Generate a statement showing receivable balances and sale bookings.</p>
            </div>
            <span className="direction-arrow">→</span>
          </button>
          <button
            type="button"
            className="booking-direction-card purchase"
            onClick={() => setStatementDirection("VENDOR")}
          >
            <span className="direction-card-icon" aria-hidden="true">
              ↙
            </span>
            <div>
              <small>VENDOR / SUPPLIER</small>
              <b>Supplier Statement</b>
              <p>Generate a statement showing payable balances and purchase bookings.</p>
            </div>
            <span className="direction-arrow">→</span>
          </button>
        </div>
      </section>
    );
  }

  return (
    <section
      className={`content-card statements-page bookings-flow-v2 statement-workspace-v3${previewMode === "print" ? " statement-print-mode" : ""}`}
    >
      <div className="booking-screen-toolbar">
        <button
          type="button"
          className="booking-back-button"
          onClick={() => {
            setStatementDirection(null);
            setPartyId("");
          }}
        >
          ← Change statement type
        </button>
        <div className="bf-toolbar-actions">
          <span className={`direction-badge ${statementDirection === "PARTY" ? "sale" : "purchase"}`}>
            {statementDirection === "PARTY" ? "CUSTOMER STATEMENT" : "SUPPLIER STATEMENT"}
          </span>
        </div>
      </div>

      {message && <div className="alert success">{message}</div>}
      {error && <div className="alert error">{error}</div>}

      <div className="statement-workspace-toolbar">
        <label>
          {accountLabel}
          <select value={partyId} onChange={(e) => setPartyId(e.target.value)}>
            <option value="">Select account...</option>
            {parties
              .filter((party) => party.account_type === statementDirection)
              .map((party) => (
                <option key={party.id} value={party.id}>
                  {party.name}
                </option>
              ))}
          </select>
        </label>
        <div className="statement-period-pills">
          {(["FULL_LEDGER", "THIS_MONTH", "LAST_MONTH", "CUSTOM"] as PeriodType[]).map((type) => (
            <button
              key={type}
              type="button"
              className={periodType === type ? "active" : ""}
              onClick={() => changePeriod(type)}
            >
              {type === "FULL_LEDGER"
                ? "Full ledger"
                : type === "THIS_MONTH"
                  ? "This month"
                  : type === "LAST_MONTH"
                    ? "Last month"
                    : "Custom"}
            </button>
          ))}
        </div>
        {periodType === "CUSTOM" && (
          <div className="statement-custom-dates">
            <label>
              From
              <input
                type="date"
                value={fromDate}
                onChange={(e) => {
                  setFromDate(e.target.value);
                  refreshStatementIdentity();
                }}
              />
            </label>
            <label>
              To
              <input
                type="date"
                value={toDate}
                onChange={(e) => {
                  setToDate(e.target.value);
                  refreshStatementIdentity();
                }}
              />
            </label>
          </div>
        )}
      </div>

      {selectedParty && (
        <>
          <div className="statement-hero-balance">
            <div>
              <small>{balanceLabel}</small>
              <b>{money(statementClosingBalanceDisplayPkr(closingBalance))}</b>
              {hasSarFigure(pendingSarBalance) ? (
                <span className="statement-hero-sar">{sar(pendingSarBalance)}</span>
              ) : null}
            </div>
            <div className="statement-hero-meta">
              <div>
                <b>{selectedParty.name}</b> · {accountDirection}
              </div>
              <div>
                {formatDate(fromDate)} – {formatDate(toDate)}
              </div>
              <div>
                {loading ? "Loading..." : `${periodBookingCount} booking(s) · ${periodPayments.length} payment(s)`}
              </div>
            </div>
          </div>

          <div className="statement-breakdown-strip">
            <span>
              Opening <b>{money(openingBalance)}</b>
              {hasSarFigure(openingSar) ? <em> · {sar(openingSar)}</em> : null}
            </span>
            <span>
              {bookedLabel} <b>{money(bookingsDuringPeriod)}</b>
              {hasSarFigure(bookingsDuringPeriodSar) ? <em> · {sar(bookingsDuringPeriodSar)}</em> : null}
            </span>
            <span>
              Paid Amount <b>{money(paymentsDuringPeriod)}</b>
              {hasSarFigure(paymentsDuringPeriodSar) ? <em> · {sar(paymentsDuringPeriodSar)}</em> : null}
            </span>
          </div>
        </>
      )}

      <div className="statement-sticky-actions">
        <div className="statement-view-pills" role="group" aria-label="Preview format">
          <button type="button" className={previewMode === "pdf" ? "active" : ""} onClick={() => setPreviewMode("pdf")}>
            PDF view
          </button>
          <button
            type="button"
            className={previewMode === "print" ? "active" : ""}
            onClick={() => setPreviewMode("print")}
          >
            Print view
          </button>
        </div>
        <label>
          <input
            type="checkbox"
            checked={includeReconciliation}
            onChange={(e) => setIncludeReconciliation(e.target.checked)}
          />
          Include final reconciliation
        </label>
        <label>
          <input type="checkbox" checked={includeLedger} onChange={(e) => setIncludeLedger(e.target.checked)} />
          Include ledger summary
        </label>
        {previewMode === "print" && pdfData && (
          <button className="secondary" type="button" onClick={() => window.print()}>
            Print
          </button>
        )}
        {selectedParty && (
          <button className="secondary" type="button" onClick={() => onOpenLedger(selectedParty)}>
            Open account ledger
          </button>
        )}
        <button className="secondary" type="button" disabled={!pdfData} onClick={handleExport}>
          Export to Excel
        </button>
        <button
          className="primary statement-primary"
          type="button"
          disabled={!pdfData || savingPdf || loading}
          onClick={() => void savePdf()}
        >
          {savingPdf ? "Saving..." : "Save PDF"}
        </button>
      </div>

      {pdfData ? (
        <StatementDocument data={pdfData} />
      ) : (
        <div className="empty-state">
          <h3>Select an account</h3>
          <p>Choose a {statementDirection === "PARTY" ? "customer" : "supplier"} to preview the statement.</p>
        </div>
      )}
    </section>
  );
}
