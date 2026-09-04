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

async function loadCompanyAccess(companyId: string): Promise<{
  status: string;
  entitlements: CompanyEntitlements;
} | null> {
  if (isOfflineOnlyBuild()) return null;
  const { data, error } = await supabase
    .from("companies")
    .select("status, entitlements")
    .eq("id", companyId)
    .maybeSingle();
  if (error || !data) return null;
  return {
    status: String(data.status || "").toUpperCase(),
    entitlements: normalizeEntitlements(data.entitlements),
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
  const access = await loadCompanyAccess(companyId);
  if (!access) return;
  if (access.status !== "ACTIVE") {
    throw new Error("This company is not active. Workspace changes are blocked until approval.");
  }
}

export async function enforceSegmentCreate(companyId: string, segment: SegmentKey) {
  const access = await loadCompanyAccess(companyId);
  if (!access) return;
  if (access.status !== "ACTIVE") {
    throw new Error("This company is not active. Workspace changes are blocked until approval.");
  }
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
  const access = await loadCompanyAccess(companyId);
  if (!access) return;
  if (access.status !== "ACTIVE") {
    throw new Error("This company is not active. Workspace changes are blocked until approval.");
  }
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
  const access = await loadCompanyAccess(companyId);
  if (!access) return;
  if (access.status !== "ACTIVE") {
    throw new Error("This company is not active. Workspace changes are blocked until approval.");
  }
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
