import { useEffect, useMemo, useState } from "react";
import TicketBookingModule from "./TicketBooking";
import HotelBookingModule from "./HotelBooking";
import VisaBookingModule from "./VisaBooking";
import TransportBookingModule from "./TransportBooking";
import MiscBookingModule from "./MiscBooking";
import {
  BookingTransactionType,
  PackageBooking,
  PackageBookingLineInput,
  PackagePassengerType,
  Party,
  createPackageBooking,
  getPackageBookings,
  updatePackageBooking,
  voidPackageBooking,
} from "./db";

type BookingService = "PACKAGE" | "TICKET" | "HOTEL" | "VISA" | "TRANSPORT" | "MISC";
type BookingScreen = "DIRECTION" | "SERVICES" | "SERVICE_FORM" | "PACKAGE_REGISTER";
type RegisterTypeFilter = "ALL" | BookingTransactionType;

type Props = {
  companyId: string;
  parties: Party[];
  userId?: string;
  canCreate?: boolean;
  canEdit?: boolean;
  canVoid?: boolean;
  onChanged?: () => void | Promise<void>;
};

type PackageRowState = {
  rowId: string;
  passengerType: PackagePassengerType;
  passengerName: string;
  packageType: string;
  rate: string;
  count: string;
};

const serviceCards: Array<{ key: BookingService; title: string; subtitle: string }> = [
  { key: "PACKAGE", title: "Package", subtitle: "Umrah package booking" },
  { key: "TICKET", title: "Ticket", subtitle: "Air ticket booking" },
  { key: "HOTEL", title: "Hotel", subtitle: "Hotel accommodation" },
  { key: "VISA", title: "Visa", subtitle: "Visa services" },
  { key: "TRANSPORT", title: "Transport", subtitle: "Transport services" },
  { key: "MISC", title: "Misc", subtitle: "General-purpose per-person services" },
];

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

function newPackageRow(passengerType: PackagePassengerType): PackageRowState {
  return {
    rowId: crypto.randomUUID(),
    passengerType,
    passengerName: "",
    packageType: "",
    rate: "",
    count: "",
  };
}

