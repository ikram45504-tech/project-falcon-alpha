import type { jsPDF } from "jspdf";
import type { Company, PaymentEntry } from "./db";

export function safeFileName(text: string) {
  return String(text || "document")
    .replace(/[<>:"/\\|?*]+/g, "-")
    .replace(/\s+/g, "_")
    .slice(0, 80);
}

export function paymentReceiptFileName(company: Company, entry: PaymentEntry, accountName: string) {
  return `${safeFileName(company.name)}_${safeFileName(entry.receipt_no || "payment")}_${safeFileName(accountName)}.pdf`;
}

export async function downloadPaymentReceiptPdf(doc: jsPDF, fileName: string) {
  const pdfBytes = new Uint8Array(doc.output("arraybuffer"));
  const isTauri = "__TAURI_INTERNALS__" in window;

  if (!isTauri) {
    const blob = new Blob([pdfBytes], { type: "application/pdf" });
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
    filters: [{ name: "PDF Document", extensions: ["pdf"] }],
  });
  if (filePath) await writeFile(filePath, pdfBytes);
}
