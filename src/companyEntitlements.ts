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
