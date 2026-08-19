import { useEffect, useMemo, useState } from "react";
import type {
  BookingTransactionType,
  HotelBooking,
  HotelRoomType,
  TransportBooking,
  TransportType,
  TransportVehicleType,
  VisaBooking,
  VisaPassengerType,
  VisaType,
} from "./db";
import {
  getHotelBookings,
  getTransportBookings,
  getVisaBookings,
  updateHotelBooking,
  updateTransportBooking,
  updateVisaBooking,
  voidHotelBooking,
  voidTransportBooking,
  voidVisaBooking,
} from "./db";
import {
  getTicketCommercialBookings,
  updateTicketCommercialBooking,
  voidTicketCommercialBooking,
  type TicketCommercialBooking,
  type TicketFareFlightType,
} from "./TicketFlowDb";
import {
  getMiscBookings,
  updateMiscBooking,
  voidMiscBooking,
  type MiscBooking,
} from "./miscDb";
import { bookingLifecycleConfigs, type BookingLifecycleStatus, type BookingServiceName } from "./BookingLifecycle";
import { getUniversalBookingAdjustmentSummaryMap, type UniversalAdjustmentSummary } from "./UniversalBookingAdjustmentDb";
import UniversalBookingAdjustment, {
  type UniversalAdjustmentBooking,
  type UniversalAdjustmentColumn,
  type UniversalAdjustmentRow,
} from "./UniversalBookingAdjustment";
import "./BookingLifecycleCenter.css";

type SupportedService = Exclude<BookingServiceName, "PACKAGE">;
type RawBooking = TicketCommercialBooking | HotelBooking | VisaBooking | TransportBooking | MiscBooking;
type Filter = "ALL" | BookingTransactionType;

type Props = {
  service: SupportedService;
  companyId: string;
  transactionType: BookingTransactionType;
  userId?: string;
  canEdit?: boolean;
  canVoid?: boolean;
  onChanged?: () => void | Promise<void>;
};

type BookingRow = UniversalAdjustmentBooking & {
  status: "ACTIVE" | "VOID";
  summary: string;
  totalSar: number;
  raw: RawBooking;
};

const paxOptions = [
  { value: "ADULT", label: "Adult" },
  { value: "CHILD", label: "Child" },
  { value: "INFANT", label: "Infant" },
];
const flightOptions = [
  { value: "ONE_WAY", label: "One Way" },
  { value: "RETURN", label: "Return" },
  { value: "MULTI_CITY", label: "Multi-City" },
];
const roomOptions = [
  { value: "SHARING", label: "Sharing" },
  { value: "QUINT_SHARING", label: "Quint / Sharing" },
  { value: "QUAD", label: "Quad" },
  { value: "TRIPLE", label: "Triple" },
  { value: "DOUBLE", label: "Double" },
  { value: "SUITE_ROOM", label: "Suite Room" },
];
const visaOptions = [
  { value: "ONLY_UMRAH_VISA", label: "Only Umrah Visa" },
  { value: "UMRAH_VISA_TRANSPORT", label: "Umrah Visa + Transport" },
  { value: "UMRAH_VISA_ONE_WAY_TRANSPORT", label: "Umrah Visa + One-Way Transport" },
  { value: "UMRAH_VISA_FULL_TRANSPORT", label: "Umrah Visa + Full Transport" },
];
const transportTypeOptions = [
  { value: "PRIVATE_VEHICLE", label: "Private Vehicle" },
  { value: "SHARING_BUS", label: "Sharing Bus" },
];
const vehicleOptions = [
  { value: "CAR", label: "Car" },
  { value: "GMC_YUKON", label: "GMC Yukon" },
  { value: "STARIA", label: "Staria" },
  { value: "STAREX", label: "Starex" },
  { value: "HIACE", label: "Hiace" },
  { value: "COASTER", label: "Coaster" },
  { value: "BUS", label: "Bus" },
  { value: "SHARING_BUS", label: "Sharing Bus" },
  { value: "OTHER", label: "Other / Custom" },
];

