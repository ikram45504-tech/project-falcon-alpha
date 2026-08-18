import { useEffect, useMemo, useState } from "react";
import {
  BookingTransactionType,
  Party,
  VisaBooking,
  VisaBookingInput,
  VisaBookingLineInput,
  VisaPassengerType,
  VisaType,
  VisaVehicleType,
  VisaTransportFleetLineInput,
  VisaPassportDetailInput,
  createVisaBooking,
  getVisaBookings,
  updateVisaBooking,
  voidVisaBooking,
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

type VisaRowState = {
  rowId: string;
  passengerType: VisaPassengerType;
  passengerName: string;
  visaType: VisaType | "";
  visaRateSar: string;
  paxCount: string;
  roe: string;
};

type FleetRowState = {
  rowId: string;
  vehicleType: VisaVehicleType;
  quantity: string;
  ratePerVehicleSar: string;
};

type PassportRowState = {
  rowId: string;
  sourceFamilyName: string;
  passengerType: VisaPassengerType;
  visaType: VisaType;
  surname: string;
  givenName: string;
  passportNumber: string;
  nationality: string;
  dateOfBirth: string;
  passportIssuance: string;
  passportExpiry: string;
};

type PassportValidityLevel = "GUIDANCE" | "VALID" | "REMINDER" | "CLOSE" | "INVALID";
type PassportValidity = {
  level: PassportValidityLevel;
  latestEligibleEntry: string;
  plannedEntry: string;
  passportExpiry: string;
  remainingDays: number | null;
};

type PassportAlert = PassportValidity & {
  passengerLabel: string;
};

type ViewMode = "FORM" | "REGISTER";
type RegisterFilter = "ALL" | BookingTransactionType;

const visaTypeOptions = [
  { value: "ONLY_UMRAH_VISA" as VisaType, label: "Only Umrah Visa", hint: "Visa only. No separate transport setup." },
  { value: "UMRAH_VISA_TRANSPORT" as VisaType, label: "Umrah Visa + Transport", hint: "Enter combined Visa + Transport amount directly in Visa Rate." },
  { value: "UMRAH_VISA_ONE_WAY_TRANSPORT" as VisaType, label: "Umrah Visa + One-Way Transport", hint: "Uses shared Private / Airport Transport Fleet." },
  { value: "UMRAH_VISA_FULL_TRANSPORT" as VisaType, label: "Umrah Visa + Full Transport", hint: "Uses Private Fleet + Inter-City Bus." },
];

const vehicleOptions: [VisaVehicleType, string, number][] = [
  ["CAR", "Car", 3],
  ["STARIA", "Staria", 6],
  ["HIACE", "Hiace", 10],
  ["COASTER", "Coaster", 16],
  ["BUS", "Bus", 47],
];

const localDate = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const n = (v: string) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const whole = (v: string) => Math.max(0, Math.trunc(n(v)));
const money = (v: number, c = "SAR") => `${c} ${Number(v || 0).toLocaleString("en-PK", { maximumFractionDigits: 2 })}`;
const pkr = (v: number) => `Rs ${Number(v || 0).toLocaleString("en-PK", { maximumFractionDigits: 2 })}`;
const cap = (v: VisaVehicleType) => vehicleOptions.find((x) => x[0] === v)?.[2] || 0;
const vehicleLabel = (v: VisaVehicleType) => vehicleOptions.find((x) => x[0] === v)?.[1] || v;
const visaLabel = (v: VisaType) => visaTypeOptions.find((x) => x.value === v)?.label || v;

const newVisaRow = (type: VisaPassengerType = "ADULT", roe = ""): VisaRowState => ({
  rowId: crypto.randomUUID(),
  passengerType: type,
  passengerName: "",
  visaType: "",
  visaRateSar: "",
  paxCount: "",
  roe,
});

const rowHas = (r: VisaRowState) => !!(r.passengerName.trim() || r.visaType || r.visaRateSar.trim() || r.paxCount.trim() || r.roe.trim());
const pax = (r: VisaRowState) => (rowHas(r) ? whole(r.paxCount) : 0);
const needsPrivate = (v: VisaType | "") => v === "UMRAH_VISA_ONE_WAY_TRANSPORT" || v === "UMRAH_VISA_FULL_TRANSPORT";
const needsBus = (v: VisaType | "") => v === "UMRAH_VISA_FULL_TRANSPORT";
const suggestedVehicle = (p: number): VisaVehicleType => (p <= 3 ? "CAR" : p <= 6 ? "STARIA" : p <= 10 ? "HIACE" : p <= 16 ? "COASTER" : "BUS");

const suggestedFleet = (p: number): FleetRowState[] => {
  if (p <= 0) return [];
  const out: FleetRowState[] = [];
  let remaining = p;
  if (remaining > 47) {
    const qty = Math.floor(remaining / 47);
    out.push({ rowId: crypto.randomUUID(), vehicleType: "BUS", quantity: String(qty), ratePerVehicleSar: "" });
    remaining -= qty * 47;
  }
  if (remaining > 0) out.push({ rowId: crypto.randomUUID(), vehicleType: suggestedVehicle(remaining), quantity: "1", ratePerVehicleSar: "" });
  return out;
};

const newPassport = (): PassportRowState => ({
  rowId: crypto.randomUUID(),
  sourceFamilyName: "",
  passengerType: "ADULT",
  visaType: "ONLY_UMRAH_VISA",
  surname: "",
  givenName: "",
  passportNumber: "",
  nationality: "",
  dateOfBirth: "",
  passportIssuance: "",
  passportExpiry: "",
});

function daysInMonthUtc(year: number, monthZeroBased: number) {
  return new Date(Date.UTC(year, monthZeroBased + 1, 0)).getUTCDate();
}

function shiftIsoMonths(iso: string, deltaMonths: number) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return "";
  const [year, month, day] = iso.split("-").map(Number);
  const absoluteMonth = year * 12 + (month - 1) + deltaMonths;
  const targetYear = Math.floor(absoluteMonth / 12);
  const targetMonth = ((absoluteMonth % 12) + 12) % 12;
  const targetDay = Math.min(day, daysInMonthUtc(targetYear, targetMonth));
  return `${targetYear}-${String(targetMonth + 1).padStart(2, "0")}-${String(targetDay).padStart(2, "0")}`;
}

