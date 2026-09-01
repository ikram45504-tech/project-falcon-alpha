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

const PAGE_W = 148;
const MARGIN = 10;
const CONTENT_W = PAGE_W - MARGIN * 2;

const COLORS = {
  navy: "#153F73",
  ink: "#25384D",
  muted: "#66788A",
  border: "#B9C6D3",
  panel: "#F4F8FC",
  green: "#087B43",
  greenSoft: "#EEF8F3",
  amber: "#93651C",
  amberSoft: "#FFF7E7",
  red: "#B42939",
  voidBg: "#FCECEE",
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
  return `Rs ${Math.abs(Number(value || 0)).toLocaleString("en-PK", { maximumFractionDigits: 2 })}`;
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

export function receiptDocumentTitle(kind: PaymentTransactionKind) {
  if (kind === "PARTY_RECEIPT") return "OFFICIAL RECEIPT";
  if (kind === "VENDOR_PAYMENT") return "PAYMENT VOUCHER";
  if (kind === "PARTY_REFUND") return "REFUND VOUCHER";
  return "REFUND RECEIPT";
}

export function receiptSubtitle(kind: PaymentTransactionKind) {
  if (kind === "PARTY_RECEIPT") return "Payment received from customer";
  if (kind === "VENDOR_PAYMENT") return "Payment sent to supplier";
  if (kind === "PARTY_REFUND") return "Refund issued to customer";
  return "Refund received from supplier";
}

function accentForKind(kind: PaymentTransactionKind) {
  if (kind === "PARTY_RECEIPT" || kind === "VENDOR_REFUND") return COLORS.green;
  if (kind === "PARTY_REFUND") return COLORS.amber;
  return COLORS.navy;
}

function accentSoftForKind(kind: PaymentTransactionKind) {
  if (kind === "PARTY_RECEIPT" || kind === "VENDOR_REFUND") return COLORS.greenSoft;
  if (kind === "PARTY_REFUND") return COLORS.amberSoft;
  return COLORS.panel;
}

function drawVoidWatermark(doc: jsPDF) {
  doc.setFont("helvetica", "bold");
  doc.setFontSize(42);
  textColor(doc, COLORS.red);
  doc.text("VOID", PAGE_W / 2, 120, { align: "center", angle: 35 });
}

function drawLabelValue(doc: jsPDF, x: number, y: number, label: string, value: string, width: number) {
  doc.setFont("helvetica", "bold");
  doc.setFontSize(6.2);
  textColor(doc, COLORS.muted);
  doc.text(label.toUpperCase(), x, y);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.2);
  textColor(doc, COLORS.ink);
  const lines = doc.splitTextToSize(value, width);
  doc.text(lines, x, y + 4.2);
  return y + 4.2 + lines.length * 3.6;
}

