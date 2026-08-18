import { jsPDF } from "jspdf";
import type { Company, Party, PaymentEntry } from "./db";
import type { BookingAccountingEntry } from "./BookingAccounting";

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
  bookings: BookingAccountingEntry[];
  payments: PaymentEntry[];
};

type Align = "left" | "center" | "right";
type Column = { width: number; header: string; align?: Align };
type Cell = { text: string; secondary?: string; align?: Align; bold?: boolean };
type Theme = { dark: string; header: string; alt: string; subtotal: string };

const PAGE_W = 210;
const PAGE_BOTTOM = 286;
const FOOTER_Y = 291;
const MARGIN = 5;
const CONTENT_W = 200;

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
  red: "#B42939",
  redSoft: "#FCECEE",
  greyCard: "#EDF1F6",
  blueCard: "#EDF4FA",
  greenCard: "#EEF8F2",
};

const BOOKING_THEME: Theme = { dark: COLORS.navy, header: COLORS.blueHeader, alt: COLORS.blueAlt, subtotal: COLORS.blueSubtotal };
const PAYMENT_THEME: Theme = { dark: COLORS.purple, header: COLORS.purpleHeader, alt: COLORS.purpleAlt, subtotal: COLORS.purpleSubtotal };

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
function number(value: number) { return Number(value || 0).toLocaleString("en-US", { maximumFractionDigits: 2 }); }
function safeText(value: unknown) { const text = String(value ?? "").trim(); return text || "—"; }
function shortDate(value: string) {
  if (!value) return "—";
  const [y, m, d] = value.split("-").map(Number);
  if (!y || !m || !d) return value;
  return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short" }).format(new Date(y, m - 1, d)).replace(/ /g, "-");
}
function longDate(value: string) {
  if (!value) return "—";
  const [y, m, d] = value.split("-").map(Number);
  if (!y || !m || !d) return value;
  return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(y, m - 1, d)).replace(/ /g, "-");
}
function imageFormat(dataUrl: string) {
  const type = (/^data:image\/([^;]+);/i.exec(dataUrl)?.[1] || "png").toLowerCase();
  return type.includes("jpeg") || type.includes("jpg") ? "JPEG" : type.includes("webp") ? "WEBP" : "PNG";
}

function drawHeader(doc: jsPDF, data: StatementPdfData) {
  let x = MARGIN;
  const top = 6;
  if (data.company.logo_data) {
    try {
      doc.addImage(data.company.logo_data, imageFormat(data.company.logo_data), x, top, 11, 11, undefined, "FAST");
      x += 13.3;
    } catch { /* keep text branding if logo format cannot render */ }
  }
  doc.setFont("helvetica", "bold"); doc.setFontSize(13.4); textColor(doc, COLORS.navy); doc.text(data.company.name, x, top + 4.5);
  doc.setFont("helvetica", "normal"); doc.setFontSize(5.1); textColor(doc, COLORS.ink); doc.text(safeText(data.company.address), x, top + 9);
  const contacts = [data.company.phone, data.company.whatsapp, data.company.email].filter(Boolean).join("  •  ");
  if (contacts) { doc.setFontSize(4.2); textColor(doc, COLORS.muted); doc.text(contacts, x, top + 12); }

  doc.setFont("helvetica", "bold"); doc.setFontSize(11.5); textColor(doc, COLORS.navy); doc.text("STATEMENT OF ACCOUNT", PAGE_W - MARGIN, top + 4, { align: "right" });
  doc.setFont("helvetica", "normal"); doc.setFontSize(5.1); textColor(doc, COLORS.ink);
  doc.text(`Ledger: ${data.party.name}`, PAGE_W - MARGIN, top + 8, { align: "right" });
  doc.text(`${data.party.account_type} · ${data.accountDirection}`, PAGE_W - MARGIN, top + 11.3, { align: "right" });
  doc.text(`Statement Period: ${longDate(data.fromDate)} to ${longDate(data.toDate)}`, MARGIN, top + 17);
  fill(doc, "#E8EDF3"); doc.roundedRect(MARGIN, top + 18.3, 55, 5.1, 1, 1, "F");
  doc.setFont("helvetica", "bold"); doc.setFontSize(4.7); textColor(doc, COLORS.navy); doc.text(`Statement Ref: ${data.statementRef}`, MARGIN + 2, top + 21.5);
  doc.setFont("helvetica", "normal"); doc.text(`Generated: ${data.generatedOn}`, PAGE_W - MARGIN, top + 21.5, { align: "right" });
  fill(doc, COLORS.navy); doc.rect(MARGIN, top + 25, CONTENT_W, 0.9, "F");
  return top + 28;
}

