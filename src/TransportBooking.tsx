import { useEffect, useMemo, useState } from "react";
import {
  BookingTransactionType,
  Party,
  TransportBooking,
  TransportBookingInput,
  TransportBookingLineInput,
  TransportType,
  TransportVehicleType,
  createTransportBooking,
  getTransportBookings,
  updateTransportBooking,
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

type ViewMode = "FORM" | "REGISTER";
type RegisterFilter = "ALL" | BookingTransactionType;
type RouteChoice = "JEDDAH_AIRPORT" | "MAKKAH" | "MADINAH" | "MADINAH_AIRPORT" | "OTHER";

type RowState = {
  rowId: string;
  transportDate: string;
  transportType: TransportType;
  fromChoice: RouteChoice;
  fromCustom: string;
  toChoice: RouteChoice;
  toCustom: string;
  vehicleType: TransportVehicleType;
  customVehicleName: string;
  vehicleCount: string;
  rateSar: string;
  paxCount: string;
  roe: string;
};

const routes: Array<{ value: RouteChoice; label: string }> = [
  { value: "JEDDAH_AIRPORT", label: "Jeddah Airport" },
  { value: "MAKKAH", label: "Makkah" },
  { value: "MADINAH", label: "Madinah" },
  { value: "MADINAH_AIRPORT", label: "Madinah Airport" },
  { value: "OTHER", label: "Other / Custom Location" },
];

const vehicles: Array<{ value: TransportVehicleType; label: string }> = [
  { value: "CAR", label: "Car" },
  { value: "GMC_YUKON", label: "GMC Yukon" },
  { value: "STARIA", label: "Staria" },
  { value: "STAREX", label: "Starex" },
  { value: "HIACE", label: "Hiace" },
  { value: "COASTER", label: "Coaster" },
  { value: "BUS", label: "Bus" },
  { value: "OTHER", label: "Other / Custom Vehicle" },
];

// Operational passenger-capacity rules used by Transport Booking validation.
// Starex follows the same 6-pax operating capacity as Staria in this patch.
const vehicleCapacity: Partial<Record<TransportVehicleType, number>> = {
  CAR: 3,
  GMC_YUKON: 5,
  STARIA: 6,
  STAREX: 6,
  HIACE: 10,
  COASTER: 16,
  BUS: 47,
};

const capacityVehicleOrder: TransportVehicleType[] = [
  "CAR", "GMC_YUKON", "STARIA", "HIACE", "COASTER", "BUS",
];

const localDate = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const num = (value: string) => (Number.isFinite(Number(value)) ? Number(value) : 0);
const whole = (value: string) => Math.max(0, Math.trunc(num(value)));
const sar = (value: number) => `SAR ${Number(value || 0).toLocaleString("en-PK", { maximumFractionDigits: 2 })}`;
const pkr = (value: number) => `Rs ${Number(value || 0).toLocaleString("en-PK", { maximumFractionDigits: 2 })}`;
const vehicleLabel = (value: TransportVehicleType, custom = "") => value === "SHARING_BUS" ? "Sharing Bus" : value === "OTHER" ? (custom || "Custom Vehicle") : (vehicles.find((x) => x.value === value)?.label || value);
const routeLabel = (choice: RouteChoice, custom: string) => choice === "OTHER" ? custom.trim() : (routes.find((x) => x.value === choice)?.label || "");

function routeState(value: string): { choice: RouteChoice; custom: string } {
  const found = routes.find((x) => x.label.toLowerCase() === value.trim().toLowerCase() && x.value !== "OTHER");
  return found ? { choice: found.value, custom: "" } : { choice: "OTHER", custom: value };
}

function newRow(defaultDate = localDate(), fromLocation = "", roe = ""): RowState {
  const from = fromLocation ? routeState(fromLocation) : { choice: "JEDDAH_AIRPORT" as RouteChoice, custom: "" };
  return {
    rowId: crypto.randomUUID(),
    transportDate: defaultDate,
    transportType: "PRIVATE_VEHICLE",
    fromChoice: from.choice,
    fromCustom: from.custom,
    toChoice: "MAKKAH",
    toCustom: "",
    vehicleType: "STARIA",
    customVehicleName: "",
    vehicleCount: "1",
    rateSar: "",
    paxCount: "",
    roe,
  };
}

function calcRow(row: RowState) {
  const rate = Math.max(0, num(row.rateSar));
  const pax = whole(row.paxCount);
  const vehiclesQty = Math.max(0, whole(row.vehicleCount));
  const totalSar = row.transportType === "SHARING_BUS" ? rate * pax : rate * vehiclesQty;
  const roe = Math.max(0, num(row.roe));
  return { totalSar, totalPkr: roe > 0 ? totalSar * roe : 0, roe };
}

function privateCapacity(row: RowState) {
  if (row.transportType !== "PRIVATE_VEHICLE") return null;
  const perVehicle = vehicleCapacity[row.vehicleType];
  if (!perVehicle) return null;
  return perVehicle * Math.max(1, whole(row.vehicleCount));
}

function suggestedVehicleForPax(pax: number) {
  if (pax <= 0) return null;
  return capacityVehicleOrder.find((type) => (vehicleCapacity[type] || 0) >= pax) || null;
}

function vehicleDescription(label: string, qty: number) {
  if (qty <= 1) return `1 ${label}`;
  if (label === "Bus") return `${qty} Buses`;
  if (label === "Hiace") return `${qty} Hiace`;
  if (label === "Staria") return `${qty} Starias`;
  if (label === "Starex") return `${qty} Starex`;
  return `${qty} ${label}s`;
}

export default function TransportBookingModule({
  companyId,parties,transactionType,userId="",canCreate=true,canEdit=true,onBack,onChanged,
}: Props) {
  const [mode,setMode] = useState<ViewMode>("FORM");
  const [activeTransactionType,setActiveTransactionType] = useState(transactionType);
  const [counterpartyId,setCounterpartyId] = useState("");
  const [bookingDate,setBookingDate] = useState(localDate());
  const [ubNumber,setUbNumber] = useState("");
  const [rows,setRows] = useState<RowState[]>([newRow()]);
  const [chainRoutes,setChainRoutes] = useState(true);
  const [paxSaudiNumber,setPaxSaudiNumber] = useState("");
  const [notes,setNotes] = useState("");
  const [entries,setEntries] = useState<TransportBooking[]>([]);
  const [editingId,setEditingId] = useState<string | null>(null);
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState("");
  const [message,setMessage] = useState("");
  const [search,setSearch] = useState("");
  const [registerFilter,setRegisterFilter] = useState<RegisterFilter>("ALL");

  useEffect(() => { if (!editingId) setActiveTransactionType(transactionType); }, [transactionType,editingId]);
  useEffect(() => { void loadEntries(""); }, [companyId]);

  const eligible = useMemo(() => parties.filter((x) => x.status === "ACTIVE" && x.account_type === (activeTransactionType === "SALE" ? "PARTY" : "VENDOR")), [parties,activeTransactionType]);
  const summary = useMemo(() => {
    let sharingPax=0,privateTrips=0,privateVehicles=0,sharingSar=0,privateSar=0,totalPkr=0,pendingSar=0;
    for (const row of rows) {
      const c=calcRow(row);
      if (row.transportType === "SHARING_BUS") { sharingPax += whole(row.paxCount); sharingSar += c.totalSar; }
      else { privateTrips += 1; privateVehicles += whole(row.vehicleCount); privateSar += c.totalSar; }
      totalPkr += c.totalPkr;
      if (c.totalSar > 0 && c.roe <= 0) pendingSar += c.totalSar;
    }
    return { sectors: rows.length,sharingPax,privateTrips,privateVehicles,sharingSar,privateSar,totalSar:sharingSar+privateSar,totalPkr,pendingSar };
  },[rows]);

  const visibleEntries = entries.filter((x) => registerFilter === "ALL" || x.transaction_type === registerFilter);
  const activeEntries = entries.filter((x) => x.status === "ACTIVE");
  const activeSaleSar = activeEntries.filter((x) => x.transaction_type === "SALE").reduce((a,b)=>a+Number(b.total_sar||0),0);
  const activePurchaseSar = activeEntries.filter((x) => x.transaction_type === "PURCHASE").reduce((a,b)=>a+Number(b.total_sar||0),0);

  async function loadEntries(nextSearch=search) {
    try { setEntries(await getTransportBookings(companyId,nextSearch)); }
    catch(e){ setError(e instanceof Error ? e.message : String(e)); }
  }

  function resetForm() {
    setCounterpartyId(""); setBookingDate(localDate()); setUbNumber(""); setRows([newRow()]); setChainRoutes(true);
    setPaxSaudiNumber(""); setNotes(""); setEditingId(null); setError("");
  }

  function updateRow(rowId:string,patch:Partial<RowState>) {
    setRows((current)=>current.map((r)=>r.rowId===rowId?{...r,...patch}:r));
  }

  function addRow() {
    const previous=rows[rows.length-1];
    const previousTo=previous ? routeLabel(previous.toChoice,previous.toCustom) : "";
    const previousRoe=previous?.roe || "";
    setRows((current)=>[...current,newRow(previous?.transportDate || bookingDate,chainRoutes?previousTo:"",previousRoe)]);
  }

  function removeRow(rowId:string) {
    setRows((current)=>current.length===1?[newRow(bookingDate)]:current.filter((r)=>r.rowId!==rowId));
  }

  function changeType(row:RowState,next:TransportType) {
    if (next === "SHARING_BUS") updateRow(row.rowId,{ transportType:next,vehicleType:"SHARING_BUS",customVehicleName:"",vehicleCount:"" });
    else updateRow(row.rowId,{ transportType:next,vehicleType:row.vehicleType === "SHARING_BUS" ? "STARIA" : row.vehicleType,vehicleCount:row.vehicleCount || "1" });
  }

  function capacityMessage(row: RowState) {
    const pax = whole(row.paxCount);
    const capacity = privateCapacity(row);
    if (row.transportType !== "PRIVATE_VEHICLE" || pax <= 0 || capacity === null || pax <= capacity) return "";
    const qty = Math.max(1, whole(row.vehicleCount));
    const currentLabel = vehicleLabel(row.vehicleType,row.customVehicleName);
    const suggested = suggestedVehicleForPax(pax);
    const suggestedText = suggested
      ? `\n\nSuggested single-vehicle option: ${vehicleLabel(suggested)} — capacity ${vehicleCapacity[suggested]} Pax.`
      : "\n\nPlease increase the number of vehicles or choose a larger suitable vehicle.";
    return `Vehicle Capacity Exceeded\n\n${vehicleDescription(currentLabel,qty)} can accommodate a maximum of ${capacity} passengers.\nEntered Pax: ${pax}.${suggestedText}\nYou can also increase No. of Vehicles.`;
  }

  function warnIfCapacityExceeded(row: RowState) {
    const text = capacityMessage(row);
    if (!text) return false;
    window.alert(text);
    return true;
  }

  function changeVehicle(row: RowState, next: TransportVehicleType) {
    const nextRow = { ...row, vehicleType: next, customVehicleName: next === "OTHER" ? row.customVehicleName : "" };
    if (next !== "OTHER" && warnIfCapacityExceeded(nextRow)) return;
    updateRow(row.rowId,{vehicleType:next,customVehicleName:next === "OTHER" ? row.customVehicleName : ""});
  }

  function makeInput():TransportBookingInput {
    const lines:TransportBookingLineInput[]=rows.map((r)=>({
      transportDate:r.transportDate,
      transportType:r.transportType,
      fromLocation:routeLabel(r.fromChoice,r.fromCustom),
      toLocation:routeLabel(r.toChoice,r.toCustom),
      vehicleType:r.transportType === "SHARING_BUS" ? "SHARING_BUS" : r.vehicleType,
      customVehicleName:r.transportType === "PRIVATE_VEHICLE" ? r.customVehicleName : "",
      vehicleCount:r.transportType === "PRIVATE_VEHICLE" ? whole(r.vehicleCount) : 0,
      rateSar:num(r.rateSar),
      paxCount:whole(r.paxCount),
      roe:r.roe.trim()?num(r.roe):null,
    }));
    return { transactionType:activeTransactionType,counterpartyId,transactionDate:bookingDate,ubNumber,paxSaudiNumber,notes,lines };
  }

  async function saveBooking() {
    setError(""); setMessage("");
    const invalidRow = rows.find((row) => Boolean(capacityMessage(row)));
    if (invalidRow) {
      warnIfCapacityExceeded(invalidRow);
      setError("Private Vehicle capacity is insufficient for one or more Transport rows. Please correct the vehicle or number of vehicles.");
      return;
    }
    setBusy(true);
    try {
      if (editingId) { await updateTransportBooking(companyId,editingId,makeInput(),userId); setMessage("Transport booking updated successfully."); }
      else { await createTransportBooking(companyId,makeInput(),userId); setMessage("Transport booking saved successfully."); }
      await loadEntries(""); await onChanged?.(); resetForm();
    } catch(e){ setError(e instanceof Error?e.message:String(e)); }
    finally{ setBusy(false); }
  }



  function renderForm() {
    return <div className="transport12a-page">
      <div className="booking-screen-toolbar">
        <button type="button" className="booking-back-button" onClick={onBack}>← Back to Booking Services</button>
        <button type="button" className="booking-foundation-badge active-engine transport12a-register-button" onClick={()=>{setMode("REGISTER");void loadEntries();}}>▣ Transport Booking Register</button>
      </div>
      <div className="transport12a-title"><div><span className="eyebrow blue">TRANSPORT BOOKING</span><h2>{editingId?"Edit Transport Booking":"New Transport Booking"}</h2><p>Independent Sharing Bus and Private Vehicle transport with SAR → PKR conversion.</p></div><span className={`direction-badge ${activeTransactionType === "SALE" ? "sale" : "purchase"}`}>{activeTransactionType === "SALE" ? "SALE TO PARTY" : "PURCHASE FROM VENDOR"}</span></div>
      {message && <div className="alert success">{message}</div>}{error && <div className="alert error">{error}</div>}

      <div className="transport12a-section">
        <div className="transport12a-section-title"><span>1</span><b>SELECT PARTY / VENDOR & ASSIGN BOOKING NUMBER</b></div>
        <div className="transport12a-header-grid">
          <label>{activeTransactionType === "SALE" ? "Party Name" : "Vendor / Supplier Name"} *<select value={counterpartyId} onChange={(e)=>setCounterpartyId(e.target.value)}><option value="">Select {activeTransactionType === "SALE" ? "Party" : "Vendor"}</option>{eligible.map((x)=><option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
          <label>Date of Booking *<input type="date" value={bookingDate} onChange={(e)=>setBookingDate(e.target.value)} /></label>
          <label>UB / Booking # *<input value={ubNumber} onChange={(e)=>setUbNumber(e.target.value)} placeholder="e.g. UB-2205" /></label>
        </div>
      </div>

      <div className="transport12a-section">
        <div className="transport12a-section-title transport12a-row-title"><div><span>2</span><b>TRANSPORT DETAILS & RATES</b></div><button type="button" className="primary" onClick={addRow}>+ Add Transport Row</button></div>
        <div className="transport12a-hint"><b>Sharing Bus:</b> Rate SAR / Pax × No. of Pax. <b>Private Vehicle:</b> Rate SAR / Vehicle × No. of Vehicles. Pax remains operational information for Private Vehicle.</div>
        <div className="transport12a-table-wrap"><table className="transport12a-table"><thead><tr><th>SR</th><th>TRANSPORT DATE</th><th>TRANSPORT TYPE</th><th>FROM</th><th>TO</th><th>VEHICLE TYPE</th><th>NO. VEHICLES</th><th>RATE SAR</th><th>NO. PAX</th><th>ROE</th><th>TOTAL SAR</th><th>TOTAL PKR</th><th>ACTION</th></tr></thead><tbody>
          {rows.map((row,index)=>{const c=calcRow(row);return <tr key={row.rowId}><td className="transport12a-sr">{index+1}</td>
            <td><input type="date" value={row.transportDate} onChange={(e)=>updateRow(row.rowId,{transportDate:e.target.value})}/></td>
            <td><select value={row.transportType} onChange={(e)=>changeType(row,e.target.value as TransportType)}><option value="SHARING_BUS">Sharing Bus</option><option value="PRIVATE_VEHICLE">Private Vehicle</option></select></td>
            <td><select value={row.fromChoice} onChange={(e)=>updateRow(row.rowId,{fromChoice:e.target.value as RouteChoice,fromCustom:e.target.value === "OTHER" ? row.fromCustom : ""})}>{routes.map((x)=><option key={x.value} value={x.value}>{x.label}</option>)}</select>{row.fromChoice === "OTHER" && <input className="transport12a-custom" value={row.fromCustom} onChange={(e)=>updateRow(row.rowId,{fromCustom:e.target.value})} placeholder="Custom From"/>}</td>
            <td><select value={row.toChoice} onChange={(e)=>updateRow(row.rowId,{toChoice:e.target.value as RouteChoice,toCustom:e.target.value === "OTHER" ? row.toCustom : ""})}>{routes.map((x)=><option key={x.value} value={x.value}>{x.label}</option>)}</select>{row.toChoice === "OTHER" && <input className="transport12a-custom" value={row.toCustom} onChange={(e)=>updateRow(row.rowId,{toCustom:e.target.value})} placeholder="Custom To"/>}</td>
            <td>{row.transportType === "SHARING_BUS" ? <div className="transport12a-fixed">🚌 Sharing Bus</div> : <><select value={row.vehicleType} onChange={(e)=>changeVehicle(row,e.target.value as TransportVehicleType)}>{vehicles.map((x)=><option key={x.value} value={x.value}>{x.label}</option>)}</select>{row.vehicleType === "OTHER" && <input className="transport12a-custom" value={row.customVehicleName} onChange={(e)=>updateRow(row.rowId,{customVehicleName:e.target.value})} placeholder="Vehicle name"/>}{row.vehicleType !== "OTHER" && vehicleCapacity[row.vehicleType] && <small className={capacityMessage(row)?"transport12b-capacity bad":"transport12b-capacity"}>Capacity: {privateCapacity(row)} Pax{whole(row.paxCount)>0?` · Required: ${whole(row.paxCount)}`:""}</small>}</>}</td>
            <td>{row.transportType === "PRIVATE_VEHICLE" ? <input type="number" min="1" value={row.vehicleCount} onChange={(e)=>updateRow(row.rowId,{vehicleCount:e.target.value})} onBlur={()=>warnIfCapacityExceeded(row)}/> : <span className="transport12a-na">—</span>}</td>
            <td><div className="transport12a-money-input"><span>SAR</span><input type="number" min="0" step="0.01" value={row.rateSar} onChange={(e)=>updateRow(row.rowId,{rateSar:e.target.value})} placeholder={row.transportType === "SHARING_BUS" ? "Rate / Pax" : "Rate / Vehicle"}/></div><small>{row.transportType === "SHARING_BUS" ? "Per Pax" : "Per Vehicle"}</small></td>
            <td><input type="number" min="1" value={row.paxCount} onChange={(e)=>updateRow(row.rowId,{paxCount:e.target.value})} onBlur={()=>warnIfCapacityExceeded(row)}/></td>
            <td><input type="number" min="0" step="0.01" value={row.roe} onChange={(e)=>updateRow(row.rowId,{roe:e.target.value})} placeholder="Riyal Rate"/></td>
            <td className="transport12a-total-sar"><b>{sar(c.totalSar)}</b></td><td className="transport12a-total-pkr"><b>{c.roe>0?pkr(c.totalPkr):"—"}</b>{c.totalSar>0 && c.roe<=0 && <small>ROE pending</small>}</td>
            <td><button type="button" className="transport12a-delete" onClick={()=>removeRow(row.rowId)}>×</button></td>
          </tr>})}
        </tbody></table></div>
        <label className="transport12a-chain"><input type="checkbox" checked={chainRoutes} onChange={(e)=>setChainRoutes(e.target.checked)}/> Use previous destination as next origin when adding a new row</label>
      </div>

      <div className="transport12a-section transport12a-summary-section">
        <div className="transport12a-section-title"><span>3</span><b>TRANSPORT BOOKING SUMMARY</b></div>
        <div className="transport12a-summary-grid">
          <div><small>Transport Sectors</small><b>{summary.sectors}</b></div><div><small>Sharing Pax Entries</small><b>{summary.sharingPax}</b></div><div><small>Private Vehicle Trips</small><b>{summary.privateTrips}</b></div><div><small>Total Private Vehicles</small><b>{summary.privateVehicles}</b></div>
          <div className="money"><small>Sharing Transport SAR</small><b>{sar(summary.sharingSar)}</b></div><div className="money"><small>Private Transport SAR</small><b>{sar(summary.privateSar)}</b></div><div className="money grand"><small>GRAND TOTAL SAR</small><b>{sar(summary.totalSar)}</b></div><div className="money grand pkr"><small>GRAND TOTAL PKR</small><b>{pkr(summary.totalPkr)}</b></div>
        </div>{summary.pendingSar>0 && <div className="transport12a-pending">ROE Pending for {sar(summary.pendingSar)}. Original SAR remains included in Grand Total SAR.</div>}
      </div>

      <div className="transport12a-section">
        <div className="transport12a-section-title"><span>4</span><b>TRANSPORT BOOKING DETAILS</b></div>
        <div className="transport12a-details-grid">
          <label>Pax Saudi Number<input value={paxSaudiNumber} onChange={(e)=>setPaxSaudiNumber(e.target.value)} placeholder="e.g. +966 5X XXX XXXX" /></label>
          <label>Notes<textarea value={notes} onChange={(e)=>setNotes(e.target.value)} rows={4} placeholder="Enter transport booking notes, pickup instructions, driver coordination or other remarks..." /></label>
        </div>
      </div>

      <div className="transport12a-actions"><button type="button" className="secondary" onClick={resetForm}>Clear</button><button type="button" className="primary transport12a-save" disabled={busy || (editingId ? !canEdit : !canCreate)} onClick={()=>void saveBooking()}>{busy?"Saving...":editingId?"Update TRANSPORT Booking":"Save TRANSPORT Booking"}</button></div>
    </div>;
  }

  function renderRegister() {
    return <div className="transport12a-page">
      <div className="booking-screen-toolbar"><button type="button" className="booking-back-button" onClick={()=>setMode("FORM")}>← Back to Transport Booking</button><span className="booking-foundation-badge active-engine">TRANSPORT REGISTER</span></div>
      <div className="transport12a-title"><div><span className="eyebrow blue">TRANSPORT BOOKING REGISTER</span><h2>Transport Booking Register</h2><p>Independent Transport Sale and Purchase records only.</p></div></div>
      {message && <div className="alert success">{message}</div>}{error && <div className="alert error">{error}</div>}
      <div className="transport12a-register-stats"><div><small>ACTIVE</small><b>{activeEntries.length}</b></div><div><small>SALES SAR</small><b>{sar(activeSaleSar)}</b></div><div><small>PURCHASES SAR</small><b>{sar(activePurchaseSar)}</b></div></div>
      <div className="transport12a-register-controls"><div>{(["ALL","SALE","PURCHASE"] as RegisterFilter[]).map((f)=><button type="button" key={f} className={registerFilter===f?"active":""} onClick={()=>setRegisterFilter(f)}>{f === "ALL" ? "All Transport Bookings" : f === "SALE" ? "Sales" : "Purchases"}</button>)}</div><input value={search} onChange={(e)=>{setSearch(e.target.value);void loadEntries(e.target.value)}} placeholder="Search UB, Party/Vendor, route, vehicle or notes..."/></div>
      {visibleEntries.length===0?<div className="empty-state compact-empty"><div className="empty-icon">BUS</div><h3>No transport bookings found</h3><p>Create a Transport booking or change the register filter/search.</p></div>:<div className="party-table-wrap transport12a-register-wrap"><table className="party-table transport12a-register-table transport12b-register-table"><thead><tr><th>DATE</th><th>UB #</th><th>TYPE</th><th>PARTY / VENDOR</th><th>TRANSPORT DESCRIPTION</th><th>TOTAL SAR</th><th>TOTAL PKR</th></tr></thead><tbody>{visibleEntries.map((entry)=><tr key={entry.id} className={entry.status === "VOID" ? "void-row" : ""}><td>{entry.transaction_date}</td><td><b>{entry.ub_number}</b></td><td><span className={`direction-badge ${entry.transaction_type === "SALE" ? "sale" : "purchase"}`}>{entry.transaction_type}</span></td><td><b>{entry.counterparty_name || "—"}</b></td><td><div className="transport12a-register-lines">{entry.lines.map((line)=><div key={line.id}><b>{line.from_location} → {line.to_location}</b><span>{line.transport_type === "SHARING_BUS" ? `Sharing Bus · ${line.pax_count} Pax` : `${vehicleDescription(vehicleLabel(line.vehicle_type,line.custom_vehicle_name),Math.max(1,line.vehicle_count))} · ${line.pax_count} Pax`}</span></div>)}</div></td><td><b>{sar(entry.total_sar)}</b>{entry.unconverted_sar>0&&<small className="transport12a-register-pending">ROE pending {sar(entry.unconverted_sar)}</small>}</td><td><b>{pkr(entry.total_pkr)}</b></td></tr>)}</tbody></table></div>}
    </div>;
  }

  return mode === "REGISTER" ? renderRegister() : renderForm();
}
