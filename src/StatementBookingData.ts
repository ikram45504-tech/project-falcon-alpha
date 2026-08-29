import Database from "@tauri-apps/plugin-sql";
import type { HotelBooking, PackageBooking, Party, TransportBooking, VisaBooking } from "./db";
import { getHotelBookings, getPackageBookings, getTransportBookings, getVisaBookings } from "./db";
import { getTicketCommercialBookings, type TicketCommercialBooking } from "./TicketFlowDb";
import { getHotelOperationalDetails } from "./HotelOperationalDb";
import { getMiscBookings, type MiscBooking } from "./miscDb";
import { getMiscOperationalDetails } from "./MiscOperationalDb";
import { initPackageAdjustmentDatabase } from "./PackageAdjustmentDb";
import { initHotelAdjustmentDatabase } from "./HotelAdjustmentDb";
import { initUniversalBookingAdjustmentDatabase } from "./UniversalBookingAdjustmentDb";
import type { BookingAdjustmentKind, BookingLifecycleStatus, BookingServiceName } from "./BookingLifecycle";
import { isDesktopApp } from "./cloudSync";

const DB_PATH = "sqlite:travel-accounting.db";
let statementDatabasePromise: Promise<Database> | null = null;

export type StatementAdjustmentRecord = {
  id: string;
  company_id: string;
  service_type: BookingServiceName;
  booking_id: string;
  adjustment_type: BookingAdjustmentKind;
  adjustment_date: string;
  category: string;
  reason: string;
  reference: string;
  notes: string;
  previous_total_pkr: number;
  previous_base_pkr: number;
  revised_base_pkr: number;
  charge_pkr: number;
  credit_pkr: number;
  account_delta_pkr: number;
  effective_total_pkr: number;
  before_snapshot_json: string;
  after_snapshot_json: string;
  cancelled_lines_json: string;
  revision_no: number;
  lifecycle_status: BookingLifecycleStatus;
  created_at: string;
};

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

async function statementDb() {
  if (!statementDatabasePromise) statementDatabasePromise = Database.load(DB_PATH);
  const database = await statementDatabasePromise;
  await database.execute("PRAGMA busy_timeout = 5000");
  return database;
}

async function getStatementAdjustments(companyId: string) {
  await Promise.all([
    initPackageAdjustmentDatabase(),
    initHotelAdjustmentDatabase(),
    initUniversalBookingAdjustmentDatabase(),
  ]);
  const database = await statementDb();
  return database.select<StatementAdjustmentRecord[]>(
    `SELECT id,company_id,'PACKAGE' AS service_type,booking_id,adjustment_type,adjustment_date,
            category,reason,reference,notes,previous_total_pkr,previous_base_pkr,revised_base_pkr,
            charge_pkr,credit_pkr,account_delta_pkr,effective_total_pkr,before_snapshot_json,
            after_snapshot_json,cancelled_lines_json,revision_no,lifecycle_status,created_at
       FROM package_booking_adjustments
      WHERE company_id=$1
      UNION ALL
     SELECT id,company_id,'HOTEL' AS service_type,booking_id,adjustment_type,adjustment_date,
            category,reason,reference,notes,previous_total_pkr,previous_base_pkr,revised_base_pkr,
            charge_pkr,credit_pkr,account_delta_pkr,effective_total_pkr,before_snapshot_json,
            after_snapshot_json,cancelled_lines_json,revision_no,lifecycle_status,created_at
       FROM hotel_booking_adjustments
      WHERE company_id=$1
      UNION ALL
     SELECT id,company_id,service_type,booking_id,adjustment_type,adjustment_date,
            category,reason,reference,notes,previous_total_pkr,previous_base_pkr,revised_base_pkr,
            charge_pkr,credit_pkr,account_delta_pkr,effective_total_pkr,before_snapshot_json,
            after_snapshot_json,cancelled_lines_json,revision_no,lifecycle_status,created_at
       FROM booking_adjustments
      WHERE company_id=$1
        AND service_type <> 'HOTEL'
      UNION ALL
     SELECT id,company_id,service_type,booking_id,adjustment_type,adjustment_date,
            category,reason,reference,notes,previous_total_pkr,previous_base_pkr,revised_base_pkr,
            charge_pkr,credit_pkr,account_delta_pkr,effective_total_pkr,before_snapshot_json,
            after_snapshot_json,cancelled_lines_json,revision_no,lifecycle_status,created_at
       FROM booking_adjustments
      WHERE company_id=$1
        AND service_type = 'HOTEL'
        AND id NOT IN (SELECT id FROM hotel_booking_adjustments WHERE company_id=$1)
      ORDER BY service_type,booking_id,revision_no,created_at`,
    [companyId],
  );
}