function drawSummary(doc: jsPDF, data: StatementPdfData, y: number) {
  const isVendor = data.party.account_type === "VENDOR";
  const cards = [
    { title: "OPENING BALANCE", value: money(data.openingBalance), foot: "Before selected period", bg: COLORS.greyCard, top: COLORS.navy },
    { title: isVendor ? "PURCHASE BOOKINGS" : "SALE BOOKINGS", value: money(data.bookingsDuringPeriod), foot: "During selected period", bg: COLORS.blueCard, top: COLORS.navy },
    { title: "PAYMENTS", value: money(data.paymentsDuringPeriod), foot: "During selected period", bg: COLORS.greenCard, top: COLORS.green },
    { title: isVendor ? "PAYABLE BALANCE" : "RECEIVABLE BALANCE", value: money(Math.abs(data.closingBalance)), foot: data.closingBalance < 0 ? "Advance / overpayment" : "Closing position", bg: data.closingBalance > 0 ? COLORS.redSoft : COLORS.greenCard, top: data.closingBalance > 0 ? COLORS.red : COLORS.green },
  ];
  const gap = 1.5, w = (CONTENT_W - gap * 3) / 4, h = 15.3;
  cards.forEach((card, index) => {
    const x = MARGIN + index * (w + gap);
    fill(doc, card.bg); stroke(doc, COLORS.border); doc.roundedRect(x, y, w, h, 1, 1, "FD");
    fill(doc, card.top); doc.rect(x, y, w, 0.9, "F");
    doc.setFont("helvetica", "bold"); doc.setFontSize(4.7); textColor(doc, COLORS.muted); doc.text(card.title, x + 2, y + 4.1);
    doc.setFontSize(8.6); textColor(doc, card.top); doc.text(card.value, x + 2, y + 9.2);
    doc.setFont("helvetica", "normal"); doc.setFontSize(4.0); textColor(doc, COLORS.muted); doc.text(card.foot, x + 2, y + 12.7);
  });
  return y + h + 2.2;
}

function continuation(doc: jsPDF, data: StatementPdfData) {
  doc.addPage("a4", "portrait");
  doc.setFont("helvetica", "bold"); doc.setFontSize(7); textColor(doc, COLORS.navy); doc.text(data.company.name, MARGIN, 8);
  doc.setFont("helvetica", "normal"); doc.setFontSize(4.7); textColor(doc, COLORS.muted); doc.text(`Statement — ${data.party.name}`, MARGIN, 11.2);
  doc.text(`${data.statementRef} · ${longDate(data.fromDate)} to ${longDate(data.toDate)}`, PAGE_W - MARGIN, 9.5, { align: "right" });
  fill(doc, COLORS.navy); doc.rect(MARGIN, 13.2, CONTENT_W, 0.7, "F");
  return 16;
}

