import { jsPDF } from "jspdf";
import type {
  AccommodationEntry,
  Company,
  Party,
  PaymentEntry,
  ServiceEntry,
} from "./db";

export type StatementPdfData = {
  company: Company;
  party: Party;
  fromDate: string;
  toDate: string;
  generatedOn: string;
  statementRef: string;
  openingBalance: number;
  purchasesDuringPeriod: number;
  paymentsDuringPeriod: number;
  closingBalance: number;
  accommodationSubtotal: number;
  servicesSubtotal: number;
  accommodation: AccommodationEntry[];
  services: ServiceEntry[];
  payments: PaymentEntry[];
};

type Align = "left" | "center" | "right";

type CellSpec = {
  text: string;
  secondary?: string;
  align?: Align;
  bold?: boolean;
  money?: boolean;
};

type ColumnSpec = {
  width: number;
  header: string;
  align?: Align;
};

type SectionTheme = {
  dark: string;
  header: string;
  alternate: string;
  subtotal: string;
};

const PAGE_W = 210;
const PAGE_H = 297;
const MARGIN_X = 5;
const CONTENT_W = PAGE_W - MARGIN_X * 2;
const FOOTER_Y = 291;
const PAGE_BOTTOM = 286;

const COLORS = {
  navy: "#153F73",
  ink: "#25384D",
  muted: "#66788A",
  border: "#B9C6D3",
  white: "#FFFFFF",
  blueHeader: "#B8D1EA",
  blueAlt: "#F1F6FB",
  blueSubtotal: "#E6EEF7",
  green: "#087B43",
  greenHeader: "#C7E6D3",
  greenAlt: "#F0F8F3",
  greenSubtotal: "#E4F2E9",
  purple: "#57258B",
  purpleHeader: "#DDC8EC",
  purpleAlt: "#F5EEF9",
  purpleSubtotal: "#EEE3F5",
  red: "#B42939",
  redSoft: "#FCECEE",
  cardGrey: "#EDF1F6",
  cardBlue: "#EDF4FA",
  cardGreen: "#EEF8F2",
};

const THEMES: Record<string, SectionTheme> = {
  accommodation: {
    dark: COLORS.navy,
    header: COLORS.blueHeader,
    alternate: COLORS.blueAlt,
    subtotal: COLORS.blueSubtotal,
  },
  services: {
    dark: COLORS.green,
    header: COLORS.greenHeader,
    alternate: COLORS.greenAlt,
    subtotal: COLORS.greenSubtotal,
  },
  payments: {
    dark: COLORS.purple,
    header: COLORS.purpleHeader,
    alternate: COLORS.purpleAlt,
    subtotal: COLORS.purpleSubtotal,
  },
};

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace("#", "");
  return [
    parseInt(clean.substring(0, 2), 16),
    parseInt(clean.substring(2, 4), 16),
    parseInt(clean.substring(4, 6), 16),
  ];
}

function fill(doc: jsPDF, hex: string) {
  const [r, g, b] = hexToRgb(hex);
  doc.setFillColor(r, g, b);
}

function stroke(doc: jsPDF, hex: string) {
  const [r, g, b] = hexToRgb(hex);
  doc.setDrawColor(r, g, b);
}

function textColor(doc: jsPDF, hex: string) {
  const [r, g, b] = hexToRgb(hex);
  doc.setTextColor(r, g, b);
}

function money(value: number) {
  const n = Number(value || 0);
  const sign = n < 0 ? "-" : "";
  return `${sign}Rs ${Math.abs(n).toLocaleString("en-US", {
    maximumFractionDigits: 2,
  })}`;
}

function number(value: number) {
  return Number(value || 0).toLocaleString("en-US", {
    maximumFractionDigits: 2,
  });
}

function shortDate(value: string) {
  if (!value) return "—";
  const [y, m, d] = value.split("-").map(Number);
  if (!y || !m || !d) return value;

  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
  })
    .format(new Date(y, m - 1, d))
    .replace(/ /g, "-");
}

function longDate(value: string) {
  if (!value) return "—";
  const [y, m, d] = value.split("-").map(Number);
  if (!y || !m || !d) return value;

  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  })
    .format(new Date(y, m - 1, d))
    .replace(/ /g, "-");
}

function rateText(currency: string, value: number) {
  return currency === "SAR" ? `SAR ${number(value)}` : money(value);
}

