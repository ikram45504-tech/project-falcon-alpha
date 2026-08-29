import { jsPDF } from "jspdf";
import type { Company, Party, PaymentEntry, VisaType } from "./db";
import {
  statementSectionPeriodTotal,
  type StatementAdjustmentRecord,
  type StatementBookingMeta,
  type StatementBookingSections,
} from "./StatementBookingData";
import type { BookingServiceName } from "./BookingLifecycle";
import type { LedgerRow } from "./LedgerEngine";

export type StatementPdfData = {
  company: Company;
  party: Party;
  accountDirection: string;
  fromDate: string;
  toDate: string;
  generatedOn: string;
  statementRef: string;
  openingBalance: number;
  bookingsDuringPeriod: number;
  paymentsDuringPeriod: number;
  closingBalance: number;
  pendingSarBalance: number;
  sections: StatementBookingSections;
  payments: PaymentEntry[];
  ledgerRows?: LedgerRow[];
};

type Align = "left" | "center" | "right";
type Column = { width: number; header: string; align?: Align };
type Cell = { text: string; secondary?: string; align?: Align; bold?: boolean };
type Theme = { dark: string; header: string; alt: string; subtotal: string };
type SectionSubtotal = { label: string; pkr?: number; sar?: number; pendingSar?: number };
type TableRowKind = "normal" | "reference" | "adjustment";
type TableRow = { cells: Cell[]; kind?: TableRowKind; strike?: boolean };
type Obj = Record<string, unknown>;

const PAGE_W = 210;
const PAGE_BOTTOM = 286;
const FOOTER_Y = 291;
const MARGIN = 5;
const CONTENT_W = 200;
const SECTION_TITLE_H = 5.4;
const COLUMN_HEADER_H = 5.8;
const SUBTOTAL_H = 5.2;
const BODY_FONT = 5.35;
const SECONDARY_FONT = 4.55;
const BODY_LINE_H = 2.22;
const SECONDARY_LINE_H = 1.92;

const COLORS = {
  navy: "#153F73",
  ink: "#25384D",
  muted: "#66788A",
  border: "#B9C6D3",
  white: "#FFFFFF",
  blueHeader: "#B8D1EA",
  blueAlt: "#F1F6FB",
  blueSubtotal: "#E6EEF7",
  purple: "#57258B",
  purpleHeader: "#DDC8EC",
  purpleAlt: "#F5EEF9",
  purpleSubtotal: "#EEE3F5",
  green: "#087B43",
  greenHeader: "#BFE2CE",
  greenAlt: "#F0F8F3",
  greenSubtotal: "#DDEFE5",
  red: "#B42939",
  redSoft: "#FCECEE",
  greyCard: "#EDF1F6",
  blueCard: "#EDF4FA",
  greenCard: "#EEF8F2",
  amberCard: "#FFF7E7",
  adjustment: "#FFF4DE",
  adjustmentEdge: "#D97706",
};

const BOOKING_THEME: Theme = {
  dark: COLORS.navy,
  header: COLORS.blueHeader,
  alt: COLORS.blueAlt,
  subtotal: COLORS.blueSubtotal,
};
const PAYMENT_THEME: Theme = {
  dark: COLORS.purple,
  header: COLORS.purpleHeader,
  alt: COLORS.purpleAlt,
  subtotal: COLORS.purpleSubtotal,
};
const RECON_THEME: Theme = {
  dark: COLORS.green,
  header: COLORS.greenHeader,
  alt: COLORS.greenAlt,
  subtotal: COLORS.greenSubtotal,
};