export function buildPaymentReceiptPdf(data: PaymentReceiptPdfData) {
  const doc = new jsPDF({ unit: "mm", format: "a5", orientation: "portrait" });
  const { company, party, entry, meta, transactionKind } = data;
  const accent = accentForKind(transactionKind);
  const accentSoft = accentSoftForKind(transactionKind);
  const settlement =
    meta?.settlement_account ||
    (transactionKind === "PARTY_RECEIPT" || transactionKind === "VENDOR_REFUND"
      ? entry.to_account
      : entry.from_account);
  const flowFrom = entry.from_account || "—";
  const flowTo = entry.to_account || "—";
  let y = 8;

  if (company.logo_data) {
    try {
      doc.addImage(company.logo_data, imageFormat(company.logo_data), MARGIN, y, 14, 14, undefined, "FAST");
    } catch {
      /* text branding remains */
    }
  }

  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  textColor(doc, COLORS.navy);
  doc.text(company.name, MARGIN + (company.logo_data ? 16 : 0), y + 5);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(6.5);
  textColor(doc, COLORS.ink);
  let detailY = y + 10;
  const address = safeText(company.address);
  if (address !== "—") {
    doc.text(doc.splitTextToSize(address, CONTENT_W - 16), MARGIN + (company.logo_data ? 16 : 0), detailY);
    detailY += 4;
  }
  const contacts = uniqueContacts([company.phone, company.whatsapp, company.email]);
  if (contacts.length) {
    doc.setFontSize(6);
    textColor(doc, COLORS.muted);
    doc.text(contacts.join("  |  "), MARGIN + (company.logo_data ? 16 : 0), detailY);
  }

  y = 28;
  fill(doc, accent);
  doc.roundedRect(MARGIN, y, CONTENT_W, 11, 1.5, 1.5, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11.5);
  textColor(doc, "#FFFFFF");
  doc.text(receiptDocumentTitle(transactionKind), PAGE_W / 2, y + 5.2, { align: "center" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(6.5);
  doc.text(receiptSubtitle(transactionKind), PAGE_W / 2, y + 9.2, { align: "center" });

  y += 15;
  const colW = CONTENT_W / 3;
  drawLabelValue(doc, MARGIN, y, "Document #", safeText(entry.receipt_no), colW - 2);
  drawLabelValue(doc, MARGIN + colW, y, "Date", longDate(entry.transaction_date), colW - 2);
  drawLabelValue(doc, MARGIN + colW * 2, y, "Method", safeText(entry.payment_type), colW - 2);

  y += 18;
  fill(doc, accentSoft);
  stroke(doc, COLORS.border);
  doc.roundedRect(MARGIN, y, CONTENT_W, 22, 1.5, 1.5, "FD");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(6.2);
  textColor(doc, COLORS.muted);
  doc.text(party.account_type === "VENDOR" ? "VENDOR / SUPPLIER" : "PARTY / CUSTOMER", MARGIN + 4, y + 5);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10.5);
  textColor(doc, COLORS.ink);
  doc.text(safeText(party.name), MARGIN + 4, y + 11);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  textColor(doc, COLORS.muted);
  const partyLine = [party.phone, party.email, party.address].map((v) => safeText(v)).filter((v) => v !== "—");
  if (partyLine.length) doc.text(partyLine.join("  |  "), MARGIN + 4, y + 16.5);

  y += 27;
  fill(doc, "#FFFFFF");
  stroke(doc, accent);
  doc.setLineWidth(0.35);
  doc.roundedRect(MARGIN, y, CONTENT_W, 24, 1.5, 1.5, "FD");
  doc.setLineWidth(0.1);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(6.5);
  textColor(doc, COLORS.muted);
  doc.text("AMOUNT", PAGE_W / 2, y + 5.5, { align: "center" });
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  textColor(doc, accent);
  doc.text(money(entry.paid_amount), PAGE_W / 2, y + 14, { align: "center" });
  if (entry.currency === "SAR") {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    textColor(doc, COLORS.ink);
    doc.text(
      `SAR ${Number(entry.sar || entry.amount_entered || 0).toLocaleString("en-PK", { maximumFractionDigits: 2 })}  @  ROE ${Number(entry.roe || 0).toLocaleString("en-PK", { maximumFractionDigits: 2 })}`,
      PAGE_W / 2,
      y + 19.5,
      { align: "center" },
    );
  }

  y += 29;
  const details: Array<[string, string]> = [
    ["Money flow", `${flowFrom}  →  ${flowTo}`],
    ["Settlement account", safeText(settlement)],
    ["Reference", safeText(meta?.reference || entry.description)],
  ];
  if (entry.payment_type === "BANK") {
    details.push(["Bank", safeText(meta?.bank_name)]);
    details.push(["Bank reference", safeText(meta?.bank_transaction_reference)]);
    if (meta?.cheque_no) details.push(["Cheque #", safeText(meta.cheque_no)]);
    if (meta?.transfer_date) details.push(["Transfer date", longDate(meta.transfer_date)]);
  } else {
    if (meta?.handled_by) details.push(["Handled by", safeText(meta.handled_by)]);
    if (meta?.location) details.push(["Location", safeText(meta.location)]);
  }
  if (entry.description) {
    details.push(["Description", safeText(entry.description)]);
  }

  fill(doc, COLORS.panel);
  stroke(doc, COLORS.border);
  doc.roundedRect(MARGIN, y, CONTENT_W, 8 + details.length * 7.2, 1.5, 1.5, "FD");
  let detailRowY = y + 5;
  for (const [label, value] of details) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(6);
    textColor(doc, COLORS.muted);
    doc.text(label.toUpperCase(), MARGIN + 4, detailRowY);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.2);
    textColor(doc, COLORS.ink);
    doc.text(doc.splitTextToSize(value, CONTENT_W - 42), MARGIN + 38, detailRowY);
    detailRowY += 7.2;
  }

  y = detailRowY + 8;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(6);
  textColor(doc, COLORS.muted);
  doc.text(
    "This settlement is recorded against the account balance and is not allocated to a specific booking.",
    MARGIN,
    y,
  );
  doc.text(`Prepared by: ${safeText(data.preparedBy || "Office")}`, MARGIN, y + 4);
  doc.text(`Generated: ${longDate(data.generatedOn.slice(0, 10))}`, MARGIN, y + 8);
  if (company.dts_license) doc.text(`DTS License: ${company.dts_license}`, MARGIN, y + 12);

  const sigY = y + 20;
  stroke(doc, COLORS.border);
  doc.line(MARGIN, sigY, MARGIN + 52, sigY);
  doc.line(PAGE_W - MARGIN - 52, sigY, PAGE_W - MARGIN, sigY);
  doc.setFontSize(6);
  textColor(doc, COLORS.muted);
  doc.text("Received / Authorized", MARGIN, sigY + 4);
  doc.text("For Office Use", PAGE_W - MARGIN - 52, sigY + 4);

  if (entry.status === "VOID") {
    fill(doc, COLORS.voidBg);
    doc.roundedRect(MARGIN, 26, CONTENT_W, 170, 1.5, 1.5, "F");
    try {
      drawVoidWatermark(doc);
    } catch {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(28);
      textColor(doc, COLORS.red);
      doc.text("VOID", PAGE_W / 2, 100, { align: "center" });
    }
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    textColor(doc, COLORS.red);
    doc.text("THIS DOCUMENT HAS BEEN VOIDED", PAGE_W / 2, 26, { align: "center" });
  }

  doc.setProperties({
    title: `${receiptDocumentTitle(transactionKind)} - ${entry.receipt_no}`,
    subject: "Payment Receipt",
    author: company.name,
  });

  return doc;
}