function safeText(value: unknown) {
  const text = String(value ?? "").trim();
  return text || "—";
}

function imageFormat(dataUrl: string) {
  const match = /^data:image\/([^;]+);/i.exec(dataUrl);
  const type = (match?.[1] || "png").toLowerCase();

  if (type.includes("jpeg") || type.includes("jpg")) return "JPEG";
  if (type.includes("webp")) return "WEBP";
  return "PNG";
}

function splitLines(
  doc: jsPDF,
  text: string,
  width: number,
  fontSize = 5.25,
  bold = false
): string[] {
  doc.setFont("helvetica", bold ? "bold" : "normal");
  doc.setFontSize(fontSize);
  return doc.splitTextToSize(text || "—", Math.max(1, width - 1.4));
}

function calcCellLineCount(
  doc: jsPDF,
  cell: CellSpec,
  width: number
) {
  const main = splitLines(doc, cell.text, width, 5.25, !!cell.bold);
  const secondary = cell.secondary
    ? splitLines(doc, cell.secondary, width, 4.55, false)
    : [];
  return { main, secondary, count: main.length + secondary.length };
}

function drawTextLines(
  doc: jsPDF,
  lines: string[],
  x: number,
  y: number,
  width: number,
  align: Align,
  fontSize: number,
  bold: boolean,
  color: string,
  lineHeight: number
) {
  doc.setFont("helvetica", bold ? "bold" : "normal");
  doc.setFontSize(fontSize);
  textColor(doc, color);

  lines.forEach((line, index) => {
    let tx = x + 0.7;
    const ty = y + (index + 1) * lineHeight;

    if (align === "center") tx = x + width / 2;
    if (align === "right") tx = x + width - 0.7;

    doc.text(line, tx, ty, { align });
  });
}

function drawCompanyHeader(
  doc: jsPDF,
  data: StatementPdfData
) {
  let x = MARGIN_X;
  const top = 6;
  const logoSize = data.company.logo_data ? 11 : 0;

  if (data.company.logo_data) {
    try {
      doc.addImage(
        data.company.logo_data,
        imageFormat(data.company.logo_data),
        x,
        top,
        logoSize,
        logoSize,
        undefined,
        "FAST"
      );
      x += logoSize + 2.3;
    } catch {
      // If a specific logo format cannot render, continue with text branding.
    }
  }

  doc.setFont("helvetica", "bold");
  doc.setFontSize(13.4);
  textColor(doc, COLORS.navy);
  doc.text(data.company.name, x, top + 4.5);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(5.2);
  textColor(doc, COLORS.ink);
  doc.text(safeText(data.company.address), x, top + 9);

  const contacts = [
    data.company.phone,
    data.company.whatsapp,
    data.company.email,
  ]
    .filter(Boolean)
    .join("  •  ");

  if (contacts) {
    doc.setFontSize(4.2);
    textColor(doc, COLORS.muted);
    doc.text(contacts, x, top + 12);
  }

  doc.setFont("helvetica", "bold");
  doc.setFontSize(11.5);
  textColor(doc, COLORS.navy);
  doc.text("STATEMENT OF ACCOUNT", PAGE_W - MARGIN_X, top + 4, {
    align: "right",
  });

  doc.setFontSize(5.1);
  doc.setFont("helvetica", "normal");
  textColor(doc, COLORS.ink);
  doc.text(
    `Ledger: ${data.party.name}`,
    PAGE_W - MARGIN_X,
    top + 8,
    { align: "right" }
  );
  doc.text(
    `Date Generated: ${data.generatedOn}`,
    PAGE_W - MARGIN_X,
    top + 11.3,
    { align: "right" }
  );

  doc.setFontSize(5.1);
  doc.setFont("helvetica", "normal");
  textColor(doc, COLORS.ink);
  doc.text(
    `Statement Period: ${longDate(data.fromDate)} to ${longDate(data.toDate)}`,
    MARGIN_X,
    top + 17
  );

  doc.setFont("helvetica", "bold");
  doc.setFontSize(4.7);
  fill(doc, "#E8EDF3");
  doc.roundedRect(MARGIN_X, top + 18.3, 46, 5.1, 1, 1, "F");
  textColor(doc, COLORS.navy);
  doc.text(
    `Statement Ref: ${data.statementRef}`,
    MARGIN_X + 2,
    top + 21.5
  );

  fill(doc, COLORS.navy);
  doc.rect(MARGIN_X, top + 25, CONTENT_W, 0.9, "F");

  return top + 28;
}

