import { describe, expect, it } from "vitest";
import { entitlementsFromPlan } from "./companyEntitlements";
import { formatPlanPkr, quotePlanRate, roundPlanPkr } from "./planRateCalculator";

describe("plan rate calculator", () => {
  it("prices Pro floors at Rs 8,000 / 3 months", () => {
    const quote = quotePlanRate(entitlementsFromPlan("pro").limits, "pro");
    expect(quote.officialPkr).toBe(8000);
    expect(quote.calculatedPkr).toBe(8000);
    expect(quote.periodMonths).toBe(3);
    expect(quote.progress).toBeCloseTo(0, 5);
  });

  it("prices Enterprise floors at Rs 18,000 / 3 months", () => {
    const quote = quotePlanRate(entitlementsFromPlan("enterprise").limits, "enterprise");
    expect(quote.officialPkr).toBe(18000);
    expect(quote.calculatedPkr).toBe(18000);
    expect(quote.progress).toBeCloseTo(1, 5);
  });

  it("quotes Custom unlimited booking and payment caps above Enterprise", () => {
    const quote = quotePlanRate(entitlementsFromPlan("custom").limits, "custom");
    expect(quote.officialPkr).toBeNull();
    expect(quote.calculatedPkr).toBeGreaterThan(18000);
    expect(
      quote.rows
        .filter((row) => row.key.includes("party") || row.key.includes("vendor"))
        .every((row) => row.value == null),
    ).toBe(true);
  });

  it("raises the quote when party-side caps go above Pro", () => {
    const pro = entitlementsFromPlan("pro").limits;
    const raised = quotePlanRate({ ...pro, bookings_per_party: 400, payments_per_party: 1000 }, "custom");
    expect(raised.calculatedPkr).toBeGreaterThan(8000);
    expect(raised.calculatedPkr).toBeLessThan(18000);
  });

  it("quotes fully unlimited Custom at Rs 28,000 / 3 months", () => {
    const quote = quotePlanRate(entitlementsFromPlan("custom").limits, "custom");
    expect(quote.calculatedPkr).toBe(28000);
    expect(quote.progress).toBeCloseTo(2, 5);
    expect(formatPlanPkr(quote.calculatedPkr)).toBe("Rs 28,000");
  });

  it("keeps Pro and Enterprise official rates after rounding", () => {
    expect(roundPlanPkr(8000)).toBe(8000);
    expect(roundPlanPkr(18000)).toBe(18000);
    expect(roundPlanPkr(-100)).toBe(0);
  });

  it("still shows the official Enterprise rate if Master raised a cap", () => {
    const enterprise = entitlementsFromPlan("enterprise").limits;
    const quote = quotePlanRate({ ...enterprise, parties: 1200 }, "enterprise");
    expect(quote.officialPkr).toBe(18000);
    expect(quote.calculatedPkr).toBeGreaterThan(18000);
  });
});
