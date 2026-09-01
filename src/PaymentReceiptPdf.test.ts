import { describe, expect, it } from "vitest";
import { amountSumLabel, buildPaymentReceiptPdf, pkrAmountInWords, receiptDocumentTitle } from "./PaymentReceiptPdf";
import type { PaymentTransactionKind } from "./PaymentV2Db";
import type { Company, Party, PaymentEntry } from "./db";

const company: Company = {
  id: "co-1",
  name: "Travel Hisab QA",
  address: "Lahore",
  phone: "0300-0000000",
  logo_data: "",
} as Company;

const party: Party = {
  id: "party-1",
  company_id: "co-1",
  name: "QA Test Party",
  account_type: "PARTY",
  created_at: "2026-01-01",
} as Party;

function sampleEntry(overrides: Partial<PaymentEntry> = {}): PaymentEntry {
  return {
    id: "pay-1",
    company_id: "co-1",
    party_id: "party-1",
    receipt_no: "RCP-0001",
    transaction_date: "2026-09-01",
    payment_type: "CASH",
    paid_amount: 5000,
    from_account: "Cash",
    to_account: "QA Test Party",
    description: "Smoke test payment",
    status: "ACTIVE",
    currency: "PKR",
    created_at: "2026-09-01",
    ...overrides,
  } as PaymentEntry;
}

function buildForKind(kind: PaymentTransactionKind, entryOverrides: Partial<PaymentEntry> = {}) {
  return buildPaymentReceiptPdf({
    company,
    party,
    entry: sampleEntry(entryOverrides),
    meta: null,
    transactionKind: kind,
    preparedBy: "QA User",
    generatedOn: "2026-09-01T00:00:00.000Z",
  });
}

describe("PaymentReceiptPdf", () => {
  const kinds: PaymentTransactionKind[] = ["PARTY_RECEIPT", "VENDOR_PAYMENT", "PARTY_REFUND", "VENDOR_REFUND"];

  it.each(kinds)("builds a non-empty PDF for %s", (kind) => {
    const doc = buildForKind(kind);
    const bytes = doc.output("arraybuffer");
    expect(bytes.byteLength).toBeGreaterThan(1000);
    expect(receiptDocumentTitle(kind)).toBeTruthy();
  });

  it("uses PAID THE SUM OF for outbound payment kinds", () => {
    expect(amountSumLabel("VENDOR_PAYMENT")).toBe("PAID THE SUM OF :");
    expect(amountSumLabel("PARTY_REFUND")).toBe("PAID THE SUM OF :");
    expect(amountSumLabel("PARTY_RECEIPT")).toBe("RECEIVED THE SUM OF :");
    expect(amountSumLabel("VENDOR_REFUND")).toBe("RECEIVED THE SUM OF :");
  });

  it("builds VOID payment PDF without failing", () => {
    const doc = buildForKind("PARTY_REFUND", { status: "VOID", receipt_no: "RF-VOID-001" });
    expect(doc.output("arraybuffer").byteLength).toBeGreaterThan(1000);
  });

  it("formats PKR amount in words", () => {
    expect(pkrAmountInWords(5000)).toContain("FIVE THOUSAND");
  });
});