function drawSummaryCards(
  doc: jsPDF,
  data: StatementPdfData,
  y: number
) {
  const gap = 1.5;
  const cardW = (CONTENT_W - gap * 3) / 4;
  const cardH = 15.3;

  const cards = [
    {
      title: "OPENING BALANCE",
      value: money(data.openingBalance),
      foot: "Before selected period",
      fill: COLORS.cardGrey,
      top: COLORS.navy,
      valueColor: COLORS.navy,
    },
    {
      title: "TOTAL PURCHASES",
      value: money(data.purchasesDuringPeriod),
      foot: "During selected period",
      fill: COLORS.cardBlue,
      top: "#245D98",
      valueColor: COLORS.navy,
    },
    {
      title: "TOTAL PAYMENTS",
      value: money(data.paymentsDuringPeriod),
      foot: "During selected period",
      fill: COLORS.cardGreen,
      top: COLORS.green,
      valueColor: COLORS.green,
    },
    {
      title:
        data.closingBalance > 0
          ? "OUTSTANDING BALANCE"
          : data.closingBalance < 0
          ? "RECEIVABLE / ADVANCE"
          : "SETTLED BALANCE",
      value: money(Math.abs(data.closingBalance)),
      foot: "Closing position",
      fill:
        data.closingBalance > 0 ? COLORS.redSoft : COLORS.cardGreen,
      top:
        data.closingBalance > 0 ? COLORS.red : COLORS.green,
      valueColor:
        data.closingBalance > 0 ? COLORS.red : COLORS.green,
    },
  ];

  cards.forEach((card, index) => {
    const x = MARGIN_X + index * (cardW + gap);

    fill(doc, card.fill);
    stroke(doc, COLORS.border);
    doc.setLineWidth(0.3);
    doc.roundedRect(x, y, cardW, cardH, 1, 1, "FD");

    fill(doc, card.top);
    doc.rect(x, y, cardW, 0.9, "F");

    doc.setFont("helvetica", "bold");
    doc.setFontSize(4.8);
    textColor(doc, COLORS.muted);
    doc.text(card.title, x + 2, y + 4.2);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(9.1);
    textColor(doc, card.valueColor);
    doc.text(card.value, x + 2, y + 9.3);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(4.1);
    textColor(doc, COLORS.muted);
    doc.text(card.foot, x + 2, y + 12.8);
  });

  return y + cardH + 2.1;
}

function drawContinuationHeader(
  doc: jsPDF,
  data: StatementPdfData
) {
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.2);
  textColor(doc, COLORS.navy);
  doc.text(data.company.name, MARGIN_X, 8);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(4.8);
  textColor(doc, COLORS.muted);
  doc.text(
    `Statement of Account — ${data.party.name}`,
    MARGIN_X,
    11.2
  );

  doc.text(
    `${longDate(data.fromDate)} to ${longDate(data.toDate)}`,
    PAGE_W - MARGIN_X,
    8,
    { align: "right" }
  );

  doc.text(
    data.statementRef,
    PAGE_W - MARGIN_X,
    11.2,
    { align: "right" }
  );

  fill(doc, COLORS.navy);
  doc.rect(MARGIN_X, 13.2, CONTENT_W, 0.7, "F");

  return 16;
}

function drawSectionTitle(
  doc: jsPDF,
  title: string,
  theme: SectionTheme,
  y: number,
  continued = false
) {
  fill(doc, theme.dark);
  doc.rect(MARGIN_X, y, CONTENT_W, 6.2, "F");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.3);
  textColor(doc, COLORS.white);
  doc.text(
    continued ? `${title} — CONTINUED` : title,
    MARGIN_X + 2.1,
    y + 4.25
  );

  return y + 6.2;
}

function drawTableHeader(
  doc: jsPDF,
  columns: ColumnSpec[],
  theme: SectionTheme,
  y: number
) {
  const h = 6.7;
  let x = MARGIN_X;

  fill(doc, theme.header);
  doc.rect(MARGIN_X, y, CONTENT_W, h, "F");

  stroke(doc, COLORS.border);
  doc.setLineWidth(0.23);

  columns.forEach((col, index) => {
    if (index > 0) doc.line(x, y, x, y + h);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(4.45);
    textColor(doc, COLORS.ink);

    const lines = col.header.split("\n");
    const lineHeight = 1.75;
    const textBlockH = lines.length * lineHeight;
    const startY = y + (h - textBlockH) / 2 + 1.35;

    lines.forEach((line, lineIndex) => {
      doc.text(
        line,
        x + col.width / 2,
        startY + lineIndex * lineHeight,
        { align: "center" }
      );
    });

    x += col.width;
  });

  stroke(doc, COLORS.border);
  doc.rect(MARGIN_X, y, CONTENT_W, h);

  return y + h;
}

