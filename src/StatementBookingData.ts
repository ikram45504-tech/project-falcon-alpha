import type { HotelBooking, PackageBooking, Party, TransportBooking, VisaBooking } from "./db";
import { getHotelBookings, getPackageBookings, getTransportBookings, getVisaBookings } from "./db";
import { getTicketCommercialBookings, type TicketCommercialBooking } from "./TicketFlowDb";
import { getHotelGuestRefsByBookingIds } from "./HotelOperationalDb";
import { getMiscBookings, type MiscBooking } from "./miscDb";
import { getMiscFamilyHeadsByBookingIds } from "./MiscOperationalDb";
import { loadSegmentAdjustmentsForStatements, type StatementSegmentAdjustmentRow } from "./SegmentAdjustmentRecord";
import type { BookingListScope } from "./bookingListScope";
import type { BookingServiceName } from "./BookingLifecycle";

export type StatementAdjustmentRecord = StatementSegmentAdjustmentRow;

export type StatementBookingHeader = {
  transaction_date: string;
  total_pkr: number;
  unconverted_sar: number;
  service_type?: BookingServiceName;
  booking_id?: string;
  event_type?: "BOOKING" | "ADJUSTMENT";
  adjustment_id?: string;
};

export type StatementBookingMeta = {
  statementService: BookingServiceName;
  statementAdjustments: StatementAdjustmentRecord[];
  statementDisplayAdjustments: StatementAdjustmentRecord[];
  statementEvents: StatementBookingHeader[];
  statementOriginalTotalPkr: number;
  statementOriginalSnapshotJson: string;
  statementAsOfTotalPkr: number;
  statementPeriodActivityPkr: number;
  statementOriginalInPeriod: boolean;
};

export type PackageStatementBooking = PackageBooking & StatementBookingMeta;
export type TicketStatementBooking = TicketCommercialBooking & StatementBookingMeta;
export type HotelStatementBooking = HotelBooking & StatementBookingMeta & { guestRefs: string[] };
export type VisaStatementBooking = VisaBooking & StatementBookingMeta;
export type TransportStatementBooking = TransportBooking & StatementBookingMeta;
export type MiscStatementBooking = MiscBooking & StatementBookingMeta & { familyHeads: string[] };

export type StatementBookingSections = {
  packageBookings: PackageStatementBooking[];
  ticketBookings: TicketStatementBooking[];
  hotelBookings: HotelStatementBooking[];
  visaBookings: VisaStatementBooking[];
  transportBookings: TransportStatementBooking[];
  miscBookings: MiscStatementBooking[];
};

function relevantDirection(accountType: Party["account_type"]) {
  if (accountType === "PARTY") return "SALE" as const;
  if (accountType === "VENDOR") return "PURCHASE" as const;
  return null;
}

function byDate<T extends { transaction_date: string; created_at: string }>(a: T, b: T) {
  return a.transaction_date.localeCompare(b.transaction_date) || a.created_at.localeCompare(b.created_at);
}

function adjustmentKey(service: BookingServiceName, bookingId: string) {
  return `${service}:${bookingId}`;
}

function groupAdjustments(rows: StatementAdjustmentRecord[]) {
  const map: Record<string, StatementAdjustmentRecord[]> = {};
  rows.forEach((row) => {
    const key = adjustmentKey(row.service_type, row.booking_id);
    if (!map[key]) map[key] = [];
    map[key].push({
      ...row,
      previous_total_pkr: Number(row.previous_total_pkr || 0),
      previous_base_pkr: Number(row.previous_base_pkr || 0),
      revised_base_pkr: Number(row.revised_base_pkr || 0),
      charge_pkr: Number(row.charge_pkr || 0),
      credit_pkr: Number(row.credit_pkr || 0),
      account_delta_pkr: Number(row.account_delta_pkr || 0),
      effective_total_pkr: Number(row.effective_total_pkr || 0),
      revision_no: Number(row.revision_no || 1),
    });
  });
  Object.values(map).forEach((items) =>
    items.sort(
      (a, b) => Number(a.revision_no || 0) - Number(b.revision_no || 0) || a.created_at.localeCompare(b.created_at),
    ),
  );
  return map;
}

/** Correction is audit-only — not a chargeable statement revision. */
function statementVisibleAdjustments(rows: StatementAdjustmentRecord[]) {
  return rows.filter((row) => row.adjustment_type !== "CORRECTION");
}

function enrichBooking<
  T extends {
    id: string;
    transaction_date: string;
    total_pkr: number;
  },
