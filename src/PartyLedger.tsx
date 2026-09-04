import { useEffect, useMemo, useState } from "react";
import type { Company, Party, PaymentEntry } from "./db";
import { getPayments } from "./db";
import { downloadExcel } from "./exportUtils";
import {
  type BookingAccountingEntry,
  accountDirectionLabel,
  buildLatestAdjustmentMap,
  effectiveBookingAmount,
  getBookingAccountingEntries,
} from "./BookingAccounting";
import { getChronologicalLedger, summarizeAccountLedger, type LedgerRow } from "./LedgerEngine";
import { bookingServiceDisplayLabel, type BookingServiceName } from "./BookingLifecycle";
import { recordPaymentVoidHistory } from "./PaymentCorrectionDb";
import PaymentReceiptPreviewModal from "./PaymentReceiptPreviewModal";
import PaymentLedgerModal, { inferKind } from "./PaymentLedgerModal";
import {
  deletePaymentV2,
  getPaymentV2Meta,
  getPaymentV2MetaForPayments,
  voidPaymentV2,
  type PaymentTransactionKind,
  type PaymentV2Meta,
} from "./PaymentV2Db";
import { inferPaymentKind, paymentKindLabel, signedPaymentSettlement } from "./accountBalance";
import {
  hasSarFigure,
  statementActivityLabel,
  statementClosingBalanceDisplayPkr,
  statementClosingBalanceLabel,
  sumSignedPaymentSar,
} from "./StatementSummary";
import { loadSegmentAdjustmentsForStatements } from "./SegmentAdjustmentRecord";
import "./PaymentLedgerModal.css";

type Props = {
  company: Company;
  companyId: string;
  party: Party;
  parties?: Party[];
  userId?: string;
  preparedByName?: string;
  canEditPayments?: boolean;
  onBack: () => void;
  onEditParty: (party: Party) => void;
  onGenerateStatement: (party: Party) => void;
  onOpenPayments?: () => void;
  onChanged?: () => void | Promise<void>;
};

type LedgerModalState =
  | { mode: "correct"; entry: PaymentEntry; meta: PaymentV2Meta | null }
  | { mode: "history"; entry: PaymentEntry; meta: PaymentV2Meta | null }
  | null;

