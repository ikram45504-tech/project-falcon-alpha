import { useEffect, useMemo, useState } from "react";
import {
  Party,
  PaymentEntry,
  PaymentInput,
  createPayment,
  getPayments,
  updatePayment,
  voidPayment,
} from "./db";
import { formatDate, formatMoney, formatNumber } from "./Accommodation";

type PaymentFormState = {
  partyId: string;
  transactionDate: string;
  receiptNo: string;
  fromAccount: string;
  toAccount: string;
  description: string;
  paymentType: "BANK" | "CASH";
  currency: "PKR" | "SAR";
  amount: string;
  roe: string;
};

type ModalProps = {
  companyId: string;
  parties: Party[];
  initialPartyId?: string;
  editing?: PaymentEntry | null;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
};

type ModuleProps = {
  companyId: string;
  parties: Party[];
  onOpenLedger: (party: Party) => void;
  onChanged: () => void | Promise<void>;
};

function todayIso() {
  const now = new Date();
  const offset = now.getTimezoneOffset();
  return new Date(now.getTime() - offset * 60_000).toISOString().slice(0, 10);
}

function blankForm(initialPartyId = ""): PaymentFormState {
  return {
    partyId: initialPartyId,
    transactionDate: todayIso(),
    receiptNo: "",
    fromAccount: "",
    toAccount: "",
    description: "",
    paymentType: "BANK",
    currency: "PKR",
    amount: "",
    roe: "",
  };
}

function entryToForm(entry: PaymentEntry): PaymentFormState {
  return {
    partyId: entry.party_id,
    transactionDate: entry.transaction_date,
    receiptNo: entry.receipt_no,
    fromAccount: entry.from_account,
    toAccount: entry.to_account,
    description: entry.description,
    paymentType: entry.payment_type,
    currency: entry.currency,
    amount: String(entry.amount_entered || ""),
    roe: entry.currency === "SAR" ? String(entry.roe || "") : "",
  };
}

function calculatePreview(form: PaymentFormState) {
  const amount = Math.max(0, Number(form.amount) || 0);
  if (form.currency === "SAR") {
    const roe = Math.max(0, Number(form.roe) || 0);
    return { sar: amount, roe, paidAmount: amount * roe };
  }
  return { sar: 0, roe: 0, paidAmount: amount };
}

function toDbInput(form: PaymentFormState): PaymentInput {
  return {
    partyId: form.partyId,
    transactionDate: form.transactionDate,
    receiptNo: form.receiptNo,
    fromAccount: form.fromAccount,
    toAccount: form.toAccount,
    description: form.description,
    paymentType: form.paymentType,
    currency: form.currency,
    amount: Number(form.amount) || 0,
    roe: form.currency === "SAR" ? Number(form.roe) || 0 : 0,
  };
}

