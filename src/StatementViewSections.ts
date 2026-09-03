import type { Party, VisaType } from "./db";
import type { BookingServiceName } from "./BookingLifecycle";
import {
  statementSectionPeriodTotal,
  type StatementAdjustmentRecord,
  type StatementBookingMeta,
} from "./StatementBookingData";
import { inferPaymentKind, paymentKindLabel, signedPaymentSettlement } from "./accountBalance";
import type { StatementPdfData } from "./StatementJsPdf";
import { signedPaymentSarAmount } from "./StatementSummary";

type Align = "left" | "center" | "right";
type Obj = Record<string, unknown>;

export type StatementViewCell = {
  text: string;
  secondary?: string;
  align?: Align;
  bold?: boolean;
};

export type StatementViewRow = {
  kind?: "normal" | "reference" | "adjustment";
  strike?: boolean;
  bookingGroup?: boolean;
  bookingKey?: string;
  cells: StatementViewCell[];
};

export type StatementViewColumn = {
  width: number;
  header: string;
  align?: Align;
};

export type StatementViewSection = {
  title: string;
  columns: StatementViewColumn[];
  rows: StatementViewRow[];
  subtotal: {
    label: string;
    pkr?: number;
    sar?: number;
    pendingSar?: number;
    /** Payments section only: split of settlements vs refunds inside the period. */
    paidPkr?: number;
    refundPkr?: number;
  };
};

function money(value: number) {
  const n = Number(value || 0);
  const sign = n < 0 ? "-" : "";
  return `${sign}Rs ${Math.abs(n).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}
function signedMoney(value: number) {
  const n = Number(value || 0);
  if (n > 0) return `+ ${money(n)}`;
  if (n < 0) return `- ${money(Math.abs(n))}`;
  return money(0);
}
function sar(value: number) {
  return `SAR ${Number(value || 0).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}
function number(value: number) {
  return Number(value || 0).toLocaleString("en-US", { maximumFractionDigits: 2 });
}
function safeText(value: unknown) {
  const text = String(value ?? "").trim();
  return text || "-";
}
function displayName(value: unknown) {
  const text = String(value ?? "").trim();
  if (!text) return "-";
  return text.toLowerCase().replace(/\b\w/g, (char) => char.toUpperCase());
}
function displayUb(value: unknown) {
  const text = String(value ?? "")
    .trim()
    .toUpperCase();
  if (!text) return "-";
  const standard = /^UB-?(\d{4})$/.exec(text);
  return standard ? `UB-${standard[1]}` : text;
}
function countLabel(value: number, singular: string, plural = `${singular}s`) {
  const amount = Number(value || 0);
  return `${number(amount)} ${amount === 1 ? singular : plural}`;
}
function shortDate(value: string) {
  if (!value) return "-";
  const [y, m, d] = value.split("-").map(Number);
  if (!y || !m || !d) return value;
  return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short" })
    .format(new Date(y, m - 1, d))
    .replace(/ /g, "-");
}
function longDate(value: string) {
  if (!value) return "-";
  const [y, m, d] = value.split("-").map(Number);
  if (!y || !m || !d) return value;
  return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" })
    .format(new Date(y, m - 1, d))
    .replace(/ /g, "-");
}
function titleCase(value: string) {
  return value
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}
function flightTypeLabel(value: string) {
  return value === "ONE_WAY" ? "One Way" : value === "MULTI_CITY" ? "Multi-City" : "Return";
}
function visaTypeLabel(value: VisaType | string) {
  if (value === "ONLY_UMRAH_VISA") return "Only Umrah Visa";
  if (value === "UMRAH_VISA_TRANSPORT") return "Umrah Visa + Transport";
  if (value === "UMRAH_VISA_ONE_WAY_TRANSPORT") return "Umrah Visa + One-Way Transport";
  if (value === "UMRAH_VISA_FULL_TRANSPORT") return "Umrah Visa + Full Transport";
  return titleCase(String(value || "Visa"));
}
function object(value: unknown): Obj {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Obj) : {};
}
function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
function parseJson(value: string) {
  if (!value) return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}