function isoDaysBetween(startIso: string, endIso: string) {
  if (!startIso || !endIso) return null;
  const start = Date.parse(`${startIso}T00:00:00Z`);
  const end = Date.parse(`${endIso}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return Math.floor((end - start) / 86400000);
}

function prettyDate(iso: string) {
  if (!iso) return "—";
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

function passportValidity(passportExpiry: string, expectedEntryDate: string): PassportValidity | null {
  if (!passportExpiry) return null;
  const latestEligibleEntry = shiftIsoMonths(passportExpiry, -6);
  if (!expectedEntryDate) {
    return { level: "GUIDANCE", latestEligibleEntry, plannedEntry: "", passportExpiry, remainingDays: null };
  }

  const sevenMonthPoint = shiftIsoMonths(passportExpiry, -7);
  const twelveMonthPoint = shiftIsoMonths(passportExpiry, -12);
  const remainingDays = isoDaysBetween(expectedEntryDate, passportExpiry);

  if (expectedEntryDate > latestEligibleEntry) {
    return { level: "INVALID", latestEligibleEntry, plannedEntry: expectedEntryDate, passportExpiry, remainingDays };
  }
  if (expectedEntryDate > sevenMonthPoint) {
    return { level: "CLOSE", latestEligibleEntry, plannedEntry: expectedEntryDate, passportExpiry, remainingDays };
  }
  if (expectedEntryDate > twelveMonthPoint) {
    return { level: "REMINDER", latestEligibleEntry, plannedEntry: expectedEntryDate, passportExpiry, remainingDays };
  }
  return { level: "VALID", latestEligibleEntry, plannedEntry: expectedEntryDate, passportExpiry, remainingDays };
}

function alertRank(level: PassportValidityLevel) {
  if (level === "INVALID") return 4;
  if (level === "CLOSE") return 3;
  if (level === "REMINDER") return 2;
  if (level === "VALID") return 1;
  return 0;
}

function VehicleIcon({ vehicle }: { vehicle: VisaVehicleType }) {
  return <div className="visa11c-vehicle-icon">{vehicle === "BUS" ? "🚌" : vehicle === "COASTER" ? "🚐" : vehicle === "HIACE" || vehicle === "STARIA" ? "🚐" : "🚗"}</div>;
}

export default function VisaBookingModule({
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
  const [activeTransactionType, setActiveTransactionType] = useState(transactionType);
  const [counterpartyId, setCounterpartyId] = useState("");
  const [bookingDate, setBookingDate] = useState(localDate());
  const [ubNumber, setUbNumber] = useState("");
  const [rows, setRows] = useState<VisaRowState[]>([newVisaRow()]);
  const [fleet, setFleet] = useState<FleetRowState[]>([]);
  const [fleetTouched, setFleetTouched] = useState(false);
  const [busRate, setBusRate] = useState("");
  const [expectedEntryDate, setExpectedEntryDate] = useState("");
  const [passports, setPassports] = useState<PassportRowState[]>([]);
  const [notes, setNotes] = useState("");
  const [passportAlert, setPassportAlert] = useState<PassportAlert | null>(null);
  const [entries, setEntries] = useState<VisaBooking[]>([]);
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

  const eligible = useMemo(
    () => parties.filter((x) => x.status === "ACTIVE" && x.account_type === (activeTransactionType === "SALE" ? "PARTY" : "VENDOR")),
    [parties, activeTransactionType],
  );

  const summary = useMemo(() => {
    const by = { ADULT: 0, CHILD: 0, INFANT: 0 } as Record<VisaPassengerType, number>;
    let visaPax = 0;
    let privatePax = 0;
    let fullBusPax = 0;
    let visaSar = 0;

    rows.forEach((r) => {
      const qty = pax(r);
      if (!qty) return;
      by[r.passengerType] += qty;
      visaPax += qty;
      visaSar += n(r.visaRateSar) * qty;
      if (needsPrivate(r.visaType)) privatePax += qty;
      if (needsBus(r.visaType)) fullBusPax += qty;
    });

    const fleetSar = fleet.reduce((sum, f) => sum + n(f.ratePerVehicleSar) * Math.max(1, whole(f.quantity)), 0);
    const fleetCapacity = fleet.reduce((sum, f) => sum + cap(f.vehicleType) * Math.max(1, whole(f.quantity)), 0);
    const privatePerPax = privatePax ? fleetSar / privatePax : 0;
    const busSar = fullBusPax ? n(busRate) * fullBusPax : 0;

    let convertedPkr = 0;
    let unconvertedSar = 0;
    rows.forEach((r) => {
      const qty = pax(r);
      if (!qty) return;
      let total = n(r.visaRateSar) * qty;
      if (needsPrivate(r.visaType)) total += privatePerPax * qty;
      if (needsBus(r.visaType)) total += n(busRate) * qty;
      const roe = n(r.roe);
      if (roe > 0) convertedPkr += total * roe;
      else unconvertedSar += total;
    });

    return {
      ...by,
      visaPax,
      privatePax,
      fullBusPax,
      visaSar,
      fleetSar,
      fleetCapacity,
      privatePerPax,
      busSar,
      transportSar: fleetSar + busSar,
      totalSar: visaSar + fleetSar + busSar,
      convertedPkr,
      unconvertedSar,
    };
  }, [rows, fleet, busRate]);

  const hasPrivate = summary.privatePax > 0;
  const hasBus = summary.fullBusPax > 0;

  useEffect(() => {
    if (!hasPrivate) {
      setFleet([]);
      setFleetTouched(false);
    } else if (!fleetTouched && fleet.length === 0) {
      setFleet(suggestedFleet(summary.privatePax));
    }
  }, [hasPrivate, summary.privatePax, fleetTouched, fleet.length]);

  const visibleEntries = entries.filter((e) => registerFilter === "ALL" || e.transaction_type === registerFilter);

  async function loadEntries(q = search) {
    try {
      setEntries(await getVisaBookings(companyId, q));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  function reset() {
    setActiveTransactionType(transactionType);
    setCounterpartyId("");
    setBookingDate(localDate());
    setUbNumber("");
    setRows([newVisaRow()]);
    setFleet([]);
    setFleetTouched(false);
    setBusRate("");
    setExpectedEntryDate("");
    setPassports([]);
    setNotes("");
    setPassportAlert(null);
    setEditingId(null);
    setError("");
  }

  function addVisaRow() {
    const roe = [...rows].reverse().find((r) => r.roe.trim())?.roe || "";
    setRows((v) => [...v, newVisaRow("ADULT", roe)]);
  }

  function updateRow(id: string, patch: Partial<VisaRowState>) {
    setRows((v) => v.map((r) => (r.rowId === id ? { ...r, ...patch } : r)));
  }

  function removeRow(id: string) {
    setRows((v) => {
      const next = v.filter((r) => r.rowId !== id);
      return next.length ? next : [newVisaRow()];
    });
  }

  function addFleet() {
    setFleetTouched(true);
    setFleet((v) => [...v, { rowId: crypto.randomUUID(), vehicleType: "CAR", quantity: "1", ratePerVehicleSar: "" }]);
  }

  function updateFleet(id: string, patch: Partial<FleetRowState>) {
    setFleetTouched(true);
    setFleet((v) => v.map((r) => (r.rowId === id ? { ...r, ...patch } : r)));
  }

  function removeFleet(id: string) {
    setFleetTouched(true);
    setFleet((v) => v.filter((r) => r.rowId !== id));
  }

  function useSuggested() {
    setFleet(suggestedFleet(summary.privatePax));
    setFleetTouched(true);
  }

  function generatePassports() {
    const hasData = passports.some(
      (p) => p.surname || p.givenName || p.passportNumber || p.nationality || p.dateOfBirth || p.passportIssuance || p.passportExpiry,
    );
    if (hasData && !window.confirm("Regenerate passenger rows from current Visa Pax? Existing passport details will be replaced.")) return;

    const next: PassportRowState[] = [];
    rows.filter(rowHas).forEach((r) => {
      for (let i = 0; i < pax(r); i += 1) {
        next.push({
          rowId: crypto.randomUUID(),
          sourceFamilyName: r.passengerName.trim(),
          passengerType: r.passengerType,
          visaType: (r.visaType || "ONLY_UMRAH_VISA") as VisaType,
          surname: "",
          givenName: "",
          passportNumber: "",
          nationality: "",
          dateOfBirth: "",
          passportIssuance: "",
          passportExpiry: "",
        });
      }
    });
    setPassports(next);
  }

  const completePassports = passports.filter(
    (p) =>
      p.surname.trim() &&
      p.givenName.trim() &&
      p.passportNumber.trim() &&
      p.nationality.trim() &&
      p.dateOfBirth &&
      p.passportIssuance &&
      p.passportExpiry,
  ).length;

  const passportStatusSummary = useMemo(() => {
    let valid = 0;
    let warning = 0;
    let invalid = 0;
    passports.forEach((p) => {
      const v = passportValidity(p.passportExpiry, expectedEntryDate);
      if (!v || v.level === "GUIDANCE") return;
      if (v.level === "INVALID") invalid += 1;
      else if (v.level === "CLOSE" || v.level === "REMINDER") warning += 1;
      else valid += 1;
    });
    return { valid, warning, invalid };
  }, [passports, expectedEntryDate]);

  function passengerLabel(p: PassportRowState, index: number) {
    const fullName = `${p.surname.trim()} ${p.givenName.trim()}`.trim();
    return fullName || p.sourceFamilyName || `Passenger ${index + 1}`;
  }

  function maybeShowExpiryAlert(p: PassportRowState, index: number, expiry: string, entry = expectedEntryDate) {
    const validity = passportValidity(expiry, entry);
    if (!validity) return;

    if (!entry) {
      const today = localDate();
      const nextYear = shiftIsoMonths(today, 12);
      if (expiry >= today && expiry <= nextYear) {
        setPassportAlert({ ...validity, passengerLabel: passengerLabel({ ...p, passportExpiry: expiry }, index) });
      }
      return;
    }

    if (["REMINDER", "CLOSE", "INVALID"].includes(validity.level)) {
      setPassportAlert({ ...validity, passengerLabel: passengerLabel({ ...p, passportExpiry: expiry }, index) });
    }
  }

  function updatePassport(id: string, patch: Partial<PassportRowState>) {
    setPassports((v) => v.map((p) => (p.rowId === id ? { ...p, ...patch } : p)));
  }

  function changeExpectedEntryDate(value: string) {
    setExpectedEntryDate(value);
    if (!value) return;

    const alerts = passports
      .map((p, index) => {
        const validity = passportValidity(p.passportExpiry, value);
        return validity ? ({ ...validity, passengerLabel: passengerLabel(p, index) } as PassportAlert) : null;
      })
      .filter((x): x is PassportAlert => !!x)
      .sort((a, b) => alertRank(b.level) - alertRank(a.level));

    if (!alerts.length) return;
    const worst = alerts[0];
    if (worst.level !== "VALID" || alerts.every((a) => a.level === "VALID")) setPassportAlert(worst);
  }

  function rowCalc(r: VisaRowState) {
    const qty = pax(r);
    let sar = n(r.visaRateSar) * qty;
    if (needsPrivate(r.visaType)) sar += summary.privatePerPax * qty;
    if (needsBus(r.visaType)) sar += n(busRate) * qty;
    const roe = n(r.roe);
    return { sar, pkr: roe > 0 ? sar * roe : 0, roe };
  }

  function buildInput(): VisaBookingInput {
    const lines: VisaBookingLineInput[] = rows.filter(rowHas).map((r) => ({
      passengerType: r.passengerType,
      passengerName: r.passengerName.trim(),
      visaType: r.visaType as VisaType,
      visaRateSar: n(r.visaRateSar),
      paxCount: whole(r.paxCount),
      roe: r.roe.trim() ? n(r.roe) : null,
    }));

    const fleetInput: VisaTransportFleetLineInput[] = hasPrivate
      ? fleet.map((f) => ({
          vehicleType: f.vehicleType,
          quantity: Math.max(1, whole(f.quantity)),
          ratePerVehicleSar: n(f.ratePerVehicleSar),
        }))
      : [];

    const passportInput: VisaPassportDetailInput[] = passports.map((p) => ({
      sourceFamilyName: p.sourceFamilyName,
      passengerType: p.passengerType,
      visaType: p.visaType,
      surname: p.surname,
      givenName: p.givenName,
      passportNumber: p.passportNumber,
      nationality: p.nationality,
      dateOfBirth: p.dateOfBirth,
      passportIssuance: p.passportIssuance,
      passportExpiry: p.passportExpiry,
    }));

    return {
      transactionType: activeTransactionType,
      counterpartyId,
      transactionDate: bookingDate,
      ubNumber,
      fleet: fleetInput,
      intercityBusRateSar: hasBus ? n(busRate) : 0,
      expectedEntryDate,
      notes,
      lines,
      passports: passportInput,
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
        await updateVisaBooking(companyId, editingId, input, userId);
        setMessage(`Visa booking ${input.ubNumber.trim()} updated successfully.`);
      } else {
        await createVisaBooking(companyId, input, userId);
        setMessage(`Visa booking ${input.ubNumber.trim()} saved successfully.`);
      }
      await loadEntries("");
      if (onChanged) await onChanged();
      reset();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function edit(entry: VisaBooking) {
    if (!canEdit || entry.status !== "ACTIVE") return;
    setActiveTransactionType(entry.transaction_type);
    setCounterpartyId(entry.counterparty_id);
    setBookingDate(entry.transaction_date);
    setUbNumber(entry.ub_number);
    setRows(
      entry.lines.map((line) => ({
        rowId: crypto.randomUUID(),
        passengerType: line.passenger_type,
        passengerName: line.passenger_name,
        visaType: line.visa_type,
        visaRateSar: String(line.visa_rate_sar || ""),
        paxCount: String(line.pax_count || ""),
        roe: line.roe > 0 ? String(line.roe) : "",
      })),
    );

    if (entry.fleet?.length) {
      setFleet(
        entry.fleet.map((f) => ({
          rowId: crypto.randomUUID(),
          vehicleType: f.vehicle_type,
          quantity: String(f.quantity),
          ratePerVehicleSar: String(f.rate_per_vehicle_sar || ""),
        })),
      );
    } else if (entry.private_transport_total_sar > 0) {
      setFleet([
        {
          rowId: crypto.randomUUID(),
          vehicleType: (entry.private_vehicle_type || "CAR") as VisaVehicleType,
          quantity: "1",
          ratePerVehicleSar: String(entry.private_transport_total_sar),
        },
      ]);
    } else {
      setFleet([]);
    }

    setFleetTouched(true);
    setBusRate(entry.intercity_bus_rate_sar > 0 ? String(entry.intercity_bus_rate_sar) : "");
    setExpectedEntryDate(entry.expected_entry_date || "");
    setPassports(
      (entry.passports || []).map((d) => ({
        rowId: crypto.randomUUID(),
        sourceFamilyName: d.source_family_name,
        passengerType: d.passenger_type,
        visaType: d.visa_type,
        surname: d.surname || "",
        givenName: d.given_name || d.passenger_name || "",
        passportNumber: d.passport_number,
        nationality: d.nationality,
        dateOfBirth: d.date_of_birth,
        passportIssuance: d.passport_issuance || "",
        passportExpiry: d.passport_expiry,
      })),
    );
    setNotes(entry.notes || "");
    setPassportAlert(null);
    setEditingId(entry.id);
    setMode("FORM");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function voidEntry(entry: VisaBooking) {
    if (!canVoid || entry.status !== "ACTIVE" || busy) return;
    if (!window.confirm(`Void Visa booking ${entry.ub_number}?`)) return;
    setBusy(true);
    try {
      await voidVisaBooking(companyId, entry.id, userId);
      await loadEntries(search);
      if (onChanged) await onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function validityBadge(p: PassportRowState) {
    const v = passportValidity(p.passportExpiry, expectedEntryDate);
    if (!v) return null;
    if (!expectedEntryDate) return <small className="visa11d-validity guidance">Latest eligible entry: {prettyDate(v.latestEligibleEntry)}</small>;
    if (v.level === "INVALID") return <small className="visa11d-validity invalid">✕ Under 6 months at planned entry</small>;
    if (v.level === "CLOSE") return <small className="visa11d-validity close">⚠ Close to 6-month minimum</small>;
    if (v.level === "REMINDER") return <small className="visa11d-validity reminder">⚠ Passport validity reminder</small>;
    return <small className="visa11d-validity valid">✓ Valid for planned entry</small>;
  }

  function renderPassportAlert() {
    if (!passportAlert) return null;
    const a = passportAlert;
    const isInvalid = a.level === "INVALID";
    const isClose = a.level === "CLOSE";
    const isReminder = a.level === "REMINDER";
    const isGuidance = a.level === "GUIDANCE";
    const title = isInvalid
      ? "Passport Does Not Meet Validity Requirement"
      : isClose
        ? "Passport Expiry Warning"
        : isReminder
          ? "Passport Validity Reminder"
          : isGuidance
            ? "Travel Date Guidance"
            : "Passport Validity Check";

    const headline = isInvalid
      ? "NO — this passport does not meet the 6-month validity requirement for the selected entry date."
      : isGuidance
        ? "Add the expected Saudi entry date to confirm travel eligibility."
        : "YES — this passport meets the 6-month validity requirement for the selected entry date.";

    return (
      <div className="visa11d-modal-backdrop" onMouseDown={(e) => e.currentTarget === e.target && setPassportAlert(null)}>
        <div className={`visa11d-validity-modal ${a.level.toLowerCase()}`} role="dialog" aria-modal="true">
          <button className="visa11d-modal-close" onClick={() => setPassportAlert(null)} aria-label="Close">×</button>
          <div className="visa11d-modal-icon">{isInvalid ? "!" : isClose || isReminder ? "⚠" : isGuidance ? "i" : "✓"}</div>
          <div>
            <small className="visa11d-modal-kicker">PASSPORT TRAVEL ELIGIBILITY</small>
            <h3>{title}</h3>
            <p className="visa11d-passenger-label">{a.passengerLabel}</p>
          </div>
          <div className="visa11d-eligibility-headline">{headline}</div>
          <div className="visa11d-modal-grid">
            <div><small>Planned Entry into KSA</small><b>{a.plannedEntry ? prettyDate(a.plannedEntry) : "Not entered"}</b></div>
            <div><small>Passport Expiry</small><b>{prettyDate(a.passportExpiry)}</b></div>
            <div><small>Latest Eligible Entry Date</small><b>{prettyDate(a.latestEligibleEntry)}</b></div>
            <div><small>Validity Remaining at Entry</small><b>{a.remainingDays == null ? "—" : `${a.remainingDays} days`}</b></div>
          </div>
          {isInvalid ? (
            <p className="visa11d-modal-message">No Umrah visa processing should proceed on this passport for the selected entry date. Please check the expiry date and renew the passport or change the planned entry date.</p>
          ) : isClose ? (
            <p className="visa11d-modal-message">The passport is very close to the minimum validity requirement. Please verify the final entry date and consider passport renewal before visa processing.</p>
          ) : isReminder ? (
            <p className="visa11d-modal-message">Please make sure the passport keeps at least 6 months validity at the time of entry into Saudi Arabia.</p>
          ) : isGuidance ? (
            <p className="visa11d-modal-message">Based on this passport expiry, the latest entry date that keeps a 6-month validity margin is shown above.</p>
          ) : (
            <p className="visa11d-modal-message">The passport currently meets the 6-month validity requirement for the planned entry date.</p>
          )}
          <p className="visa11d-modal-disclaimer">Passport validity is one eligibility check only. Visa approval and entry remain subject to the relevant Saudi authorities.</p>
          <button className="visa11d-modal-ok" onClick={() => setPassportAlert(null)}>OK</button>
        </div>
      </div>
    );
  }

  function renderForm() {
    return (
      <section className="booking-entry-screen visa11-screen">
        <div className="booking-screen-toolbar visa11-toolbar">
          <button className="booking-back-button" onClick={onBack}>← Back to Booking Services</button>
          <div className="visa11-toolbar-right">
            <span className={`direction-badge ${activeTransactionType === "SALE" ? "sale" : "purchase"}`}>
              {activeTransactionType === "SALE" ? "SALE TO PARTY" : "PURCHASE FROM VENDOR / SUPPLIER"}
            </span>
            <button className="visa11-register-button" onClick={() => setMode("REGISTER")}>Visa Booking Register</button>
          </div>
        </div>

        <div className="visa11-title-row">
          <span className="eyebrow blue">VISA BOOKING</span>
          <h2>{editingId ? "Edit Visa Booking" : "New Visa Booking"}</h2>
        </div>

        {message && <div className="alert success">{message}</div>}
        {error && <div className="alert error">{error}</div>}

        <section className="visa11-card">
          <div className="visa11-section-head"><span>1</span><b>SELECT PARTY / VENDOR & ASSIGN BOOKING NUMBER</b></div>
          <div className="visa11-header-grid">
            <label>
              {activeTransactionType === "SALE" ? "Party Name *" : "Vendor / Supplier Name *"}
              <select value={counterpartyId} onChange={(e) => setCounterpartyId(e.target.value)}>
                <option value="">Select</option>
                {eligible.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
              </select>
            </label>
            <label>Date of Booking *<input type="date" value={bookingDate} onChange={(e) => setBookingDate(e.target.value)} /></label>
            <label>UB / Booking # *<input value={ubNumber} onChange={(e) => setUbNumber(e.target.value)} /></label>
          </div>
        </section>

        <section className="visa11-card">
          <div className="visa11-passenger-head">
            <div className="visa11-section-head no-margin"><span>2</span><b>VISA DETAILS & RATES</b></div>
            <div className="visa11-add-buttons"><button onClick={addVisaRow}>+ Add Visa Row</button></div>
          </div>
          <div className="visa11-combined-note"><b>Umrah Visa + Transport:</b> enter combined Visa + Transport amount in Visa Rate. No separate transport setup.</div>
          <div className="visa11-table-wrap">
            <table className="visa11-rate-table">
              <thead><tr><th>SR</th><th>Passenger / Family Head Name *</th><th>Type *</th><th>Visa Type *</th><th>Visa Rate (SAR) *</th><th>No. of Pax</th><th>ROE</th><th>Total SAR</th><th>Total PKR</th><th>Action</th></tr></thead>
              <tbody>
                {rows.map((r, i) => {
                  const c = rowCalc(r);
                  return (
                    <tr key={r.rowId}>
                      <td>{i + 1}</td>
                      <td><input value={r.passengerName} onChange={(e) => updateRow(r.rowId, { passengerName: e.target.value })} /></td>
                      <td>
                        <select value={r.passengerType} onChange={(e) => updateRow(r.rowId, { passengerType: e.target.value as VisaPassengerType })}>
                          <option value="ADULT">Adult</option><option value="CHILD">Child</option><option value="INFANT">Infant</option>
                        </select>
                      </td>
                      <td>
                        <select value={r.visaType} onChange={(e) => updateRow(r.rowId, { visaType: e.target.value as VisaType })}>
                          <option value="">Select Visa Type</option>
                          {visaTypeOptions.map((v) => <option key={v.value} value={v.value}>{v.label}</option>)}
                        </select>
                      </td>
                      <td><div className="visa11-sar-input"><span>SAR</span><input type="number" value={r.visaRateSar} onChange={(e) => updateRow(r.rowId, { visaRateSar: e.target.value })} /></div></td>
                      <td><input className="visa11-small-number" type="number" value={r.paxCount} onChange={(e) => updateRow(r.rowId, { paxCount: e.target.value })} /></td>
                      <td><input className="visa11-roe-input" type="number" value={r.roe} placeholder="Riyal Rate" onChange={(e) => updateRow(r.rowId, { roe: e.target.value })} /></td>
                      <td className="visa11-total-sar"><b>{money(c.sar)}</b></td>
                      <td className="visa11-total-pkr"><b>{c.roe > 0 ? pkr(c.pkr) : "PKR —"}</b></td>
                      <td><button className="visa11-remove" onClick={() => removeRow(r.rowId)}>×</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        <section className={`visa11-card visa11-transport-card ${hasPrivate ? "active" : "inactive"}`}>
          <div className="visa11-section-head"><span>3</span><b>TRANSPORT DETAILS</b><small>Shared for One-Way / Full Transport rows only.</small></div>
          {!hasPrivate ? (
            <div className="visa11-empty-transport">No separate transport setup required for current Visa Types.</div>
          ) : (
            <div className="visa11c-transport-layout">
              <div className="visa11c-suggestion">
                <VehicleIcon vehicle={suggestedVehicle(summary.privatePax)} />
                <div><small>SUGGESTED FLEET</small><b>{summary.privatePax <= 47 ? `1 × ${vehicleLabel(suggestedVehicle(summary.privatePax))}` : "Multiple Vehicles"}</b><span>Required Pax: {summary.privatePax}</span></div>
                <button onClick={useSuggested}>Use Suggested Fleet</button>
              </div>

              <div className="visa11c-fleet">
                <div className="visa11c-fleet-head"><b>PRIVATE / AIRPORT TRANSPORT FLEET</b><button onClick={addFleet}>+ Add Vehicle</button></div>
                <table>
                  <thead><tr><th>Vehicle</th><th>Qty</th><th>Capacity / Vehicle</th><th>Total Capacity</th><th>Rate / Vehicle (SAR)</th><th>Sub Total</th><th></th></tr></thead>
                  <tbody>
                    {fleet.map((f) => (
                      <tr key={f.rowId}>
                        <td><select value={f.vehicleType} onChange={(e) => updateFleet(f.rowId, { vehicleType: e.target.value as VisaVehicleType })}>{vehicleOptions.map((v) => <option key={v[0]} value={v[0]}>{v[1]}</option>)}</select></td>
                        <td><input type="number" value={f.quantity} onChange={(e) => updateFleet(f.rowId, { quantity: e.target.value })} /></td>
                        <td>{cap(f.vehicleType)}</td>
                        <td>{cap(f.vehicleType) * Math.max(1, whole(f.quantity))}</td>
                        <td><div className="visa11-sar-input"><span>SAR</span><input type="number" value={f.ratePerVehicleSar} onChange={(e) => updateFleet(f.rowId, { ratePerVehicleSar: e.target.value })} /></div></td>
                        <td><b>{money(n(f.ratePerVehicleSar) * Math.max(1, whole(f.quantity)))}</b></td>
                        <td><button className="visa11-remove" onClick={() => removeFleet(f.rowId)}>×</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className={`visa11c-capacity ${summary.fleetCapacity >= summary.privatePax ? "ok" : "warn"}`}>
                  <b>Required Pax: {summary.privatePax}</b><b>Fleet Capacity: {summary.fleetCapacity}</b>
                  <span>{summary.fleetCapacity >= summary.privatePax ? `Capacity sufficient · ${summary.fleetCapacity - summary.privatePax} spare seats` : `Capacity short by ${summary.privatePax - summary.fleetCapacity} passenger(s)`}</span>
                </div>
                <div className="visa11c-private-totals"><span>Private Transport Total <b>{money(summary.fleetSar)}</b></span><span>Allocated Per Pax <b>{money(summary.privatePerPax)}</b></span></div>
              </div>

              {hasBus && (
                <div className="visa11c-bus">
                  <b>INTER-CITY BUS TRANSPORT</b>
                  <span>Applicable Full Transport Pax: <strong>{summary.fullBusPax}</strong></span>
                  <label>Rate SAR / Pax<div className="visa11-sar-input"><span>SAR</span><input type="number" value={busRate} onChange={(e) => setBusRate(e.target.value)} /></div></label>
                  <div>Bus Total <b>{money(summary.busSar)}</b></div>
                </div>
              )}
            </div>
          )}
        </section>

        <div className="visa11-count-summary">
          <div><small>ADULTS</small><b>{summary.ADULT}</b></div>
          <div><small>CHILDREN</small><b>{summary.CHILD}</b></div>
          <div><small>INFANTS</small><b>{summary.INFANT}</b></div>
          <div><small>TOTAL VISA PAX</small><b>{summary.visaPax}</b></div>
          <div><small>PRIVATE TRANSPORT PAX</small><b>{summary.privatePax}</b></div>
          <div><small>FULL TRANSPORT PAX</small><b>{summary.fullBusPax}</b></div>
        </div>

        <section className="visa11-financial-summary">
          <div><small>VISA TOTAL SAR</small><b>{money(summary.visaSar)}</b></div>
          <div><small>TRANSPORT TOTAL SAR</small><b>{money(summary.transportSar)}</b></div>
          <div className="grand-sar"><small>GRAND TOTAL SAR</small><b>{money(summary.totalSar)}</b></div>
          <div className="grand-pkr"><small>GRAND TOTAL PKR</small><b>{pkr(summary.convertedPkr)}</b>{summary.unconvertedSar > 0 && <span>ROE pending for {money(summary.unconvertedSar)}</span>}</div>
        </section>

        <section className="visa11-card visa11d-booking-passenger-card">
          <div className="visa11-passenger-head">
            <div className="visa11-section-head no-margin"><span>4</span><b>BOOKING & PASSENGERS DETAILS</b><small>Passenger passport information and booking notes in one section.</small></div>
            <div className="visa11-add-buttons"><button onClick={generatePassports}>Generate / Sync from Visa Pax</button><button onClick={() => setPassports((v) => [...v, newPassport()])}>+ Add Passenger</button></div>
          </div>

          <div className="visa11d-entry-row">
            <label>
              Expected Entry Date into Saudi Arabia
              <input type="date" value={expectedEntryDate} onChange={(e) => changeExpectedEntryDate(e.target.value)} />
            </label>
            <div className="visa11d-entry-help">
              <b>Passport Travel Eligibility</b>
              <span>The system compares each Passport Expiry with the planned Saudi entry date and calculates the latest eligible entry date using a 6-month validity margin.</span>
            </div>
          </div>

          <div className="visa11c-passport-stats visa11d-passenger-stats">
            <span>Total Visa Pax <b>{summary.visaPax}</b></span>
            <span>Passenger Records <b>{passports.length}</b></span>
            <span>Completed <b>{completePassports}/{summary.visaPax}</b></span>
            {expectedEntryDate && <span className="valid-count">Valid <b>{passportStatusSummary.valid}</b></span>}
            {expectedEntryDate && passportStatusSummary.warning > 0 && <span className="warning-count">Check <b>{passportStatusSummary.warning}</b></span>}
            {expectedEntryDate && passportStatusSummary.invalid > 0 && <span className="invalid-count">Under 6 Months <b>{passportStatusSummary.invalid}</b></span>}
            {passports.length !== summary.visaPax && <em>Passenger row count does not match Visa Pax.</em>}
          </div>

          <div className="visa11-table-wrap">
            <table className="visa11c-passport-table visa11d-passenger-table">
              <thead><tr><th>SR</th><th>Surname</th><th>Given Name</th><th>Passport #</th><th>Nationality</th><th>DOB</th><th>Passport Issuance</th><th>Passport Expiry</th></tr></thead>
              <tbody>
                {passports.map((p, i) => (
                  <tr key={p.rowId}>
                    <td className="visa11d-sr-cell"><b>{i + 1}</b><button className="visa11-remove" onClick={() => setPassports((v) => v.filter((x) => x.rowId !== p.rowId))}>×</button></td>
                    <td><input value={p.surname} onChange={(e) => updatePassport(p.rowId, { surname: e.target.value.toUpperCase() })} /></td>
                    <td><input value={p.givenName} onChange={(e) => updatePassport(p.rowId, { givenName: e.target.value.toUpperCase() })} /></td>
                    <td><input value={p.passportNumber} onChange={(e) => updatePassport(p.rowId, { passportNumber: e.target.value.toUpperCase() })} /></td>
                    <td><input value={p.nationality} onChange={(e) => updatePassport(p.rowId, { nationality: e.target.value })} /></td>
                    <td><input type="date" value={p.dateOfBirth} onChange={(e) => updatePassport(p.rowId, { dateOfBirth: e.target.value })} /></td>
                    <td><input type="date" value={p.passportIssuance} onChange={(e) => updatePassport(p.rowId, { passportIssuance: e.target.value })} /></td>
                    <td>
                      <input
                        type="date"
                        value={p.passportExpiry}
                        onChange={(e) => {
                          const expiry = e.target.value;
                          updatePassport(p.rowId, { passportExpiry: expiry });
                          maybeShowExpiryAlert(p, i, expiry);
                        }}
                      />
                      {validityBadge(p)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="visa11d-booking-notes">
            <div><b>BOOKING NOTES</b><small>Visa processing notes, missing documents, customer instructions or internal remarks.</small></div>
            <textarea rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Write booking notes..." />
          </div>
        </section>

        <div className="visa11-actions">
          {editingId && <button className="secondary" onClick={reset}>Cancel Edit</button>}
          {((editingId && canEdit) || (!editingId && canCreate)) && (
            <button className="primary" disabled={busy} onClick={() => void save()}>
              {busy ? "Saving..." : editingId ? `Update ${activeTransactionType}` : `Save ${activeTransactionType}`}
            </button>
          )}
        </div>

        {renderPassportAlert()}
      </section>
    );
  }

  function renderRegister() {
    return (
      <section className="booking-entry-screen visa11-screen">
        <div className="booking-screen-toolbar">
          <button className="booking-back-button" onClick={() => setMode("FORM")}>← Back to Visa Booking</button>
          <span className="booking-foundation-badge active-engine">VISA REGISTER</span>
        </div>
        <div className="visa11-register-controls">
          <div className="package-register-filter-tabs">
            {(["ALL", "SALE", "PURCHASE"] as RegisterFilter[]).map((x) => <button key={x} className={registerFilter === x ? "active" : ""} onClick={() => setRegisterFilter(x)}>{x}</button>)}
          </div>
          <div className="search-box package-search"><input value={search} onChange={async (e) => { setSearch(e.target.value); await loadEntries(e.target.value); }} placeholder="Search UB, Party/Vendor, Surname, Given Name, Passport, Visa Type..." /></div>
        </div>
        <div className="party-table-wrap">
          <table className="party-table visa11-register-table">
            <thead><tr><th>Date</th><th>UB</th><th>Type</th><th>Party / Vendor</th><th>Visa Rows</th><th>Transport Fleet</th><th>Passengers</th><th>Total SAR</th><th>Total PKR</th><th>Status</th><th>Actions</th></tr></thead>
            <tbody>
              {visibleEntries.map((entry) => (
                <tr key={entry.id} className={entry.status === "VOID" ? "void-row" : ""}>
                  <td>{entry.transaction_date}</td>
                  <td><b>{entry.ub_number}</b></td>
                  <td>{entry.transaction_type}</td>
                  <td>{entry.counterparty_name}</td>
                  <td>{entry.lines.map((line) => <div key={line.id}><b>{line.passenger_name}</b> · {line.pax_count} {line.passenger_type} · {visaLabel(line.visa_type)}</div>)}</td>
                  <td>
                    {entry.fleet?.length
                      ? entry.fleet.map((f) => <div key={f.id}>{f.quantity} × {vehicleLabel(f.vehicle_type)} · {money(f.line_total_sar)}</div>)
                      : entry.private_transport_total_sar > 0
                        ? <div>{vehicleLabel((entry.private_vehicle_type || "CAR") as VisaVehicleType)} · {money(entry.private_transport_total_sar)}</div>
                        : "No private fleet"}
                    {entry.applicable_full_bus_pax > 0 && <div>Bus: {entry.applicable_full_bus_pax} Pax × {money(entry.intercity_bus_rate_sar)}</div>}
                  </td>
                  <td>{(entry.passports || []).length}/{entry.lines.reduce((sum, line) => sum + line.pax_count, 0)}{entry.expected_entry_date ? <div><small>Entry: {prettyDate(entry.expected_entry_date)}</small></div> : null}</td>
                  <td>{money(entry.total_sar)}</td>
                  <td>{pkr(entry.total_pkr)}</td>
                  <td>{entry.status}</td>
                  <td><button disabled={!canEdit || entry.status !== "ACTIVE"} onClick={() => edit(entry)}>Edit</button><button disabled={!canVoid || entry.status !== "ACTIVE"} onClick={() => void voidEntry(entry)}>Void</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    );
  }

  return mode === "REGISTER" ? renderRegister() : renderForm();
}
