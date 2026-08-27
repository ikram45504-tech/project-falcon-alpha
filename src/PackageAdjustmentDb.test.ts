import { describe, expect, it } from "vitest";
import { calculatePackageSummary, packageAdjustmentEffectiveTotal } from "./pricingEngines";

describe("Package commercial + adjustment totals stay in lockstep", () => {
  it("matches the live UB-1144 commercial header from passenger rows", () => {
    const summary = calculatePackageSummary([
      {
        passengerType: "ADULT",
        passengerName: "FARMAN SHAH",
        packageType: "15 Days Umrah Package",
        rate: "250000",
        count: "3",
      },
      {
        passengerType: "CHILD",
        passengerName: "FARMAN SHAH KIDS",
        packageType: "15 Days Umrah Package",
        rate: "180000",
        count: "2",
      },
      {
        passengerType: "INFANT",
        passengerName: "FARMAN SHAH INFANTS",
        packageType: "15 Days Umrah Package",
        rate: "75000",
        count: "2",
      },
    ]);
    expect(summary.qty).toEqual({ ADULT: 3, CHILD: 2, INFANT: 2 });
    expect(summary.totalPax).toBe(7);
    expect(summary.grandTotal).toBe(1260000);
  });

  it("carries prior amendment charges when the package mix changes", () => {
    const nextTotal = packageAdjustmentEffectiveTotal({
      previousTotal: 1260000,
      previousBase: 1260000,
      revisedBase: 1010000,
      charge: 15000,
      credit: 0,
    });
    expect(nextTotal).toBe(1025000);
  });

  it("keeps a previous amendment charge after a later correction", () => {
    const nextTotal = packageAdjustmentEffectiveTotal({
      previousTotal: 1275000,
      previousBase: 1260000,
      revisedBase: 1260000,
      charge: 0,
      credit: 0,
    });
    expect(nextTotal).toBe(1275000);
  });

  it("rejects a credit that would make the booking negative at the caller", () => {
    const nextTotal = packageAdjustmentEffectiveTotal({
      previousTotal: 1260000,
      previousBase: 1260000,
      revisedBase: 0,
      charge: 0,
      credit: 1260001,
    });
    expect(nextTotal).toBeLessThan(0);
  });
});
