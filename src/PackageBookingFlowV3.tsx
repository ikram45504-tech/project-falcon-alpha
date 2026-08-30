import { useEffect, useMemo, useState } from "react";
import type {
  BookingTransactionType,
  PackageBooking,
  PackageBookingLineInput,
  PackagePassengerType,
  Party,
  PartyInput,
} from "./db";
import { createParty, getPackageBookings, voidPackageBooking } from "./db";
import { createPackageCommercialBooking } from "./PackageFlowDb";
import PackageOperationalDetails from "./PackageOperationalDetails";
import PackageBookingAdjustment from "./PackageBookingAdjustment";
import { useBookingFlowState } from "./useBookingFlowState";
import { getPackageAdjustmentSummaryMap, type PackageAdjustmentSummary } from "./PackageAdjustmentDb";
import { packageEffectiveCount, packageRowHasData, packageRowTotal, calculatePackageSummary } from "./pricingEngines";
import { bookingLifecycleConfigs } from "./BookingLifecycle";
import "./PackageBookingFlow.css";

const serviceLabel = bookingLifecycleConfigs.PACKAGE.label;

type Props = {
  companyId: string;
  parties: Party[];
  transactionType: BookingTransactionType;
  userId?: string;
  canCreate?: boolean;
  canEdit?: boolean;
  canVoid?: boolean;
  onBack: () => void;
  onChanged?: () => void | Promise<void>;
};

type RegisterFilter = "ALL" | BookingTransactionType;
type PackageRowState = {
  rowId: string;
  passengerType: PackagePassengerType;
  passengerName: string;
  packageType: string;
  rate: string;
  count: string;
};
type QuickAccountState = { name: string; phone: string; whatsapp: string; address: string; notes: string };

const packageTypeDefaults = [
  "Full Umrah Package",
  "Umrah Package Without Ticket",
  "20 Days Umrah Package",
  "15 Days Umrah Package",
  "5 Star Package",
  "Package Without Bed",
  "Ticket + Visa",
  "Land Package",
];
const blankQuickAccount: QuickAccountState = { name: "", phone: "", whatsapp: "", address: "", notes: "" };

function newRow(passengerType: PackagePassengerType): PackageRowState {
  return { rowId: crypto.randomUUID(), passengerType, passengerName: "", packageType: "", rate: "", count: "" };
}

function money(value: number) {
  return `Rs ${Number(value || 0).toLocaleString("en-PK", { maximumFractionDigits: 2 })}`;
}
function cleanDigits(value: string) {
  return value.replace(/\D/g, "").slice(0, 4);
}
function ubFromDigits(value: string) {
  const digits = cleanDigits(value);
  return digits ? `UB-${digits.padStart(4, "0")}` : "";
}
function normalized(value: string) {
  return value.trim().toUpperCase();
}
function digitsFromUb(value: string) {
  const match = normalized(value).match(/^UB-(\d{1,4})$/);
  return match ? String(Number(match[1])) : "";
}

