import { useEffect, useMemo, useRef, useState } from "react";
import type { jsPDF } from "jspdf";
import type { Company, Party, PaymentEntry } from "./db";
import { buildPaymentReceiptPdf, receiptDocumentTitle } from "./PaymentReceiptPdf";
import { ModalPortal } from "./ModalPortal";
import { useBodyScrollLock } from "./useBodyScrollLock";
import {
  downloadPaymentReceiptJpg,
  downloadPaymentReceiptPdf,
  paymentReceiptFileName,
  paymentReceiptJpgBlob,
  paymentReceiptJpgFileName,
  normalizeWhatsAppPhone,
  partyWhatsAppPhone,
  printPaymentReceiptPdf,
  sharePaymentReceiptWhatsApp,
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
  useBodyScrollLock(true);

  const [previewUrl, setPreviewUrl] = useState("");
  const [doc, setDoc] = useState<jsPDF | null>(null);
  const [busy, setBusy] = useState(false);
  const [downloadKind, setDownloadKind] = useState<"pdf" | "jpg" | "whatsapp" | null>(null);
  const [error, setError] = useState("");
  const [hint, setHint] = useState("");
  const previewUrlRef = useRef("");

  const canWhatsApp = useMemo(
    () => Boolean(normalizeWhatsAppPhone(partyWhatsAppPhone(party))),
    [party.phone, party.whatsapp],
  );

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

  function handlePrint() {
    if (!doc) return;
    setError("");
    void printPaymentReceiptPdf(doc).catch((e) => {
      setError(e instanceof Error ? e.message : String(e));
    });
  }

  function handleWhatsApp() {
    if (!doc) return;
    setError("");
    setHint("");
    setBusy(true);
    setDownloadKind("whatsapp");
    void sharePaymentReceiptWhatsApp(party, company, entry, transactionKind, doc, party.name)
      .then((result) => {
        if (result.hint) setHint(result.hint);
      })
      .catch((e) => {
        setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        setBusy(false);
        setDownloadKind(null);
      });
  }

  return (
    <ModalPortal>
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
          {hint && <div className="alert info">{hint}</div>}

          <div className="payment-receipt-preview-shell">
            {busy && !previewUrl ? (
              <div className="payment-receipt-preview-loading">Building receipt preview...</div>
            ) : previewUrl ? (
              <img
                className="payment-receipt-preview-image"
                src={previewUrl}
                alt={`Receipt ${entry.receipt_no || ""}`}
              />
            ) : (
              <div className="payment-receipt-preview-loading">Receipt preview is unavailable.</div>
            )}
          </div>

          <div className="modal-buttons payment-receipt-preview-actions">
            <button
              type="button"
              className="secondary"
              disabled={!doc || busy}
              onClick={() => void handleDownloadPdf()}
            >
              {busy && downloadKind === "pdf" ? "Saving PDF..." : "Download PDF"}
            </button>
            <button
              type="button"
              className="secondary"
              disabled={!doc || busy}
              onClick={() => void handleDownloadJpg()}
            >
              {busy && downloadKind === "jpg" ? "Saving JPG..." : "Download JPG"}
            </button>
            <button type="button" className="primary" disabled={!doc || busy} onClick={handlePrint}>
              Print
            </button>
            <button
              type="button"
              className="secondary payment-receipt-whatsapp-btn"
              disabled={!doc || busy || !canWhatsApp}
              title={
                canWhatsApp
                  ? "Share receipt JPG on WhatsApp with message"
                  : "Add phone in Counterparties to use WhatsApp"
              }
              onClick={handleWhatsApp}
            >
              {busy && downloadKind === "whatsapp" ? "Preparing..." : "WhatsApp"}
            </button>
          </div>
        </section>
      </div>
    </ModalPortal>
  );
}
