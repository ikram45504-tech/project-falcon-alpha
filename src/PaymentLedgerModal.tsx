import { useEffect, useMemo, useState } from "react";
import { useBodyScrollLock } from "./useBodyScrollLock";
import type { PaymentEntry } from "./db";
import { formatAmountInput, parseFormattedAmount, pkrEquivalent } from "./paymentFormatUtils";
import { fromReceivingLabels, patchMovementField } from "./paymentMovement";
import { correctPaymentV2, getPaymentCorrections, type PaymentCorrectionRecord } from "./PaymentCorrectionDb";
import {
  getPaymentV2Meta,
  type PaymentCurrency,
  type PaymentMethod,
  type PaymentTransactionKind,
  type PaymentV2Input,
  type PaymentV2Meta,
} from "./PaymentV2Db";
import "./PaymentLedgerModal.css";

type ModalMode = "correct" | "history";

type Props = {
  mode: ModalMode;
  companyId: string;
  userId: string;
  accountName: string;
  entry: PaymentEntry;
  meta: PaymentV2Meta | null;
  transactionKind: PaymentTransactionKind;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
};

type CorrectionForm = {
  transactionDate: string;
  currency: PaymentCurrency;
  amount: string;
  roe: string;
  settlementAccount: string;
  fromAccount: string;
  toAccount: string;
  description: string;
  reference: string;
  reason: string;
};

function inferKind(meta: PaymentV2Meta | null, accountType: "PARTY" | "VENDOR"): PaymentTransactionKind {
  if (meta?.transaction_kind) return meta.transaction_kind;
  return accountType === "VENDOR" ? "VENDOR_PAYMENT" : "PARTY_RECEIPT";
}

function toInput(
  partyId: string,
  form: CorrectionForm,
  transactionKind: PaymentTransactionKind,
  paymentType: PaymentMethod,
  documentNo: string,
  meta: PaymentV2Meta | null,
): PaymentV2Input {
  return {
    transactionKind,
    partyId,
    transactionDate: form.transactionDate,
    documentNo,
    paymentType,
    currency: form.currency,
    amount: parseFormattedAmount(form.amount),
    roe: form.currency === "SAR" ? parseFormattedAmount(form.roe) : 0,
    settlementAccount: form.settlementAccount,
    fromAccount: form.fromAccount,
    toAccount: form.toAccount,
    description: form.description,
    reference: form.reference,
    bankName: meta?.bank_name || "",
    bankTransactionReference: meta?.bank_transaction_reference || "",
    accountTitle: meta?.account_title || "",
    accountLastDigits: meta?.account_last_digits || "",
    chequeNo: meta?.cheque_no || "",
    transferDate: meta?.transfer_date || "",
    handledBy: meta?.handled_by || "",
    location: meta?.location || "",
    internalNotes: meta?.internal_notes || "",
  };
}

