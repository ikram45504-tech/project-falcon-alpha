import { supabase } from "./supabaseClient";
import { isOfflineOnlyBuild } from "./appMode";
import { COMPANY_REVOKED_MESSAGE, assertCompanyAllowsWrites, isCompanyRevoked } from "./companyStatus";
import {
  SegmentKey,
  assertFeatureEnabled,
  assertSegmentEnabled,
  assertWithinLimit,
  asEntitlementPlanId,
  normalizeEntitlements,
  type CompanyEntitlements,
} from "./companyEntitlements";

/** Show agency warning when access ends within this many days (inclusive). */
export const ACCESS_EXPIRY_BANNER_DAYS = 7;

async function loadCompanyAccess(companyId: string): Promise<{
  status: string;
  entitlements: CompanyEntitlements;
  access_ends_at: string | null;
} | null> {
  if (isOfflineOnlyBuild()) return null;
  const { data, error } = await supabase
    .from("companies")
    .select("status, entitlements, access_ends_at, plan_id")
    .eq("id", companyId)
    .maybeSingle();
  if (error || !data) return null;
  const planId = asEntitlementPlanId((data as { plan_id?: unknown }).plan_id);
  return {
    status: String(data.status || "").toUpperCase(),
    entitlements: normalizeEntitlements(data.entitlements, planId),
    access_ends_at: data.access_ends_at ? String(data.access_ends_at) : null,
  };
}

/** Whole days remaining until access_ends_at. null = no expiry set. */
export function accessDaysRemaining(accessEndsAt: string | null | undefined): number | null {
  if (!accessEndsAt) return null;
  const ends = Date.parse(accessEndsAt);
  if (!Number.isFinite(ends)) return null;
  return Math.ceil((ends - Date.now()) / 86_400_000);
}

export function shouldShowAccessExpiryBanner(accessEndsAt: string | null | undefined): boolean {
  const days = accessDaysRemaining(accessEndsAt);
  return days != null && days >= 0 && days <= ACCESS_EXPIRY_BANNER_DAYS;
}

export function formatAccessEndsAt(accessEndsAt: string | null | undefined): string {
  if (!accessEndsAt) return "No expiry";
  const parsed = Date.parse(accessEndsAt);
  if (!Number.isFinite(parsed)) return accessEndsAt;
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(parsed));
}

/** Suspend company when access_ends_at has passed. Returns new status if changed. */
export async function applyCompanyAccessExpiry(companyId: string): Promise<{
  changed: boolean;
  status: string;
  access_ends_at: string | null;
} | null> {
  if (isOfflineOnlyBuild()) return null;
  const { data, error } = await supabase.rpc("apply_company_access_expiry", {
    p_company_id: companyId,
  });
  if (error) {
    console.warn("apply_company_access_expiry failed", error.message);
    return null;
  }
  const row = (data || {}) as Record<string, unknown>;
  return {
    changed: Boolean(row.changed),
    status: String(row.status || "").toUpperCase(),
    access_ends_at: row.access_ends_at ? String(row.access_ends_at) : null,
  };
}

export async function assertEmailNotReservedForMaster(email: string) {
  if (isOfflineOnlyBuild()) return;
  const { data, error } = await supabase.rpc("is_reserved_platform_email", {
    p_email: email.trim(),
  });
  if (error) {
    console.warn("is_reserved_platform_email failed", error.message);
    return;
  }
  if (data) {
    throw new Error("This email is reserved for the Control Panel Master account. Use a different company email.");
  }
}

export async function enforceCompanyActive(companyId: string) {
  await applyCompanyAccessExpiry(companyId);
  const access = await loadCompanyAccess(companyId);
  if (!access) return;
  if (isCompanyRevoked(access.status)) {
    throw new Error(COMPANY_REVOKED_MESSAGE);
  }
  assertCompanyAllowsWrites(access.status);
  if (access.status !== "ACTIVE") {
    throw new Error("This company is not active. Workspace changes are blocked until approval.");
  }
  const days = accessDaysRemaining(access.access_ends_at);
  if (days != null && days < 0) {
    throw new Error("This company access period has ended. Contact Travel Hisab support.");
  }
}

const BOOKING_TABLES: Record<SegmentKey, string> = {
  PACKAGE: "package_bookings",
  TICKET: "ticket_bookings",
  HOTEL: "hotel_bookings",
  VISA: "visa_bookings",
  TRANSPORT: "transport_bookings",
  MISC: "misc_bookings",
};

async function countActiveBookingsForCounterparty(
  companyId: string,
  counterpartyId: string,
  transactionType: "SALE" | "PURCHASE",
) {
  const results = await Promise.all(
    Object.values(BOOKING_TABLES).map((table) =>
      supabase
        .from(table)
        .select("id", { count: "exact", head: true })
        .eq("company_id", companyId)
        .eq("counterparty_id", counterpartyId)
        .eq("transaction_type", transactionType)
        .eq("status", "ACTIVE"),
    ),
  );
  let total = 0;
  for (const result of results) {
    if (result.error) {
      console.warn("booking limit count failed", result.error.message);
      return null;
    }
    total += result.count || 0;
  }
  return total;
}

