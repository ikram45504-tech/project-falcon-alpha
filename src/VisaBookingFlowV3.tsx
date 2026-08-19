import { useEffect, useMemo, useState } from "react";
import type {
  BookingTransactionType,
  Party,
  VisaBooking,
  VisaBookingInput,
  VisaBookingLineInput,
  VisaPassengerType,
  VisaPassportDetailInput,
  VisaTransportFleetLineInput,
  VisaType,
  VisaVehicleType,
} from "./db";
import { createVisaBooking, getVisaBookings } from "./db";
import ProgressiveBookingIdentity from "./ProgressiveBookingIdentity";
import BookingLifecycleCenter from "./BookingLifecycleCenter";
import { bookingDigitsFromUb, normalizeBookingUb } from "./bookingUb";
import { passportValidityForTravel } from "./passportValidity";
import { getVisaOperationalDetails, saveVisaOperationalDetails, type VisaOperationalPassenger } from "./VisaOperationalDb";
import "./BookingFinalization.css";

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

type VisaRow = { rowId: string; passengerType: VisaPassengerType; passengerName: string; visaType: VisaType | ""; visaRateSar: string; paxCount: string; roe: string };
type FleetRow = { rowId: string; vehicleType: VisaVehicleType; quantity: string; ratePerVehicleSar: string };
type PassengerRow = Omit<VisaOperationalPassenger, "id" | "sortOrder"> & { rowId: string };
type Mode = "FORM" | "REGISTER";

const visaTypes: Array<{ value: VisaType; label: string }> = [
  { value: "ONLY_UMRAH_VISA", label: "Only Umrah Visa" },
  { value: "UMRAH_VISA_TRANSPORT", label: "Umrah Visa + Transport" },
  { value: "UMRAH_VISA_ONE_WAY_TRANSPORT", label: "Umrah Visa + One-Way Transport" },
  { value: "UMRAH_VISA_FULL_TRANSPORT", label: "Umrah Visa + Full Transport" },
];
const vehicles: Array<{ value: VisaVehicleType; label: string; capacity: number }> = [
  { value: "CAR", label: "Car", capacity: 3 },
  { value: "STARIA", label: "Staria", capacity: 6 },
  { value: "HIACE", label: "Hiace", capacity: 10 },
  { value: "COASTER", label: "Coaster", capacity: 16 },
  { value: "BUS", label: "Bus", capacity: 47 },
];

function localDate() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }
function num(value: string) { const n = Number(value); return Number.isFinite(n) ? n : 0; }
function whole(value: string) { return Math.max(0, Math.trunc(num(value))); }
function money(value: number, currency = "SAR") { return `${currency} ${Number(value || 0).toLocaleString("en-PK", { maximumFractionDigits: 2 })}`; }
function pkr(value: number) { return `Rs ${Number(value || 0).toLocaleString("en-PK", { maximumFractionDigits: 2 })}`; }
function vehicleCapacity(type: VisaVehicleType) { return vehicles.find((item) => item.value === type)?.capacity || 0; }
function visaLabel(type: VisaType) { return visaTypes.find((item) => item.value === type)?.label || type; }
function newVisaRow(type: VisaPassengerType = "ADULT", roe = ""): VisaRow { return { rowId: crypto.randomUUID(), passengerType: type, passengerName: "", visaType: "", visaRateSar: "", paxCount: "1", roe }; }
function rowHasData(row: VisaRow) { return Boolean(row.passengerName.trim() || row.visaType || row.visaRateSar.trim() || row.paxCount.trim() || row.roe.trim()); }
function rowPax(row: VisaRow) { return rowHasData(row) ? whole(row.paxCount) : 0; }
function needsPrivate(type: VisaType | "") { return type === "UMRAH_VISA_ONE_WAY_TRANSPORT" || type === "UMRAH_VISA_FULL_TRANSPORT"; }
function needsBus(type: VisaType | "") { return type === "UMRAH_VISA_FULL_TRANSPORT"; }
function suggestedVehicle(pax: number): VisaVehicleType { return pax <= 3 ? "CAR" : pax <= 6 ? "STARIA" : pax <= 10 ? "HIACE" : pax <= 16 ? "COASTER" : "BUS"; }
function suggestedFleet(pax: number): FleetRow[] {
  if (pax <= 0) return [];
  const out: FleetRow[] = [];
  let remaining = pax;
  if (remaining > 47) {
    const quantity = Math.floor(remaining / 47);
    out.push({ rowId: crypto.randomUUID(), vehicleType: "BUS", quantity: String(quantity), ratePerVehicleSar: "" });
    remaining -= quantity * 47;
  }
  if (remaining > 0) out.push({ rowId: crypto.randomUUID(), vehicleType: suggestedVehicle(remaining), quantity: "1", ratePerVehicleSar: "" });
  return out;
}
function blankPassenger(sourceFamilyName: string, passengerType: VisaPassengerType, visaType: VisaType): PassengerRow {
  return { rowId: crypto.randomUUID(), sourceFamilyName, passengerType, visaType, givenName: "", surname: "", passportNumber: "", nationality: "", dateOfBirth: "", passportIssuance: "", passportExpiry: "", visaNumber: "", mofaReference: "" };
}