function textField(row: Obj, key: string) {
  return String(row[key] ?? "").trim();
}
function numberField(row: Obj, key: string) {
  const n = Number(row[key] ?? 0);
  return Number.isFinite(n) ? n : 0;
}
function universalValues(row: unknown) {
  return object(object(row).values);
}
function inStatementPeriod(date: string, data: StatementPdfData) {
  return date >= data.fromDate && date <= data.toDate;
}
function adjustmentTypeLabel(value: string) {
  if (value === "PARTIAL_CANCELLATION") return "Partial Cancellation";
  if (value === "FULL_CANCELLATION") return "Full Cancellation";
  return titleCase(value);
}
function originalPackageLines(meta: StatementBookingMeta, fallback: Obj[]) {
  const parsed = object(parseJson(meta.statementOriginalSnapshotJson));
  const lines = array(parsed.lines).map(object);
  return lines.length ? lines : fallback;
}
function originalUniversalRows(meta: StatementBookingMeta, fallback: Obj[]) {
  const rows = array(parseJson(meta.statementOriginalSnapshotJson))
    .map(universalValues)
    .filter((row) => Object.keys(row).length > 0);
  return rows.length ? rows : fallback;
}
function hasOriginalSnapshot(meta: StatementBookingMeta) {
  return Boolean(meta.statementOriginalSnapshotJson && meta.statementAdjustments.length);
}
function adjustmentRateSummary(service: BookingServiceName, adjustment: StatementAdjustmentRecord) {
  const parsed = parseJson(adjustment.after_snapshot_json);
  if (service === "PACKAGE") {
    const lines = array(object(parsed).lines).map(object);
    if (lines.length === 1) {
      const rate = numberField(lines[0], "ratePerPerson") || numberField(lines[0], "rate_per_person");
      if (rate > 0) return `${money(rate)} / Pax`;
    }
  } else {
    const rows = array(parsed)
      .map(universalValues)
      .filter((row) => Object.keys(row).length > 0);
    if (rows.length === 1) {
      const row = rows[0];
      if (service === "TICKET") return `${money(Number(row.rate || 0))} / Ticket`;
      if (service === "HOTEL")
        return `${sar(Number(row.rateSar || 0))} / Night${Number(row.roe || 0) > 0 ? ` @ ${number(Number(row.roe))}` : ""}`;
      if (service === "VISA")
        return `${sar(Number(row.visaRateSar || 0))} / Pax${Number(row.roe || 0) > 0 ? ` @ ${number(Number(row.roe))}` : ""}`;
      if (service === "TRANSPORT")
        return `${sar(Number(row.rateSar || 0))}${Number(row.roe || 0) > 0 ? ` @ ${number(Number(row.roe))}` : ""}`;
      if (service === "MISC")
        return Number(row.roe || 0) > 0
          ? `SAR ${number(Number(row.rate || 0))} / Pax @ ${number(Number(row.roe))}`
          : `${money(Number(row.rate || 0))} / Pax`;
    }
  }
  return `Revised Base ${money(adjustment.revised_base_pkr)}`;
}
function adjustmentFinanceSecondary(adjustment: StatementAdjustmentRecord, accountType: Party["account_type"]) {
  const parts: string[] = [];
  if (adjustment.charge_pkr > 0)
    parts.push(`${accountType === "VENDOR" ? "Supplier cost" : "Fee / charge"} +${money(adjustment.charge_pkr)}`);
  if (adjustment.credit_pkr > 0) parts.push(`Credit -${money(adjustment.credit_pkr)}`);
  if (!parts.length) parts.push("No separate fee / credit");
  return parts.join(" | ");
}
function adjustmentReason(adjustment: StatementAdjustmentRecord) {
  const parts = [
    adjustment.reason.trim(),
    adjustment.reference.trim() ? `Ref: ${adjustment.reference.trim()}` : "",
  ].filter(Boolean);
  return parts.join(" | ") || "Booking adjustment";
}
function adjustmentAmountSecondary(adjustment: StatementAdjustmentRecord, data: StatementPdfData, latest: boolean) {
  if (!inStatementPeriod(adjustment.adjustment_date, data))
    return `REV ${adjustment.revision_no} | Prior-period revision reference`;
  const impact = `Period impact ${signedMoney(adjustment.account_delta_pkr)}`;
  return latest ? `Booking total | ${impact}` : `REV ${adjustment.revision_no} effective | ${impact}`;
}

function referenceNotCountedCell(): StatementViewCell {
  return { text: "—", secondary: "Reference · not in total", align: "right" };
}

function chargeableTotalCell(value: number, superseded: boolean, bold = true): StatementViewCell {
  if (superseded) return referenceNotCountedCell();
  return { text: money(value), align: "right", bold };
}

function chargeableTotalOrPending(value: number, superseded: boolean): StatementViewCell {
  if (superseded) return referenceNotCountedCell();
  if (Math.abs(value) >= 0.005) return { text: money(value), align: "right", bold: true };
  return { text: "Pending", align: "right", bold: true };
}

