import { useEffect, useMemo, useState } from "react";
import type { Party, PaymentEntry } from "./db";
import { getPayments } from "./db";
import { getPartyBookingTotals } from "./BookingAccounting";
import type { PartyBookingTotal } from "./BookingAccounting";
import {
  createPaymentV2,
  getNextPaymentDocumentNumber,
  getPaymentV2MetaMap,
  paymentDocumentPrefix,
  updatePaymentV2,
  voidPaymentV2,
} from "./PaymentV2Db";
import type {
  PaymentCurrency,
  PaymentMethod,
  PaymentTransactionKind,
  PaymentV2Input,
  PaymentV2Meta,
} from "./PaymentV2Db";
import "./PaymentsV2.css";

type PaymentSide = "PARTY" | "VENDOR";
type PaymentScreen = "DIRECTION" | "FORM" | "REGISTER";
type RegisterFilter = "ALL" | "PARTY_RECEIPT" | "VENDOR_PAYMENT" | "VOID";

type PaymentFormState = {
  transactionKind: PaymentTransactionKind;
  partyId: string;
  transactionDate: string;
  documentNo: string;
  paymentType: PaymentMethod;
  currency: PaymentCurrency;
  amount: string;
  roe: string;
  settlementAccount: string;
  reference: string;
  description: string;
  bankName: string;
  bankTransactionReference: string;
  accountTitle: string;
  accountLastDigits: string;
  chequeNo: string;
  transferDate: string;
  handledBy: string;
  location: string;
  internalNotes: string;
};

type ModuleProps = {
  companyId: string;
  parties: Party[];
  userId?: string;
  canEdit?: boolean;
  onOpenLedger: (party: Party) => void;
  onChanged: () => void | Promise<void>;
};

function localDate() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function formatDate(value: string) {
  if (!value) return "—";
  const [y, m, d] = value.split("-").map(Number);
  if (!y || !m || !d) return value;
  return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" })
    .format(new Date(y, m - 1, d))
    .replace(/ /g, "-");
}

function money(value: number) {
  return `Rs ${Number(value || 0).toLocaleString("en-PK", { maximumFractionDigits: 2 })}`;
}

function number(value: number) {
  return Number(value || 0).toLocaleString("en-PK", { maximumFractionDigits: 2 });
}

function kindForSide(side: PaymentSide): PaymentTransactionKind {
  return side === "PARTY" ? "PARTY_RECEIPT" : "VENDOR_PAYMENT";
}

function sideForKind(kind: PaymentTransactionKind): PaymentSide {
  return kind === "PARTY_RECEIPT" || kind === "PARTY_REFUND" ? "PARTY" : "VENDOR";
}

function kindLabel(kind: PaymentTransactionKind) {
  if (kind === "PARTY_RECEIPT") return "RECEIVE FROM PARTY";
  if (kind === "VENDOR_PAYMENT") return "PAY TO VENDOR";
  if (kind === "PARTY_REFUND") return "REFUND TO PARTY";
  return "REFUND FROM VENDOR";
}

function blankForm(side: PaymentSide): PaymentFormState {
  return {
    transactionKind: kindForSide(side),
    partyId: "",
    transactionDate: localDate(),
    documentNo: "",
    paymentType: "CASH",
    currency: "PKR",
    amount: "",
    roe: "",
    settlementAccount: "Cash in Hand",
    reference: "",
    description: "",
    bankName: "",
    bankTransactionReference: "",
    accountTitle: "",
    accountLastDigits: "",
    chequeNo: "",
    transferDate: "",
    handledBy: "",
    location: "",
    internalNotes: "",
  };
}

function inferKind(entry: PaymentEntry, meta: PaymentV2Meta | undefined, parties: Party[]): PaymentTransactionKind {
  if (meta) return meta.transaction_kind;
  const account = parties.find((party) => party.id === entry.party_id);
  return account?.account_type === "VENDOR" ? "VENDOR_PAYMENT" : "PARTY_RECEIPT";
}

