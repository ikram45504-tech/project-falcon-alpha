import { describe, expect, it } from "vitest";
import { aggregatePartyBookingTotals, webBookingSelectColumns, type BookingAccountingEntry } from "./BookingAccounting";
import { aggregatePartyPaymentTotals } from "./db";

function bookingEntry(
  partial: Partial<BookingAccountingEntry> & Pick<BookingAccountingEntry, "counterparty_id" | "transaction_type">,
): BookingAccountingEntry {
  return {
    id: partial.id || "b1",
    company_id: partial.company_id || "c1",
    service_type: partial.service_type || "PACKAGE",
    transaction_type: partial.transaction_type,
    counterparty_id: partial.counterparty_id,
    counterparty_name: partial.counterparty_name || "Test Party",
    transaction_date: partial.transaction_date || "2026-09-01",
    ub_number: partial.ub_number || "UB-0001",
    total_sar: partial.total_sar ?? 0,
    total_pkr: partial.total_pkr ?? 0,
    unconverted_sar: partial.unconverted_sar ?? 0,
    status: partial.status || "ACTIVE",
    created_at: partial.created_at || "2026-09-01T10:00:00.000Z",
  };
}

describe("web financial totals aggregation", () => {
  it("uses SAR columns only for hotel/visa/transport/misc web queries", () => {
    expect(webBookingSelectColumns(false)).toBe(
      "id,company_id,transaction_type,counterparty_id,transaction_date,ub_number,total_pkr,status,created_at",
    );
    expect(webBookingSelectColumns(true)).toContain("total_sar");
    expect(webBookingSelectColumns(false)).not.toContain("total_sar");
  });

  it("sums active sale and purchase totals per counterparty", () => {
    const totals = aggregatePartyBookingTotals([
      bookingEntry({ counterparty_id: "p1", transaction_type: "SALE", total_pkr: 10000 }),
      bookingEntry({ counterparty_id: "p1", transaction_type: "SALE", total_pkr: 5000 }),
      bookingEntry({ counterparty_id: "v1", transaction_type: "PURCHASE", total_pkr: 7000 }),
      bookingEntry({
        counterparty_id: "p2",
        transaction_type: "SALE",
        total_pkr: 9999,
        status: "VOID",
      }),
    ]);

    expect(totals).toEqual(
      expect.arrayContaining([
        { counterparty_id: "p1", sale_total: 15000, purchase_total: 0 },
        { counterparty_id: "v1", sale_total: 0, purchase_total: 7000 },
      ]),
    );
    expect(totals.find((row) => row.counterparty_id === "p2")).toBeUndefined();
  });

  it("sums active payment totals per party", () => {
    const totals = aggregatePartyPaymentTotals([
      { party_id: "p1", paid_amount: 3000 },
      { party_id: "p1", paid_amount: 2000 },
      { party_id: "v1", paid_amount: "1500" },
    ]);

    expect(totals).toEqual(
      expect.arrayContaining([
        { party_id: "p1", paid_amount: 5000 },
        { party_id: "v1", paid_amount: 1500 },
      ]),
    );
  });

  it("derives party balance from booking and payment totals", () => {
    const bookingTotals = aggregatePartyBookingTotals([
      bookingEntry({ counterparty_id: "p1", transaction_type: "SALE", total_pkr: 20000 }),
    ]);
    const paymentTotals = aggregatePartyPaymentTotals([{ party_id: "p1", paid_amount: 7500 }]);

    const saleTotal = bookingTotals.find((row) => row.counterparty_id === "p1")?.sale_total || 0;
    const paidTotal = paymentTotals.find((row) => row.party_id === "p1")?.paid_amount || 0;
    expect(saleTotal - paidTotal).toBe(12500);
  });
});
