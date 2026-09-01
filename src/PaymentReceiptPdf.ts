import { jsPDF } from "jspdf";
import type { Company, Party, PaymentEntry } from "./db";
import type { PaymentTransactionKind, PaymentV2Meta } from "./PaymentV2Db";

export type PaymentReceiptPdfData = {
  company: Company;
  party: Party;
  entry: PaymentEntry;
  meta: PaymentV2Meta | null;
  transactionKind: PaymentTransactionKind;
  preparedBy?: string;
  generatedOn: string;
};

const PAGE_W = 210;
const PAGE_H = 297;
/** Receipt zone height on A4 portrait — top third, for print on standard A4 paper. */
export const PAYMENT_RECEIPT_HEIGHT_MM = 99;
export const PAYMENT_RECEIPT_PAGE_HEIGHT_MM = PAGE_H;
const RECEIPT_H = PAYMENT_RECEIPT_HEIGHT_MM;
const RX = 10;
const RW = PAGE_W - RX * 2;
const DISCLAIMER = "THIS IS A COMPUTER GENERATED RECEIPT THAT DOES NOT NEED STAMP AND SIGNATORY.";

const COLORS = {
  navy: "#153F73",
  accent: "#E86B1A",
  ink: "#25384D",
  muted: "#66788A",
  border: "#B9C6D3",
  red: "#B42939",
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
  return `Rs ${Math.abs(Number(value || 0)).toLocaleString("en-PK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function safeText(value: unknown) {
  const text = String(value ?? "").trim();
  return text || "—";
}
function longDate(value: string) {
  if (!value) return "—";
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
  return [...new Set(values.map((v) => String(v || "").trim()).filter(Boolean))];
}

const ONES = ["", "ONE", "TWO", "THREE", "FOUR", "FIVE", "SIX", "SEVEN", "EIGHT", "NINE"];
const TEENS = [
  "TEN",
  "ELEVEN",
  "TWELVE",
  "THIRTEEN",
  "FOURTEEN",
  "FIFTEEN",
  "SIXTEEN",
  "SEVENTEEN",
  "EIGHTEEN",
  "NINETEEN",
];
const TENS = ["", "", "TWENTY", "THIRTY", "FORTY", "FIFTY", "SIXTY", "SEVENTY", "EIGHTY", "NINETY"];

function twoDigits(value: number) {
  if (value < 10) return ONES[value];
  if (value < 20) return TEENS[value - 10];
  const tens = Math.floor(value / 10);
  const ones = value % 10;
  return ones ? `${TENS[tens]} ${ONES[ones]}` : TENS[tens];
}

function threeDigits(value: number) {
  if (value === 0) return "";
  const hundred = Math.floor(value / 100);
  const rest = value % 100;
  const parts: string[] = [];
  if (hundred) parts.push(`${ONES[hundred]} HUNDRED`);
  if (rest) parts.push(twoDigits(rest));
  return parts.join(" ");
}

export function pkrAmountInWords(amount: number) {
  const abs = Math.abs(Number(amount || 0));
  const rupees = Math.floor(abs);
  const paisa = Math.round((abs - rupees) * 100);
  if (rupees === 0 && paisa === 0) return "RUPEES ZERO ONLY";

  const crore = Math.floor(rupees / 10000000);
  const lakh = Math.floor((rupees % 10000000) / 100000);
  const thousand = Math.floor((rupees % 100000) / 1000);
  const hundred = rupees % 1000;
  const parts: string[] = [];
  if (crore) parts.push(`${threeDigits(crore)} CRORE`.trim());
  if (lakh) parts.push(`${twoDigits(lakh)} LAKH`.trim());
  if (thousand) parts.push(`${twoDigits(thousand)} THOUSAND`.trim());
  if (hundred) parts.push(threeDigits(hundred));

  let result = `RUPEES ${parts.join(" ").replace(/\s+/g, " ").trim()}`;
  if (paisa) result += ` AND ${twoDigits(paisa)} PAISE`;
  return `${result} ONLY`;
}

export function receiptDocumentTitle(kind: PaymentTransactionKind) {
  if (kind === "PARTY_RECEIPT") return "OFFICIAL RECEIPT";
  if (kind === "VENDOR_PAYMENT") return "PAYMENT VOUCHER";
  if (kind === "PARTY_REFUND") return "REFUND VOUCHER";
  return "REFUND RECEIPT";
}

function counterpartyLabel(kind: PaymentTransactionKind) {
  if (kind === "VENDOR_PAYMENT" || kind === "PARTY_REFUND") return "PAID TO";
  return "RECEIVED FROM";
}

export function amountSumLabel(kind: PaymentTransactionKind) {
  if (kind === "VENDOR_PAYMENT" || kind === "PARTY_REFUND") return "PAID THE SUM OF :";
  return "RECEIVED THE SUM OF :";
}

function drawVoidWatermark(doc: jsPDF) {
  doc.setGState(doc.GState({ opacity: 0.12 }));
  fill(doc, "#FCECEE");
  doc.rect(RX, 8, RW, RECEIPT_H - 9, "F");
  doc.setGState(doc.GState({ opacity: 1 }));

  doc.setFont("helvetica", "bold");
  doc.setFontSize(34);
  textColor(doc, COLORS.red);
  doc.setGState(doc.GState({ opacity: 0.4 }));
  try {
    doc.text("VOID", PAGE_W / 2, 52, { align: "center", angle: 12 });
  } catch {
    doc.text("VOID", PAGE_W / 2, 52, { align: "center" });
  }
  doc.setGState(doc.GState({ opacity: 1 }));

  fill(doc, COLORS.accent);
  doc.rect(RX, RECEIPT_H - 1.2, RW, 1.2, "F");
}

function bankRefLine(entry: PaymentEntry, meta: PaymentV2Meta | null) {
  if (entry.payment_type === "CASH") return "CASH";
  const parts = [meta?.bank_name, meta?.bank_transaction_reference, meta?.cheque_no]
    .map((value) => String(value || "").trim())
    .filter(Boolean);
  return parts.length ? parts.join(" · ") : "—";
}

function remarksLine(entry: PaymentEntry, meta: PaymentV2Meta | null) {
  return safeText(meta?.reference || entry.description);
}

function drawField(doc: jsPDF, x: number, y: number, width: number, label: string, value: string, compact = false) {
  doc.setFont("helvetica", "bold");
  doc.setFontSize(compact ? 5.4 : 5.8);
  textColor(doc, COLORS.ink);
  doc.text(label, x, y);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(compact ? 6.4 : 7);
  const lines = doc.splitTextToSize(value, width);
  const lineY = y + (compact ? 3.2 : 3.6);
  doc.text(lines, x, lineY);
  stroke(doc, COLORS.border);
  doc.setLineWidth(0.15);
  const underlineY = lineY + lines.length * (compact ? 2.8 : 3.1) + 0.6;
  doc.line(x, underlineY, x + width, underlineY);
  return underlineY + (compact ? 2.4 : 2.8);
}

function drawInlineField(doc: jsPDF, x: number, y: number, width: number, label: string, value: string) {
  doc.setFont("helvetica", "bold");
  doc.setFontSize(5.4);
  textColor(doc, COLORS.ink);
  doc.text(`${label} `, x, y);
  const labelW = doc.getTextWidth(`${label} `);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(6.4);
  const lines = doc.splitTextToSize(value, width - labelW);
  doc.text(lines, x + labelW, y);
  stroke(doc, COLORS.border);
  doc.setLineWidth(0.15);
  const underlineY = y + 1.2;
  doc.line(x + labelW, underlineY, x + width, underlineY);
  return underlineY + 3;
}

export function buildPaymentReceiptPdf(data: PaymentReceiptPdfData) {
  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
  const { company, party, entry, meta, transactionKind, preparedBy } = data;
  const flowFrom = entry.from_account || "—";
  const flowTo = entry.to_account || "—";
  const flowLine = `${flowFrom}  →  ${flowTo}`;
  const description = safeText(entry.description || meta?.reference);
  const amountWords = pkrAmountInWords(entry.paid_amount);
  let y = 8;

  stroke(doc, COLORS.border);
  doc.setLineWidth(0.35);
  doc.rect(RX, y, RW, RECEIPT_H - 8, "S");

  fill(doc, COLORS.navy);
  doc.rect(RX, y, RW, 1.8, "F");
  y += 2.4;

  if (company.logo_data) {
    try {
      doc.addImage(company.logo_data, imageFormat(company.logo_data), PAGE_W / 2 - 5, y, 10, 10, undefined, "FAST");
      y += 11;
    } catch {
      /* text branding remains */
    }
  }

  doc.setFont("helvetica", "bold");
  doc.setFontSize(10.5);
  textColor(doc, COLORS.navy);
  doc.text(company.name.toUpperCase(), PAGE_W / 2, y + 3.5, { align: "center" });
  y += 5.5;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(6);
  textColor(doc, COLORS.muted);
  const address = safeText(company.address);
  if (address !== "—") {
    doc.text(doc.splitTextToSize(address, RW - 12), PAGE_W / 2, y + 2.5, { align: "center" });
    y += 4.5;
  }
  const contacts = uniqueContacts([company.phone, company.whatsapp, company.email]);
  if (contacts.length) {
    doc.text(contacts.join(" · "), PAGE_W / 2, y + 2.5, { align: "center" });
    y += 4;
  }

  stroke(doc, COLORS.border);
  doc.setLineWidth(0.2);
  doc.line(RX + 4, y + 1.5, RX + RW - 4, y + 1.5);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9.5);
  textColor(doc, COLORS.ink);
  doc.text(receiptDocumentTitle(transactionKind), PAGE_W / 2, y + 6.5, { align: "center" });
  doc.line(RX + 4, y + 8.5, RX + RW - 4, y + 8.5);
  y += 11;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(6.2);
  textColor(doc, COLORS.ink);
  doc.text(`NO. : ${safeText(entry.receipt_no)}`, RX + 6, y + 2);
  doc.text(`DATE : ${longDate(entry.transaction_date)}`, RX + RW - 6, y + 2, { align: "right" });
  y += 5;

  y = drawField(doc, RX + 6, y, RW - 12, `${counterpartyLabel(transactionKind)} :`, safeText(party.name));
  y = drawField(doc, RX + 6, y, RW - 12, amountSumLabel(transactionKind), amountWords, true);

  const halfW = (RW - 14) / 2;
  const rowY = y;
  const leftEnd = drawInlineField(doc, RX + 6, rowY, halfW, "PAYMENT BY :", safeText(entry.payment_type));
  const rightEnd = drawInlineField(doc, RX + 8 + halfW, rowY, halfW, "BANK / REF :", bankRefLine(entry, meta));
  y = Math.max(leftEnd, rightEnd);

  y = drawField(doc, RX + 6, y, RW - 12, "FOR / REMARKS :", remarksLine(entry, meta), true);

  const tableTop = y + 0.5;
  const tableH = 16;
  stroke(doc, COLORS.border);
  doc.setLineWidth(0.2);
  doc.rect(RX + 6, tableTop, RW - 12, tableH);
  doc.line(RX + RW - 38, tableTop, RX + RW - 38, tableTop + tableH);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(5.2);
  textColor(doc, COLORS.muted);
  doc.text("DESCRIPTION", RX + 8, tableTop + 3.5);
  doc.text("AMOUNT", RX + RW - 10, tableTop + 3.5, { align: "right" });

  doc.setFont("helvetica", "normal");
  doc.setFontSize(6.2);
  textColor(doc, COLORS.ink);
  doc.text(doc.splitTextToSize(description, RW - 52), RX + 8, tableTop + 7.5);
  doc.setFontSize(5.2);
  textColor(doc, COLORS.muted);
  doc.text(doc.splitTextToSize(flowLine, RW - 52), RX + 8, tableTop + 11.5);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  textColor(doc, COLORS.navy);
  doc.text(money(entry.paid_amount), RX + RW - 10, tableTop + 10, { align: "right" });
  if (entry.currency === "SAR") {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(5.2);
    textColor(doc, COLORS.muted);
    doc.text(
      `SAR ${Number(entry.sar || entry.amount_entered || 0).toLocaleString("en-PK", { maximumFractionDigits: 2 })} @ ${Number(entry.roe || 0).toLocaleString("en-PK", { maximumFractionDigits: 2 })}`,
      RX + RW - 10,
      tableTop + 14,
      { align: "right" },
    );
  }

  y = tableTop + tableH + 2.5;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(4.8);
  textColor(doc, COLORS.muted);
  doc.text(doc.splitTextToSize(DISCLAIMER, RW - 12), PAGE_W / 2, y, { align: "center" });
  y += 5;

  const preparedByText = safeText(preparedBy);
  if (preparedByText !== "—") {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(5.2);
    textColor(doc, COLORS.muted);
    doc.text(`Prepared by : ${preparedByText}`, RX + 6, y);
    y += 3.5;
  }

  doc.setFont("helvetica", "bolditalic");
  doc.setFontSize(5.8);
  textColor(doc, COLORS.ink);
  doc.text(`For ${company.name}`, RX + RW - 6, y, { align: "right" });

  if (entry.status === "VOID") {
    drawVoidWatermark(doc);
  }

  doc.setProperties({
    title: `${receiptDocumentTitle(transactionKind)} - ${entry.receipt_no}`,
    subject: "Payment Receipt",
    author: company.name,
  });

  return doc;
}
