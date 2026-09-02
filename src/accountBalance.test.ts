import { describe, expect, it } from "vitest";
import {
  accountBalanceFromTotals,
  inferPaymentKind,
  paymentKindLabel,
  signedPaymentSettlement,
  sumSignedPaymentSettlements,
} from "./accountBalance";

describe("accountBalance", () => {
  it("treats party refunds as negative settlement", () => {
    expect(signedPaymentSettlement(5000, "PARTY_REFUND")).toBe(-5000);
    expect(signedPaymentSettlement(5000, "PARTY_RECEIPT")).toBe(5000);
  });

  it("infers default kind from account type when meta is missing", () => {
    expect(inferPaymentKind(null, "PARTY")).toBe("PARTY_RECEIPT");
    expect(inferPaymentKind(null, "VENDOR")).toBe("VENDOR_PAYMENT");
    expect(inferPaymentKind({ transaction_kind: "PARTY_REFUND" }, "PARTY")).toBe("PARTY_REFUND");
  });

  it("labels payment kinds for client-facing statements", () => {
    expect(paymentKindLabel("PARTY_RECEIPT")).toBe("Payment");
    expect(paymentKindLabel("VENDOR_PAYMENT")).toBe("Payment");
    expect(paymentKindLabel("PARTY_REFUND")).toBe("Refund");
  });

  it("sums signed settlements for mixed receipts and refunds", () => {
    const total = sumSignedPaymentSettlements([{ paid_amount: 20000 }, { paid_amount: 5000 }], (index) =>
      index === 0 ? "PARTY_RECEIPT" : "PARTY_REFUND",
    );
    expect(total).toBe(15000);
  });

  it("derives receivable from booking and signed payment totals", () => {
    expect(accountBalanceFromTotals(1531300, 15000)).toBe(1516300);
  });
});