export async function enforceSegmentCreate(
  companyId: string,
  segment: SegmentKey,
  context?: { transactionType?: "SALE" | "PURCHASE"; counterpartyId?: string },
) {
  await enforceCompanyActive(companyId);
  const access = await loadCompanyAccess(companyId);
  if (!access) return;
  assertSegmentEnabled(access.entitlements, segment);

  const transactionType = context?.transactionType;
  const counterpartyId = context?.counterpartyId?.trim();
  if (!transactionType || !counterpartyId) return;

  const limitKey = transactionType === "SALE" ? "bookings_per_party" : "bookings_per_vendor";
  if (access.entitlements.limits[limitKey] == null) return;

  const count = await countActiveBookingsForCounterparty(companyId, counterpartyId, transactionType);
  if (count == null) return;
  assertWithinLimit(
    access.entitlements,
    limitKey,
    count,
    transactionType === "SALE" ? "Bookings per party" : "Bookings per vendor",
  );
}

export async function enforcePaymentCreate(
  companyId: string,
  partyId: string,
  accountType: "PARTY" | "VENDOR" | string,
) {
  await enforceCompanyActive(companyId);
  const access = await loadCompanyAccess(companyId);
  if (!access) return;
  const limitKey = accountType === "VENDOR" ? "payments_per_vendor" : "payments_per_party";
  if (access.entitlements.limits[limitKey] == null) return;

  const { count, error } = await supabase
    .from("payment_entries")
    .select("id", { count: "exact", head: true })
    .eq("company_id", companyId)
    .eq("party_id", partyId)
    .eq("status", "ACTIVE");
  if (error) {
    console.warn("payment limit count failed", error.message);
    return;
  }
  assertWithinLimit(
    access.entitlements,
    limitKey,
    count || 0,
    accountType === "VENDOR" ? "Payments per vendor" : "Payments per party",
  );
}

export async function enforceBookingAdjustmentCreate(
  companyId: string,
  tableName: string,
  bookingId: string,
  adjustmentType: string,
) {
  await enforceCompanyActive(companyId);
  const access = await loadCompanyAccess(companyId);
  if (!access) return;
  assertFeatureEnabled(access.entitlements, "booking_adjustments", "Booking adjustments");

  const isCorrection = adjustmentType === "CORRECTION";
  const limitKey = isCorrection ? "corrections" : "adjustment_revisions";
  let query = supabase
    .from(tableName)
    .select("id", { count: "exact", head: true })
    .eq("company_id", companyId)
    .eq("booking_id", bookingId);
  query = isCorrection ? query.eq("adjustment_type", "CORRECTION") : query.neq("adjustment_type", "CORRECTION");
  const { count, error } = await query;
  if (error) {
    console.warn("adjustment limit count failed", error.message);
    return;
  }
  assertWithinLimit(
    access.entitlements,
    limitKey,
    count || 0,
    isCorrection ? "Booking corrections" : "Booking adjustment revisions",
  );
}

export async function enforcePaymentCorrectionCreate(companyId: string, paymentId: string) {
  await enforceCompanyActive(companyId);
  const access = await loadCompanyAccess(companyId);
  if (!access) return;
  const { count, error } = await supabase
    .from("payment_corrections")
    .select("id", { count: "exact", head: true })
    .eq("company_id", companyId)
    .eq("payment_id", paymentId)
    .eq("action", "CORRECTION");
  if (error) {
    console.warn("payment correction limit count failed", error.message);
    return;
  }
  assertWithinLimit(access.entitlements, "corrections", count || 0, "Payment corrections");
}

export async function enforcePartyCreate(companyId: string, accountType: "PARTY" | "VENDOR" | "UNASSIGNED") {
  await enforceCompanyActive(companyId);
  const access = await loadCompanyAccess(companyId);
  if (!access) return;
  const limitKey = accountType === "VENDOR" ? "vendors" : "parties";
  const table = accountType === "VENDOR" ? "vendors" : accountType === "UNASSIGNED" ? "unassigned_accounts" : "parties";
  const label = accountType === "VENDOR" ? "Vendors" : "Parties";
  const { count, error } = await supabase
    .from(table)
    .select("id", { count: "exact", head: true })
    .eq("company_id", companyId);
  if (error) {
    console.warn("party limit count failed", error.message);
    return;
  }
  assertWithinLimit(access.entitlements, limitKey, count || 0, label);
}

export async function enforceStaffCreate(companyId: string, _role?: string) {
  await enforceCompanyActive(companyId);
  const access = await loadCompanyAccess(companyId);
  if (!access) return;
  const { count, error } = await supabase
    .from("users")
    .select("id", { count: "exact", head: true })
    .eq("company_id", companyId)
    .neq("role", "OWNER");
  if (error) {
    console.warn("staff limit count failed", error.message);
    return;
  }
  // Owner is not a team seat. staff_users is Team Staff (Employee) only.
  assertWithinLimit(access.entitlements, "staff_users", count || 0, "Team Staff (Employee)");
}

export async function enforceFeature(companyId: string, feature: keyof CompanyEntitlements["features"], label: string) {
  const access = await loadCompanyAccess(companyId);
  if (!access) return;
  assertFeatureEnabled(access.entitlements, feature, label);
}
