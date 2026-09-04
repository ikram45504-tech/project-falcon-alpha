export type SegmentKey = "PACKAGE" | "TICKET" | "HOTEL" | "VISA" | "TRANSPORT" | "MISC";

export type EntitlementPlanId = "free" | "pro" | "enterprise" | "custom";

export type CompanyEntitlements = {
  /** Set when Master assigns a named plan. Used as the floor source. */
  planId?: EntitlementPlanId;
  segments: Record<SegmentKey, boolean>;
  features: {
    booking_adjustments: boolean;
    statements: boolean;
    /** When false, Print view is shown greyed (upgrade later). */
    statement_print: boolean;
    pnl: boolean;
    /** When false, View Receipt is shown greyed (upgrade later). */
    payment_receipts: boolean;
    /** When false, Additional Booking Details stays greyed (upgrade later). */
    additional_booking_details: boolean;
  };
  limits: {
    bookings_per_party: number | null;
    bookings_per_vendor: number | null;
    payments_per_party: number | null;
    payments_per_vendor: number | null;
    parties: number | null;
    vendors: number | null;
    staff_users: number | null;
    staff_per_role: number | null;
    adjustment_revisions: number | null;
    corrections: number | null;
  };
};

export const DEFAULT_COMPANY_ENTITLEMENTS: CompanyEntitlements = {
  segments: {
    PACKAGE: true,
    TICKET: true,
    HOTEL: true,
    VISA: true,
    TRANSPORT: true,
    MISC: true,
  },
  features: {
    booking_adjustments: true,
    statements: true,
    statement_print: true,
    pnl: true,
    payment_receipts: true,
    additional_booking_details: true,
  },
  limits: {
    bookings_per_party: null,
    bookings_per_vendor: null,
    payments_per_party: null,
    payments_per_vendor: null,
    parties: null,
    vendors: null,
    staff_users: null,
    staff_per_role: null,
    adjustment_revisions: null,
    corrections: null,
  },
};

/**
 * Named company plans for Master Control Panel.
 * Numeric limits are minimum floors — Master can raise them per company, not lower them.
 */
export type EntitlementPlan = {
  id: EntitlementPlanId;
  label: string;
  description: string;
  details?: string;
  commercialNotes?: string;
  trialDays: number | null;
  pricePkr: number | null;
  pricePeriodMonths: number | null;
  entitlements: CompanyEntitlements;
};

function cloneEntitlements(value: CompanyEntitlements): CompanyEntitlements {
  return {
    planId: value.planId,
    segments: { ...value.segments },
    features: { ...value.features },
    limits: { ...value.limits },
  };
}

const FREE_ENTITLEMENTS: CompanyEntitlements = {
  segments: {
    PACKAGE: true,
    TICKET: true,
    HOTEL: true,
    VISA: true,
    TRANSPORT: true,
    MISC: false,
  },
  features: {
    booking_adjustments: false,
    statements: true,
    statement_print: false,
    pnl: false,
    payment_receipts: false,
    additional_booking_details: false,
  },
  limits: {
    bookings_per_party: 10,
    bookings_per_vendor: 30,
    payments_per_party: 10,
    payments_per_vendor: 30,
    parties: 30,
    vendors: 10,
    staff_users: 0,
    staff_per_role: null,
    adjustment_revisions: 0,
    corrections: 0,
  },
};

const PRO_ENTITLEMENTS: CompanyEntitlements = {
  segments: {
    PACKAGE: true,
    TICKET: true,
    HOTEL: true,
    VISA: true,
    TRANSPORT: true,
    MISC: true,
  },
  features: {
    booking_adjustments: true,
    statements: true,
    statement_print: true,
    pnl: true,
    payment_receipts: true,
    additional_booking_details: true,
  },
  limits: {
    bookings_per_party: 30,
    bookings_per_vendor: 100,
    payments_per_party: 30,
    payments_per_vendor: 300,
    parties: 200,
    vendors: 30,
    staff_users: 3,
    staff_per_role: null,
    adjustment_revisions: 3,
    corrections: 3,
  },
};

