import { useEffect, useMemo, useState } from "react";
import type { BookingTransactionType, HotelBooking, HotelBookingInput, HotelBookingLineInput, HotelRoomType, Party } from "./db";
import { createHotelBooking, getHotelBookings, updateHotelBooking, voidHotelBooking } from "./db";
import ProgressiveBookingIdentity from "./ProgressiveBookingIdentity";
import { bookingDigitsFromUb, normalizeBookingUb } from "./bookingUb";
import {
  getHotelOperationalDetails,
  saveHotelGuestRefs,
  saveHotelOperationalDetails,
  type HotelReservationDetail,
  type HotelReservationStatus,
  type HotelRoomingGuest,
} from "./HotelOperationalDb";
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

type CommercialRow = {
  rowId: string;
  guestName: string;
  city: string;
  hotelName: string;
  checkIn: string;
  checkOut: string;
  nights: string;
  roomType: HotelRoomType | "";
  quantity: string;
  rate: string;
  roe: string;
};

type GuestRow = Omit<HotelRoomingGuest, "sortOrder"> & { rowId: string };
type Mode = "FORM" | "REGISTER";
type Filter = "ALL" | BookingTransactionType;

type LegacyDetails = {
  confirmationVoucher: string;
  mealPlan: string;
  guestFamilyName: string;
  guestCount: number;
  customerContact: string;
  specialRequests: string;
  notes: string;
};

const roomTypes: Array<{ value: HotelRoomType; label: string }> = [
  { value: "SHARING", label: "Sharing" },
  { value: "QUINT_SHARING", label: "Quint / Sharing" },
  { value: "QUAD", label: "Quad" },
  { value: "TRIPLE", label: "Triple" },
  { value: "DOUBLE", label: "Double" },
  { value: "SUITE_ROOM", label: "Suite Room" },
];

