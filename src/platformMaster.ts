import { supabaseMaster } from "./supabaseClient";
import {
  CompanyEntitlements,
  MasterCompanyRow,
  CompanyStatus,
  SegmentKey,
  normalizeEntitlements,
} from "./companyEntitlements";

export async function isPlatformMaster(): Promise<boolean> {
  const { data, error } = await supabaseMaster.rpc("master_is_platform_admin");
  if (error) {
    console.warn("master_is_platform_admin failed", error.message);
    return false;
  }
  return Boolean(data);
}

export async function listCompaniesForMaster(): Promise<MasterCompanyRow[]> {
  const { data, error } = await supabaseMaster.rpc("master_list_companies");
  if (error) throw new Error(error.message || "Could not load companies.");
  const rows = Array.isArray(data) ? data : [];
  return rows.map((row) => {
    const item = row as Record<string, unknown>;
    return {
      id: String(item.id || ""),
      company_code: String(item.company_code || ""),
      name: String(item.name || ""),
      email: String(item.email || ""),
      phone: String(item.phone || ""),
      status: String(item.status || ""),
      entitlements: normalizeEntitlements(item.entitlements),
      access_ends_at: item.access_ends_at ? String(item.access_ends_at) : null,
      created_at: String(item.created_at || ""),
      updated_at: String(item.updated_at || ""),
    };
  });
}

export async function setCompanyStatusForMaster(companyId: string, status: CompanyStatus) {
  const { data, error } = await supabaseMaster.rpc("master_set_company_status", {
    p_company_id: companyId,
    p_status: status,
  });
  if (error) throw new Error(error.message || "Could not update company status.");
  return data;
}

export async function setCompanyEntitlementsForMaster(companyId: string, entitlements: CompanyEntitlements) {
  const { data, error } = await supabaseMaster.rpc("master_set_company_entitlements", {
    p_company_id: companyId,
    p_entitlements: entitlements,
  });
  if (error) throw new Error(error.message || "Could not update entitlements.");
  return data;
}

export type WipeCompanyResult = {
  company_id: string;
  company_code: string;
  company_name: string;
  users_removed: number;
  auth_users_removed: number;
};

/** Permanently deletes a company and all related cloud data (Master only). */
export async function wipeCompanyForMaster(companyId: string): Promise<WipeCompanyResult> {
  const { data, error } = await supabaseMaster.rpc("master_wipe_company", {
    p_company_id: companyId,
  });
  if (error) throw new Error(error.message || "Could not delete company data.");
  const row = (data || {}) as Record<string, unknown>;
  return {
    company_id: String(row.company_id || companyId),
    company_code: String(row.company_code || ""),
    company_name: String(row.company_name || ""),
    users_removed: Number(row.users_removed || 0),
    auth_users_removed: Number(row.auth_users_removed || 0),
  };
}

export type MasterCompanyUsage = {
  parties: number;
  vendors: number;
  staff_users: number;
  payments_active: number;
  bookings_active_total: number;
  bookings_by_segment: Record<SegmentKey, number>;
  last_user_login_at: string;
};

function asCount(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
}

export async function getCompanyUsageForMaster(companyId: string): Promise<MasterCompanyUsage> {
  const { data, error } = await supabaseMaster.rpc("master_company_usage", {
    p_company_id: companyId,
  });
  if (error) throw new Error(error.message || "Could not load company usage.");
  const row = (data || {}) as Record<string, unknown>;
  const segmentsRaw =
    row.bookings_by_segment && typeof row.bookings_by_segment === "object"
      ? (row.bookings_by_segment as Record<string, unknown>)
      : {};
  return {
    parties: asCount(row.parties),
    vendors: asCount(row.vendors),
    staff_users: asCount(row.staff_users),
    payments_active: asCount(row.payments_active),
    bookings_active_total: asCount(row.bookings_active_total),
    bookings_by_segment: {
      PACKAGE: asCount(segmentsRaw.PACKAGE),
      TICKET: asCount(segmentsRaw.TICKET),
      HOTEL: asCount(segmentsRaw.HOTEL),
      VISA: asCount(segmentsRaw.VISA),
      TRANSPORT: asCount(segmentsRaw.TRANSPORT),
      MISC: asCount(segmentsRaw.MISC),
    },
    last_user_login_at: String(row.last_user_login_at || ""),
  };
}

