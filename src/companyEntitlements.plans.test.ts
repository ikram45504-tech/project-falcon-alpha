import { describe, expect, it } from "vitest";
import { ENTITLEMENT_PLANS, entitlementsFromPlan, normalizeEntitlements } from "./companyEntitlements";

describe("entitlement plans", () => {
  it("defines starter, standard, and pro presets", () => {
    expect(ENTITLEMENT_PLANS.map((plan) => plan.id)).toEqual(["starter", "standard", "pro"]);
  });

  it("returns cloned entitlements so plans are not mutated via draft edits", () => {
    const first = entitlementsFromPlan("starter");
    first.segments.VISA = true;
    first.limits.parties = 999;
    const second = entitlementsFromPlan("starter");
    expect(second.segments.VISA).toBe(false);
    expect(second.limits.parties).toBe(70);
  });

  it("normalizes plan entitlements shape", () => {
    const pro = entitlementsFromPlan("pro");
    expect(normalizeEntitlements(pro).features.pnl).toBe(true);
    expect(normalizeEntitlements(pro).limits.bookings_per_segment).toBeNull();
  });
});