function packageAdjustmentRow(
  booking: StatementBookingMeta & { ub_number: string },
  adjustment: StatementAdjustmentRecord,
  data: StatementPdfData,
  latest: boolean,
): StatementViewRow {
  return {
    kind: "adjustment",
    cells: [
      { text: "A", align: "center", bold: true },
      {
        text: shortDate(adjustment.adjustment_date),
        secondary: displayUb(booking.ub_number),
        align: "center",
        bold: true,
      },
      { text: adjustmentTypeLabel(adjustment.adjustment_type), secondary: adjustmentReason(adjustment), bold: true },
      { text: safeText(adjustment.category || "Booking change"), secondary: `REV ${adjustment.revision_no}` },
      {
        text: adjustmentRateSummary("PACKAGE", adjustment),
        secondary: adjustmentFinanceSecondary(adjustment, data.party.account_type),
        align: "right",
      },
      { text: `R${adjustment.revision_no}`, align: "center", bold: true },
      {
        text: money(adjustment.effective_total_pkr),
        secondary: adjustmentAmountSecondary(adjustment, data, latest),
        align: "right",
        bold: true,
      },
    ],
  };
}
function ticketAdjustmentRow(
  booking: StatementBookingMeta & { ub_number: string },
  adjustment: StatementAdjustmentRecord,
  data: StatementPdfData,
  latest: boolean,
): StatementViewRow {
  return {
    kind: "adjustment",
    cells: [
      { text: "A", align: "center", bold: true },
      {
        text: shortDate(adjustment.adjustment_date),
        secondary: displayUb(booking.ub_number),
        align: "center",
        bold: true,
      },
      { text: adjustmentTypeLabel(adjustment.adjustment_type), secondary: adjustmentReason(adjustment), bold: true },
      {
        text: safeText(adjustment.category || "Booking change"),
        secondary: adjustment.reference ? `Ref: ${adjustment.reference}` : `REV ${adjustment.revision_no}`,
      },
      { text: "Revised booking", secondary: `Base ${money(adjustment.revised_base_pkr)}` },
      {
        text: adjustmentRateSummary("TICKET", adjustment),
        secondary: adjustmentFinanceSecondary(adjustment, data.party.account_type),
        align: "right",
      },
      { text: `R${adjustment.revision_no}`, align: "center", bold: true },
      {
        text: money(adjustment.effective_total_pkr),
        secondary: adjustmentAmountSecondary(adjustment, data, latest),
        align: "right",
        bold: true,
      },
    ],
  };
}
function hotelAdjustmentRow(
  booking: StatementBookingMeta & { ub_number: string },
  adjustment: StatementAdjustmentRecord,
  data: StatementPdfData,
  latest: boolean,
): StatementViewRow {
  return {
    kind: "adjustment",
    cells: [
      { text: "A", align: "center", bold: true },
      {
        text: shortDate(adjustment.adjustment_date),
        secondary: displayUb(booking.ub_number),
        align: "center",
        bold: true,
      },
      { text: adjustmentTypeLabel(adjustment.adjustment_type), secondary: adjustmentReason(adjustment), bold: true },
      {
        text: safeText(adjustment.category || "Booking change"),
        secondary: adjustment.reference ? `Ref: ${adjustment.reference}` : "",
      },
      { text: `REV ${adjustment.revision_no}`, secondary: adjustment.lifecycle_status.replace(/_/g, " ") },
      {
        text: adjustmentRateSummary("HOTEL", adjustment),
        secondary: adjustmentFinanceSecondary(adjustment, data.party.account_type),
      },
      { text: signedMoney(adjustment.account_delta_pkr), secondary: "Account impact", align: "right" },
      {
        text: money(adjustment.effective_total_pkr),
        secondary: adjustmentAmountSecondary(adjustment, data, latest),
        align: "right",
        bold: true,
      },
    ],
  };
}
function visaAdjustmentRow(
  booking: StatementBookingMeta & { ub_number: string },
  adjustment: StatementAdjustmentRecord,
  data: StatementPdfData,
  latest: boolean,
): StatementViewRow {
  return {
    kind: "adjustment",
    cells: [
      { text: "A", align: "center", bold: true },
      {
        text: shortDate(adjustment.adjustment_date),
        secondary: displayUb(booking.ub_number),
        align: "center",
        bold: true,
      },
      { text: adjustmentTypeLabel(adjustment.adjustment_type), secondary: adjustmentReason(adjustment), bold: true },
      {
        text: safeText(adjustment.category || "Visa change"),
        secondary: adjustment.reference ? `Ref: ${adjustment.reference}` : "",
      },
      { text: `R${adjustment.revision_no}`, align: "center", bold: true },
      {
        text: adjustmentRateSummary("VISA", adjustment),
        secondary: adjustmentFinanceSecondary(adjustment, data.party.account_type),
      },
      { text: "-", align: "right" },
      { text: signedMoney(adjustment.account_delta_pkr), secondary: "Account impact", align: "right" },
      {
        text: money(adjustment.effective_total_pkr),
        secondary: adjustmentAmountSecondary(adjustment, data, latest),
        align: "right",
        bold: true,
      },
    ],
  };
}
function transportAdjustmentRow(
  booking: StatementBookingMeta & { ub_number: string },
  adjustment: StatementAdjustmentRecord,
  data: StatementPdfData,
  latest: boolean,
): StatementViewRow {
  return {
    kind: "adjustment",
    cells: [
      { text: "A", align: "center", bold: true },
      {
        text: shortDate(adjustment.adjustment_date),
        secondary: displayUb(booking.ub_number),
        align: "center",
        bold: true,
      },
      { text: adjustmentTypeLabel(adjustment.adjustment_type), secondary: adjustmentReason(adjustment), bold: true },
      {
        text: safeText(adjustment.category || "Transport change"),
        secondary: adjustment.reference ? `Ref: ${adjustment.reference}` : "",
      },
      { text: `REV ${adjustment.revision_no}`, secondary: adjustment.lifecycle_status.replace(/_/g, " ") },
      {
        text: adjustmentRateSummary("TRANSPORT", adjustment),
        secondary: adjustmentFinanceSecondary(adjustment, data.party.account_type),
      },
      { text: signedMoney(adjustment.account_delta_pkr), secondary: "Account impact", align: "right" },
      {
        text: money(adjustment.effective_total_pkr),
        secondary: adjustmentAmountSecondary(adjustment, data, latest),
        align: "right",
        bold: true,
      },
    ],
  };
}
function miscAdjustmentRow(
  booking: StatementBookingMeta & { ub_number: string },
  adjustment: StatementAdjustmentRecord,
  data: StatementPdfData,
  latest: boolean,
): StatementViewRow {
  return {
    kind: "adjustment",
    cells: [
      { text: "A", align: "center", bold: true },
      {
        text: shortDate(adjustment.adjustment_date),
        secondary: displayUb(booking.ub_number),
        align: "center",
        bold: true,
      },
      { text: adjustmentTypeLabel(adjustment.adjustment_type), secondary: adjustmentReason(adjustment), bold: true },
      {
        text: safeText(adjustment.category || "Service change"),
        secondary: adjustment.reference ? `Ref: ${adjustment.reference}` : "",
      },
      { text: `R${adjustment.revision_no}`, align: "center", bold: true },
      {
        text: adjustmentRateSummary("MISC", adjustment),
        secondary: adjustmentFinanceSecondary(adjustment, data.party.account_type),
      },
      { text: signedMoney(adjustment.account_delta_pkr), secondary: "Account impact", align: "right" },
      {
        text: money(adjustment.effective_total_pkr),
        secondary: adjustmentAmountSecondary(adjustment, data, latest),
        align: "right",
        bold: true,
      },
    ],
  };
}
function insertAdjustmentsAfterOriginals(
  originalRows: StatementViewRow[],
  adjustments: StatementAdjustmentRecord[],
  makeAdjustment: (adjustment: StatementAdjustmentRecord, latest: boolean) => StatementViewRow,
) {
  if (!adjustments.length) return originalRows;
  const latestId = adjustments[adjustments.length - 1]?.id;
  const adjustmentRows = adjustments.map((adjustment) => makeAdjustment(adjustment, adjustment.id === latestId));
  if (!originalRows.length) return adjustmentRows;
  return [...originalRows, ...adjustmentRows];
}

