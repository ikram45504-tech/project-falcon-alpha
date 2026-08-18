import { useEffect, useMemo, useState } from "react";
import type { BookingTransactionType, PackageBooking, PackageBookingLineInput, PackagePassengerType, Party, PartyInput } from "./db";
import { createParty, getPackageBookings, voidPackageBooking } from "./db";
import {
  createPackageCommercialBooking,
  updatePackageAdditionalDetails,
  updatePackageCommercialBooking,
} from "./PackageFlowDb";
import "./PackageBookingFlow.css";

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

type Mode = "FORM" | "REGISTER";
type RegisterFilter = "ALL" | BookingTransactionType;

type PackageRowState = {
  rowId: string;
  passengerType: PackagePassengerType;
  passengerName: string;
  packageType: string;
  rate: string;
  count: string;
};

type QuickAccountState = {
  name: string;
  phone: string;
  whatsapp: string;
  address: string;
  notes: string;
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

const blankQuickAccount: QuickAccountState = { name: "", phone: "", whatsapp: "", address: "", notes: "" };

function newRow(passengerType: PackagePassengerType): PackageRowState {
  return { rowId: crypto.randomUUID(), passengerType, passengerName: "", packageType: "", rate: "", count: "" };
}

function localDate() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function numberValue(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function explicitCount(value: string) {
  return Math.max(0, Math.trunc(numberValue(value)));
}

function effectiveCount(value: string) {
  return value.trim() === "" ? 1 : explicitCount(value);
}

function rowHasData(row: PackageRowState) {
  return Boolean(row.passengerName.trim() || row.packageType.trim() || row.rate.trim() || row.count.trim());
}

function rowPax(row: PackageRowState) {
  return rowHasData(row) ? effectiveCount(row.count) : 0;
}

function rowTotal(row: PackageRowState) {
  return Math.max(0, numberValue(row.rate)) * effectiveCount(row.count);
}

function money(value: number) {
  return `Rs ${Number(value || 0).toLocaleString("en-PK", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

function inclusiveDays(from: string, to: string) {
  if (!from || !to || to < from) return 0;
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  const start = Date.UTC(fy, fm - 1, fd);
  const end = Date.UTC(ty, tm - 1, td);
  return Math.floor((end - start) / 86400000) + 1;
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

export default function PackageBookingFlow({
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
  const [mode, setMode] = useState<Mode>("FORM");
  const [activeTransactionType, setActiveTransactionType] = useState<BookingTransactionType>(transactionType);
  const [counterpartyId, setCounterpartyId] = useState("");
  const [bookingDate, setBookingDate] = useState(localDate());
  const [ubDigits, setUbDigits] = useState("");
  const [ubNumber, setUbNumber] = useState("");
  const [ubAssigned, setUbAssigned] = useState(false);
  const [commercialSaved, setCommercialSaved] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [detailsSaved, setDetailsSaved] = useState(false);

  const [rows, setRows] = useState<PackageRowState[]>([newRow("ADULT")]);
  const [packageDescription, setPackageDescription] = useState("");
  const [departureDate, setDepartureDate] = useState("");
  const [returnDate, setReturnDate] = useState("");
  const [noOfDays, setNoOfDays] = useState("");
  const [ziaratIncluded, setZiaratIncluded] = useState<"" | "YES" | "NO">("");
  const [customerContact, setCustomerContact] = useState("");
  const [notes, setNotes] = useState("");

  const [entries, setEntries] = useState<PackageBooking[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [registerFilter, setRegisterFilter] = useState<RegisterFilter>("ALL");
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const [quickAccountOpen, setQuickAccountOpen] = useState(false);
  const [quickAccount, setQuickAccount] = useState<QuickAccountState>(blankQuickAccount);
  const [quickAccountBusy, setQuickAccountBusy] = useState(false);

  useEffect(() => { setActiveTransactionType(transactionType); }, [transactionType]);
  useEffect(() => { void loadEntries(""); }, [companyId]);

  const eligibleAccounts = useMemo(() => {
    const type = activeTransactionType === "SALE" ? "PARTY" : "VENDOR";
    return parties.filter((item) => item.status === "ACTIVE" && item.account_type === type);
  }, [parties, activeTransactionType]);

  const selectedAccount = useMemo(() => parties.find((item) => item.id === counterpartyId) || null, [parties, counterpartyId]);

  const packageTypeSuggestions = useMemo(() => {
    const values = new Set(packageTypeDefaults);
    entries.forEach((entry) => entry.lines.forEach((line) => line.package_type.trim() && values.add(line.package_type.trim())));
    return Array.from(values).sort((a, b) => a.localeCompare(b));
  }, [entries]);

  const totals = useMemo(() => {
    const qty = { ADULT: 0, CHILD: 0, INFANT: 0 };
    const amount = { ADULT: 0, CHILD: 0, INFANT: 0 };
    rows.forEach((row) => {
      qty[row.passengerType] += rowPax(row);
      amount[row.passengerType] += rowTotal(row);
    });
    return {
      qty,
      amount,
      totalPax: qty.ADULT + qty.CHILD + qty.INFANT,
      grandTotal: amount.ADULT + amount.CHILD + amount.INFANT,
    };
  }, [rows]);

  const activeEntries = entries.filter((entry) => entry.status === "ACTIVE");
  const visibleEntries = entries.filter((entry) => registerFilter === "ALL" || entry.transaction_type === registerFilter);
  const saleTotal = activeEntries.filter((entry) => entry.transaction_type === "SALE").reduce((sum, entry) => sum + Number(entry.total_pkr || 0), 0);
  const purchaseTotal = activeEntries.filter((entry) => entry.transaction_type === "PURCHASE").reduce((sum, entry) => sum + Number(entry.total_pkr || 0), 0);
  const registerPax = activeEntries.reduce((sum, entry) => sum + entry.lines.reduce((lineSum, line) => lineSum + Number(line.person_count || 0), 0), 0);
  const additionalHasData = Boolean(packageDescription.trim() || departureDate || returnDate || noOfDays || ziaratIncluded || customerContact.trim() || notes.trim());

  async function loadEntries(nextSearch = search) {
    try {
      setEntries(await getPackageBookings(companyId, nextSearch));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  function resetForm() {
    setActiveTransactionType(transactionType);
    setCounterpartyId("");
    setBookingDate(localDate());
    setUbDigits("");
    setUbNumber("");
    setUbAssigned(false);
    setCommercialSaved(false);
    setDetailsOpen(false);
    setDetailsSaved(false);
    setRows([newRow("ADULT")]);
    setPackageDescription("");
    setDepartureDate("");
    setReturnDate("");
    setNoOfDays("");
    setZiaratIncluded("");
    setCustomerContact("");
    setNotes("");
    setEditingId(null);
    setError("");
    setMessage("");
  }

  function assignUb() {
    setError("");
    setMessage("");
    if (!counterpartyId) return setError(activeTransactionType === "SALE" ? "Select a Party / Customer first." : "Select a Vendor / Supplier first.");
    if (!bookingDate) return setError("Date of Booking is required.");
    if (!ubDigits) return setError("Enter a booking number using 1 to 4 digits.");
    const formatted = ubFromDigits(ubDigits);
    const duplicate = entries.find((entry) => {
      if (normalized(entry.ub_number) !== formatted) return false;
      if (activeTransactionType === "SALE") return entry.transaction_type === "SALE";
      return entry.transaction_type === "PURCHASE" && entry.counterparty_id === counterpartyId;
    });
    if (duplicate) {
      return setError(activeTransactionType === "SALE"
        ? `${formatted} already has a Package Sale booking. Open it from Package Booking Register.`
        : `This Vendor already has a Package Purchase booking for ${formatted}. Open it from Package Booking Register.`);
    }
    setUbNumber(formatted);
    setUbAssigned(true);
    setMessage(`${formatted} is ready. Enter Package Details & Rates below and save the booking.`);
  }

  function editAssignedHeader() {
    if (commercialSaved) return;
    setUbAssigned(false);
    setMessage("");
    setError("");
  }

  function addPassengerRow(type: PackagePassengerType) {
    setRows((current) => [...current, newRow(type)]);
    setError("");
  }

  function updateRow(rowId: string, patch: Partial<PackageRowState>) {
    setRows((current) => current.map((row) => row.rowId === rowId ? { ...row, ...patch } : row));
  }

  function removeRow(rowId: string) {
    const target = rows.find((row) => row.rowId === rowId);
    if (!target) return;
    if (target.passengerType === "ADULT" && rows.filter((row) => row.passengerType === "ADULT").length === 1) {
      return setError("At least one Adult package row is required.");
    }
    setRows((current) => current.filter((row) => row.rowId !== rowId));
  }

  function buildLines(): PackageBookingLineInput[] {
    return rows.map((row) => ({
      passengerType: row.passengerType,
      passengerName: row.passengerName,
      packageType: row.packageType,
      ratePerPerson: numberValue(row.rate),
      personCount: row.count.trim() === "" ? null : explicitCount(row.count),
      qtyIsExplicit: row.count.trim() !== "",
    }));
  }

  async function saveCommercial() {
    if (!ubAssigned) return setError("Create / Assign the Booking UB first.");
    if (editingId && !canEdit) return setError("Your role does not allow editing bookings.");
    if (!editingId && !canCreate) return setError("Your role does not allow creating bookings.");
    setBusy(true);
    setError("");
    setMessage("");
    try {
      if (editingId) {
        await updatePackageCommercialBooking(companyId, editingId, { transactionDate: bookingDate, lines: buildLines() }, userId);
        setMessage(`Package Details & Rates for ${ubNumber} updated successfully.`);
      } else {
        const id = await createPackageCommercialBooking(companyId, {
          transactionType: activeTransactionType,
          counterpartyId,
          transactionDate: bookingDate,
          ubNumber,
          lines: buildLines(),
        }, userId);
        setEditingId(id);
        setCommercialSaved(true);
        setMessage(`Package booking ${ubNumber} saved successfully. Additional Package Details are now available.`);
      }
      setCommercialSaved(true);
      await loadEntries(search);
      await onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function updateDeparture(value: string) {
    setDepartureDate(value);
    const days = inclusiveDays(value, returnDate);
    if (days > 0) setNoOfDays(String(days));
  }

  function updateReturn(value: string) {
    setReturnDate(value);
    const days = inclusiveDays(departureDate, value);
    if (days > 0) setNoOfDays(String(days));
  }

  function copyPackageTypeToDetails() {
    const first = rows.find((row) => row.packageType.trim());
    if (first) setPackageDescription(first.packageType.trim());
  }

  async function saveAdditionalDetails() {
    if (!editingId || !commercialSaved) return setError("Save Package Details & Rates before adding optional booking details.");
    if (!canEdit) return setError("Your role does not allow editing booking details.");
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await updatePackageAdditionalDetails(companyId, editingId, {
        packageDescription,
        departureDate,
        returnDate,
        noOfDays: Math.max(0, Math.trunc(numberValue(noOfDays))),
        ziaratIncluded,
        customerContact,
        notes,
      }, userId);
      setDetailsSaved(true);
      setMessage(`Additional Package Details for ${ubNumber} saved successfully.`);
      await loadEntries(search);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function openQuickAccount() {
    if (!(canCreate || canEdit)) return setError("Your role does not allow creating Party / Vendor accounts from this booking.");
    setQuickAccount(blankQuickAccount);
    setQuickAccountOpen(true);
    setError("");
  }

  async function saveQuickAccount() {
    if (!quickAccount.name.trim()) return setError(`${activeTransactionType === "SALE" ? "Party" : "Vendor"} name is required.`);
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

  function editEntry(entry: PackageBooking) {
    if (!canEdit || entry.status !== "ACTIVE") return;
    setActiveTransactionType(entry.transaction_type);
    setCounterpartyId(entry.counterparty_id);
    setBookingDate(entry.transaction_date);
    setUbNumber(entry.ub_number);
    setUbDigits(digitsFromUb(entry.ub_number));
    setUbAssigned(true);
    setCommercialSaved(true);
    setDetailsOpen(false);
    setDetailsSaved(Boolean(entry.package_description || entry.departure_date || entry.return_date || entry.no_of_days || entry.ziarat_included || entry.customer_contact || entry.notes));
    setPackageDescription(entry.package_description || "");
    setDepartureDate(entry.departure_date || "");
    setReturnDate(entry.return_date || "");
    setNoOfDays(entry.no_of_days ? String(entry.no_of_days) : "");
    setZiaratIncluded(entry.ziarat_included === "YES" || entry.ziarat_included === "NO" ? entry.ziarat_included : "");
    setCustomerContact(entry.customer_contact || "");
    setNotes(entry.notes || "");
    setRows(entry.lines.length ? entry.lines.map((line) => ({
      rowId: crypto.randomUUID(),
      passengerType: line.passenger_type,
      passengerName: line.passenger_name || "",
      packageType: line.package_type,
      rate: String(line.rate_per_person),
      count: Number(line.qty_is_explicit) === 0 ? "" : String(line.person_count),
    })) : [newRow("ADULT")]);
    setEditingId(entry.id);
    setMode("FORM");
    setError("");
    setMessage(`Editing Package booking ${entry.ub_number}. Booking identity is locked; rates and optional details can be updated independently.`);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function voidEntry(entry: PackageBooking) {
    if (!canVoid || entry.status !== "ACTIVE" || busy) return;
    if (!window.confirm(`Void Package booking ${entry.ub_number}? The audit record will remain in the Package Booking Register.`)) return;
    setBusy(true);
    setError("");
    try {
      await voidPackageBooking(companyId, entry.id, userId);
      await loadEntries(search);
      await onChanged?.();
      if (editingId === entry.id) resetForm();
      setMessage(`Package booking ${entry.ub_number} voided.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function renderPassengerSection(type: PackagePassengerType) {
    const items = rows.filter((row) => row.passengerType === type);
    const label = type === "ADULT" ? "ADULTS" : type === "CHILD" ? "CHILDREN" : "INFANTS";
    const button = type === "ADULT" ? "+ Add Adult" : type === "CHILD" ? "+ Add Child" : "+ Add Infant";
    return (
      <section className={`package14-passenger-group ${type.toLowerCase()}`}>
        <div className="package14-passenger-head"><div><b>{label}</b><small>{type === "ADULT" ? "Required" : "Optional"}</small></div><button type="button" onClick={() => addPassengerRow(type)} disabled={editingId ? !canEdit : !canCreate}>{button}</button></div>
        {items.length ? items.map((row, index) => {
          const passengerLabel = row.passengerType === "ADULT" ? "Adult" : row.passengerType === "CHILD" ? "Child" : "Infant";
          return <div className="package14-rate-row" key={row.rowId}>
            <span className="package14-sr">{index + 1}</span>
            <label>Passenger / Family Head *<input value={row.passengerName} onChange={(e) => updateRow(row.rowId, { passengerName: e.target.value })} placeholder="Passenger or family head" /></label>
            <label>Package Type *<input list="package14-type-options" value={row.packageType} onChange={(e) => updateRow(row.rowId, { packageType: e.target.value })} placeholder="e.g. Full Umrah Package" /></label>
            <label>Rate / {passengerLabel} (PKR) *<input type="number" min="0" step="0.01" value={row.rate} onChange={(e) => updateRow(row.rowId, { rate: e.target.value })} placeholder="0" /></label>
            <label>Qty <small>(blank = 1)</small><input type="number" min="1" step="1" value={row.count} onChange={(e) => updateRow(row.rowId, { count: e.target.value })} placeholder="1" /></label>
            <div className="package14-subtotal"><small>SUB TOTAL</small><b>{money(rowTotal(row))}</b></div>
            <button type="button" className="package14-remove" onClick={() => removeRow(row.rowId)} aria-label="Remove Package row">×</button>
          </div>;
        }) : <div className="package14-empty-row">No {label.toLowerCase()} added.</div>}
      </section>
    );
  }

  function renderForm() {
    const previewUb = ubFromDigits(ubDigits);
    const accountNoun = activeTransactionType === "SALE" ? "Party / Customer" : "Vendor / Supplier";
    return (
      <section className="booking-entry-screen package14-page">
        <div className="booking-screen-toolbar package14-toolbar">
          <button type="button" className="booking-back-button" onClick={onBack}>← Back to Booking Services</button>
          <div className="package14-toolbar-right">
            <span className={`direction-badge ${activeTransactionType === "SALE" ? "sale" : "purchase"}`}>{activeTransactionType === "SALE" ? "SALE TO PARTY" : "PURCHASE FROM VENDOR / SUPPLIER"}</span>
            <button type="button" className="package-register-button" onClick={() => { setMode("REGISTER"); setError(""); setMessage(""); void loadEntries(search); }}>Package Booking Register</button>
          </div>
        </div>

        <div className="package14-title"><div><span className="eyebrow blue">PACKAGE BOOKING</span><h2>{commercialSaved ? `Package Booking — ${ubNumber}` : "New Package Booking"}</h2><p>Create the booking identity first, then save the accounting Package details. Optional travel information stays separate.</p></div></div>
        {message && <div className="alert success">{message}</div>}
        {error && <div className="alert error">{error}</div>}

        {!ubAssigned ? (
          <section className="package14-identity">
            <div className="package14-section-heading"><span>01</span><div><b>CREATE / ASSIGN BOOKING UB</b><small>Select the account, booking date and a 1–4 digit booking number.</small></div></div>
            <div className="package14-identity-grid">
              <label className="package14-account-field">{accountNoun} *
                <div className="package14-account-select"><select value={counterpartyId} onChange={(e) => setCounterpartyId(e.target.value)}><option value="">Select {accountNoun}</option>{eligibleAccounts.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><button type="button" onClick={openQuickAccount}>+ Create {activeTransactionType === "SALE" ? "Party" : "Vendor"}</button></div>
                <small>Quick-create keeps you inside this booking screen.</small>
              </label>
              <label>Date of Booking *<input type="date" value={bookingDate} onChange={(e) => setBookingDate(e.target.value)} /><small>Accounting date for the Package booking.</small></label>
              <label>Booking Number *
                <div className="package14-ub-input"><span>UB-</span><input inputMode="numeric" maxLength={4} value={ubDigits} onChange={(e) => setUbDigits(cleanDigits(e.target.value))} placeholder="1234" /></div>
                <small>Numbers only, maximum 4 digits. Example: 7 becomes UB-0007.</small>
              </label>
            </div>
            <div className="package14-ub-preview"><div><small>BOOKING UB PREVIEW</small><b>{previewUb || "UB-0000"}</b><span>{previewUb ? "Ready to create / assign" : "Enter a booking number"}</span></div><button type="button" className="primary" onClick={assignUb}>Create / Assign {previewUb || "UB"}</button></div>
          </section>
        ) : (
          <section className={`package14-identity-complete ${commercialSaved ? "saved" : "ready"}`}>
            <span className="package14-check">✓</span>
            <div className="package14-identity-main"><small>{commercialSaved ? "PACKAGE BOOKING SAVED" : "BOOKING UB READY"}</small><b>{ubNumber}</b><span>{selectedAccount?.name || accountNoun}</span></div>
            <div><small>BOOKING DATE</small><b>{bookingDate}</b></div>
            <div><small>TRANSACTION</small><b>{activeTransactionType}</b></div>
            <div><small>STATUS</small><b>{commercialSaved ? "ACTIVE" : "READY"}</b></div>
            {!commercialSaved ? <button type="button" className="secondary" onClick={editAssignedHeader}>Edit Booking Header</button> : <span className="package14-lock">Identity locked after save</span>}
          </section>
        )}

        {ubAssigned && (
          <section className="package14-commercial-card">
            <div className="package14-section-heading"><span>02</span><div><b>PACKAGE DETAILS & RATES</b><small>Commercial / accounting data saved under {ubNumber}.</small></div></div>
            <datalist id="package14-type-options">{packageTypeSuggestions.map((item) => <option key={item} value={item} />)}</datalist>
            <div className="package14-passenger-stack">{renderPassengerSection("ADULT")}{renderPassengerSection("CHILD")}{renderPassengerSection("INFANT")}</div>

            <div className="package14-summary">
              <div className="package14-summary-title"><span>PACKAGE BOOKING SUMMARY</span><small>Part of Section 02 — these totals form the Package accounting value.</small></div>
              <div className="package14-summary-body">
                <div className="package14-breakdown">
                  <div><span>Adults</span><b>{totals.qty.ADULT}</b><strong>{money(totals.amount.ADULT)}</strong></div>
                  <div><span>Children</span><b>{totals.qty.CHILD}</b><strong>{money(totals.amount.CHILD)}</strong></div>
                  <div><span>Infants</span><b>{totals.qty.INFANT}</b><strong>{money(totals.amount.INFANT)}</strong></div>
                </div>
                <div className="package14-grand"><div><small>TOTAL PAX</small><b>{totals.totalPax}</b></div><div><small>GRAND PACKAGE TOTAL</small><strong>{money(totals.grandTotal)}</strong></div></div>
              </div>
            </div>

            <div className="package14-commercial-actions">
              {commercialSaved && <button type="button" className="secondary" onClick={resetForm}>+ New Package Booking</button>}
              {((editingId && canEdit) || (!editingId && canCreate)) && <button type="button" className="primary package14-save" disabled={busy} onClick={() => void saveCommercial()}>{busy ? "Saving..." : editingId ? `Update Package Details & Rates — ${ubNumber}` : `Save Package Booking — ${ubNumber}`}</button>}
            </div>
          </section>
        )}

        {commercialSaved && (
          <section className={`package14-additional ${detailsOpen ? "open" : "closed"}`}>
            <button type="button" className="package14-additional-toggle" onClick={() => setDetailsOpen((value) => !value)}>
              <span className="package14-step-purple">03</span>
              <div><b>ADDITIONAL PACKAGE DETAILS — {ubNumber}</b><small>Optional travel information. This section does not change Package calculations or accounting totals.</small></div>
              <span className="package14-optional">OPTIONAL</span>
              <strong>{detailsOpen ? "Close Details ▲" : `${additionalHasData || detailsSaved ? "View / Edit" : "+ Open Details"} ▼`}</strong>
            </button>
            {detailsOpen && (
              <div className="package14-additional-body">
                <div className="package14-details-grid">
                  <label className="wide">Package / Travel Description<div className="package14-copy"><input value={packageDescription} onChange={(e) => setPackageDescription(e.target.value)} placeholder="e.g. 20 Days Economy Full Umrah Package" /><button type="button" onClick={copyPackageTypeToDetails}>Use Package Type</button></div></label>
                  <label>Travel Start / Departure<input type="date" value={departureDate} onChange={(e) => updateDeparture(e.target.value)} /></label>
                  <label>Travel End / Return<input type="date" value={returnDate} onChange={(e) => updateReturn(e.target.value)} /></label>
                  <label>No. of Days<input type="number" min="0" step="1" value={noOfDays} onChange={(e) => setNoOfDays(e.target.value)} placeholder="Auto / editable" /><small>Auto-calculated when both travel dates are available.</small></label>
                  <fieldset><legend>Ziarat Included?</legend><label><input type="radio" name="package14-ziarat" checked={ziaratIncluded === "YES"} onChange={() => setZiaratIncluded("YES")} /> Yes</label><label><input type="radio" name="package14-ziarat" checked={ziaratIncluded === "NO"} onChange={() => setZiaratIncluded("NO")} /> No</label><button type="button" onClick={() => setZiaratIncluded("")}>Clear</button></fieldset>
                  <label>Customer / Traveller Contact<input value={customerContact} onChange={(e) => setCustomerContact(e.target.value)} placeholder="Customer, family or traveller contact" /></label>
                  <label className="wide">Special Instructions / Internal Notes<textarea rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Travel instructions, customer requirements, internal remarks or other Package notes..." /></label>
                </div>
                <div className="package14-details-actions"><span>{detailsSaved ? "✓ Additional details saved" : "You can leave this section blank and complete it later."}</span>{canEdit && <button type="button" className="primary" disabled={busy} onClick={() => void saveAdditionalDetails()}>{busy ? "Saving..." : `Save Additional Details — ${ubNumber}`}</button>}</div>
              </div>
            )}
          </section>
        )}

        {!ubAssigned && <div className="package14-next-step">Create / Assign a Booking UB to unlock Package Details & Rates.</div>}
        {ubAssigned && !commercialSaved && <div className="package14-next-step">Save Section 02 to activate the Package booking and unlock Optional Additional Package Details.</div>}

        {quickAccountOpen && (
          <div className="modal-backdrop package14-modal-backdrop" onMouseDown={(e) => e.currentTarget === e.target && setQuickAccountOpen(false)}>
            <section className="modal-card package14-quick-modal" onMouseDown={(e) => e.stopPropagation()}>
              <button type="button" className="close-btn" onClick={() => setQuickAccountOpen(false)}>×</button>
              <span className="eyebrow blue">QUICK ACCOUNT</span>
              <h2>Create {activeTransactionType === "SALE" ? "Party / Customer" : "Vendor / Supplier"}</h2>
              <p>Create the account without leaving the Package booking. It will be selected automatically.</p>
              <div className="package14-quick-grid">
                <label>Name *<input autoFocus value={quickAccount.name} onChange={(e) => setQuickAccount((v) => ({ ...v, name: e.target.value }))} /></label>
                <label>Phone<input value={quickAccount.phone} onChange={(e) => setQuickAccount((v) => ({ ...v, phone: e.target.value }))} /></label>
                <label>WhatsApp<input value={quickAccount.whatsapp} onChange={(e) => setQuickAccount((v) => ({ ...v, whatsapp: e.target.value }))} /></label>
                <label>Address<input value={quickAccount.address} onChange={(e) => setQuickAccount((v) => ({ ...v, address: e.target.value }))} /></label>
                <label className="wide">Notes<textarea rows={3} value={quickAccount.notes} onChange={(e) => setQuickAccount((v) => ({ ...v, notes: e.target.value }))} /></label>
              </div>
              <div className="package14-modal-actions"><button type="button" className="secondary" onClick={() => setQuickAccountOpen(false)}>Cancel</button><button type="button" className="primary" disabled={quickAccountBusy} onClick={() => void saveQuickAccount()}>{quickAccountBusy ? "Creating..." : `Create ${activeTransactionType === "SALE" ? "Party" : "Vendor"}`}</button></div>
            </section>
          </div>
        )}
      </section>
    );
  }

  function renderRegister() {
    return (
      <section className="booking-entry-screen package14-page package14-register-page">
        <div className="booking-screen-toolbar package14-toolbar"><button type="button" className="booking-back-button" onClick={() => { setMode("FORM"); setError(""); }}>← Back to Package Booking</button><span className="booking-foundation-badge active-engine">PACKAGE REGISTER</span></div>
        <div className="package14-register-title"><div><span className="eyebrow blue">PACKAGE BOOKING REGISTER</span><h2>Package Booking Register</h2><p>Package Sale and Purchase bookings remain searchable by UB, account, passenger and Package Type.</p></div><div className="package14-register-stats"><div><small>ACTIVE</small><b>{activeEntries.length}</b></div><div><small>SALES</small><b>{money(saleTotal)}</b></div><div><small>PURCHASES</small><b>{money(purchaseTotal)}</b></div><div><small>PAX</small><b>{registerPax}</b></div></div></div>
        {message && <div className="alert success">{message}</div>}{error && <div className="alert error">{error}</div>}
        <div className="package14-register-controls"><div className="package-register-filter-tabs">{(["ALL", "SALE", "PURCHASE"] as RegisterFilter[]).map((item) => <button type="button" key={item} className={registerFilter === item ? "active" : ""} onClick={() => setRegisterFilter(item)}>{item === "ALL" ? "All Package Bookings" : item === "SALE" ? "Sales" : "Purchases"}</button>)}</div><div className="search-box package-search"><span>⌕</span><input value={search} onChange={(e) => { setSearch(e.target.value); void loadEntries(e.target.value); }} placeholder="Search UB, Party/Vendor, Passenger, Package Type, contact or notes..." /></div></div>
        {visibleEntries.length === 0 ? <div className="empty-state compact-empty"><div className="empty-icon">PKG</div><h3>No Package bookings found</h3><p>Create a Package booking or change the filter/search.</p></div> : (
          <div className="party-table-wrap package14-register-wrap"><table className="party-table package14-register-table"><thead><tr><th>DATE</th><th>UB #</th><th>TYPE</th><th>PARTY / VENDOR</th><th>PACKAGE ROWS</th><th>PAX</th><th>TOTAL PKR</th><th>DETAILS</th><th>STATUS</th><th>ACTIONS</th></tr></thead><tbody>{visibleEntries.map((entry) => {
            const pax = entry.lines.reduce((sum, line) => sum + Number(line.person_count || 0), 0);
            const hasDetails = Boolean(entry.package_description || entry.departure_date || entry.return_date || entry.no_of_days || entry.ziarat_included || entry.customer_contact || entry.notes);
            return <tr key={entry.id} className={entry.status === "VOID" ? "void-row" : ""}><td>{entry.transaction_date}</td><td><b>{entry.ub_number}</b></td><td><span className={`direction-badge ${entry.transaction_type === "SALE" ? "sale" : "purchase"}`}>{entry.transaction_type}</span></td><td><b>{entry.counterparty_name || "—"}</b></td><td><div className="package14-register-lines">{entry.lines.map((line) => <div key={line.id}><span className={`passenger-chip ${line.passenger_type.toLowerCase()}`}>{line.passenger_type}</span><b>{line.passenger_name}</b><span>{line.package_type}</span><small>{line.person_count} × {money(line.rate_per_person)} = {money(line.line_total_pkr)}</small></div>)}</div></td><td><b>{pax}</b></td><td className="amount"><b>{money(entry.total_pkr)}</b></td><td><span className={`package14-detail-status ${hasDetails ? "complete" : "optional"}`}>{hasDetails ? "Added" : "Optional"}</span></td><td><span className={`status ${entry.status.toLowerCase()}`}>{entry.status}</span></td><td><div className="row-actions"><button type="button" disabled={!canEdit || entry.status !== "ACTIVE" || busy} onClick={() => editEntry(entry)}>Edit</button><button type="button" disabled={!canVoid || entry.status !== "ACTIVE" || busy} onClick={() => void voidEntry(entry)}>Void</button></div></td></tr>;
          })}</tbody></table></div>
        )}
      </section>
    );
  }

  return mode === "REGISTER" ? renderRegister() : renderForm();
}