export type MasterAuditRow = {
  id: string;
  actor_email: string;
  action: string;
  company_id: string;
  company_code: string;
  details: Record<string, unknown>;
  created_at: string;
};

export async function listCompanyAuditForMaster(companyId: string, limit = 40): Promise<MasterAuditRow[]> {
  const { data, error } = await supabaseMaster.rpc("master_list_company_audit", {
    p_company_id: companyId,
    p_limit: limit,
  });
  if (error) throw new Error(error.message || "Could not load audit trail.");
  const rows = Array.isArray(data) ? data : [];
  return rows.map((row) => {
    const item = row as Record<string, unknown>;
    const details = item.details && typeof item.details === "object" ? (item.details as Record<string, unknown>) : {};
    return {
      id: String(item.id || ""),
      actor_email: String(item.actor_email || ""),
      action: String(item.action || ""),
      company_id: String(item.company_id || ""),
      company_code: String(item.company_code || ""),
      details,
      created_at: String(item.created_at || ""),
    };
  });
}

export async function extendCompanyAccessForMaster(companyId: string, days: number) {
  const { data, error } = await supabaseMaster.rpc("master_extend_company_access", {
    p_company_id: companyId,
    p_days: Math.max(1, Math.floor(days || 30)),
  });
  if (error) throw new Error(error.message || "Could not extend access.");
  return data;
}

export async function setCompanyAccessEndsAtForMaster(companyId: string, accessEndsAt: string | null) {
  const { data, error } = await supabaseMaster.rpc("master_set_company_access_ends_at", {
    p_company_id: companyId,
    p_access_ends_at: accessEndsAt,
  });
  if (error) throw new Error(error.message || "Could not update access end date.");
  return data;
}

export const MASTER_BULK_LIMIT = 50;

export type MasterBulkAction = "APPROVE" | "SUSPEND" | "APPLY_PLAN" | "EXTEND";

export type MasterBulkResult = {
  action: MasterBulkAction;
  updated: number;
  skipped: number;
  errors: string[];
};

/** Runs existing Master RPCs one company at a time. No wipe. */
export async function bulkCompaniesForMaster(input: {
  companyIds: string[];
  action: MasterBulkAction;
  entitlements?: CompanyEntitlements;
  days?: number;
}): Promise<MasterBulkResult> {
  const ids = [...new Set(input.companyIds.map((id) => id.trim()).filter(Boolean))];
  if (!ids.length) throw new Error("Select at least one company.");
  if (ids.length > MASTER_BULK_LIMIT) {
    throw new Error(`Bulk actions are limited to ${MASTER_BULK_LIMIT} companies at a time.`);
  }
  if (input.action === "APPLY_PLAN" && !input.entitlements) {
    throw new Error("Choose a plan to apply.");
  }

  const days = Math.max(1, Math.floor(input.days || 30));
  let updated = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const companyId of ids) {
    try {
      if (input.action === "APPROVE") {
        await setCompanyStatusForMaster(companyId, "ACTIVE");
      } else if (input.action === "SUSPEND") {
        await setCompanyStatusForMaster(companyId, "SUSPENDED");
      } else if (input.action === "APPLY_PLAN") {
        await setCompanyEntitlementsForMaster(companyId, input.entitlements!);
      } else {
        await extendCompanyAccessForMaster(companyId, days);
      }
      updated += 1;
    } catch (err) {
      skipped += 1;
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }

  return { action: input.action, updated, skipped, errors };
}
