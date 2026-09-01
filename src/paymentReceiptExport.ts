import type { jsPDF } from "jspdf";
import type { Company, Party, PaymentEntry } from "./db";
import {
  PAYMENT_RECEIPT_HEIGHT_MM,
  PAYMENT_RECEIPT_PAGE_HEIGHT_MM,
  PAYMENT_RECEIPT_PAGE_WIDTH_MM,
  receiptDocumentTitle,
} from "./PaymentReceiptPdf";
import type { PaymentTransactionKind } from "./PaymentV2Db";

function isMobilePrintShell() {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  if (/iPhone|iPod|iPad|Android/i.test(ua)) return true;
  return navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
}

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

export function shouldPreferImagePrint() {
  if (typeof window === "undefined") return false;
  if (isMobilePrintShell()) return true;
  if (typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(max-width: 768px), (pointer: coarse)").matches;
}

export async function blobToDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") resolve(reader.result);
      else reject(new Error("Could not prepare receipt image."));
    };
    reader.onerror = () => reject(new Error("Could not prepare receipt image."));
    reader.readAsDataURL(blob);
  });
}

export function buildReceiptPrintHtml(imageDataUrl: string) {
  const pageW = PAYMENT_RECEIPT_PAGE_WIDTH_MM;
  const pageH = PAYMENT_RECEIPT_PAGE_HEIGHT_MM;
  const receiptH = PAYMENT_RECEIPT_HEIGHT_MM;
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=${pageW}, initial-scale=1.0"><title>Receipt</title><style>
*, *::before, *::after { box-sizing: border-box; }
@page { size: ${pageW}mm ${pageH}mm; margin: 0; }
@page { size: A4 portrait; margin: 0; }
html, body {
  margin: 0;
  padding: 0;
  width: ${pageW}mm;
  min-height: ${pageH}mm;
  background: #fff;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}
.receipt-sheet {
  width: ${pageW}mm;
  height: ${pageH}mm;
  margin: 0;
  padding: 0;
  overflow: hidden;
  background: #fff;
  page-break-after: avoid;
  page-break-inside: avoid;
}
.receipt-sheet img {
  display: block;
  width: ${pageW}mm;
  height: ${receiptH}mm;
  margin: 0;
  object-fit: contain;
  object-position: top center;
}
</style></head><body><div class="receipt-sheet"><img src="${imageDataUrl}" alt="Receipt" /></div></body></html>`;
}

function waitForNextFrame() {
  return new Promise<void>((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve());
    });
  });
}

async function waitForImageReady(img: HTMLImageElement) {
  if (!img.complete || img.naturalWidth === 0) {
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("Could not prepare receipt for printing."));
    });
  }
  if (img.decode) await img.decode().catch(() => undefined);
  await waitForNextFrame();
}

function printPdfViaIframe(url: string) {
  return new Promise<void>((resolve, reject) => {
    const iframe = document.createElement("iframe");
    iframe.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0";
    iframe.title = "Print receipt";
    iframe.src = url;

    const cleanup = () => {
      URL.revokeObjectURL(url);
      iframe.remove();
    };

    iframe.onload = () => {
      try {
        const win = iframe.contentWindow;
        if (!win) throw new Error("Could not open print dialog.");
        win.addEventListener("afterprint", cleanup, { once: true });
        win.focus();
        win.print();
        resolve();
        window.setTimeout(cleanup, 120_000);
      } catch (e) {
        cleanup();
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    };

    iframe.onerror = () => {
      cleanup();
      reject(new Error("Could not prepare receipt for printing."));
    };
    document.body.appendChild(iframe);
  });
}

function printReceiptImageInIsolatedDocument(imageDataUrl: string) {
  return new Promise<void>((resolve, reject) => {
    const iframe = document.createElement("iframe");
    const pageW = PAYMENT_RECEIPT_PAGE_WIDTH_MM;
    const pageH = PAYMENT_RECEIPT_PAGE_HEIGHT_MM;
    iframe.style.cssText = `position:fixed;left:-10000px;top:0;width:${pageW}mm;height:${pageH}mm;border:0;visibility:hidden`;
    iframe.title = "Print receipt";

    const cleanup = () => {
      iframe.remove();
    };

    const finish = () => {
      cleanup();
      resolve();
    };

    document.body.appendChild(iframe);
    const doc = iframe.contentDocument;
    const win = iframe.contentWindow;
    if (!doc || !win) {
      cleanup();
      reject(new Error("Could not open print dialog."));
      return;
    }

    doc.open();
    doc.write(buildReceiptPrintHtml(imageDataUrl));
    doc.close();

    const runPrint = async () => {
      try {
        const img = doc.querySelector("img");
        if (!img) throw new Error("Could not prepare receipt for printing.");
        await waitForImageReady(img);
        win.addEventListener("afterprint", finish, { once: true });
        win.focus();
        win.print();
        window.setTimeout(finish, 120_000);
      } catch (e) {
        cleanup();
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    };

    if (doc.readyState === "complete") {
      void runPrint();
      return;
    }

    iframe.onload = () => {
      void runPrint();
    };
  });
}

export async function printPaymentReceiptPdf(doc: jsPDF) {
  if (shouldPreferImagePrint()) {
    const imageDataUrl = await blobToDataUrl(await paymentReceiptJpgBlob(doc));
    await printReceiptImageInIsolatedDocument(imageDataUrl);
    return;
  }

  const pdfUrl = URL.createObjectURL(paymentReceiptPdfBlob(doc));
  try {
    await printPdfViaIframe(pdfUrl);
  } catch {
    const imageDataUrl = await blobToDataUrl(await paymentReceiptJpgBlob(doc));
    await printReceiptImageInIsolatedDocument(imageDataUrl);
  }
}

export function partyWhatsAppPhone(party: Pick<Party, "phone" | "whatsapp">) {
  return String(party.whatsapp || party.phone || "").trim();
}

export function normalizeWhatsAppPhone(raw: string) {
  const digits = raw.replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("92") && digits.length >= 12) return digits;
  if (digits.startsWith("0") && digits.length >= 10) return `92${digits.slice(1)}`;
  if (digits.length === 10 && digits.startsWith("3")) return `92${digits}`;
  return digits;
}

export function paymentReceiptWhatsAppMessage(
  company: Company,
  entry: PaymentEntry,
  transactionKind: PaymentTransactionKind,
) {
  const title = receiptDocumentTitle(transactionKind);
  const receiptNo = entry.receipt_no || "Receipt";
  const amount = Number(entry.paid_amount || 0).toLocaleString("en-PK");
  return `${title} ${receiptNo} from ${company.name} — Rs ${amount}. Thank you.`;
}

export function paymentReceiptWhatsAppUrl(
  party: Pick<Party, "phone" | "whatsapp">,
  company: Company,
  entry: PaymentEntry,
  transactionKind: PaymentTransactionKind,
) {
  const phone = normalizeWhatsAppPhone(partyWhatsAppPhone(party));
  if (!phone) return null;
  const message = paymentReceiptWhatsAppMessage(company, entry, transactionKind);
  return `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
}

export function paymentReceiptWhatsAppDeepLink(
  party: Pick<Party, "phone" | "whatsapp">,
  company: Company,
  entry: PaymentEntry,
  transactionKind: PaymentTransactionKind,
) {
  const phone = normalizeWhatsAppPhone(partyWhatsAppPhone(party));
  if (!phone) return null;
  const message = paymentReceiptWhatsAppMessage(company, entry, transactionKind);
  return `whatsapp://send?phone=${phone}&text=${encodeURIComponent(message)}`;
}

async function openExternalUrl(url: string) {
  const isTauri = "__TAURI_INTERNALS__" in window;
  if (isTauri) {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(url);
    return;
  }

  const popup = window.open(url, "_blank", "noopener,noreferrer");
  if (popup) return;

  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.target = "_blank";
  anchor.rel = "noopener noreferrer";
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
}

async function openWhatsAppChat(
  party: Pick<Party, "phone" | "whatsapp">,
  company: Company,
  entry: PaymentEntry,
  transactionKind: PaymentTransactionKind,
) {
  const webUrl = paymentReceiptWhatsAppUrl(party, company, entry, transactionKind);
  if (!webUrl) {
    throw new Error("Add a phone number for this account in Counterparties to use WhatsApp.");
  }

  const isTauri = "__TAURI_INTERNALS__" in window;
  if (!isTauri) {
    await openExternalUrl(webUrl);
    return;
  }

  const deepLink = paymentReceiptWhatsAppDeepLink(party, company, entry, transactionKind);
  const { openUrl } = await import("@tauri-apps/plugin-opener");
  if (deepLink) {
    try {
      await openUrl(deepLink);
      return;
    } catch {
      // Fall back to wa.me if the desktop protocol handler is unavailable.
    }
  }
  await openUrl(webUrl);
}

async function tryShareReceiptViaWebShare(jpgBlob: Blob, fileName: string, message: string) {
  if (typeof navigator.share !== "function") return false;

  const file = new File([jpgBlob], fileName, { type: "image/jpeg" });
  const payload: ShareData = { text: message, files: [file] };
  if (typeof navigator.canShare === "function" && !navigator.canShare(payload)) return false;

  try {
    await navigator.share(payload);
    return true;
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") return true;
    return false;
  }
}

async function copyReceiptImageToClipboard(jpgBlob: Blob) {
  if (typeof ClipboardItem === "undefined" || !navigator.clipboard?.write) return false;
  await navigator.clipboard.write([new ClipboardItem({ "image/jpeg": jpgBlob })]);
  return true;
}

async function saveReceiptJpgForShare(jpgBlob: Blob, fileName: string) {
  const bytes = new Uint8Array(await jpgBlob.arrayBuffer());
  const isTauri = "__TAURI_INTERNALS__" in window;

  if (isTauri) {
    const { downloadDir, join } = await import("@tauri-apps/api/path");
    const { writeFile } = await import("@tauri-apps/plugin-fs");
    const filePath = await join(await downloadDir(), fileName);
    await writeFile(filePath, bytes);
    return filePath;
  }

  const url = URL.createObjectURL(jpgBlob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
  return fileName;
}

export function receiptWhatsAppShareHint(imageCopied: boolean, fileName: string) {
  if (imageCopied) {
    return "Receipt JPG copied. Press Ctrl+V in WhatsApp to paste the image, then send.";
  }
  return `Receipt JPG saved to Downloads as ${fileName}. Attach it in WhatsApp using the paperclip icon.`;
}

export async function sharePaymentReceiptWhatsApp(
  party: Pick<Party, "phone" | "whatsapp">,
  company: Company,
  entry: PaymentEntry,
  transactionKind: PaymentTransactionKind,
  doc: jsPDF,
  accountName: string,
): Promise<{ hint?: string }> {
  if (!paymentReceiptWhatsAppUrl(party, company, entry, transactionKind)) {
    throw new Error("Add a phone number for this account in Counterparties to use WhatsApp.");
  }

  const message = paymentReceiptWhatsAppMessage(company, entry, transactionKind);
  const fileName = paymentReceiptJpgFileName(company, entry, accountName);
  const jpgBlob = await paymentReceiptJpgBlob(doc);

  if (await tryShareReceiptViaWebShare(jpgBlob, fileName, message)) {
    return {};
  }

  let imageCopied = false;
  try {
    imageCopied = await copyReceiptImageToClipboard(jpgBlob);
  } catch {
    // Clipboard image share is optional; fall back to saved file + WhatsApp chat.
  }

  await saveReceiptJpgForShare(jpgBlob, fileName);
  await openWhatsAppChat(party, company, entry, transactionKind);

  return { hint: receiptWhatsAppShareHint(imageCopied, fileName) };
}

/** @deprecated Use sharePaymentReceiptWhatsApp */
export async function openPaymentReceiptWhatsApp(
  party: Pick<Party, "phone" | "whatsapp">,
  company: Company,
  entry: PaymentEntry,
  transactionKind: PaymentTransactionKind,
  doc?: jsPDF,
  accountName?: string,
) {
  if (doc && accountName) {
    return sharePaymentReceiptWhatsApp(party, company, entry, transactionKind, doc, accountName);
  }

  await openWhatsAppChat(party, company, entry, transactionKind);
}