function formatCorrectionDate(value: string) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function parseChangedFields(value: string) {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

export default function PaymentLedgerModal({
  mode,
  companyId,
  userId,
  accountName,
  entry,
  meta,
  transactionKind,
  onClose,
  onSaved,
}: Props) {
  useBodyScrollLock(true);

  const [form, setForm] = useState<CorrectionForm>(() => ({
    transactionDate: entry.transaction_date,
    currency: entry.currency,
    amount: formatAmountInput(String(entry.amount_entered || "")),
    roe: entry.currency === "SAR" ? formatAmountInput(String(entry.roe || "")) : "",
    settlementAccount: meta?.settlement_account || entry.to_account,
    fromAccount: entry.from_account || "",
    toAccount: entry.to_account || "",
    description: entry.description || "",
    reference: meta?.reference || "",
    reason: "",
  }));
  const [history, setHistory] = useState<PaymentCorrectionRecord[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [loadingHistory, setLoadingHistory] = useState(mode === "history");

  const labels = fromReceivingLabels(entry.payment_type);

  const previewPkr = useMemo(() => {
    const amount = parseFormattedAmount(form.amount);
    const roe = form.currency === "SAR" ? parseFormattedAmount(form.roe) : 0;
    return form.currency === "SAR" ? amount * roe : amount;
  }, [form.amount, form.currency, form.roe]);

  useEffect(() => {
    if (mode !== "history") return;
    let cancelled = false;
    setLoadingHistory(true);
    void getPaymentCorrections(companyId, entry.id)
      .then((rows) => {
        if (!cancelled) setHistory(rows);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoadingHistory(false);
      });
    return () => {
      cancelled = true;
    };
  }, [mode, companyId, entry.id]);

  function patchMovement(side: "from" | "receiving", value: string) {
    setForm((current) => ({
      ...current,
      ...patchMovementField({
        transactionKind,
        side,
        value,
        fromAccount: current.fromAccount,
        toAccount: current.toAccount,
      }),
    }));
  }

  async function saveCorrection() {
    if (!form.reason.trim()) return setError("Correction reason is required for the office record.");
    setBusy(true);
    setError("");
    try {
      const freshMeta = meta || (await getPaymentV2Meta(companyId, entry.id));
      const payload = toInput(entry.party_id, form, transactionKind, entry.payment_type, entry.receipt_no, freshMeta);
      await correctPaymentV2(companyId, entry.id, payload, userId, form.reason, entry, freshMeta);
      await onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="modal-backdrop payment-ledger-modal-backdrop"
      onMouseDown={(e) => e.currentTarget === e.target && onClose()}
    >
      <section className="modal-card payment-ledger-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <span className="eyebrow blue">{mode === "correct" ? "TRANSACTION CORRECTION" : "CORRECTION HISTORY"}</span>
            <h3>{entry.receipt_no || "Payment"}</h3>
            <p>{accountName}</p>
          </div>
          <button type="button" className="secondary" onClick={onClose}>
            Close
          </button>
        </div>

        {error && <div className="alert error">{error}</div>}

        {mode === "correct" ? (
          <div className="payment-ledger-modal-body">
            <p className="payment-ledger-modal-note">
              Fix data-entry mistakes here. Every correction is saved to the office history with your reason.
            </p>
            <div className="payment-v2-setup-grid payment-ledger-amount-row">
              <label>
                Currency *
                <select
                  value={form.currency}
                  onChange={(e) =>
                    setForm((current) => ({
                      ...current,
                      currency: e.target.value as PaymentCurrency,
                      roe: e.target.value === "PKR" ? "" : current.roe,
                    }))
                  }
                >
                  <option value="PKR">PKR — Pakistani Rupee</option>
                  <option value="SAR">SAR — Saudi Riyal</option>
                </select>
              </label>
              <label>
                Amount ({form.currency}) *
                <input
                  value={form.amount}
                  onChange={(e) => setForm((current) => ({ ...current, amount: e.target.value }))}
                  onBlur={() => setForm((current) => ({ ...current, amount: formatAmountInput(current.amount) }))}
                  inputMode="decimal"
                  placeholder="0"
                />
              </label>
              <label className={form.currency === "PKR" ? "payment-v2-muted-field" : ""}>
                ROE {form.currency === "SAR" ? "*" : ""}
                <input
                  value={form.roe}
                  onChange={(e) => setForm((current) => ({ ...current, roe: e.target.value }))}
                  onBlur={() => setForm((current) => ({ ...current, roe: formatAmountInput(current.roe) }))}
                  disabled={form.currency === "PKR"}
                  placeholder={form.currency === "SAR" ? "e.g. 76.50" : "Not required"}
                />
              </label>
              <label>
                PKR Equivalent
                <input value={pkrEquivalent(previewPkr)} readOnly />
              </label>
            </div>

            <div className="payment-v2-movement-grid">
              <label>
                {labels.from} *
                <input value={form.fromAccount} onChange={(e) => patchMovement("from", e.target.value)} />
              </label>
              <span className="payment-v2-movement-arrow" aria-hidden="true">
                →
              </span>
              <label>
                {labels.receiving} *
                <input value={form.toAccount} onChange={(e) => patchMovement("receiving", e.target.value)} />
              </label>
            </div>

            <div className="payment-ledger-correction-grid">
              <label>
                Date of Payment *
                <input
                  type="date"
                  value={form.transactionDate}
                  onChange={(e) => setForm((current) => ({ ...current, transactionDate: e.target.value }))}
                />
              </label>
              <label>
                Reference
                <input
                  value={form.reference}
                  onChange={(e) => setForm((current) => ({ ...current, reference: e.target.value }))}
                />
              </label>
              <label className="wide">
                Description
                <textarea
                  rows={2}
                  value={form.description}
                  onChange={(e) => setForm((current) => ({ ...current, description: e.target.value }))}
                />
              </label>
              <label className="wide">
                Reason for correction *
                <textarea
                  rows={2}
                  value={form.reason}
                  onChange={(e) => setForm((current) => ({ ...current, reason: e.target.value }))}
                  placeholder="Required — e.g. wrong amount entered, date corrected"
                />
              </label>
            </div>

            <div className="modal-buttons">
              <button type="button" className="secondary" onClick={onClose}>
                Cancel
              </button>
              <button type="button" className="primary" disabled={busy} onClick={() => void saveCorrection()}>
                {busy ? "Saving..." : "Save Correction"}
              </button>
            </div>
          </div>
        ) : (
          <div className="payment-ledger-modal-body">
            {loadingHistory ? (
              <div className="alert info">Loading correction history...</div>
            ) : history.length === 0 ? (
              <div className="coming-data">No corrections or void records yet for this payment.</div>
            ) : (
              <div className="payment-correction-history">
                {history.map((row) => {
                  const changed = parseChangedFields(row.changed_fields_json);
                  return (
                    <article key={row.id} className={`payment-correction-card ${row.action.toLowerCase()}`}>
                      <div className="payment-correction-card-head">
                        <b>
                          #{row.correction_no} · {row.action === "VOID" ? "Voided" : "Corrected"}
                        </b>
                        <span>{formatCorrectionDate(row.corrected_at)}</span>
                      </div>
                      <p>
                        <strong>Reason:</strong> {row.reason}
                      </p>
                      {changed.length > 0 && (
                        <p>
                          <strong>Changed:</strong> {changed.join(", ")}
                        </p>
                      )}
                    </article>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

export { inferKind };