const ENTERPRISE_ENTITLEMENTS: CompanyEntitlements = {
  segments: {
    PACKAGE: true,
    TICKET: true,
    HOTEL: true,
    VISA: true,
    TRANSPORT: true,
    MISC: true,
  },
  features: {
    booking_adjustments: true,
    statements: true,
    statement_print: true,
    pnl: true,
    payment_receipts: true,
    additional_booking_details: true,
  },
  limits: {
    bookings_per_party: 400,
    bookings_per_vendor: 150,
    payments_per_party: 1000,
    payments_per_vendor: 400,
    parties: 800,
    vendors: 100,
    staff_users: 12,
    staff_per_role: null,
    adjustment_revisions: 10,
    corrections: 10,
  },
};

/** Named presets — Free, Pro, and Enterprise are locked floors; Custom starts open. */
export const ENTITLEMENT_PLANS: EntitlementPlan[] = [
  {
    id: "free",
    label: "Free Tier",
    description: "5 segments · owner only · PDF statements only",
    details:
      "Package–Transport on; Misc off. No adjustments, receipts, print view, P&L, or additional booking details. 10 bookings and 10 payments per party; 30 bookings and 30 payments per vendor. 30 parties, 10 vendors. Team Staff (Employee): 0 (owner only). No trial.",
    commercialNotes: "Rs 0",
    trialDays: null,
    pricePkr: 0,
    pricePeriodMonths: null,
    entitlements: cloneEntitlements(FREE_ENTITLEMENTS),
  },
  {
    id: "pro",
    label: "Pro Tier",
    description: "All segments · 3 staff · Rs 8,000 / 3 months",
    details:
      "All 6 segments. Adjustments and corrections up to 3 each. Receipts on. Statement PDF + Print. P&L on. Additional booking details on. 30 bookings and 30 payments per party; 100 bookings and 300 payments per vendor. 200 parties, 30 vendors. Team Staff (Employee): 3. 30-day trial, then Rs 8,000 per 3 months.",
    commercialNotes: "Rs 8,000 / 3 months",
    trialDays: 30,
    pricePkr: 8000,
    pricePeriodMonths: 3,
    entitlements: cloneEntitlements(PRO_ENTITLEMENTS),
  },
  {
    id: "enterprise",
    label: "Enterprise Tier",
    description: "Party-heavy · 12 staff · Rs 18,000 / 3 months",
    details:
      "For agencies that serve other agents (those agents are parties). All 6 segments and features on. Party-side caps sit above vendor-side: 400 bookings and 1,000 payments per party; 150 bookings and 400 payments per vendor. 800 parties, 100 vendors. Team Staff (Employee): 12. Adjustments and corrections up to 10 each. 30-day trial, then Rs 18,000 per 3 months.",
    commercialNotes: "Rs 18,000 / 3 months",
    trialDays: 30,
    pricePkr: 18000,
    pricePeriodMonths: 3,
    entitlements: cloneEntitlements(ENTERPRISE_ENTITLEMENTS),
  },
  {
    id: "custom",
    label: "Custom Tier",
    description: "All features on · bookings & payments unlimited",
    details:
      "All segments and features start on. Bookings and payments per party and per vendor start unlimited. Other caps start blank (unlimited) so Master can type a package. The Rate box below quotes a 3-month price from the Pro and Enterprise rates as you enter limits.",
    commercialNotes: "Quoted from calculator",
    trialDays: null,
    pricePkr: null,
    pricePeriodMonths: 3,
    entitlements: cloneEntitlements(DEFAULT_COMPANY_ENTITLEMENTS),
  },
];

export function getEntitlementPlan(id: EntitlementPlanId): EntitlementPlan | undefined {
  return ENTITLEMENT_PLANS.find((plan) => plan.id === id);
}

export function entitlementsFromPlan(id: EntitlementPlanId): CompanyEntitlements {
  const plan = getEntitlementPlan(id);
  if (!plan) return cloneEntitlements(DEFAULT_COMPANY_ENTITLEMENTS);
  return { ...cloneEntitlements(plan.entitlements), planId: id };
}

export function isFloorLockedPlan(id: EntitlementPlanId | "" | undefined): id is "free" | "pro" | "enterprise" {
  return id === "free" || id === "pro" || id === "enterprise";
}

export function isPaidEntitlementPlan(id: EntitlementPlanId | "" | undefined): id is "pro" | "enterprise" | "custom" {
  return id === "pro" || id === "enterprise" || id === "custom";
}

