import { useEffect, useRef, useState } from "react";
import type { jsPDF } from "jspdf";
import type { Company, Party, PaymentEntry } from "./db";
import { buildPaymentReceiptPdf, receiptDocumentTitle } from "./PaymentReceiptPdf";
import {
  downloadPaymentReceiptJpg,
  downloadPaymentReceiptPdf,
  paymentReceiptFileName,
  paymentReceiptJpgBlob,
  paymentReceiptJpgFileName,
} from "./paymentReceiptExport";
import type { PaymentTransactionKind, PaymentV2Meta } from "./PaymentV2Db";
import "./PaymentReceiptPreviewModal.css";

type Props = {
  company: Company;
  party: Party;
  entry: PaymentEntry;
  meta: PaymentV2Meta | null;
  transactionKind: PaymentTransactionKind;
  preparedBy?: string;
  onClose: () => void;
};

export default function PaymentReceiptPreviewModal({
  company,
  party,
  entry,
  meta,
  transactionKind,
  preparedBy,
  onClose,
}: Props) {
  const [previewUrl, setPreviewUrl] = useState("");
  const [doc, setDoc] = useState<jsPDF | null>(null);
  const [busy, setBusy] = useState(false);
  const [downloadKind, setDownloadKind] = useState<"pdf" | "jpg" | null>(null);
  const [error, setError] = useState("");
  const previewUrlRef = useRef("");

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      setError("");
      setBusy(true);
      setPreviewUrl("");
      try {
        const pdf = buildPaymentReceiptPdf({
          company,
          party,
          entry,
          meta,
          transactionKind,
          preparedBy,
          generatedOn: new Date().toISOString(),
        });
        if (cancelled) return;

        setDoc(pdf);
        const blob = await paymentReceiptJpgBlob(pdf);
        if (cancelled) return;

        const objectUrl = URL.createObjectURL(blob);
        previewUrlRef.current = objectUrl;
        setPreviewUrl(objectUrl);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();

    return () => {
      cancelled = true;
      if (previewUrlRef.current) {
        URL.revokeObjectURL(previewUrlRef.current);
        previewUrlRef.current = "";
      }
    };
  }, [company, party, entry, meta, transactionKind, preparedBy]);

  async function handleDownloadPdf() {
    if (!doc) return;
    setBusy(true);
    setDownloadKind("pdf");
    setError("");
    try {
      await downloadPaymentReceiptPdf(doc, paymentReceiptFileName(company, entry, party.name));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      setDownloadKind(null);
    }
  }

  async function handleDownloadJpg() {
    if (!doc) return;
    setBusy(true);
    setDownloadKind("jpg");
    setError("");
    try {
      await downloadPaymentReceiptJpg(doc, paymentReceiptJpgFileName(company, entry, party.name));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      setDownloadKind(null);
    }
  }

  return (
    <div
      className="modal-backdrop payment-receipt-preview-backdrop"
      onMouseDown={(e) => e.currentTarget === e.target && onClose()}
    >
      <section className="modal-card payment-receipt-preview-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <span className="eyebrow blue">{receiptDocumentTitle(transactionKind)}</span>
            <h3>{entry.receipt_no || "Payment receipt"}</h3>
            <p>
              {party.name} · {entry.payment_type} · Rs {Number(entry.paid_amount || 0).toLocaleString("en-PK")}
            </p>
          </div>
          <button type="button" className="secondary" onClick={onClose}>
            Close
          </button>
        </div>

        {error && <div className="alert error">{error}</div>}

        <div className="payment-receipt-preview-shell">
          {busy && !previewUrl ? (
            <div className="payment-receipt-preview-loading">Building receipt preview...</div>
          ) : previewUrl ? (
            <img className="payment-receipt-preview-image" src={previewUrl} alt={`Receipt ${entry.receipt_no || ""}`} />
          ) : (
            <div className="payment-receipt-preview-loading">Receipt preview is unavailable.</div>
          )}
        </div>

        <div className="modal-buttons payment-receipt-preview-actions">
          <button type="button" className="secondary" onClick={onClose}>
            Close
          </button>
          <button type="button" className="secondary" disabled={!doc || busy} onClick={() => void handleDownloadJpg()}>
            {busy && downloadKind === "jpg" ? "Saving JPG..." : "Download JPG"}
          </button>
          <button type="button" className="primary" disabled={!doc || busy} onClick={() => void handleDownloadPdf()}>
            {busy && downloadKind === "pdf" ? "Saving PDF..." : "Download PDF"}
          </button>
        </div>
      </section>
    </div>
  );
}