>(
  service: BookingServiceName,
  booking: T,
  adjustments: StatementAdjustmentRecord[],
  unconvertedSar = 0,
): T & StatementBookingMeta {
  const sorted = [...adjustments].sort(
    (a, b) => Number(a.revision_no || 0) - Number(b.revision_no || 0) || a.created_at.localeCompare(b.created_at),
  );
  const first = sorted[0];
  const latest = sorted[sorted.length - 1];
  const originalTotal = first ? Number(first.previous_total_pkr || 0) : Number(booking.total_pkr || 0);
  const latestPendingSar = Number(unconvertedSar || 0);
  const events: StatementBookingHeader[] = [
    {
      transaction_date: booking.transaction_date,
      total_pkr: originalTotal,
      unconverted_sar: sorted.length ? 0 : latestPendingSar,
      service_type: service,
      booking_id: booking.id,
      event_type: "BOOKING",
    },
  ];
  sorted.forEach((adjustment, index) => {
    events.push({
      transaction_date: adjustment.adjustment_date,
      total_pkr: Number(adjustment.account_delta_pkr || 0),
      unconverted_sar: index === sorted.length - 1 ? latestPendingSar : 0,
      service_type: service,
      booking_id: booking.id,
      event_type: "ADJUSTMENT",
      adjustment_id: adjustment.id,
    });
  });
  return {
    ...booking,
    statementService: service,
    statementAdjustments: sorted,
    statementDisplayAdjustments: sorted,
    statementEvents: events,
    statementOriginalTotalPkr: originalTotal,
    statementOriginalSnapshotJson: first?.before_snapshot_json || "",
    statementAsOfTotalPkr: latest ? Number(latest.effective_total_pkr || 0) : Number(booking.total_pkr || 0),
    statementPeriodActivityPkr: events.reduce((sum, event) => sum + Number(event.total_pkr || 0), 0),
    statementOriginalInPeriod: true,
  };
}