function entryToForm(entry: PaymentEntry, meta: PaymentV2Meta | undefined, parties: Party[]): PaymentFormState {
  const transactionKind = inferKind(entry, meta, parties);
  const settlementAccount =
    meta?.settlement_account || (sideForKind(transactionKind) === "PARTY" ? entry.to_account : entry.from_account);
  return {
    transactionKind,
    partyId: entry.party_id,
    transactionDate: entry.transaction_date,
    documentNo: entry.receipt_no,
    paymentType: entry.payment_type,
    currency: entry.currency,
    amount: String(entry.amount_entered || ""),
    roe: entry.currency === "SAR" ? String(entry.roe || "") : "",
    settlementAccount,
    reference: meta?.reference || "",
    description: entry.description || "",
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

function paymentPreview(form: PaymentFormState) {
  const amount = Math.max(0, Number(form.amount) || 0);
  const roe = form.currency === "SAR" ? Math.max(0, Number(form.roe) || 0) : 0;
  return {
    amount,
    roe,
    sar: form.currency === "SAR" ? amount : 0,
    pkr: form.currency === "SAR" ? amount * roe : amount,
  };
}

function settlementEffect(kind: PaymentTransactionKind, value: number) {
  return kind === "PARTY_REFUND" || kind === "VENDOR_REFUND" ? -Number(value || 0) : Number(value || 0);
}

function toInput(form: PaymentFormState): PaymentV2Input {
  return {
    transactionKind: form.transactionKind,
    partyId: form.partyId,
    transactionDate: form.transactionDate,
    documentNo: form.documentNo,
    paymentType: form.paymentType,
    currency: form.currency,
    amount: Number(form.amount) || 0,
    roe: form.currency === "SAR" ? Number(form.roe) || 0 : 0,
    settlementAccount: form.settlementAccount,
    description: form.description,
    reference: form.reference,
    bankName: form.bankName,
    bankTransactionReference: form.bankTransactionReference,
    accountTitle: form.accountTitle,
    accountLastDigits: form.accountLastDigits,
    chequeNo: form.chequeNo,
    transferDate: form.transferDate,
    handledBy: form.handledBy,
    location: form.location,
    internalNotes: form.internalNotes,
  };
}

export function PaymentsModule({
  companyId,
  parties,
  userId = "",
  canEdit = true,
  onOpenLedger,
  onChanged,
}: ModuleProps) {
  const [screen, setScreen] = useState<PaymentScreen>("DIRECTION");
  const [side, setSide] = useState<PaymentSide>("PARTY");
  const [form, setForm] = useState<PaymentFormState>(() => blankForm("PARTY"));
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [entries, setEntries] = useState<PaymentEntry[]>([]);
  const [metaMap, setMetaMap] = useState<Map<string, PaymentV2Meta>>(() => new Map());
  const [bookingTotals, setBookingTotals] = useState<Record<string, PartyBookingTotal>>({});
  const [suggestedDocument, setSuggestedDocument] = useState("");
  const [registerFilter, setRegisterFilter] = useState<RegisterFilter>("ALL");
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function load() {
    try {
      const [paymentRows, metadata, totals] = await Promise.all([
        getPayments(companyId),
        getPaymentV2MetaMap(companyId),
        getPartyBookingTotals(companyId),
      ]);
      setEntries(paymentRows);
      setMetaMap(metadata);
      setBookingTotals(Object.fromEntries(totals.map((row) => [row.counterparty_id, row])));
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  useEffect(() => {
    void load();
  }, [companyId]);

  useEffect(() => {
    if (screen !== "FORM" || editingId) return;
    let cancelled = false;
    void getNextPaymentDocumentNumber(companyId, form.transactionKind, form.paymentType)
      .then((value) => {
        if (!cancelled) {
          setSuggestedDocument(value);
          setForm((current) => (current.documentNo ? current : { ...current, documentNo: value }));
        }
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [companyId, screen, editingId, form.transactionKind, form.paymentType]);

  const eligibleAccounts = useMemo(
    () => parties.filter((party) => party.status === "ACTIVE" && party.account_type === side),
    [parties, side],
  );
  const selectedAccount = useMemo(
    () => parties.find((party) => party.id === form.partyId) || null,
    [parties, form.partyId],
  );
  const preview = useMemo(() => paymentPreview(form), [form]);

  const bookingAmount = useMemo(() => {
    const totals = bookingTotals[form.partyId];
    if (!totals) return 0;
    return side === "PARTY" ? Number(totals.sale_total || 0) : Number(totals.purchase_total || 0);
  }, [bookingTotals, form.partyId, side]);

  const existingSettlement = useMemo(
    () =>
      entries
        .filter((entry) => entry.status === "ACTIVE" && entry.party_id === form.partyId && entry.id !== editingId)
        .reduce((sum, entry) => {
          const kind = inferKind(entry, metaMap.get(entry.id), parties);
          return sum + settlementEffect(kind, entry.paid_amount);
        }, 0),
    [entries, form.partyId, editingId, metaMap, parties],
  );

  const currentBalance = bookingAmount - existingSettlement;
  const newBalance = currentBalance - settlementEffect(form.transactionKind, preview.pkr);

  const activeEntries = useMemo(() => entries.filter((entry) => entry.status === "ACTIVE"), [entries]);
  const partyReceived = useMemo(
    () =>
      activeEntries.reduce((sum, entry) => {
        const kind = inferKind(entry, metaMap.get(entry.id), parties);
        return kind === "PARTY_RECEIPT" ? sum + Number(entry.paid_amount || 0) : sum;
      }, 0),
    [activeEntries, metaMap, parties],
  );
  const vendorPaid = useMemo(
    () =>
      activeEntries.reduce((sum, entry) => {
        const kind = inferKind(entry, metaMap.get(entry.id), parties);
        return kind === "VENDOR_PAYMENT" ? sum + Number(entry.paid_amount || 0) : sum;
      }, 0),
    [activeEntries, metaMap, parties],
  );

  const visibleEntries = useMemo(() => {
    const clean = search.trim().toLowerCase();
    return entries.filter((entry) => {
      const meta = metaMap.get(entry.id);
      const kind = inferKind(entry, meta, parties);
      if (registerFilter === "VOID" && entry.status !== "VOID") return false;
      if (registerFilter !== "ALL" && registerFilter !== "VOID" && kind !== registerFilter) return false;
      if (!clean) return true;
      const haystack = [
        entry.receipt_no,
        entry.ledger_party_name,
        entry.from_account,
        entry.to_account,
        entry.description,
        entry.payment_type,
        entry.currency,
        kindLabel(kind),
        meta?.settlement_account,
        meta?.reference,
        meta?.bank_name,
        meta?.bank_transaction_reference,
        meta?.handled_by,
        meta?.location,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(clean);
    });
  }, [entries, metaMap, parties, registerFilter, search]);

  function patch<K extends keyof PaymentFormState>(key: K, value: PaymentFormState[K]) {
    setError("");
    setForm((current) => ({ ...current, [key]: value }));
  }

  function resetForSide(nextSide: PaymentSide) {
    setSide(nextSide);
    setForm(blankForm(nextSide));
    setDetailsOpen(false);
    setEditingId(null);
    setSuggestedDocument("");
    setError("");
    setMessage("");
  }

  function chooseSide(nextSide: PaymentSide) {
    resetForSide(nextSide);
    setScreen("FORM");
  }

  function backToDirections() {
    resetForSide("PARTY");
    setScreen("DIRECTION");
  }

  function openRegister() {
    setScreen("REGISTER");
    setError("");
    setMessage("");
    void load();
  }

  async function savePayment() {
    if (!canEdit) return setError("Your role does not allow payment entry changes.");
    if (!form.partyId)
      return setError(side === "PARTY" ? "Select a Party / Customer first." : "Select a Vendor / Supplier first.");
    if (!form.transactionDate) return setError("Payment date is required.");
    setBusy(true);
    setError("");
    setMessage("");
    try {
      let documentNo = form.documentNo.trim();
      if (!documentNo) {
        documentNo = await getNextPaymentDocumentNumber(companyId, form.transactionKind, form.paymentType);
        setForm((current) => ({ ...current, documentNo }));
      }
      const payload = toInput({ ...form, documentNo });
      if (editingId) {
        await updatePaymentV2(companyId, editingId, payload, userId);
        setMessage(`${documentNo} updated successfully.`);
      } else {
        const id = await createPaymentV2(companyId, payload, userId);
        setEditingId(id);
        setMessage(`${documentNo} saved successfully.`);
      }
      await load();
      await onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function editEntry(entry: PaymentEntry) {
    if (!canEdit || entry.status !== "ACTIVE") return;
    const meta = metaMap.get(entry.id);
    const nextForm = entryToForm(entry, meta, parties);
    const nextKind = nextForm.transactionKind;
    if (nextKind === "PARTY_REFUND" || nextKind === "VENDOR_REFUND") {
      setError("Refund editing will be enabled when the Refund workflow is activated.");
      return;
    }
    setSide(sideForKind(nextKind));
    setForm(nextForm);
    setDetailsOpen(true);
    setEditingId(entry.id);
    setScreen("FORM");
    setMessage(`Editing ${entry.receipt_no || "payment"}. Account and document number are locked.`);
    setError("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function voidEntry(entry: PaymentEntry) {
    if (!canEdit || entry.status !== "ACTIVE" || busy) return;
    if (
      !window.confirm(
        `Void ${entry.receipt_no || "this payment"} for ${money(entry.paid_amount)}? The record will remain in the Payment Register.`,
      )
    )
      return;
    setBusy(true);
    setError("");
    try {
      await voidPaymentV2(companyId, entry.id, userId);
      await load();
      await onChanged();
      if (editingId === entry.id) resetForSide(side);
      setMessage(`${entry.receipt_no || "Payment"} marked VOID.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function renderRegisterEntryActions(entry: PaymentEntry, account: Party | null) {
    return (
      <div className="row-actions compact-actions payment-v2-card-actions">
        <button type="button" onClick={() => account && onOpenLedger(account)} disabled={!account}>
          Ledger
        </button>
        {canEdit && (
          <button type="button" onClick={() => editEntry(entry)} disabled={entry.status !== "ACTIVE"}>
            Edit
          </button>
        )}
        {canEdit && (
          <button
            type="button"
            className="danger-action"
            onClick={() => void voidEntry(entry)}
            disabled={entry.status !== "ACTIVE" || busy}
          >
            Void
          </button>
        )}
      </div>
    );
  }

  function renderDirectionScreen() {
    return (
      <section className="booking-entry-screen booking-direction-screen payment-v2-direction">
        <div className="booking-screen-toolbar">
          <span></span>
          <button type="button" className="booking-foundation-badge payment-register-link" onClick={openRegister}>
            Open Payment Register
          </button>
        </div>
        <div className="booking-screen-heading centered-heading">
          <span className="eyebrow blue">PAYMENTS</span>
          <h2>Which account are you settling?</h2>
          <p>Choose the account side first. Payments remain account-based and are not allocated to individual UBs.</p>
        </div>
        <div className="booking-direction-grid">
          <button type="button" className="booking-direction-card sale" onClick={() => chooseSide("PARTY")}>
            <span className="direction-card-icon" aria-hidden="true">
              ↓
            </span>
            <div>
              <small>PARTY / CUSTOMER</small>
              <b>Receive from Party</b>
              <p>Record money received from a Party / customer and reduce its receivable balance.</p>
            </div>
            <span className="direction-arrow">→</span>
          </button>
          <button type="button" className="booking-direction-card purchase" onClick={() => chooseSide("VENDOR")}>
            <span className="direction-card-icon" aria-hidden="true">
              ↑
            </span>
            <div>
              <small>VENDOR / SUPPLIER</small>
              <b>Pay to Vendor</b>
              <p>Record money paid to a Vendor / supplier and reduce its payable balance.</p>
            </div>
            <span className="direction-arrow">→</span>
          </button>
        </div>
        <div className="payment-v2-refund-note">
          <b>Refund-ready foundation:</b> customer and vendor refund transaction types are reserved in the payment
          engine and will be activated with the Booking Cancellation / Refund workflow.
        </div>
      </section>
    );
  }

  function renderForm() {
    const isParty = side === "PARTY";
    const accountNoun = isParty ? "Party / Customer" : "Vendor / Supplier";
    const documentNoun = isParty ? "Receipt" : "Payment Voucher";
    const prefix = paymentDocumentPrefix(form.transactionKind, form.paymentType);
    const amountLabel = isParty ? "Payment Received" : "Payment Paid";
    const balanceLabel = isParty ? "Receivable" : "Payable";
    const flowText = isParty
      ? `${selectedAccount?.name || "Party"} → ${form.settlementAccount || (form.paymentType === "BANK" ? "Bank Account" : "Cash")}`
      : `${form.settlementAccount || (form.paymentType === "BANK" ? "Bank Account" : "Cash")} → ${selectedAccount?.name || "Vendor"}`;
    const documentPreview = form.documentNo || suggestedDocument || `${prefix}0001`;
    const isEditing = Boolean(editingId);

    return (
      <section className="booking-entry-screen payment-v2-form-page">
        <div className="booking-screen-toolbar payment-v2-toolbar">
          <button type="button" className="booking-back-button" onClick={backToDirections}>
            ← Back to Payment Types
          </button>
          <div className="payment-v2-toolbar-right">
            <span className={`direction-badge ${isParty ? "sale" : "purchase"}`}>
              {isParty ? "RECEIVE FROM PARTY" : "PAY TO VENDOR"}
            </span>
            <button type="button" className="booking-foundation-badge payment-register-button" onClick={openRegister}>
              Payment Register
            </button>
          </div>
        </div>

        <div className="payment-v2-title">
          <span className="eyebrow blue">{isParty ? "PARTY PAYMENTS" : "VENDOR PAYMENTS"}</span>
          <h2>
            {isEditing
              ? `Edit ${documentNoun} — ${form.documentNo}`
              : isParty
                ? "New Party Receipt"
                : "New Vendor Payment"}
          </h2>
          <p>Record the settlement in one step. Optional bank or cash details can be added below.</p>
        </div>

        {message && <div className="alert success">{message}</div>}
        {error && <div className="alert error">{error}</div>}

        <section className="payment-v2-form-card">
          <div className="payment-v2-form-section">
            <div className="payment-v2-section-label">
              <b>Account &amp; document</b>
              <small>Party/Vendor, date, method, and voucher number</small>
            </div>
            <div className="payment-v2-identity-grid">
              <label>
                {accountNoun} *
                <select value={form.partyId} disabled={isEditing} onChange={(e) => patch("partyId", e.target.value)}>
                  <option value="">Select {accountNoun}</option>
                  {eligibleAccounts.map((party) => (
                    <option key={party.id} value={party.id}>
                      {party.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Date of Payment *
                <input
                  type="date"
                  value={form.transactionDate}
                  onChange={(e) => patch("transactionDate", e.target.value)}
                />
              </label>
              <div className="payment-v2-method-field">
                <span>Payment Type *</span>
                <div className="payment-v2-method-tabs">
                  <button
                    type="button"
                    className={form.paymentType === "CASH" ? "active cash" : ""}
                    disabled={isEditing}
                    onClick={() =>
                      setForm((current) => ({
                        ...current,
                        paymentType: "CASH",
                        documentNo: "",
                        settlementAccount:
                          current.settlementAccount && current.settlementAccount !== "Cash in Hand"
                            ? current.settlementAccount
                            : "Cash in Hand",
                      }))
                    }
                  >
                    CASH
                  </button>
                  <button
                    type="button"
                    className={form.paymentType === "BANK" ? "active bank" : ""}
                    disabled={isEditing}
                    onClick={() =>
                      setForm((current) => ({
                        ...current,
                        paymentType: "BANK",
                        documentNo: "",
                        settlementAccount:
                          current.settlementAccount === "Cash in Hand" ? "" : current.settlementAccount,
                      }))
                    }
                  >
                    BANK
                  </button>
                </div>
              </div>
              <label>
                {documentNoun} #
                <input value={documentPreview} readOnly className="payment-v2-doc-readonly" />
                <small>Auto-assigned on save</small>
              </label>
            </div>
          </div>

          <div className="payment-v2-form-section">
            <div className="payment-v2-section-label">
              <b>Amount &amp; settlement</b>
              <small>Currency, amount, and cash/bank account</small>
            </div>
            <div className="payment-v2-setup-grid">
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
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.amount}
                  onChange={(e) => patch("amount", e.target.value)}
                  placeholder="0.00"
                />
              </label>
              <label className={form.currency === "PKR" ? "payment-v2-muted-field" : ""}>
                ROE {form.currency === "SAR" ? "*" : ""}
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.roe}
                  onChange={(e) => patch("roe", e.target.value)}
                  disabled={form.currency === "PKR"}
                  placeholder={form.currency === "SAR" ? "e.g. 76.50" : "Not required"}
                />
              </label>
              <label>
                PKR Equivalent
                <input value={money(preview.pkr)} readOnly />
              </label>
              <label className="payment-v2-settlement-field">
                {form.paymentType === "BANK" ? "Bank / Settlement Account" : "Cash / Settlement Account"} *
                <input
                  value={form.settlementAccount}
                  onChange={(e) => patch("settlementAccount", e.target.value)}
                  placeholder={form.paymentType === "BANK" ? "e.g. HBL, Meezan, ABL" : "e.g. Cash in Hand, Office Cash"}
                />
              </label>
            </div>

            <div className="payment-v2-flow">
              <small>MONEY FLOW</small>
              <b>{flowText}</b>
            </div>

            <div className="payment-v2-balance-preview">
              <div>
                <small>CURRENT {balanceLabel.toUpperCase()}</small>
                <b className={currentBalance < 0 ? "advance" : ""}>
                  {money(Math.abs(currentBalance))}
                  {currentBalance < 0 ? " Advance" : ""}
                </b>
              </div>
              <div>
                <small>{amountLabel.toUpperCase()}</small>
                <b>{money(preview.pkr)}</b>
                {form.currency === "SAR" && (
                  <span>
                    SAR {number(preview.sar)} @ {number(preview.roe)}
                  </span>
                )}
              </div>
              <div className="highlight">
                <small>NEW {balanceLabel.toUpperCase()}</small>
                <b className={newBalance < 0 ? "advance" : ""}>
                  {money(Math.abs(newBalance))}
                  {newBalance < 0 ? " Advance" : ""}
                </b>
                <span>Preview only — overpayments are allowed.</span>
              </div>
            </div>
          </div>

          <div className={`payment-v2-details ${detailsOpen ? "open" : "closed"}`}>
            <button
              type="button"
              className="payment-v2-details-toggle"
              onClick={() => setDetailsOpen((value) => !value)}
            >
              <div>
                <b>Optional payment details</b>
                <small>
                  {form.paymentType === "BANK" ? "Bank transfer" : "Cash handling"} reference, description, and notes
                </small>
              </div>
              <strong>{detailsOpen ? "Hide ▲" : "Show ▼"}</strong>
            </button>
            {detailsOpen && (
              <div className="payment-v2-information-body">
                {form.paymentType === "BANK" ? (
                  <div className="payment-v2-info-grid">
                    <label>
                      Bank Name
                      <input
                        value={form.bankName}
                        onChange={(e) => patch("bankName", e.target.value)}
                        placeholder="e.g. HBL / Meezan / ABL"
                      />
                    </label>
                    <label>
                      Bank Transaction / Reference #
                      <input
                        value={form.bankTransactionReference}
                        onChange={(e) => patch("bankTransactionReference", e.target.value)}
                        placeholder="Transfer / deposit reference"
                      />
                    </label>
                    <label>
                      Sender / Receiver Account Title
                      <input value={form.accountTitle} onChange={(e) => patch("accountTitle", e.target.value)} />
                    </label>
                    <label>
                      Account / IBAN Last Digits
                      <input
                        value={form.accountLastDigits}
                        onChange={(e) => patch("accountLastDigits", e.target.value.replace(/\s/g, "").slice(0, 12))}
                        placeholder="Optional last digits"
                      />
                    </label>
                    <label>
                      Cheque #
                      <input
                        value={form.chequeNo}
                        onChange={(e) => patch("chequeNo", e.target.value)}
                        placeholder="If applicable"
                      />
                    </label>
                    <label>
                      Transfer / Deposit Date
                      <input
                        type="date"
                        value={form.transferDate}
                        onChange={(e) => patch("transferDate", e.target.value)}
                      />
                    </label>
                  </div>
                ) : (
                  <div className="payment-v2-info-grid">
                    <label>
                      {isParty ? "Cash Received / Handled By" : "Cash Paid / Handled By"}
                      <input
                        value={form.handledBy}
                        onChange={(e) => patch("handledBy", e.target.value)}
                        placeholder="Staff / person name"
                      />
                    </label>
                    <label>
                      Location / Office
                      <input
                        value={form.location}
                        onChange={(e) => patch("location", e.target.value)}
                        placeholder="e.g. Main Office"
                      />
                    </label>
                  </div>
                )}
                <div className="payment-v2-info-grid common">
                  <label>
                    Reference
                    <input
                      value={form.reference}
                      onChange={(e) => patch("reference", e.target.value)}
                      placeholder="Optional account/payment reference"
                    />
                  </label>
                  <label className="wide">
                    Description
                    <textarea
                      rows={3}
                      value={form.description}
                      onChange={(e) => patch("description", e.target.value)}
                      placeholder="Payment description"
                    />
                  </label>
                  <label className="wide">
                    Internal Notes
                    <textarea
                      rows={3}
                      value={form.internalNotes}
                      onChange={(e) => patch("internalNotes", e.target.value)}
                      placeholder="Internal information not used in accounting totals"
                    />
                  </label>
                </div>
              </div>
            )}
          </div>

          <div className="payment-v2-form-actions">
            {isEditing && (
              <button type="button" className="secondary" onClick={() => resetForSide(side)}>
                + New {isParty ? "Party Receipt" : "Vendor Payment"}
              </button>
            )}
            {selectedAccount && (
              <button type="button" className="secondary" onClick={() => onOpenLedger(selectedAccount)}>
                Open Ledger
              </button>
            )}
            <button
              type="button"
              className="primary payment-v2-save"
              disabled={busy || !canEdit}
              onClick={() => void savePayment()}
            >
              {busy ? "Saving..." : isEditing ? `Update ${documentNoun} — ${form.documentNo}` : `Save ${documentNoun}`}
            </button>
          </div>
        </section>
      </section>
    );
  }

  function renderRegister() {
    return (
      <section className="booking-entry-screen payment-v2-register-page">
        <div className="booking-screen-toolbar payment-v2-toolbar">
          <button type="button" className="booking-back-button" onClick={backToDirections}>
            ← Back to Payments
          </button>
          <div className="payment-v2-register-actions">
            {canEdit && (
              <>
                <button type="button" className="secondary" onClick={() => chooseSide("PARTY")}>
                  + Party Receipt
                </button>
                <button type="button" className="primary payment-v2-save" onClick={() => chooseSide("VENDOR")}>
                  + Vendor Payment
                </button>
              </>
            )}
          </div>
        </div>

        <div className="payment-v2-register-title">
          <div>
            <span className="eyebrow blue">PAYMENT REGISTER</span>
            <h2>Payment Register</h2>
            <p>Account-based Party receipts and Vendor payments with Cash and Bank vouchers.</p>
          </div>
          <div className="payment-v2-register-stats">
            <div>
              <small>ACTIVE</small>
              <b>{activeEntries.length}</b>
            </div>
            <div>
              <small>PARTY RECEIVED</small>
              <b>{money(partyReceived)}</b>
            </div>
            <div>
              <small>VENDOR PAID</small>
              <b>{money(vendorPaid)}</b>
            </div>
            <div>
              <small>NET CASH MOVEMENT</small>
              <b>{money(partyReceived - vendorPaid)}</b>
            </div>
          </div>
        </div>

        {message && <div className="alert success">{message}</div>}
        {error && <div className="alert error">{error}</div>}

        <div className="payment-v2-register-controls">
          <div className="package-register-filter-tabs">
            {(["ALL", "PARTY_RECEIPT", "VENDOR_PAYMENT", "VOID"] as RegisterFilter[]).map((item) => (
              <button
                type="button"
                key={item}
                className={registerFilter === item ? "active" : ""}
                onClick={() => setRegisterFilter(item)}
              >
                {item === "ALL"
                  ? "All Payments"
                  : item === "PARTY_RECEIPT"
                    ? "Party Receipts"
                    : item === "VENDOR_PAYMENT"
                      ? "Vendor Payments"
                      : "Voided"}
              </button>
            ))}
          </div>
          <div className="search-box package-search">
            <span>⌕</span>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search receipt, account, bank, reference, description..."
            />
          </div>
        </div>

        {visibleEntries.length === 0 ? (
          <div className="empty-state compact-empty">
            <div className="empty-icon payment-empty-icon">PM</div>
            <h3>No payments found</h3>
            <p>Create a Party receipt or Vendor payment, or change the register filter.</p>
          </div>
        ) : (
          <>
            <div className="party-table-wrap payment-v2-register-wrap payment-v2-register-desktop">
              <table className="party-table payment-v2-register-table">
                <thead>
                  <tr>
                    <th>DATE</th>
                    <th>RECEIPT / VOUCHER #</th>
                    <th>TYPE</th>
                    <th>PARTY / VENDOR</th>
                    <th>METHOD</th>
                    <th>CURRENCY</th>
                    <th>SAR / ROE</th>
                    <th>PKR AMOUNT</th>
                    <th>SETTLEMENT ACCOUNT</th>
                    <th>REFERENCE</th>
                    <th>STATUS</th>
                    <th>ACTIONS</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleEntries.map((entry) => {
                    const meta = metaMap.get(entry.id);
                    const kind = inferKind(entry, meta, parties);
                    const account = parties.find((party) => party.id === entry.party_id) || null;
                    const settlement =
                      meta?.settlement_account ||
                      (sideForKind(kind) === "PARTY" ? entry.to_account : entry.from_account);
                    return (
                      <tr key={entry.id} className={entry.status === "VOID" ? "void-row" : ""}>
                        <td>{formatDate(entry.transaction_date)}</td>
                        <td>
                          <b className="payment-v2-document-number">{entry.receipt_no || "LEGACY"}</b>
                          {!meta && <small className="table-note">Legacy payment</small>}
                        </td>
                        <td>
                          <span
                            className={`payment-v2-kind-chip ${kind === "PARTY_RECEIPT" ? "receipt" : kind === "VENDOR_PAYMENT" ? "vendor" : "refund"}`}
                          >
                            {kindLabel(kind)}
                          </span>
                        </td>
                        <td>
                          <b>{entry.ledger_party_name || account?.name || "—"}</b>
                        </td>
                        <td>
                          <span className={`payment-v2-method-chip ${entry.payment_type.toLowerCase()}`}>
                            {entry.payment_type}
                          </span>
                        </td>
                        <td>{entry.currency}</td>
                        <td>
                          {entry.currency === "SAR" ? (
                            <>
                              <b>SAR {number(entry.sar)}</b>
                              <small className="table-note">ROE {number(entry.roe)}</small>
                            </>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="amount">
                          <b>{money(entry.paid_amount)}</b>
                        </td>
                        <td>
                          {settlement || "—"}
                          {meta?.bank_name && <small className="table-note">{meta.bank_name}</small>}
                        </td>
                        <td>{meta?.reference || entry.description || "—"}</td>
                        <td>
                          <span className={`status ${entry.status.toLowerCase()}`}>{entry.status}</span>
                        </td>
                        <td>{renderRegisterEntryActions(entry, account)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="payment-v2-register-cards">
              {visibleEntries.map((entry) => {
                const meta = metaMap.get(entry.id);
                const kind = inferKind(entry, meta, parties);
                const account = parties.find((party) => party.id === entry.party_id) || null;
                const settlement =
                  meta?.settlement_account || (sideForKind(kind) === "PARTY" ? entry.to_account : entry.from_account);
                return (
                  <article
                    key={entry.id}
                    className={`payment-v2-register-card ${entry.status === "VOID" ? "void" : ""}`}
                  >
                    <div className="payment-v2-card-head">
                      <div>
                        <b className="payment-v2-document-number">{entry.receipt_no || "LEGACY"}</b>
                        <span>{formatDate(entry.transaction_date)}</span>
                      </div>
                      <span className={`status ${entry.status.toLowerCase()}`}>{entry.status}</span>
                    </div>
                    <div className="payment-v2-card-chips">
                      <span
                        className={`payment-v2-kind-chip ${kind === "PARTY_RECEIPT" ? "receipt" : kind === "VENDOR_PAYMENT" ? "vendor" : "refund"}`}
                      >
                        {kindLabel(kind)}
                      </span>
                      <span className={`payment-v2-method-chip ${entry.payment_type.toLowerCase()}`}>
                        {entry.payment_type}
                      </span>
                    </div>
                    <div className="payment-v2-card-body">
                      <div>
                        <small>ACCOUNT</small>
                        <b>{entry.ledger_party_name || account?.name || "—"}</b>
                      </div>
                      <div>
                        <small>PKR AMOUNT</small>
                        <b>{money(entry.paid_amount)}</b>
                      </div>
                      <div>
                        <small>SETTLEMENT</small>
                        <b>{settlement || "—"}</b>
                      </div>
                      <div>
                        <small>REFERENCE</small>
                        <b>{meta?.reference || entry.description || "—"}</b>
                      </div>
                    </div>
                    {renderRegisterEntryActions(entry, account)}
                  </article>
                );
              })}
            </div>
          </>
        )}
      </section>
    );
  }

  if (screen === "DIRECTION") return renderDirectionScreen();
  if (screen === "FORM") return renderForm();
  return renderRegister();
}
