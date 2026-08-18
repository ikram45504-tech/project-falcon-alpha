import { jsPDF } from "jspdf";
import type { Company, Party, PaymentEntry, VisaType } from "./db";
import type { StatementBookingSections } from "./StatementBookingData";

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
};

type Align = "left" | "center" | "right";
type Column = { width: number; header: string; align?: Align };
type Cell = { text: string; secondary?: string; align?: Align; bold?: boolean };
type Theme = { dark: string; header: string; alt: string; subtotal: string };
type SectionSubtotal = { label: string; pkr?: number; sar?: number; pendingSar?: number };

const PAGE_W = 210;
const PAGE_BOTTOM = 286;
const FOOTER_Y = 291;
const MARGIN = 5;
const CONTENT_W = 200;

const SECTION_TITLE_H = 5.4;
const COLUMN_HEADER_H = 5.8;
const SUBTOTAL_H = 5.2;
const BODY_FONT = 5.45;
const SECONDARY_FONT = 4.65;
const BODY_LINE_H = 2.25;
const SECONDARY_LINE_H = 1.95;

const COLORS = {
  navy: "#153F73", ink: "#25384D", muted: "#66788A", border: "#B9C6D3", white: "#FFFFFF",
  blueHeader: "#B8D1EA", blueAlt: "#F1F6FB", blueSubtotal: "#E6EEF7",
  purple: "#57258B", purpleHeader: "#DDC8EC", purpleAlt: "#F5EEF9", purpleSubtotal: "#EEE3F5",
  green: "#087B43", greenHeader: "#BFE2CE", greenAlt: "#F0F8F3", greenSubtotal: "#DDEFE5",
  red: "#B42939", redSoft: "#FCECEE", greyCard: "#EDF1F6", blueCard: "#EDF4FA", greenCard: "#EEF8F2", amberCard: "#FFF7E7",
};

const BOOKING_THEME: Theme = { dark: COLORS.navy, header: COLORS.blueHeader, alt: COLORS.blueAlt, subtotal: COLORS.blueSubtotal };
const PAYMENT_THEME: Theme = { dark: COLORS.purple, header: COLORS.purpleHeader, alt: COLORS.purpleAlt, subtotal: COLORS.purpleSubtotal };
const RECON_THEME: Theme = { dark: COLORS.green, header: COLORS.greenHeader, alt: COLORS.greenAlt, subtotal: COLORS.greenSubtotal };