function measureRow(
  doc: jsPDF,
  cells: CellSpec[],
  columns: ColumnSpec[]
) {
  const MAIN_SIZE = 5.15;
  const SECONDARY_SIZE = 4.35;
  const LINE_H = 2.05;
  const SECONDARY_H = 1.8;
  const PAD = 0.5;

  let maxHeight = 0;

  cells.forEach((cell, index) => {
    const width = columns[index].width;

    const mainLines = splitLines(
      doc,
      cell.text,
      width,
      MAIN_SIZE,
      !!cell.bold
    );

    const secondaryLines = cell.secondary
      ? splitLines(doc, cell.secondary, width, SECONDARY_SIZE, false)
      : [];

    const cellHeight =
      mainLines.length * LINE_H +
      secondaryLines.length * SECONDARY_H +
      PAD * 2;

    maxHeight = Math.max(maxHeight, cellHeight);
  });

  return Math.max(5.0, maxHeight);
}

function drawRow(
  doc: jsPDF,
  cells: CellSpec[],
  columns: ColumnSpec[],
  y: number,
  rowHeight: number,
  alternateFill?: string
) {
  let x = MARGIN_X;

  if (alternateFill) {
    fill(doc, alternateFill);
    doc.rect(MARGIN_X, y, CONTENT_W, rowHeight, "F");
  }

  stroke(doc, COLORS.border);
  doc.setLineWidth(0.2);

  cells.forEach((cell, index) => {
    const width = columns[index].width;
    const align = cell.align || columns[index].align || "left";

    if (index > 0) doc.line(x, y, x, y + rowHeight);

    const mainSize = 5.15;
    const secondarySize = 4.35;
    const mainLineH = 2.05;
    const secondaryLineH = 1.8;

    const mainLines = splitLines(
      doc,
      cell.text,
      width,
      mainSize,
      !!cell.bold
    );

    const secondaryLines = cell.secondary
      ? splitLines(doc, cell.secondary, width, secondarySize, false)
      : [];

    const blockH =
      mainLines.length * mainLineH +
      secondaryLines.length * secondaryLineH;

    let ty = y + Math.max(0.6, (rowHeight - blockH) / 2);

    drawTextLines(
      doc,
      mainLines,
      x,
      ty,
      width,
      align,
      mainSize,
      !!cell.bold,
      cell.money ? COLORS.green : COLORS.ink,
      mainLineH
    );

    ty += mainLines.length * mainLineH;

    if (secondaryLines.length) {
      drawTextLines(
        doc,
        secondaryLines,
        x,
        ty,
        width,
        align,
        secondarySize,
        false,
        COLORS.muted,
        secondaryLineH
      );
    }

    x += width;
  });

  stroke(doc, COLORS.border);
  doc.rect(MARGIN_X, y, CONTENT_W, rowHeight);

  return y + rowHeight;
}

function drawSubtotal(
  doc: jsPDF,
  label: string,
  value: number,
  theme: SectionTheme,
  y: number
) {
  const h = 5.5;

  fill(doc, theme.subtotal);
  stroke(doc, COLORS.border);
  doc.rect(MARGIN_X, y, CONTENT_W, h, "FD");

  fill(doc, theme.dark);
  doc.rect(MARGIN_X, y, CONTENT_W, 0.65, "F");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(5.2);
  textColor(doc, theme.dark);
  doc.text(label, PAGE_W - MARGIN_X - 31, y + 3.65, {
    align: "right",
  });

  textColor(doc, COLORS.navy);
  doc.text(money(value), PAGE_W - MARGIN_X - 2, y + 3.65, {
    align: "right",
  });

  return y + h;
}

function drawEmptyRow(
  doc: jsPDF,
  text: string,
  y: number
) {
  const h = 6.5;

  stroke(doc, COLORS.border);
  doc.rect(MARGIN_X, y, CONTENT_W, h);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(4.8);
  textColor(doc, COLORS.muted);
  doc.text(text, PAGE_W / 2, y + 4.1, { align: "center" });

  return y + h;
}

