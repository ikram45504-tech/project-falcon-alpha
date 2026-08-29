import { useEffect, useMemo, useState } from "react";
import type {
  BookingTransactionType,
  Party,
  TransportBooking,
  TransportBookingInput,
  TransportBookingLineInput,
  TransportType,
  TransportVehicleType,
} from "./db";
import { createTransportBooking, getTransportBookings } from "./db";
import ProgressiveBookingIdentity from "./ProgressiveBookingIdentity";
import TransportRegister from "./TransportRegister";
import { bookingDigitsFromUb } from "./bookingUb";
import {
  getTransportOperationalDetails,
  saveTransportOperationalDetails,
  type TransportOperationalSector,
} from "./TransportOperationalDb";
import { transportRowCalc, transportRowCapacity, calculateTransportSummary } from "./pricingEngines";
import { useBookingFlowState } from "./useBookingFlowState";
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
type RouteChoice = string;
type Row = {
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
type OperationalRow = Omit<TransportOperationalSector, "id" | "sortOrder"> & { rowId: string };

const locations = ["Jeddah Airport", "Makkah", "Madinah", "Madinah Airport"];
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

function newRow(date = "", from = "", roe = ""): Row {
  return {
    rowId: crypto.randomUUID(),
    transportDate: date,
    transportType: "PRIVATE_VEHICLE",
    fromChoice: from,
    fromCustom: "",
    toChoice: "",
    toCustom: "",
    vehicleType: "STARIA",
    customVehicleName: "",
    paxCount: "1",
    vehicleCount: "1",
    rateSar: "",
    roe,
  };
}
function routeLabel(choice: string, custom: string) {
  return choice === "OTHER" ? custom.trim() || "Unknown" : choice;
}
function money(value: number, currency = "SAR") {
  return `${currency} ${Number(value || 0).toLocaleString("en-PK", { maximumFractionDigits: 2 })}`;
}
function pkr(value: number) {
  return `Rs ${Number(value || 0).toLocaleString("en-PK", { maximumFractionDigits: 2 })}`;
}
function vehicleText(row: Row) {
  return row.transportType === "SHARING_BUS"
    ? "Sharing Bus"
    : row.customVehicleName.trim() || vehicles.find((item) => item.value === row.vehicleType)?.label || row.vehicleType;
}

export default function TransportBookingFlowV3({
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
  const [entries, setEntries] = useState<TransportBooking[]>([]);
  const {
    mode,
    setMode,
    tx,
    setTx,
    counterpartyId,
    setCounterpartyId,
    bookingDate,
    setBookingDate,
    ubDigits,
    setUbDigits,
    ubNumber,
    setUbNumber,
    assigned,
    setAssigned,
    saved,
    setSaved,
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
    assignUb: assign,
    resetState,
  } = useBookingFlowState(companyId, transactionType, entries, "Transport");

  const [rows, setRows] = useState<Row[]>([newRow()]);
  const [chain, setChain] = useState(true);
  const [operationalRows, setOperationalRows] = useState<OperationalRow[]>([]);
  const [passengerSaudiContact, setPassengerSaudiContact] = useState("");
  const [groupFamilyHead, setGroupFamilyHead] = useState("");
  const [transportInstructions, setTransportInstructions] = useState("");
  const [notes, setNotes] = useState("");
  const [legacySaudiNumber, setLegacySaudiNumber] = useState("");
  const [legacyNotes, setLegacyNotes] = useState("");
  useEffect(() => {
    void loadEntries();
  }, [companyId]);

  const summary = useMemo(() => calculateTransportSummary(rows), [rows]);
  const commercialLocked = Boolean(editingId);

  async function loadEntries() {
    try {
      setEntries(await getTransportBookings(companyId));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }
  function reset() {
    resetState();
    setRows([newRow()]);
    setChain(true);
    setOperationalRows([]);
    setPassengerSaudiContact("");
    setGroupFamilyHead("");
    setTransportInstructions("");
    setNotes("");
    setLegacySaudiNumber("");
    setLegacyNotes("");
  }
  function update(rowId: string, patch: Partial<Row>) {
    if (commercialLocked) return;
    setRows((current) => current.map((row) => (row.rowId === rowId ? { ...row, ...patch } : row)));
  }
  function add() {
    if (commercialLocked) return;
    const previous = rows[rows.length - 1];
    setRows((current) => [
      ...current,
      newRow(previous?.transportDate || bookingDate, chain && previous ? previous.toChoice : "", previous?.roe || ""),
    ]);
  }
  function remove(rowId: string) {
    if (commercialLocked) return;
    setRows((current) => (current.length === 1 ? [newRow(bookingDate)] : current.filter((row) => row.rowId !== rowId)));
  }
  function changeType(row: Row, type: TransportType) {
    if (commercialLocked) return;
    if (type === "SHARING_BUS")
      update(row.rowId, { transportType: type, vehicleType: "SHARING_BUS", customVehicleName: "", vehicleCount: "" });
    else
      update(row.rowId, {
        transportType: type,
        vehicleType: row.vehicleType === "SHARING_BUS" ? "STARIA" : row.vehicleType,
        vehicleCount: row.vehicleCount || "1",
      });
  }
  function capacityError(row: Row) {
    const pax = Number(row.paxCount) || 0,
      cap = transportRowCapacity(row);
    return row.transportType === "PRIVATE_VEHICLE" && pax > 0 && cap !== null && pax > cap
      ? `Transport row requires capacity for ${pax} Pax but selected vehicle holds ${cap} Pax.`
      : "";
  }
  function lineInputs(): TransportBookingLineInput[] {
    return rows.map((row) => ({
      transportDate: row.transportDate,
      transportType: row.transportType,
      fromLocation: routeLabel(row.fromChoice, row.fromCustom),
      toLocation: routeLabel(row.toChoice, row.toCustom),
      vehicleType: row.transportType === "SHARING_BUS" ? "SHARING_BUS" : row.vehicleType,
      customVehicleName: row.transportType === "PRIVATE_VEHICLE" ? row.customVehicleName : "",
      vehicleCount: row.transportType === "PRIVATE_VEHICLE" ? Math.floor(Number(row.vehicleCount) || 0) : 0,
      rateSar: Number(row.rateSar) || 0,
      paxCount: Math.floor(Number(row.paxCount) || 0),
      roe: row.roe.trim() ? Number(row.roe) : null,
    }));
  }
  function input(): TransportBookingInput {
    return {
      transactionType: tx,
      counterpartyId,
      transactionDate: bookingDate,
      ubNumber,
      paxSaudiNumber: legacySaudiNumber,
      notes: legacyNotes,
      lines: lineInputs(),
    };
  }
  function syncOperational(existing = operationalRows) {
    const next = rows.map((_, index) => {
      const found = existing.find((item) => item.sectorSortOrder === index);
      return (
        found || {
          rowId: crypto.randomUUID(),
          sectorSortOrder: index,
          pickupTime: "",
          pickupPoint: "",
          driverName: "",
          driverMobile: "",
          vehiclePlate: "",
          confirmationReference: "",
        }
      );
    });
    setOperationalRows(next);
  }

  async function saveCommercial() {
    if (editingId)
      return setError(
        "Commercial Transport values are locked after saving. Use Transport Booking Register → Booking Adjustment for Correction, Amendment or Cancellation.",
      );
    if (!assigned) return setError("Create / Assign the Booking UB first.");
    const invalid = rows.find((row) => capacityError(row));
    if (invalid) return setError(capacityError(invalid));
    setBusy(true);
    setError("");
    try {
      const id = await createTransportBooking(companyId, input(), userId);
      setEditingId(id);
      setSaved(true);
      setMessage(`Transport booking ${ubNumber} saved. Optional Transport Operations are now available.`);
      syncOperational();
      await loadEntries();
      await onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function saveDetails() {
    if (!editingId) return;
    setBusy(true);
    setError("");
    try {
      await saveTransportOperationalDetails(
        companyId,
        editingId,
        {
          sectors: operationalRows.map((row) => ({
            sectorSortOrder: row.sectorSortOrder,
            pickupTime: row.pickupTime,
            pickupPoint: row.pickupPoint,
            driverName: row.driverName,
            driverMobile: row.driverMobile,
            vehiclePlate: row.vehiclePlate,
            confirmationReference: row.confirmationReference,
          })),
          passengerSaudiContact,
          groupFamilyHead,
          transportInstructions,
          notes,
        },
        userId,
      );
      setMessage(`Transport Booking Details for ${ubNumber} saved.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function openEntry(entry: TransportBooking) {
    if (entry.status !== "ACTIVE") return;
    setTx(entry.transaction_type);
    setCounterpartyId(entry.counterparty_id);
    setBookingDate(entry.transaction_date);
    setUbNumber(entry.ub_number);
    setUbDigits(bookingDigitsFromUb(entry.ub_number));
    setAssigned(true);
    setSaved(true);
    setDetailsOpen(false);
    setEditingId(entry.id);
    setLegacySaudiNumber(entry.pax_saudi_number || "");
    setLegacyNotes(entry.notes || "");
    const mapped = entry.lines.length
      ? entry.lines.map((line) => {
          return {
            rowId: crypto.randomUUID(),
            transportDate: line.transport_date,
            transportType: line.transport_type,
            fromChoice: line.from_location,
            fromCustom: "",
            toChoice: line.to_location,
            toCustom: "",
            vehicleType: line.vehicle_type,
            customVehicleName: line.custom_vehicle_name,
            vehicleCount: line.transport_type === "PRIVATE_VEHICLE" ? String(line.vehicle_count || 1) : "",
            rateSar: String(line.rate_sar || ""),
            paxCount: String(line.pax_count || ""),
            roe: Number(line.roe || 0) > 0 ? String(line.roe) : "",
          };
        })
      : [newRow()];
    setRows(mapped);
    const details = await getTransportOperationalDetails(companyId, entry.id);
    setOperationalRows(details.sectors.map((item) => ({ ...item, rowId: crypto.randomUUID() })));
    setPassengerSaudiContact(details.passengerSaudiContact || entry.pax_saudi_number || "");
    setGroupFamilyHead(details.groupFamilyHead);
    setTransportInstructions(details.transportInstructions);
    setNotes(details.notes || entry.notes || "");
    setMode("FORM");
    setMessage(
      `Opened Transport booking ${entry.ub_number}. Commercial values are read-only here; use Booking Adjustment from the Transport Booking Register. Section 03 operational details remain available.`,
    );
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function openEntryById(bookingId: string) {
    const latest = await getTransportBookings(companyId);
    setEntries(latest);
    const entry = latest.find((item) => item.id === bookingId);
    if (entry) await openEntry(entry);
  }
  async function lifecycleChanged() {
    await loadEntries();
    await onChanged?.();
  }
  function updateOperational(rowId: string, patch: Partial<OperationalRow>) {
    setOperationalRows((current) => current.map((row) => (row.rowId === rowId ? { ...row, ...patch } : row)));
  }

  if (mode === "REGISTER")
    return (
      <TransportRegister
        companyId={companyId}
        transactionType={transactionType}
        userId={userId}
        canEdit={canEdit}
        canVoid={canVoid}
        onBack={() => setMode("FORM")}
        onOpenBooking={openEntryById}
        onChanged={lifecycleChanged}
      />
    );

  return (
    <section className="booking-entry-screen bf-page package14-page">
      <div className="booking-screen-toolbar">
        <button className="booking-back-button" onClick={onBack}>
          ← Back to Booking Services
        </button>
        <div className="bf-toolbar-actions">
          <span className={`direction-badge ${tx === "SALE" ? "sale" : "purchase"}`}>
            {tx === "SALE" ? "SALE TO PARTY" : "PURCHASE FROM VENDOR / SUPPLIER"}
          </span>
          <button className="booking-foundation-badge active-engine" onClick={() => setMode("REGISTER")}>
            Transport Booking Register
          </button>
        </div>
      </div>
      <div className="bf-title">
        <div>
          <span className="eyebrow blue">TRANSPORT BOOKING</span>
          <h2>{saved ? `Transport Booking — ${ubNumber}` : "New Transport Booking"}</h2>
          <p>
            {editingId
              ? "Review the current effective Transport booking. Commercial changes are protected by Booking Adjustment history."
              : "Create the UB first, save Transport accounting second, then complete optional pickup / driver operations."}
          </p>
        </div>
      </div>
      {message && <div className="alert success">{message}</div>}
      {error && <div className="alert error">{error}</div>}
      <ProgressiveBookingIdentity
        companyId={companyId}
        userId={userId}
        transactionType={tx}
        parties={parties}
        counterpartyId={counterpartyId}
        onCounterpartyChange={setCounterpartyId}
        bookingDate={bookingDate}
        onBookingDateChange={setBookingDate}
        ubDigits={ubDigits}
        onUbDigitsChange={setUbDigits}
        ubNumber={ubNumber}
        assigned={assigned}
        saved={saved}
        onAssign={assign}
        onEditHeader={() => {
          if (!editingId) {
            setAssigned(false);
            setMessage("");
          }
        }}
        onAccountsChanged={onChanged}
        onError={setError}
        onMessage={setMessage}
        serviceLabel="Transport"
      />

      {assigned && (
        <section className="bf-card">
          <div className="bf-section-head">
            <div>
              <span>02</span>
              <div>
                <b>TRANSPORT DETAILS & RATES</b>
                <small>
                  {commercialLocked
                    ? "Current effective commercial sectors — use Booking Adjustment to change them."
                    : `Commercial / accounting Transport sectors under ${ubNumber}`}
                </small>
              </div>
            </div>
            {!commercialLocked && (
              <button className="primary small" onClick={add}>
                + Transport Row
              </button>
            )}
          </div>
          <div className="bf-inline-toolbar">
            <label>
              <input
                disabled={commercialLocked}
                type="checkbox"
                checked={chain}
                onChange={(e) => setChain(e.target.checked)}
              />{" "}
              Use previous destination as next origin when adding a new row
            </label>
          </div>
          <div className="bf-table-wrap">
            <table className="bf-table transport-v3-table">
              <thead>
                <tr>
                  <th>SR</th>
                  <th>TRANSPORT DATE</th>
                  <th>FROM</th>
                  <th>TO</th>
                  <th>TRANSPORT TYPE</th>
                  <th>VEHICLE TYPE / NAME</th>
                  <th>QTY</th>
                  <th>PAX</th>
                  <th>RATE / VEHICLE OR PAX SAR</th>
                  <th>ROE</th>
                  <th>TOTAL SAR</th>
                  <th>TOTAL PKR</th>
                  {!commercialLocked && <th>ACTION</th>}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => {
                  const c = transportRowCalc(row);
                  const err = capacityError(row);
                  return (
                    <tr key={row.rowId}>
                      <td>{index + 1}</td>
                      <td>
                        <input
                          disabled={commercialLocked}
                          type="date"
                          value={row.transportDate}
                          onChange={(e) => update(row.rowId, { transportDate: e.target.value })}
                        />
                      </td>
                      <td>
                        <select
                          disabled={commercialLocked}
                          value={row.fromChoice}
                          onChange={(e) => update(row.rowId, { fromChoice: e.target.value })}
                        >
                          <option value="">Select / Type</option>
                          {locations.map((item) => (
                            <option key={item} value={item}>
                              {item}
                            </option>
                          ))}
                          <option value="OTHER">Custom...</option>
                        </select>
                        {row.fromChoice === "OTHER" && (
                          <input
                            disabled={commercialLocked}
                            style={{ marginTop: 4 }}
                            value={row.fromCustom}
                            onChange={(e) => update(row.rowId, { fromCustom: e.target.value })}
                            placeholder="Custom from"
                          />
                        )}
                      </td>
                      <td>
                        <select
                          disabled={commercialLocked}
                          value={row.toChoice}
                          onChange={(e) => update(row.rowId, { toChoice: e.target.value })}
                        >
                          <option value="">Select / Type</option>
                          {locations.map((item) => (
                            <option key={item} value={item}>
                              {item}
                            </option>
                          ))}
                          <option value="OTHER">Custom...</option>
                        </select>
                        {row.toChoice === "OTHER" && (
                          <input
                            disabled={commercialLocked}
                            style={{ marginTop: 4 }}
                            value={row.toCustom}
                            onChange={(e) => update(row.rowId, { toCustom: e.target.value })}
                            placeholder="Custom to"
                          />
                        )}
                      </td>
                      <td>
                        <div className="bf-radio-group">
                          <label>
                            <input
                              disabled={commercialLocked}
                              type="radio"
                              checked={row.transportType === "PRIVATE_VEHICLE"}
                              onChange={() => changeType(row, "PRIVATE_VEHICLE")}
                            />{" "}
                            Private
                          </label>
                          <label>
                            <input
                              disabled={commercialLocked}
                              type="radio"
                              checked={row.transportType === "SHARING_BUS"}
                              onChange={() => changeType(row, "SHARING_BUS")}
                            />{" "}
                            Sharing
                          </label>
                        </div>
                      </td>
                      <td>
                        {row.transportType === "PRIVATE_VEHICLE" ? (
                          <>
                            <select
                              disabled={commercialLocked}
                              value={row.vehicleType}
                              onChange={(e) =>
                                update(row.rowId, { vehicleType: e.target.value as TransportVehicleType })
                              }
                            >
                              {vehicles.map((item) => (
                                <option key={item.value} value={item.value}>
                                  {item.label}
                                </option>
                              ))}
                            </select>
                            {row.vehicleType === "OTHER" && (
                              <input
                                disabled={commercialLocked}
                                style={{ marginTop: 4 }}
                                value={row.customVehicleName}
                                onChange={(e) => update(row.rowId, { customVehicleName: e.target.value })}
                                placeholder="Vehicle name"
                              />
                            )}
                          </>
                        ) : (
                          "Sharing Bus"
                        )}
                      </td>
                      <td>
                        {row.transportType === "PRIVATE_VEHICLE" ? (
                          <input
                            disabled={commercialLocked}
                            type="number"
                            min="1"
                            value={row.vehicleCount}
                            onChange={(e) => update(row.rowId, { vehicleCount: e.target.value })}
                          />
                        ) : (
                          "—"
                        )}
                      </td>
                      <td>
                        <div className="bf-pax-cell">
                          <input
                            disabled={commercialLocked}
                            type="number"
                            min="1"
                            value={row.paxCount}
                            onChange={(e) => update(row.rowId, { paxCount: e.target.value })}
                          />
                          {err && (
                            <div className="bf-error-tooltip" title={err}>
                              ⚠️
                            </div>
                          )}
                        </div>
                      </td>
                      <td>
                        <input
                          disabled={commercialLocked}
                          type="number"
                          min="0"
                          value={row.rateSar}
                          onChange={(e) => update(row.rowId, { rateSar: e.target.value })}
                        />
                      </td>
                      <td>
                        <input
                          disabled={commercialLocked}
                          type="number"
                          min="0"
                          value={row.roe}
                          onChange={(e) => update(row.rowId, { roe: e.target.value })}
                          placeholder="Riyal Rate"
                        />
                      </td>
                      <td className="bf-money">{money(c.totalSar)}</td>
                      <td className="bf-money">{c.roe > 0 ? pkr(c.totalPkr) : "—"}</td>
                      {!commercialLocked && (
                        <td>
                          <button className="bf-remove" onClick={() => remove(row.rowId)}>
                            ×
                          </button>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="bf-summary six">
            <div>
              <small>TRANSPORT SECTORS</small>
              <b>{summary.sectors}</b>
            </div>
            <div>
              <small>SHARING PAX ENTRIES</small>
              <b>{summary.sharingPax}</b>
            </div>
            <div>
              <small>PRIVATE VEHICLE TRIPS</small>
              <b>{summary.privateTrips}</b>
            </div>
            <div>
              <small>TOTAL PRIVATE VEHICLES</small>
              <b>{summary.privateVehicles}</b>
            </div>
            <div>
              <small>GRAND TOTAL SAR</small>
              <b>{money(summary.totalSar)}</b>
            </div>
            <div className="grand">
              <small>GRAND TOTAL PKR</small>
              <b>{pkr(summary.totalPkr)}</b>
              {summary.pending > 0 && <span>{money(summary.pending)} pending ROE</span>}
            </div>
          </div>
          <div className="package14-commercial-actions">
            {saved && (
              <button className="secondary" onClick={reset}>
                + New Transport Booking
              </button>
            )}
            {!editingId && (
              <button className="primary" disabled={busy || !canCreate} onClick={() => void saveCommercial()}>
                {busy ? "Saving..." : `Save Transport Booking — ${ubNumber}`}
              </button>
            )}
            {editingId && (
              <div className="adj-rule-note">
                <b>Commercial values locked:</b> use Transport Booking Register → Booking Adjustment for Correction,
                Amendment, Partial Cancellation or Full Cancellation.
              </div>
            )}
          </div>
        </section>
      )}

      {saved && editingId && (
        <section className={`package14-additional ${detailsOpen ? "open" : "closed"}`}>
          <button
            className="package14-additional-toggle"
            onClick={() => {
              const next = !detailsOpen;
              setDetailsOpen(next);
              if (next) syncOperational();
            }}
          >
            <span className="package14-step-purple">03</span>
            <div>
              <b>TRANSPORT BOOKING DETAILS — {ubNumber}</b>
              <small>Optional pickup, driver, vehicle and movement operations. No effect on Transport totals.</small>
            </div>
            <span className="package14-optional">OPTIONAL</span>
            <strong>{detailsOpen ? "Close Details ▲" : "+ Open Details ▼"}</strong>
          </button>
          {detailsOpen && (
            <div className="package14-additional-body bf-operational-body">
              <div className="bf-subsection">
                <div className="bf-subsection-head">
                  <div>
                    <b>TRANSPORT OPERATIONS</b>
                    <small>One operational row is synchronized from every commercial Transport sector.</small>
                  </div>
                  <button className="primary small" onClick={() => syncOperational()}>
                    Sync from Section 02
                  </button>
                </div>
                <div className="bf-table-wrap">
                  <table className="bf-table" style={{ minWidth: 1450 }}>
                    <thead>
                      <tr>
                        <th>SR</th>
                        <th>DATE</th>
                        <th>ROUTE</th>
                        <th>VEHICLE</th>
                        <th>PICKUP TIME</th>
                        <th>PICKUP POINT</th>
                        <th>DRIVER NAME</th>
                        <th>DRIVER MOBILE</th>
                        <th>VEHICLE / PLATE NO.</th>
                        <th>CONFIRMATION / REF.</th>
                      </tr>
                    </thead>
                    <tbody>
                      {operationalRows.map((op, index) => {
                        const source = rows[op.sectorSortOrder];
                        return (
                          <tr key={op.rowId}>
                            <td>{index + 1}</td>
                            <td>
                              <b>{source?.transportDate || "—"}</b>
                            </td>
                            <td>
                              {source
                                ? `${routeLabel(source.fromChoice, source.fromCustom)} → ${routeLabel(source.toChoice, source.toCustom)}`
                                : "—"}
                            </td>
                            <td>{source ? vehicleText(source) : "—"}</td>
                            <td>
                              <input
                                type="time"
                                value={op.pickupTime}
                                onChange={(e) => updateOperational(op.rowId, { pickupTime: e.target.value })}
                              />
                            </td>
                            <td>
                              <input
                                value={op.pickupPoint}
                                onChange={(e) => updateOperational(op.rowId, { pickupPoint: e.target.value })}
                              />
                            </td>
                            <td>
                              <input
                                value={op.driverName}
                                onChange={(e) => updateOperational(op.rowId, { driverName: e.target.value })}
                              />
                            </td>
                            <td>
                              <input
                                value={op.driverMobile}
                                onChange={(e) => updateOperational(op.rowId, { driverMobile: e.target.value })}
                              />
                            </td>
                            <td>
                              <input
                                value={op.vehiclePlate}
                                onChange={(e) => updateOperational(op.rowId, { vehiclePlate: e.target.value })}
                              />
                            </td>
                            <td>
                              <input
                                value={op.confirmationReference}
                                onChange={(e) => updateOperational(op.rowId, { confirmationReference: e.target.value })}
                              />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
              <div className="bf-details-grid">
                <label>
                  Passenger / Group Saudi Contact
                  <input value={passengerSaudiContact} onChange={(e) => setPassengerSaudiContact(e.target.value)} />
                </label>
                <label>
                  Group / Family Head
                  <input value={groupFamilyHead} onChange={(e) => setGroupFamilyHead(e.target.value)} />
                </label>
                <label className="wide">
                  Transport Instructions
                  <textarea
                    rows={3}
                    value={transportInstructions}
                    onChange={(e) => setTransportInstructions(e.target.value)}
                  />
                </label>
                <label className="wide">
                  Internal Notes
                  <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
                </label>
              </div>
              <div className="package14-details-actions">
                <span>Operational rows are designed for the future Passenger Movement dashboard.</span>
                <button className="primary" disabled={busy || !canEdit} onClick={() => void saveDetails()}>
                  {busy ? "Saving..." : `Save Transport Details — ${ubNumber}`}
                </button>
              </div>
            </div>
          )}
        </section>
      )}

      {!assigned && (
        <div className="package14-next-step">Create / Assign a Booking UB to unlock Transport Details & Rates.</div>
      )}
      {assigned && !saved && (
        <div className="package14-next-step">
          Save Section 02 to activate the Transport booking and unlock Optional Transport Booking Details.
        </div>
      )}
    </section>
  );
}