export const ADDITIONAL_BOOKING_DETAILS_UPGRADE =
  "Additional booking details are not included on Free Tier. Upgrade plans will be offered here later.";

export function allowsAdditionalBookingDetails(entitlements: unknown) {
  return normalizeEntitlements(entitlements).features.additional_booking_details;
}

/** Minimum numeric floors for a plan. Master may raise these, not lower them. */
export function getPlanLimitFloors(id: EntitlementPlanId | ""): CompanyEntitlements["limits"] | null {
  if (!id) return null;
  const plan = getEntitlementPlan(id);
  return plan ? { ...plan.entitlements.limits } : null;
}

export function applyPlanFloors(draft: CompanyEntitlements, planId: EntitlementPlanId | ""): CompanyEntitlements {
  const plan = planId ? getEntitlementPlan(planId) : undefined;
  if (!plan) return cloneEntitlements(draft);
  const next = cloneEntitlements(draft);
  if (planId) next.planId = planId;
  if (!isFloorLockedPlan(planId)) return next;
  (Object.keys(plan.entitlements.segments) as SegmentKey[]).forEach((key) => {
    if (plan.entitlements.segments[key]) next.segments[key] = true;
  });
  (Object.keys(plan.entitlements.features) as Array<keyof CompanyEntitlements["features"]>).forEach((key) => {
    if (plan.entitlements.features[key]) next.features[key] = true;
  });
  (Object.keys(plan.entitlements.limits) as Array<keyof CompanyEntitlements["limits"]>).forEach((key) => {
    const floor = plan.entitlements.limits[key];
    const current = next.limits[key];
    if (floor != null && current != null && current < floor) next.limits[key] = floor;
  });
  return next;
}

export const SEGMENT_LABELS: Record<SegmentKey, string> = {
  PACKAGE: "Package",
  TICKET: "Ticket",
  HOTEL: "Hotel",
  VISA: "Visa",
  TRANSPORT: "Transport",
  MISC: "Misc",
};

export type MasterCompanyRow = {
  id: string;
  company_code: string;
  name: string;
  email: string;
  phone: string;
  status: "ACTIVE" | "PENDING_APPROVAL" | "SUSPENDED" | "INACTIVE" | string;
  entitlements: CompanyEntitlements;
  plan_id?: EntitlementPlanId | "";
  access_ends_at: string | null;
  created_at: string;
  updated_at: string;
};

export type CompanyStatus = "ACTIVE" | "PENDING_APPROVAL" | "SUSPENDED" | "INACTIVE";

function asBoolean(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback;
}

function asNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
}

function readLimit(
  limitsRaw: Record<string, unknown>,
  key: keyof CompanyEntitlements["limits"],
  preset: CompanyEntitlements | undefined,
) {
  if (key in limitsRaw) return asNullableNumber(limitsRaw[key]);
  return preset?.limits[key] ?? null;
}

