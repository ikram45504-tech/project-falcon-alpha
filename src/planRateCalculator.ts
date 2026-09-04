import { CompanyEntitlements, EntitlementPlanId, getEntitlementPlan } from "./companyEntitlements";

export type RateLimitKey =
  | "bookings_per_party"
  | "bookings_per_vendor"
  | "payments_per_party"
  | "payments_per_vendor"
  | "parties"
  | "vendors"
  | "staff_users"
  | "adjustment_revisions"
  | "corrections";

export const RATE_LIMIT_ROWS: Array<{ key: RateLimitKey; label: string }> = [
  { key: "bookings_per_party", label: "Bookings per party" },
  { key: "bookings_per_vendor", label: "Bookings per vendor" },
  { key: "payments_per_party", label: "Payments per party" },
  { key: "payments_per_vendor", label: "Payments per vendor" },
  { key: "parties", label: "Parties" },
  { key: "vendors", label: "Vendors" },
  { key: "staff_users", label: "Team Staff (Employee)" },
  { key: "adjustment_revisions", label: "Adjustment revisions" },
  { key: "corrections", label: "Corrections" },
];

/** Unlimited (blank) sits one full step past Enterprise, the same distance as Enterprise sits past Pro. */
export const UNLIMITED_RATE_PROGRESS = 2;

export type RateDimBreakdown = {
  key: RateLimitKey;
  label: string;
  value: number | null;
  pro: number;
  enterprise: number;
  /** 0 at Pro floors, 1 at Enterprise floors, 2 when unlimited. */
  progress: number;
  position: string;
};

export type PlanRateQuote = {
  officialPkr: number | null;
  calculatedPkr: number;
  periodMonths: number;
  proPricePkr: number;
  enterprisePricePkr: number;
  progress: number;
  rows: RateDimBreakdown[];
};

function requirePlanLimits(id: "pro" | "enterprise") {
  const plan = getEntitlementPlan(id);
  const limits = plan?.entitlements.limits;
  const pricePkr = plan?.pricePkr;
  if (!limits || pricePkr == null) {
    throw new Error(`${id} plan is missing a 3-month rate.`);
  }
  return { limits, pricePkr, periodMonths: plan.pricePeriodMonths || 3 };
}

function dimProgress(value: number | null, pro: number, enterprise: number): number {
  if (value == null) return UNLIMITED_RATE_PROGRESS;
  const span = enterprise - pro;
  if (span <= 0) return value <= pro ? 0 : (value - pro) / Math.max(pro, 1);
  return (value - pro) / span;
}

function positionLabel(value: number | null, progress: number): string {
  if (value == null) return "Unlimited";
  if (Math.abs(progress) < 0.02) return "At Pro";
  if (Math.abs(progress - 1) < 0.02) return "At Enterprise";
  if (progress < 0) return "Below Pro";
  if (progress < 1) return "Between";
  return "Above Enterprise";
}

export function roundPlanPkr(amount: number) {
  return Math.max(0, Math.round(amount / 500) * 500);
}

export function formatPlanPkr(amount: number) {
  return `Rs ${amount.toLocaleString("en-US")}`;
}

export function quotePlanRate(
  limits: CompanyEntitlements["limits"],
  planId: EntitlementPlanId | "" = "",
): PlanRateQuote {
  const pro = requirePlanLimits("pro");
  const enterprise = requirePlanLimits("enterprise");
  const rows = RATE_LIMIT_ROWS.map(({ key, label }) => {
    const proFloor = pro.limits[key];
    const enterpriseFloor = enterprise.limits[key];
    if (proFloor == null || enterpriseFloor == null) {
      throw new Error(`Missing ${key} floor on Pro or Enterprise.`);
    }
    const value = limits[key];
    const progress = dimProgress(value, proFloor, enterpriseFloor);
    return {
      key,
      label,
      value,
      pro: proFloor,
      enterprise: enterpriseFloor,
      progress,
      position: positionLabel(value, progress),
    };
  });
  const progress = rows.reduce((sum, row) => sum + row.progress, 0) / rows.length;
  const rawPkr = pro.pricePkr + progress * (enterprise.pricePkr - pro.pricePkr);
  const selected = planId ? getEntitlementPlan(planId) : undefined;

  return {
    officialPkr: selected?.pricePkr ?? null,
    calculatedPkr: roundPlanPkr(rawPkr),
    periodMonths: selected?.pricePeriodMonths || pro.periodMonths,
    proPricePkr: pro.pricePkr,
    enterprisePricePkr: enterprise.pricePkr,
    progress,
    rows,
  };
}