function addPageForContinuation(
  doc: jsPDF,
  data: StatementPdfData
) {
  doc.addPage("a4", "portrait");
  return drawContinuationHeader(doc, data);
}

function renderSection(
  doc: jsPDF,
  data: StatementPdfData,
  title: string,
  columns: ColumnSpec[],
  rows: CellSpec[][],
  subtotal: number,
  theme: SectionTheme,
  y: number
) {
  const titleH = 6.2;
  const headerH = 6.7;
  const subtotalH = 5.5;
  const firstRowH =
    rows.length > 0 ? measureRow(doc, rows[0], columns) : 6.5;

  const minimumNeeded = titleH + headerH + firstRowH + subtotalH;

  if (y + minimumNeeded > PAGE_BOTTOM) {
    y = addPageForContinuation(doc, data);
  }

  y = drawSectionTitle(doc, title, theme, y);
  y = drawTableHeader(doc, columns, theme, y);

  if (!rows.length) {
    y = drawEmptyRow(
      doc,
      `No ${title.toLowerCase()} transactions in selected period.`,
      y
    );
  } else {
    rows.forEach((row, index) => {
      const rowH = measureRow(doc, row, columns);
      const reserveSubtotal = index === rows.length - 1 ? subtotalH : 0;

      if (y + rowH + reserveSubtotal > PAGE_BOTTOM) {
        y = addPageForContinuation(doc, data);
        y = drawSectionTitle(doc, title, theme, y, true);
        y = drawTableHeader(doc, columns, theme, y);
      }

      y = drawRow(
        doc,
        row,
        columns,
        y,
        rowH,
        index % 2 === 1 ? theme.alternate : undefined
      );
    });
  }

  if (y + subtotalH > PAGE_BOTTOM) {
    y = addPageForContinuation(doc, data);
    y = drawSectionTitle(doc, title, theme, y, true);
  }

  y = drawSubtotal(doc, `${title} SUBTOTAL`, subtotal, theme, y);

  return y + 2.2;
}

function drawFooters(
  doc: jsPDF,
  data: StatementPdfData
) {
  const pages = doc.getNumberOfPages();

  for (let page = 1; page <= pages; page += 1) {
    doc.setPage(page);

    stroke(doc, COLORS.border);
    doc.setLineWidth(0.22);
    doc.line(MARGIN_X, FOOTER_Y - 3.4, PAGE_W - MARGIN_X, FOOTER_Y - 3.4);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(4.0);
    textColor(doc, COLORS.muted);

    doc.text(
      `Base Currency: ${data.company.base_currency}  |  Foreign Currency: ${data.company.foreign_currency}`,
      MARGIN_X,
      FOOTER_Y
    );

    doc.text(
      "Please report any discrepancy with the relevant SR / Receipt / UB reference.",
      PAGE_W / 2,
      FOOTER_Y,
      { align: "center" }
    );

    doc.text(
      `${data.statementRef}  •  Page ${page} of ${pages}`,
      PAGE_W - MARGIN_X,
      FOOTER_Y,
      { align: "right" }
    );
  }
}

