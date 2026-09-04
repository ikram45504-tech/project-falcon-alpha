import { useEffect, useMemo, useState } from "react";
import type {
  BookingTransactionType,
  PackageBooking,
  PackageBookingLineInput,
  PackagePassengerType,
  Party,
} from "./db";
import { getPackageBookings, voidPackageBooking } from "./db";
import ProgressiveBookingIdentity from "./ProgressiveBookingIdentity";
import { createPackageCommercialBooking } from "./PackageFlowDb";
import PackageOperationalDetails from "./PackageOperationalDetails";
import PackageBookingAdjustment from "./PackageBookingAdjustment";
import { useBookingFlowState } from "./useBookingFlowState";
import { getPackageAdjustmentSummaryMap, type PackageAdjustmentSummary } from "./PackageAdjustmentDb";
import { packageEffectiveCount, packageRowHasData, packageRowTotal, calculatePackageSummary } from "./pricingEngines";
import { bookingDigitsFromUb, bookingUbFromDigits } from "./bookingUb";
import { bookingLifecycleConfigs } from "./BookingLifecycle";
import { useAuth } from "./AuthContext";
import { ADDITIONAL_BOOKING_DETAILS_UPGRADE, allowsAdditionalBookingDetails } from "./companyEntitlements";
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
  openBookingId?: string | null;
  onOpenBookingConsumed?: () => void;
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

function newRow(passengerType: PackagePassengerType): PackageRowState {
  return { rowId: crypto.randomUUID(), passengerType, passengerName: "", packageType: "", rate: "", count: "" };
}

function money(value: number) {
  return `Rs ${Number(value || 0).toLocaleString("en-PK", { maximumFractionDigits: 2 })}`;
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
  openBookingId = null,
  onOpenBookingConsumed,
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
    validateBookingUb,
    resetState,
  } = useBookingFlowState(companyId, transactionType, entries, serviceLabel);
  const { company } = useAuth();
  const canAdditionalDetails = allowsAdditionalBookingDetails(company?.entitlements);

  const [rows, setRows] = useState<PackageRowState[]>([newRow("ADULT")]);
  const [registerFilter, setRegisterFilter] = useState<RegisterFilter>("ALL");
  const [search, setSearch] = useState("");
  const [adjustmentSummaries, setAdjustmentSummaries] = useState<Record<string, PackageAdjustmentSummary>>({});
  const [adjustmentBooking, setAdjustmentBooking] = useState<PackageBooking | null>(null);
  const [historyBooking, setHistoryBooking] = useState<PackageBooking | null>(null);

  useEffect(() => {
    void loadEntries("");
  }, [companyId]);

  useEffect(() => {
    if (!openBookingId) return;
    let cancelled = false;
    void (async () => {
      try {
        const [bookingRows, summaries] = await Promise.all([
          getPackageBookings(companyId),
          getPackageAdjustmentSummaryMap(companyId),
        ]);
        if (cancelled) return;
        setEntries(bookingRows);
        setAdjustmentSummaries(summaries);
        const entry = bookingRows.find((item) => item.id === openBookingId);
        if (entry) openEntry(entry);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) onOpenBookingConsumed?.();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [openBookingId, companyId]);

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
    if (editingId)
      return setError(
        "Saved Package commercial values are changed through Booking Adjustment so every correction/amendment keeps history.",
      );
    if (!canCreate) return setError("Your role does not allow creating bookings.");
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const formatted = bookingUbFromDigits(ubDigits);
      const valid = await validateBookingUb(formatted);
      if (!valid) return;
      setUbNumber(formatted);
      const id = await createPackageCommercialBooking(
        companyId,
        {
          transactionType: activeTransactionType,
          counterpartyId,
          transactionDate: bookingDate,
          ubNumber: formatted,
          lines: buildLines(),
        },
        userId,
      );
      setEditingId(id);
      setCommercialSaved(true);
      setMessage(
        `${serviceLabel} booking ${formatted} saved. Additional booking details are available below. Commercial changes use Booking Adjustment.`,
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

  function openEntry(entry: PackageBooking) {
    setActiveTransactionType(entry.transaction_type);
    setCounterpartyId(entry.counterparty_id);
    setBookingDate(entry.transaction_date);
    setUbNumber(entry.ub_number);
    setUbDigits(bookingDigitsFromUb(entry.ub_number));
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
    const previewUb = bookingUbFromDigits(ubDigits);
    const openedSummary = editingId ? adjustmentSummaries[editingId] : undefined;
    const openedLifecycle = openedSummary?.lifecycleStatus || "ACTIVE";
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
                : `Complete account, UB, and ${serviceLabel.toLowerCase()} rates on one form, then save once. Additional booking details are optional.`}
            </p>
          </div>
        </div>
        {message && <div className="alert success">{message}</div>}
        {error && <div className="alert error">{error}</div>}

        <section className="package14-commercial-card package14-unified-form">
          <ProgressiveBookingIdentity
            companyId={companyId}
            userId={userId}
            transactionType={activeTransactionType}
            parties={parties}
            counterpartyId={counterpartyId}
            onCounterpartyChange={setCounterpartyId}
            bookingDate={bookingDate}
            onBookingDateChange={setBookingDate}
            ubDigits={ubDigits}
            onUbDigitsChange={setUbDigits}
            ubNumber={ubNumber}
            saved={commercialSaved}
            onAccountsChanged={onChanged}
            onError={setError}
            onMessage={setMessage}
            serviceLabel={serviceLabel}
            headerGridClass="package14-identity-grid"
            unifiedHint={`Party, date, and UB are saved together with ${serviceLabel.toLowerCase()} rates when you click Save Booking.`}
            embedded
          />

          <div className="package14-section-heading package14-commercial-head">
            <span>2</span>
            <div>
              <b>{serviceLabel.toUpperCase()} DETAILS &amp; RATES</b>
              <small>
                {editingId
                  ? "Current effective commercial rows — use Booking Adjustment to change them."
                  : "Enter package rows below, then save the full booking in one step."}
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
                  : `These totals form the ${serviceLabel} accounting value saved with the booking.`}
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
                {busy ? "Saving..." : `Save ${serviceLabel} Booking — ${previewUb || "UB-0000"}`}
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

        {commercialSaved && editingId && (
          <section className={`package14-additional package15-shell ${detailsOpen ? "open" : "closed"}`}>
            <button
              type="button"
              className="package14-additional-toggle"
              disabled={!canAdditionalDetails}
              title={canAdditionalDetails ? undefined : ADDITIONAL_BOOKING_DETAILS_UPGRADE}
              onClick={() => {
                if (!canAdditionalDetails) {
                  setMessage(ADDITIONAL_BOOKING_DETAILS_UPGRADE);
                  return;
                }
                setDetailsOpen((value) => !value);
              }}
            >
              <div>
                <b>ADDITIONAL BOOKING DETAILS — {ubNumber}</b>
                <small>Travel and passenger operations remain separate from accounting values.</small>
              </div>
              <strong>{detailsOpen ? "Hide ▲" : "Show ▼"}</strong>
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
