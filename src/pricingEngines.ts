export function num(value: string | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function whole(value: string | number | null | undefined): number {
  return Math.max(0, Math.trunc(num(value)));
}

// -----------------------------------------------------------------------------
// VISA PRICING
// -----------------------------------------------------------------------------

export type VisaVehicleType = "CAR" | "STARIA" | "HIACE" | "COASTER" | "BUS";
export type VisaType =
  "ONLY_UMRAH_VISA" | "UMRAH_VISA_TRANSPORT" | "UMRAH_VISA_ONE_WAY_TRANSPORT" | "UMRAH_VISA_FULL_TRANSPORT";
export type VisaPassengerType = "ADULT" | "CHILD" | "INFANT";

export interface VisaRowPricing {
  passengerType: VisaPassengerType;
  visaType: VisaType | "";
  visaRateSar: string;
  paxCount: string;
  roe: string;
}

export interface VisaFleetPricing {
  vehicleType: VisaVehicleType;
  quantity: string;
  ratePerVehicleSar: string;
}

const visaVehicles: Array<{ value: VisaVehicleType; capacity: number }> = [
  { value: "CAR", capacity: 4 },
  { value: "STARIA", capacity: 7 },
  { value: "HIACE", capacity: 10 },
  { value: "COASTER", capacity: 20 },
  { value: "BUS", capacity: 47 },
];

export function visaVehicleCapacity(type: VisaVehicleType) {
  return visaVehicles.find((item) => item.value === type)?.capacity || 0;
}

export function visaNeedsPrivate(type: VisaType | "") {
  return type === "UMRAH_VISA_ONE_WAY_TRANSPORT" || type === "UMRAH_VISA_FULL_TRANSPORT";
}

export function visaNeedsBus(type: VisaType | "") {
  return type === "UMRAH_VISA_FULL_TRANSPORT";
}

export function calculateVisaSummary(rows: VisaRowPricing[], fleet: VisaFleetPricing[], busRate: string) {
  const by = { ADULT: 0, CHILD: 0, INFANT: 0 } as Record<VisaPassengerType, number>;
  let visaPax = 0,
    privatePax = 0,
    fullBusPax = 0,
    visaSar = 0;

  rows.forEach((row) => {
    const q = whole(row.paxCount);
    if (!q) return;
    by[row.passengerType] += q;
    visaPax += q;
    visaSar += num(row.visaRateSar) * q;
    if (visaNeedsPrivate(row.visaType)) privatePax += q;
    if (visaNeedsBus(row.visaType)) fullBusPax += q;
  });

  const fleetSar = fleet.reduce(
    (sum, item) => sum + num(item.ratePerVehicleSar) * Math.max(1, whole(item.quantity)),
    0,
  );
  const fleetCapacity = fleet.reduce(
    (sum, item) => sum + visaVehicleCapacity(item.vehicleType) * Math.max(1, whole(item.quantity)),
    0,
  );
  const privatePerPax = privatePax ? fleetSar / privatePax : 0;
  const busSar = fullBusPax ? num(busRate) * fullBusPax : 0;

  let convertedPkr = 0,
    unconvertedSar = 0;

  rows.forEach((row) => {
    const q = whole(row.paxCount);
    if (!q) return;
    let total = num(row.visaRateSar) * q;
    if (visaNeedsPrivate(row.visaType)) total += privatePerPax * q;
    if (visaNeedsBus(row.visaType)) total += num(busRate) * q;
    if (num(row.roe) > 0) convertedPkr += total * num(row.roe);
    else unconvertedSar += total;
  });

  if (privatePax === 0 && fleetSar > 0) unconvertedSar += fleetSar;

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
}

// -----------------------------------------------------------------------------
// TICKET PRICING
// -----------------------------------------------------------------------------

export type TicketPassengerType = "ADULT" | "CHILD" | "INFANT";

export interface TicketRowPricing {
  passengerType: TicketPassengerType;
  passengerName: string;
  airlineName: string;
  pnr: string;
  ticketRoute: string;
  rate: string;
  count: string;
}

export function ticketRowHasData(row: TicketRowPricing) {
  return Boolean(
    row.passengerName.trim() || row.airlineName.trim() || row.pnr.trim() || row.ticketRoute.trim() || row.rate.trim(),
  );
}

export function ticketRowQty(row: TicketRowPricing) {
  return ticketRowHasData(row) ? (row.count.trim() === "" ? 1 : whole(row.count)) : 0;
}

export function ticketRowTotal(row: TicketRowPricing) {
  return ticketRowHasData(row) ? num(row.rate) * ticketRowQty(row) : 0;
}

export function calculateTicketSummary(rows: TicketRowPricing[]) {
  const qty = { ADULT: 0, CHILD: 0, INFANT: 0 },
    amount = { ADULT: 0, CHILD: 0, INFANT: 0 };
  rows.forEach((row) => {
    qty[row.passengerType] += ticketRowQty(row);
    amount[row.passengerType] += ticketRowTotal(row);
  });
  return { qty, amount, total: qty.ADULT + qty.CHILD + qty.INFANT, grand: amount.ADULT + amount.CHILD + amount.INFANT };
}

// -----------------------------------------------------------------------------
// HOTEL PRICING
// -----------------------------------------------------------------------------

export type HotelRoomType = "SHARING" | "QUINT_SHARING" | "QUAD" | "TRIPLE" | "DOUBLE" | "SUITE_ROOM";

export interface HotelRowPricing {
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
}

export function hotelCountNights(checkIn: string, checkOut: string) {
  if (!checkIn || !checkOut) return 0;
  const [y1, m1, d1] = checkIn.split("-").map(Number);
  const [y2, m2, d2] = checkOut.split("-").map(Number);
  return Math.max(0, Math.floor((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000));
}

export function hotelRowHasData(row: HotelRowPricing) {
  return Boolean(
    row.guestName.trim() ||
    row.city.trim() ||
    row.hotelName.trim() ||
    row.checkIn ||
    row.checkOut ||
    row.roomType ||
    row.quantity.trim() ||
    row.rate.trim() ||
    row.roe.trim(),
  );
}

export function hotelRowSar(row: HotelRowPricing) {
  return num(row.rate) * whole(row.nights) * whole(row.quantity);
}

export function hotelRowPkr(row: HotelRowPricing) {
  return num(row.roe) > 0 ? hotelRowSar(row) * num(row.roe) : 0;
}

export function calculateHotelSummary(rows: HotelRowPricing[]) {
  let stays = 0,
    totalNights = 0,
    rooms = 0,
    beds = 0,
    totalSar = 0,
    totalPkr = 0,
    pendingSar = 0;
  rows.forEach((row) => {
    if (!hotelRowHasData(row)) return;
    stays += 1;
    totalNights += whole(row.nights);
    if (row.roomType === "SHARING") beds += whole(row.quantity);
    else rooms += whole(row.quantity);
    const amountSar = hotelRowSar(row);
    totalSar += amountSar;
    if (num(row.roe) > 0) totalPkr += hotelRowPkr(row);
    else pendingSar += amountSar;
  });
  return { stays, totalNights, rooms, beds, totalSar, totalPkr, pendingSar };
}

// -----------------------------------------------------------------------------
// TRANSPORT PRICING
// -----------------------------------------------------------------------------

export type TransportType = "SHARING_BUS" | "PRIVATE_VEHICLE";
export type TransportVehicleType =
  "CAR" | "GMC_YUKON" | "STARIA" | "STAREX" | "HIACE" | "COASTER" | "BUS" | "SHARING_BUS" | "OTHER";

export interface TransportRowPricing {
  transportType: TransportType;
  vehicleType: TransportVehicleType;
  rateSar: string;
  paxCount: string;
  vehicleCount: string;
  roe: string;
}

export const TRANSPORT_VEHICLE_CAPACITIES: Record<TransportVehicleType, number | null> = {
  CAR: 4,
  GMC_YUKON: 5,
  STARIA: 7,
  STAREX: 6,
  HIACE: 10,
  COASTER: 20,
  BUS: 47,
  SHARING_BUS: null,
  OTHER: null,
};

export function transportRowCalc(row: TransportRowPricing) {
  const rate = num(row.rateSar),
    pax = whole(row.paxCount),
    vehiclesCount = whole(row.vehicleCount);
  const totalSar = row.transportType === "SHARING_BUS" ? rate * pax : rate * vehiclesCount;
  const roe = Math.max(0, num(row.roe));
  return { totalSar, totalPkr: roe > 0 ? totalSar * roe : 0, roe };
}

export function transportRowCapacity(row: TransportRowPricing) {
  if (row.transportType !== "PRIVATE_VEHICLE") return null;
  const each = TRANSPORT_VEHICLE_CAPACITIES[row.vehicleType];
  return each ? each * Math.max(1, whole(row.vehicleCount)) : null;
}

export function calculateTransportSummary(rows: TransportRowPricing[]) {
  let sharingPax = 0,
    privateTrips = 0,
    privateVehicles = 0,
    sharingSar = 0,
    privateSar = 0,
    totalPkr = 0,
    pending = 0;
  rows.forEach((row) => {
    const c = transportRowCalc(row);
    if (row.transportType === "SHARING_BUS") {
      sharingPax += whole(row.paxCount);
      sharingSar += c.totalSar;
    } else {
      privateTrips += 1;
      privateVehicles += whole(row.vehicleCount);
      privateSar += c.totalSar;
    }
    totalPkr += c.totalPkr;
    if (c.totalSar > 0 && c.roe <= 0) pending += c.totalSar;
  });
  return {
    sectors: rows.length,
    sharingPax,
    privateTrips,
    privateVehicles,
    sharingSar,
    privateSar,
    totalSar: sharingSar + privateSar,
    totalPkr,
    pending,
  };
}

// -----------------------------------------------------------------------------
// MISC PRICING
// -----------------------------------------------------------------------------

export interface MiscRowPricing {
  serviceName: string;
  familyHead: string;
  paxCount: string;
  ratePerPerson: string;
  roe: string;
}

export function miscRowCalc(row: MiscRowPricing) {
  const pax = whole(row.paxCount),
    rate = num(row.ratePerPerson),
    roe = Math.max(0, num(row.roe)),
    base = rate * pax;
  return roe > 0
    ? { mode: "SAR" as const, pax, totalSar: base, totalPkr: base * roe, roe }
    : { mode: "PKR" as const, pax, totalSar: 0, totalPkr: base, roe: 0 };
}

export function miscRowHasData(row: MiscRowPricing) {
  return Boolean(
    row.serviceName.trim() ||
    row.familyHead.trim() ||
    row.paxCount.trim() ||
    row.ratePerPerson.trim() ||
    row.roe.trim(),
  );
}

export function calculateMiscSummary(rows: MiscRowPricing[]) {
  let services = 0,
    paxEntries = 0,
    totalSar = 0,
    totalPkr = 0;
  rows.forEach((row) => {
    if (!miscRowHasData(row)) return;
    const c = miscRowCalc(row);
    services += 1;
    paxEntries += c.pax;
    totalSar += c.totalSar;
    totalPkr += c.totalPkr;
  });
  return { services, paxEntries, totalSar, totalPkr };
}

// -----------------------------------------------------------------------------
// PACKAGE PRICING
// -----------------------------------------------------------------------------

export type PackagePassengerType = "ADULT" | "CHILD" | "INFANT";

export interface PackageRowPricing {
  passengerType: PackagePassengerType;
  passengerName: string;
  packageType: string;
  rate: string;
  count: string;
}

export function packageExplicitCount(value: string) {
  return Math.max(0, Math.trunc(num(value)));
}

export function packageEffectiveCount(value: string) {
  return value.trim() === "" ? 1 : packageExplicitCount(value);
}

export function packageRowHasData(row: PackageRowPricing) {
  return Boolean(row.passengerName.trim() || row.packageType.trim() || row.rate.trim() || row.count.trim());
}

export function packageRowPax(row: PackageRowPricing) {
  return packageRowHasData(row) ? packageEffectiveCount(row.count) : 0;
}

export function packageRowTotal(row: PackageRowPricing) {
  return num(row.rate) * packageEffectiveCount(row.count);
}

export function calculatePackageSummary(rows: PackageRowPricing[]) {
  const qty = { ADULT: 0, CHILD: 0, INFANT: 0 };
  const amount = { ADULT: 0, CHILD: 0, INFANT: 0 };
  rows.forEach((row) => {
    qty[row.passengerType] += packageRowPax(row);
    amount[row.passengerType] += packageRowTotal(row);
  });
  return {
    qty,
    amount,
    totalPax: qty.ADULT + qty.CHILD + qty.INFANT,
    grandTotal: amount.ADULT + amount.CHILD + amount.INFANT,
  };
}
