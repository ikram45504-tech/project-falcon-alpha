import { useEffect, useMemo, useState } from "react";
import {
  BookingTransactionType,
  HotelBooking,
  HotelBookingInput,
  HotelBookingLineInput,
  HotelRoomType,
  Party,
  createHotelBooking,
  getHotelBookings,
  updateHotelBooking,
  voidHotelBooking,
} from "./db";

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

type HotelRowState = {
  rowId: string;
  city: string;
  hotelName: string;
  checkIn: string;
  checkOut: string;
  nights: string;
  dateDriver: "DATES" | "NIGHTS";
  roomType: HotelRoomType | "";
  ratePerNightSar: string;
  quantity: string;
  roe: string;
};

type ViewMode = "FORM" | "REGISTER";
type RegisterFilter = "ALL" | BookingTransactionType;

const roomTypeOptions: Array<{ value: HotelRoomType; label: string }> = [
  { value: "SHARING", label: "Sharing" },
  { value: "QUINT_SHARING", label: "Quint / Sharing" },
  { value: "QUAD", label: "Quad" },
  { value: "TRIPLE", label: "Triple" },
  { value: "DOUBLE", label: "Double" },
  { value: "SUITE_ROOM", label: "Suite Room" },
];

function localDate() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function numberValue(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function wholeNumber(value: string) {
  return Math.max(0, Math.trunc(numberValue(value)));
}

function hotelNights(checkIn: string, checkOut: string) {
  if (!checkIn || !checkOut || checkOut <= checkIn) return 0;
  const [iy, im, id] = checkIn.split("-").map(Number);
  const [oy, om, od] = checkOut.split("-").map(Number);
  const start = Date.UTC(iy, im - 1, id);
  const end = Date.UTC(oy, om - 1, od);
  return Math.max(0, Math.floor((end - start) / 86400000));
}

function addHotelNights(checkIn: string, nights: number) {
  if (!checkIn || nights < 1) return "";
  const [year, month, day] = checkIn.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + nights);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function newRow(inheritRoe = ""): HotelRowState {
  return {
    rowId: crypto.randomUUID(),
    city: "",
    hotelName: "",
    checkIn: "",
    checkOut: "",
    nights: "",
    dateDriver: "DATES",
    roomType: "",
    ratePerNightSar: "",
    quantity: "",
    roe: inheritRoe,
  };
}

function rowHasData(row: HotelRowState) {
  return Boolean(
    row.city.trim() ||
    row.hotelName.trim() ||
    row.checkIn ||
    row.checkOut ||
    row.nights.trim() ||
    row.roomType ||
    row.ratePerNightSar.trim() ||
    row.quantity.trim() ||
    row.roe.trim()
  );
}

function rowSarTotal(row: HotelRowState) {
  if (!rowHasData(row)) return 0;
  return Math.max(0, numberValue(row.ratePerNightSar)) * wholeNumber(row.nights) * wholeNumber(row.quantity);
}

function rowPkrTotal(row: HotelRowState) {
  const roe = Math.max(0, numberValue(row.roe));
  return roe > 0 ? rowSarTotal(row) * roe : 0;
}

function isSharing(rowType: HotelRoomType | "") {
  return rowType === "SHARING";
}

function roomTypeLabel(roomType: HotelRoomType | "") {
  return roomTypeOptions.find((item) => item.value === roomType)?.label || "—";
}

function sarMoney(value: number) {
  return `SAR ${Number(value || 0).toLocaleString("en-PK", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })}`;
}

function pkrMoney(value: number) {
  return `Rs ${Number(value || 0).toLocaleString("en-PK", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })}`;
}

export default function HotelBookingModule({
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
  const [mode, setMode] = useState<ViewMode>("FORM");
  const [activeTransactionType, setActiveTransactionType] = useState<BookingTransactionType>(transactionType);
  const [counterpartyId, setCounterpartyId] = useState("");
  const [bookingDate, setBookingDate] = useState(localDate());
  const [ubNumber, setUbNumber] = useState("");
  const [rows, setRows] = useState<HotelRowState[]>([newRow()]);

  const [confirmationVoucher, setConfirmationVoucher] = useState("");
  const [mealPlan, setMealPlan] = useState("");
  const [guestFamilyName, setGuestFamilyName] = useState("");
  const [guestCount, setGuestCount] = useState("");
  const [customerContact, setCustomerContact] = useState("");
  const [specialRequests, setSpecialRequests] = useState("");
  const [notes, setNotes] = useState("");

  const [entries, setEntries] = useState<HotelBooking[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [search, setSearch] = useState("");
  const [registerFilter, setRegisterFilter] = useState<RegisterFilter>("ALL");

  useEffect(() => {
    if (!editingId) setActiveTransactionType(transactionType);
  }, [transactionType, editingId]);

  useEffect(() => {
    void loadEntries("");
  }, [companyId]);

  const eligibleAccounts = useMemo(() => {
    const wanted = activeTransactionType === "SALE" ? "PARTY" : "VENDOR";
    return parties.filter((item) => item.status === "ACTIVE" && item.account_type === wanted);
  }, [parties, activeTransactionType]);

  const citySuggestions = useMemo(() => {
    const values = new Set<string>(["Makkah", "Madinah"]);
    for (const entry of entries) for (const line of entry.lines) if (line.city.trim()) values.add(line.city.trim());
    return Array.from(values).sort((a, b) => a.localeCompare(b));
  }, [entries]);

  const hotelSuggestions = useMemo(() => {
    const values = new Set<string>();
    for (const entry of entries) for (const line of entry.lines) if (line.hotel_name.trim()) values.add(line.hotel_name.trim());
    return Array.from(values).sort((a, b) => a.localeCompare(b));
  }, [entries]);

  const totals = useMemo(() => {
    let stays = 0;
    let nights = 0;
    let rooms = 0;
    let beds = 0;
    let totalSar = 0;
    let convertedPkr = 0;
    let unconvertedSar = 0;

    for (const row of rows) {
      if (!rowHasData(row)) continue;
      stays += 1;
      nights += wholeNumber(row.nights);
      const qty = wholeNumber(row.quantity);
      if (isSharing(row.roomType)) beds += qty;
      else rooms += qty;
      const sar = rowSarTotal(row);
      totalSar += sar;
      if (numberValue(row.roe) > 0) convertedPkr += rowPkrTotal(row);
      else unconvertedSar += sar;
    }

    return { stays, guests: wholeNumber(guestCount), nights, rooms, beds, totalSar, convertedPkr, unconvertedSar };
  }, [rows, guestCount]);

  const activeEntries = entries.filter((entry) => entry.status === "ACTIVE");
  const salePkr = activeEntries
    .filter((entry) => entry.transaction_type === "SALE")
    .reduce((sum, entry) => sum + Number(entry.total_pkr || 0), 0);
  const purchasePkr = activeEntries
    .filter((entry) => entry.transaction_type === "PURCHASE")
    .reduce((sum, entry) => sum + Number(entry.total_pkr || 0), 0);
  const pendingSar = activeEntries.reduce((sum, entry) => sum + Number(entry.unconverted_sar || 0), 0);
  const visibleEntries = entries.filter((entry) => registerFilter === "ALL" || entry.transaction_type === registerFilter);

  async function loadEntries(nextSearch = search) {
    try {
      setEntries(await getHotelBookings(companyId, nextSearch));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  function resetForm(options?: { keepDirection?: boolean }) {
    if (!options?.keepDirection) setActiveTransactionType(transactionType);
    setCounterpartyId("");
    setBookingDate(localDate());
    setUbNumber("");
    setRows([newRow()]);
    setConfirmationVoucher("");
    setMealPlan("");
    setGuestFamilyName("");
    setGuestCount("");
    setCustomerContact("");
    setSpecialRequests("");
    setNotes("");
    setEditingId(null);
    setError("");
  }

  function addRow() {
    const inheritedRoe = [...rows].reverse().find((row) => row.roe.trim())?.roe || "";
    setRows((current) => [...current, newRow(inheritedRoe)]);
    setError("");
  }

  function updateRow(rowId: string, patch: Partial<HotelRowState>) {
    setRows((current) => current.map((row) => (row.rowId === rowId ? { ...row, ...patch } : row)));
  }

  function updateCheckIn(row: HotelRowState, value: string) {
    if (!value) {
      updateRow(row.rowId, { checkIn: "", nights: "" });
      return;
    }

    if (row.dateDriver === "NIGHTS" && wholeNumber(row.nights) > 0) {
      updateRow(row.rowId, {
        checkIn: value,
        checkOut: addHotelNights(value, wholeNumber(row.nights)),
      });
      return;
    }

    const nights = hotelNights(value, row.checkOut);
    updateRow(row.rowId, { checkIn: value, nights: nights > 0 ? String(nights) : "" });
  }

  function updateCheckOut(row: HotelRowState, value: string) {
    const nights = hotelNights(row.checkIn, value);
    updateRow(row.rowId, {
      checkOut: value,
      nights: nights > 0 ? String(nights) : "",
      dateDriver: "DATES",
    });
  }

  function updateNights(row: HotelRowState, value: string) {
    const nights = wholeNumber(value);
    updateRow(row.rowId, {
      nights: value,
      checkOut: row.checkIn && nights > 0 ? addHotelNights(row.checkIn, nights) : row.checkOut,
      dateDriver: "NIGHTS",
    });
  }

  function removeRow(rowId: string) {
    setRows((current) => {
      const next = current.filter((row) => row.rowId !== rowId);
      return next.length ? next : [newRow()];
    });
  }

  function buildInput(): HotelBookingInput {
    const lineInputs: HotelBookingLineInput[] = rows
      .filter(rowHasData)
      .map((row) => ({
        city: row.city.trim(),
        hotelName: row.hotelName.trim(),
        checkIn: row.checkIn,
        checkOut: row.checkOut,
        nights: wholeNumber(row.nights),
        roomType: row.roomType as HotelRoomType,
        ratePerNightSar: Math.max(0, numberValue(row.ratePerNightSar)),
        quantity: wholeNumber(row.quantity),
        roe: row.roe.trim() === "" ? null : Math.max(0, numberValue(row.roe)),
      }));

    return {
      transactionType: activeTransactionType,
      counterpartyId,
      transactionDate: bookingDate,
      ubNumber,
      confirmationVoucher,
      mealPlan,
      guestFamilyName,
      guestCount: wholeNumber(guestCount),
      customerContact,
      specialRequests,
      notes,
      lines: lineInputs,
    };
  }

  async function save() {
    if (busy) return;
    if (editingId && !canEdit) return setError("Your role does not allow editing bookings.");
    if (!editingId && !canCreate) return setError("Your role does not allow creating bookings.");

    setBusy(true);
    setError("");
    setMessage("");
    try {
      const input = buildInput();
      if (editingId) {
        await updateHotelBooking(companyId, editingId, input, userId);
        setMessage(`Hotel booking ${input.ubNumber.trim()} updated successfully.`);
      } else {
        await createHotelBooking(companyId, input, userId);
        setMessage(`Hotel booking ${input.ubNumber.trim()} saved successfully.`);
      }
      await loadEntries("");
      if (onChanged) await onChanged();
      resetForm({ keepDirection: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function edit(entry: HotelBooking) {
    if (!canEdit || entry.status !== "ACTIVE") return;
    setActiveTransactionType(entry.transaction_type);
    setCounterpartyId(entry.counterparty_id);
    setBookingDate(entry.transaction_date);
    setUbNumber(entry.ub_number);
    setConfirmationVoucher(entry.confirmation_voucher || "");
    setMealPlan(entry.meal_plan || "");
    setGuestFamilyName(entry.guest_family_name || "");
    setGuestCount(entry.guest_count > 0 ? String(entry.guest_count) : "");
    setCustomerContact(entry.customer_contact || "");
    setSpecialRequests(entry.special_requests || "");
    setNotes(entry.notes || "");
    setRows(
      entry.lines.length
        ? entry.lines.map((line) => ({
            rowId: crypto.randomUUID(),
            city: line.city,
            hotelName: line.hotel_name,
            checkIn: line.check_in,
            checkOut: line.check_out,
            nights: String(line.nights || ""),
            dateDriver: "DATES",
            roomType: line.room_type,
            ratePerNightSar: String(line.rate_per_night_sar || ""),
            quantity: String(line.quantity || ""),
            roe: Number(line.roe || 0) > 0 ? String(line.roe) : "",
          }))
        : [newRow()]
    );
    setEditingId(entry.id);
    setError("");
    setMessage("");
    setMode("FORM");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function voidEntry(entry: HotelBooking) {
    if (!canVoid || entry.status !== "ACTIVE" || busy) return;
    if (!window.confirm(`Void Hotel booking ${entry.ub_number}? This keeps the audit record but removes it from active totals.`)) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await voidHotelBooking(companyId, entry.id, userId);
      await loadEntries(search);
      if (onChanged) await onChanged();
      setMessage(`Hotel booking ${entry.ub_number} voided.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function changeSearch(value: string) {
    setSearch(value);
    await loadEntries(value);
  }

  function renderRow(row: HotelRowState, index: number) {
    const sarTotal = rowSarTotal(row);
    const pkrTotal = rowPkrTotal(row);
    const hasRoe = numberValue(row.roe) > 0;
    const qtyLabel = isSharing(row.roomType) ? "No. of Beds" : "No. of Rooms";

    return (
      <tr key={row.rowId}>
        <td className="hotel10-row-number">{index + 1}</td>
        <td><input list="hotel-city-options" value={row.city} onChange={(e) => updateRow(row.rowId, { city: e.target.value })} placeholder="City" /></td>
        <td><input list="hotel-name-options" value={row.hotelName} onChange={(e) => updateRow(row.rowId, { hotelName: e.target.value })} placeholder="Hotel name" /></td>
        <td><input type="date" value={row.checkIn} onChange={(e) => updateCheckIn(row, e.target.value)} /></td>
        <td><input type="date" value={row.checkOut} onChange={(e) => updateCheckOut(row, e.target.value)} /></td>
        <td className="hotel10-small-cell"><input className="hotel10-small-number" type="number" min="1" max="99" step="1" value={row.nights} onChange={(e) => updateNights(row, e.target.value)} placeholder="0" /></td>
        <td>
          <select value={row.roomType} onChange={(e) => updateRow(row.rowId, { roomType: e.target.value as HotelRoomType })}>
            <option value="">Select Room Type</option>
            {roomTypeOptions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
        </td>
        <td>
          <div className="hotel10-sar-input"><span>SAR</span><input type="number" min="0" step="0.01" value={row.ratePerNightSar} onChange={(e) => updateRow(row.rowId, { ratePerNightSar: e.target.value })} placeholder="0" /></div>
        </td>
        <td className="hotel10-small-cell">
          <small className="hotel10-dynamic-label">{qtyLabel}</small>
          <input className="hotel10-small-number" type="number" min="1" max="99" step="1" value={row.quantity} onChange={(e) => updateRow(row.rowId, { quantity: e.target.value })} placeholder="0" />
        </td>
        <td className="hotel10-roe-cell"><input className="hotel10-roe-input" type="number" min="0" step="0.01" value={row.roe} onChange={(e) => updateRow(row.rowId, { roe: e.target.value })} placeholder="Riyal Rate" /></td>
        <td className={`hotel10-row-total ${hasRoe ? "converted" : "unconverted"}`}><b>{sarMoney(sarTotal)}</b><strong>{hasRoe ? pkrMoney(pkrTotal) : "PKR —"}</strong><small>{hasRoe ? `ROE ${numberValue(row.roe)}` : "ROE not entered"}</small></td>
        <td><button type="button" className="hotel10-remove" onClick={() => removeRow(row.rowId)} aria-label="Remove hotel stay">×</button></td>
      </tr>
    );
  }

  function renderForm() {
    return (
      <section className="booking-entry-screen hotel10-screen">
        <div className="booking-screen-toolbar hotel10-toolbar">
          <button type="button" className="booking-back-button" onClick={onBack}>← Back to Booking Services</button>
          <div className="hotel10-toolbar-right">
            <span className={`direction-badge ${activeTransactionType === "SALE" ? "sale" : "purchase"}`}>{activeTransactionType === "SALE" ? "SALE TO PARTY" : "PURCHASE FROM VENDOR / SUPPLIER"}</span>
            <button type="button" className="hotel10-register-button" onClick={() => { setMode("REGISTER"); setError(""); }}>Hotel Booking Register</button>
          </div>
        </div>

        <div className="hotel10-title-row">
          <div><span className="eyebrow blue">HOTEL BOOKING</span><h2>{editingId ? "Edit Hotel Booking" : "New Hotel Booking"}</h2><p>Hotel rates are entered in SAR. ROE converts each stay into PKR when available.</p></div>
        </div>

        {message && <div className="alert success">{message}</div>}
        {error && <div className="alert error">{error}</div>}

        <section className="hotel10-card">
          <div className="hotel10-section-head"><span>1</span><b>SELECT PARTY / VENDOR & ASSIGN BOOKING NUMBER</b></div>
          <div className="hotel10-header-grid">
            <label>{activeTransactionType === "SALE" ? "Party Name *" : "Vendor / Supplier Name *"}
              <select value={counterpartyId} onChange={(e) => setCounterpartyId(e.target.value)}>
                <option value="">{activeTransactionType === "SALE" ? "Select Party" : "Select Vendor / Supplier"}</option>
                {eligibleAccounts.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
            </label>
            <label>Date of Booking *<input type="date" value={bookingDate} onChange={(e) => setBookingDate(e.target.value)} /></label>
            <label>UB / Booking # *<input value={ubNumber} onChange={(e) => setUbNumber(e.target.value)} placeholder="e.g. UB-1200" /></label>
          </div>
        </section>

        <section className="hotel10-card">
          <div className="hotel10-passenger-head">
            <div className="hotel10-section-head no-margin"><span>2</span><b>ACCOMMODATION DETAILS & RATES</b><small>Check-In + Nights calculates Check-Out; Check-In + Check-Out calculates Nights.</small></div>
            <button type="button" className="hotel10-add-stay" onClick={addRow}>+ Add Hotel Stay</button>
          </div>
          <div className="hotel10-table-wrap">
            <table className="hotel10-rate-table">
              <thead><tr><th>#</th><th>City *</th><th>Hotel Name *</th><th>Check-In *</th><th>Check-Out *</th><th><span>No. of</span><span>Nights</span></th><th>Room Type *</th><th><span>Per Night</span><span>(SAR)</span></th><th><span>No. of</span><span>Rooms / Beds</span></th><th>ROE</th><th>Total</th><th>Action</th></tr></thead>
              <tbody>{rows.map(renderRow)}</tbody>
            </table>
          </div>
          <div className="hotel10-calc-note">Per Night × No. of Nights × No. of Rooms/Beds = SAR Sub Total. If ROE is entered, SAR Sub Total × ROE = PKR Sub Total.</div>
          <datalist id="hotel-city-options">{citySuggestions.map((value) => <option key={value} value={value} />)}</datalist>
          <datalist id="hotel-name-options">{hotelSuggestions.map((value) => <option key={value} value={value} />)}</datalist>
        </section>

        <div className="hotel10-summary-layout">
          <section className="hotel10-summary-counts">
            <div><small>HOTEL STAYS</small><b>{totals.stays}</b></div>
            <div><small>TOTAL GUESTS</small><b>{totals.guests}</b></div>
            <div><small>TOTAL NIGHTS</small><b>{totals.nights}</b></div>
            <div><small>TOTAL ROOMS</small><b>{totals.rooms}</b></div>
            <div><small>SHARING BEDS</small><b>{totals.beds}</b></div>
          </section>
          <section className="hotel10-money-summary hotel10-grand-totals">
            <div className="converted"><span>GRAND TOTAL (PKR)</span><b>{pkrMoney(totals.convertedPkr)}</b>{totals.unconvertedSar > 0 ? <small>ROE pending for {sarMoney(totals.unconvertedSar)}</small> : null}</div>
            <div className="original"><span>GRAND TOTAL (SAR)</span><b>{sarMoney(totals.totalSar)}</b><small>Original accommodation value</small></div>
          </section>
        </div>

        <section className="hotel10-card hotel10-optional-card">
          <div className="hotel10-section-head"><span>3</span><b>GUEST / BOOKING DETAILS</b><small>Optional information for this UB / Booking</small><em>OPTIONAL</em></div>
          <div className="hotel10-optional-grid">
            <label>Guest / Group Name<input value={guestFamilyName} onChange={(e) => setGuestFamilyName(e.target.value)} placeholder="Guest, family head or group name" /></label>
            <label className="hotel10-guest-count">No. of Guests<input type="number" min="1" max="99" step="1" value={guestCount} onChange={(e) => setGuestCount(e.target.value)} placeholder="0" /></label>
            <label>Confirmation / Voucher #<input value={confirmationVoucher} onChange={(e) => setConfirmationVoucher(e.target.value)} placeholder="Hotel confirmation / voucher" /></label>
            <label>Meal Plan<input list="hotel-meal-options" value={mealPlan} onChange={(e) => setMealPlan(e.target.value)} placeholder="e.g. Breakfast" /></label>
            <label>Customer Contact<input value={customerContact} onChange={(e) => setCustomerContact(e.target.value)} placeholder="Customer / family contact" /></label>
            <label className="hotel10-special">Special Requests<textarea rows={3} value={specialRequests} onChange={(e) => setSpecialRequests(e.target.value)} placeholder="e.g. Near Haram, non-smoking, early check-in" /></label>
            <label className="hotel10-notes">Notes<textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional notes about this Hotel booking" /></label>
          </div>
          <datalist id="hotel-meal-options"><option value="Room Only" /><option value="Breakfast" /><option value="Half Board" /><option value="Full Board" /></datalist>
        </section>

        <div className="hotel10-actions">
          {editingId && <button type="button" className="secondary" disabled={busy} onClick={() => { resetForm({ keepDirection: false }); setMessage(""); }}>Cancel Edit</button>}
          {((editingId && canEdit) || (!editingId && canCreate)) && (
            <button type="button" className={`primary ${activeTransactionType === "PURCHASE" ? "package-purchase-save" : "package-sale-save"}`} disabled={busy} onClick={() => void save()}>
              {busy ? "Saving..." : editingId ? `Update ${activeTransactionType}` : `Save ${activeTransactionType}`}
            </button>
          )}
        </div>
      </section>
    );
  }

  function renderRegister() {
    return (
      <section className="booking-entry-screen hotel10-screen hotel10-register-screen">
        <div className="booking-screen-toolbar hotel10-toolbar">
          <button type="button" className="booking-back-button" onClick={() => { setMode("FORM"); setError(""); }}>← Back to Hotel Booking</button>
          <span className="booking-foundation-badge active-engine">HOTEL REGISTER</span>
        </div>

        <div className="hotel10-register-title">
          <div><span className="eyebrow blue">HOTEL BOOKING REGISTER</span><h2>Hotel Booking Register</h2><p>Hotel Sale and Purchase bookings stay linked by UB #. SAR remains visible even when ROE is not entered yet.</p></div>
          <div className="hotel10-mini-stats"><div><small>ACTIVE</small><b>{activeEntries.length}</b></div><div className="sale"><small>SALES PKR</small><b>{pkrMoney(salePkr)}</b></div><div className="purchase"><small>PURCHASES PKR</small><b>{pkrMoney(purchasePkr)}</b></div><div className="pending"><small>SAR PENDING</small><b>{sarMoney(pendingSar)}</b></div></div>
        </div>

        {message && <div className="alert success">{message}</div>}
        {error && <div className="alert error">{error}</div>}

        <div className="hotel10-register-controls">
          <div className="package-register-filter-tabs">
            {(["ALL", "SALE", "PURCHASE"] as RegisterFilter[]).map((item) => <button type="button" key={item} className={registerFilter === item ? "active" : ""} onClick={() => setRegisterFilter(item)}>{item === "ALL" ? "All Hotel Bookings" : item === "SALE" ? "Sales" : "Purchases"}</button>)}
          </div>
          <div className="search-box package-search"><span>⌕</span><input value={search} onChange={(e) => void changeSearch(e.target.value)} placeholder="Search UB #, Party/Vendor, City, Hotel, Guest, Voucher or notes..." /></div>
        </div>

        {visibleEntries.length === 0 ? (
          <div className="empty-state compact-empty"><div className="empty-icon">HTL</div><h3>No hotel bookings found</h3><p>Create a Hotel booking or change the register filter/search.</p></div>
        ) : (
          <div className="party-table-wrap hotel10-register-wrap">
            <table className="party-table hotel10-register-table">
              <thead><tr><th>DATE</th><th>UB #</th><th>TYPE</th><th>PARTY / VENDOR</th><th>HOTEL STAY / RATE ROWS</th><th>PKR CONVERTED</th><th>SAR UNCONVERTED</th><th>STATUS</th><th>ACTIONS</th></tr></thead>
              <tbody>{visibleEntries.map((entry) => <tr key={entry.id} className={entry.status === "VOID" ? "void-row" : ""}>
                <td>{entry.transaction_date}</td>
                <td><b>{entry.ub_number}</b></td>
                <td><span className={`direction-badge ${entry.transaction_type === "SALE" ? "sale" : "purchase"}`}>{entry.transaction_type}</span></td>
                <td><b>{entry.counterparty_name || "—"}</b>{entry.guest_family_name || entry.guest_count > 0 ? <small className="hotel10-register-sub">{entry.guest_family_name ? `Guest: ${entry.guest_family_name}` : ""}{entry.guest_family_name && entry.guest_count > 0 ? " · " : ""}{entry.guest_count > 0 ? `${entry.guest_count} Guest${entry.guest_count === 1 ? "" : "s"}` : ""}</small> : null}</td>
                <td><div className="hotel10-history-lines">{entry.lines.map((line) => {
                  const qtyText = line.room_type === "SHARING" ? `${line.quantity} Bed${line.quantity === 1 ? "" : "s"}` : `${line.quantity} Room${line.quantity === 1 ? "" : "s"}`;
                  return <div key={line.id}><b>{line.city} · {line.hotel_name}</b><span>{line.check_in} → {line.check_out} · {line.nights} Nights · {roomTypeLabel(line.room_type)}</span><small>{sarMoney(line.rate_per_night_sar)} × {line.nights} × {qtyText}{line.roe > 0 ? ` · ROE ${line.roe} · ${pkrMoney(line.line_total_pkr)}` : ` · ${sarMoney(line.line_total_sar)} pending ROE`}</small></div>;
                })}</div></td>
                <td className="amount"><b>{pkrMoney(entry.total_pkr)}</b></td>
                <td className="amount"><b>{sarMoney(entry.unconverted_sar)}</b></td>
                <td><span className={`status ${entry.status.toLowerCase()}`}>{entry.status}</span></td>
                <td><div className="row-actions"><button type="button" disabled={!canEdit || entry.status !== "ACTIVE" || busy} onClick={() => edit(entry)}>Edit</button><button type="button" disabled={!canVoid || entry.status !== "ACTIVE" || busy} onClick={() => void voidEntry(entry)}>Void</button></div></td>
              </tr>)}</tbody>
            </table>
          </div>
        )}
      </section>
    );
  }

  return mode === "REGISTER" ? renderRegister() : renderForm();
}
