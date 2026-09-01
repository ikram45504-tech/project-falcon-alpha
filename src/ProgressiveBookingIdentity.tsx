import { useMemo, useState } from "react";
import type { BookingTransactionType, Party, PartyInput } from "./db";
import { blankPartyInput, createParty, normalizePartyInput } from "./db";
import AccountForm from "./AccountForm";
import AccountFormModal from "./AccountFormModal";
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
  /** progressive = assign UB then unlock commercial; unified = single-save header (Phase 2) */
  variant?: "progressive" | "unified";
  headerGridClass?: string;
  embedded?: boolean;
  unifiedHint?: string;
};

function IdentityCompleteBanner({
  saved,
  serviceLabel,
  ubNumber,
  selectedName,
  accountNoun,
  bookingDate,
  transactionType,
  onEditHeader,
}: {
  saved: boolean;
  serviceLabel: string;
  ubNumber: string;
  selectedName: string;
  accountNoun: string;
  bookingDate: string;
  transactionType: BookingTransactionType;
  onEditHeader?: () => void;
}) {
  return (
    <section className={`package14-identity-complete ${saved ? "saved" : "ready"}`}>
      <span className="package14-check">✓</span>
      <div className="package14-identity-main">
        <small>{saved ? `${serviceLabel.toUpperCase()} BOOKING SAVED` : "BOOKING UB READY"}</small>
        <b>{ubNumber}</b>
        <span>{selectedName || accountNoun}</span>
      </div>
      <div>
        <small>BOOKING DATE</small>
        <b>{bookingDate}</b>
      </div>
      <div>
        <small>TRANSACTION</small>
        <b>{transactionType}</b>
      </div>
      <div>
        <small>STATUS</small>
        <b>{saved ? "ACTIVE" : "READY"}</b>
      </div>
      {!saved && onEditHeader ? (
        <button type="button" className="secondary" onClick={onEditHeader}>
          Edit Booking Header
        </button>
      ) : (
        <span className="package14-lock">Identity locked after save</span>
      )}
    </section>
  );
}