export default function VisaBookingFlowV3({ companyId, parties, transactionType, userId = "", canCreate = true, canEdit = true, canVoid = true, onBack, onChanged }: Props) {
  const [mode, setMode] = useState<Mode>("FORM");
  const [tx, setTx] = useState<BookingTransactionType>(transactionType);
  const [counterpartyId, setCounterpartyId] = useState("");
  const [bookingDate, setBookingDate] = useState(localDate());
  const [ubDigits, setUbDigits] = useState("");
  const [ubNumber, setUbNumber] = useState("");
  const [assigned, setAssigned] = useState(false);
  const [saved, setSaved] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [rows, setRows] = useState<VisaRow[]>([newVisaRow()]);
  const [fleet, setFleet] = useState<FleetRow[]>([]);
  const [fleetTouched, setFleetTouched] = useState(false);
  const [busRate, setBusRate] = useState("");
  const [expectedEntryDate, setExpectedEntryDate] = useState("");
  const [passengers, setPassengers] = useState<PassengerRow[]>([]);
  const [notes, setNotes] = useState("");
  const [entries, setEntries] = useState<VisaBooking[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [legacyPassports, setLegacyPassports] = useState<VisaPassportDetailInput[]>([]);
  const [legacyExpectedEntry, setLegacyExpectedEntry] = useState("");
  const [legacyNotes, setLegacyNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => { if (!editingId) setTx(transactionType); }, [transactionType, editingId]);
  useEffect(() => { void loadEntries(); }, [companyId]);

  const summary = useMemo(() => {
    const by = { ADULT: 0, CHILD: 0, INFANT: 0 } as Record<VisaPassengerType, number>;
    let visaPax = 0, privatePax = 0, fullBusPax = 0, visaSar = 0;
    rows.forEach((row) => {
      const q = rowPax(row); if (!q) return;
      by[row.passengerType] += q; visaPax += q; visaSar += num(row.visaRateSar) * q;
      if (needsPrivate(row.visaType)) privatePax += q;
      if (needsBus(row.visaType)) fullBusPax += q;
    });
    const fleetSar = fleet.reduce((sum, item) => sum + num(item.ratePerVehicleSar) * Math.max(1, whole(item.quantity)), 0);
    const fleetCapacity = fleet.reduce((sum, item) => sum + vehicleCapacity(item.vehicleType) * Math.max(1, whole(item.quantity)), 0);
    const privatePerPax = privatePax ? fleetSar / privatePax : 0;
    const busSar = fullBusPax ? num(busRate) * fullBusPax : 0;
    let convertedPkr = 0, unconvertedSar = 0;
    rows.forEach((row) => {
      const q = rowPax(row); if (!q) return;
      let total = num(row.visaRateSar) * q;
      if (needsPrivate(row.visaType)) total += privatePerPax * q;
      if (needsBus(row.visaType)) total += num(busRate) * q;
      if (num(row.roe) > 0) convertedPkr += total * num(row.roe); else unconvertedSar += total;
    });
    return { ...by, visaPax, privatePax, fullBusPax, visaSar, fleetSar, fleetCapacity, privatePerPax, busSar, transportSar: fleetSar + busSar, totalSar: visaSar + fleetSar + busSar, convertedPkr, unconvertedSar };
  }, [rows, fleet, busRate]);

  const hasPrivate = summary.privatePax > 0;
  const hasBus = summary.fullBusPax > 0;
  const commercialLocked = Boolean(editingId);
  useEffect(() => {
    if (commercialLocked) return;
    if (!hasPrivate) { setFleet([]); setFleetTouched(false); }
    else if (!fleetTouched && fleet.length === 0) setFleet(suggestedFleet(summary.privatePax));
  }, [commercialLocked, hasPrivate, summary.privatePax, fleetTouched, fleet.length]);

  async function loadEntries() {
    try { setEntries(await getVisaBookings(companyId)); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }

  function reset() {
    setTx(transactionType); setCounterpartyId(""); setBookingDate(localDate()); setUbDigits(""); setUbNumber(""); setAssigned(false); setSaved(false); setDetailsOpen(false);
    setRows([newVisaRow()]); setFleet([]); setFleetTouched(false); setBusRate(""); setExpectedEntryDate(""); setPassengers([]); setNotes(""); setEditingId(null);
    setLegacyPassports([]); setLegacyExpectedEntry(""); setLegacyNotes(""); setError(""); setMessage("");
  }

  function assign(formatted: string) {
    setError("");
    if (!counterpartyId) return setError(tx === "SALE" ? "Select a Party / Customer first." : "Select a Vendor / Supplier first.");
    if (!bookingDate) return setError("Date of Booking is required.");
    if (!formatted) return setError("Enter a booking number using 1 to 4 digits.");
    const duplicate = entries.find((entry) => normalizeBookingUb(entry.ub_number) === formatted && (tx === "SALE" ? entry.transaction_type === "SALE" : entry.transaction_type === "PURCHASE" && entry.counterparty_id === counterpartyId));
    if (duplicate) return setError(tx === "SALE" ? `${formatted} already has a Visa Sale booking.` : `This Vendor already has a Visa Purchase booking for ${formatted}.`);
    setUbNumber(formatted); setAssigned(true); setMessage(`${formatted} is ready. Enter Visa Services & Rates below.`);
  }

  function updateRow(rowId: string, patch: Partial<VisaRow>) {
    if (commercialLocked) return;
    setRows((current) => current.map((row) => row.rowId === rowId ? { ...row, ...patch } : row));
  }
  function addRow() {
    if (commercialLocked) return;
    const inheritedRoe = [...rows].reverse().find((row) => row.roe.trim())?.roe || "";
    setRows((current) => [...current, newVisaRow("ADULT", inheritedRoe)]);
  }
  function removeRow(rowId: string) {
    if (commercialLocked) return;
    setRows((current) => { const next = current.filter((row) => row.rowId !== rowId); return next.length ? next : [newVisaRow()]; });
  }
  function updateFleet(rowId: string, patch: Partial<FleetRow>) {
    if (commercialLocked) return;
    setFleetTouched(true); setFleet((current) => current.map((row) => row.rowId === rowId ? { ...row, ...patch } : row));
  }

  function lineInputs(): VisaBookingLineInput[] {
    return rows.filter(rowHasData).map((row) => ({ passengerType: row.passengerType, passengerName: row.passengerName.trim(), visaType: row.visaType as VisaType, visaRateSar: Math.max(0, num(row.visaRateSar)), paxCount: whole(row.paxCount), roe: row.roe.trim() ? Math.max(0, num(row.roe)) : null }));
  }
  function fleetInputs(): VisaTransportFleetLineInput[] {
    return hasPrivate ? fleet.map((item) => ({ vehicleType: item.vehicleType, quantity: Math.max(1, whole(item.quantity)), ratePerVehicleSar: Math.max(0, num(item.ratePerVehicleSar)) })) : [];
  }
  function commercialInput(): VisaBookingInput {
    return { transactionType: tx, counterpartyId, transactionDate: bookingDate, ubNumber, fleet: fleetInputs(), intercityBusRateSar: hasBus ? Math.max(0, num(busRate)) : 0, expectedEntryDate: legacyExpectedEntry, notes: legacyNotes, lines: lineInputs(), passports: legacyPassports };
  }

  function desiredPassengerSpecs() {
    const desired: Array<{ sourceFamilyName: string; passengerType: VisaPassengerType; visaType: VisaType }> = [];
    rows.filter(rowHasData).forEach((row) => {
      if (!row.visaType) return;
      for (let index = 0; index < rowPax(row); index += 1) desired.push({ sourceFamilyName: row.passengerName.trim(), passengerType: row.passengerType, visaType: row.visaType });
    });
    return desired;
  }

  function syncPassengers(existing = passengers) {
    const used = new Set<number>();
    const next = desiredPassengerSpecs().map((spec) => {
      const matchIndex = existing.findIndex((item, index) => !used.has(index) && item.sourceFamilyName === spec.sourceFamilyName && item.passengerType === spec.passengerType && item.visaType === spec.visaType);
      if (matchIndex >= 0) { used.add(matchIndex); return { ...existing[matchIndex], rowId: existing[matchIndex].rowId || crypto.randomUUID() }; }
      return blankPassenger(spec.sourceFamilyName, spec.passengerType, spec.visaType);
    });
    setPassengers(next);
  }

  async function saveCommercial() {
    if (editingId) return setError("Commercial Visa values are locked after saving. Use Visa Booking Register → Booking Adjustment for Correction, Amendment or Cancellation.");
    if (!assigned) return setError("Create / Assign the Booking UB first.");
    if (!rows.some(rowHasData)) return setError("Add at least one Visa row.");
    if (hasPrivate && summary.fleetCapacity < summary.privatePax) return setError(`Private transport capacity is ${summary.fleetCapacity} Pax but ${summary.privatePax} Pax require private transport. Increase the fleet before saving.`);
    setBusy(true); setError("");
    try {
      const id = await createVisaBooking(companyId, commercialInput(), userId);
      setEditingId(id); setSaved(true); setMessage(`Visa booking ${ubNumber} saved. Optional passenger / visa document details are now available.`);
      syncPassengers(); await loadEntries(); await onChanged?.();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  async function saveDetails() {
    if (!editingId) return;
    setBusy(true); setError("");
    try {
      await saveVisaOperationalDetails(companyId, editingId, {
        expectedEntryDate,
        passengers: passengers.map((passenger) => ({ sourceFamilyName: passenger.sourceFamilyName, passengerType: passenger.passengerType, visaType: passenger.visaType, givenName: passenger.givenName, surname: passenger.surname, passportNumber: passenger.passportNumber, nationality: passenger.nationality, dateOfBirth: passenger.dateOfBirth, passportIssuance: passenger.passportIssuance, passportExpiry: passenger.passportExpiry, visaNumber: passenger.visaNumber, mofaReference: passenger.mofaReference })),
        notes,
      }, userId);
      setMessage(`Visa Booking Details for ${ubNumber} saved.`);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  async function openEntry(entry: VisaBooking) {
    if (entry.status !== "ACTIVE") return;
    setTx(entry.transaction_type); setCounterpartyId(entry.counterparty_id); setBookingDate(entry.transaction_date); setUbNumber(entry.ub_number); setUbDigits(bookingDigitsFromUb(entry.ub_number)); setAssigned(true); setSaved(true); setDetailsOpen(false); setEditingId(entry.id);
    setRows(entry.lines.length ? entry.lines.map((line) => ({ rowId: crypto.randomUUID(), passengerType: line.passenger_type, passengerName: line.passenger_name, visaType: line.visa_type, visaRateSar: String(line.visa_rate_sar || ""), paxCount: String(line.pax_count || 1), roe: Number(line.roe || 0) > 0 ? String(line.roe) : "" })) : [newVisaRow()]);
    setFleet(entry.fleet.map((item) => ({ rowId: crypto.randomUUID(), vehicleType: item.vehicle_type, quantity: String(item.quantity || 1), ratePerVehicleSar: String(item.rate_per_vehicle_sar || "") })));
    setFleetTouched(entry.fleet.length > 0); setBusRate(entry.intercity_bus_rate_sar ? String(entry.intercity_bus_rate_sar) : "");
    const oldPassports: VisaPassportDetailInput[] = entry.passports.map((item) => ({ sourceFamilyName: item.source_family_name, passengerType: item.passenger_type, visaType: item.visa_type, surname: item.surname, givenName: item.given_name, passportNumber: item.passport_number, nationality: item.nationality, dateOfBirth: item.date_of_birth, passportIssuance: item.passport_issuance, passportExpiry: item.passport_expiry }));
    setLegacyPassports(oldPassports); setLegacyExpectedEntry(entry.expected_entry_date || ""); setLegacyNotes(entry.notes || "");
    const details = await getVisaOperationalDetails(companyId, entry.id);
    setExpectedEntryDate(details.expectedEntryDate || entry.expected_entry_date || "");
    const fallback: PassengerRow[] = entry.passports.map((item) => ({ rowId: crypto.randomUUID(), sourceFamilyName: item.source_family_name, passengerType: item.passenger_type, visaType: item.visa_type, givenName: item.given_name, surname: item.surname, passportNumber: item.passport_number, nationality: item.nationality, dateOfBirth: item.date_of_birth, passportIssuance: item.passport_issuance, passportExpiry: item.passport_expiry, visaNumber: "", mofaReference: "" }));
    setPassengers(details.passengers.length ? details.passengers.map((item) => ({ ...item, rowId: crypto.randomUUID() })) : fallback);
    setNotes(details.notes || entry.notes || ""); setMode("FORM"); setMessage(`Opened Visa booking ${entry.ub_number}. Commercial values are read-only here; use Booking Adjustment from the Visa Booking Register. Section 03 operational details remain available.`); window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function openEntryById(bookingId: string) {
    const latest = await getVisaBookings(companyId);
    setEntries(latest);
    const entry = latest.find((item) => item.id === bookingId);
    if (entry) await openEntry(entry);
  }

  async function lifecycleChanged() {
    await loadEntries();
    await onChanged?.();
  }

  function updatePassenger(rowId: string, patch: Partial<PassengerRow>) { setPassengers((current) => current.map((row) => row.rowId === rowId ? { ...row, ...patch } : row)); }

  if (mode === "REGISTER") return <BookingLifecycleCenter
    service="VISA"
    companyId={companyId}
    transactionType={transactionType}
    userId={userId}
    canEdit={canEdit}
    canVoid={canVoid}
    onBack={() => setMode("FORM")}
    onOpenBooking={openEntryById}
    onChanged={lifecycleChanged}
  />;

  return <section className="booking-entry-screen bf-page package14-page">
    <div className="booking-screen-toolbar"><button className="booking-back-button" onClick={onBack}>← Back to Booking Services</button><div className="bf-toolbar-actions"><span className={`direction-badge ${tx === "SALE" ? "sale" : "purchase"}`}>{tx === "SALE" ? "SALE TO PARTY" : "PURCHASE FROM VENDOR / SUPPLIER"}</span><button className="booking-foundation-badge active-engine" onClick={() => setMode("REGISTER")}>Visa Booking Register</button></div></div>
    <div className="bf-title"><div><span className="eyebrow blue">VISA BOOKING</span><h2>{saved ? `Visa Booking — ${ubNumber}` : "New Visa Booking"}</h2><p>{editingId ? "Review the current effective Visa booking. Commercial changes are protected by Booking Adjustment history." : "Create the UB first, save Visa accounting second, then complete optional passenger / document details."}</p></div></div>
    {message && <div className="alert success">{message}</div>}{error && <div className="alert error">{error}</div>}
    <ProgressiveBookingIdentity companyId={companyId} userId={userId} transactionType={tx} parties={parties} counterpartyId={counterpartyId} onCounterpartyChange={setCounterpartyId} bookingDate={bookingDate} onBookingDateChange={setBookingDate} ubDigits={ubDigits} onUbDigitsChange={setUbDigits} ubNumber={ubNumber} assigned={assigned} saved={saved} onAssign={assign} onEditHeader={() => { if (!editingId) { setAssigned(false); setMessage(""); } }} onAccountsChanged={onChanged} onError={setError} onMessage={setMessage} serviceLabel="Visa" />

    {assigned && <section className="bf-card">
      <div className="bf-section-head"><div><span>02</span><div><b>VISA SERVICES & RATES</b><small>{commercialLocked ? "Current effective commercial rows — use Booking Adjustment to change them." : `Commercial / accounting Visa rows under ${ubNumber}`}</small></div></div>{!commercialLocked && <button className="primary small" onClick={addRow}>+ Visa Row</button>}</div>
      <div className="bf-table-wrap"><table className="bf-table visa-v3-table"><thead><tr><th>SR</th><th>PAX TYPE</th><th>PASSENGER / FAMILY HEAD</th><th>VISA SERVICE</th><th>RATE / PAX SAR</th><th>QTY</th><th>ROE</th><th>TOTAL SAR</th><th>TOTAL PKR</th>{!commercialLocked && <th>ACTION</th>}</tr></thead><tbody>{rows.map((row, index) => { const q = rowPax(row); let totalSar = num(row.visaRateSar) * q; if (needsPrivate(row.visaType)) totalSar += summary.privatePerPax * q; if (needsBus(row.visaType)) totalSar += num(busRate) * q; return <tr key={row.rowId}><td>{index + 1}</td><td><select disabled={commercialLocked} value={row.passengerType} onChange={(e) => updateRow(row.rowId, { passengerType: e.target.value as VisaPassengerType })}><option value="ADULT">Adult</option><option value="CHILD">Child</option><option value="INFANT">Infant</option></select></td><td><input disabled={commercialLocked} value={row.passengerName} onChange={(e) => updateRow(row.rowId, { passengerName: e.target.value })} /></td><td><select disabled={commercialLocked} value={row.visaType} onChange={(e) => updateRow(row.rowId, { visaType: e.target.value as VisaType })}><option value="">Select</option>{visaTypes.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></td><td><input disabled={commercialLocked} type="number" min="0" value={row.visaRateSar} onChange={(e) => updateRow(row.rowId, { visaRateSar: e.target.value })} /></td><td><input disabled={commercialLocked} type="number" min="1" value={row.paxCount} onChange={(e) => updateRow(row.rowId, { paxCount: e.target.value })} /></td><td><input disabled={commercialLocked} type="number" min="0" value={row.roe} onChange={(e) => updateRow(row.rowId, { roe: e.target.value })} /></td><td className="bf-money">{money(totalSar)}</td><td className="bf-money">{num(row.roe) > 0 ? pkr(totalSar * num(row.roe)) : "—"}</td>{!commercialLocked && <td><button className="bf-remove" onClick={() => removeRow(row.rowId)}>×</button></td>}</tr>; })}</tbody></table></div>

      {(hasPrivate || hasBus) && <section className="bf-transport-component"><div className="bf-subsection-head"><div><b>TRANSPORT COMPONENT</b><small>{commercialLocked ? "Commercial transport component is read-only. Use Booking Adjustment to change it." : "Commercial transport cost included with applicable Visa services."}</small></div>{hasPrivate && <span className={`bf-capacity ${summary.fleetCapacity >= summary.privatePax ? "ok" : "bad"}`}>Private capacity {summary.fleetCapacity}/{summary.privatePax} Pax</span>}</div>{hasPrivate && <><div className="bf-inline-toolbar"><b>PRIVATE VEHICLES</b>{!commercialLocked && <button className="primary small" onClick={() => { setFleetTouched(true); setFleet((current) => [...current, { rowId: crypto.randomUUID(), vehicleType: "STARIA", quantity: "1", ratePerVehicleSar: "" }]); }}>+ Vehicle</button>}</div><div className="bf-table-wrap"><table className="bf-table"><thead><tr><th>SR</th><th>VEHICLE</th><th>QTY</th><th>CAPACITY / VEHICLE</th><th>TOTAL CAPACITY</th><th>RATE / VEHICLE SAR</th><th>TOTAL SAR</th>{!commercialLocked && <th>ACTION</th>}</tr></thead><tbody>{fleet.map((item, index) => { const quantity = Math.max(1, whole(item.quantity)); const cap = vehicleCapacity(item.vehicleType); return <tr key={item.rowId}><td>{index + 1}</td><td><select disabled={commercialLocked} value={item.vehicleType} onChange={(e) => updateFleet(item.rowId, { vehicleType: e.target.value as VisaVehicleType })}>{vehicles.map((vehicle) => <option key={vehicle.value} value={vehicle.value}>{vehicle.label}</option>)}</select></td><td><input disabled={commercialLocked} type="number" min="1" value={item.quantity} onChange={(e) => updateFleet(item.rowId, { quantity: e.target.value })} /></td><td>{cap}</td><td><b>{cap * quantity}</b></td><td><input disabled={commercialLocked} type="number" min="0" value={item.ratePerVehicleSar} onChange={(e) => updateFleet(item.rowId, { ratePerVehicleSar: e.target.value })} /></td><td className="bf-money">{money(num(item.ratePerVehicleSar) * quantity)}</td>{!commercialLocked && <td><button className="bf-remove" onClick={() => { setFleetTouched(true); setFleet((current) => current.filter((row) => row.rowId !== item.rowId)); }}>×</button></td>}</tr>; })}</tbody></table></div></>}{hasBus && <div className="bf-inline-toolbar"><label>INTERCITY BUS RATE / PAX SAR<input disabled={commercialLocked} type="number" min="0" value={busRate} onChange={(e) => { if (!commercialLocked) setBusRate(e.target.value); }} /></label><div><small>APPLICABLE FULL-TRANSPORT PAX</small><b>{summary.fullBusPax}</b></div><div><small>INTERCITY BUS TOTAL</small><b>{money(summary.busSar)}</b></div></div>}</section>}

      <div className="bf-summary six"><div><small>ADULTS</small><b>{summary.ADULT}</b></div><div><small>CHILDREN</small><b>{summary.CHILD}</b></div><div><small>INFANTS</small><b>{summary.INFANT}</b></div><div><small>TOTAL VISA PAX</small><b>{summary.visaPax}</b></div><div><small>GRAND TOTAL SAR</small><b>{money(summary.totalSar)}</b></div><div className="grand"><small>GRAND TOTAL PKR</small><b>{pkr(summary.convertedPkr)}</b>{summary.unconvertedSar > 0 && <span>{money(summary.unconvertedSar)} pending ROE</span>}</div></div>
      <div className="package14-commercial-actions">{saved && <button className="secondary" onClick={reset}>+ New Visa Booking</button>}{!editingId && <button className="primary" disabled={busy || !canCreate} onClick={() => void saveCommercial()}>{busy ? "Saving..." : `Save Visa Booking — ${ubNumber}`}</button>}{editingId && <div className="adj-rule-note"><b>Commercial values locked:</b> use Visa Booking Register → Booking Adjustment for Correction, Amendment, Partial Cancellation or Full Cancellation.</div>}</div>
    </section>}

    {saved && editingId && <section className={`package14-additional ${detailsOpen ? "open" : "closed"}`}>
      <button className="package14-additional-toggle" onClick={() => { const next = !detailsOpen; setDetailsOpen(next); if (next && passengers.length === 0) syncPassengers(); }}><span className="package14-step-purple">03</span><div><b>VISA BOOKING DETAILS — {ubNumber}</b><small>Optional passenger, passport and Visa information. No effect on Visa calculations.</small></div><span className="package14-optional">OPTIONAL</span><strong>{detailsOpen ? "Close Details ▲" : "+ Open Details ▼"}</strong></button>
      {detailsOpen && <div className="package14-additional-body bf-operational-body"><div className="bf-details-grid"><label>Expected Entry Date into Saudi Arabia<input type="date" value={expectedEntryDate} onChange={(e) => setExpectedEntryDate(e.target.value)} /></label></div><div className="bf-subsection"><div className="bf-subsection-head"><div><b>PASSENGER / VISA DETAILS</b><small>{summary.visaPax} booked Visa Pax. Generate / sync individual document records from Section 02.</small></div><button className="primary small" onClick={() => syncPassengers()}>Generate / Sync from Visa Pax</button></div><div className="bf-table-wrap"><table className="bf-table" style={{ minWidth: 1600 }}><thead><tr><th>SR</th><th>TYPE</th><th>GIVEN NAME</th><th>SURNAME</th><th>PASSPORT NO.</th><th>NATIONALITY</th><th>DOB</th><th>PASSPORT ISSUANCE</th><th>PASSPORT EXPIRY</th><th>VISA NO.</th><th>VISA / MOFA REFERENCE</th></tr></thead><tbody>{passengers.map((passenger, index) => { const validity = passportValidityForTravel(expectedEntryDate, passenger.passportExpiry); return <tr key={passenger.rowId}><td>{index + 1}</td><td><b>{passenger.passengerType}</b><small style={{ display: "block" }}>{visaLabel(passenger.visaType)}</small></td><td><input value={passenger.givenName} onChange={(e) => updatePassenger(passenger.rowId, { givenName: e.target.value })} /></td><td><input value={passenger.surname} onChange={(e) => updatePassenger(passenger.rowId, { surname: e.target.value })} /></td><td><input value={passenger.passportNumber} onChange={(e) => updatePassenger(passenger.rowId, { passportNumber: e.target.value })} /></td><td><input value={passenger.nationality} onChange={(e) => updatePassenger(passenger.rowId, { nationality: e.target.value })} /></td><td><input type="date" value={passenger.dateOfBirth} onChange={(e) => updatePassenger(passenger.rowId, { dateOfBirth: e.target.value })} /></td><td><input type="date" value={passenger.passportIssuance} onChange={(e) => updatePassenger(passenger.rowId, { passportIssuance: e.target.value })} /></td><td><div className="bf-passport-cell"><input type="date" value={passenger.passportExpiry} onChange={(e) => updatePassenger(passenger.rowId, { passportExpiry: e.target.value })} /><span className={`bf-passport-badge ${validity.level.toLowerCase()}`}>{validity.label}</span></div></td><td><input value={passenger.visaNumber} onChange={(e) => updatePassenger(passenger.rowId, { visaNumber: e.target.value })} /></td><td><input value={passenger.mofaReference} onChange={(e) => updatePassenger(passenger.rowId, { mofaReference: e.target.value })} /></td></tr>; })}</tbody></table></div></div><div className="bf-note"><b>Passport validity guidance:</b> the system compares Expected Entry Date with Passport Expiry using the six-calendar-month rule. This is document-validity guidance only and does not guarantee Visa issuance or entry.</div><div className="bf-details-grid"><label className="wide">Booking / Visa Notes<textarea rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} /></label></div><div className="package14-details-actions"><span>Optional — Visa Number / MOFA references can be completed after issuance.</span><button className="primary" disabled={busy || !canEdit} onClick={() => void saveDetails()}>{busy ? "Saving..." : `Save Visa Details — ${ubNumber}`}</button></div></div>}
    </section>}

    {!assigned && <div className="package14-next-step">Create / Assign a Booking UB to unlock Visa Services & Rates.</div>}
    {assigned && !saved && <div className="package14-next-step">Save Section 02 to activate the Visa booking and unlock Optional Visa Booking Details.</div>}
  </section>;
}
