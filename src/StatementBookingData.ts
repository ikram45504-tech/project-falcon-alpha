import type {
  HotelBooking,
  PackageBooking,
  Party,
  TransportBooking,
  VisaBooking,
} from "./db";
import {
  getHotelBookings,
  getPackageBookings,
  getTransportBookings,
  getVisaBookings,
} from "./db";
import {
  getTicketCommercialBookings,
  type TicketCommercialBooking,
} from "./TicketFlowDb";
import { getHotelOperationalDetails } from "./HotelOperationalDb";
import { getMiscBookings, type MiscBooking } from "./miscDb";
import { getMiscOperationalDetails } from "./MiscOperationalDb";

export type HotelStatementBooking = HotelBooking & { guestRefs: string[] };
export type MiscStatementBooking = MiscBooking & { familyHeads: string[] };

export type StatementBookingSections = {
  packageBookings: PackageBooking[];
  ticketBookings: TicketCommercialBooking[];
  hotelBookings: HotelStatementBooking[];
  visaBookings: VisaBooking[];
  transportBookings: TransportBooking[];
  miscBookings: MiscStatementBooking[];
};

export type StatementBookingHeader = {
  transaction_date: string;
  total_pkr: number;
  unconverted_sar: number;
};

function relevantDirection(accountType: Party["account_type"]) {
  if (accountType === "PARTY") return "SALE" as const;
  if (accountType === "VENDOR") return "PURCHASE" as const;
  return null;
}

function matchesAccount<T extends {
  counterparty_id: string;
  transaction_type: "SALE" | "PURCHASE";
  status: "ACTIVE" | "VOID";
}>(row: T, counterpartyId: string, direction: "SALE" | "PURCHASE" | null) {
  return row.status === "ACTIVE" &&
    row.counterparty_id === counterpartyId &&
    (!direction || row.transaction_type === direction);
}

function byDate<T extends { transaction_date: string; created_at: string }>(a: T, b: T) {
  return a.transaction_date.localeCompare(b.transaction_date) || a.created_at.localeCompare(b.created_at);
}

export async function getStatementBookingSections(
  companyId: string,
  counterpartyId: string,
  accountType: Party["account_type"]
): Promise<StatementBookingSections> {
  const direction = relevantDirection(accountType);
  const [packages, tickets, hotels, visas, transports, misc] = await Promise.all([
    getPackageBookings(companyId, ""),
    getTicketCommercialBookings(companyId, ""),
    getHotelBookings(companyId, ""),
    getVisaBookings(companyId, ""),
    getTransportBookings(companyId, ""),
    getMiscBookings(companyId, ""),
  ]);

  const packageBookings = packages.filter((row) => matchesAccount(row, counterpartyId, direction)).sort(byDate);
  const ticketBookings = tickets.filter((row) => matchesAccount(row, counterpartyId, direction)).sort(byDate);
  const matchedHotels = hotels.filter((row) => matchesAccount(row, counterpartyId, direction)).sort(byDate);
  const visaBookings = visas.filter((row) => matchesAccount(row, counterpartyId, direction)).sort(byDate);
  const transportBookings = transports.filter((row) => matchesAccount(row, counterpartyId, direction)).sort(byDate);
  const matchedMisc = misc.filter((row) => matchesAccount(row, counterpartyId, direction)).sort(byDate);

  const hotelBookings = await Promise.all(matchedHotels.map(async (booking) => {
    const details = await getHotelOperationalDetails(companyId, booking.id);
    return { ...booking, guestRefs: details.guestRefs };
  }));

  const miscBookings = await Promise.all(matchedMisc.map(async (booking) => {
    const details = await getMiscOperationalDetails(companyId, booking.id);
    return { ...booking, familyHeads: details.familyHeads };
  }));

  return {
    packageBookings,
    ticketBookings,
    hotelBookings,
    visaBookings,
    transportBookings,
    miscBookings,
  };
}

export function statementBookingHeaders(sections: StatementBookingSections): StatementBookingHeader[] {
  return [
    ...sections.packageBookings.map((row) => ({ transaction_date: row.transaction_date, total_pkr: Number(row.total_pkr || 0), unconverted_sar: 0 })),
    ...sections.ticketBookings.map((row) => ({ transaction_date: row.transaction_date, total_pkr: Number(row.total_pkr || 0), unconverted_sar: 0 })),
    ...sections.hotelBookings.map((row) => ({ transaction_date: row.transaction_date, total_pkr: Number(row.total_pkr || 0), unconverted_sar: Number(row.unconverted_sar || 0) })),
    ...sections.visaBookings.map((row) => ({ transaction_date: row.transaction_date, total_pkr: Number(row.total_pkr || 0), unconverted_sar: Number(row.unconverted_sar || 0) })),
    ...sections.transportBookings.map((row) => ({ transaction_date: row.transaction_date, total_pkr: Number(row.total_pkr || 0), unconverted_sar: Number(row.unconverted_sar || 0) })),
    ...sections.miscBookings.map((row) => ({ transaction_date: row.transaction_date, total_pkr: Number(row.total_pkr || 0), unconverted_sar: Number(row.unconverted_sar || 0) })),
  ].sort((a, b) => a.transaction_date.localeCompare(b.transaction_date));
}

export function filterStatementSections(
  sections: StatementBookingSections,
  fromDate: string,
  toDate: string
): StatementBookingSections {
  const inPeriod = (date: string) => date >= fromDate && date <= toDate;
  return {
    packageBookings: sections.packageBookings.filter((row) => inPeriod(row.transaction_date)),
    ticketBookings: sections.ticketBookings.filter((row) => inPeriod(row.transaction_date)),
    hotelBookings: sections.hotelBookings.filter((row) => inPeriod(row.transaction_date)),
    visaBookings: sections.visaBookings.filter((row) => inPeriod(row.transaction_date)),
    transportBookings: sections.transportBookings.filter((row) => inPeriod(row.transaction_date)),
    miscBookings: sections.miscBookings.filter((row) => inPeriod(row.transaction_date)),
  };
}

export function countStatementBookings(sections: StatementBookingSections) {
  return sections.packageBookings.length +
    sections.ticketBookings.length +
    sections.hotelBookings.length +
    sections.visaBookings.length +
    sections.transportBookings.length +
    sections.miscBookings.length;
}
