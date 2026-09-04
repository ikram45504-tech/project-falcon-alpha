import { supabase } from "./supabaseClient";
import { isOfflineOnlyBuild } from "./appMode";
import {
  SegmentKey,
  SEGMENT_LABELS,
  assertFeatureEnabled,
  assertSegmentEnabled,
  assertWithinLimit,
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
    .select("status, entitlements, access_ends_at")
    .eq("id", companyId)
    .maybeSingle();
  if (error || !data) return null;
  return {
    status: String(data.status || "").toUpperCase(),
    entitlements: normalizeEntitlements(data.entitlements),
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
  if (access.status !== "ACTIVE") {
    throw new Error("This company is not active. Workspace changes are blocked until approval.");
  }
  const days = accessDaysRemaining(access.access_ends_at);
  if (days != null && days < 0) {
    throw new Error("This company access period has ended. Contact Travel Hisab support.");
  }
}

export async function enforceSegmentCreate(companyId: string, segment: SegmentKey) {
  await enforceCompanyActive(companyId);
  const access = await loadCompanyAccess(companyId);
  if (!access) return;
  assertSegmentEnabled(access.entitlements, segment);

  const limit = access.entitlements.limits.bookings_per_segment;
  if (limit == null) return;

  const tableBySegment: Record<SegmentKey, string> = {
    PACKAGE: "package_bookings",
    TICKET: "ticket_bookings",
    HOTEL: "hotel_bookings",
    VISA: "visa_bookings",
    TRANSPORT: "transport_bookings",
    MISC: "misc_bookings",
  };
  const table = tableBySegment[segment];
  const { count, error } = await supabase
    .from(table)
    .select("id", { count: "exact", head: true })
    .eq("company_id", companyId);
  if (error) {
    console.warn("booking limit count failed", error.message);
    return;
  }
  assertWithinLimit(access.entitlements, "bookings_per_segment", count || 0, `${SEGMENT_LABELS[segment]} bookings`);
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

export async function enforceStaffCreate(companyId: string) {
  await enforceCompanyActive(companyId);
  const access = await loadCompanyAccess(companyId);
  if (!access) return;
  const { count, error } = await supabase
    .from("users")
    .select("id", { count: "exact", head: true })
    .eq("company_id", companyId);
  if (error) {
    console.warn("staff limit count failed", error.message);
    return;
  }
  // Count includes owner; limit is total staff_users seats if set.
  assertWithinLimit(access.entitlements, "staff_users", count || 0, "Staff users");
}

export async function enforceFeature(companyId: string, feature: keyof CompanyEntitlements["features"], label: string) {
  const access = await loadCompanyAccess(companyId);
  if (!access) return;
  assertFeatureEnabled(access.entitlements, feature, label);
}