export default function PackageBookingFlowV2({
  companyId,
  parties,
  transactionType,
  userId = "",
  canCreate = true,
  canEdit = true,
  canVoid = true,
  onBack,
  onChanged,
}: Props) {
  const [entries, setEntries] = useState<PackageBooking[]>([]);
  const {
    mode,
    setMode,
    tx: activeTransactionType,
    setTx: setActiveTransactionType,
    counterpartyId,
    setCounterpartyId,
    bookingDate,
    setBookingDate,
    ubDigits,
    setUbDigits,
    ubNumber,
    setUbNumber,
    assigned: ubAssigned,
    setAssigned: setUbAssigned,
    saved: commercialSaved,
    setSaved: setCommercialSaved,
    detailsOpen,
    setDetailsOpen,
    editingId,
    setEditingId,
    busy,
    setBusy,
    error,
    setError,
    message,
    setMessage,
    assignUb: hookAssign,
    resetState,
  } = useBookingFlowState(companyId, transactionType, entries, serviceLabel);

  const [rows, setRows] = useState<PackageRowState[]>([newRow("ADULT")]);
  const [registerFilter, setRegisterFilter] = useState<RegisterFilter>("ALL");
  const [search, setSearch] = useState("");
  const [quickAccountOpen, setQuickAccountOpen] = useState(false);
  const [quickAccount, setQuickAccount] = useState<QuickAccountState>(blankQuickAccount);
  const [quickAccountBusy, setQuickAccountBusy] = useState(false);
  const [adjustmentSummaries, setAdjustmentSummaries] = useState<Record<string, PackageAdjustmentSummary>>({});
  const [adjustmentBooking, setAdjustmentBooking] = useState<PackageBooking | null>(null);
  const [historyBooking, setHistoryBooking] = useState<PackageBooking | null>(null);

  useEffect(() => {
    void loadEntries("");
  }, [companyId]);

  const eligibleAccounts = useMemo(() => {
    const type = activeTransactionType === "SALE" ? "PARTY" : "VENDOR";
    return parties.filter((item) => item.status === "ACTIVE" && item.account_type === type);
  }, [parties, activeTransactionType]);
  const selectedAccount = useMemo(
    () => parties.find((item) => item.id === counterpartyId) || null,
    [parties, counterpartyId],
  );
  const packageTypeSuggestions = useMemo(() => {
    const values = new Set(packageTypeDefaults);
    entries.forEach((entry) =>
      entry.lines.forEach((line) => line.package_type.trim() && values.add(line.package_type.trim())),
    );
    return Array.from(values).sort((a, b) => a.localeCompare(b));
  }, [entries]);
  const totals = useMemo(() => calculatePackageSummary(rows), [rows]);

  const accountingEntries = entries.filter((entry) => entry.status === "ACTIVE");
  const liveBookings = accountingEntries.filter(
    (entry) => (adjustmentSummaries[entry.id]?.lifecycleStatus || "ACTIVE") !== "CANCELLED",
  );
  const visibleEntries = entries.filter(
    (entry) => registerFilter === "ALL" || entry.transaction_type === registerFilter,
  );
  const saleTotal = accountingEntries
    .filter((entry) => entry.transaction_type === "SALE")
    .reduce((sum, entry) => sum + Number(entry.total_pkr || 0), 0);
  const purchaseTotal = accountingEntries
    .filter((entry) => entry.transaction_type === "PURCHASE")
    .reduce((sum, entry) => sum + Number(entry.total_pkr || 0), 0);
  const registerPax = accountingEntries.reduce(
    (sum, entry) => sum + entry.lines.reduce((lineSum, line) => lineSum + Number(line.person_count || 0), 0),
    0,
  );

  async function loadEntries(nextSearch = search) {
    try {
      const [bookingRows, summaries] = await Promise.all([
        getPackageBookings(companyId, nextSearch),
        getPackageAdjustmentSummaryMap(companyId),
      ]);
      setEntries(bookingRows);
      setAdjustmentSummaries(summaries);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  function resetForm() {
    resetState();
    setRows([newRow("ADULT")]);
  }

  async function assignUb() {
    if (!ubDigits) return setError("Enter a booking number using 1 to 4 digits.");
    const formatted = ubFromDigits(ubDigits);
    hookAssign(formatted);
  }

  function buildLines(): PackageBookingLineInput[] {
    return rows.filter(packageRowHasData).map((row) => ({
      passengerType: row.passengerType,
      passengerName: row.passengerName,
      packageType: row.packageType,
      ratePerPerson: Math.max(0, Number(row.rate) || 0),
      personCount: packageEffectiveCount(row.count),
      qtyIsExplicit: row.count.trim() !== "",
    }));
  }

  async function saveCommercial() {
    if (!ubAssigned) return setError("Create / Assign the Booking UB first.");
    if (editingId)
      return setError(
        "Saved Package commercial values are changed through Booking Adjustment so every correction/amendment keeps history.",
      );
    if (!canCreate) return setError("Your role does not allow creating bookings.");
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const id = await createPackageCommercialBooking(
        companyId,
        {
          transactionType: activeTransactionType,
          counterpartyId,
          transactionDate: bookingDate,
          ubNumber,
          lines: buildLines(),
        },
        userId,
      );
      setEditingId(id);
      setCommercialSaved(true);
      setMessage(
        `${serviceLabel} booking ${ubNumber} saved successfully. Commercial values are now locked; use Booking Adjustment for future corrections, amendments or cancellations.`,
      );
      await loadEntries(search);
      await onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function addPassengerRow(type: PackagePassengerType) {
    if (editingId) return;
    setRows((current) => [...current, newRow(type)]);
    setError("");
  }
  function updateRow(rowId: string, patch: Partial<PackageRowState>) {
    if (editingId) return;
    setRows((current) => current.map((row) => (row.rowId === rowId ? { ...row, ...patch } : row)));
  }
  function removeRow(rowId: string) {
    if (editingId) return;
    const target = rows.find((row) => row.rowId === rowId);
    if (!target) return;
    const filtered = rows.filter(packageRowHasData);
    if (filtered.length <= 1 && target.passengerType === "ADULT")
      return setError("At least one adult passenger row is required.");
    setRows((current) => current.filter((row) => row.rowId !== rowId));
  }

  async function saveQuickAccount() {
    if (!quickAccount.name.trim())
      return setError(`${activeTransactionType === "SALE" ? "Party" : "Vendor"} name is required.`);
    setQuickAccountBusy(true);
    setError("");
    try {
      const input: PartyInput = {
        name: quickAccount.name.trim(),
        phone: quickAccount.phone.trim(),
        whatsapp: quickAccount.whatsapp.trim(),
        address: quickAccount.address.trim(),
        notes: quickAccount.notes.trim(),
        status: "ACTIVE",
        accountType: activeTransactionType === "SALE" ? "PARTY" : "VENDOR",
      };
      const id = await createParty(companyId, input, userId);
      setCounterpartyId(id);
      setQuickAccountOpen(false);
      setQuickAccount(blankQuickAccount);
      await onChanged?.();
      setMessage(`${activeTransactionType === "SALE" ? "Party" : "Vendor"} created and selected for this booking.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setQuickAccountBusy(false);
    }
  }

  function openEntry(entry: PackageBooking) {
    setActiveTransactionType(entry.transaction_type);
    setCounterpartyId(entry.counterparty_id);
    setBookingDate(entry.transaction_date);
    setUbNumber(entry.ub_number);
    setUbDigits(digitsFromUb(entry.ub_number));
    setUbAssigned(true);
    setCommercialSaved(true);
    setDetailsOpen(false);
    setRows(
      entry.lines.length
        ? entry.lines.map((line) => ({
            rowId: crypto.randomUUID(),
            passengerType: line.passenger_type,
            passengerName: line.passenger_name || "",
            packageType: line.package_type,
            rate: String(line.rate_per_person),
            count: String(Math.max(1, Number(line.person_count || 1))),
          }))
        : [],
    );
    setEditingId(entry.id);
    setMode("FORM");
    setError("");
    setMessage(
      `Opened ${entry.ub_number}. Commercial rows are read-only here. Use Booking Adjustment from the Register for Correction, Amendment or Cancellation.`,
    );
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function voidEntry(entry: PackageBooking) {
    if (!canVoid || entry.status !== "ACTIVE" || busy) return;
    if (
      !window.confirm(
        `Void ${serviceLabel} booking ${entry.ub_number}? Use Void only when this booking should never have existed. The audit record will remain.`,
      )
    )
      return;
    setBusy(true);
    setError("");
    try {
      await voidPackageBooking(companyId, entry.id, userId);
      await loadEntries(search);
      await onChanged?.();
      if (editingId === entry.id) resetForm();
      setMessage(`${serviceLabel} booking ${entry.ub_number} voided.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function deleteEntry(entry: PackageBooking) {
    if (
      !window.confirm(
        `Are you sure you want to permanently delete this ${serviceLabel} Booking (${entry.ub_number})? This is a temporary testing function.`,
      )
    )
      return;
    setBusy(true);
    setError("");
    try {
      const { deleteBooking } = await import("./db");
      await deleteBooking(entry.id, companyId, userId || "");
      await loadEntries(search);
      await onChanged?.();
      if (editingId === entry.id) resetForm();
      setMessage(`${serviceLabel} booking ${entry.ub_number} deleted.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function adjustmentSaved(nextMessage: string) {
    setMessage(nextMessage);
    setError("");
    await loadEntries(search);
    await onChanged?.();
  }

  function renderPassengerSection(type: PackagePassengerType) {
    const items = rows.filter((row) => row.passengerType === type);
    const label = type === "ADULT" ? "ADULTS" : type === "CHILD" ? "CHILDREN" : "INFANTS";
    const button = type === "ADULT" ? "+ Add Adult" : type === "CHILD" ? "+ Add Child" : "+ Add Infant";
    const commercialLocked = Boolean(editingId);
    return (
      <section className={`package14-passenger-group ${type.toLowerCase()}`}>
        <div className="package14-passenger-head">
          <div>
            <b>{label}</b>
            <small>
              {commercialLocked ? "Locked — use Booking Adjustment" : type === "ADULT" ? "Required" : "Optional"}
            </small>
          </div>
          {!commercialLocked && (
            <button type="button" onClick={() => addPassengerRow(type)}>
              {button}
            </button>
          )}
        </div>
        {items.length ? (
          items.map((row, index) => {
            const passengerLabel = type === "ADULT" ? "Adult" : type === "CHILD" ? "Child" : "Infant";
            return (
              <div className="package14-rate-row" key={row.rowId}>
                <span className="package14-sr">{index + 1}</span>
                <label>
                  Passenger / Family Head *
                  <input
                    disabled={commercialLocked}
                    value={row.passengerName}
                    onChange={(e) => updateRow(row.rowId, { passengerName: e.target.value })}
                  />
                </label>
                <label>
                  Package Type *
                  <input
                    disabled={commercialLocked}
                    list="package14-type-options"
                    value={row.packageType}
                    onChange={(e) => updateRow(row.rowId, { packageType: e.target.value })}
                  />
                </label>
                <label>
                  Rate / {passengerLabel} (PKR) *
                  <input
                    disabled={commercialLocked}
                    type="number"
                    min="0"
                    step="0.01"
                    value={row.rate}
                    onChange={(e) => updateRow(row.rowId, { rate: e.target.value })}
                  />
                </label>
                <label>
                  Qty
                  <input
                    disabled={commercialLocked}
                    type="number"
                    min="1"
                    step="1"
                    value={row.count}
                    onChange={(e) => updateRow(row.rowId, { count: e.target.value })}
                  />
                </label>
                <td className="money-cell">{money(packageRowTotal(row))}</td>
                {!commercialLocked && (
                  <td>
                    <button type="button" className="package14-remove" onClick={() => removeRow(row.rowId)}>
                      ×
                    </button>
                  </td>
                )}
              </div>
            );
          })
        ) : (
          <div className="package14-empty-row">No active {label.toLowerCase()} rows.</div>
        )}
      </section>
    );
  }

  function renderForm() {
    const previewUb = ubFromDigits(ubDigits);
    const accountNoun = activeTransactionType === "SALE" ? "Party / Customer" : "Vendor / Supplier";
    const openedSummary = editingId ? adjustmentSummaries[editingId] : undefined;
    const openedLifecycle = openedSummary?.lifecycleStatus || "ACTIVE";
    const openedRevision = openedSummary?.revisionNo || 1;
    return (
      <section className="booking-entry-screen package14-page">
        <div className="booking-screen-toolbar package14-toolbar">
          <button type="button" className="booking-back-button" onClick={onBack}>
            ← Back to Booking Services
          </button>
          <div className="package14-toolbar-right">
            <span className={`direction-badge ${activeTransactionType === "SALE" ? "sale" : "purchase"}`}>
              {activeTransactionType === "SALE" ? "SALE TO PARTY" : "PURCHASE FROM VENDOR / SUPPLIER"}
            </span>
            <button
              type="button"
              className="package-register-button"
              onClick={() => {
                setMode("REGISTER");
                setError("");
                setMessage("");
                void loadEntries(search);
              }}
            >
              {serviceLabel} Booking Register
            </button>
          </div>
        </div>
        <div className="package14-title">
          <div>
            <span className="eyebrow blue">{serviceLabel.toUpperCase()} BOOKING</span>
            <h2>{commercialSaved ? `${serviceLabel} Booking — ${ubNumber}` : `New ${serviceLabel} Booking`}</h2>
            <p>
              {editingId
                ? `Review the current effective ${serviceLabel} booking. Commercial changes are protected by Booking Adjustment history.`
                : `Create the UB first, save the accounting ${serviceLabel} values second, then complete optional passenger/travel operations when required.`}
            </p>
          </div>
        </div>
        {message && <div className="alert success">{message}</div>}
        {error && <div className="alert error">{error}</div>}

        {!ubAssigned ? (
          <section className="package14-identity">
            <div className="package14-section-heading">
              <span>01</span>
              <div>
                <b>CREATE / ASSIGN BOOKING UB</b>
                <small>Select the account, booking date and a 1–4 digit booking number.</small>
              </div>
            </div>
            <div className="package14-identity-grid">
              <label className="package14-account-field">
                {accountNoun} *
                <div className="package14-account-select">
                  <select value={counterpartyId} onChange={(e) => setCounterpartyId(e.target.value)}>
                    <option value="">Select {accountNoun}</option>
                    {eligibleAccounts.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => {
                      setQuickAccount(blankQuickAccount);
                      setQuickAccountOpen(true);
                      setError("");
                    }}
                  >
                    + Create {activeTransactionType === "SALE" ? "Party" : "Vendor"}
                  </button>
                </div>
                <small>Quick-create keeps you inside this booking screen.</small>
              </label>
              <label>
                Date of Booking *
                <input type="date" value={bookingDate} onChange={(e) => setBookingDate(e.target.value)} />
                <small>Accounting date for the {serviceLabel} booking.</small>
              </label>
              <label>
                Booking Number *
                <div className="package14-ub-input">
                  <span>UB-</span>
                  <input
                    inputMode="numeric"
                    maxLength={4}
                    value={ubDigits}
                    onChange={(e) => setUbDigits(cleanDigits(e.target.value))}
                    placeholder="1234"
                  />
                </div>
                <small>Numbers only. Example: 7 becomes UB-0007.</small>
              </label>
            </div>
            <div className="package14-ub-preview">
              <div>
                <small>BOOKING UB PREVIEW</small>
                <b>{previewUb || "UB-0000"}</b>
                <span>{previewUb ? "Ready to create / assign" : "Enter a booking number"}</span>
              </div>
              <button type="button" className="primary" onClick={assignUb}>
                Create / Assign {previewUb || "UB"}
              </button>
            </div>
          </section>
        ) : (
          <section className={`package14-identity-complete ${commercialSaved ? "saved" : "ready"}`}>
            <span className="package14-check">✓</span>
            <div className="package14-identity-main">
              <small>{commercialSaved ? `${serviceLabel.toUpperCase()} BOOKING` : "BOOKING UB READY"}</small>
              <b>{ubNumber}</b>
              <span>{selectedAccount?.name || accountNoun}</span>
            </div>
            <div>
              <small>BOOKING DATE</small>
              <b>{bookingDate}</b>
            </div>
            <div>
              <small>TRANSACTION</small>
              <b>{activeTransactionType}</b>
            </div>
            <div>
              <small>LIFECYCLE</small>
              <b>{commercialSaved ? `${openedLifecycle} · REV ${openedRevision}` : "READY"}</b>
            </div>
            {!commercialSaved ? (
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  setUbAssigned(false);
                  setMessage("");
                }}
              >
                Edit Booking Header
              </button>
            ) : (
              <span className="package14-lock">UB/account identity locked</span>
            )}
          </section>
        )}

        {ubAssigned && (
          <section className="package14-commercial-card">
            <div className="package14-section-heading">
              <span>02</span>
              <div>
                <b>{serviceLabel.toUpperCase()} DETAILS & RATES</b>
                <small>
                  {editingId
                    ? "Current effective commercial rows — use Booking Adjustment to change them."
                    : `Commercial / accounting data saved under ${ubNumber}.`}
                </small>
              </div>
            </div>
            <datalist id="package14-type-options">
              {packageTypeSuggestions.map((item) => (
                <option key={item} value={item} />
              ))}
            </datalist>
            <div className="package14-passenger-stack">
              {renderPassengerSection("ADULT")}
              {renderPassengerSection("CHILD")}
              {renderPassengerSection("INFANT")}
            </div>
            <div className="package14-summary">
              <div className="package14-summary-title">
                <span>{serviceLabel.toUpperCase()} BOOKING SUMMARY</span>
                <small>
                  {editingId
                    ? "Current row base. Register total may also include amendment/cancellation charges or credits."
                    : `Part of Section 02 — these totals form the ${serviceLabel} accounting value.`}
                </small>
              </div>
              <div className="package14-summary-body">
                <div className="package14-breakdown">
                  <div>
                    <span>Adults</span>
                    <b>{totals.qty.ADULT}</b>
                    <strong>{money(totals.amount.ADULT)}</strong>
                  </div>
                  <div>
                    <span>Children</span>
                    <b>{totals.qty.CHILD}</b>
                    <strong>{money(totals.amount.CHILD)}</strong>
                  </div>
                  <div>
                    <span>Infants</span>
                    <b>{totals.qty.INFANT}</b>
                    <strong>{money(totals.amount.INFANT)}</strong>
                  </div>
                </div>
                <div className="package14-grand">
                  <div>
                    <small>TOTAL ACTIVE PAX</small>
                    <b>{totals.totalPax}</b>
                  </div>
                  <div>
                    <small>ACTIVE ROW BASE</small>
                    <strong>{money(totals.grandTotal)}</strong>
                  </div>
                </div>
              </div>
            </div>
            <div className="package14-commercial-actions">
              {commercialSaved && (
                <button type="button" className="secondary" onClick={resetForm}>
                  + New {serviceLabel} Booking
                </button>
              )}
              {!editingId && canCreate && (
                <button
                  type="button"
                  className="primary package14-save"
                  disabled={busy}
                  onClick={() => void saveCommercial()}
                >
                  {busy ? "Saving..." : `Save ${serviceLabel} Booking — ${ubNumber}`}
                </button>
              )}
              {editingId && canEdit && openedLifecycle !== "CANCELLED" && (
                <button
                  type="button"
                  className="primary package14-save"
                  onClick={() => {
                    const entry = entries.find((item) => item.id === editingId);
                    if (entry) {
                      setAdjustmentBooking(entry);
                      setMode("REGISTER");
                    }
                  }}
                >
                  Open Booking Adjustment
                </button>
              )}
            </div>
          </section>
        )}

        {commercialSaved && editingId && (
          <section className={`package14-additional package15-shell ${detailsOpen ? "open" : "closed"}`}>
            <button
              type="button"
              className="package14-additional-toggle"
              onClick={() => setDetailsOpen((value) => !value)}
            >
              <span className="package14-step-purple">03</span>
              <div>
                <b>
                  {serviceLabel.toUpperCase()} TRAVEL & PASSENGER DETAILS — {ubNumber}
                </b>
                <small>Operational details remain separate from accounting values.</small>
              </div>
              <span className="package14-optional">OPTIONAL</span>
              <strong>{detailsOpen ? "Close Details ▲" : "+ Open Details ▼"}</strong>
            </button>
            {detailsOpen && (
              <PackageOperationalDetails
                companyId={companyId}
                bookingId={editingId}
                ubNumber={ubNumber}
                adultPax={totals.qty.ADULT}
                childPax={totals.qty.CHILD}
                infantPax={totals.qty.INFANT}
                canEdit={canEdit && openedLifecycle !== "CANCELLED"}
                onSaved={async () => {
                  await loadEntries(search);
                }}
              />
            )}
          </section>
        )}

        {!ubAssigned && (
          <div className="package14-next-step">
            Create / Assign a Booking UB to unlock {serviceLabel} Details & Rates.
          </div>
        )}
        {ubAssigned && !commercialSaved && (
          <div className="package14-next-step">Save Section 02 to activate the {serviceLabel} booking.</div>
        )}

        {quickAccountOpen && (
          <div
            className="modal-backdrop package14-modal-backdrop"
            onMouseDown={(e) => e.currentTarget === e.target && setQuickAccountOpen(false)}
          >
            <section className="modal-card package14-quick-modal" onMouseDown={(e) => e.stopPropagation()}>
              <button type="button" className="close-btn" onClick={() => setQuickAccountOpen(false)}>
                ×
              </button>
              <span className="eyebrow blue">QUICK ACCOUNT</span>
              <h2>Create {activeTransactionType === "SALE" ? "Party / Customer" : "Vendor / Supplier"}</h2>
              <p>Create the account without leaving the {serviceLabel} booking. It will be selected automatically.</p>
              <div className="package14-quick-grid">
                <label>
                  Name *
                  <input
                    autoFocus
                    value={quickAccount.name}
                    onChange={(e) => setQuickAccount((v) => ({ ...v, name: e.target.value }))}
                  />
                </label>
                <label>
                  Phone
                  <input
                    value={quickAccount.phone}
                    onChange={(e) => setQuickAccount((v) => ({ ...v, phone: e.target.value }))}
                  />
                </label>
                <label>
                  WhatsApp
                  <input
                    value={quickAccount.whatsapp}
                    onChange={(e) => setQuickAccount((v) => ({ ...v, whatsapp: e.target.value }))}
                  />
                </label>
                <label>
                  Address
                  <input
                    value={quickAccount.address}
                    onChange={(e) => setQuickAccount((v) => ({ ...v, address: e.target.value }))}
                  />
                </label>
                <label className="wide">
                  Notes
                  <textarea
                    rows={3}
                    value={quickAccount.notes}
                    onChange={(e) => setQuickAccount((v) => ({ ...v, notes: e.target.value }))}
                  />
                </label>
              </div>
              <div className="package14-modal-actions">
                <button type="button" className="secondary" onClick={() => setQuickAccountOpen(false)}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="primary"
                  disabled={quickAccountBusy}
                  onClick={() => void saveQuickAccount()}
                >
                  {quickAccountBusy ? "Creating..." : `Create ${activeTransactionType === "SALE" ? "Party" : "Vendor"}`}
                </button>
              </div>
            </section>
          </div>
        )}
      </section>
    );
  }

  function renderRegister() {
    return (
      <section className="booking-entry-screen package14-page package14-register-page">
        <div className="booking-screen-toolbar package14-toolbar">
          <button
            type="button"
            className="booking-back-button"
            onClick={() => {
              setMode("FORM");
              setError("");
            }}
          >
            ← Back to {serviceLabel} Booking
          </button>
          <span className="booking-foundation-badge active-engine">{serviceLabel.toUpperCase()} REGISTER</span>
        </div>
        <div className="package14-register-title">
          <div>
            <span className="eyebrow blue">{serviceLabel.toUpperCase()} BOOKING REGISTER</span>
            <h2>{serviceLabel} Booking Register</h2>
            <p>
              Original bookings stay tied to their genuine UB. Correction, Amendment and Cancellation are stored as
              revision history.
            </p>
          </div>
          <div className="package14-register-stats">
            <div>
              <small>LIVE BOOKINGS</small>
              <b>{liveBookings.length}</b>
            </div>
            <div>
              <small>SALES</small>
              <b>{money(saleTotal)}</b>
            </div>
            <div>
              <small>PURCHASES</small>
              <b>{money(purchaseTotal)}</b>
            </div>
            <div>
              <small>ACTIVE PAX</small>
              <b>{registerPax}</b>
            </div>
          </div>
        </div>
        {message && <div className="alert success">{message}</div>}
        {error && <div className="alert error">{error}</div>}
        <div className="package14-register-controls">
          <div className="package-register-filter-tabs">
            {(["ALL", "SALE", "PURCHASE"] as RegisterFilter[]).map((item) => (
              <button
                type="button"
                key={item}
                className={registerFilter === item ? "active" : ""}
                onClick={() => setRegisterFilter(item)}
              >
                {item === "ALL" ? `All ${serviceLabel} Bookings` : item === "SALE" ? "Sales" : "Purchases"}
              </button>
            ))}
          </div>
          <div className="search-box package-search">
            <span>⌕</span>
            <input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                void loadEntries(e.target.value);
              }}
              placeholder="Search UB, Party/Vendor, Passenger or Package Type..."
            />
          </div>
        </div>
        {visibleEntries.length === 0 ? (
          <div className="empty-state compact-empty">
            <div className="empty-icon">PKG</div>
            <h3>No {serviceLabel} bookings found</h3>
            <p>Create a {serviceLabel} booking or change the filter/search.</p>
          </div>
        ) : (
          <div className="party-table-wrap package14-register-wrap">
            <table className="party-table package14-register-table">
              <thead>
                <tr>
                  <th>DATE</th>
                  <th>UB #</th>
                  <th>TYPE</th>
                  <th>PARTY / VENDOR</th>
                  <th>CURRENT PACKAGE ROWS</th>
                  <th>PAX</th>
                  <th>EFFECTIVE TOTAL PKR</th>
                  <th>SECTION 03</th>
                  <th>LIFECYCLE</th>
                  <th>ACTIONS</th>
                </tr>
              </thead>
              <tbody>
                {visibleEntries.map((entry) => {
                  const pax = entry.lines.reduce((sum, line) => sum + Number(line.person_count || 0), 0);
                  const summary = adjustmentSummaries[entry.id];
                  const lifecycle = entry.status === "VOID" ? "VOID" : summary?.lifecycleStatus || "ACTIVE";
                  const revision = summary?.revisionNo || 1;
                  const lifecycleClass = lifecycle.toLowerCase().replaceAll("_", "-");
                  const fullyCancelled = lifecycle === "CANCELLED";
                  return (
                    <tr key={entry.id} className={entry.status === "VOID" ? "void-row" : ""}>
                      <td>{entry.transaction_date}</td>
                      <td>
                        <b>{entry.ub_number}</b>
                      </td>
                      <td>
                        <span className={`direction-badge ${entry.transaction_type === "SALE" ? "sale" : "purchase"}`}>
                          {entry.transaction_type}
                        </span>
                      </td>
                      <td>
                        <b>{entry.counterparty_name || "—"}</b>
                      </td>
                      <td>
                        <div className="package14-register-lines">
                          {entry.lines.length ? (
                            entry.lines.map((line) => (
                              <div key={line.id}>
                                <span className={`passenger-chip ${line.passenger_type.toLowerCase()}`}>
                                  {line.passenger_type}
                                </span>
                                <b>{line.passenger_name}</b>
                                <span>{line.package_type}</span>
                                <small>
                                  {line.person_count} × {money(line.rate_per_person)} = {money(line.line_total_pkr)}
                                </small>
                              </div>
                            ))
                          ) : (
                            <span>All commercial rows cancelled</span>
                          )}
                        </div>
                      </td>
                      <td>
                        <b>{pax}</b>
                      </td>
                      <td className="amount">
                        <b>{money(entry.total_pkr)}</b>
                      </td>
                      <td>
                        <span className="package14-detail-status optional">Optional</span>
                      </td>
                      <td>
                        <span className={`status package14-lifecycle ${lifecycleClass}`}>
                          {lifecycle} · REV {revision}
                        </span>
                      </td>
                      <td>
                        <div className="row-actions">
                          <button
                            type="button"
                            disabled={entry.status !== "ACTIVE" || busy}
                            onClick={() => openEntry(entry)}
                          >
                            Open Booking
                          </button>
                          <button
                            type="button"
                            className="package14-adjustment-action"
                            disabled={!canEdit || entry.status !== "ACTIVE" || fullyCancelled || busy}
                            onClick={() => setAdjustmentBooking(entry)}
                          >
                            Booking Adjustment
                          </button>
                          <button
                            type="button"
                            className="package14-history-action"
                            disabled={entry.status === "VOID" && !summary}
                            onClick={() => setHistoryBooking(entry)}
                          >
                            History
                          </button>
                          <button
                            type="button"
                            disabled={!canVoid || entry.status !== "ACTIVE" || busy}
                            onClick={() => void voidEntry(entry)}
                          >
                            Void
                          </button>
                          <button
                            type="button"
                            className="danger"
                            style={{ color: "var(--red)", border: "1px solid var(--red)" }}
                            disabled={!canVoid || busy}
                            onClick={() => void deleteEntry(entry)}
                          >
                            Delete (Test)
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    );
  }

  return (
    <>
      {mode === "REGISTER" ? renderRegister() : renderForm()}
      {adjustmentBooking && (
        <PackageBookingAdjustment
          companyId={companyId}
          booking={adjustmentBooking}
          userId={userId}
          canEdit={canEdit}
          initialView="ADJUSTMENT"
          onClose={() => setAdjustmentBooking(null)}
          onSaved={adjustmentSaved}
        />
      )}
      {historyBooking && (
        <PackageBookingAdjustment
          companyId={companyId}
          booking={historyBooking}
          userId={userId}
          canEdit={canEdit}
          initialView="HISTORY"
          onClose={() => setHistoryBooking(null)}
          onSaved={adjustmentSaved}
        />
      )}
    </>
  );
}