function localDate() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function money(value: number) {
  return `Rs ${Number(value || 0).toLocaleString("en-PK", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })}`;
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

function inclusiveDays(from: string, to: string) {
  if (!from || !to || to < from) return 0;
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  const start = Date.UTC(fy, fm - 1, fd);
  const end = Date.UTC(ty, tm - 1, td);
  return Math.floor((end - start) / 86400000) + 1;
}

function ServiceIcon({ service }: { service: BookingService }) {
  const common = {
    width: 34,
    height: 34,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };

  if (service === "PACKAGE") {
    return <svg {...common}><rect x="5" y="7" width="14" height="12" rx="2" /><path d="M9 7V5.8A1.8 1.8 0 0 1 10.8 4h2.4A1.8 1.8 0 0 1 15 5.8V7" /><path d="M5 11h14M9 11v2M15 11v2" /></svg>;
  }
  if (service === "TICKET") {
    return <svg {...common}><path d="M4 8.5A2.5 2.5 0 0 0 6.5 6h11.2A1.3 1.3 0 0 1 19 7.3V10a2 2 0 0 0 0 4v2.7a1.3 1.3 0 0 1-1.3 1.3H6.5A2.5 2.5 0 0 0 4 15.5z" /><path d="M13 8.5v1M13 12v1M13 15.5v1" /></svg>;
  }
  if (service === "HOTEL") {
    return <svg {...common}><path d="M5 20V5.5A1.5 1.5 0 0 1 6.5 4h8A1.5 1.5 0 0 1 16 5.5V20" /><path d="M16 9h2.5A1.5 1.5 0 0 1 20 10.5V20M3 20h18" /><path d="M8 8h2M8 11h2M8 14h2M13 8h1M13 11h1M13 14h1" /></svg>;
  }
  if (service === "VISA") {
    return <svg {...common}><rect x="5" y="3" width="14" height="18" rx="2" /><circle cx="12" cy="10" r="3" /><path d="M9 17h6M8 6h8" /></svg>;
  }
  if (service === "TRANSPORT") {
    return <svg {...common}><rect x="4" y="5" width="16" height="13" rx="3" /><path d="M7 18v2M17 18v2M4 13h16M7 8h4M14 8h3" /><circle cx="8" cy="16" r="1" /><circle cx="16" cy="16" r="1" /></svg>;
  }
  return <svg {...common}><circle cx="6" cy="12" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="18" cy="12" r="1.5" /></svg>;
}

export default function BookingsModule({ companyId, parties, userId = "", canCreate = true, canEdit = true, canVoid = true, onChanged }: Props) {
  const [screen, setScreen] = useState<BookingScreen>("DIRECTION");
  const [transactionType, setTransactionType] = useState<BookingTransactionType | null>(null);
  const [service, setService] = useState<BookingService | null>(null);
  const [counterpartyId, setCounterpartyId] = useState("");

  const [packageDate, setPackageDate] = useState(localDate());
  const [ubNumber, setUbNumber] = useState("");
  const [packageRows, setPackageRows] = useState<PackageRowState[]>([newPackageRow("ADULT")]);
  const [packageDescription, setPackageDescription] = useState("");
  const [departureDate, setDepartureDate] = useState("");
  const [returnDate, setReturnDate] = useState("");
  const [noOfDays, setNoOfDays] = useState("");
  const [ziaratIncluded, setZiaratIncluded] = useState<"" | "YES" | "NO">("");
  const [customerContact, setCustomerContact] = useState("");
  const [notes, setNotes] = useState("");

  const [entries, setEntries] = useState<PackageBooking[]>([]);
  const [search, setSearch] = useState("");
  const [registerType, setRegisterType] = useState<RegisterTypeFilter>("ALL");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const eligibleAccounts = useMemo(() => {
    if (!transactionType) return [];
    const wanted = transactionType === "SALE" ? "PARTY" : "VENDOR";
    return parties.filter((item) => item.status === "ACTIVE" && item.account_type === wanted);
  }, [parties, transactionType]);

  const packageTypeSuggestions = useMemo(() => {
    const values = new Set<string>(packageTypeDefaults);
    for (const entry of entries) {
      for (const line of entry.lines) if (line.package_type.trim()) values.add(line.package_type.trim());
    }
    return Array.from(values).sort((a, b) => a.localeCompare(b));
  }, [entries]);

  const passengerTotals = useMemo(() => {
    const totals = { ADULT: 0, CHILD: 0, INFANT: 0 };
    for (const row of packageRows) totals[row.passengerType] += rowPax(row);
    return totals;
  }, [packageRows]);

  const passengerSubtotals = useMemo(() => {
    const totals = { ADULT: 0, CHILD: 0, INFANT: 0 };
    for (const row of packageRows) totals[row.passengerType] += rowTotal(row);
    return totals;
  }, [packageRows]);

  const totalPax = passengerTotals.ADULT + passengerTotals.CHILD + passengerTotals.INFANT;
  const grandTotal = passengerSubtotals.ADULT + passengerSubtotals.CHILD + passengerSubtotals.INFANT;
  const activeEntries = entries.filter((entry) => entry.status === "ACTIVE");
  const activeSaleTotal = activeEntries.filter((entry) => entry.transaction_type === "SALE").reduce((sum, entry) => sum + Number(entry.total_pkr || 0), 0);
  const activePurchaseTotal = activeEntries.filter((entry) => entry.transaction_type === "PURCHASE").reduce((sum, entry) => sum + Number(entry.total_pkr || 0), 0);
  const activePax = activeEntries.reduce((sum, entry) => sum + entry.lines.reduce((lineSum, line) => lineSum + Number(line.person_count || 0), 0), 0);
  const visibleRegisterEntries = entries.filter((entry) => registerType === "ALL" || entry.transaction_type === registerType);

  useEffect(() => { void loadPackages(""); }, [companyId]);

  async function loadPackages(nextSearch = search) {
    try {
      setEntries(await getPackageBookings(companyId, nextSearch));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  function resetPackageForm(options?: { keepDirection?: boolean; keepService?: boolean }) {
    const keepDirection = options?.keepDirection ?? true;
    const keepService = options?.keepService ?? true;
    if (!keepDirection) setTransactionType(null);
    if (!keepService) setService(null);
    setCounterpartyId("");
    setPackageDate(localDate());
    setUbNumber("");
    setPackageRows([newPackageRow("ADULT")]);
    setPackageDescription("");
    setDepartureDate("");
    setReturnDate("");
    setNoOfDays("");
    setZiaratIncluded("");
    setCustomerContact("");
    setNotes("");
    setEditingId(null);
    setError("");
  }

  function chooseDirection(next: BookingTransactionType) {
    resetPackageForm({ keepDirection: false, keepService: false });
    setTransactionType(next);
    setService(null);
    setMessage("");
    setScreen("SERVICES");
  }

  function chooseService(next: BookingService) {
    setService(next);
    setCounterpartyId("");
    setEditingId(null);
    setMessage("");
    setError("");
    if (next === "PACKAGE") resetPackageForm({ keepDirection: true, keepService: true });
    setScreen("SERVICE_FORM");
  }

  function backToDirections() {
    resetPackageForm({ keepDirection: false, keepService: false });
    setMessage("");
    setScreen("DIRECTION");
  }

  function backToServices() {
    resetPackageForm({ keepDirection: true, keepService: false });
    setMessage("");
    setScreen("SERVICES");
  }

  function addPassengerRow(passengerType: PackagePassengerType) {
    setPackageRows((current) => [...current, newPackageRow(passengerType)]);
    setError("");
  }

  function updatePackageRow(rowId: string, key: "passengerName" | "packageType" | "rate" | "count", value: string) {
    setPackageRows((current) => current.map((row) => row.rowId === rowId ? { ...row, [key]: value } : row));
  }

  function removePackageRow(rowId: string) {
    const row = packageRows.find((item) => item.rowId === rowId);
    if (!row) return;
    if (row.passengerType === "ADULT" && packageRows.filter((item) => item.passengerType === "ADULT").length === 1) {
      setError("At least one Adult package row is required.");
      return;
    }
    setPackageRows((current) => current.filter((item) => item.rowId !== rowId));
    setError("");
  }

  function buildLines(): PackageBookingLineInput[] {
    return packageRows.map((row) => ({
      passengerType: row.passengerType,
      passengerName: row.passengerName,
      packageType: row.packageType,
      ratePerPerson: numberValue(row.rate),
      personCount: row.count.trim() === "" ? null : explicitCount(row.count),
      qtyIsExplicit: row.count.trim() !== "",
    }));
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
    const first = packageRows.find((row) => row.packageType.trim());
    if (first) setPackageDescription(first.packageType.trim());
  }

  async function savePackage() {
    if (editingId && !canEdit) return setError("Your role does not allow editing bookings.");
    if (!editingId && !canCreate) return setError("Your role does not allow creating bookings.");
    if (!transactionType) return setError("Choose Sale to Party or Purchase from Vendor first.");
    if (!counterpartyId) return setError(transactionType === "SALE" ? "Select a Party." : "Select a Vendor / Supplier.");

    setBusy(true);
    setError("");
    setMessage("");
    try {
      const input = {
        transactionType,
        counterpartyId,
        transactionDate: packageDate,
        ubNumber,
        packageDescription,
        departureDate,
        returnDate,
        noOfDays: Math.max(0, Math.trunc(numberValue(noOfDays))),
        ziaratIncluded,
        customerContact,
        notes,
        lines: buildLines(),
      };

      if (editingId) {
        await updatePackageBooking(companyId, editingId, input, userId);
        setMessage(`Package booking ${ubNumber.trim()} updated successfully.`);
      } else {
        await createPackageBooking(companyId, input, userId);
        setMessage(`Package booking ${ubNumber.trim()} saved successfully.`);
      }

      resetPackageForm({ keepDirection: true, keepService: true });
      await loadPackages(search);
      await onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function editPackage(entry: PackageBooking) {
    if (!canEdit) { setError("Your role has read-only access to bookings."); return; }
    if (entry.status !== "ACTIVE") return;
    setTransactionType(entry.transaction_type);
    setService("PACKAGE");
    setCounterpartyId(entry.counterparty_id);
    setPackageDate(entry.transaction_date);
    setUbNumber(entry.ub_number);
    setPackageDescription(entry.package_description || "");
    setDepartureDate(entry.departure_date || "");
    setReturnDate(entry.return_date || "");
    setNoOfDays(entry.no_of_days ? String(entry.no_of_days) : "");
    setZiaratIncluded(entry.ziarat_included === "YES" || entry.ziarat_included === "NO" ? entry.ziarat_included : "");
    setCustomerContact(entry.customer_contact || "");
    setNotes(entry.notes || "");
    setPackageRows(entry.lines.length ? entry.lines.map((line) => ({
      rowId: crypto.randomUUID(),
      passengerType: line.passenger_type,
      passengerName: line.passenger_name || "",
      packageType: line.package_type,
      rate: String(line.rate_per_person),
      count: Number(line.qty_is_explicit) === 0 ? "" : String(line.person_count),
    })) : [newPackageRow("ADULT")]);
    setEditingId(entry.id);
    setError("");
    setMessage(`Editing package booking ${entry.ub_number}.`);
    setScreen("SERVICE_FORM");
  }

  async function voidPackage(entry: PackageBooking) {
    if (!canVoid) { setError("Your role does not allow voiding bookings."); return; }
    if (entry.status !== "ACTIVE") return;
    if (!window.confirm(`Void package booking ${entry.ub_number}? The record will remain in the Package Booking Register.`)) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await voidPackageBooking(companyId, entry.id, userId);
      if (editingId === entry.id) resetPackageForm({ keepDirection: true, keepService: true });
      setMessage(`Package booking ${entry.ub_number} was voided.`);
      await loadPackages(search);
      await onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function changeSearch(value: string) {
    setSearch(value);
    await loadPackages(value);
  }

  function renderDirectionScreen() {
    return (
      <section className="booking-entry-screen booking-direction-screen">
        <div className="booking-screen-heading centered-heading">
          <span className="eyebrow blue">BOOKINGS</span>
          <h2>What type of transaction are you entering?</h2>
          <p>Choose the accounting direction first. The next screen will show the booking services.</p>
        </div>
        <div className="booking-direction-grid">
          <button type="button" className="booking-direction-card sale" onClick={() => chooseDirection("SALE")}>
            <span className="direction-card-icon" aria-hidden="true">↗</span>
            <div><small>SALE</small><b>Sale to Party</b><p>Create a booking sold to a Party / customer account.</p></div>
            <span className="direction-arrow">→</span>
          </button>
          <button type="button" className="booking-direction-card purchase" onClick={() => chooseDirection("PURCHASE")}>
            <span className="direction-card-icon" aria-hidden="true">↙</span>
            <div><small>PURCHASE</small><b>Purchase from Vendor / Supplier</b><p>Record a booking purchased from a Vendor / supplier account.</p></div>
            <span className="direction-arrow">→</span>
          </button>
        </div>
      </section>
    );
  }

  function renderServicesScreen() {
    if (!transactionType) return renderDirectionScreen();
    return (
      <section className="booking-entry-screen booking-services-screen">
        <div className="booking-screen-toolbar">
          <button type="button" className="booking-back-button" onClick={backToDirections}>← Change Transaction Type</button>
          <span className={`direction-badge ${transactionType === "SALE" ? "sale" : "purchase"}`}>{transactionType === "SALE" ? "SALE TO PARTY" : "PURCHASE FROM VENDOR / SUPPLIER"}</span>
        </div>
        <div className="booking-screen-heading">
          <span className="eyebrow blue">SELECT BOOKING SERVICE</span>
          <h2>{transactionType === "SALE" ? "Sale to Party" : "Purchase from Vendor / Supplier"}</h2>
          <p>Select the type of booking you want to enter.</p>
        </div>
        <div className="booking-service-tile-grid">
          {serviceCards.map((item) => (
            <button type="button" className={`booking-service-tile service-${item.key.toLowerCase()}`} key={item.key} onClick={() => chooseService(item.key)}>
              <span className="booking-service-icon"><ServiceIcon service={item.key} /></span>
              <b>{item.title}</b><small>{item.subtitle}</small>
              <span className="booking-service-status live">LIVE</span>
            </button>
          ))}
        </div>
      </section>
    );
  }

  function renderPassengerRow(row: PackageRowState, index: number) {
    const passengerLabel = row.passengerType === "ADULT" ? "Adult" : row.passengerType === "CHILD" ? "Child" : "Infant";
    return (
      <div className={`package7d-row package-${row.passengerType.toLowerCase()}`} key={row.rowId}>
        <div className="package7d-row-number">{index + 1}</div>
        <label className="package7d-passenger-name">Passenger Name *<input value={row.passengerName} onChange={(e) => updatePackageRow(row.rowId, "passengerName", e.target.value)} placeholder={row.count.trim() ? "Family head / group name" : `${passengerLabel} passenger name`} /></label>
        <label className="package7d-type">Package Type *<input list="package-type-options" value={row.packageType} onChange={(e) => updatePackageRow(row.rowId, "packageType", e.target.value)} placeholder="e.g. Full Umrah Package" /></label>
        <label>Rate Per {passengerLabel} (PKR) *<input type="number" min="0" step="0.01" value={row.rate} onChange={(e) => updatePackageRow(row.rowId, "rate", e.target.value)} placeholder="0" /></label>
        <label>Qty (Optional)<input type="number" min="1" step="1" value={row.count} onChange={(e) => updatePackageRow(row.rowId, "count", e.target.value)} placeholder="Blank = 1" /></label>
        <div className="package7d-subtotal"><small>SUB TOTAL (PKR)</small><b>{money(rowTotal(row))}</b></div>
        <button type="button" className="package-remove-row" disabled={!(editingId ? canEdit : canCreate)} onClick={() => removePackageRow(row.rowId)} title="Remove row" aria-label="Remove package row">×</button>
      </div>
    );
  }

  function renderPassengerSection(type: PackagePassengerType) {
    const rows = packageRows.filter((row) => row.passengerType === type);
    const canWrite = editingId ? canEdit : canCreate;
    const label = type === "ADULT" ? "ADULTS" : type === "CHILD" ? "CHILDREN" : "INFANTS";
    const buttonLabel = type === "ADULT" ? "+ Add Adult Row" : type === "CHILD" ? "+ Add Child Row" : "+ Add Infant Row";
    return (
      <section className={`package7d-passenger-section ${type.toLowerCase()}`}>
        <div className="package7d-section-head"><div><b>{label}</b><span>{type === "ADULT" ? "Required" : "Optional"}</span></div><button type="button" disabled={!canWrite} onClick={() => addPassengerRow(type)}>{buttonLabel}</button></div>
        {rows.length ? <div className="package7d-rows">{rows.map((row, index) => renderPassengerRow(row, index))}</div> : <div className="package7d-empty-row">No {label.toLowerCase()} rows added. Use the button above when needed.</div>}
      </section>
    );
  }

  function renderPackageForm() {
    if (!transactionType) return renderDirectionScreen();
    return (
      <section className="booking-entry-screen package-service-screen package7d-screen">
        <div className="booking-screen-toolbar package-screen-toolbar">
          <button type="button" className="booking-back-button" onClick={backToServices}>← Back to Booking Services</button>
          <div className="package-toolbar-actions"><span className={`direction-badge ${transactionType === "SALE" ? "sale" : "purchase"}`}>{transactionType === "SALE" ? "SALE TO PARTY" : "PURCHASE FROM VENDOR / SUPPLIER"}</span><button type="button" className="package-register-button" onClick={() => { setError(""); setMessage(""); setScreen("PACKAGE_REGISTER"); }}>Package Booking Register</button></div>
        </div>

        <div className="booking-screen-heading package-form-heading"><span className="eyebrow blue">PACKAGE BOOKING</span><h2>{editingId ? "Edit Package Booking" : "New Package Booking"}</h2><p>PKR only. If Qty is blank, Sub Total equals Rate and the row counts as 1 passenger.</p></div>
        {message && <div className="alert success">{message}</div>}
        {error && <div className="alert error">{error}</div>}
        {!((editingId && canEdit) || (!editingId && canCreate)) && <div className="alert info booking-info">READ ONLY: Your user role can view Package bookings and the register, but cannot save changes.</div>}

        <div className="package-form-card package7d-form-card">
          <div className="package7d-header-fields">
            <label>{transactionType === "SALE" ? "Party / Customer *" : "Vendor / Supplier *"}<select value={counterpartyId} onChange={(e) => setCounterpartyId(e.target.value)}><option value="">{transactionType === "SALE" ? "Select Party / Customer" : "Select Vendor / Supplier"}</option>{eligibleAccounts.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><small className="booking-identity-helper">The account this Package booking belongs to.</small></label>
            <label>Date of Booking *<input type="date" value={packageDate} onChange={(e) => setPackageDate(e.target.value)} /><small className="booking-identity-helper">Accounting date for this booking.</small></label>
            <label>UB / Booking # *<input value={ubNumber} onChange={(e) => setUbNumber(e.target.value)} placeholder="e.g. UB-001" /><small className="booking-identity-helper">Booking reference for this Package service.</small></label>
          </div>

          {eligibleAccounts.length === 0 && <div className="alert info booking-info">No active {transactionType === "SALE" ? "Party" : "Vendor / Supplier"} exists yet. Create one from Dashboard first.</div>}
          <datalist id="package-type-options">{packageTypeSuggestions.map((item) => <option value={item} key={item} />)}</datalist>
          <div className="package7d-passenger-stack">{renderPassengerSection("ADULT")}{renderPassengerSection("CHILD")}{renderPassengerSection("INFANT")}</div>

          <div className="package7d-summary-grid package7e-summary-grid">
            <div className="package7d-pax-summary package7e-pax-summary">
              <div className="package7e-summary-card adult"><span>Adults</span><b>{passengerTotals.ADULT}</b><small>Sub Total <strong>{money(passengerSubtotals.ADULT)}</strong></small></div>
              <div className="package7e-summary-card child"><span>Children</span><b>{passengerTotals.CHILD}</b><small>Sub Total <strong>{money(passengerSubtotals.CHILD)}</strong></small></div>
              <div className="package7e-summary-card infant"><span>Infants</span><b>{passengerTotals.INFANT}</b><small>Sub Total <strong>{money(passengerSubtotals.INFANT)}</strong></small></div>
              <div className="total package7e-total-pax"><span>Total Pax</span><b>{totalPax}</b><small>All passenger rows</small></div>
            </div>
            <div className="package7d-grand-total"><span>GRAND PACKAGE TOTAL</span><b>{money(grandTotal)}</b><small>Adults + Children + Infants · PKR only</small></div>
          </div>

          <section className="package7d-details-card">
            <div className="package7d-details-head"><div><span className="eyebrow blue">PACKAGE BOOKING DETAILS</span><b>Optional details for this UB / Booking</b><small>These fields help you understand the package later and do not affect the booking total.</small></div><span className="package7d-optional-badge">OPTIONAL</span></div>
            <div className="package7d-details-grid">
              <label className="package7d-description">Package Type / Description<div className="package7d-copy-field"><input value={packageDescription} onChange={(e) => setPackageDescription(e.target.value)} placeholder="e.g. 20 Days Economy Package - Shuttle 1000 Metres" /><button type="button" onClick={copyPackageTypeToDetails}>Use Package Type</button></div></label>
              <label>Date of Departure<input type="date" value={departureDate} onChange={(e) => updateDeparture(e.target.value)} /></label>
              <label>Date of Arrival / Return<input type="date" value={returnDate} onChange={(e) => updateReturn(e.target.value)} /></label>
              <label>No. of Days<input type="number" min="0" step="1" value={noOfDays} onChange={(e) => setNoOfDays(e.target.value)} placeholder="Auto / editable" /><small className="field-help">Auto-calculated from both dates; you can edit it.</small></label>
              <fieldset className="package7d-ziarat"><legend>Ziarat Included?</legend><label><input type="radio" name="ziarat" checked={ziaratIncluded === "YES"} onChange={() => setZiaratIncluded("YES")} /> Yes</label><label><input type="radio" name="ziarat" checked={ziaratIncluded === "NO"} onChange={() => setZiaratIncluded("NO")} /> No</label><button type="button" onClick={() => setZiaratIncluded("")}>Clear</button></fieldset>
              <label>Contact of Customer <small>(For B2B / Agent booking)</small><input value={customerContact} onChange={(e) => setCustomerContact(e.target.value)} placeholder="Customer / family contact" /></label>
              <label className="package7d-notes">Notes<textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional notes about this Package booking" /></label>
            </div>
          </section>

          <div className="package-actions package7d-actions">
            {editingId && <button type="button" className="secondary" disabled={busy} onClick={() => { setMessage(""); resetPackageForm({ keepDirection: true, keepService: true }); }}>Cancel Edit</button>}
            {((editingId && canEdit) || (!editingId && canCreate)) && <button type="button" className={`primary ${transactionType === "PURCHASE" ? "package-purchase-save" : "package-sale-save"}`} onClick={savePackage} disabled={busy}>{busy ? "Saving..." : editingId ? `Update ${transactionType}` : `Save ${transactionType}`}</button>}
          </div>
        </div>
      </section>
    );
  }

  function renderPackageRegister() {
    return (
      <section className="booking-entry-screen package-register-screen">
        <div className="booking-screen-toolbar package-register-toolbar"><button type="button" className="booking-back-button" onClick={() => setScreen("SERVICE_FORM")}>← Back to Package Booking</button><span className="booking-foundation-badge active-engine">PACKAGE REGISTER</span></div>
        <div className="package-history-title package-register-title-v2"><div><span className="eyebrow blue">PACKAGE BOOKING REGISTER</span><h2>Package Booking Register</h2><p>Only Package bookings are shown here. Sale and Purchase records can be filtered below.</p></div><div className="package-mini-stats"><div><small>ACTIVE</small><b>{activeEntries.length}</b></div><div className="sale"><small>SALES</small><b>{money(activeSaleTotal)}</b></div><div className="purchase"><small>PURCHASES</small><b>{money(activePurchaseTotal)}</b></div><div><small>PAX</small><b>{activePax}</b></div></div></div>
        {message && <div className="alert success">{message}</div>}
        {error && <div className="alert error">{error}</div>}
        <div className="package-register-controls"><div className="package-register-filter-tabs">{(["ALL", "SALE", "PURCHASE"] as RegisterTypeFilter[]).map((item) => <button type="button" key={item} className={registerType === item ? "active" : ""} onClick={() => setRegisterType(item)}>{item === "ALL" ? "All Package Bookings" : item === "SALE" ? "Sales" : "Purchases"}</button>)}</div><div className="search-box package-search"><span>⌕</span><input value={search} onChange={(e) => void changeSearch(e.target.value)} placeholder="Search UB #, Party/Vendor, Passenger, Package Type, contact or notes..." /></div></div>

        {visibleRegisterEntries.length === 0 ? <div className="empty-state compact-empty"><div className="empty-icon">PKG</div><h3>No package bookings found</h3><p>Create a Package booking or change the register filter/search.</p></div> : (
          <div className="party-table-wrap package-register-wrap"><table className="party-table package-register-table"><thead><tr><th>DATE</th><th>UB #</th><th>TYPE</th><th>PARTY / VENDOR</th><th>PACKAGE ROWS</th><th>PAX</th><th>TOTAL PKR</th><th>STATUS</th><th>ACTIONS</th></tr></thead><tbody>{visibleRegisterEntries.map((entry) => {
            const pax = entry.lines.reduce((sum, line) => sum + Number(line.person_count || 0), 0);
            return <tr key={entry.id} className={entry.status === "VOID" ? "void-row" : ""}>
              <td>{entry.transaction_date}</td><td><b>{entry.ub_number}</b></td><td><span className={`direction-badge ${entry.transaction_type === "SALE" ? "sale" : "purchase"}`}>{entry.transaction_type}</span></td><td><b>{entry.counterparty_name || "—"}</b></td>
              <td><div className="package-history-lines">{entry.lines.map((line) => <div className="package-history-line" key={line.id}><span className={`passenger-chip ${line.passenger_type.toLowerCase()}`}>{line.passenger_type}</span><b>{line.passenger_name || "—"}</b><span>{line.package_type}</span><small>{line.person_count} × {money(line.rate_per_person)} = {money(line.line_total_pkr)}</small></div>)}</div></td>
              <td className="centered"><b>{pax}</b></td><td className="amount"><b>{money(entry.total_pkr)}</b></td><td><span className={`status ${entry.status.toLowerCase()}`}>{entry.status}</span></td><td><div className="row-actions"><button type="button" disabled={!canEdit || entry.status !== "ACTIVE" || busy} onClick={() => editPackage(entry)}>Edit</button><button type="button" disabled={!canVoid || entry.status !== "ACTIVE" || busy} onClick={() => void voidPackage(entry)}>Void</button></div></td>
            </tr>;
          })}</tbody></table></div>
        )}
      </section>
    );
  }

  return (
    <section className="content-card bookings-page bookings-flow-v2">
      {screen === "DIRECTION" && renderDirectionScreen()}
      {screen === "SERVICES" && renderServicesScreen()}
      {screen === "SERVICE_FORM" && service === "PACKAGE" && renderPackageForm()}
      {screen === "SERVICE_FORM" && service === "TICKET" && transactionType && <TicketBookingModule companyId={companyId} parties={parties} transactionType={transactionType} userId={userId} canCreate={canCreate} canEdit={canEdit} canVoid={canVoid} onBack={backToServices} onChanged={onChanged} />}
      {screen === "SERVICE_FORM" && service === "HOTEL" && transactionType && <HotelBookingModule companyId={companyId} parties={parties} transactionType={transactionType} userId={userId} canCreate={canCreate} canEdit={canEdit} canVoid={canVoid} onBack={backToServices} onChanged={onChanged} />}
      {screen === "SERVICE_FORM" && service === "VISA" && transactionType && <VisaBookingModule companyId={companyId} parties={parties} transactionType={transactionType} userId={userId} canCreate={canCreate} canEdit={canEdit} canVoid={canVoid} onBack={backToServices} onChanged={onChanged} />}
      {screen === "SERVICE_FORM" && service === "TRANSPORT" && transactionType && <TransportBookingModule companyId={companyId} parties={parties} transactionType={transactionType} userId={userId} canCreate={canCreate} canEdit={canEdit} canVoid={canVoid} onBack={backToServices} onChanged={onChanged} />}
      {screen === "SERVICE_FORM" && service === "MISC" && transactionType && <MiscBookingModule companyId={companyId} parties={parties} transactionType={transactionType} userId={userId} canCreate={canCreate} canEdit={canEdit} canVoid={canVoid} onBack={backToServices} onChanged={onChanged} />}
      {screen === "PACKAGE_REGISTER" && renderPackageRegister()}
    </section>
  );
}