function relevantDirection(accountType: Party["account_type"]) {
  if (accountType === "PARTY") return "SALE" as const;
  if (accountType === "VENDOR") return "PURCHASE" as const;
  return null;
}

function matchesAccount<
  T extends {
    counterparty_id: string;
    transaction_type: "SALE" | "PURCHASE";
    status: "ACTIVE" | "VOID";
  },
>(row: T, counterpartyId: string, direction: "SALE" | "PURCHASE" | null) {
  return (
    row.status === "ACTIVE" &&
    row.counterparty_id === counterpartyId &&
    (!direction || row.transaction_type === direction)
  );
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

/** Desktop: typo Correction is audit-only — not a chargeable statement revision. Web statements left unchanged. */
function statementVisibleAdjustments(rows: StatementAdjustmentRecord[]) {
  if (!isDesktopApp()) return rows;
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
  const [packages, tickets, hotels, visas, transports, misc, adjustmentRows] = await Promise.all([
    getPackageBookings(companyId, ""),
    getTicketCommercialBookings(companyId, ""),
    getHotelBookings(companyId, ""),
    getVisaBookings(companyId, ""),
    getTransportBookings(companyId, ""),
    getMiscBookings(companyId, ""),
    getStatementAdjustments(companyId),
  ]);
  const adjustments = groupAdjustments(adjustmentRows);

  const packageBookings = packages
    .filter((row) => matchesAccount(row, counterpartyId, direction))
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
    .filter((row) => matchesAccount(row, counterpartyId, direction))
    .sort(byDate)
    .map((row) =>
      enrichBooking("TICKET", row, statementVisibleAdjustments(adjustments[adjustmentKey("TICKET", row.id)] || []), 0),
    );

  const matchedHotels = hotels.filter((row) => matchesAccount(row, counterpartyId, direction)).sort(byDate);
  const hotelBookings = await Promise.all(
    matchedHotels.map(async (booking) => {
      const details = await getHotelOperationalDetails(companyId, booking.id);
      return {
        ...enrichBooking(
          "HOTEL",
          booking,
          statementVisibleAdjustments(adjustments[adjustmentKey("HOTEL", booking.id)] || []),
          Number(booking.unconverted_sar || 0),
        ),
        guestRefs: details.guestRefs,
      };
    }),
  );

  const visaBookings = visas
    .filter((row) => matchesAccount(row, counterpartyId, direction))
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
    .filter((row) => matchesAccount(row, counterpartyId, direction))
    .sort(byDate)
    .map((row) =>
      enrichBooking(
        "TRANSPORT",
        row,
        statementVisibleAdjustments(adjustments[adjustmentKey("TRANSPORT", row.id)] || []),
        Number(row.unconverted_sar || 0),
      ),
    );

  const matchedMisc = misc.filter((row) => matchesAccount(row, counterpartyId, direction)).sort(byDate);
  const miscBookings = await Promise.all(
    matchedMisc.map(async (booking) => {
      const details = await getMiscOperationalDetails(companyId, booking.id);
      return {
        ...enrichBooking(
          "MISC",
          booking,
          statementVisibleAdjustments(adjustments[adjustmentKey("MISC", booking.id)] || []),
          Number(booking.unconverted_sar || 0),
        ),
        familyHeads: details.familyHeads,
      };
    }),
  );

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
