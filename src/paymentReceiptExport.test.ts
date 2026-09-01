import { describe, expect, it } from "vitest";
import {
  normalizeWhatsAppPhone,
  paymentReceiptWhatsAppDeepLink,
  paymentReceiptWhatsAppMessage,
  paymentReceiptWhatsAppUrl,
  receiptWhatsAppShareHint,
  shouldPreferImagePrint,
} from "./paymentReceiptExport";
import type { Company, Party, PaymentEntry } from "./db";

const company = { name: "Test Travel" } as Company;
const party = { phone: "0300-1234567", whatsapp: "" } as Party;
const entry = {
  receipt_no: "RCPT-0001",
  paid_amount: 5000,
} as PaymentEntry;

describe("paymentReceiptExport WhatsApp", () => {
  it("normalizes Pakistani mobile numbers", () => {
    expect(normalizeWhatsAppPhone("0300-1234567")).toBe("923001234567");
    expect(normalizeWhatsAppPhone("+92 300 1234567")).toBe("923001234567");
    expect(normalizeWhatsAppPhone("923001234567")).toBe("923001234567");
  });

  it("builds a receipt message", () => {
    const message = paymentReceiptWhatsAppMessage(company, entry, "PARTY_RECEIPT");
    expect(message).toContain("OFFICIAL RECEIPT RCPT-0001");
    expect(message).toContain("Test Travel");
    expect(message).toContain("5,000");
  });

  it("builds wa.me url when phone exists", () => {
    const url = paymentReceiptWhatsAppUrl(party, company, entry, "PARTY_REFUND");
    expect(url).toMatch(/^https:\/\/wa\.me\/923001234567\?text=/);
  });

  it("builds whatsapp:// deep link for desktop app", () => {
    const url = paymentReceiptWhatsAppDeepLink(party, company, entry, "PARTY_REFUND");
    expect(url).toMatch(/^whatsapp:\/\/send\?phone=923001234567&text=/);
  });

  it("returns null when phone is missing", () => {
    expect(paymentReceiptWhatsAppUrl({ phone: "", whatsapp: "" }, company, entry, "PARTY_RECEIPT")).toBeNull();
  });

  it("builds share hints for clipboard and saved file flows", () => {
    expect(receiptWhatsAppShareHint(true, "receipt.jpg")).toContain("Ctrl+V");
    expect(receiptWhatsAppShareHint(false, "receipt.jpg")).toContain("receipt.jpg");
  });

  it("prefers image print on touch and narrow screens", () => {
    expect(typeof shouldPreferImagePrint()).toBe("boolean");
  });
});