export function normalizeEntitlements(raw: unknown): CompanyEntitlements {
  const source = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const segmentsRaw = (source.segments || {}) as Record<string, unknown>;
  const featuresRaw = (source.features || {}) as Record<string, unknown>;
  const limitsRaw = (source.limits || {}) as Record<string, unknown>;

  const planIdRaw = String(source.planId || "");
  const looksLikeLegacyFree =
    !planIdRaw &&
    featuresRaw.booking_adjustments === false &&
    featuresRaw.payment_receipts === false &&
    segmentsRaw.MISC === false;
  const planId: EntitlementPlanId | undefined =
    planIdRaw === "free" || planIdRaw === "pro" || planIdRaw === "enterprise" || planIdRaw === "custom"
      ? planIdRaw
      : looksLikeLegacyFree
        ? "free"
        : undefined;
  const preset = isFloorLockedPlan(planId) ? getEntitlementPlan(planId)?.entitlements : undefined;

  return {
    planId,
    segments: {
      PACKAGE: asBoolean(segmentsRaw.PACKAGE, true),
      TICKET: asBoolean(segmentsRaw.TICKET, true),
      HOTEL: asBoolean(segmentsRaw.HOTEL, true),
      VISA: asBoolean(segmentsRaw.VISA, true),
      TRANSPORT: asBoolean(segmentsRaw.TRANSPORT, true),
      MISC: asBoolean(segmentsRaw.MISC, true),
    },
    features: {
      booking_adjustments: asBoolean(featuresRaw.booking_adjustments, true),
      statements: asBoolean(featuresRaw.statements, true),
      statement_print: asBoolean(featuresRaw.statement_print, preset ? preset.features.statement_print : true),
      pnl: asBoolean(featuresRaw.pnl, true),
      payment_receipts: asBoolean(featuresRaw.payment_receipts, true),
      additional_booking_details: asBoolean(
        featuresRaw.additional_booking_details,
        preset ? preset.features.additional_booking_details : true,
      ),
    },
    limits: {
      bookings_per_party: readLimit(limitsRaw, "bookings_per_party", preset),
      bookings_per_vendor: readLimit(limitsRaw, "bookings_per_vendor", preset),
      payments_per_party: readLimit(limitsRaw, "payments_per_party", preset),
      payments_per_vendor: readLimit(limitsRaw, "payments_per_vendor", preset),
      parties: asNullableNumber(limitsRaw.parties),
      vendors: asNullableNumber(limitsRaw.vendors),
      staff_users:
        planId === "free" &&
        asNullableNumber(limitsRaw.staff_users) === 1 &&
        !("additional_booking_details" in featuresRaw)
          ? 0
          : asNullableNumber(limitsRaw.staff_users),
      staff_per_role: readLimit(limitsRaw, "staff_per_role", preset),
      adjustment_revisions: readLimit(limitsRaw, "adjustment_revisions", preset),
      corrections: readLimit(limitsRaw, "corrections", preset),
    },
  };
}

export function companyStatusLabel(status: string) {
  switch (String(status || "").toUpperCase()) {
    case "ACTIVE":
      return "Active";
    case "PENDING_APPROVAL":
      return "Pending approval";
    case "SUSPENDED":
      return "Suspended";
    case "INACTIVE":
      return "Inactive";
    default:
      return status || "Unknown";
  }
}

export function assertSegmentEnabled(entitlements: unknown, segment: SegmentKey) {
  const normalized = normalizeEntitlements(entitlements);
  if (!normalized.segments[segment]) {
    throw new Error(`${SEGMENT_LABELS[segment]} bookings are not enabled for this company.`);
  }
}

export function assertFeatureEnabled(
  entitlements: unknown,
  feature: keyof CompanyEntitlements["features"],
  label: string,
) {
  const normalized = normalizeEntitlements(entitlements);
  if (!normalized.features[feature]) {
    throw new Error(`${label} is not enabled for this company.`);
  }
}

export const CAPACITY_LIMIT_EVENT = "th-capacity-limit";

const LIMIT_UNIT: Record<keyof CompanyEntitlements["limits"], string> = {
  bookings_per_party: "booking",
  bookings_per_vendor: "booking",
  payments_per_party: "payment",
  payments_per_vendor: "payment",
  parties: "party",
  vendors: "vendor",
  staff_users: "team employee",
  staff_per_role: "team employee",
  adjustment_revisions: "revision",
  corrections: "correction",
};

export class CapacityLimitError extends Error {
  readonly limit: number;
  readonly currentCount: number;
  readonly label: string;

  constructor(label: string, limit: number, currentCount: number, unit: string) {
    super(
      `${label} limit is ${limit} and this account already has ${currentCount}. Existing records are kept. Delete a ${unit} first to add a new one.`,
    );
    this.name = "CapacityLimitError";
    this.limit = limit;
    this.currentCount = currentCount;
    this.label = label;
  }
}

export function assertWithinLimit(
  entitlements: unknown,
  limitKey: keyof CompanyEntitlements["limits"],
  currentCount: number,
  label: string,
) {
  const limit = normalizeEntitlements(entitlements).limits[limitKey];
  if (limit == null) return;
  if (currentCount >= limit) {
    const error = new CapacityLimitError(label, limit, currentCount, LIMIT_UNIT[limitKey] || "record");
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent(CAPACITY_LIMIT_EVENT, {
          detail: { title: "Limit exceeded", message: error.message },
        }),
      );
    }
    throw error;
  }
}
