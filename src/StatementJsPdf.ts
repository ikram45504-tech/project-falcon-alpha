import { jsPDF } from "jspdf";
import type { Company, Party, PaymentEntry } from "./db";
import type { StatementBookingSections } from "./StatementBookingData";
import type { LedgerRow } from "./LedgerEngine";
import type { PaymentV2Meta } from "./PaymentV2Db";
import { buildStatementReconciliationRows, buildStatementViewSections } from "./StatementViewSections";
import {
  hasSarFigure,
  statementActivityLabel,
  statementClosingBalanceDisplayPkr,
  statementClosingBalanceLabel,
} from "./StatementSummary";

export type StatementPdfData = {
  company: Company;
  party: Party;
  accountDirection: string;
  fromDate: string;
  toDate: string;
  generatedOn: string;
  statementRef: string;
  openingBalance: number;
  openingSar: number;
  bookingsDuringPeriod: number;
  bookingsDuringPeriodSar: number;
  paymentsDuringPeriod: number;
  paymentsDuringPeriodSar: number;
  closingBalance: number;
  /** Pending / unconverted SAR as of statement end date (shown on balance box when non-zero). */
  pendingSarBalance: number;
  sections: StatementBookingSections;
  payments: PaymentEntry[];
  paymentMeta?: Map<string, PaymentV2Meta>;
  ledgerRows?: LedgerRow[];
  includeLedger?: boolean;
  includeReconciliation?: boolean;
  previewMode?: "pdf" | "print";
};

type Align = "left" | "center" | "right";
type Column = { width: number; header: string; align?: Align };
type Cell = { text: string; secondary?: string; align?: Align; bold?: boolean };
type Theme = { dark: string; header: string; alt: string; subtotal: string };
type SectionSubtotal = { label: string; pkr?: number; sar?: number; pendingSar?: number };
type TableRowKind = "normal" | "reference" | "adjustment";
type TableRow = { cells: Cell[]; kind?: TableRowKind; strike?: boolean };

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
const PAYMENT_THEME: Theme = BOOKING_THEME;
const RECON_THEME: Theme = BOOKING_THEME;

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
function sar(value: number) {
  return `SAR ${Number(value || 0).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
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
  const balanceTitle = statementClosingBalanceLabel(data.party.account_type, data.closingBalance);
  const balancePkr = statementClosingBalanceDisplayPkr(data.closingBalance);
  const balanceFoot =
    Math.abs(data.closingBalance) < 0.005
      ? "Nothing due"
      : data.closingBalance < 0
        ? isVendor
          ? "Prepaid / overpaid supplier"
          : "Customer credit / advance"
        : isVendor
          ? "Closing payable position"
          : "Closing receivable position";

  const cards = [
    {
      title: "OPENING BALANCE",
      value: money(data.openingBalance),
      secondary: hasSarFigure(data.openingSar) ? sar(data.openingSar) : "",
      foot: "Before selected period",
      bg: COLORS.greyCard,
      top: COLORS.navy,
    },
    {
      title: statementActivityLabel(data.party.account_type),
      value: money(data.bookingsDuringPeriod),
      secondary: hasSarFigure(data.bookingsDuringPeriodSar) ? sar(data.bookingsDuringPeriodSar) : "",
      foot: "Bookings + adjustments in period",
      bg: COLORS.blueCard,
      top: COLORS.navy,
    },
    {
      title: "PAID AMOUNT",
      value: money(data.paymentsDuringPeriod),
      secondary: hasSarFigure(data.paymentsDuringPeriodSar) ? sar(data.paymentsDuringPeriodSar) : "",
      foot: "Payments in period (refunds signed)",
      bg: COLORS.greyCard,
      top: COLORS.navy,
    },
    {
      title: balanceTitle,
      value: money(balancePkr),
      secondary: hasSarFigure(data.pendingSarBalance) ? sar(data.pendingSarBalance) : "",
      foot: balanceFoot,
      bg: COLORS.blueCard,
      top: COLORS.navy,
    },
  ];
  const gap = 1.5;
  const w = (CONTENT_W - gap * 3) / 4;
  const h = 17.2;
  cards.forEach((card, index) => {
    const x = MARGIN + index * (w + gap);
    fill(doc, card.bg);
    stroke(doc, COLORS.border);
    doc.roundedRect(x, y, w, h, 1, 1, "FD");
    fill(doc, card.top);
    doc.rect(x, y, w, 0.9, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(4.0);
    textColor(doc, COLORS.muted);
    doc.text(card.title, x + 1.6, y + 3.8);
    doc.setFontSize(7.2);
    textColor(doc, card.top);
    doc.text(card.value, x + 1.6, y + 8.4);
    if (card.secondary) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(4.4);
      textColor(doc, COLORS.muted);
      doc.text(card.secondary, x + 1.6, y + 11.2);
    }
    doc.setFont("helvetica", "normal");
    doc.setFontSize(3.6);
    textColor(doc, COLORS.muted);
    const footY = card.secondary ? 13.6 : 12.0;
    const foot = doc.splitTextToSize(card.foot, w - 3) as string[];
    foot.slice(0, 2).forEach((line, lineIndex) => doc.text(line, x + 1.6, y + footY + lineIndex * 1.45));
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
  const bg = kind === "reference" ? COLORS.greyCard : kind === "adjustment" ? COLORS.adjustment : alt;
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

function drawReconciliation(doc: jsPDF, data: StatementPdfData, y: number) {
  const serviceRows = buildStatementReconciliationRows(data);
  const rowH = 4.7;
  const noteReserve = 11;
  const required = SECTION_TITLE_H + (serviceRows.length + 4) * rowH + noteReserve;
  if (y + required > PAGE_BOTTOM) y = continuation(doc, data);
  y = drawSectionTitle(doc, "FINAL RECONCILIATION", RECON_THEME, y);
  const rows: Array<[string, string, string?]> = [
    ...serviceRows.map(([label, value]) => [label, money(value)] as [string, string]),
    ["TOTAL COMMERCIAL ACTIVITY", money(data.bookingsDuringPeriod), "total"],
    ["LESS: PAID AMOUNT", money(data.paymentsDuringPeriod)],
    ["ADD: OPENING BALANCE", money(data.openingBalance)],
    [
      statementClosingBalanceLabel(data.party.account_type, data.closingBalance),
      money(statementClosingBalanceDisplayPkr(data.closingBalance)),
      "closing",
    ],
  ];
  rows.forEach(([label, value, kind], index) => {
    const bg =
      kind === "total"
        ? COLORS.blueSubtotal
        : kind === "closing"
          ? COLORS.greenSubtotal
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
    "Original booking lines shown after an amendment are reference only — amounts are not counted again. The adjustment row under each UB shows the booking total and period account impact.";
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

  for (const section of buildStatementViewSections(data)) {
    y = renderSection(
      doc,
      data,
      section.title,
      section.columns,
      section.rows,
      section.subtotal,
      section.title === "PAYMENTS" ? PAYMENT_THEME : BOOKING_THEME,
      y,
    );
  }

  if (data.includeReconciliation) {
    drawReconciliation(doc, data, y);
  }

  // Optional ledger summary (staff / audit — off by default for client SOA)
  if (data.includeLedger && data.ledgerRows && data.ledgerRows.length > 0) {
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