function rgb(hex: string): [number, number, number] {
  const clean = hex.replace("#", "");
  return [parseInt(clean.slice(0, 2), 16), parseInt(clean.slice(2, 4), 16), parseInt(clean.slice(4, 6), 16)];
}
function fill(doc: jsPDF, hex: string) {
  doc.setFillColor(...rgb(hex));
}
function stroke(doc: jsPDF, hex: string) {
  doc.setDrawColor(...rgb(hex));
}
function textColor(doc: jsPDF, hex: string) {
  doc.setTextColor(...rgb(hex));
}
function money(value: number) {
  const n = Number(value || 0);
  const sign = n < 0 ? "-" : "";
  return `${sign}Rs ${Math.abs(n).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}
function signedMoney(value: number) {
  const n = Number(value || 0);
  if (Math.abs(n) < 0.005) return money(0);
  return `${n > 0 ? "+" : "-"}Rs ${Math.abs(n).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
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
function imageFormat(dataUrl: string) {
  const type = (/^data:image\/([^;]+);/i.exec(dataUrl)?.[1] || "png").toLowerCase();
  return type.includes("jpeg") || type.includes("jpg") ? "JPEG" : type.includes("webp") ? "WEBP" : "PNG";
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
function uniqueContacts(values: Array<string | null | undefined>) {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const value of values) {
    const clean = String(value || "").trim();
    if (!clean) continue;
    const key = clean.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(clean);
  }
  return unique;
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

function drawHeader(doc: jsPDF, data: StatementPdfData) {
  let x = MARGIN;
  const top = 6;
  if (data.company.logo_data) {
    try {
      doc.addImage(data.company.logo_data, imageFormat(data.company.logo_data), x, top, 11, 11, undefined, "FAST");
      x += 13.3;
    } catch {
      /* text branding remains */
    }
  }
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13.4);
  textColor(doc, COLORS.navy);
  doc.text(data.company.name, x, top + 4.5);
  let companyDetailY = top + 9;
  const companyAddress = String(data.company.address || "").trim();
  if (companyAddress) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(5.4);
    textColor(doc, COLORS.ink);
    doc.text(companyAddress, x, companyDetailY);
    companyDetailY += 3.2;
  }
  const contacts = uniqueContacts([data.company.phone, data.company.whatsapp, data.company.email]);
  if (contacts.length) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(4.8);
    textColor(doc, COLORS.muted);
    doc.text(contacts.join("  |  "), x, companyDetailY);
  }
  const directionTitle =
    data.party.account_type === "VENDOR" ? "PURCHASE / PAYABLE STATEMENT" : "SALE / RECEIVABLE STATEMENT";
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11.5);
  textColor(doc, COLORS.navy);
  doc.text("STATEMENT OF ACCOUNT", PAGE_W - MARGIN, top + 4, { align: "right" });
  doc.setFontSize(6.3);
  doc.text(directionTitle, PAGE_W - MARGIN, top + 7.8, { align: "right" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(5.4);
  textColor(doc, COLORS.ink);
  doc.text(`Account: ${displayName(data.party.name)}`, PAGE_W - MARGIN, top + 11.2, { align: "right" });
  doc.text(`Account Type: ${data.party.account_type}`, PAGE_W - MARGIN, top + 14.2, { align: "right" });
  doc.text(`Statement Period: ${longDate(data.fromDate)} to ${longDate(data.toDate)}`, MARGIN, top + 18.1);
  fill(doc, "#E8EDF3");
  doc.roundedRect(MARGIN, top + 19.3, 61, 5.1, 1, 1, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(5.0);
  textColor(doc, COLORS.navy);
  doc.text(`Statement Ref: ${data.statementRef}`, MARGIN + 2, top + 22.5);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(5.0);
  doc.text(`Generated: ${data.generatedOn}`, PAGE_W - MARGIN, top + 22.5, { align: "right" });
  fill(doc, COLORS.navy);
  doc.rect(MARGIN, top + 26, CONTENT_W, 0.9, "F");
  return top + 29;
}

function drawSummary(doc: jsPDF, data: StatementPdfData, y: number) {
  const isVendor = data.party.account_type === "VENDOR";
  const cards = [
    {
      title: "OPENING BALANCE",
      value: money(data.openingBalance),
      foot: "Before selected period",
      bg: COLORS.greyCard,
      top: COLORS.navy,
    },
    {
      title: isVendor ? "PURCHASE ACTIVITY" : "SALE ACTIVITY",
      value: money(data.bookingsDuringPeriod),
      foot: "Bookings + adjustments in period",
      bg: COLORS.blueCard,
      top: COLORS.navy,
    },
    {
      title: "PAYMENTS",
      value: money(data.paymentsDuringPeriod),
      foot: "During selected period",
      bg: COLORS.greenCard,
      top: COLORS.green,
    },
    {
      title: isVendor ? "PAYABLE BALANCE" : "RECEIVABLE BALANCE",
      value: money(data.closingBalance),
      foot: data.closingBalance < 0 ? "Advance / overpayment" : "Closing PKR position",
      bg: data.closingBalance > 0 ? COLORS.redSoft : COLORS.greenCard,
      top: data.closingBalance > 0 ? COLORS.red : COLORS.green,
    },
    {
      title: "PENDING SAR",
      value: sar(data.pendingSarBalance),
      foot: "Awaiting ROE",
      bg: COLORS.amberCard,
      top: COLORS.navy,
    },
  ];
  const gap = 1.25;
  const w = (CONTENT_W - gap * 4) / 5;
  const h = 15.2;
  cards.forEach((card, index) => {
    const x = MARGIN + index * (w + gap);
    fill(doc, card.bg);
    stroke(doc, COLORS.border);
    doc.roundedRect(x, y, w, h, 1, 1, "FD");
    fill(doc, card.top);
    doc.rect(x, y, w, 0.9, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(4.15);
    textColor(doc, COLORS.muted);
    doc.text(card.title, x + 1.6, y + 4.0);
    doc.setFontSize(7.4);
    textColor(doc, card.top);
    doc.text(card.value, x + 1.6, y + 9.0);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(3.75);
    textColor(doc, COLORS.muted);
    const foot = doc.splitTextToSize(card.foot, w - 3) as string[];
    foot.slice(0, 2).forEach((line, lineIndex) => doc.text(line, x + 1.6, y + 12.25 + lineIndex * 1.5));
  });
  return y + h + 1.9;
}

function continuation(doc: jsPDF, data: StatementPdfData) {
  doc.addPage("a4", "portrait");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.4);
  textColor(doc, COLORS.navy);
  doc.text(data.company.name, MARGIN, 8);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(5.0);
  textColor(doc, COLORS.muted);
  doc.text(`Statement - ${displayName(data.party.name)}`, MARGIN, 11.2);
  doc.text(`${data.statementRef} | ${longDate(data.fromDate)} to ${longDate(data.toDate)}`, PAGE_W - MARGIN, 9.5, {
    align: "right",
  });
  fill(doc, COLORS.navy);
  doc.rect(MARGIN, 13.2, CONTENT_W, 0.7, "F");
  return 16;
}

function textLines(doc: jsPDF, text: string, width: number, size = BODY_FONT, bold = false) {
  doc.setFont("helvetica", bold ? "bold" : "normal");
  doc.setFontSize(size);
  return doc.splitTextToSize(text || "-", Math.max(2, width - 1.6)) as string[];
}
function rowHeight(doc: jsPDF, cells: Cell[], columns: Column[]) {
  return Math.max(
    5.8,
    ...cells.map((cell, i) => {
      const main = textLines(doc, cell.text, columns[i].width, BODY_FONT, !!cell.bold).length;
      const secondary = cell.secondary ? textLines(doc, cell.secondary, columns[i].width, SECONDARY_FONT).length : 0;
      return main * BODY_LINE_H + secondary * SECONDARY_LINE_H + 1.5;
    }),
  );
}
function drawSectionTitle(doc: jsPDF, title: string, theme: Theme, y: number, continued = false) {
  fill(doc, theme.dark);
  doc.rect(MARGIN, y, CONTENT_W, SECTION_TITLE_H, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.3);
  textColor(doc, COLORS.white);
  doc.text(continued ? `${title} - CONTINUED` : title, MARGIN + 2, y + 3.75);
  return y + SECTION_TITLE_H;
}
function drawColumns(doc: jsPDF, columns: Column[], theme: Theme, y: number) {
  let x = MARGIN;
  fill(doc, theme.header);
  stroke(doc, COLORS.border);
  doc.rect(MARGIN, y, CONTENT_W, COLUMN_HEADER_H, "FD");
  columns.forEach((col, i) => {
    if (i) doc.line(x, y, x, y + COLUMN_HEADER_H);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(5.05);
    textColor(doc, COLORS.ink);
    const lines = col.header.split("\n");
    const gap = 1.85;
    const startY = y + COLUMN_HEADER_H / 2 - ((lines.length - 1) * gap) / 2 + 0.7;
    lines.forEach((line, lineIndex) =>
      doc.text(line, x + col.width / 2, startY + lineIndex * gap, { align: "center" }),
    );
    x += col.width;
  });
  return y + COLUMN_HEADER_H;
}
function drawRow(doc: jsPDF, row: TableRow, columns: Column[], y: number, h: number, alt?: string) {
  const kind = row.kind || "normal";
  const bg = kind === "reference" ? COLORS.redSoft : kind === "adjustment" ? COLORS.adjustment : alt;
  if (bg) {
    fill(doc, bg);
    doc.rect(MARGIN, y, CONTENT_W, h, "F");
  }
  if (kind === "adjustment") {
    fill(doc, COLORS.adjustmentEdge);
    doc.rect(MARGIN, y, 0.8, h, "F");
  }
  let x = MARGIN;
  stroke(doc, COLORS.border);
  doc.rect(MARGIN, y, CONTENT_W, h);
  row.cells.forEach((cell, i) => {
    const w = columns[i].width;
    const align = cell.align || columns[i].align || "left";
    if (i) doc.line(x, y, x, y + h);
    const main = textLines(doc, cell.text, w, BODY_FONT, !!cell.bold);
    const secondary = cell.secondary ? textLines(doc, cell.secondary, w, SECONDARY_FONT) : [];
    const blockH = main.length * BODY_LINE_H + secondary.length * SECONDARY_LINE_H;
    let ty = y + Math.max(0.75, (h - blockH) / 2) + 1.9;
    doc.setFont("helvetica", cell.bold ? "bold" : "normal");
    doc.setFontSize(BODY_FONT);
    textColor(doc, kind === "reference" ? COLORS.muted : COLORS.ink);
    main.forEach((line, lineIndex) =>
      doc.text(
        line,
        align === "right" ? x + w - 0.8 : align === "center" ? x + w / 2 : x + 0.8,
        ty + lineIndex * BODY_LINE_H,
        { align },
      ),
    );
    ty += main.length * BODY_LINE_H;
    if (secondary.length) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(SECONDARY_FONT);
      textColor(doc, kind === "adjustment" ? COLORS.adjustmentEdge : COLORS.muted);
      secondary.forEach((line, lineIndex) =>
        doc.text(
          line,
          align === "right" ? x + w - 0.8 : align === "center" ? x + w / 2 : x + 0.8,
          ty + lineIndex * SECONDARY_LINE_H,
          { align },
        ),
      );
    }
    x += w;
  });
  if (row.strike) {
    stroke(doc, COLORS.red);
    doc.setLineWidth(0.28);
    doc.line(MARGIN + 1, y + h * 0.42, MARGIN + CONTENT_W - 1, y + h * 0.42);
    doc.setLineWidth(0.2);
  }
  return y + h;
}
function subtotalText(subtotal: SectionSubtotal) {
  const parts: string[] = [];
  if (subtotal.sar != null && subtotal.sar !== 0) parts.push(sar(subtotal.sar));
  if (subtotal.pkr != null) parts.push(money(subtotal.pkr));
  if (subtotal.pendingSar) parts.push(`Pending ${sar(subtotal.pendingSar)}`);
  return parts.join(" | ");
}
function drawSubtotal(doc: jsPDF, subtotal: SectionSubtotal, theme: Theme, y: number) {
  fill(doc, theme.subtotal);
  stroke(doc, COLORS.border);
  doc.rect(MARGIN, y, CONTENT_W, SUBTOTAL_H, "FD");
  fill(doc, theme.dark);
  doc.rect(MARGIN, y, CONTENT_W, 0.6, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(5.25);
  textColor(doc, theme.dark);
  doc.text(subtotal.label, PAGE_W - MARGIN - 77, y + 3.55, { align: "right" });
  textColor(doc, COLORS.navy);
  doc.text(subtotalText(subtotal), PAGE_W - MARGIN - 2, y + 3.55, { align: "right" });
  return y + SUBTOTAL_H + 1.7;
}
function renderSection(
  doc: jsPDF,
  data: StatementPdfData,
  title: string,
  columns: Column[],
  rows: TableRow[],
  subtotal: SectionSubtotal,
  theme: Theme,
  y: number,
) {
  if (!rows.length) return y;
  const min = SECTION_TITLE_H + COLUMN_HEADER_H + rowHeight(doc, rows[0].cells, columns) + SUBTOTAL_H;
  if (y + min > PAGE_BOTTOM) y = continuation(doc, data);
  y = drawSectionTitle(doc, title, theme, y);
  y = drawColumns(doc, columns, theme, y);
  rows.forEach((row, index) => {
    const h = rowHeight(doc, row.cells, columns);
    const reserve = index === rows.length - 1 ? SUBTOTAL_H : 0;
    if (y + h + reserve > PAGE_BOTTOM) {
      y = continuation(doc, data);
      y = drawSectionTitle(doc, title, theme, y, true);
      y = drawColumns(doc, columns, theme, y);
    }
    y = drawRow(doc, row, columns, y, h, row.kind ? undefined : index % 2 ? theme.alt : undefined);
  });
  return drawSubtotal(doc, subtotal, theme, y);
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
  return `${latest ? "Current chargeable after change" : `REV ${adjustment.revision_no} effective`} | Period impact ${signedMoney(adjustment.account_delta_pkr)}`;
}

function packageAdjustmentRow(
  booking: StatementBookingMeta & { ub_number: string },
  adjustment: StatementAdjustmentRecord,
  data: StatementPdfData,
  latest: boolean,
): TableRow {
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
): TableRow {
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
      { text: `Revised booking`, secondary: `Base ${money(adjustment.revised_base_pkr)}` },
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
): TableRow {
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
): TableRow {
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
): TableRow {
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
): TableRow {
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

function insertAdjustmentsAfterFirst(
  originalRows: TableRow[],
  adjustments: StatementAdjustmentRecord[],
  makeAdjustment: (adjustment: StatementAdjustmentRecord, latest: boolean) => TableRow,
) {
  if (!originalRows.length || !adjustments.length) return originalRows;
  const latestId = adjustments[adjustments.length - 1]?.id;
  return [
    originalRows[0],
    ...adjustments.map((adjustment) => makeAdjustment(adjustment, adjustment.id === latestId)),
    ...originalRows.slice(1),
  ];
}

function effectiveSarTotal<T extends StatementBookingMeta & { total_sar?: number }>(rows: T[]) {
  return rows.reduce((total, row) => {
    const latest = row.statementDisplayAdjustments[row.statementDisplayAdjustments.length - 1];
    if (latest?.lifecycle_status === "CANCELLED") return total;
    return total + Number(row.total_sar || 0);
  }, 0);
}
function effectivePendingSar<T extends StatementBookingMeta & { unconverted_sar?: number }>(rows: T[]) {
  return rows.reduce((total, row) => {
    const latest = row.statementDisplayAdjustments[row.statementDisplayAdjustments.length - 1];
    if (latest?.lifecycle_status === "CANCELLED") return total;
    return total + Number(row.unconverted_sar || 0);
  }, 0);
}

function drawReconciliation(doc: jsPDF, data: StatementPdfData, y: number) {
  const sections = data.sections;
  const serviceRows: Array<[string, number]> = [
    ["Package Bookings / Adjustments", statementSectionPeriodTotal(sections.packageBookings)],
    ["Ticket Bookings / Adjustments", statementSectionPeriodTotal(sections.ticketBookings)],
    ["Hotel Bookings / Adjustments", statementSectionPeriodTotal(sections.hotelBookings)],
    ["Visa Bookings / Adjustments", statementSectionPeriodTotal(sections.visaBookings)],
    ["Transport Bookings / Adjustments", statementSectionPeriodTotal(sections.transportBookings)],
    ["Misc Bookings / Adjustments", statementSectionPeriodTotal(sections.miscBookings)],
  ];
  const rowH = 4.7;
  const noteReserve = 11;
  const required = SECTION_TITLE_H + (serviceRows.length + 5) * rowH + noteReserve;
  if (y + required > PAGE_BOTTOM) y = continuation(doc, data);
  y = drawSectionTitle(doc, "FINAL RECONCILIATION", RECON_THEME, y);
  const rows: Array<[string, string, string?]> = [
    ...serviceRows.map(([label, value]) => [label, money(value)] as [string, string]),
    ["TOTAL COMMERCIAL ACTIVITY", money(data.bookingsDuringPeriod), "total"],
    ["LESS: PAYMENTS", money(data.paymentsDuringPeriod)],
    ["ADD: OPENING BALANCE", money(data.openingBalance)],
    [
      data.party.account_type === "VENDOR" ? "CLOSING PAYABLE" : "CLOSING RECEIVABLE",
      money(data.closingBalance),
      "closing",
    ],
    ["PENDING SAR CONVERSION", sar(data.pendingSarBalance), "pending"],
  ];
  rows.forEach(([label, value, kind], index) => {
    const bg =
      kind === "total"
        ? COLORS.blueSubtotal
        : kind === "closing"
          ? COLORS.greenSubtotal
          : kind === "pending"
            ? COLORS.amberCard
            : index % 2
              ? COLORS.greenAlt
              : COLORS.white;
    fill(doc, bg);
    stroke(doc, COLORS.border);
    doc.rect(MARGIN, y, CONTENT_W, rowH, "FD");
    doc.setFont("helvetica", kind ? "bold" : "normal");
    doc.setFontSize(5.25);
    textColor(doc, COLORS.ink);
    doc.text(label, MARGIN + 2, y + 3.2);
    doc.setFont("helvetica", "bold");
    textColor(doc, kind === "closing" ? COLORS.green : COLORS.navy);
    doc.text(value, PAGE_W - MARGIN - 2, y + 3.2, { align: "right" });
    y += rowH;
  });
  const note =
    "Crossed booking rows are superseded reference only and are not charged again. Each booking change stays directly under its genuine UB in one adjustment row showing the actual adjustment date, revised/effective chargeable amount and period account impact. Operational/private details remain excluded.";
  if (y + noteReserve > PAGE_BOTTOM) y = continuation(doc, data);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(4.45);
  textColor(doc, COLORS.muted);
  const lines = doc.splitTextToSize(note, CONTENT_W - 4) as string[];
  lines.forEach((line, index) => doc.text(line, MARGIN + 2, y + 3 + index * 1.9));
  return y + 4 + lines.length * 1.9;
}

function drawFooters(doc: jsPDF, data: StatementPdfData) {
  const pages = doc.getNumberOfPages();
  for (let page = 1; page <= pages; page += 1) {
    doc.setPage(page);
    fill(doc, COLORS.navy);
    doc.rect(MARGIN, FOOTER_Y - 3.3, CONTENT_W, 0.55, "F");
    doc.setFont("helvetica", "normal");
    doc.setFontSize(4.5);
    textColor(doc, COLORS.muted);
    doc.text(`${displayName(data.party.name)} | ${data.statementRef}`, MARGIN, FOOTER_Y);
    doc.text(`Page ${page} of ${pages}`, PAGE_W - MARGIN, FOOTER_Y, { align: "right" });
  }
}

export function buildStatementPdf(data: StatementPdfData) {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4", compress: true, putOnlyUsedFonts: true });
  doc.setProperties({
    title: `${data.company.name} - Statement - ${data.party.name}`,
    subject: `Statement of Account - ${data.party.name}`,
    author: data.company.name,
    creator: "Travel Hisab by SMC Softwares",
  });
  let y = drawHeader(doc, data);
  y = drawSummary(doc, data, y);

  const packageColumns: Column[] = [
    { width: 7, header: "SR", align: "center" },
    { width: 23, header: "DATE / UB", align: "center" },
    { width: 36, header: "PASSENGER / FAMILY" },
    { width: 42, header: "PAX TYPE / PACKAGE" },
    { width: 26, header: "RATE / PAX", align: "right" },
    { width: 12, header: "QTY", align: "center" },
    { width: 54, header: "TOTAL PKR", align: "right" },
  ];
  const packageRows: TableRow[] = [];
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
        strike: superseded,
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
          {
            text: money(total),
            secondary: superseded ? "SUPERSEDED | REFERENCE ONLY" : undefined,
            align: "right",
            bold: true,
          },
        ],
      } as TableRow;
    });
    packageRows.push(
      ...insertAdjustmentsAfterFirst(rows, booking.statementDisplayAdjustments, (adjustment, latest) =>
        packageAdjustmentRow(booking, adjustment, data, latest),
      ),
    );
  });
  y = renderSection(
    doc,
    data,
    "PACKAGE BOOKINGS",
    packageColumns,
    packageRows,
    { label: "PACKAGE STATEMENT SUBTOTAL", pkr: statementSectionPeriodTotal(data.sections.packageBookings) },
    BOOKING_THEME,
    y,
  );

  const ticketColumns: Column[] = [
    { width: 7, header: "SR", align: "center" },
    { width: 22, header: "DATE / UB", align: "center" },
    { width: 31, header: "PASSENGER" },
    { width: 34, header: "AIRLINE / PNR" },
    { width: 40, header: "ROUTE / TYPE" },
    { width: 22, header: "RATE", align: "right" },
    { width: 10, header: "QTY", align: "center" },
    { width: 34, header: "TOTAL PKR", align: "right" },
  ];
  const ticketRows: TableRow[] = [];
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
        strike: superseded,
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
          {
            text: money(rate * qty),
            secondary: superseded ? "SUPERSEDED | REFERENCE ONLY" : undefined,
            align: "right",
            bold: true,
          },
        ],
      } as TableRow;
    });
    ticketRows.push(
      ...insertAdjustmentsAfterFirst(rows, booking.statementDisplayAdjustments, (adjustment, latest) =>
        ticketAdjustmentRow(booking, adjustment, data, latest),
      ),
    );
  });
  y = renderSection(
    doc,
    data,
    "TICKET BOOKINGS",
    ticketColumns,
    ticketRows,
    { label: "TICKET STATEMENT SUBTOTAL", pkr: statementSectionPeriodTotal(data.sections.ticketBookings) },
    BOOKING_THEME,
    y,
  );

  const hotelColumns: Column[] = [
    { width: 7, header: "SR", align: "center" },
    { width: 22, header: "DATE / UB", align: "center" },
    { width: 40, header: "GUEST / HOTEL" },
    { width: 28, header: "STAY" },
    { width: 24, header: "ROOM" },
    { width: 32, header: "RATE / ROE" },
    { width: 22, header: "TOTAL SAR", align: "right" },
    { width: 25, header: "TOTAL PKR", align: "right" },
  ];
  const hotelRows: TableRow[] = [];
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
        strike: superseded,
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
          { text: sar(totalSar), align: "right" },
          {
            text: roe > 0 ? money(totalSar * roe) : "Pending",
            secondary: superseded ? "SUPERSEDED | REFERENCE ONLY" : undefined,
            align: "right",
            bold: true,
          },
        ],
      } as TableRow;
    });
    hotelRows.push(
      ...insertAdjustmentsAfterFirst(rows, booking.statementDisplayAdjustments, (adjustment, latest) =>
        hotelAdjustmentRow(booking, adjustment, data, latest),
      ),
    );
  });
  y = renderSection(
    doc,
    data,
    "HOTEL BOOKINGS",
    hotelColumns,
    hotelRows,
    {
      label: "HOTEL STATEMENT SUBTOTAL",
      sar: effectiveSarTotal(data.sections.hotelBookings),
      pkr: statementSectionPeriodTotal(data.sections.hotelBookings),
      pendingSar: effectivePendingSar(data.sections.hotelBookings),
    },
    BOOKING_THEME,
    y,
  );

  const visaColumns: Column[] = [
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
  const visaRows: TableRow[] = [];
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
        strike: superseded,
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
          { text: sar(totalSar), align: "right" },
          {
            text: totalPkr > 0 ? money(totalPkr) : "Pending",
            secondary: superseded ? "SUPERSEDED | REFERENCE ONLY" : undefined,
            align: "right",
            bold: true,
          },
        ],
      } as TableRow;
    });
    visaRows.push(
      ...insertAdjustmentsAfterFirst(rows, booking.statementDisplayAdjustments, (adjustment, latest) =>
        visaAdjustmentRow(booking, adjustment, data, latest),
      ),
    );
  });
  y = renderSection(
    doc,
    data,
    "VISA BOOKINGS",
    visaColumns,
    visaRows,
    {
      label: "VISA STATEMENT SUBTOTAL",
      sar: effectiveSarTotal(data.sections.visaBookings),
      pkr: statementSectionPeriodTotal(data.sections.visaBookings),
      pendingSar: effectivePendingSar(data.sections.visaBookings),
    },
    BOOKING_THEME,
    y,
  );

  const transportColumns: Column[] = [
    { width: 7, header: "SR", align: "center" },
    { width: 22, header: "DATE / UB", align: "center" },
    { width: 40, header: "SECTOR" },
    { width: 32, header: "TRANSPORT / VEHICLE" },
    { width: 24, header: "QTY / PAX" },
    { width: 32, header: "RATE / ROE" },
    { width: 20, header: "TOTAL SAR", align: "right" },
    { width: 23, header: "TOTAL PKR", align: "right" },
  ];
  const transportRows: TableRow[] = [];
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
        strike: superseded,
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
          { text: sar(totalSar), align: "right" },
          {
            text: roe > 0 ? money(totalSar * roe) : "Pending",
            secondary: superseded ? "SUPERSEDED | REFERENCE ONLY" : undefined,
            align: "right",
            bold: true,
          },
        ],
      } as TableRow;
    });
    transportRows.push(
      ...insertAdjustmentsAfterFirst(rows, booking.statementDisplayAdjustments, (adjustment, latest) =>
        transportAdjustmentRow(booking, adjustment, data, latest),
      ),
    );
  });
  y = renderSection(
    doc,
    data,
    "TRANSPORT BOOKINGS",
    transportColumns,
    transportRows,
    {
      label: "TRANSPORT STATEMENT SUBTOTAL",
      sar: effectiveSarTotal(data.sections.transportBookings),
      pkr: statementSectionPeriodTotal(data.sections.transportBookings),
      pendingSar: effectivePendingSar(data.sections.transportBookings),
    },
    BOOKING_THEME,
    y,
  );

  const miscColumns: Column[] = [
    { width: 7, header: "SR", align: "center" },
    { width: 22, header: "DATE / UB", align: "center" },
    { width: 34, header: "SERVICE" },
    { width: 36, header: "FAMILY HEAD" },
    { width: 10, header: "PAX", align: "center" },
    { width: 39, header: "RATE / ROE" },
    { width: 22, header: "ACCOUNT IMPACT", align: "right" },
    { width: 30, header: "TOTAL PKR", align: "right" },
  ];
  const miscRows: TableRow[] = [];
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
        strike: superseded,
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
          {
            text: money(total),
            secondary: superseded ? "SUPERSEDED | REFERENCE ONLY" : undefined,
            align: "right",
            bold: true,
          },
        ],
      } as TableRow;
    });
    miscRows.push(
      ...insertAdjustmentsAfterFirst(rows, booking.statementDisplayAdjustments, (adjustment, latest) =>
        miscAdjustmentRow(booking, adjustment, data, latest),
      ),
    );
  });
  y = renderSection(
    doc,
    data,
    "MISC BOOKINGS",
    miscColumns,
    miscRows,
    {
      label: "MISC STATEMENT SUBTOTAL",
      sar: effectiveSarTotal(data.sections.miscBookings),
      pkr: statementSectionPeriodTotal(data.sections.miscBookings),
      pendingSar: effectivePendingSar(data.sections.miscBookings),
    },
    BOOKING_THEME,
    y,
  );

  const paymentColumns: Column[] = [
    { width: 7, header: "SR", align: "center" },
    { width: 22, header: "DATE", align: "center" },
    { width: 24, header: "RECEIPT #" },
    { width: 30, header: "FROM" },
    { width: 32, header: "TO" },
    { width: 43, header: "DESCRIPTION" },
    { width: 14, header: "TYPE", align: "center" },
    { width: 28, header: "PAID PKR", align: "right" },
  ];
  const paymentRows: TableRow[] = data.payments.map((entry, index) => ({
    cells: [
      { text: String(index + 1), align: "center" },
      { text: longDate(entry.transaction_date), align: "center" },
      { text: safeText(entry.receipt_no), bold: true },
      { text: safeText(entry.from_account) },
      { text: safeText(entry.to_account) },
      { text: safeText(entry.description) },
      { text: safeText(entry.payment_type), align: "center" },
      {
        text: money(entry.paid_amount),
        secondary: entry.currency === "SAR" ? `${sar(entry.sar)} @ ${number(entry.roe)}` : undefined,
        align: "right",
        bold: true,
      },
    ],
  }));
  y = renderSection(
    doc,
    data,
    "PAYMENTS",
    paymentColumns,
    paymentRows,
    { label: "PAYMENTS SUBTOTAL", pkr: data.paymentsDuringPeriod },
    PAYMENT_THEME,
    y,
  );

  drawReconciliation(doc, data, y);

  // Append Chronological Ledger Summary Page
  if (data.ledgerRows && data.ledgerRows.length > 0) {
    doc.addPage();
    y = drawHeader(doc, data);

    y = drawSectionTitle(
      doc,
      "FINANCIAL LEDGER SUMMARY",
      { dark: COLORS.navy, header: COLORS.blueHeader, alt: COLORS.blueAlt, subtotal: COLORS.blueSubtotal },
      y,
    );

    const ledgerCols: Column[] = [
      { width: 25, header: "DATE", align: "center" },
      { width: 35, header: "REF NO." },
      { width: 45, header: "DESCRIPTION" },
      { width: 25, header: "DEBIT", align: "right" },
      { width: 25, header: "CREDIT", align: "right" },
      { width: 35, header: "BALANCE", align: "right" },
    ];

    y = drawColumns(
      doc,
      ledgerCols,
      { dark: COLORS.navy, header: COLORS.blueHeader, alt: COLORS.blueAlt, subtotal: COLORS.blueSubtotal },
      y,
    );

    data.ledgerRows.forEach((row, idx) => {
      if (y > PAGE_BOTTOM - 15) {
        doc.addPage();
        y = drawHeader(doc, data);
        y = drawSectionTitle(
          doc,
          "FINANCIAL LEDGER SUMMARY (CONT.)",
          { dark: COLORS.navy, header: COLORS.blueHeader, alt: COLORS.blueAlt, subtotal: COLORS.blueSubtotal },
          y,
        );
        y = drawColumns(
          doc,
          ledgerCols,
          { dark: COLORS.navy, header: COLORS.blueHeader, alt: COLORS.blueAlt, subtotal: COLORS.blueSubtotal },
          y,
        );
      }

      const lCells: Cell[] = [
        { text: shortDate(row.transaction_date), align: "center" },
        { text: safeText(row.ref_no) },
        { text: safeText(row.description) },
        { text: money(row.debit), align: "right" },
        { text: money(row.credit), align: "right" },
        { text: money(row.running_balance), align: "right", bold: true },
      ];

      y = drawRow(
        doc,
        { cells: lCells },
        ledgerCols,
        y,
        rowHeight(doc, lCells, ledgerCols),
        idx % 2 === 1 ? COLORS.blueAlt : undefined,
      );
    });
  }

  drawFooters(doc, data);
  return doc;
}