export function PaymentFormModal({
  companyId,
  parties,
  initialPartyId = "",
  editing = null,
  onClose,
  onSaved,
}: ModalProps) {
  const [form, setForm] = useState<PaymentFormState>(
    editing ? entryToForm(editing) : blankForm(initialPartyId)
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setForm(editing ? entryToForm(editing) : blankForm(initialPartyId));
    setError("");
  }, [editing, initialPartyId]);

  const preview = useMemo(() => calculatePreview(form), [form]);
  const activeParties = parties.filter((party) => party.status === "ACTIVE");

  function patch<K extends keyof PaymentFormState>(key: K, value: PaymentFormState[K]) {
    setError("");
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function save() {
    if (!form.partyId) return setError("Select a Party / Vendor account.");
    if (!form.transactionDate) return setError("Payment date is required.");
    if (!form.fromAccount.trim()) return setError("From Account is required.");
    if (!form.toAccount.trim()) return setError("To Account is required.");
    if ((Number(form.amount) || 0) <= 0) return setError("Amount must be greater than zero.");
    if (form.currency === "SAR" && (Number(form.roe) || 0) <= 0) {
      return setError("ROE is required for a SAR payment.");
    }

    setBusy(true);
    setError("");
    try {
      if (editing) {
        await updatePayment(companyId, editing.id, toDbInput(form));
      } else {
        await createPayment(companyId, toDbInput(form));
      }
      await onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <section className="modal-card payment-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <span className="eyebrow purple-text">PAYMENT ENTRY</span>
            <h3>{editing ? "Edit Payment" : "Add Payment"}</h3>
          </div>
          <button className="close-btn" onClick={onClose}>×</button>
        </div>

        {error && <div className="alert error">{error}</div>}

        <div className="payment-form-grid">
          <label className="span-2">
            Party / Vendor Account *
            <select
              value={form.partyId}
              onChange={(e) => patch("partyId", e.target.value)}
              disabled={Boolean(initialPartyId && !editing)}
            >
              <option value="">Select account...</option>
              {activeParties.map((party) => (
                <option key={party.id} value={party.id}>{party.name}</option>
              ))}
            </select>
          </label>

          <label>
            Date *
            <input
              type="date"
              value={form.transactionDate}
              onChange={(e) => patch("transactionDate", e.target.value)}
            />
          </label>

          <label>
            Receipt #
            <input
              value={form.receiptNo}
              onChange={(e) => patch("receiptNo", e.target.value)}
              placeholder="Optional receipt / slip no."
            />
          </label>

          <label>
            Currency *
            <select
              value={form.currency}
              onChange={(e) => {
                const currency = e.target.value as "PKR" | "SAR";
                setForm((prev) => ({
                  ...prev,
                  currency,
                  roe: currency === "PKR" ? "" : prev.roe,
                }));
              }}
            >
              <option value="PKR">PKR — Pakistani Rupee</option>
              <option value="SAR">SAR — Saudi Riyal</option>
            </select>
          </label>

          <label>
            Amount ({form.currency}) *
            <input
              type="number"
              min="0"
              step="0.01"
              value={form.amount}
              onChange={(e) => patch("amount", e.target.value)}
              placeholder="0.00"
            />
          </label>

          <label className={form.currency === "PKR" ? "muted-field" : ""}>
            ROE {form.currency === "SAR" ? "*" : ""}
            <input
              type="number"
              min="0"
              step="0.01"
              value={form.roe}
              onChange={(e) => patch("roe", e.target.value)}
              placeholder={form.currency === "SAR" ? "e.g. 76.50" : "Not required"}
              disabled={form.currency === "PKR"}
            />
          </label>

          <label>
            Type *
            <select
              value={form.paymentType}
              onChange={(e) => patch("paymentType", e.target.value as "BANK" | "CASH")}
            >
              <option value="BANK">BANK</option>
              <option value="CASH">CASH</option>
            </select>
          </label>

          <label className="span-2">
            From Account *
            <input
              value={form.fromAccount}
              onChange={(e) => patch("fromAccount", e.target.value)}
              placeholder="e.g. Father, Shahzad ABL, Customer Name"
            />
          </label>

          <label className="span-2">
            To Account *
            <input
              value={form.toAccount}
              onChange={(e) => patch("toAccount", e.target.value)}
              placeholder="e.g. Myself, Vendor Bank, QRT"
            />
          </label>

          <label className="span-4 description-field">
            Description
            <textarea
              rows={3}
              value={form.description}
              onChange={(e) => patch("description", e.target.value)}
              placeholder="e.g. I received through Ali Bhai / Ghar par aa kar diye thay Sohail ne"
            />
          </label>
        </div>

        <div className="calculation-preview payment-calculation-preview">
          <div>
            <small>SAR</small>
            <b>{form.currency === "SAR" ? `SAR ${formatNumber(preview.sar)}` : "—"}</b>
          </div>
          <div>
            <small>ROE</small>
            <b>{form.currency === "SAR" ? formatNumber(preview.roe) : "—"}</b>
          </div>
          <div className="highlight purple-highlight">
            <small>PAID AMOUNT</small>
            <b>{formatMoney(preview.paidAmount)}</b>
          </div>
        </div>

        <div className="modal-buttons">
          <button className="secondary" onClick={onClose}>Cancel</button>
          <button className="primary purple-primary" onClick={save} disabled={busy}>
            {busy ? "Saving..." : editing ? "Save Changes" : "Save Payment"}
          </button>
        </div>
      </section>
    </div>
  );
}

export function PaymentsModule({
  companyId,
  parties,
  onOpenLedger,
  onChanged,
}: ModuleProps) {
  const [entries, setEntries] = useState<PaymentEntry[]>([]);
  const [search, setSearch] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<PaymentEntry | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function load(value = search) {
    try {
      setEntries(await getPayments(companyId, value));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  useEffect(() => {
    load("");
  }, [companyId]);

  const activeTotal = useMemo(
    () => entries
      .filter((entry) => entry.status === "ACTIVE")
      .reduce((sum, entry) => sum + Number(entry.paid_amount || 0), 0),
    [entries]
  );

  async function saved() {
    setMessage(editing ? "Payment updated successfully." : "Payment saved successfully.");
    setError("");
    setEditing(null);
    await load();
    await onChanged();
  }

  async function voidEntry(entry: PaymentEntry) {
    if (!window.confirm(`Void payment of ${formatMoney(entry.paid_amount)}?`)) return;
    try {
      await voidPayment(companyId, entry.id);
      setMessage("Payment marked VOID.");
      setError("");
      await load();
      await onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  function partyFor(entry: PaymentEntry) {
    return parties.find((party) => party.id === entry.party_id) || null;
  }

  return (
    <section className="content-card payments-page">
      <div className="page-title">
        <div>
          <span className="eyebrow purple-text">PAYMENT LEDGER</span>
          <h2>Payments</h2>
          <p>Record PKR/SAR payments and post final PKR Paid Amount to Party Ledgers.</p>
        </div>
        <button
          className="primary purple-primary"
          onClick={() => { setEditing(null); setModalOpen(true); }}
        >
          + Add Payment
        </button>
      </div>

      {message && <div className="alert success">{message}</div>}
      {error && !modalOpen && <div className="alert error">{error}</div>}

      <div className="module-summary-row payment-module-summary">
        <div>
          <small>ACTIVE PAYMENT ENTRIES</small>
          <b>{entries.filter((entry) => entry.status === "ACTIVE").length}</b>
        </div>
        <div className="payment-total-box">
          <small>TOTAL PAID</small>
          <b>{formatMoney(activeTotal)}</b>
        </div>
      </div>

      <div className="party-toolbar">
        <div className="search-box">
          <span>⌕</span>
          <input
            value={search}
            onChange={(e) => { setSearch(e.target.value); load(e.target.value); }}
            placeholder="Search receipt, from/to account, description, type or party..."
          />
        </div>
      </div>

      {entries.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon payment-empty-icon">PM</div>
          <h3>No payments recorded yet</h3>
          <p>Add the first payment. The final PKR Paid Amount will update the Party Ledger.</p>
          <button className="primary purple-primary" onClick={() => setModalOpen(true)}>
            Add First Payment
          </button>
        </div>
      ) : (
        <div className="party-table-wrap payment-table-wrap">
          <table className="payment-table">
            <thead>
              <tr>
                <th>SR</th>
                <th>DATE</th>
                <th>RECEIPT #</th>
                <th>PARTY / VENDOR</th>
                <th>FROM ACCOUNT</th>
                <th>TO ACCOUNT</th>
                <th>DESCRIPTION</th>
                <th>TYPE</th>
                <th>SAR</th>
                <th>ROE</th>
                <th>PAID AMOUNT</th>
                <th>ACTIONS</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry, index) => (
                <tr key={entry.id} className={entry.status === "VOID" ? "void-row" : ""}>
                  <td className="centered">{index + 1}</td>
                  <td>{formatDate(entry.transaction_date)}</td>
                  <td>{entry.receipt_no || "—"}</td>
                  <td>
                    <b className="party-name">{entry.ledger_party_name}</b>
                    {entry.status === "VOID" && <small className="void-label">VOID</small>}
                  </td>
                  <td>{entry.from_account}</td>
                  <td>{entry.to_account}</td>
                  <td className="payment-description-cell">{entry.description || "—"}</td>
                  <td className="centered">{entry.payment_type}</td>
                  <td className="right">{entry.currency === "SAR" ? formatNumber(entry.sar) : "—"}</td>
                  <td className="right">{entry.currency === "SAR" ? formatNumber(entry.roe) : "—"}</td>
                  <td className="right payment-paid-amount">{formatMoney(entry.paid_amount)}</td>
                  <td>
                    <div className="row-actions compact-actions">
                      <button
                        onClick={() => {
                          const party = partyFor(entry);
                          if (party) onOpenLedger(party);
                        }}
                      >Ledger</button>
                      <button disabled={entry.status === "VOID"} onClick={() => { setEditing(entry); setModalOpen(true); }}>Edit</button>
                      <button className="danger-action" disabled={entry.status === "VOID"} onClick={() => voidEntry(entry)}>Void</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modalOpen && (
        <PaymentFormModal
          companyId={companyId}
          parties={parties}
          editing={editing}
          onClose={() => { setModalOpen(false); setEditing(null); }}
          onSaved={saved}
        />
      )}
    </section>
  );
}