function textLines(doc: jsPDF, text: string, width: number, size = 5.1, bold = false) {
  doc.setFont("helvetica", bold ? "bold" : "normal"); doc.setFontSize(size);
  return doc.splitTextToSize(text || "—", Math.max(2, width - 1.4)) as string[];
}
function rowHeight(doc: jsPDF, cells: Cell[], columns: Column[]) {
  return Math.max(5, ...cells.map((cell, i) => {
    const main = textLines(doc, cell.text, columns[i].width, 5.05, !!cell.bold).length;
    const secondary = cell.secondary ? textLines(doc, cell.secondary, columns[i].width, 4.2).length : 0;
    return main * 2.05 + secondary * 1.75 + 1.1;
  }));
}
function drawSectionTitle(doc: jsPDF, title: string, theme: Theme, y: number, continued = false) {
  fill(doc, theme.dark); doc.rect(MARGIN, y, CONTENT_W, 6.2, "F");
  doc.setFont("helvetica", "bold"); doc.setFontSize(7.1); textColor(doc, COLORS.white); doc.text(continued ? `${title} — CONTINUED` : title, MARGIN + 2, y + 4.2);
  return y + 6.2;
}
function drawColumns(doc: jsPDF, columns: Column[], theme: Theme, y: number) {
  const h = 6.7; let x = MARGIN;
  fill(doc, theme.header); stroke(doc, COLORS.border); doc.rect(MARGIN, y, CONTENT_W, h, "FD");
  columns.forEach((col, i) => {
    if (i) doc.line(x, y, x, y + h);
    doc.setFont("helvetica", "bold"); doc.setFontSize(4.4); textColor(doc, COLORS.ink);
    const lines = col.header.split("\n");
    lines.forEach((line, li) => doc.text(line, x + col.width / 2, y + 2.7 + li * 1.7, { align: "center" }));
    x += col.width;
  });
  return y + h;
}
function drawRow(doc: jsPDF, cells: Cell[], columns: Column[], y: number, h: number, alt?: string) {
  let x = MARGIN;
  if (alt) { fill(doc, alt); doc.rect(MARGIN, y, CONTENT_W, h, "F"); }
  stroke(doc, COLORS.border); doc.rect(MARGIN, y, CONTENT_W, h);
  cells.forEach((cell, i) => {
    const w = columns[i].width; const align = cell.align || columns[i].align || "left";
    if (i) doc.line(x, y, x, y + h);
    const main = textLines(doc, cell.text, w, 5.05, !!cell.bold);
    const secondary = cell.secondary ? textLines(doc, cell.secondary, w, 4.2) : [];
    const blockH = main.length * 2.05 + secondary.length * 1.75;
    let ty = y + Math.max(0.7, (h - blockH) / 2) + 1.8;
    doc.setFont("helvetica", cell.bold ? "bold" : "normal"); doc.setFontSize(5.05); textColor(doc, COLORS.ink);
    main.forEach((line, li) => doc.text(line, align === "right" ? x + w - 0.7 : align === "center" ? x + w / 2 : x + 0.7, ty + li * 2.05, { align }));
    ty += main.length * 2.05;
    if (secondary.length) { doc.setFont("helvetica", "normal"); doc.setFontSize(4.2); textColor(doc, COLORS.muted); secondary.forEach((line, li) => doc.text(line, align === "right" ? x + w - 0.7 : align === "center" ? x + w / 2 : x + 0.7, ty + li * 1.75, { align })); }
    x += w;
  });
  return y + h;
}
function drawSubtotal(doc: jsPDF, label: string, value: number, theme: Theme, y: number) {
  const h = 5.5; fill(doc, theme.subtotal); stroke(doc, COLORS.border); doc.rect(MARGIN, y, CONTENT_W, h, "FD"); fill(doc, theme.dark); doc.rect(MARGIN, y, CONTENT_W, 0.65, "F");
  doc.setFont("helvetica", "bold"); doc.setFontSize(5.1); textColor(doc, theme.dark); doc.text(label, PAGE_W - MARGIN - 35, y + 3.7, { align: "right" }); textColor(doc, COLORS.navy); doc.text(money(value), PAGE_W - MARGIN - 2, y + 3.7, { align: "right" });
  return y + h + 2.2;
}
function renderSection(doc: jsPDF, data: StatementPdfData, title: string, columns: Column[], rows: Cell[][], subtotal: number, theme: Theme, y: number) {
  const min = 6.2 + 6.7 + (rows[0] ? rowHeight(doc, rows[0], columns) : 6.5) + 5.5;
  if (y + min > PAGE_BOTTOM) y = continuation(doc, data);
  y = drawSectionTitle(doc, title, theme, y); y = drawColumns(doc, columns, theme, y);
  if (!rows.length) {
    stroke(doc, COLORS.border); doc.rect(MARGIN, y, CONTENT_W, 6.5); doc.setFont("helvetica", "normal"); doc.setFontSize(4.8); textColor(doc, COLORS.muted); doc.text(`No ${title.toLowerCase()} in selected period.`, PAGE_W / 2, y + 4.1, { align: "center" }); y += 6.5;
  } else {
    rows.forEach((row, index) => {
      const h = rowHeight(doc, row, columns); const reserve = index === rows.length - 1 ? 5.5 : 0;
      if (y + h + reserve > PAGE_BOTTOM) { y = continuation(doc, data); y = drawSectionTitle(doc, title, theme, y, true); y = drawColumns(doc, columns, theme, y); }
      y = drawRow(doc, row, columns, y, h, index % 2 ? theme.alt : undefined);
    });
  }
  if (y + 5.5 > PAGE_BOTTOM) { y = continuation(doc, data); y = drawSectionTitle(doc, title, theme, y, true); }
  return drawSubtotal(doc, `${title} SUBTOTAL`, subtotal, theme, y);
}

