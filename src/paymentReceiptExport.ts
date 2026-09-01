import type { jsPDF } from "jspdf";
import type { Company, PaymentEntry } from "./db";
import { PAYMENT_RECEIPT_HEIGHT_MM, PAYMENT_RECEIPT_PAGE_HEIGHT_MM } from "./PaymentReceiptPdf";

export function safeFileName(text: string) {
  return String(text || "document")
    .replace(/[<>:"/\\|?*]+/g, "-")
    .replace(/\s+/g, "_")
    .slice(0, 80);
}

function receiptBaseFileName(company: Company, entry: PaymentEntry, accountName: string) {
  return `${safeFileName(company.name)}_${safeFileName(entry.receipt_no || "payment")}_${safeFileName(accountName)}`;
}

export function paymentReceiptFileName(company: Company, entry: PaymentEntry, accountName: string) {
  return `${receiptBaseFileName(company, entry, accountName)}.pdf`;
}

export function paymentReceiptJpgFileName(company: Company, entry: PaymentEntry, accountName: string) {
  return `${receiptBaseFileName(company, entry, accountName)}.jpg`;
}

export function paymentReceiptPdfBlob(doc: jsPDF) {
  const pdfBytes = new Uint8Array(doc.output("arraybuffer"));
  return new Blob([pdfBytes], { type: "application/pdf" });
}

async function downloadBlobFile(blob: Blob, fileName: string, tauriFilter: { name: string; extensions: string[] }) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const isTauri = "__TAURI_INTERNALS__" in window;

  if (!isTauri) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileName;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
    return;
  }

  const { downloadDir, join } = await import("@tauri-apps/api/path");
  const { save } = await import("@tauri-apps/plugin-dialog");
  const { writeFile } = await import("@tauri-apps/plugin-fs");
  const defaultPath = await join(await downloadDir(), fileName);
  const filePath = await save({
    defaultPath,
    filters: [tauriFilter],
  });
  if (filePath) await writeFile(filePath, bytes);
}

export async function paymentReceiptJpgBlob(doc: jsPDF) {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();

  const pdfBytes = doc.output("arraybuffer");
  const pdf = await pdfjs.getDocument({ data: pdfBytes }).promise;
  const page = await pdf.getPage(1);
  const scale = 2;
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Could not prepare receipt image.");

  await page.render({ canvasContext: context, viewport, canvas }).promise;

  const receiptRatio = PAYMENT_RECEIPT_HEIGHT_MM / PAYMENT_RECEIPT_PAGE_HEIGHT_MM;
  const cropHeight = Math.max(1, Math.round(canvas.height * receiptRatio));
  const cropped = document.createElement("canvas");
  cropped.width = canvas.width;
  cropped.height = cropHeight;
  const cropContext = cropped.getContext("2d");
  if (!cropContext) throw new Error("Could not prepare receipt image.");

  cropContext.fillStyle = "#ffffff";
  cropContext.fillRect(0, 0, cropped.width, cropped.height);
  cropContext.drawImage(canvas, 0, 0, canvas.width, cropHeight, 0, 0, canvas.width, cropHeight);

  return new Promise<Blob>((resolve, reject) => {
    cropped.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Could not create JPG image."))),
      "image/jpeg",
      0.92,
    );
  });
}

export async function downloadPaymentReceiptPdf(doc: jsPDF, fileName: string) {
  await downloadBlobFile(paymentReceiptPdfBlob(doc), fileName, { name: "PDF Document", extensions: ["pdf"] });
}

export async function downloadPaymentReceiptJpg(doc: jsPDF, fileName: string) {
  const blob = await paymentReceiptJpgBlob(doc);
  await downloadBlobFile(blob, fileName, { name: "JPEG Image", extensions: ["jpg", "jpeg"] });
}
