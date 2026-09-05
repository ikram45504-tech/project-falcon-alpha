import { normalizeEntitlements, type CompanyEntitlements, type EntitlementPlanId } from "./companyEntitlements";

export const CONTROL_WORKSPACE_KEY = "th-control-workspace-v1";

export type ControlWorkspaceSnapshot = {
  selectedId: string;
  mainTab: "approved" | "pending";
  filter: "ALL" | "ACTIVE" | "SUSPENDED";
  planId: EntitlementPlanId | "";
  draft: CompanyEntitlements | null;
  createOpen: boolean;
};

export function emptyControlWorkspace(): ControlWorkspaceSnapshot {
  return {
    selectedId: "",
    mainTab: "approved",
    filter: "ALL",
    planId: "",
    draft: null,
    createOpen: false,
  };
}

function asPlanId(value: unknown): EntitlementPlanId | "" {
  return value === "free" || value === "pro" || value === "enterprise" || value === "custom" ? value : "";
}

export function parseControlWorkspace(raw: unknown): ControlWorkspaceSnapshot {
  const empty = emptyControlWorkspace();
  if (!raw || typeof raw !== "object") return empty;
  const source = raw as Record<string, unknown>;
  const mainTab = source.mainTab === "pending" ? "pending" : "approved";
  const filter = source.filter === "ACTIVE" || source.filter === "SUSPENDED" ? source.filter : "ALL";
  return {
    selectedId: String(source.selectedId || ""),
    mainTab,
    filter,
    planId: asPlanId(source.planId),
    draft: source.draft && typeof source.draft === "object" ? normalizeEntitlements(source.draft) : null,
    createOpen: source.createOpen === true,
  };
}

export function readControlWorkspace(): ControlWorkspaceSnapshot {
  if (typeof sessionStorage === "undefined") return emptyControlWorkspace();
  try {
    const raw = sessionStorage.getItem(CONTROL_WORKSPACE_KEY);
    return raw ? parseControlWorkspace(JSON.parse(raw)) : emptyControlWorkspace();
  } catch {
    return emptyControlWorkspace();
  }
}

export function writeControlWorkspace(snapshot: ControlWorkspaceSnapshot) {
  if (typeof sessionStorage === "undefined") return;
  sessionStorage.setItem(CONTROL_WORKSPACE_KEY, JSON.stringify(snapshot));
}
