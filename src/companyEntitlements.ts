export type SegmentKey = "PACKAGE" | "TICKET" | "HOTEL" | "VISA" | "TRANSPORT" | "MISC";

export type CompanyEntitlements = {
  segments: Record<SegmentKey, boolean>;
  features: {
    booking_adjustments: boolean;
    statements: boolean;
    pnl: boolean;
  };
  limits: {
    bookings_per_segment: number | null;
    parties: number | null;
    vendors: number | null;
    staff_users: number | null;
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
    pnl: true,
  },
  limits: {
    bookings_per_segment: null,
    parties: null,
    vendors: null,
    staff_users: null,
  },
};

export type EntitlementPlanId = "starter" | "standard" | "pro";

export type EntitlementPlan = {
  id: EntitlementPlanId;
  label: string;
  description: string;
  entitlements: CompanyEntitlements;
};

function cloneEntitlements(value: CompanyEntitlements): CompanyEntitlements {
  return {
    segments: { ...value.segments },
    features: { ...value.features },
    limits: { ...value.limits },
  };
}

/** Named capacity presets for Master Control Panel (Apply plan → still Save capacity). */
export const ENTITLEMENT_PLANS: EntitlementPlan[] = [
  {
    id: "starter",
    label: "Starter",
    description: "Package / Ticket / Hotel · adjustments + statements · capped seats",
    entitlements: {
      segments: {
        PACKAGE: true,
        TICKET: true,
        HOTEL: true,
        VISA: false,
        TRANSPORT: false,
        MISC: false,
      },
      features: {
        booking_adjustments: true,
        statements: true,
        pnl: false,
      },
      limits: {
        bookings_per_segment: 500,
        parties: 70,
        vendors: 10,
        staff_users: 3,
      },
    },
  },
  {
    id: "standard",
    label: "Standard",
    description: "All segments · adjustments + statements · mid limits",
    entitlements: {
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
        pnl: false,
      },
      limits: {
        bookings_per_segment: 1500,
        parties: 150,
        vendors: 30,
        staff_users: 8,
      },
    },
  },
  {
    id: "pro",
    label: "Pro",
    description: "All segments + P&L · high / unlimited caps",
    entitlements: {
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
        pnl: true,
      },
      limits: {
        bookings_per_segment: null,
        parties: null,
        vendors: null,
        staff_users: 25,
      },
    },
  },
];

export function getEntitlementPlan(id: EntitlementPlanId): EntitlementPlan | undefined {
  return ENTITLEMENT_PLANS.find((plan) => plan.id === id);
}

export function entitlementsFromPlan(id: EntitlementPlanId): CompanyEntitlements {
  const plan = getEntitlementPlan(id);
  if (!plan) return cloneEntitlements(DEFAULT_COMPANY_ENTITLEMENTS);
  return cloneEntitlements(plan.entitlements);
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

export function normalizeEntitlements(raw: unknown): CompanyEntitlements {
  const source = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const segmentsRaw = (source.segments || {}) as Record<string, unknown>;
  const featuresRaw = (source.features || {}) as Record<string, unknown>;
  const limitsRaw = (source.limits || {}) as Record<string, unknown>;

  return {
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
      pnl: asBoolean(featuresRaw.pnl, true),
    },
    limits: {
      bookings_per_segment: asNullableNumber(limitsRaw.bookings_per_segment),
      parties: asNullableNumber(limitsRaw.parties),
      vendors: asNullableNumber(limitsRaw.vendors),
      staff_users: asNullableNumber(limitsRaw.staff_users),
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

export function assertWithinLimit(
  entitlements: unknown,
  limitKey: keyof CompanyEntitlements["limits"],
  currentCount: number,
  label: string,
) {
  const limit = normalizeEntitlements(entitlements).limits[limitKey];
  if (limit == null) return;
  if (currentCount >= limit) {
    throw new Error(`${label} limit reached (${limit}). Ask SMC Softwares to increase capacity.`);
  }
}
