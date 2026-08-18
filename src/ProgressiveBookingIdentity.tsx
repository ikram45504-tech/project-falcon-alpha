import { useMemo, useState } from "react";
import type { BookingTransactionType, Party, PartyInput } from "./db";
import { createParty } from "./db";
import { bookingUbFromDigits, cleanBookingDigits } from "./bookingUb";

type Props = {
  companyId: string;
  userId?: string;
  transactionType: BookingTransactionType;
  parties: Party[];
  counterpartyId: string;
  onCounterpartyChange: (value: string) => void;
  bookingDate: string;
  onBookingDateChange: (value: string) => void;
  ubDigits: string;
  onUbDigitsChange: (value: string) => void;
  ubNumber: string;
  assigned: boolean;
  saved: boolean;
  onAssign: (formattedUb: string) => void;
  onEditHeader?: () => void;
  canQuickCreate?: boolean;
  onAccountsChanged?: () => void | Promise<void>;
  onError?: (message: string) => void;
  onMessage?: (message: string) => void;
  serviceLabel: string;
};

type QuickAccountState = { name: string; phone: string; whatsapp: string; address: string; notes: string };
const blankQuick: QuickAccountState = { name: "", phone: "", whatsapp: "", address: "", notes: "" };

export default function ProgressiveBookingIdentity({
  companyId,
  userId = "",
  transactionType,
  parties,
  counterpartyId,
  onCounterpartyChange,
  bookingDate,
  onBookingDateChange,
  ubDigits,
  onUbDigitsChange,
  ubNumber,
  assigned,
  saved,
  onAssign,
  onEditHeader,
  canQuickCreate = true,
  onAccountsChanged,
  onError,
  onMessage,
  serviceLabel,
}: Props) {
  const [quickOpen, setQuickOpen] = useState(false);
  const [quick, setQuick] = useState<QuickAccountState>(blankQuick);
  const [busy, setBusy] = useState(false);
  const accountType = transactionType === "SALE" ? "PARTY" : "VENDOR";
  const accountNoun = transactionType === "SALE" ? "Party / Customer" : "Vendor / Supplier";
  const eligible = useMemo(() => parties.filter((item) => item.status === "ACTIVE" && item.account_type === accountType), [parties, accountType]);
  const selected = useMemo(() => parties.find((item) => item.id === counterpartyId) || null, [parties, counterpartyId]);
  const preview = bookingUbFromDigits(ubDigits);

  async function saveQuick() {
    if (!quick.name.trim()) return onError?.(`${transactionType === "SALE" ? "Party" : "Vendor"} name is required.`);
    setBusy(true);
    onError?.("");
    try {
      const input: PartyInput = {
        name: quick.name.trim(),
        phone: quick.phone.trim(),
        whatsapp: quick.whatsapp.trim(),
        address: quick.address.trim(),
        notes: quick.notes.trim(),
        status: "ACTIVE",
        accountType,
      };
      const id = await createParty(companyId, input, userId);
      onCounterpartyChange(id);
      setQuickOpen(false);
      setQuick(blankQuick);
      await onAccountsChanged?.();
      onMessage?.(`${transactionType === "SALE" ? "Party" : "Vendor"} created and selected for this ${serviceLabel} booking.`);
    } catch (e) {
      onError?.(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (assigned) {
    return <section className={`package14-identity-complete ${saved ? "saved" : "ready"}`}>
      <span className="package14-check">✓</span>
      <div className="package14-identity-main"><small>{saved ? `${serviceLabel.toUpperCase()} BOOKING SAVED` : "BOOKING UB READY"}</small><b>{ubNumber}</b><span>{selected?.name || accountNoun}</span></div>
      <div><small>BOOKING DATE</small><b>{bookingDate}</b></div>
      <div><small>TRANSACTION</small><b>{transactionType}</b></div>
      <div><small>STATUS</small><b>{saved ? "ACTIVE" : "READY"}</b></div>
      {!saved && onEditHeader ? <button type="button" className="secondary" onClick={onEditHeader}>Edit Booking Header</button> : <span className="package14-lock">Identity locked after save</span>}
    </section>;
  }

  return <>
    <section className="package14-identity">
      <div className="package14-section-heading"><span>01</span><div><b>CREATE / ASSIGN BOOKING UB</b><small>Select the account, booking date and a 1–4 digit booking number.</small></div></div>
      <div className="package14-identity-grid">
        <label className="package14-account-field">{accountNoun} *
          <div className="package14-account-select">
            <select value={counterpartyId} onChange={(e) => onCounterpartyChange(e.target.value)}><option value="">Select {accountNoun}</option>{eligible.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
            {canQuickCreate && <button type="button" onClick={() => { setQuick(blankQuick); setQuickOpen(true); onError?.(""); }}>+ Create {transactionType === "SALE" ? "Party" : "Vendor"}</button>}
          </div>
          <small>Quick-create keeps you inside this booking screen.</small>
        </label>
        <label>Date of Booking *<input type="date" value={bookingDate} onChange={(e) => onBookingDateChange(e.target.value)} /><small>Accounting date for this {serviceLabel} booking.</small></label>
        <label>Booking Number *<div className="package14-ub-input"><span>UB-</span><input inputMode="numeric" maxLength={4} value={ubDigits} onChange={(e) => onUbDigitsChange(cleanBookingDigits(e.target.value))} placeholder="1234" /></div><small>Numbers only. Example: 7 becomes UB-0007.</small></label>
      </div>
      <div className="package14-ub-preview"><div><small>BOOKING UB PREVIEW</small><b>{preview || "UB-0000"}</b><span>{preview ? "Ready to create / assign" : "Enter a booking number"}</span></div><button type="button" className="primary" onClick={() => onAssign(preview)}>Create / Assign {preview || "UB"}</button></div>
    </section>

    {quickOpen && <div className="modal-backdrop package14-modal-backdrop" onMouseDown={(e) => e.currentTarget === e.target && setQuickOpen(false)}><section className="modal-card package14-quick-modal" onMouseDown={(e) => e.stopPropagation()}><button type="button" className="close-btn" onClick={() => setQuickOpen(false)}>×</button><span className="eyebrow blue">QUICK ACCOUNT</span><h2>Create {accountNoun}</h2><p>Create the account without leaving this booking. It will be selected automatically.</p><div className="package14-quick-grid"><label>Name *<input autoFocus value={quick.name} onChange={(e) => setQuick((v) => ({ ...v, name: e.target.value }))} /></label><label>Phone<input value={quick.phone} onChange={(e) => setQuick((v) => ({ ...v, phone: e.target.value }))} /></label><label>WhatsApp<input value={quick.whatsapp} onChange={(e) => setQuick((v) => ({ ...v, whatsapp: e.target.value }))} /></label><label>Address<input value={quick.address} onChange={(e) => setQuick((v) => ({ ...v, address: e.target.value }))} /></label><label className="wide">Notes<textarea rows={3} value={quick.notes} onChange={(e) => setQuick((v) => ({ ...v, notes: e.target.value }))} /></label></div><div className="package14-modal-actions"><button type="button" className="secondary" onClick={() => setQuickOpen(false)}>Cancel</button><button type="button" className="primary" disabled={busy} onClick={() => void saveQuick()}>{busy ? "Creating..." : `Create ${transactionType === "SALE" ? "Party" : "Vendor"}`}</button></div></section></div>}
  </>;
}