function IdentityFieldGrid({
  accountNoun,
  transactionType,
  eligible,
  counterpartyId,
  onCounterpartyChange,
  bookingDate,
  onBookingDateChange,
  ubDigits,
  onUbDigitsChange,
  preview,
  canQuickCreate,
  onQuickCreate,
  headerGridClass,
}: {
  accountNoun: string;
  transactionType: BookingTransactionType;
  eligible: Party[];
  counterpartyId: string;
  onCounterpartyChange: (value: string) => void;
  bookingDate: string;
  onBookingDateChange: (value: string) => void;
  ubDigits: string;
  onUbDigitsChange: (value: string) => void;
  preview: string;
  canQuickCreate: boolean;
  onQuickCreate: () => void;
  headerGridClass: string;
}) {
  return (
    <div className={`${headerGridClass} booking-identity-grid`}>
      <label className="package14-account-field">
        {accountNoun} *
        <div className="package14-account-select">
          <select value={counterpartyId} onChange={(e) => onCounterpartyChange(e.target.value)}>
            <option value="">Select {accountNoun}</option>
            {eligible.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
          {canQuickCreate && (
            <button type="button" onClick={onQuickCreate}>
              + Create {transactionType === "SALE" ? "Party" : "Vendor"}
            </button>
          )}
        </div>
        <small className="booking-identity-helper">Quick-create keeps you inside this booking screen.</small>
      </label>
      <label>
        Date of Booking *
        <input type="date" value={bookingDate} onChange={(e) => onBookingDateChange(e.target.value)} />
        <small className="booking-identity-helper">Accounting date for this booking.</small>
      </label>
      <label>
        Booking Number *
        <div className="package14-ub-input">
          <span>UB-</span>
          <input
            inputMode="numeric"
            maxLength={4}
            value={ubDigits}
            onChange={(e) => onUbDigitsChange(cleanBookingDigits(e.target.value))}
            placeholder="1234"
          />
        </div>
        <small className="booking-identity-helper">
          {preview ? `Will save as ${preview}` : "Numbers only. Example: 7 becomes UB-0007."}
        </small>
      </label>
    </div>
  );
}

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
  variant = "progressive",
  headerGridClass = "ticket9-header-grid",
  embedded = false,
  unifiedHint = "Party, date, and UB are saved together with commercial details when you click Save Booking.",
}: Props) {
  const accountType = transactionType === "SALE" ? "PARTY" : "VENDOR";
  const [quickOpen, setQuickOpen] = useState(false);
  const [quick, setQuick] = useState<PartyInput>(() => blankPartyInput(accountType));
  const [busy, setBusy] = useState(false);
  const accountNoun = transactionType === "SALE" ? "Party / Customer" : "Vendor / Supplier";
  const eligible = useMemo(
    () => parties.filter((item) => item.status === "ACTIVE" && item.account_type === accountType),
    [parties, accountType],
  );
  const selected = useMemo(() => parties.find((item) => item.id === counterpartyId) || null, [parties, counterpartyId]);
  const preview = bookingUbFromDigits(ubDigits);
  const isUnified = variant === "unified";

  async function saveQuick() {
    const input = normalizePartyInput({ ...quick, accountType, status: quick.status || "ACTIVE" });
    if (!input.name) return onError?.(`${transactionType === "SALE" ? "Party" : "Vendor"} name is required.`);
    setBusy(true);
    onError?.("");
    try {
      const id = await createParty(companyId, input, userId);
      onCounterpartyChange(id);
      setQuickOpen(false);
      setQuick(blankPartyInput(accountType));
      await onAccountsChanged?.();
      onMessage?.(
        `${transactionType === "SALE" ? "Party" : "Vendor"} created and selected for this ${serviceLabel} booking.`,
      );
    } catch (e) {
      onError?.(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function openQuickCreate() {
    setQuick(blankPartyInput(accountType));
    setQuickOpen(true);
    onError?.("");
  }

  if (isUnified && saved) {
    return (
      <IdentityCompleteBanner
        saved
        serviceLabel={serviceLabel}
        ubNumber={ubNumber}
        selectedName={selected?.name || ""}
        accountNoun={accountNoun}
        bookingDate={bookingDate}
        transactionType={transactionType}
      />
    );
  }

  if (!isUnified && assigned) {
    return (
      <IdentityCompleteBanner
        saved={saved}
        serviceLabel={serviceLabel}
        ubNumber={ubNumber}
        selectedName={selected?.name || ""}
        accountNoun={accountNoun}
        bookingDate={bookingDate}
        transactionType={transactionType}
        onEditHeader={onEditHeader}
      />
    );
  }

  const unifiedHeader = isUnified ? (
    <>
      <div className="ticket9-section-head booking-identity-head">
        <span className="booking-identity-step">1</span>
        <div>
          <b>ACCOUNT &amp; BOOKING NUMBER</b>
          <small>{unifiedHint}</small>
        </div>
      </div>
      <IdentityFieldGrid
        accountNoun={accountNoun}
        transactionType={transactionType}
        eligible={eligible}
        counterpartyId={counterpartyId}
        onCounterpartyChange={onCounterpartyChange}
        bookingDate={bookingDate}
        onBookingDateChange={onBookingDateChange}
        ubDigits={ubDigits}
        onUbDigitsChange={onUbDigitsChange}
        preview={preview}
        canQuickCreate={canQuickCreate}
        onQuickCreate={openQuickCreate}
        headerGridClass={headerGridClass}
      />
    </>
  ) : null;

  const progressiveHeader = !isUnified ? (
    <section className="package14-identity">
      <div className="package14-section-heading">
        <span>01</span>
        <div>
          <b>CREATE / ASSIGN BOOKING UB</b>
          <small>Select the account, booking date and a 1–4 digit booking number.</small>
        </div>
      </div>
      <IdentityFieldGrid
        accountNoun={accountNoun}
        transactionType={transactionType}
        eligible={eligible}
        counterpartyId={counterpartyId}
        onCounterpartyChange={onCounterpartyChange}
        bookingDate={bookingDate}
        onBookingDateChange={onBookingDateChange}
        ubDigits={ubDigits}
        onUbDigitsChange={onUbDigitsChange}
        preview={preview}
        canQuickCreate={canQuickCreate}
        onQuickCreate={openQuickCreate}
        headerGridClass="package14-identity-grid"
      />
      <div className="package14-ub-preview">
        <div>
          <small>BOOKING UB PREVIEW</small>
          <b>{preview || "UB-0000"}</b>
          <span>{preview ? "Ready to create / assign" : "Enter a booking number"}</span>
        </div>
        <button type="button" className="primary" onClick={() => onAssign(preview)}>
          Create / Assign {preview || "UB"}
        </button>
      </div>
    </section>
  ) : null;

  return (
    <>
      {embedded ? (
        <>
          {unifiedHeader}
          {progressiveHeader}
        </>
      ) : (
        <>
          {unifiedHeader && <section className="package14-identity-unified">{unifiedHeader}</section>}
          {progressiveHeader}
        </>
      )}

      {quickOpen && (
        <AccountFormModal
          title={`Add New ${transactionType === "SALE" ? "Party" : "Vendor"}`}
          busy={busy}
          busyLabel="Creating..."
          primaryLabel={`Create ${transactionType === "SALE" ? "Party" : "Vendor"}`}
          backdropClassName="package14-modal-backdrop"
          onClose={() => setQuickOpen(false)}
          onSubmit={() => void saveQuick()}
        >
          <AccountForm value={quick} onChange={setQuick} />
        </AccountFormModal>
      )}
    </>
  );
}
