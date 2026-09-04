import { supabase } from "./supabaseClient";
import { CompanyEntitlements, MasterCompanyRow, CompanyStatus, normalizeEntitlements } from "./companyEntitlements";

export async function isPlatformMaster(): Promise<boolean> {
  const { data, error } = await supabase.rpc("master_is_platform_admin");
  if (error) {
    console.warn("master_is_platform_admin failed", error.message);
    return false;
  }
  return Boolean(data);
}

export async function listCompaniesForMaster(): Promise<MasterCompanyRow[]> {
  const { data, error } = await supabase.rpc("master_list_companies");
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
      created_at: String(item.created_at || ""),
      updated_at: String(item.updated_at || ""),
    };
  });
}

export async function setCompanyStatusForMaster(companyId: string, status: CompanyStatus) {
  const { data, error } = await supabase.rpc("master_set_company_status", {
    p_company_id: companyId,
    p_status: status,
  });
  if (error) throw new Error(error.message || "Could not update company status.");
  return data;
}

export async function setCompanyEntitlementsForMaster(companyId: string, entitlements: CompanyEntitlements) {
  const { data, error } = await supabase.rpc("master_set_company_entitlements", {
    p_company_id: companyId,
    p_entitlements: entitlements,
  });
  if (error) throw new Error(error.message || "Could not update entitlements.");
  return data;
}