function rgb(hex: string): [number, number, number] {
  const clean = hex.replace("#", "");
  return [parseInt(clean.slice(0, 2), 16), parseInt(clean.slice(2, 4), 16), parseInt(clean.slice(4, 6), 16)];
}
function fill(doc: jsPDF, hex: string) { doc.setFillColor(...rgb(hex)); }
function stroke(doc: jsPDF, hex: string) { doc.setDrawColor(...rgb(hex)); }
function textColor(doc: jsPDF, hex: string) { doc.setTextColor(...rgb(hex)); }
function money(value: number) {
  const n = Number(value || 0);
  const sign = n < 0 ? "-" : "";
  return `${sign}Rs ${Math.abs(n).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}
function sar(value: number) { return `SAR ${Number(value || 0).toLocaleString("en-US", { maximumFractionDigits: 2 })}`; }
function number(value: number) { return Number(value || 0).toLocaleString("en-US", { maximumFractionDigits: 2 }); }
function safeText(value: unknown) { const text = String(value ?? "").trim(); return text || "-"; }
function displayName(value: unknown) {
  const text = String(value ?? "").trim();
  if (!text) return "-";
  return text.toLowerCase().replace(/\b\w/g, (char) => char.toUpperCase());
}
function displayUb(value: unknown) {
  const text = String(value ?? "").trim().toUpperCase();
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
  return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short" }).format(new Date(y, m - 1, d)).replace(/ /g, "-");
}
function longDate(value: string) {
  if (!value) return "-";
  const [y, m, d] = value.split("-").map(Number);
  if (!y || !m || !d) return value;
  return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(y, m - 1, d)).replace(/ /g, "-");
}
function imageFormat(dataUrl: string) {
  const type = (/^data:image\/([^;]+);/i.exec(dataUrl)?.[1] || "png").toLowerCase();
  return type.includes("jpeg") || type.includes("jpg") ? "JPEG" : type.includes("webp") ? "WEBP" : "PNG";
}
function sum<T>(rows: T[], selector: (row: T) => number) { return rows.reduce((total, row) => total + Number(selector(row) || 0), 0); }
function titleCase(value: string) { return value.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (char) => char.toUpperCase()); }
function flightTypeLabel(value: string) { return value === "ONE_WAY" ? "One Way" : value === "MULTI_CITY" ? "Multi-City" : "Return"; }
function visaTypeLabel(value: VisaType) {
  if (value === "ONLY_UMRAH_VISA") return "Only Umrah Visa";
  if (value === "UMRAH_VISA_TRANSPORT") return "Umrah Visa + Transport";
  if (value === "UMRAH_VISA_ONE_WAY_TRANSPORT") return "Umrah Visa + One-Way Transport";
  return "Umrah Visa + Full Transport";
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

function drawHeader(doc: jsPDF, data: StatementPdfData) {
  let x = MARGIN;
  const top = 6;
  if (data.company.logo_data) {
    try {
      doc.addImage(data.company.logo_data, imageFormat(data.company.logo_data), x, top, 11, 11, undefined, "FAST");
      x += 13.3;
    } catch { /* text branding remains */ }
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

  const directionTitle = data.party.account_type === "VENDOR" ? "PURCHASE / PAYABLE STATEMENT" : "SALE / RECEIVABLE STATEMENT";
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
    { title: "OPENING BALANCE", value: money(data.openingBalance), foot: "Before selected period", bg: COLORS.greyCard, top: COLORS.navy },
    { title: isVendor ? "PURCHASE BOOKINGS" : "SALE BOOKINGS", value: money(data.bookingsDuringPeriod), foot: "PKR during period", bg: COLORS.blueCard, top: COLORS.navy },
    { title: "PAYMENTS", value: money(data.paymentsDuringPeriod), foot: "During selected period", bg: COLORS.greenCard, top: COLORS.green },
    { title: isVendor ? "PAYABLE BALANCE" : "RECEIVABLE BALANCE", value: money(data.closingBalance), foot: data.closingBalance < 0 ? "Advance / overpayment" : "Closing PKR position", bg: data.closingBalance > 0 ? COLORS.redSoft : COLORS.greenCard, top: data.closingBalance > 0 ? COLORS.red : COLORS.green },
    { title: "PENDING SAR", value: sar(data.pendingSarBalance), foot: "Awaiting ROE", bg: COLORS.amberCard, top: COLORS.navy },
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
    doc.setFontSize(4.35);
    textColor(doc, COLORS.muted);
    doc.text(card.title, x + 1.6, y + 4.0);
    doc.setFontSize(7.4);
    textColor(doc, card.top);
    doc.text(card.value, x + 1.6, y + 9.0);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(3.9);
    textColor(doc, COLORS.muted);
    doc.text(card.foot, x + 1.6, y + 12.6);
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
  doc.text(`${data.statementRef} | ${longDate(data.fromDate)} to ${longDate(data.toDate)}`, PAGE_W - MARGIN, 9.5, { align: "right" });
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
  return Math.max(5.6, ...cells.map((cell, i) => {
    const main = textLines(doc, cell.text, columns[i].width, BODY_FONT, !!cell.bold).length;
    const secondary = cell.secondary ? textLines(doc, cell.secondary, columns[i].width, SECONDARY_FONT).length : 0;
    return main * BODY_LINE_H + secondary * SECONDARY_LINE_H + 1.4;
  }));
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
    doc.setFontSize(5.2);
    textColor(doc, COLORS.ink);
    const lines = col.header.split("\n");
    const lineGap = 1.9;
    const startY = y + COLUMN_HEADER_H / 2 - ((lines.length - 1) * lineGap) / 2 + 0.7;
    lines.forEach((line, lineIndex) => doc.text(line, x + col.width / 2, startY + lineIndex * lineGap, { align: "center" }));
    x += col.width;
  });
  return y + COLUMN_HEADER_H;
}
function drawRow(doc: jsPDF, cells: Cell[], columns: Column[], y: number, h: number, alt?: string) {
  let x = MARGIN;
  if (alt) {
    fill(doc, alt);
    doc.rect(MARGIN, y, CONTENT_W, h, "F");
  }
  stroke(doc, COLORS.border);
  doc.rect(MARGIN, y, CONTENT_W, h);
  cells.forEach((cell, i) => {
    const w = columns[i].width;
    const align = cell.align || columns[i].align || "left";
    if (i) doc.line(x, y, x, y + h);
    const main = textLines(doc, cell.text, w, BODY_FONT, !!cell.bold);
    const secondary = cell.secondary ? textLines(doc, cell.secondary, w, SECONDARY_FONT) : [];
    const blockH = main.length * BODY_LINE_H + secondary.length * SECONDARY_LINE_H;
    let ty = y + Math.max(0.75, (h - blockH) / 2) + 1.9;
    doc.setFont("helvetica", cell.bold ? "bold" : "normal");
    doc.setFontSize(BODY_FONT);
    textColor(doc, COLORS.ink);
    main.forEach((line, lineIndex) => doc.text(line, align === "right" ? x + w - 0.8 : align === "center" ? x + w / 2 : x + 0.8, ty + lineIndex * BODY_LINE_H, { align }));
    ty += main.length * BODY_LINE_H;
    if (secondary.length) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(SECONDARY_FONT);
      textColor(doc, COLORS.muted);
      secondary.forEach((line, lineIndex) => doc.text(line, align === "right" ? x + w - 0.8 : align === "center" ? x + w / 2 : x + 0.8, ty + lineIndex * SECONDARY_LINE_H, { align }));
    }
    x += w;
  });
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
  doc.setFontSize(5.35);
  textColor(doc, theme.dark);
  doc.text(subtotal.label, PAGE_W - MARGIN - 77, y + 3.55, { align: "right" });
  textColor(doc, COLORS.navy);
  doc.text(subtotalText(subtotal), PAGE_W - MARGIN - 2, y + 3.55, { align: "right" });
  return y + SUBTOTAL_H + 1.7;
}
function renderSection(doc: jsPDF, data: StatementPdfData, title: string, columns: Column[], rows: Cell[][], subtotal: SectionSubtotal, theme: Theme, y: number) {
  if (!rows.length) return y;
  const min = SECTION_TITLE_H + COLUMN_HEADER_H + rowHeight(doc, rows[0], columns) + SUBTOTAL_H;
  if (y + min > PAGE_BOTTOM) y = continuation(doc, data);
  y = drawSectionTitle(doc, title, theme, y);
  y = drawColumns(doc, columns, theme, y);
  rows.forEach((row, index) => {
    const h = rowHeight(doc, row, columns);
    const reserve = index === rows.length - 1 ? SUBTOTAL_H : 0;
    if (y + h + reserve > PAGE_BOTTOM) {
      y = continuation(doc, data);
      y = drawSectionTitle(doc, title, theme, y, true);
      y = drawColumns(doc, columns, theme, y);
    }
    y = drawRow(doc, row, columns, y, h, index % 2 ? theme.alt : undefined);
  });
  return drawSubtotal(doc, subtotal, theme, y);
}

function drawReconciliation(doc: jsPDF, data: StatementPdfData, y: number) {
  const sections = data.sections;
  const serviceRows: Array<[string, number]> = [
    ["Package Bookings", sum(sections.packageBookings, (row) => row.total_pkr)],
    ["Ticket Bookings", sum(sections.ticketBookings, (row) => row.total_pkr)],
    ["Hotel Bookings", sum(sections.hotelBookings, (row) => row.total_pkr)],
    ["Visa Bookings", sum(sections.visaBookings, (row) => row.total_pkr)],
    ["Transport Bookings", sum(sections.transportBookings, (row) => row.total_pkr)],
    ["Misc Bookings", sum(sections.miscBookings, (row) => row.total_pkr)],
  ];
  const rowH = 4.7;
  const noteReserve = 7;
  const required = SECTION_TITLE_H + (serviceRows.length + 5) * rowH + noteReserve;
  if (y + required > PAGE_BOTTOM) y = continuation(doc, data);

  y = drawSectionTitle(doc, "FINAL RECONCILIATION", RECON_THEME, y);
  const rows: Array<[string, string, string?]> = [
    ...serviceRows.map(([label, value]) => [label, money(value)] as [string, string]),
    ["TOTAL BOOKING AMOUNT", money(data.bookingsDuringPeriod), "total"],
    ["LESS: PAYMENTS", money(data.paymentsDuringPeriod)],
    ["ADD: OPENING BALANCE", money(data.openingBalance)],
    [data.party.account_type === "VENDOR" ? "CLOSING PAYABLE" : "CLOSING RECEIVABLE", money(data.closingBalance), "closing"],
    ["PENDING SAR CONVERSION", sar(data.pendingSarBalance), "pending"],
  ];

  rows.forEach(([label, value, kind], index) => {
    const bg = kind === "total" ? COLORS.blueSubtotal : kind === "closing" ? COLORS.greenSubtotal : kind === "pending" ? COLORS.amberCard : index % 2 ? COLORS.greenAlt : COLORS.white;
    fill(doc, bg);
    stroke(doc, COLORS.border);
    doc.rect(MARGIN, y, CONTENT_W, rowH, "FD");
    doc.setFont("helvetica", kind ? "bold" : "normal");
    doc.setFontSize(5.35);
    textColor(doc, COLORS.ink);
    doc.text(label, MARGIN + 2, y + 3.2);
    doc.setFont("helvetica", "bold");
    textColor(doc, kind === "closing" ? COLORS.green : COLORS.navy);
    doc.text(value, PAGE_W - MARGIN - 2, y + 3.2, { align: "right" });
    y += rowH;
  });

  const note = "Operational/private details such as passport numbers, visa numbers, driver mobile numbers, vehicle plates and internal instructions are intentionally excluded from this financial statement.";
  if (y + noteReserve > PAGE_BOTTOM) y = continuation(doc, data);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(4.6);
  textColor(doc, COLORS.muted);
  const lines = doc.splitTextToSize(note, CONTENT_W - 4) as string[];
  lines.forEach((line, index) => doc.text(line, MARGIN + 2, y + 3 + index * 1.95));
  return y + 4 + lines.length * 1.95;
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
  doc.setProperties({ title: `${data.company.name} - Statement - ${data.party.name}`, subject: `Statement of Account - ${data.party.name}`, author: data.company.name, creator: "Travel Accounting" });
  let y = drawHeader(doc, data);
  y = drawSummary(doc, data, y);

  const packageColumns: Column[] = [
    { width: 7, header: "SR", align: "center" }, { width: 23, header: "DATE / UB", align: "center" },
    { width: 36, header: "PASSENGER / FAMILY" }, { width: 42, header: "PAX TYPE / PACKAGE" },
    { width: 26, header: "RATE / PAX", align: "right" }, { width: 12, header: "QTY", align: "center" },
    { width: 54, header: "TOTAL PKR", align: "right" },
  ];
  const packageRows: Cell[][] = [];
  data.sections.packageBookings.forEach((booking) => booking.lines.forEach((line) => packageRows.push([
    { text: String(packageRows.length + 1), align: "center" },
    { text: shortDate(booking.transaction_date), secondary: displayUb(booking.ub_number), align: "center", bold: true },
    { text: displayName(line.passenger_name), bold: true },
    { text: line.passenger_type, secondary: safeText(line.package_type) },
    { text: money(line.rate_per_person), align: "right" },
    { text: String(Number(line.person_count || 1)), align: "center" },
    { text: money(line.line_total_pkr), align: "right", bold: true },
  ])));
  y = renderSection(doc, data, "PACKAGE BOOKINGS", packageColumns, packageRows, { label: "PACKAGE SUBTOTAL", pkr: sum(data.sections.packageBookings, (row) => row.total_pkr) }, BOOKING_THEME, y);

  const ticketColumns: Column[] = [
    { width: 7, header: "SR", align: "center" }, { width: 22, header: "DATE / UB", align: "center" },
    { width: 31, header: "PASSENGER" }, { width: 34, header: "AIRLINE / PNR" },
    { width: 40, header: "ROUTE / TYPE" }, { width: 22, header: "RATE", align: "right" },
    { width: 10, header: "QTY", align: "center" }, { width: 34, header: "TOTAL PKR", align: "right" },
  ];
  const ticketRows: Cell[][] = [];
  data.sections.ticketBookings.forEach((booking) => booking.lines.forEach((line) => ticketRows.push([
    { text: String(ticketRows.length + 1), align: "center" },
    { text: shortDate(booking.transaction_date), secondary: displayUb(booking.ub_number), align: "center", bold: true },
    { text: displayName(line.passenger_name), secondary: line.passenger_type, bold: true },
    { text: safeText(line.airline_name), secondary: line.pnr ? `PNR: ${line.pnr}` : "PNR: -" },
    { text: safeText(line.ticket_route), secondary: flightTypeLabel(line.flight_type) },
    { text: money(line.rate_per_ticket), align: "right" },
    { text: String(Number(line.ticket_count || 1)), align: "center" },
    { text: money(line.line_total_pkr), align: "right", bold: true },
  ])));
  y = renderSection(doc, data, "TICKET BOOKINGS", ticketColumns, ticketRows, { label: "TICKET SUBTOTAL", pkr: sum(data.sections.ticketBookings, (row) => row.total_pkr) }, BOOKING_THEME, y);

  const hotelColumns: Column[] = [
    { width: 7, header: "SR", align: "center" }, { width: 22, header: "DATE / UB", align: "center" },
    { width: 40, header: "GUEST / HOTEL" }, { width: 28, header: "STAY" }, { width: 24, header: "ROOM" },
    { width: 32, header: "RATE / ROE" }, { width: 22, header: "TOTAL SAR", align: "right" },
    { width: 25, header: "TOTAL PKR", align: "right" },
  ];
  const hotelRows: Cell[][] = [];
  data.sections.hotelBookings.forEach((booking) => booking.lines.forEach((line, index) => {
    const guestName = booking.guestRefs[index] || booking.guest_family_name || booking.counterparty_name;
    hotelRows.push([
      { text: String(hotelRows.length + 1), align: "center" },
      { text: shortDate(booking.transaction_date), secondary: displayUb(booking.ub_number), align: "center", bold: true },
      { text: displayName(guestName), secondary: `${safeText(line.hotel_name)} - ${safeText(line.city)}`, bold: true },
      { text: `${shortDate(line.check_in)} to ${shortDate(line.check_out)}`, secondary: countLabel(line.nights, "Night") },
      { text: titleCase(line.room_type), secondary: line.room_type === "SHARING" ? countLabel(line.quantity, "Bed") : countLabel(line.quantity, "Room") },
      { text: `${sar(line.rate_per_night_sar)} / Night`, secondary: Number(line.roe || 0) > 0 ? `ROE ${number(line.roe)}` : "ROE Pending" },
      { text: sar(line.line_total_sar), align: "right" },
      { text: Number(line.roe || 0) > 0 ? money(line.line_total_pkr) : "Pending", align: "right", bold: true },
    ]);
  }));
  y = renderSection(doc, data, "HOTEL BOOKINGS", hotelColumns, hotelRows, { label: "HOTEL SUBTOTAL", sar: sum(data.sections.hotelBookings, (row) => row.total_sar), pkr: sum(data.sections.hotelBookings, (row) => row.total_pkr), pendingSar: sum(data.sections.hotelBookings, (row) => row.unconverted_sar) }, BOOKING_THEME, y);

  const visaColumns: Column[] = [
    { width: 7, header: "SR", align: "center" }, { width: 22, header: "DATE / UB", align: "center" },
    { width: 32, header: "PASSENGER / FAMILY" }, { width: 38, header: "VISA SERVICE" },
    { width: 10, header: "PAX", align: "center" }, { width: 37, header: "VISA / TRANSPORT" },
    { width: 12, header: "ROE", align: "right" }, { width: 20, header: "TOTAL SAR", align: "right" },
    { width: 22, header: "TOTAL PKR", align: "right" },
  ];
  const visaRows: Cell[][] = [];
  data.sections.visaBookings.forEach((booking) => booking.lines.forEach((line) => {
    const transportSar = Number(line.private_transport_allocated_sar || 0) + Number(line.intercity_bus_total_sar || 0);
    visaRows.push([
      { text: String(visaRows.length + 1), align: "center" },
      { text: shortDate(booking.transaction_date), secondary: displayUb(booking.ub_number), align: "center", bold: true },
      { text: displayName(line.passenger_name), secondary: line.passenger_type, bold: true },
      { text: visaTypeLabel(line.visa_type) },
      { text: String(Number(line.pax_count || 0)), align: "center" },
      { text: `Visa ${sar(line.visa_rate_sar)} / Pax`, secondary: transportSar > 0 ? `Transport ${sar(transportSar)}` : "Transport -" },
      { text: Number(line.roe || 0) > 0 ? number(line.roe) : "Pending", align: "right" },
      { text: sar(line.line_total_sar), align: "right" },
      { text: Number(line.roe || 0) > 0 ? money(line.line_total_pkr) : "Pending", align: "right", bold: true },
    ]);
  }));
  y = renderSection(doc, data, "VISA BOOKINGS", visaColumns, visaRows, { label: "VISA SUBTOTAL", sar: sum(data.sections.visaBookings, (row) => row.total_sar), pkr: sum(data.sections.visaBookings, (row) => row.total_pkr), pendingSar: sum(data.sections.visaBookings, (row) => row.unconverted_sar) }, BOOKING_THEME, y);

  const transportColumns: Column[] = [
    { width: 7, header: "SR", align: "center" }, { width: 22, header: "DATE / UB", align: "center" },
    { width: 40, header: "SECTOR" }, { width: 32, header: "TRANSPORT / VEHICLE" }, { width: 24, header: "QTY / PAX" },
    { width: 32, header: "RATE / ROE" }, { width: 20, header: "TOTAL SAR", align: "right" },
    { width: 23, header: "TOTAL PKR", align: "right" },
  ];
  const transportRows: Cell[][] = [];
  data.sections.transportBookings.forEach((booking) => booking.lines.forEach((line) => {
    const sharing = line.transport_type === "SHARING_BUS";
    const vehicle = sharing ? "Sharing Bus" : safeText(line.custom_vehicle_name || titleCase(line.vehicle_type));
    transportRows.push([
      { text: String(transportRows.length + 1), align: "center" },
      { text: shortDate(booking.transaction_date), secondary: displayUb(booking.ub_number), align: "center", bold: true },
      { text: `${safeText(line.from_location)} -> ${safeText(line.to_location)}`, secondary: longDate(line.transport_date), bold: true },
      { text: sharing ? "Sharing Bus" : "Private Vehicle", secondary: vehicle },
      { text: sharing ? countLabel(line.pax_count, "Pax", "Pax") : countLabel(line.vehicle_count, "Vehicle"), secondary: sharing ? undefined : countLabel(line.pax_count, "Pax", "Pax") },
      { text: `${sar(line.rate_sar)} / ${sharing ? "Pax" : "Vehicle"}`, secondary: Number(line.roe || 0) > 0 ? `ROE ${number(line.roe)}` : "ROE Pending" },
      { text: sar(line.line_total_sar), align: "right" },
      { text: Number(line.roe || 0) > 0 ? money(line.line_total_pkr) : "Pending", align: "right", bold: true },
    ]);
  }));
  y = renderSection(doc, data, "TRANSPORT BOOKINGS", transportColumns, transportRows, { label: "TRANSPORT SUBTOTAL", sar: sum(data.sections.transportBookings, (row) => row.total_sar), pkr: sum(data.sections.transportBookings, (row) => row.total_pkr), pendingSar: sum(data.sections.transportBookings, (row) => row.unconverted_sar) }, BOOKING_THEME, y);

  const miscColumns: Column[] = [
    { width: 7, header: "SR", align: "center" }, { width: 22, header: "DATE / UB", align: "center" },
    { width: 34, header: "SERVICE" }, { width: 36, header: "FAMILY HEAD" }, { width: 10, header: "PAX", align: "center" },
    { width: 39, header: "RATE / ROE" }, { width: 22, header: "TOTAL SAR", align: "right" },
    { width: 30, header: "TOTAL PKR", align: "right" },
  ];
  const miscRows: Cell[][] = [];
  data.sections.miscBookings.forEach((booking) => booking.lines.forEach((line, index) => {
    const familyHead = booking.familyHeads[index] || booking.counterparty_name;
    miscRows.push([
      { text: String(miscRows.length + 1), align: "center" },
      { text: shortDate(booking.transaction_date), secondary: displayUb(booking.ub_number), align: "center", bold: true },
      { text: safeText(line.service_name), bold: true },
      { text: displayName(familyHead) },
      { text: String(Number(line.pax_count || 0)), align: "center" },
      { text: `${line.currency_mode} ${number(line.rate_per_person)} / Person`, secondary: line.currency_mode === "SAR" ? `ROE ${number(line.roe)}` : "PKR direct" },
      { text: line.currency_mode === "SAR" ? sar(line.line_total_sar) : "-", align: "right" },
      { text: money(line.line_total_pkr), align: "right", bold: true },
    ]);
  }));
  y = renderSection(doc, data, "MISC BOOKINGS", miscColumns, miscRows, { label: "MISC SUBTOTAL", sar: sum(data.sections.miscBookings, (row) => row.total_sar), pkr: sum(data.sections.miscBookings, (row) => row.total_pkr), pendingSar: sum(data.sections.miscBookings, (row) => row.unconverted_sar) }, BOOKING_THEME, y);

  const paymentColumns: Column[] = [
    { width: 7, header: "SR", align: "center" }, { width: 22, header: "DATE", align: "center" },
    { width: 24, header: "RECEIPT #" }, { width: 30, header: "FROM" }, { width: 32, header: "TO" },
    { width: 43, header: "DESCRIPTION" }, { width: 14, header: "TYPE", align: "center" },
    { width: 28, header: "PAID PKR", align: "right" },
  ];
  const paymentRows: Cell[][] = data.payments.map((entry, index) => [
    { text: String(index + 1), align: "center" },
    { text: longDate(entry.transaction_date), align: "center" },
    { text: safeText(entry.receipt_no), bold: true },
    { text: safeText(entry.from_account) },
    { text: safeText(entry.to_account) },
    { text: safeText(entry.description) },
    { text: safeText(entry.payment_type), align: "center" },
    { text: money(entry.paid_amount), secondary: entry.currency === "SAR" ? `${sar(entry.sar)} @ ${number(entry.roe)}` : undefined, align: "right", bold: true },
  ]);
  y = renderSection(doc, data, "PAYMENTS", paymentColumns, paymentRows, { label: "PAYMENTS SUBTOTAL", pkr: data.paymentsDuringPeriod }, PAYMENT_THEME, y);

  drawReconciliation(doc, data, y);
  drawFooters(doc, data);
  return doc;
}