export function buildStatementPdf(data: StatementPdfData) {
  const doc = new jsPDF({
    orientation: "portrait",
    unit: "mm",
    format: "a4",
    compress: true,
    putOnlyUsedFonts: true,
  });

  doc.setProperties({
    title: `${data.company.name} - Statement - ${data.party.name}`,
    subject: `Statement of Account - ${data.party.name}`,
    author: data.company.name,
    creator: "Travel Accounting",
    keywords: "statement, account, travel accounting",
  });

  let y = drawCompanyHeader(doc, data);
  y = drawSummaryCards(doc, data, y);

  const accommodationColumns: ColumnSpec[] = [
    { width: 7, header: "SR", align: "center" },
    { width: 14, header: "DATE", align: "center" },
    { width: 32, header: "PARTY NAME\n/ UB #" },
    { width: 11, header: "CITY", align: "center" },
    { width: 27, header: "HOTEL NAME" },
    { width: 16, header: "CHECK-IN", align: "center" },
    { width: 12, header: "NO. OF\nNIGHTS", align: "center" },
    { width: 18, header: "RATE", align: "right" },
    { width: 16, header: "NO. OF\nBED/ROOM", align: "center" },
    { width: 19, header: "TOTAL SAR", align: "right" },
    { width: 28, header: "TOTAL PKR", align: "right" },
  ];

  const serviceColumns: ColumnSpec[] = [
    { width: 7, header: "SR", align: "center" },
    { width: 14, header: "DATE", align: "center" },
    { width: 42, header: "PARTY NAME\n/ UB #" },
    { width: 48, header: "SERVICE TYPE" },
    { width: 27, header: "RATE\n(PER HEAD)", align: "right" },
    { width: 14, header: "NO. OF\nPAX", align: "center" },
    { width: 22, header: "SAR × ROE", align: "center" },
    { width: 26, header: "TOTAL PKR", align: "right" },
  ];

  const paymentColumns: ColumnSpec[] = [
    { width: 7, header: "SR", align: "center" },
    { width: 14, header: "DATE", align: "center" },
    { width: 18, header: "RECIEPT #", align: "center" },
    { width: 28, header: "FROM ACCOUNT" },
    { width: 28, header: "TO ACCOUNT" },
    { width: 50, header: "DESCRIPTION" },
    { width: 14, header: "TYPE", align: "center" },
    { width: 14, header: "SAR", align: "right" },
    { width: 27, header: "PAID AMOUNT", align: "right" },
  ];

  const accommodationRows: CellSpec[][] = data.accommodation.map(
    (entry, index) => [
      { text: String(index + 1), align: "center" },
      { text: shortDate(entry.transaction_date), align: "center" },
      {
        text: safeText(entry.booking_party_name),
        secondary: entry.ub_number ? `UB # ${entry.ub_number}` : "—",
        bold: true,
      },
      { text: safeText(entry.city), align: "center" },
      { text: safeText(entry.hotel_name) },
      { text: shortDate(entry.check_in), align: "center" },
      { text: String(entry.nights), align: "center" },
      { text: rateText(entry.currency, entry.rate), align: "right" },
      { text: String(entry.bed_room_count), align: "center" },
      {
        text:
          entry.currency === "SAR"
            ? number(entry.total_sar)
            : "—",
        align: "right",
      },
      {
        text: money(entry.total_pkr),
        align: "right",
        bold: true,
        money: true,
      },
    ]
  );

  const serviceRows: CellSpec[][] = data.services.map(
    (entry, index) => [
      { text: String(index + 1), align: "center" },
      { text: shortDate(entry.transaction_date), align: "center" },
      {
        text: safeText(entry.booking_party_name),
        secondary: safeText(entry.ub_number),
        bold: true,
      },
      { text: safeText(entry.service_type) },
      { text: rateText(entry.currency, entry.rate), align: "right" },
      { text: String(entry.pax), align: "center" },
      {
        text:
          entry.currency === "SAR"
            ? `${number(entry.total_sar)} × ${number(entry.roe)}`
            : "—",
        align: "center",
      },
      {
        text: money(entry.total_pkr),
        align: "right",
        bold: true,
        money: true,
      },
    ]
  );

  const paymentRows: CellSpec[][] = data.payments.map(
    (entry, index) => [
      { text: String(index + 1), align: "center" },
      { text: shortDate(entry.transaction_date), align: "center" },
      { text: safeText(entry.receipt_no), align: "center" },
      { text: safeText(entry.from_account) },
      { text: safeText(entry.to_account) },
      { text: safeText(entry.description) },
      { text: safeText(entry.payment_type), align: "center" },
      {
        text:
          entry.currency === "SAR"
            ? number(entry.sar)
            : "—",
        align: "right",
      },
      {
        text: money(entry.paid_amount),
        align: "right",
        bold: true,
        money: true,
      },
    ]
  );

  y = renderSection(
    doc,
    data,
    "ACCOMMODATION",
    accommodationColumns,
    accommodationRows,
    data.accommodationSubtotal,
    THEMES.accommodation,
    y
  );

  y = renderSection(
    doc,
    data,
    "SERVICES",
    serviceColumns,
    serviceRows,
    data.servicesSubtotal,
    THEMES.services,
    y
  );

  renderSection(
    doc,
    data,
    "PAYMENTS",
    paymentColumns,
    paymentRows,
    data.paymentsDuringPeriod,
    THEMES.payments,
    y
  );

  drawFooters(doc, data);

  return doc;
}
