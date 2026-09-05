import { normalizeEntitlements, type EntitlementPlanId } from "./companyEntitlements";
import type { UserRole } from "./permissions";

export type WorkspaceAccountKind = "Main Account" | "Staff Account";

const PLAN_CHIPS: Record<EntitlementPlanId, string> = {
  free: "Free Plan",
  pro: "Pro Plan",
  enterprise: "Enterprise Plan",
  custom: "Custom Plan",
};

/** Owner is the company Main Account; every other role is a Staff Account. */
export function workspaceAccountKind(role?: UserRole | string | null): WorkspaceAccountKind {
  return role === "OWNER" ? "Main Account" : "Staff Account";
}

/** Header login id: COMPANYCODE-username (e.g. IKR-ikram123). */
export function workspaceLoginId(companyCode?: string | null, username?: string | null): string {
  const code = String(companyCode || "")
    .trim()
    .toUpperCase();
  const user = String(username || "").trim();
  if (code && user) return `${code}-${user}`;
  return code || user;
}

/** Short plan name for the blue header chip. Empty when no named plan is set. */
export function workspacePlanChip(entitlements: unknown): string {
  const planId = normalizeEntitlements(entitlements).planId;
  return planId ? PLAN_CHIPS[planId] : "";
}