function localDate() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function num(value: string) { const n = Number(value); return Number.isFinite(n) ? n : 0; }
function whole(value: string) { return Math.max(0, Math.trunc(num(value))); }
function countNights(checkIn: string, checkOut: string) {
  if (!checkIn || !checkOut || checkOut <= checkIn) return 0;
  const [y1, m1, d1] = checkIn.split("-").map(Number);
  const [y2, m2, d2] = checkOut.split("-").map(Number);
  return Math.max(0, Math.floor((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000));
}
function newCommercialRow(roe = ""): CommercialRow {
  return { rowId: crypto.randomUUID(), guestName: "", city: "", hotelName: "", checkIn: "", checkOut: "", nights: "", roomType: "", quantity: "", rate: "", roe };
}
function rowHasData(row: CommercialRow) {
  return Boolean(row.guestName.trim() || row.city.trim() || row.hotelName.trim() || row.checkIn || row.checkOut || row.roomType || row.quantity.trim() || row.rate.trim() || row.roe.trim());
}
function rowSar(row: CommercialRow) { return Math.max(0, num(row.rate)) * whole(row.nights) * whole(row.quantity); }
function rowPkr(row: CommercialRow) { return num(row.roe) > 0 ? rowSar(row) * num(row.roe) : 0; }
function sar(value: number) { return `SAR ${Number(value || 0).toLocaleString("en-PK", { maximumFractionDigits: 2 })}`; }
function pkr(value: number) { return `Rs ${Number(value || 0).toLocaleString("en-PK", { maximumFractionDigits: 2 })}`; }
function newGuest(): GuestRow {
  return { id: "", rowId: crypto.randomUUID(), givenName: "", surname: "", passportNumber: "", hotelSortOrder: 0, roomAllocation: "" };
}
const blankLegacy: LegacyDetails = { confirmationVoucher: "", mealPlan: "", guestFamilyName: "", guestCount: 0, customerContact: "", specialRequests: "", notes: "" };

export default function HotelBookingFlowV3({ companyId, parties, transactionType, userId = "", canCreate = true, canEdit = true, canVoid = true, onBack, onChanged }: Props) {
  const [mode, setMode] = useState<Mode>("FORM");
  const [tx, setTx] = useState<BookingTransactionType>(transactionType);
  const [counterpartyId, setCounterpartyId] = useState("");
  const [bookingDate, setBookingDate] = useState(localDate());
  const [ubDigits, setUbDigits] = useState("");
  const [ubNumber, setUbNumber] = useState("");
  const [assigned, setAssigned] = useState(false);
  const [saved, setSaved] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [rows, setRows] = useState<CommercialRow[]>([newCommercialRow()]);
  const [entries, setEntries] = useState<HotelBooking[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [reservations, setReservations] = useState<HotelReservationDetail[]>([]);
  const [guests, setGuests] = useState<GuestRow[]>([]);
  const [customerContact, setCustomerContact] = useState("");
  const [specialRequests, setSpecialRequests] = useState("");
  const [checkinInstructions, setCheckinInstructions] = useState("");
  const [notes, setNotes] = useState("");
  const [legacy, setLegacy] = useState<LegacyDetails>(blankLegacy);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("ALL");

  useEffect(() => { if (!editingId) setTx(transactionType); }, [transactionType, editingId]);
  useEffect(() => { void loadEntries(""); }, [companyId]);

  const summary = useMemo(() => {
    let stays = 0, totalNights = 0, rooms = 0, beds = 0, totalSar = 0, totalPkr = 0, pendingSar = 0;
    rows.forEach((row) => {
      if (!rowHasData(row)) return;
      stays += 1;
      totalNights += whole(row.nights);
      if (row.roomType === "SHARING") beds += whole(row.quantity); else rooms += whole(row.quantity);
      const amountSar = rowSar(row);
      totalSar += amountSar;
      if (num(row.roe) > 0) totalPkr += rowPkr(row); else pendingSar += amountSar;
    });
    return { stays, totalNights, rooms, beds, totalSar, totalPkr, pendingSar };
  }, [rows]);

  const visible = entries.filter((entry) => filter === "ALL" || entry.transaction_type === filter);

  async function loadEntries(query = search) {
    try { setEntries(await getHotelBookings(companyId, query)); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }

  function reset() {
    setTx(transactionType); setCounterpartyId(""); setBookingDate(localDate()); setUbDigits(""); setUbNumber("");
    setAssigned(false); setSaved(false); setDetailsOpen(false); setRows([newCommercialRow()]); setEditingId(null);
    setReservations([]); setGuests([]); setCustomerContact(""); setSpecialRequests(""); setCheckinInstructions(""); setNotes(""); setLegacy(blankLegacy);
    setError(""); setMessage("");
  }

  function assign(formatted: string) {
    setError("");
    if (!counterpartyId) return setError(tx === "SALE" ? "Select a Party / Customer first." : "Select a Vendor / Supplier first.");
    if (!bookingDate) return setError("Date of Booking is required.");
    if (!formatted) return setError("Enter a booking number using 1 to 4 digits.");
    const duplicate = entries.find((entry) => normalizeBookingUb(entry.ub_number) === formatted && (tx === "SALE" ? entry.transaction_type === "SALE" : entry.transaction_type === "PURCHASE" && entry.counterparty_id === counterpartyId));
    if (duplicate) return setError(tx === "SALE" ? `${formatted} already has a Hotel Sale booking.` : `This Vendor already has a Hotel Purchase booking for ${formatted}.`);
    setUbNumber(formatted); setAssigned(true); setMessage(`${formatted} is ready. Enter Hotel Details & Rates below.`);
  }

  function updateRow(rowId: string, patch: Partial<CommercialRow>) {
    setRows((current) => current.map((row) => {
      if (row.rowId !== rowId) return row;
      const next = { ...row, ...patch };
      const calculated = countNights(next.checkIn, next.checkOut);
      next.nights = calculated ? String(calculated) : "";
      return next;
    }));
  }

  function addRow() {
    const inheritedRoe = [...rows].reverse().find((row) => row.roe.trim())?.roe || "";
    setRows((current) => [...current, newCommercialRow(inheritedRoe)]);
  }

  function removeRow(rowId: string) {
    setRows((current) => {
      const next = current.filter((row) => row.rowId !== rowId);
      return next.length ? next : [newCommercialRow()];
    });
  }

  function commercialLines(): HotelBookingLineInput[] {
    return rows.filter(rowHasData).map((row) => ({
      city: row.city.trim(), hotelName: row.hotelName.trim(), checkIn: row.checkIn, checkOut: row.checkOut,
      nights: whole(row.nights), roomType: row.roomType as HotelRoomType, ratePerNightSar: Math.max(0, num(row.rate)),
      quantity: whole(row.quantity), roe: row.roe.trim() ? Math.max(0, num(row.roe)) : null,
    }));
  }

  function commercialInput(): HotelBookingInput {
    return {
      transactionType: tx, counterpartyId, transactionDate: bookingDate, ubNumber,
      confirmationVoucher: legacy.confirmationVoucher, mealPlan: legacy.mealPlan, guestFamilyName: legacy.guestFamilyName,
      guestCount: legacy.guestCount, customerContact: legacy.customerContact, specialRequests: legacy.specialRequests,
      notes: legacy.notes, lines: commercialLines(),
    };
  }

  function syncReservationRows(existing = reservations) {
    const next = rows.filter(rowHasData).map((_, index) => existing.find((item) => item.hotelSortOrder === index) || {
      hotelSortOrder: index, confirmationVoucher: "", mealPlan: "", reservationStatus: "" as HotelReservationStatus,
    });
    setReservations(next);
  }

  async function saveCommercial() {
    if (!assigned) return setError("Create / Assign the Booking UB first.");
    if (!rows.some(rowHasData)) return setError("Add at least one Hotel row.");
    if (rows.some((row) => rowHasData(row) && !row.guestName.trim())) return setError("Guest Name / Family Head is required for each Hotel row.");
    setBusy(true); setError("");
    try {
      let bookingId = editingId;
      if (bookingId) {
        await updateHotelBooking(companyId, bookingId, commercialInput(), userId);
        setMessage(`Hotel Details & Rates for ${ubNumber} updated.`);
      } else {
        bookingId = await createHotelBooking(companyId, commercialInput(), userId);
        setEditingId(bookingId); setSaved(true);
        setMessage(`Hotel booking ${ubNumber} saved. Optional reservation and rooming details are now available.`);
      }
      await saveHotelGuestRefs(companyId, bookingId, rows.filter(rowHasData).map((row) => row.guestName), userId);
      setSaved(true); syncReservationRows(); await loadEntries(search); await onChanged?.();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  async function saveDetails() {
    if (!editingId) return;
    setBusy(true); setError("");
    try {
      await saveHotelOperationalDetails(companyId, editingId, {
        reservations,
        guests: guests.map((guest) => ({ givenName: guest.givenName, surname: guest.surname, passportNumber: guest.passportNumber, hotelSortOrder: guest.hotelSortOrder, roomAllocation: guest.roomAllocation })),
        customerContact, specialRequests, checkinInstructions, notes,
      }, userId);
      setMessage(`Hotel Booking Details for ${ubNumber} saved.`);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  async function edit(entry: HotelBooking) {
    if (!canEdit || entry.status !== "ACTIVE") return;
    setTx(entry.transaction_type); setCounterpartyId(entry.counterparty_id); setBookingDate(entry.transaction_date); setUbNumber(entry.ub_number); setUbDigits(bookingDigitsFromUb(entry.ub_number));
    setAssigned(true); setSaved(true); setDetailsOpen(false); setEditingId(entry.id);
    setLegacy({ confirmationVoucher: entry.confirmation_voucher || "", mealPlan: entry.meal_plan || "", guestFamilyName: entry.guest_family_name || "", guestCount: Number(entry.guest_count || 0), customerContact: entry.customer_contact || "", specialRequests: entry.special_requests || "", notes: entry.notes || "" });
    const details = await getHotelOperationalDetails(companyId, entry.id);
    const guestRefs = details.guestRefs;
    setRows(entry.lines.length ? entry.lines.map((line, index) => ({
      rowId: crypto.randomUUID(), guestName: guestRefs[index] || entry.guest_family_name || "", city: line.city, hotelName: line.hotel_name,
      checkIn: line.check_in, checkOut: line.check_out, nights: String(line.nights || ""), roomType: line.room_type,
      quantity: String(line.quantity || ""), rate: String(line.rate_per_night_sar || ""), roe: Number(line.roe || 0) > 0 ? String(line.roe) : "",
    })) : [newCommercialRow()]);
    const fallbackReservations = entry.lines.map((_, index) => ({
      hotelSortOrder: index,
      confirmationVoucher: index === 0 ? entry.confirmation_voucher || "" : "",
      mealPlan: index === 0 ? entry.meal_plan || "" : "",
      reservationStatus: "" as HotelReservationStatus,
    }));
    setReservations(details.reservations.length ? details.reservations : fallbackReservations);
    setGuests(details.guests.map((guest) => ({ ...guest, rowId: crypto.randomUUID() })));
    setCustomerContact(details.customerContact || entry.customer_contact || "");
    setSpecialRequests(details.specialRequests || entry.special_requests || "");
    setCheckinInstructions(details.checkinInstructions);
    setNotes(details.notes || entry.notes || "");
    setMode("FORM"); setMessage(`Editing Hotel booking ${entry.ub_number}. Identity is locked; Sections 02 and 03 save independently.`);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function voidEntry(entry: HotelBooking) {
    if (!canVoid || entry.status !== "ACTIVE" || busy) return;
    if (!window.confirm(`Void Hotel booking ${entry.ub_number}?`)) return;
    setBusy(true);
    try { await voidHotelBooking(companyId, entry.id, userId); await loadEntries(search); await onChanged?.(); setMessage(`Hotel booking ${entry.ub_number} voided.`); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  function updateReservation(index: number, patch: Partial<HotelReservationDetail>) {
    setReservations((current) => {
      const existing = current.find((item) => item.hotelSortOrder === index) || { hotelSortOrder: index, confirmationVoucher: "", mealPlan: "", reservationStatus: "" as HotelReservationStatus };
      return [...current.filter((item) => item.hotelSortOrder !== index), { ...existing, ...patch }].sort((a, b) => a.hotelSortOrder - b.hotelSortOrder);
    });
  }

  function updateGuest(rowId: string, patch: Partial<GuestRow>) { setGuests((current) => current.map((guest) => guest.rowId === rowId ? { ...guest, ...patch } : guest)); }

  if (mode === "REGISTER") {
    return <section className="booking-entry-screen bf-page">
      <div className="booking-screen-toolbar"><button className="booking-back-button" onClick={() => setMode("FORM")}>← Back to Hotel Booking</button><span className="booking-foundation-badge active-engine">HOTEL REGISTER</span></div>
      <div className="bf-title"><div><span className="eyebrow blue">HOTEL BOOKING REGISTER</span><h2>Hotel Booking Register</h2><p>Commercial Hotel bookings and their operational reservation details.</p></div></div>
      <div className="package14-register-controls"><div className="package-register-filter-tabs">{(["ALL", "SALE", "PURCHASE"] as Filter[]).map((item) => <button key={item} className={filter === item ? "active" : ""} onClick={() => setFilter(item)}>{item}</button>)}</div><div className="search-box"><input value={search} onChange={(e) => { setSearch(e.target.value); void loadEntries(e.target.value); }} placeholder="Search UB, hotel, city, party/vendor..." /></div></div>
      <div className="party-table-wrap"><table className="party-table"><thead><tr><th>DATE</th><th>UB #</th><th>TYPE</th><th>PARTY / VENDOR</th><th>HOTEL STAYS</th><th>TOTAL SAR</th><th>TOTAL PKR</th><th>PENDING SAR</th><th>STATUS</th><th>ACTIONS</th></tr></thead><tbody>{visible.map((entry) => <tr key={entry.id} className={entry.status === "VOID" ? "void-row" : ""}><td>{entry.transaction_date}</td><td><b>{entry.ub_number}</b></td><td>{entry.transaction_type}</td><td>{entry.counterparty_name}</td><td>{entry.lines.map((line) => `${line.city}: ${line.hotel_name}`).join(" · ")}</td><td>{sar(entry.total_sar)}</td><td>{pkr(entry.total_pkr)}</td><td>{sar(entry.unconverted_sar)}</td><td><span className={`status ${entry.status.toLowerCase()}`}>{entry.status}</span></td><td><div className="row-actions"><button disabled={!canEdit || entry.status !== "ACTIVE"} onClick={() => void edit(entry)}>Edit / Details</button><button disabled={!canVoid || entry.status !== "ACTIVE"} onClick={() => void voidEntry(entry)}>Void</button></div></td></tr>)}</tbody></table></div>
    </section>;
  }

  const activeRows = rows.filter(rowHasData);

  return <section className="booking-entry-screen bf-page package14-page">
    <div className="booking-screen-toolbar"><button className="booking-back-button" onClick={onBack}>← Back to Booking Services</button><div className="bf-toolbar-actions"><span className={`direction-badge ${tx === "SALE" ? "sale" : "purchase"}`}>{tx === "SALE" ? "SALE TO PARTY" : "PURCHASE FROM VENDOR / SUPPLIER"}</span><button className="booking-foundation-badge active-engine" onClick={() => { setMode("REGISTER"); void loadEntries(search); }}>Hotel Booking Register</button></div></div>
    <div className="bf-title"><div><span className="eyebrow blue">HOTEL BOOKING</span><h2>{saved ? `Hotel Booking — ${ubNumber}` : "New Hotel Booking"}</h2><p>Create the UB first, save Hotel accounting second, then add optional reservation / voucher details.</p></div></div>
    {message && <div className="alert success">{message}</div>}{error && <div className="alert error">{error}</div>}

    <ProgressiveBookingIdentity companyId={companyId} userId={userId} transactionType={tx} parties={parties} counterpartyId={counterpartyId} onCounterpartyChange={setCounterpartyId} bookingDate={bookingDate} onBookingDateChange={setBookingDate} ubDigits={ubDigits} onUbDigitsChange={setUbDigits} ubNumber={ubNumber} assigned={assigned} saved={saved} onAssign={assign} onEditHeader={() => { setAssigned(false); setMessage(""); }} onAccountsChanged={onChanged} onError={setError} onMessage={setMessage} serviceLabel="Hotel" />

    {assigned && <section className="bf-card">
      <div className="bf-section-head"><div><span>02</span><div><b>HOTEL DETAILS & RATES</b><small>Commercial / accounting hotel rows under {ubNumber}</small></div></div><button className="primary small" onClick={addRow}>+ Hotel Row</button></div>
      <div className="bf-table-wrap"><table className="bf-table hotel-v3-table"><thead><tr><th>SR</th><th>GUEST NAME / FAMILY HEAD</th><th>CITY</th><th>HOTEL NAME</th><th>CHECK-IN</th><th>CHECK-OUT</th><th>NIGHTS</th><th>ROOM TYPE</th><th>ROOMS / BEDS</th><th>RATE / NIGHT SAR</th><th>ROE</th><th>TOTAL SAR</th><th>TOTAL PKR</th><th>ACTION</th></tr></thead><tbody>{rows.map((row, index) => <tr key={row.rowId}><td>{index + 1}</td><td><input value={row.guestName} onChange={(e) => updateRow(row.rowId, { guestName: e.target.value })} placeholder="Family / guest" /></td><td><input value={row.city} onChange={(e) => updateRow(row.rowId, { city: e.target.value })} /></td><td><input value={row.hotelName} onChange={(e) => updateRow(row.rowId, { hotelName: e.target.value })} /></td><td><input type="date" value={row.checkIn} onChange={(e) => updateRow(row.rowId, { checkIn: e.target.value })} /></td><td><input type="date" value={row.checkOut} onChange={(e) => updateRow(row.rowId, { checkOut: e.target.value })} /></td><td><b>{row.nights || "—"}</b></td><td><select value={row.roomType} onChange={(e) => updateRow(row.rowId, { roomType: e.target.value as HotelRoomType })}><option value="">Select</option>{roomTypes.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></td><td><input type="number" min="0" value={row.quantity} onChange={(e) => updateRow(row.rowId, { quantity: e.target.value })} /></td><td><input type="number" min="0" value={row.rate} onChange={(e) => updateRow(row.rowId, { rate: e.target.value })} /></td><td><input type="number" min="0" value={row.roe} onChange={(e) => updateRow(row.rowId, { roe: e.target.value })} placeholder="Riyal Rate" /></td><td className="bf-money">{sar(rowSar(row))}</td><td className="bf-money">{num(row.roe) > 0 ? pkr(rowPkr(row)) : "—"}</td><td><button className="bf-remove" onClick={() => removeRow(row.rowId)}>×</button></td></tr>)}</tbody></table></div>
      <div className="bf-summary six"><div><small>HOTEL STAYS</small><b>{summary.stays}</b></div><div><small>TOTAL NIGHTS</small><b>{summary.totalNights}</b></div><div><small>TOTAL ROOMS</small><b>{summary.rooms}</b></div><div><small>SHARING BEDS</small><b>{summary.beds}</b></div><div><small>TOTAL SAR</small><b>{sar(summary.totalSar)}</b></div><div className="grand"><small>GRAND TOTAL PKR</small><b>{pkr(summary.totalPkr)}</b>{summary.pendingSar > 0 && <span>{sar(summary.pendingSar)} pending ROE</span>}</div></div>
      <div className="package14-commercial-actions">{saved && <button className="secondary" onClick={reset}>+ New Hotel Booking</button>}<button className="primary" disabled={busy || (!editingId && !canCreate) || (!!editingId && !canEdit)} onClick={() => void saveCommercial()}>{busy ? "Saving..." : editingId ? `Update Hotel Details & Rates — ${ubNumber}` : `Save Hotel Booking — ${ubNumber}`}</button></div>
    </section>}

    {saved && editingId && <section className={`package14-additional ${detailsOpen ? "open" : "closed"}`}>
      <button className="package14-additional-toggle" onClick={() => { const next = !detailsOpen; setDetailsOpen(next); if (next) syncReservationRows(); }}><span className="package14-step-purple">03</span><div><b>HOTEL BOOKING DETAILS — {ubNumber}</b><small>Optional reservation, voucher and rooming information. No effect on Hotel totals.</small></div><span className="package14-optional">OPTIONAL</span><strong>{detailsOpen ? "Close Details ▲" : "+ Open Details ▼"}</strong></button>
      {detailsOpen && <div className="package14-additional-body bf-operational-body">
        <div className="bf-subsection"><div className="bf-subsection-head"><div><b>HOTEL RESERVATION DETAILS</b><small>One operational reservation record for each Hotel row in Section 02.</small></div></div><div className="bf-table-wrap"><table className="bf-table"><thead><tr><th>SR</th><th>CITY</th><th>HOTEL</th><th>CONFIRMATION / VOUCHER #</th><th>MEAL PLAN</th><th>RESERVATION STATUS</th></tr></thead><tbody>{activeRows.map((row, index) => { const detail = reservations.find((item) => item.hotelSortOrder === index) || { hotelSortOrder: index, confirmationVoucher: "", mealPlan: "", reservationStatus: "" as HotelReservationStatus }; return <tr key={`${row.rowId}-reservation`}><td>{index + 1}</td><td><b>{row.city || "—"}</b></td><td>{row.hotelName || "—"}</td><td><input value={detail.confirmationVoucher} onChange={(e) => updateReservation(index, { confirmationVoucher: e.target.value })} /></td><td><input value={detail.mealPlan} onChange={(e) => updateReservation(index, { mealPlan: e.target.value })} placeholder="RO / Breakfast / HB" /></td><td><select value={detail.reservationStatus} onChange={(e) => updateReservation(index, { reservationStatus: e.target.value as HotelReservationStatus })}><option value="">Select</option><option value="PENDING">Pending</option><option value="CONFIRMED">Confirmed</option><option value="CANCELLED">Cancelled</option></select></td></tr>; })}</tbody></table></div></div>

        <div className="bf-subsection"><div className="bf-subsection-head"><div><b>GUEST / ROOMING DETAILS</b><small>Individual guest information and hotel / room allocation.</small></div><button className="primary small" onClick={() => setGuests((current) => [...current, newGuest()])}>+ Guest Row</button></div><div className="bf-table-wrap"><table className="bf-table"><thead><tr><th>SR</th><th>GIVEN NAME</th><th>SURNAME</th><th>PASSPORT NO.</th><th>HOTEL / CITY</th><th>ROOM / BED ALLOCATION</th><th>ACTION</th></tr></thead><tbody>{guests.length === 0 ? <tr><td colSpan={7} className="bf-empty-cell">No individual guest rows yet. Add only when rooming / voucher details are required.</td></tr> : guests.map((guest, index) => <tr key={guest.rowId}><td>{index + 1}</td><td><input value={guest.givenName} onChange={(e) => updateGuest(guest.rowId, { givenName: e.target.value })} /></td><td><input value={guest.surname} onChange={(e) => updateGuest(guest.rowId, { surname: e.target.value })} /></td><td><input value={guest.passportNumber} onChange={(e) => updateGuest(guest.rowId, { passportNumber: e.target.value })} /></td><td><select value={guest.hotelSortOrder} onChange={(e) => updateGuest(guest.rowId, { hotelSortOrder: Number(e.target.value) })}>{activeRows.map((row, hotelIndex) => <option key={row.rowId} value={hotelIndex}>{row.city || `Hotel ${hotelIndex + 1}`} — {row.hotelName || "Hotel"}</option>)}</select></td><td><input value={guest.roomAllocation} onChange={(e) => updateGuest(guest.rowId, { roomAllocation: e.target.value })} placeholder="Room 402 / Bed 3" /></td><td><button className="bf-remove" onClick={() => setGuests((current) => current.filter((item) => item.rowId !== guest.rowId))}>×</button></td></tr>)}</tbody></table></div></div>

        <div className="bf-details-grid"><label>Customer / Traveller Contact<input value={customerContact} onChange={(e) => setCustomerContact(e.target.value)} /></label><label>Check-In Instructions<input value={checkinInstructions} onChange={(e) => setCheckinInstructions(e.target.value)} /></label><label className="wide">Special Requests<textarea rows={3} value={specialRequests} onChange={(e) => setSpecialRequests(e.target.value)} /></label><label className="wide">Internal Notes<textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} /></label></div>
        <div className="package14-details-actions"><span>Optional — can be completed later or used for future Hotel Voucher generation.</span><button className="primary" disabled={busy || !canEdit} onClick={() => void saveDetails()}>{busy ? "Saving..." : `Save Hotel Details — ${ubNumber}`}</button></div>
      </div>}
    </section>}

    {!assigned && <div className="package14-next-step">Create / Assign a Booking UB to unlock Hotel Details & Rates.</div>}
    {assigned && !saved && <div className="package14-next-step">Save Section 02 to activate the Hotel booking and unlock Optional Hotel Booking Details.</div>}
  </section>;
}