type ReceiptPreviewState = {
  entry: PaymentEntry;
  meta: PaymentV2Meta | null;
  transactionKind: PaymentTransactionKind;
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

function formatSar(value: number) {
  return `SAR ${Number(value || 0).toLocaleString("en-PK", { maximumFractionDigits: 2 })}`;
}

function formatNumber(value: number) {
  return Number(value || 0).toLocaleString("en-PK", { maximumFractionDigits: 2 });
}

export default function PartyLedger({
  company,
  companyId,
  party,
  onBack,
  onEditParty,
  onGenerateStatement,
  onOpenPayments,
  onChanged,
  userId = "",
  preparedByName = "",
  canEditPayments = false,
}: Props) {
  const [bookings, setBookings] = useState<BookingAccountingEntry[]>([]);
  const [payments, setPayments] = useState<PaymentEntry[]>([]);
  const [ledgerRows, setLedgerRows] = useState<LedgerRow[]>([]);
  const [metaMap, setMetaMap] = useState<Map<string, PaymentV2Meta>>(() => new Map());
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState("");
  const [modal, setModal] = useState<LedgerModalState>(null);
  const [receiptPreview, setReceiptPreview] = useState<ReceiptPreviewState | null>(null);
  const [latestAdjustments, setLatestAdjustments] = useState(() => new Map());

  const direction = accountDirectionLabel(party.account_type);
  const isVendor = party.account_type === "VENDOR";

  async function load() {
    setLoading(true);
    try {
      const [bookingRows, paymentRows, chronoRows] = await Promise.all([
        getBookingAccountingEntries(companyId, party.id),
        getPayments(companyId, "", party.id),
        getChronologicalLedger(companyId, party),
      ]);
      const metadata = await getPaymentV2MetaForPayments(
        companyId,
        paymentRows.map((row) => row.id),
      );
      const adjustments = await loadSegmentAdjustmentsForStatements(
        companyId,
        bookingRows.map((row) => row.id),
      );
      const relevant = party.account_type === "PARTY" ? "SALE" : party.account_type === "VENDOR" ? "PURCHASE" : null;
      setBookings(bookingRows.filter((row) => !relevant || row.transaction_type === relevant));
      setPayments(paymentRows);
      setLedgerRows(chronoRows);
      setMetaMap(metadata);
      setLatestAdjustments(buildLatestAdjustmentMap(adjustments));
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [companyId, party.id, party.account_type]);

  const activeBookings = useMemo(() => bookings.filter((entry) => entry.status === "ACTIVE"), [bookings]);
  const activePayments = useMemo(() => payments.filter((entry) => entry.status === "ACTIVE"), [payments]);
  const ledgerSummary = useMemo(
    () => summarizeAccountLedger(ledgerRows, party.account_type),
    [ledgerRows, party.account_type],
  );
  const bookingTotal = ledgerSummary.bookingActivity;
  const paymentTotal = ledgerSummary.paymentSettlement;
  const balance = ledgerSummary.closingBalance;
  const bookingSarTotal = useMemo(
    () => activeBookings.reduce((sum, entry) => sum + Number(entry.total_sar || 0), 0),
    [activeBookings],
  );
  const pendingSarTotal = useMemo(
    () => activeBookings.reduce((sum, entry) => sum + Number(entry.unconverted_sar || 0), 0),
    [activeBookings],
  );
  const paymentSarTotal = useMemo(
    () => sumSignedPaymentSar(activePayments, metaMap, party.account_type),
    [activePayments, metaMap, party.account_type],
  );
  const paymentsById = useMemo(() => new Map(payments.map((entry) => [entry.id, entry])), [payments]);
  const activityLabel = statementActivityLabel(party.account_type);
  const balanceLabel = statementClosingBalanceLabel(party.account_type, balance);
  const balanceDisplay = statementClosingBalanceDisplayPkr(balance);

  async function openModal(mode: "correct" | "history", entry: PaymentEntry) {
    setError("");
    setMessage("");
    const meta = metaMap.get(entry.id) || (await getPaymentV2Meta(companyId, entry.id));
    setModal({ mode, entry, meta });
  }

  async function voidPayment(entry: PaymentEntry) {
    if (!canEditPayments || entry.status !== "ACTIVE" || busyId) return;
    const reason = window.prompt(
      `Void ${entry.receipt_no || "this payment"} for ${formatMoney(entry.paid_amount)}?\n\nEnter reason for office record:`,
    );
    if (!reason?.trim()) return;
    if (!window.confirm(`Confirm void for ${entry.receipt_no || "this payment"}?`)) return;

    setBusyId(entry.id);
    setError("");
    setMessage("");
    try {
      const meta = metaMap.get(entry.id) || (await getPaymentV2Meta(companyId, entry.id));
      await voidPaymentV2(companyId, entry.id, userId);
      await recordPaymentVoidHistory(companyId, entry.id, userId, reason, entry, meta);
      await load();
      await onChanged?.();
      setMessage(`${entry.receipt_no || "Payment"} marked VOID.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId("");
    }
  }

  async function openReceiptPreview(entry: PaymentEntry) {
    setError("");
    setMessage("");
    const meta = metaMap.get(entry.id) || (await getPaymentV2Meta(companyId, entry.id));
    setReceiptPreview({
      entry,
      meta,
      transactionKind: inferKind(meta, party.account_type === "VENDOR" ? "VENDOR" : "PARTY"),
    });
  }

  async function deletePayment(entry: PaymentEntry) {
    if (!canEditPayments || busyId) return;
    if (
      !window.confirm(
        `Permanently delete ${entry.receipt_no || "this payment"} for ${formatMoney(entry.paid_amount)}?\n\nThis is for test cleanup only and cannot be undone.`,
      )
    )
      return;
    if (!window.confirm("Confirm permanent delete?")) return;

    setBusyId(entry.id);
    setError("");
    setMessage("");
    try {
      await deletePaymentV2(companyId, entry.id, userId);
      if (modal?.entry.id === entry.id) setModal(null);
      await load();
      await onChanged?.();
      setMessage(`${entry.receipt_no || "Payment"} deleted.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId("");
    }
  }

  function handleExport() {
    const chronoData = ledgerRows.map((row, i) => ({
      "SR #": i + 1,
      Date: formatDate(row.transaction_date),
      Ref: row.ref_no || "-",
      Description: row.description,
      Kind: row.kind,
      Debit: row.debit || 0,
      Credit: row.credit || 0,
      "Running Balance": row.running_balance || 0,
      Status: row.status,
    }));

    const bookingData = bookings.map((b, i) => {
      const effectivePkr = effectiveBookingAmount(b, latestAdjustments);
      const originalPkr = Number(b.total_pkr || 0);
      return {
        "SR #": i + 1,
        Date: formatDate(b.transaction_date),
        "UB #": b.ub_number || "-",
        Service: bookingServiceDisplayLabel(b.service_type as BookingServiceName),
        Type: b.transaction_type,
        "Total SAR": b.total_sar || 0,
        "Pending SAR": b.unconverted_sar || 0,
        "Original PKR": originalPkr,
        "Total PKR": effectivePkr,
        Amended: Math.abs(effectivePkr - originalPkr) >= 0.005 ? "Yes" : "No",
        Status: b.status,
      };
    });

    const paymentData = payments.map((p, i) => {
      const kind = inferPaymentKind(metaMap.get(p.id), party.account_type);
      return {
        "SR #": i + 1,
        Date: formatDate(p.transaction_date),
        "Receipt #": p.receipt_no || "-",
        "From Account": p.from_account,
        "To Account": p.to_account,
        Description: p.description || "-",
        Method: p.payment_type,
        Type: paymentKindLabel(kind),
        SAR: p.currency === "SAR" ? p.sar || 0 : "",
        ROE: p.currency === "SAR" ? p.roe || 0 : "",
        "PKR Amount": signedPaymentSettlement(p.paid_amount, kind),
        Status: p.status,
      };
    });

    const summaryData = [
      {
        "Account Name": party.name,
        "Account Type": party.account_type,
        [isVendor ? "Total Purchase (PKR)" : "Total Sales (PKR)"]: bookingTotal,
        ...(hasSarFigure(bookingSarTotal)
          ? { [isVendor ? "Total Purchase (SAR)" : "Total Sales (SAR)"]: bookingSarTotal }
          : {}),
        "Paid Amount (PKR)": paymentTotal,
        ...(hasSarFigure(paymentSarTotal) ? { "Paid Amount (SAR)": paymentSarTotal } : {}),
        [balanceLabel]: balanceDisplay,
        ...(hasSarFigure(pendingSarTotal) ? { "Pending SAR": pendingSarTotal } : {}),
        "Balance source": "LedgerEngine chronological (same as Statements)",
      },
    ];

    downloadExcel(
      [
        { name: "Summary", data: summaryData },
        { name: "Chronological", data: chronoData },
        { name: "Bookings", data: bookingData },
        { name: "Payments", data: paymentData },
      ],
      `Ledger_${party.name.replace(/[^a-zA-Z0-9]/g, "_")}_${new Date().toISOString().split("T")[0]}`,
    );
  }

  function renderPaymentActions(entry: PaymentEntry) {
    return (
      <div className="row-actions compact-actions ledger-payment-actions">
        <button type="button" onClick={() => void openReceiptPreview(entry)}>
          Receipt
        </button>
        <button type="button" onClick={() => void openModal("history", entry)}>
          History
        </button>
        {canEditPayments && (
          <button type="button" onClick={() => void openModal("correct", entry)} disabled={entry.status !== "ACTIVE"}>
            Correct
          </button>
        )}
        {canEditPayments && (
          <button
            type="button"
            className="danger-action"
            onClick={() => void voidPayment(entry)}
            disabled={entry.status !== "ACTIVE" || busyId === entry.id}
          >
            Void
          </button>
        )}
        {import.meta.env.DEV && canEditPayments && (
          <button
            type="button"
            className="danger-action"
            onClick={() => void deletePayment(entry)}
            disabled={busyId === entry.id}
            title="Dev only — permanently removes this payment"
          >
            Delete
          </button>
        )}
      </div>
    );
  }

  return (
    <section className="ledger-page">
      <div className="ledger-top">
        <div>
          <button className="back-link" onClick={onBack}>
            ← Back to {isVendor ? "Vendors" : "Parties"}
          </button>
          <span className="eyebrow blue">BOOKING ACCOUNT LEDGER</span>
          <h2>{party.name}</h2>
          <p>
            {party.address || "No address"} · {party.phone || party.whatsapp || "No contact"} · {direction}
          </p>
        </div>
        <div className="ledger-actions">
          <span className={`status ${party.status.toLowerCase()}`}>{party.status}</span>
          <button className="statement-ledger-btn" onClick={() => onGenerateStatement(party)}>
            Generate Statement
          </button>
          <button className="secondary" onClick={handleExport}>
            Export to Excel
          </button>
          <button className="secondary" onClick={() => onEditParty(party)}>
            Edit {isVendor ? "Vendor" : "Party"}
          </button>
        </div>
      </div>

      {message && <div className="alert success ledger-alert">{message}</div>}
      {error && <div className="alert error ledger-alert">{error}</div>}
      {loading && <div className="alert info ledger-alert">Loading booking ledger...</div>}

      <div className="ledger-summary">
        <div className="purchase">
          <small>{activityLabel}</small>
          <b>{formatMoney(bookingTotal)}</b>
          {hasSarFigure(bookingSarTotal) ? (
            <span className="ledger-summary-sar">{formatSar(bookingSarTotal)}</span>
          ) : null}
        </div>
        <div className="paid">
          <small>PAID AMOUNT</small>
          <b>{formatMoney(paymentTotal)}</b>
          {hasSarFigure(paymentSarTotal) ? (
            <span className="ledger-summary-sar">{formatSar(paymentSarTotal)}</span>
          ) : null}
        </div>
        <div className={`balance${balance < 0 ? " advance" : Math.abs(balance) < 0.005 ? " settled" : ""}`}>
          <small>{balanceLabel}</small>
          <b>{formatMoney(balanceDisplay)}</b>
          {hasSarFigure(pendingSarTotal) ? (
            <span className="ledger-summary-sar">{formatSar(pendingSarTotal)}</span>
          ) : null}
        </div>
      </div>

      <div className="ledger-section blue-section services-ledger-section">
        <div className="ledger-section-title">
          <b>CHRONOLOGICAL LEDGER (same engine as Statements)</b>
          <div className="section-right">
            <strong>CLOSING: {formatMoney(balanceDisplay)}</strong>
          </div>
        </div>
        {ledgerRows.length === 0 ? (
          <div className="coming-data">No ledger movements for this account yet.</div>
        ) : (
          <div className="ledger-table-wrap">
            <table className="ledger-service-table ledger-chrono-table">
              <thead>
                <tr>
                  <th>SR</th>
                  <th>DATE</th>
                  <th>REF</th>
                  <th>DESCRIPTION</th>
                  <th>DEBIT</th>
                  <th>CREDIT</th>
                  <th>BALANCE</th>
                  <th>ACTIONS</th>
                </tr>
              </thead>
              <tbody>
                {ledgerRows.map((row, index) => {
                  const paymentEntry = row.kind === "PAYMENT" ? paymentsById.get(row.id) : undefined;
                  return (
                    <tr key={`${row.kind}-${row.id}`} className={row.status === "VOID" ? "void-row" : ""}>
                      <td className="centered">{index + 1}</td>
                      <td>{formatDate(row.transaction_date)}</td>
                      <td>
                        <b>{row.ref_no || "—"}</b>
                      </td>
                      <td>
                        {row.description}
                        {row.status === "VOID" ? <small className="void-label">VOID</small> : null}
                      </td>
                      <td className="right">{row.debit ? formatMoney(row.debit) : "—"}</td>
                      <td className="right">{row.credit ? formatMoney(row.credit) : "—"}</td>
                      <td className="right total-pkr">
                        <b>{formatMoney(row.running_balance)}</b>
                      </td>
                      <td>{paymentEntry ? renderPaymentActions(paymentEntry) : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="ledger-section blue-section services-ledger-section">
        <div className="ledger-section-title">
          <b>{activityLabel} — DETAIL BY SERVICE</b>
          <div className="section-right">
            <strong>TOTAL: {formatMoney(bookingTotal)}</strong>
          </div>
        </div>
        {bookings.length === 0 ? (
          <div className="coming-data">
            No booking transactions for this account yet. Create them from the Bookings module.
          </div>
        ) : (
          <div className="ledger-table-wrap">
            <table className="ledger-service-table">
              <thead>
                <tr>
                  <th>SR</th>
                  <th>DATE</th>
                  <th>UB #</th>
                  <th>SERVICE</th>
                  <th>TYPE</th>
                  <th>TOTAL SAR</th>
                  <th>PENDING SAR</th>
                  <th>TOTAL PKR</th>
                  <th>STATUS</th>
                </tr>
              </thead>
              <tbody>
                {bookings.map((entry, index) => {
                  const effectivePkr = effectiveBookingAmount(entry, latestAdjustments);
                  const originalPkr = Number(entry.total_pkr || 0);
                  const amended = Math.abs(effectivePkr - originalPkr) >= 0.005;
                  return (
                    <tr key={`${entry.service_type}-${entry.id}`} className={entry.status === "VOID" ? "void-row" : ""}>
                      <td className="centered">{index + 1}</td>
                      <td>{formatDate(entry.transaction_date)}</td>
                      <td>
                        <b>{entry.ub_number || "—"}</b>
                      </td>
                      <td>
                        <b>{bookingServiceDisplayLabel(entry.service_type as BookingServiceName)}</b>
                      </td>
                      <td className="centered">{entry.transaction_type}</td>
                      <td className="right">{entry.total_sar ? `SAR ${formatNumber(entry.total_sar)}` : "—"}</td>
                      <td className="right">
                        {entry.unconverted_sar ? `SAR ${formatNumber(entry.unconverted_sar)}` : "—"}
                      </td>
                      <td className="right total-pkr">
                        <b>{formatMoney(effectivePkr)}</b>
                        {amended ? <small className="ledger-amended-note">Was {formatMoney(originalPkr)}</small> : null}
                      </td>
                      <td>
                        <span className={`status ${entry.status.toLowerCase()}`}>{entry.status}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="ledger-section purple-section payments-ledger-section">
        <div className="ledger-section-title">
          <b>PAID AMOUNT</b>
          <div className="section-right">
            <strong>TOTAL: {formatMoney(paymentTotal)}</strong>
            {onOpenPayments ? (
              <button className="section-add-btn payment-section-add" onClick={onOpenPayments}>
                Manage in Payments
              </button>
            ) : (
              <span className="booking-foundation-badge">Manage from Payments tab</span>
            )}
          </div>
        </div>
        {payments.length === 0 ? (
          <div className="coming-data">
            No payment entries yet. Use the Payments module to record{" "}
            {isVendor ? "a Vendor payment" : "a Party receipt"}.
          </div>
        ) : (
          <div className="ledger-table-wrap">
            <table className="ledger-payment-table">
              <thead>
                <tr>
                  <th>SR</th>
                  <th>DATE</th>
                  <th>RECEIPT / VOUCHER #</th>
                  <th>FROM ACCOUNT</th>
                  <th>TO ACCOUNT</th>
                  <th>DESCRIPTION</th>
                  <th>METHOD</th>
                  <th>SAR</th>
                  <th>ROE</th>
                  <th>PKR AMOUNT</th>
                  <th>ACTIONS</th>
                </tr>
              </thead>
              <tbody>
                {payments.map((entry, index) => {
                  const kind = inferPaymentKind(metaMap.get(entry.id), party.account_type);
                  const signedPkr = signedPaymentSettlement(entry.paid_amount, kind);
                  const descriptionText = (entry.description || paymentKindLabel(kind)).trim();
                  const isRefund = kind === "PARTY_REFUND" || kind === "VENDOR_REFUND";
                  const showRefundBadge = isRefund && descriptionText.toLowerCase() !== "refund";
                  return (
                    <tr key={entry.id} className={entry.status === "VOID" ? "void-row" : ""}>
                      <td className="centered">{index + 1}</td>
                      <td>{formatDate(entry.transaction_date)}</td>
                      <td>{entry.receipt_no || "—"}</td>
                      <td>{entry.from_account}</td>
                      <td>{entry.to_account}</td>
                      <td className="payment-description-cell">
                        {descriptionText || "—"}
                        {entry.status === "VOID" && <small className="void-label">VOID</small>}
                        {showRefundBadge ? <small className="ledger-amended-note">Refund</small> : null}
                      </td>
                      <td className="centered">{entry.payment_type}</td>
                      <td className="right">{entry.currency === "SAR" ? formatNumber(entry.sar) : "—"}</td>
                      <td className="right">{entry.currency === "SAR" ? formatNumber(entry.roe) : "—"}</td>
                      <td className="right payment-paid-amount">{formatMoney(signedPkr)}</td>
                      <td>{renderPaymentActions(entry)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="bf-note">
        <b>One balance story:</b> summary cards and the chronological ledger use the same <strong>LedgerEngine</strong>{" "}
        as Statements (bookings, amendments, payments). Detail tables below are for SAR/service drill-down and payment
        tools. Use <strong>Correct</strong> to fix mistakes with office history, or <strong>Void</strong> to cancel a
        payment while keeping the audit trail.
      </div>

      {modal && (
        <PaymentLedgerModal
          mode={modal.mode}
          companyId={companyId}
          userId={userId}
          accountName={party.name}
          entry={modal.entry}
          meta={modal.meta}
          transactionKind={inferKind(modal.meta, party.account_type === "VENDOR" ? "VENDOR" : "PARTY")}
          onClose={() => setModal(null)}
          onSaved={async () => {
            await load();
            await onChanged?.();
            setMessage(`${modal.entry.receipt_no || "Payment"} corrected successfully.`);
          }}
        />
      )}

      {receiptPreview && (
        <PaymentReceiptPreviewModal
          company={company}
          party={party}
          entry={receiptPreview.entry}
          meta={receiptPreview.meta}
          transactionKind={receiptPreview.transactionKind}
          preparedBy={preparedByName}
          onClose={() => setReceiptPreview(null)}
        />
      )}
    </section>
  );
}
