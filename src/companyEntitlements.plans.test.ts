import { describe, expect, it } from "vitest";
import {
  ENTITLEMENT_PLANS,
  applyPlanFloors,
  assertWithinLimit,
  CapacityLimitError,
  entitlementsFromPlan,
  isFloorLockedPlan,
  isPaidEntitlementPlan,
  normalizeEntitlements,
} from "./companyEntitlements";

describe("entitlement plans", () => {
  it("defines free, pro, enterprise, and custom tiers", () => {
    expect(ENTITLEMENT_PLANS.map((plan) => plan.id)).toEqual(["free", "pro", "enterprise", "custom"]);
    expect(ENTITLEMENT_PLANS.map((plan) => plan.label)).toEqual([
      "Free Tier",
      "Pro Tier",
      "Enterprise Tier",
      "Custom Tier",
    ]);
  });

  it("locks Free floors and clones so drafts cannot mutate the plan", () => {
    const first = entitlementsFromPlan("free");
    first.segments.MISC = true;
    first.limits.parties = 999;
    const second = entitlementsFromPlan("free");
    expect(second.planId).toBe("free");
    expect(second.segments.MISC).toBe(false);
    expect(second.features.statement_print).toBe(false);
    expect(second.features.booking_adjustments).toBe(false);
    expect(second.features.payment_receipts).toBe(false);
    expect(second.features.pnl).toBe(false);
    expect(second.features.additional_booking_details).toBe(false);
    expect(second.limits.bookings_per_party).toBe(10);
    expect(second.limits.bookings_per_vendor).toBe(30);
    expect(second.limits.payments_per_party).toBe(10);
    expect(second.limits.payments_per_vendor).toBe(30);
    expect(second.limits.parties).toBe(30);
    expect(second.limits.vendors).toBe(10);
    expect(second.limits.staff_users).toBe(0);
    expect(second.limits.adjustment_revisions).toBe(0);
    expect(second.limits.corrections).toBe(0);
  });

  it("locks Pro floors including trial and commercial notes", () => {
    const pro = entitlementsFromPlan("pro");
    const plan = ENTITLEMENT_PLANS.find((item) => item.id === "pro");
    expect(pro.planId).toBe("pro");
    expect(pro.segments.MISC).toBe(true);
    expect(pro.features.booking_adjustments).toBe(true);
    expect(pro.features.statement_print).toBe(true);
    expect(pro.features.pnl).toBe(true);
    expect(pro.features.payment_receipts).toBe(true);
    expect(pro.features.additional_booking_details).toBe(true);
    expect(pro.limits.bookings_per_party).toBe(30);
    expect(pro.limits.bookings_per_vendor).toBe(100);
    expect(pro.limits.payments_per_party).toBe(30);
    expect(pro.limits.payments_per_vendor).toBe(300);
    expect(pro.limits.parties).toBe(200);
    expect(pro.limits.vendors).toBe(30);
    expect(pro.limits.staff_users).toBe(3);
    expect(pro.limits.staff_per_role).toBeNull();
    expect(pro.limits.adjustment_revisions).toBe(3);
    expect(pro.limits.corrections).toBe(3);
    expect(plan?.trialDays).toBe(30);
    expect(plan?.commercialNotes).toMatch(/8,000/);
  });

  it("lets Master raise locked-plan values but not go below the floor", () => {
    const raised = applyPlanFloors(
      {
        ...entitlementsFromPlan("free"),
        segments: { ...entitlementsFromPlan("free").segments, MISC: true },
        limits: { ...entitlementsFromPlan("free").limits, parties: 80, bookings_per_party: 4 },
      },
      "free",
    );
    expect(raised.segments.MISC).toBe(true);
    expect(raised.segments.PACKAGE).toBe(true);
    expect(raised.limits.parties).toBe(80);
    expect(raised.limits.bookings_per_party).toBe(10);
    expect(raised.features.statements).toBe(true);

    const enterpriseRaised = applyPlanFloors(
      {
        ...entitlementsFromPlan("enterprise"),
        limits: { ...entitlementsFromPlan("enterprise").limits, staff_users: 4, parties: 1200 },
      },
      "enterprise",
    );
    expect(enterpriseRaised.limits.staff_users).toBe(12);
    expect(enterpriseRaised.limits.parties).toBe(1200);
  });

  it("fills new Free floors on legacy Free JSON that has no planId", () => {
    const normalized = normalizeEntitlements({
      segments: { PACKAGE: true, TICKET: true, HOTEL: true, VISA: true, TRANSPORT: true, MISC: false },
      features: { booking_adjustments: false, statements: true, pnl: false, payment_receipts: false },
      limits: { bookings_per_segment: 50, parties: 30, vendors: 10, staff_users: 1 },
    });
    expect(normalized.planId).toBe("free");
    expect(normalized.features.statement_print).toBe(false);
    expect(normalized.features.additional_booking_details).toBe(false);
    expect(normalized.limits.bookings_per_party).toBe(10);
    expect(normalized.limits.payments_per_vendor).toBe(30);
    expect(normalized.limits.parties).toBe(30);
    expect(normalized.limits.staff_users).toBe(0);
  });

  it("keeps existing records and asks to delete before adding over a reduced cap", () => {
    const free = entitlementsFromPlan("free");
    expect(() => assertWithinLimit(free, "bookings_per_party", 10, "Bookings per party")).toThrow(CapacityLimitError);
    try {
      assertWithinLimit(free, "payments_per_vendor", 30, "Payments per vendor");
    } catch (error) {
      expect(error).toBeInstanceOf(CapacityLimitError);
      expect(String(error)).toMatch(/Existing records are kept/);
      expect(String(error)).toMatch(/Delete a payment first/);
    }
  });

  it("locks Enterprise floors and 3-month price", () => {
    const enterprise = entitlementsFromPlan("enterprise");
    const plan = ENTITLEMENT_PLANS.find((item) => item.id === "enterprise");
    expect(enterprise.planId).toBe("enterprise");
    expect(enterprise.segments.MISC).toBe(true);
    expect(enterprise.features.additional_booking_details).toBe(true);
    expect(enterprise.limits.bookings_per_party).toBe(400);
    expect(enterprise.limits.bookings_per_vendor).toBe(150);
    expect(enterprise.limits.payments_per_party).toBe(1000);
    expect(enterprise.limits.payments_per_vendor).toBe(400);
    expect(enterprise.limits.bookings_per_party).toBeGreaterThan(enterprise.limits.bookings_per_vendor!);
    expect(enterprise.limits.payments_per_party).toBeGreaterThan(enterprise.limits.payments_per_vendor!);
    expect(enterprise.limits.parties).toBe(800);
    expect(enterprise.limits.vendors).toBe(100);
    expect(enterprise.limits.staff_users).toBe(12);
    expect(enterprise.limits.adjustment_revisions).toBe(10);
    expect(enterprise.limits.corrections).toBe(10);
    expect(plan?.trialDays).toBe(30);
    expect(plan?.pricePkr).toBe(18000);
    expect(plan?.commercialNotes).toMatch(/18,000/);
  });

  it("opens Custom with all features and unlimited party/vendor bookings and payments", () => {
    const custom = entitlementsFromPlan("custom");
    expect(custom.planId).toBe("custom");
    expect(Object.values(custom.segments).every(Boolean)).toBe(true);
    expect(Object.values(custom.features).every(Boolean)).toBe(true);
    expect(custom.limits.bookings_per_party).toBeNull();
    expect(custom.limits.bookings_per_vendor).toBeNull();
    expect(custom.limits.payments_per_party).toBeNull();
    expect(custom.limits.payments_per_vendor).toBeNull();
  });

  it("normalizes plan entitlements shape", () => {
    const enterprise = entitlementsFromPlan("enterprise");
    expect(normalizeEntitlements(enterprise).features.pnl).toBe(true);
    expect(normalizeEntitlements(enterprise).limits.bookings_per_party).toBe(400);
    expect(normalizeEntitlements(enterprise).features.statement_print).toBe(true);

    const custom = entitlementsFromPlan("custom");
    expect(normalizeEntitlements(custom).segments.MISC).toBe(true);
    expect(normalizeEntitlements(custom).limits.bookings_per_party).toBeNull();
  });

  it("treats Free/Pro/Enterprise as locked floors and Pro/Enterprise/Custom as paid", () => {
    expect(isFloorLockedPlan("free")).toBe(true);
    expect(isFloorLockedPlan("pro")).toBe(true);
    expect(isFloorLockedPlan("enterprise")).toBe(true);
    expect(isFloorLockedPlan("custom")).toBe(false);
    expect(isPaidEntitlementPlan("free")).toBe(false);
    expect(isPaidEntitlementPlan("pro")).toBe(true);
    expect(isPaidEntitlementPlan("enterprise")).toBe(true);
    expect(isPaidEntitlementPlan("custom")).toBe(true);
  });

  it("lets Master turn Custom features off and leave booking limits blank", () => {
    const custom = applyPlanFloors(
      {
        ...entitlementsFromPlan("custom"),
        features: { ...entitlementsFromPlan("custom").features, pnl: false },
        limits: { ...entitlementsFromPlan("custom").limits, bookings_per_party: null, parties: 50 },
      },
      "custom",
    );
    expect(custom.features.pnl).toBe(false);
    expect(custom.limits.bookings_per_party).toBeNull();
    expect(custom.limits.parties).toBe(50);
  });
});