function drawFooters(doc: jsPDF, data: StatementPdfData) {
  const pages = doc.getNumberOfPages();
  for (let page = 1; page <= pages; page += 1) {
    doc.setPage(page); stroke(doc, COLORS.border); doc.line(MARGIN, FOOTER_Y - 3.4, PAGE_W - MARGIN, FOOTER_Y - 3.4);
    doc.setFont("helvetica", "normal"); doc.setFontSize(4); textColor(doc, COLORS.muted);
    doc.text(`Base Currency: ${data.company.base_currency}  |  Foreign Currency: ${data.company.foreign_currency}`, MARGIN, FOOTER_Y);
    doc.text("Booking totals come from the active booking engine. Payments are shown separately.", PAGE_W / 2, FOOTER_Y, { align: "center" });
    doc.text(`${data.statementRef}  •  Page ${page} of ${pages}`, PAGE_W - MARGIN, FOOTER_Y, { align: "right" });
  }
}

export function buildStatementPdf(data: StatementPdfData) {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4", compress: true, putOnlyUsedFonts: true });
  doc.setProperties({ title: `${data.company.name} - Statement - ${data.party.name}`, subject: `Statement of Account - ${data.party.name}`, author: data.company.name, creator: "Travel Accounting" });
  let y = drawHeader(doc, data);
  y = drawSummary(doc, data, y);

  const bookingColumns: Column[] = [
    { width: 7, header: "SR", align: "center" },
    { width: 17, header: "DATE", align: "center" },
    { width: 30, header: "UB #" },
    { width: 34, header: "BOOKING SERVICE" },
    { width: 22, header: "TYPE", align: "center" },
    { width: 28, header: "TOTAL SAR", align: "right" },
    { width: 28, header: "PENDING SAR", align: "right" },
    { width: 34, header: "TOTAL PKR", align: "right" },
  ];
  const paymentColumns: Column[] = [
    { width: 7, header: "SR", align: "center" },
    { width: 17, header: "DATE", align: "center" },
    { width: 22, header: "RECEIPT #", align: "center" },
    { width: 31, header: "FROM ACCOUNT" },
    { width: 31, header: "TO ACCOUNT" },
    { width: 49, header: "DESCRIPTION" },
    { width: 16, header: "TYPE", align: "center" },
    { width: 27, header: "PAID AMOUNT", align: "right" },
  ];

  const bookingRows: Cell[][] = data.bookings.map((entry, index) => [
    { text: String(index + 1), align: "center" },
    { text: shortDate(entry.transaction_date), align: "center" },
    { text: safeText(entry.ub_number), bold: true },
    { text: safeText(entry.service_type) },
    { text: safeText(entry.transaction_type), align: "center" },
    { text: entry.total_sar ? `SAR ${number(entry.total_sar)}` : "—", align: "right" },
    { text: entry.unconverted_sar ? `SAR ${number(entry.unconverted_sar)}` : "—", align: "right" },
    { text: money(entry.total_pkr), align: "right", bold: true },
  ]);
  const paymentRows: Cell[][] = data.payments.map((entry, index) => [
    { text: String(index + 1), align: "center" },
    { text: shortDate(entry.transaction_date), align: "center" },
    { text: safeText(entry.receipt_no), align: "center" },
    { text: safeText(entry.from_account) },
    { text: safeText(entry.to_account) },
    { text: safeText(entry.description) },
    { text: safeText(entry.payment_type), align: "center" },
    { text: money(entry.paid_amount), align: "right", bold: true },
  ]);

  const bookingTitle = data.party.account_type === "VENDOR" ? "PURCHASE BOOKINGS" : "SALE BOOKINGS";
  y = renderSection(doc, data, bookingTitle, bookingColumns, bookingRows, data.bookingsDuringPeriod, BOOKING_THEME, y);
  renderSection(doc, data, "PAYMENTS", paymentColumns, paymentRows, data.paymentsDuringPeriod, PAYMENT_THEME, y);
  drawFooters(doc, data);
  return doc;
}