export async function getStatementBookingSections(
  companyId: string,
  counterpartyId: string,
  accountType: Party["account_type"],
): Promise<StatementBookingSections> {
  const direction = relevantDirection(accountType);
  const scope: BookingListScope = {
    counterpartyId,
    status: "ACTIVE",
    ...(direction ? { transactionType: direction } : {}),
  };

  const [packages, tickets, hotels, visas, transports, misc] = await Promise.all([
    getPackageBookings(companyId, "", scope),
    getTicketCommercialBookings(companyId, "", scope),
    getHotelBookings(companyId, "", scope),
    getVisaBookings(companyId, "", scope),
    getTransportBookings(companyId, "", scope),
    getMiscBookings(companyId, "", scope),
  ]);

  const bookingIds = [
    ...packages.map((row) => row.id),
    ...tickets.map((row) => row.id),
    ...hotels.map((row) => row.id),
    ...visas.map((row) => row.id),
    ...transports.map((row) => row.id),
    ...misc.map((row) => row.id),
  ];

  const [adjustmentRows, hotelGuestRefs, miscFamilyHeads] = await Promise.all([
    loadSegmentAdjustmentsForStatements(companyId, bookingIds),
    getHotelGuestRefsByBookingIds(
      companyId,
      hotels.map((row) => row.id),
    ),
    getMiscFamilyHeadsByBookingIds(
      companyId,
      misc.map((row) => row.id),
    ),
  ]);
  const adjustments = groupAdjustments(adjustmentRows);

  const packageBookings = packages
    .sort(byDate)
    .map((row) =>
      enrichBooking(
        "PACKAGE",
        row,
        statementVisibleAdjustments(adjustments[adjustmentKey("PACKAGE", row.id)] || []),
        0,
      ),
    );

  const ticketBookings = tickets
    .sort(byDate)
    .map((row) =>
      enrichBooking("TICKET", row, statementVisibleAdjustments(adjustments[adjustmentKey("TICKET", row.id)] || []), 0),
    );

  const hotelBookings = hotels.sort(byDate).map((booking) => ({
    ...enrichBooking(
      "HOTEL",
      booking,
      statementVisibleAdjustments(adjustments[adjustmentKey("HOTEL", booking.id)] || []),
      Number(booking.unconverted_sar || 0),
    ),
    guestRefs: hotelGuestRefs.get(booking.id) || [],
  }));

  const visaBookings = visas
    .sort(byDate)
    .map((row) =>
      enrichBooking(
        "VISA",
        row,
        statementVisibleAdjustments(adjustments[adjustmentKey("VISA", row.id)] || []),
        Number(row.unconverted_sar || 0),
      ),
    );

  const transportBookings = transports
    .sort(byDate)
    .map((row) =>
      enrichBooking(
        "TRANSPORT",
        row,
        statementVisibleAdjustments(adjustments[adjustmentKey("TRANSPORT", row.id)] || []),
        Number(row.unconverted_sar || 0),
      ),
    );

  const miscBookings = misc.sort(byDate).map((booking) => ({
    ...enrichBooking(
      "MISC",
      booking,
      statementVisibleAdjustments(adjustments[adjustmentKey("MISC", booking.id)] || []),
      Number(booking.unconverted_sar || 0),
    ),
    familyHeads: miscFamilyHeads.get(booking.id) || [],
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

function headersFrom<T extends StatementBookingMeta>(rows: T[]) {
  return rows.flatMap((row) => row.statementEvents);
}

export function statementBookingHeaders(sections: StatementBookingSections): StatementBookingHeader[] {
  return [
    ...headersFrom(sections.packageBookings),
    ...headersFrom(sections.ticketBookings),
    ...headersFrom(sections.hotelBookings),
    ...headersFrom(sections.visaBookings),
    ...headersFrom(sections.transportBookings),
    ...headersFrom(sections.miscBookings),
  ].sort((a, b) => a.transaction_date.localeCompare(b.transaction_date));
}

function scopeBooking<T extends StatementBookingMeta & { transaction_date: string }>(
  row: T,
  fromDate: string,
  toDate: string,
): T | null {
  const inPeriod = (date: string) => date >= fromDate && date <= toDate;
  const periodEvents = row.statementEvents.filter((event) => inPeriod(event.transaction_date));
  if (!periodEvents.length) return null;
  const displayAdjustments = row.statementAdjustments.filter((adjustment) => adjustment.adjustment_date <= toDate);
  const latestAsOf = displayAdjustments[displayAdjustments.length - 1];
  return {
    ...row,
    statementDisplayAdjustments: displayAdjustments,
    statementEvents: periodEvents,
    statementAsOfTotalPkr: latestAsOf
      ? Number(latestAsOf.effective_total_pkr || 0)
      : Number(row.statementOriginalTotalPkr || 0),
    statementPeriodActivityPkr: periodEvents.reduce((sum, event) => sum + Number(event.total_pkr || 0), 0),
    statementOriginalInPeriod: inPeriod(row.transaction_date),
  };
}

function scopeRows<T extends StatementBookingMeta & { transaction_date: string }>(
  rows: T[],
  fromDate: string,
  toDate: string,
) {
  return rows.map((row) => scopeBooking(row, fromDate, toDate)).filter((row): row is T => Boolean(row));
}

export function filterStatementSections(
  sections: StatementBookingSections,
  fromDate: string,
  toDate: string,
): StatementBookingSections {
  return {
    packageBookings: scopeRows(sections.packageBookings, fromDate, toDate),
    ticketBookings: scopeRows(sections.ticketBookings, fromDate, toDate),
    hotelBookings: scopeRows(sections.hotelBookings, fromDate, toDate),
    visaBookings: scopeRows(sections.visaBookings, fromDate, toDate),
    transportBookings: scopeRows(sections.transportBookings, fromDate, toDate),
    miscBookings: scopeRows(sections.miscBookings, fromDate, toDate),
  };
}

export function statementSectionPeriodTotal(rows: StatementBookingMeta[]) {
  return rows.reduce((sum, row) => sum + Number(row.statementPeriodActivityPkr || 0), 0);
}

/**
 * Pending / unconverted SAR as of a statement date.
 * Uses booking-level pending SAR for bookings that already existed by the as-of date
 * (and were not cancelled on/before that date). This avoids the event-sum bug where
 * pending SAR lived only on the latest adjustment row dated after the statement end.
 */
export function statementPendingSarAsOf(
  sections: StatementBookingSections,
  asOfDate: string,
  mode: "onOrBefore" | "before" = "onOrBefore",
) {
  const included = (date: string) => (mode === "before" ? date < asOfDate : date <= asOfDate);
  const rows = [
    ...sections.hotelBookings,
    ...sections.visaBookings,
    ...sections.transportBookings,
    ...sections.miscBookings,
  ];

  return rows.reduce((total, row) => {
    if (!included(row.transaction_date)) return total;

    const adjustmentsAsOf = row.statementAdjustments.filter((adjustment) => included(adjustment.adjustment_date));
    const latestAsOf = adjustmentsAsOf[adjustmentsAsOf.length - 1];
    if (latestAsOf?.lifecycle_status === "CANCELLED") return total;

    return total + Number(row.unconverted_sar || 0);
  }, 0);
}

export function countStatementBookings(sections: StatementBookingSections) {
  return (
    sections.packageBookings.length +
    sections.ticketBookings.length +
    sections.hotelBookings.length +
    sections.visaBookings.length +
    sections.transportBookings.length +
    sections.miscBookings.length
  );
}