function num(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
function whole(value: string) { return Math.max(0, Math.trunc(num(value))); }
function money(value: number) { return `Rs ${Number(value || 0).toLocaleString("en-PK", { maximumFractionDigits: 2 })}`; }
function sar(value: number) { return `SAR ${Number(value || 0).toLocaleString("en-PK", { maximumFractionDigits: 2 })}`; }
function id() { return crypto.randomUUID(); }
function inputValue(row: UniversalAdjustmentRow, key: string) { return row.values[key] || ""; }

function columnsFor(service: SupportedService): UniversalAdjustmentColumn[] {
  if (service === "TICKET") return [
    { key: "passengerType", label: "PAX TYPE", type: "select", options: paxOptions },
    { key: "passengerName", label: "PASSENGER / FAMILY" },
    { key: "airlineName", label: "AIRLINE" },
    { key: "pnr", label: "PNR" },
    { key: "flightType", label: "FLIGHT TYPE", type: "select", options: flightOptions },
    { key: "ticketRoute", label: "ROUTE" },
    { key: "rate", label: "RATE PKR", type: "number", min: 0, step: 0.01 },
    { key: "qty", label: "QTY", type: "number", min: 1, step: 1 },
  ];
  if (service === "HOTEL") return [
    { key: "city", label: "CITY" },
    { key: "hotelName", label: "HOTEL" },
    { key: "checkIn", label: "CHECK IN", type: "date" },
    { key: "checkOut", label: "CHECK OUT", type: "date" },
    { key: "nights", label: "NIGHTS", type: "number", min: 1, step: 1 },
    { key: "roomType", label: "ROOM", type: "select", options: roomOptions },
    { key: "qty", label: "ROOM/BED QTY", type: "number", min: 1, step: 1 },
    { key: "rateSar", label: "RATE SAR", type: "number", min: 0, step: 0.01 },
    { key: "roe", label: "ROE", type: "number", min: 0, step: 0.0001 },
  ];
  if (service === "VISA") return [
    { key: "passengerType", label: "PAX TYPE", type: "select", options: paxOptions },
    { key: "passengerName", label: "PASSENGER / FAMILY" },
    { key: "visaType", label: "VISA TYPE", type: "select", options: visaOptions },
    { key: "visaRateSar", label: "VISA RATE SAR", type: "number", min: 0, step: 0.01 },
    { key: "qty", label: "PAX", type: "number", min: 1, step: 1 },
    { key: "roe", label: "ROE", type: "number", min: 0, step: 0.0001 },
  ];
  if (service === "TRANSPORT") return [
    { key: "transportDate", label: "DATE", type: "date" },
    { key: "transportType", label: "TYPE", type: "select", options: transportTypeOptions },
    { key: "fromLocation", label: "FROM" },
    { key: "toLocation", label: "TO" },
    { key: "vehicleType", label: "VEHICLE", type: "select", options: vehicleOptions },
    { key: "customVehicleName", label: "CUSTOM VEHICLE" },
    { key: "vehicleCount", label: "VEHICLE QTY", type: "number", min: 0, step: 1 },
    { key: "rateSar", label: "RATE SAR", type: "number", min: 0, step: 0.01 },
    { key: "paxCount", label: "PAX", type: "number", min: 0, step: 1 },
    { key: "roe", label: "ROE", type: "number", min: 0, step: 0.0001 },
  ];
  return [
    { key: "serviceName", label: "SERVICE" },
    { key: "qty", label: "PAX", type: "number", min: 1, step: 1 },
    { key: "rate", label: "RATE / PERSON", type: "number", min: 0, step: 0.01 },
    { key: "roe", label: "ROE", type: "number", min: 0, step: 0.0001, placeholder: "Blank = PKR" },
  ];
}

function createRowFor(service: SupportedService): UniversalAdjustmentRow {
  if (service === "TICKET") return { id: id(), values: { passengerType: "ADULT", passengerName: "", airlineName: "", pnr: "", flightType: "RETURN", ticketRoute: "", rate: "", qty: "1", eticketReference: "" } };
  if (service === "HOTEL") return { id: id(), values: { city: "", hotelName: "", checkIn: "", checkOut: "", nights: "1", roomType: "SHARING", qty: "1", rateSar: "", roe: "" } };
  if (service === "VISA") return { id: id(), values: { passengerType: "ADULT", passengerName: "", visaType: "ONLY_UMRAH_VISA", visaRateSar: "", qty: "1", roe: "", transportPkrPerPax: "0" } };
  if (service === "TRANSPORT") return { id: id(), values: { transportDate: "", transportType: "PRIVATE_VEHICLE", fromLocation: "", toLocation: "", vehicleType: "STARIA", customVehicleName: "", vehicleCount: "1", rateSar: "", paxCount: "", roe: "" } };
  return { id: id(), values: { serviceName: "", qty: "1", rate: "", roe: "" } };
}

function rowsFor(service: SupportedService, booking: RawBooking): UniversalAdjustmentRow[] {
  if (service === "TICKET") {
    const b = booking as TicketCommercialBooking;
    return b.lines.map((line) => ({ id: line.id || id(), values: { passengerType: line.passenger_type, passengerName: line.passenger_name, airlineName: line.airline_name, pnr: line.pnr, flightType: line.flight_type, ticketRoute: line.ticket_route, rate: String(line.rate_per_ticket || 0), qty: String(line.ticket_count || 1), eticketReference: line.eticket_reference || "" } }));
  }
  if (service === "HOTEL") {
    const b = booking as HotelBooking;
    return b.lines.map((line) => ({ id: line.id || id(), values: { city: line.city, hotelName: line.hotel_name, checkIn: line.check_in, checkOut: line.check_out, nights: String(line.nights || 1), roomType: line.room_type, qty: String(line.quantity || 1), rateSar: String(line.rate_per_night_sar || 0), roe: Number(line.roe || 0) > 0 ? String(line.roe) : "" } }));
  }
  if (service === "VISA") {
    const b = booking as VisaBooking;
    return b.lines.map((line) => {
      const pax = Math.max(1, Number(line.pax_count || 1));
      const visaPkr = Number(line.roe || 0) > 0 ? Number(line.visa_rate_sar || 0) * pax * Number(line.roe || 0) : 0;
      const transportPkrPerPax = Math.max(0, Number(line.line_total_pkr || 0) - visaPkr) / pax;
      return { id: line.id || id(), values: { passengerType: line.passenger_type, passengerName: line.passenger_name, visaType: line.visa_type, visaRateSar: String(line.visa_rate_sar || 0), qty: String(line.pax_count || 1), roe: Number(line.roe || 0) > 0 ? String(line.roe) : "", transportPkrPerPax: String(transportPkrPerPax) } };
    });
  }
  if (service === "TRANSPORT") {
    const b = booking as TransportBooking;
    return b.lines.map((line) => ({ id: line.id || id(), values: { transportDate: line.transport_date, transportType: line.transport_type, fromLocation: line.from_location, toLocation: line.to_location, vehicleType: line.vehicle_type, customVehicleName: line.custom_vehicle_name || "", vehicleCount: String(line.vehicle_count || 0), rateSar: String(line.rate_sar || 0), paxCount: String(line.pax_count || 0), roe: Number(line.roe || 0) > 0 ? String(line.roe) : "" } }));
  }
  const b = booking as MiscBooking;
  return b.lines.map((line) => ({ id: line.id || id(), values: { serviceName: line.service_name, qty: String(line.pax_count || 1), rate: String(line.rate_per_person || 0), roe: line.currency_mode === "SAR" && Number(line.roe || 0) > 0 ? String(line.roe) : "" } }));
}

function calculateLine(service: SupportedService, row: UniversalAdjustmentRow) {
  if (service === "TICKET") return Math.max(0, num(inputValue(row, "rate"))) * Math.max(1, whole(inputValue(row, "qty") || "1"));
  if (service === "HOTEL") {
    const roe = Math.max(0, num(inputValue(row, "roe")));
    return roe > 0 ? Math.max(0, num(inputValue(row, "rateSar"))) * Math.max(1, whole(inputValue(row, "nights"))) * Math.max(1, whole(inputValue(row, "qty"))) * roe : 0;
  }
  if (service === "VISA") {
    const qty = Math.max(1, whole(inputValue(row, "qty")));
    const roe = Math.max(0, num(inputValue(row, "roe")));
    const visa = roe > 0 ? Math.max(0, num(inputValue(row, "visaRateSar"))) * qty * roe : 0;
    return visa + Math.max(0, num(inputValue(row, "transportPkrPerPax"))) * qty;
  }
  if (service === "TRANSPORT") {
    const roe = Math.max(0, num(inputValue(row, "roe")));
    if (roe <= 0) return 0;
    const rate = Math.max(0, num(inputValue(row, "rateSar")));
    return inputValue(row, "transportType") === "SHARING_BUS" ? rate * whole(inputValue(row, "paxCount")) * roe : rate * whole(inputValue(row, "vehicleCount")) * roe;
  }
  const base = Math.max(0, num(inputValue(row, "rate"))) * Math.max(1, whole(inputValue(row, "qty")));
  const roe = Math.max(0, num(inputValue(row, "roe")));
  return roe > 0 ? base * roe : base;
}

function quantityFor(service: SupportedService, row: UniversalAdjustmentRow) {
  if (service === "TICKET" || service === "HOTEL" || service === "VISA" || service === "MISC") return Math.max(1, whole(inputValue(row, "qty") || "1"));
  return inputValue(row, "transportType") === "SHARING_BUS" ? Math.max(1, whole(inputValue(row, "paxCount") || "1")) : Math.max(1, whole(inputValue(row, "vehicleCount") || "1"));
}

function withQuantity(service: SupportedService, row: UniversalAdjustmentRow, quantity: number): UniversalAdjustmentRow {
  const values = { ...row.values };
  if (service === "TRANSPORT") {
    if (values.transportType === "SHARING_BUS") values.paxCount = String(quantity);
    else values.vehicleCount = String(quantity);
  } else values.qty = String(quantity);
  return { ...row, values };
}

function describeRow(service: SupportedService, row: UniversalAdjustmentRow, index: number) {
  if (service === "TICKET") return `${inputValue(row, "passengerName") || `Ticket ${index + 1}`} · ${inputValue(row, "airlineName")} · ${inputValue(row, "ticketRoute")}`;
  if (service === "HOTEL") return `${inputValue(row, "hotelName") || `Hotel ${index + 1}`} · ${inputValue(row, "city")} · ${inputValue(row, "checkIn")} → ${inputValue(row, "checkOut")}`;
  if (service === "VISA") return `${inputValue(row, "passengerName") || `Visa ${index + 1}`} · ${inputValue(row, "visaType").replace(/_/g, " ")}`;
  if (service === "TRANSPORT") return `${inputValue(row, "fromLocation") || "From"} → ${inputValue(row, "toLocation") || "To"} · ${inputValue(row, "customVehicleName") || inputValue(row, "vehicleType")}`;
  return `${inputValue(row, "serviceName") || `Service ${index + 1}`} · ${inputValue(row, "qty")} pax`;
}

function normalizeBookings(service: SupportedService, bookings: RawBooking[]): BookingRow[] {
  return bookings.map((booking) => {
    if (service === "TICKET") {
      const b = booking as TicketCommercialBooking;
      const first = b.lines[0];
      return { ...b, summary: `${first?.airline_name || b.airline_name || "Ticket"}${first?.ticket_route ? ` · ${first.ticket_route}` : ""} · ${b.lines.reduce((sum, line) => sum + Number(line.ticket_count || 0), 0)} ticket(s)`, totalSar: 0, raw: b };
    }
    if (service === "HOTEL") {
      const b = booking as HotelBooking;
      return { ...b, summary: b.lines.map((line) => `${line.hotel_name} · ${line.nights}N · ${line.quantity} ${line.room_type}`).join(" | ") || "Hotel booking", totalSar: Number(b.total_sar || 0), raw: b };
    }
    if (service === "VISA") {
      const b = booking as VisaBooking;
      return { ...b, summary: b.lines.map((line) => `${line.passenger_name} · ${line.visa_type.replace(/_/g, " ")} · ${line.pax_count} pax`).join(" | ") || "Visa booking", totalSar: Number(b.total_sar || 0), raw: b };
    }
    if (service === "TRANSPORT") {
      const b = booking as TransportBooking;
      return { ...b, summary: b.lines.map((line) => `${line.from_location} → ${line.to_location} · ${line.custom_vehicle_name || line.vehicle_type}`).join(" | ") || "Transport booking", totalSar: Number(b.total_sar || 0), raw: b };
    }
    const b = booking as MiscBooking;
    return { ...b, transaction_type: b.transaction_type as BookingTransactionType, summary: b.lines.map((line) => `${line.service_name} · ${line.pax_count} pax`).join(" | ") || "Misc booking", totalSar: Number(b.total_sar || 0), raw: b };
  });
}

export default function BookingLifecycleCenter({ service, companyId, transactionType, userId = "", canEdit = true, canVoid = true, onChanged }: Props) {
  const config = bookingLifecycleConfigs[service];
  const [open, setOpen] = useState(false);
  const [bookings, setBookings] = useState<BookingRow[]>([]);
  const [summaries, setSummaries] = useState<Record<string, UniversalAdjustmentSummary>>({});
  const [filter, setFilter] = useState<Filter>(transactionType);
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [adjustmentBooking, setAdjustmentBooking] = useState<BookingRow | null>(null);
  const [historyBooking, setHistoryBooking] = useState<BookingRow | null>(null);
  const [previewBooking, setPreviewBooking] = useState<BookingRow | null>(null);

  useEffect(() => { setFilter(transactionType); }, [transactionType]);
  useEffect(() => { if (open) void load(); }, [open, companyId, service]);

  async function rawBookings() {
    if (service === "TICKET") return getTicketCommercialBookings(companyId) as Promise<RawBooking[]>;
    if (service === "HOTEL") return getHotelBookings(companyId) as Promise<RawBooking[]>;
    if (service === "VISA") return getVisaBookings(companyId) as Promise<RawBooking[]>;
    if (service === "TRANSPORT") return getTransportBookings(companyId) as Promise<RawBooking[]>;
    return getMiscBookings(companyId) as Promise<RawBooking[]>;
  }

  async function load() {
    try {
      const [raw, nextSummaries] = await Promise.all([
        rawBookings(),
        getUniversalBookingAdjustmentSummaryMap(companyId, service),
      ]);
      setBookings(normalizeBookings(service, raw));
      setSummaries(nextSummaries);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return bookings.filter((booking) => {
      if (filter !== "ALL" && booking.transaction_type !== filter) return false;
      if (!term) return true;
      return `${booking.ub_number} ${booking.counterparty_name} ${booking.summary}`.toLowerCase().includes(term);
    });
  }, [bookings, filter, search]);

  async function applyRows(booking: BookingRow, rows: UniversalAdjustmentRow[]) {
    if (service === "TICKET") {
      const b = booking.raw as TicketCommercialBooking;
      await updateTicketCommercialBooking(companyId, b.id, {
        transactionDate: b.transaction_date,
        lines: rows.map((row) => ({
          passengerType: inputValue(row, "passengerType") as "ADULT" | "CHILD" | "INFANT",
          passengerName: inputValue(row, "passengerName").trim(),
          airlineName: inputValue(row, "airlineName").trim(),
          pnr: inputValue(row, "pnr").trim().toUpperCase(),
          flightType: inputValue(row, "flightType") as TicketFareFlightType,
          ticketRoute: inputValue(row, "ticketRoute").trim().toUpperCase(),
          ratePerTicket: Math.max(0, num(inputValue(row, "rate"))),
          ticketCount: Math.max(1, whole(inputValue(row, "qty"))),
          legacyEticketReference: inputValue(row, "eticketReference"),
        })),
      }, userId);
      const updated = (await getTicketCommercialBookings(companyId)).find((item) => item.id === b.id);
      return Number(updated?.total_pkr || 0);
    }
    if (service === "HOTEL") {
      const b = booking.raw as HotelBooking;
      await updateHotelBooking(companyId, b.id, {
        transactionType: b.transaction_type,
        counterpartyId: b.counterparty_id,
        transactionDate: b.transaction_date,
        ubNumber: b.ub_number,
        confirmationVoucher: b.confirmation_voucher || "",
        mealPlan: b.meal_plan || "",
        guestFamilyName: b.guest_family_name || "",
        guestCount: Number(b.guest_count || 0),
        customerContact: b.customer_contact || "",
        specialRequests: b.special_requests || "",
        notes: b.notes || "",
        lines: rows.map((row) => ({
          city: inputValue(row, "city").trim(),
          hotelName: inputValue(row, "hotelName").trim(),
          checkIn: inputValue(row, "checkIn"),
          checkOut: inputValue(row, "checkOut"),
          nights: Math.max(1, whole(inputValue(row, "nights"))),
          roomType: inputValue(row, "roomType") as HotelRoomType,
          ratePerNightSar: Math.max(0, num(inputValue(row, "rateSar"))),
          quantity: Math.max(1, whole(inputValue(row, "qty"))),
          roe: num(inputValue(row, "roe")) > 0 ? num(inputValue(row, "roe")) : null,
        })),
      }, userId);
      const updated = (await getHotelBookings(companyId)).find((item) => item.id === b.id);
      return Number(updated?.total_pkr || 0);
    }
    if (service === "VISA") {
      const b = booking.raw as VisaBooking;
      await updateVisaBooking(companyId, b.id, {
        transactionType: b.transaction_type,
        counterpartyId: b.counterparty_id,
        transactionDate: b.transaction_date,
        ubNumber: b.ub_number,
        fleet: b.fleet.map((item) => ({ vehicleType: item.vehicle_type, quantity: Number(item.quantity || 0), ratePerVehicleSar: Number(item.rate_per_vehicle_sar || 0) })),
        intercityBusRateSar: Number(b.intercity_bus_rate_sar || 0),
        expectedEntryDate: b.expected_entry_date || "",
        notes: b.notes || "",
        lines: rows.map((row) => ({
          passengerType: inputValue(row, "passengerType") as VisaPassengerType,
          passengerName: inputValue(row, "passengerName").trim(),
          visaType: inputValue(row, "visaType") as VisaType,
          visaRateSar: Math.max(0, num(inputValue(row, "visaRateSar"))),
          paxCount: Math.max(1, whole(inputValue(row, "qty"))),
          roe: num(inputValue(row, "roe")) > 0 ? num(inputValue(row, "roe")) : null,
        })),
        passports: b.passports.map((item) => ({ sourceFamilyName: item.source_family_name, passengerType: item.passenger_type, visaType: item.visa_type, surname: item.surname, givenName: item.given_name, passportNumber: item.passport_number, nationality: item.nationality, dateOfBirth: item.date_of_birth, passportIssuance: item.passport_issuance, passportExpiry: item.passport_expiry })),
      }, userId);
      const updated = (await getVisaBookings(companyId)).find((item) => item.id === b.id);
      return Number(updated?.total_pkr || 0);
    }
    if (service === "TRANSPORT") {
      const b = booking.raw as TransportBooking;
      await updateTransportBooking(companyId, b.id, {
        transactionType: b.transaction_type,
        counterpartyId: b.counterparty_id,
        transactionDate: b.transaction_date,
        ubNumber: b.ub_number,
        paxSaudiNumber: b.pax_saudi_number || "",
        notes: b.notes || "",
        lines: rows.map((row) => {
          const transportType = inputValue(row, "transportType") as TransportType;
          const vehicleType = transportType === "SHARING_BUS" ? "SHARING_BUS" : inputValue(row, "vehicleType") as TransportVehicleType;
          return {
            transportDate: inputValue(row, "transportDate") || b.transaction_date,
            transportType,
            fromLocation: inputValue(row, "fromLocation").trim(),
            toLocation: inputValue(row, "toLocation").trim(),
            vehicleType,
            customVehicleName: transportType === "PRIVATE_VEHICLE" ? inputValue(row, "customVehicleName").trim() : "",
            vehicleCount: transportType === "PRIVATE_VEHICLE" ? Math.max(1, whole(inputValue(row, "vehicleCount"))) : 0,
            rateSar: Math.max(0, num(inputValue(row, "rateSar"))),
            paxCount: Math.max(0, whole(inputValue(row, "paxCount"))),
            roe: num(inputValue(row, "roe")) > 0 ? num(inputValue(row, "roe")) : null,
          };
        }),
      }, userId);
      const updated = (await getTransportBookings(companyId)).find((item) => item.id === b.id);
      return Number(updated?.total_pkr || 0);
    }
    const b = booking.raw as MiscBooking;
    await updateMiscBooking(companyId, b.id, {
      transactionType: b.transaction_type,
      counterpartyId: b.counterparty_id,
      transactionDate: b.transaction_date,
      ubNumber: b.ub_number,
      lines: rows.map((row) => ({ serviceName: inputValue(row, "serviceName").trim(), paxCount: Math.max(1, whole(inputValue(row, "qty"))), ratePerPerson: Math.max(0, num(inputValue(row, "rate"))), roe: num(inputValue(row, "roe")) > 0 ? num(inputValue(row, "roe")) : null })),
    }, userId);
    const updated = (await getMiscBookings(companyId)).find((item) => item.id === b.id);
    return Number(updated?.total_pkr || 0);
  }

  async function voidBooking(booking: BookingRow) {
    const summary = summaries[booking.id];
    if (!canVoid || booking.status !== "ACTIVE" || summary?.lifecycleStatus === "CANCELLED" || busy) return;
    if (!window.confirm(`Void ${config.label} booking ${booking.ub_number}? Use Void only when this booking should never have existed. Genuine cancellations should use Booking Adjustment.`)) return;
    setBusy(true);
    setError("");
    try {
      if (service === "TICKET") await voidTicketCommercialBooking(companyId, booking.id, userId);
      else if (service === "HOTEL") await voidHotelBooking(companyId, booking.id, userId);
      else if (service === "VISA") await voidVisaBooking(companyId, booking.id, userId);
      else if (service === "TRANSPORT") await voidTransportBooking(companyId, booking.id, userId);
      else await voidMiscBooking(companyId, booking.id, userId);
      await load();
      await onChanged?.();
      setMessage(`${config.label} booking ${booking.ub_number} voided.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function adjustmentSaved(nextMessage: string) {
    setMessage(nextMessage);
    await load();
    await onChanged?.();
  }

  const selectedAdjustment = adjustmentBooking || historyBooking;
  const selectedRows = selectedAdjustment ? rowsFor(service, selectedAdjustment.raw) : [];
  const selectedColumns = columnsFor(service);

  return <>
    <section className="lifecycle-launcher">
      <div><small>{service} BOOKING LIFECYCLE</small><b>Open Booking · Booking Adjustment · History · Void Booking</b><span>Available for both Sale to Party and Purchase from Vendor bookings.</span></div>
      <button type="button" onClick={() => { setOpen(true); setFilter(transactionType); setMessage(""); setError(""); }}>Open {config.label} Adjustment Register</button>
    </section>

    {open && <div className="modal-backdrop lifecycle-center-backdrop" onMouseDown={(e) => e.currentTarget === e.target && setOpen(false)}><section className="lifecycle-center" onMouseDown={(e) => e.stopPropagation()}>
      <div className="lifecycle-center-toolbar"><div><span className="eyebrow blue">{service} BOOKING REGISTER</span><h2>{config.label} Booking Lifecycle</h2><p>Correction, Amendment, Partial Cancellation and Full Cancellation remain tied to each genuine UB.</p></div><button type="button" className="lifecycle-close" onClick={() => setOpen(false)}>×</button></div>
      {message && <div className="alert success lifecycle-alert">{message}</div>}{error && <div className="alert error lifecycle-alert">{error}</div>}
      <div className="lifecycle-controls"><div className="package-register-filter-tabs">{(["ALL", "SALE", "PURCHASE"] as Filter[]).map((item) => <button type="button" key={item} className={filter === item ? "active" : ""} onClick={() => setFilter(item)}>{item === "ALL" ? "All Bookings" : item === "SALE" ? "Party Sales" : "Vendor Purchases"}</button>)}</div><div className="search-box"><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={`Search ${config.label} UB, account or booking details...`} /></div></div>
      <div className="party-table-wrap lifecycle-table-wrap"><table className="party-table lifecycle-table"><thead><tr><th>DATE</th><th>UB #</th><th>TYPE</th><th>PARTY / VENDOR</th><th>{service} DETAILS</th><th>TOTAL SAR</th><th>EFFECTIVE PKR</th><th>LIFECYCLE</th><th>ACTIONS</th></tr></thead><tbody>{visible.map((booking) => {
        const summary = summaries[booking.id];
        const lifecycle: BookingLifecycleStatus = booking.status === "VOID" ? "VOID" : summary?.lifecycleStatus || "ACTIVE";
        const revision = summary?.revisionNo || 1;
        const cancelled = lifecycle === "CANCELLED";
        const lifecycleClass = lifecycle.toLowerCase().replace(/_/g, "-");
        return <tr key={booking.id} className={booking.status === "VOID" ? "void-row" : ""}><td>{booking.transaction_date}</td><td><b>{booking.ub_number}</b></td><td><span className={`direction-badge ${booking.transaction_type === "SALE" ? "sale" : "purchase"}`}>{booking.transaction_type}</span></td><td><b>{booking.counterparty_name || "—"}</b></td><td><span className="lifecycle-summary">{cancelled ? "FULLY CANCELLED · " : ""}{booking.summary}</span></td><td>{booking.totalSar > 0 ? sar(booking.totalSar) : "—"}</td><td><b>{money(booking.total_pkr)}</b></td><td><span className={`status lifecycle-status ${lifecycleClass}`}>{lifecycle} · REV {revision}</span></td><td><div className="row-actions lifecycle-actions"><button type="button" onClick={() => setPreviewBooking(booking)}>Open Booking</button><button type="button" disabled={!canEdit || booking.status !== "ACTIVE" || cancelled || busy} onClick={() => setAdjustmentBooking(booking)}>Booking Adjustment</button><button type="button" disabled={booking.status === "VOID" && !summary} onClick={() => setHistoryBooking(booking)}>History</button><button type="button" disabled={!canVoid || booking.status !== "ACTIVE" || cancelled || busy} onClick={() => void voidBooking(booking)}>Void Booking</button></div></td></tr>;
      })}</tbody></table></div>
      {!visible.length && <div className="adj-empty-history">No {config.label} bookings found for this filter.</div>}
    </section></div>}

    {previewBooking && <div className="modal-backdrop adj-backdrop" onMouseDown={(e) => e.currentTarget === e.target && setPreviewBooking(null)}><section className="adj-shell lifecycle-preview" onMouseDown={(e) => e.stopPropagation()}><div className="adj-toolbar"><div><span className="eyebrow blue">OPEN {service} BOOKING</span><h2>{previewBooking.ub_number}</h2><p>{previewBooking.counterparty_name} · {previewBooking.transaction_type} · Current Effective Value {money(previewBooking.total_pkr)}</p></div><button type="button" className="adj-close" onClick={() => setPreviewBooking(null)}>×</button></div><div className="adj-identity-strip"><div><small>UB</small><b>{previewBooking.ub_number}</b></div><div><small>ACCOUNT</small><b>{previewBooking.counterparty_name}</b></div><div><small>BOOKING DATE</small><b>{previewBooking.transaction_date}</b></div><div><small>TRANSACTION</small><b>{previewBooking.transaction_type}</b></div><div><small>CURRENT VALUE</small><b>{money(previewBooking.total_pkr)}</b></div></div><section className="adj-section"><div className="adj-section-title"><span>02</span><div><b>CURRENT EFFECTIVE {service} COMMERCIAL ROWS</b><small>Read-only. Use Booking Adjustment for any commercial change.</small></div></div><div className="adj-lines-table-wrap"><table className="adj-lines-table"><thead><tr>{columnsFor(service).map((column) => <th key={column.key}>{column.label}</th>)}<th>PKR VALUE</th></tr></thead><tbody>{rowsFor(service, previewBooking.raw).map((row) => <tr key={row.id}>{columnsFor(service).map((column) => <td key={column.key}>{inputValue(row, column.key) || "—"}</td>)}<td><b>{money(calculateLine(service, row))}</b></td></tr>)}</tbody></table></div></section></section></div>}

    {selectedAdjustment && <UniversalBookingAdjustment
      companyId={companyId}
      service={service}
      booking={selectedAdjustment}
      userId={userId}
      canEdit={canEdit}
      initialView={historyBooking ? "HISTORY" : "ADJUSTMENT"}
      columns={selectedColumns}
      initialRows={selectedRows}
      createRow={() => createRowFor(service)}
      describeRow={(row, index) => describeRow(service, row, index)}
      calculateLineTotalPkr={(row) => calculateLine(service, row)}
      quantityFor={(row) => quantityFor(service, row)}
      withQuantity={(row, quantity) => withQuantity(service, row, quantity)}
      onApplyRows={(rows) => applyRows(selectedAdjustment, rows)}
      onClose={() => { setAdjustmentBooking(null); setHistoryBooking(null); }}
      onSaved={adjustmentSaved}
    />}
  </>;
}