function tagBookingGroup(rows: StatementViewRow[], bookingKey: string) {
  const grouped = rows.some((row) => row.kind === "adjustment" || row.kind === "reference");
  return rows.map((row) => ({
    ...row,
    bookingKey,
    bookingGroup: grouped || row.bookingGroup,
  }));
}
function effectiveSarTotal(rows: Array<StatementBookingMeta & { total_sar?: number }>) {
  return rows.reduce((total, row) => {
    const latest = row.statementDisplayAdjustments[row.statementDisplayAdjustments.length - 1];
    if (latest?.lifecycle_status === "CANCELLED") return total;
    return total + Number(row.total_sar || 0);
  }, 0);
}
function effectivePendingSar(rows: Array<StatementBookingMeta & { unconverted_sar?: number }>) {
  return rows.reduce((total, row) => {
    const latest = row.statementDisplayAdjustments[row.statementDisplayAdjustments.length - 1];
    if (latest?.lifecycle_status === "CANCELLED") return total;
    return total + Number(row.unconverted_sar || 0);
  }, 0);
}

function pushSectionIfRows(sections: StatementViewSection[], section: StatementViewSection) {
  if (section.rows.length) sections.push(section);
}

export function buildStatementViewSections(data: StatementPdfData): StatementViewSection[] {
  const sections: StatementViewSection[] = [];
  const packageColumns: StatementViewColumn[] = [
    { width: 7, header: "SR", align: "center" },
    { width: 23, header: "DATE / UB", align: "center" },
    { width: 36, header: "PASSENGER / FAMILY" },
    { width: 42, header: "PAX TYPE / PACKAGE" },
    { width: 26, header: "RATE / PAX", align: "right" },
    { width: 12, header: "QTY", align: "center" },
    { width: 54, header: "TOTAL PKR", align: "right" },
  ];
  const packageRows: StatementViewRow[] = [];
  let packageSr = 0;
  data.sections.packageBookings.forEach((booking) => {
    const fallback = booking.lines.map(
      (line) =>
        ({
          passenger_type: line.passenger_type,
          passenger_name: line.passenger_name,
          package_type: line.package_type,
          rate_per_person: line.rate_per_person,
          person_count: line.person_count,
          line_total_pkr: line.line_total_pkr,
        }) as Obj,
    );
    const originals = hasOriginalSnapshot(booking) ? originalPackageLines(booking, fallback) : fallback;
    const superseded = booking.statementDisplayAdjustments.length > 0;
    const rows = originals.map((line) => {
      packageSr += 1;
      const rate = numberField(line, "rate_per_person") || numberField(line, "ratePerPerson");
      const qty = numberField(line, "person_count") || numberField(line, "personCount") || 1;
      const total = numberField(line, "line_total_pkr") || numberField(line, "lineTotalPkr") || rate * qty;
      return {
        kind: superseded ? ("reference" as const) : ("normal" as const),
        bookingGroup: superseded || undefined,
        cells: [
          { text: String(packageSr), align: "center" },
          {
            text: shortDate(booking.transaction_date),
            secondary: displayUb(booking.ub_number),
            align: "center",
            bold: true,
          },
          { text: displayName(textField(line, "passenger_name") || textField(line, "passengerName")), bold: true },
          {
            text: textField(line, "passenger_type") || textField(line, "passengerType"),
            secondary: safeText(textField(line, "package_type") || textField(line, "packageType")),
          },
          { text: money(rate), align: "right" },
          { text: String(qty), align: "center" },
          chargeableTotalCell(total, superseded),
        ],
      } as StatementViewRow;
    });
    packageRows.push(
      ...tagBookingGroup(
        insertAdjustmentsAfterOriginals(rows, booking.statementDisplayAdjustments, (adjustment, latest) =>
          packageAdjustmentRow(booking, adjustment, data, latest),
        ),
        booking.ub_number,
      ),
    );
  });
  pushSectionIfRows(sections, {
    title: "FULL PACKAGE BOOKINGS",
    columns: packageColumns,
    rows: packageRows,
    subtotal: {
      label: "FULL PACKAGE STATEMENT SUBTOTAL",
      pkr: statementSectionPeriodTotal(data.sections.packageBookings),
    },
  });

  const ticketColumns: StatementViewColumn[] = [
    { width: 7, header: "SR", align: "center" },
    { width: 22, header: "DATE / UB", align: "center" },
    { width: 31, header: "PASSENGER" },
    { width: 34, header: "AIRLINE / PNR" },
    { width: 40, header: "ROUTE / TYPE" },
    { width: 22, header: "RATE", align: "right" },
    { width: 10, header: "QTY", align: "center" },
    { width: 34, header: "TOTAL PKR", align: "right" },
  ];
  const ticketRows: StatementViewRow[] = [];
  let ticketSr = 0;
  data.sections.ticketBookings.forEach((booking) => {
    const fallback = booking.lines.map(
      (line) =>
        ({
          passengerType: line.passenger_type,
          passengerName: line.passenger_name,
          airlineName: line.airline_name,
          pnr: line.pnr,
          flightType: line.flight_type,
          ticketRoute: line.ticket_route,
          rate: line.rate_per_ticket,
          qty: line.ticket_count,
        }) as Obj,
    );
    const originals = hasOriginalSnapshot(booking) ? originalUniversalRows(booking, fallback) : fallback;
    const superseded = booking.statementDisplayAdjustments.length > 0;
    const rows = originals.map((line) => {
      ticketSr += 1;
      const rate = Number(line.rate || 0),
        qty = Math.max(1, Number(line.qty || 1));
      return {
        kind: superseded ? ("reference" as const) : ("normal" as const),
        bookingGroup: superseded || undefined,
        cells: [
          { text: String(ticketSr), align: "center" },
          {
            text: shortDate(booking.transaction_date),
            secondary: displayUb(booking.ub_number),
            align: "center",
            bold: true,
          },
          { text: displayName(line.passengerName), secondary: safeText(line.passengerType), bold: true },
          { text: safeText(line.airlineName), secondary: line.pnr ? `PNR: ${line.pnr}` : "PNR: -" },
          { text: safeText(line.ticketRoute), secondary: flightTypeLabel(String(line.flightType || "RETURN")) },
          { text: money(rate), align: "right" },
          { text: String(qty), align: "center" },
          chargeableTotalCell(rate * qty, superseded),
        ],
      } as StatementViewRow;
    });
    ticketRows.push(
      ...tagBookingGroup(
        insertAdjustmentsAfterOriginals(rows, booking.statementDisplayAdjustments, (adjustment, latest) =>
          ticketAdjustmentRow(booking, adjustment, data, latest),
        ),
        booking.ub_number,
      ),
    );
  });
  pushSectionIfRows(sections, {
    title: "TICKET BOOKINGS",
    columns: ticketColumns,
    rows: ticketRows,
    subtotal: { label: "TICKET STATEMENT SUBTOTAL", pkr: statementSectionPeriodTotal(data.sections.ticketBookings) },
  });

  const hotelColumns: StatementViewColumn[] = [
    { width: 7, header: "SR", align: "center" },
    { width: 22, header: "DATE / UB", align: "center" },
    { width: 40, header: "GUEST / HOTEL" },
    { width: 28, header: "STAY" },
    { width: 24, header: "ROOM" },
    { width: 32, header: "RATE / ROE" },
    { width: 22, header: "TOTAL SAR", align: "right" },
    { width: 25, header: "TOTAL PKR", align: "right" },
  ];
  const hotelRows: StatementViewRow[] = [];
  let hotelSr = 0;
  data.sections.hotelBookings.forEach((booking) => {
    const fallback = booking.lines.map(
      (line) =>
        ({
          city: line.city,
          hotelName: line.hotel_name,
          checkIn: line.check_in,
          checkOut: line.check_out,
          nights: line.nights,
          roomType: line.room_type,
          qty: line.quantity,
          rateSar: line.rate_per_night_sar,
          roe: line.roe,
        }) as Obj,
    );
    const originals = hasOriginalSnapshot(booking) ? originalUniversalRows(booking, fallback) : fallback;
    const superseded = booking.statementDisplayAdjustments.length > 0;
    const rows = originals.map((line, index) => {
      hotelSr += 1;
      const guestName = booking.guestRefs[index] || booking.guest_family_name || booking.counterparty_name;
      const rateSar = Number(line.rateSar || 0),
        nights = Math.max(1, Number(line.nights || 1)),
        qty = Math.max(1, Number(line.qty || 1)),
        roe = Number(line.roe || 0);
      const totalSar = rateSar * nights * qty;
      return {
        kind: superseded ? ("reference" as const) : ("normal" as const),
        bookingGroup: superseded || undefined,
        cells: [
          { text: String(hotelSr), align: "center" },
          {
            text: shortDate(booking.transaction_date),
            secondary: displayUb(booking.ub_number),
            align: "center",
            bold: true,
          },
          {
            text: displayName(guestName),
            secondary: `${safeText(line.hotelName)} - ${safeText(line.city)}`,
            bold: true,
          },
          {
            text: `${shortDate(String(line.checkIn || ""))} to ${shortDate(String(line.checkOut || ""))}`,
            secondary: countLabel(nights, "Night"),
          },
          {
            text: titleCase(String(line.roomType || "")),
            secondary: String(line.roomType) === "SHARING" ? countLabel(qty, "Bed") : countLabel(qty, "Room"),
          },
          { text: `${sar(rateSar)} / Night`, secondary: roe > 0 ? `ROE ${number(roe)}` : "ROE Pending" },
          superseded ? referenceNotCountedCell() : { text: sar(totalSar), align: "right" },
          superseded
            ? referenceNotCountedCell()
            : { text: roe > 0 ? money(totalSar * roe) : "Pending", align: "right", bold: true },
        ],
      } as StatementViewRow;
    });
    hotelRows.push(
      ...tagBookingGroup(
        insertAdjustmentsAfterOriginals(rows, booking.statementDisplayAdjustments, (adjustment, latest) =>
          hotelAdjustmentRow(booking, adjustment, data, latest),
        ),
        booking.ub_number,
      ),
    );
  });
  pushSectionIfRows(sections, {
    title: "HOTEL BOOKINGS",
    columns: hotelColumns,
    rows: hotelRows,
    subtotal: {
      label: "HOTEL STATEMENT SUBTOTAL",
      sar: effectiveSarTotal(data.sections.hotelBookings),
      pkr: statementSectionPeriodTotal(data.sections.hotelBookings),
      pendingSar: effectivePendingSar(data.sections.hotelBookings),
    },
  });

  const visaColumns: StatementViewColumn[] = [
    { width: 7, header: "SR", align: "center" },
    { width: 22, header: "DATE / UB", align: "center" },
    { width: 32, header: "PASSENGER / FAMILY" },
    { width: 38, header: "VISA SERVICE" },
    { width: 10, header: "PAX", align: "center" },
    { width: 37, header: "VISA / TRANSPORT" },
    { width: 12, header: "ROE", align: "right" },
    { width: 20, header: "TOTAL SAR", align: "right" },
    { width: 22, header: "TOTAL PKR", align: "right" },
  ];
  const visaRows: StatementViewRow[] = [];
  let visaSr = 0;
  data.sections.visaBookings.forEach((booking) => {
    const fallback = booking.lines.map((line) => {
      const pax = Math.max(1, Number(line.pax_count || 1));
      const visaPkr = Number(line.roe || 0) > 0 ? Number(line.visa_rate_sar || 0) * pax * Number(line.roe || 0) : 0;
      const transportPkrPerPax = Math.max(0, Number(line.line_total_pkr || 0) - visaPkr) / pax;
      return {
        passengerType: line.passenger_type,
        passengerName: line.passenger_name,
        visaType: line.visa_type,
        visaRateSar: line.visa_rate_sar,
        qty: line.pax_count,
        roe: line.roe,
        transportPkrPerPax,
      } as Obj;
    });
    const originals = hasOriginalSnapshot(booking) ? originalUniversalRows(booking, fallback) : fallback;
    const superseded = booking.statementDisplayAdjustments.length > 0;
    const rows = originals.map((line) => {
      visaSr += 1;
      const pax = Math.max(1, Number(line.qty || 1)),
        rateSar = Number(line.visaRateSar || 0),
        roe = Number(line.roe || 0),
        transportPkr = Number(line.transportPkrPerPax || 0) * pax;
      const totalSar = rateSar * pax;
      const totalPkr = roe > 0 ? totalSar * roe + transportPkr : transportPkr;
      return {
        kind: superseded ? ("reference" as const) : ("normal" as const),
        bookingGroup: superseded || undefined,
        cells: [
          { text: String(visaSr), align: "center" },
          {
            text: shortDate(booking.transaction_date),
            secondary: displayUb(booking.ub_number),
            align: "center",
            bold: true,
          },
          { text: displayName(line.passengerName), secondary: safeText(line.passengerType), bold: true },
          { text: visaTypeLabel(String(line.visaType || "")) },
          { text: String(pax), align: "center" },
          {
            text: `Visa ${sar(rateSar)} / Pax`,
            secondary: transportPkr > 0 ? `Transport PKR ${money(transportPkr)}` : "Transport -",
          },
          { text: roe > 0 ? number(roe) : "Pending", align: "right" },
          superseded ? referenceNotCountedCell() : { text: sar(totalSar), align: "right" },
          chargeableTotalOrPending(totalPkr, superseded),
        ],
      } as StatementViewRow;
    });
    visaRows.push(
      ...tagBookingGroup(
        insertAdjustmentsAfterOriginals(rows, booking.statementDisplayAdjustments, (adjustment, latest) =>
          visaAdjustmentRow(booking, adjustment, data, latest),
        ),
        booking.ub_number,
      ),
    );
  });
  pushSectionIfRows(sections, {
    title: "VISA BOOKINGS",
    columns: visaColumns,
    rows: visaRows,
    subtotal: {
      label: "VISA STATEMENT SUBTOTAL",
      sar: effectiveSarTotal(data.sections.visaBookings),
      pkr: statementSectionPeriodTotal(data.sections.visaBookings),
      pendingSar: effectivePendingSar(data.sections.visaBookings),
    },
  });

  const transportColumns: StatementViewColumn[] = [
    { width: 7, header: "SR", align: "center" },
    { width: 22, header: "DATE / UB", align: "center" },
    { width: 40, header: "SECTOR" },
    { width: 32, header: "TRANSPORT / VEHICLE" },
    { width: 24, header: "QTY / PAX" },
    { width: 32, header: "RATE / ROE" },
    { width: 20, header: "TOTAL SAR", align: "right" },
    { width: 23, header: "TOTAL PKR", align: "right" },
  ];
  const transportRows: StatementViewRow[] = [];
  let transportSr = 0;
  data.sections.transportBookings.forEach((booking) => {
    const fallback = booking.lines.map(
      (line) =>
        ({
          transportDate: line.transport_date,
          transportType: line.transport_type,
          fromLocation: line.from_location,
          toLocation: line.to_location,
          vehicleType: line.vehicle_type,
          customVehicleName: line.custom_vehicle_name,
          vehicleCount: line.vehicle_count,
          rateSar: line.rate_sar,
          paxCount: line.pax_count,
          roe: line.roe,
        }) as Obj,
    );
    const originals = hasOriginalSnapshot(booking) ? originalUniversalRows(booking, fallback) : fallback;
    const superseded = booking.statementDisplayAdjustments.length > 0;
    const rows = originals.map((line) => {
      transportSr += 1;
      const sharing = String(line.transportType) === "SHARING_BUS";
      const rateSar = Number(line.rateSar || 0),
        roe = Number(line.roe || 0),
        vehicleCount = Number(line.vehicleCount || 0),
        pax = Number(line.paxCount || 0);
      const totalSar = sharing ? rateSar * pax : rateSar * vehicleCount;
      const vehicle = sharing
        ? "Sharing Bus"
        : safeText(line.customVehicleName || titleCase(String(line.vehicleType || "")));
      return {
        kind: superseded ? ("reference" as const) : ("normal" as const),
        bookingGroup: superseded || undefined,
        cells: [
          { text: String(transportSr), align: "center" },
          {
            text: shortDate(booking.transaction_date),
            secondary: displayUb(booking.ub_number),
            align: "center",
            bold: true,
          },
          {
            text: `${safeText(line.fromLocation)} -> ${safeText(line.toLocation)}`,
            secondary: longDate(String(line.transportDate || booking.transaction_date)),
            bold: true,
          },
          { text: sharing ? "Sharing Bus" : "Private Vehicle", secondary: vehicle },
          {
            text: sharing ? countLabel(pax, "Pax", "Pax") : countLabel(vehicleCount, "Vehicle"),
            secondary: sharing ? undefined : countLabel(pax, "Pax", "Pax"),
          },
          {
            text: `${sar(rateSar)} / ${sharing ? "Pax" : "Vehicle"}`,
            secondary: roe > 0 ? `ROE ${number(roe)}` : "ROE Pending",
          },
          superseded ? referenceNotCountedCell() : { text: sar(totalSar), align: "right" },
          chargeableTotalOrPending(roe > 0 ? totalSar * roe : 0, superseded),
        ],
      } as StatementViewRow;
    });
    transportRows.push(
      ...tagBookingGroup(
        insertAdjustmentsAfterOriginals(rows, booking.statementDisplayAdjustments, (adjustment, latest) =>
          transportAdjustmentRow(booking, adjustment, data, latest),
        ),
        booking.ub_number,
      ),
    );
  });
  pushSectionIfRows(sections, {
    title: "TRANSPORT BOOKINGS",
    columns: transportColumns,
    rows: transportRows,
    subtotal: {
      label: "TRANSPORT STATEMENT SUBTOTAL",
      sar: effectiveSarTotal(data.sections.transportBookings),
      pkr: statementSectionPeriodTotal(data.sections.transportBookings),
      pendingSar: effectivePendingSar(data.sections.transportBookings),
    },
  });

  const miscColumns: StatementViewColumn[] = [
    { width: 7, header: "SR", align: "center" },
    { width: 22, header: "DATE / UB", align: "center" },
    { width: 34, header: "SERVICE" },
    { width: 36, header: "FAMILY HEAD" },
    { width: 10, header: "PAX", align: "center" },
    { width: 39, header: "RATE / ROE" },
    { width: 22, header: "ACCOUNT IMPACT", align: "right" },
    { width: 30, header: "TOTAL PKR", align: "right" },
  ];
  const miscRows: StatementViewRow[] = [];
  let miscSr = 0;
  data.sections.miscBookings.forEach((booking) => {
    const fallback = booking.lines.map(
      (line) =>
        ({
          serviceName: line.service_name,
          qty: line.pax_count,
          rate: line.rate_per_person,
          roe: line.currency_mode === "SAR" ? line.roe : 0,
        }) as Obj,
    );
    const originals = hasOriginalSnapshot(booking) ? originalUniversalRows(booking, fallback) : fallback;
    const superseded = booking.statementDisplayAdjustments.length > 0;
    const rows = originals.map((line, index) => {
      miscSr += 1;
      const qty = Math.max(1, Number(line.qty || 1)),
        rate = Number(line.rate || 0),
        roe = Number(line.roe || 0),
        base = rate * qty,
        total = roe > 0 ? base * roe : base;
      const familyHead = booking.familyHeads[index] || booking.counterparty_name;
      return {
        kind: superseded ? ("reference" as const) : ("normal" as const),
        bookingGroup: superseded || undefined,
        cells: [
          { text: String(miscSr), align: "center" },
          {
            text: shortDate(booking.transaction_date),
            secondary: displayUb(booking.ub_number),
            align: "center",
            bold: true,
          },
          { text: safeText(line.serviceName), bold: true },
          { text: displayName(familyHead) },
          { text: String(qty), align: "center" },
          {
            text: roe > 0 ? `SAR ${number(rate)} / Person` : `${money(rate)} / Person`,
            secondary: roe > 0 ? `ROE ${number(roe)}` : "PKR direct",
          },
          { text: "-", align: "right" },
          chargeableTotalCell(total, superseded),
        ],
      } as StatementViewRow;
    });
    miscRows.push(
      ...tagBookingGroup(
        insertAdjustmentsAfterOriginals(rows, booking.statementDisplayAdjustments, (adjustment, latest) =>
          miscAdjustmentRow(booking, adjustment, data, latest),
        ),
        booking.ub_number,
      ),
    );
  });
  pushSectionIfRows(sections, {
    title: "MISC BOOKINGS",
    columns: miscColumns,
    rows: miscRows,
    subtotal: {
      label: "MISC STATEMENT SUBTOTAL",
      sar: effectiveSarTotal(data.sections.miscBookings),
      pkr: statementSectionPeriodTotal(data.sections.miscBookings),
      pendingSar: effectivePendingSar(data.sections.miscBookings),
    },
  });

  const paymentColumns: StatementViewColumn[] = [
    { width: 7, header: "SR", align: "center" },
    { width: 22, header: "DATE", align: "center" },
    { width: 24, header: "RECEIPT #" },
    { width: 30, header: "FROM" },
    { width: 32, header: "TO" },
    { width: 43, header: "DESCRIPTION" },
    { width: 14, header: "TYPE", align: "center" },
    { width: 28, header: "PAID PKR", align: "right" },
  ];
  let paymentPaidPkr = 0;
  let paymentRefundPkr = 0;
  const paymentRows: StatementViewRow[] = data.payments.map((entry, index) => {
    const kind = inferPaymentKind(data.paymentMeta?.get(entry.id), data.party.account_type);
    const signedPkr = signedPaymentSettlement(entry.paid_amount, kind);
    const isRefund = kind === "PARTY_REFUND" || kind === "VENDOR_REFUND";
    if (isRefund) paymentRefundPkr += Math.abs(signedPkr);
    else paymentPaidPkr += signedPkr;
    const sarSecondary =
      entry.currency === "SAR"
        ? `${sar(Math.abs(signedPaymentSarAmount(entry, kind)))} @ ${number(entry.roe)}`
        : undefined;
    return {
      cells: [
        { text: String(index + 1), align: "center" },
        { text: longDate(entry.transaction_date), align: "center" },
        { text: safeText(entry.receipt_no), bold: true },
        { text: safeText(entry.from_account) },
        { text: safeText(entry.to_account) },
        { text: safeText(entry.description || paymentKindLabel(kind)) },
        { text: paymentKindLabel(kind), align: "center" },
        {
          text: money(signedPkr),
          secondary: isRefund
            ? sarSecondary
              ? `Increases balance · ${sarSecondary}`
              : "Increases balance"
            : sarSecondary,
          align: "right",
          bold: true,
        },
      ],
    };
  });
  pushSectionIfRows(sections, {
    title: "PAYMENTS",
    columns: paymentColumns,
    rows: paymentRows,
    subtotal: {
      label: "PAYMENTS SUBTOTAL",
      pkr: data.paymentsDuringPeriod,
      paidPkr: paymentPaidPkr,
      refundPkr: paymentRefundPkr,
    },
  });

  return sections;
}

export function buildStatementReconciliationRows(data: StatementPdfData) {
  const sections = data.sections;
  return [
    ["Full Package Bookings / Adjustments", statementSectionPeriodTotal(sections.packageBookings)],
    ["Ticket Bookings / Adjustments", statementSectionPeriodTotal(sections.ticketBookings)],
    ["Hotel Bookings / Adjustments", statementSectionPeriodTotal(sections.hotelBookings)],
    ["Visa Bookings / Adjustments", statementSectionPeriodTotal(sections.visaBookings)],
    ["Transport Bookings / Adjustments", statementSectionPeriodTotal(sections.transportBookings)],
    ["Misc Bookings / Adjustments", statementSectionPeriodTotal(sections.miscBookings)],
  ] as const;
}
