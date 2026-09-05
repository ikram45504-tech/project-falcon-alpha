import { describe, expect, it } from "vitest";
import { entitlementsFromPlan } from "./companyEntitlements";
import { workspaceAccountKind, workspaceLoginId, workspacePlanChip } from "./workspaceHeader";

describe("workspace header identity", () => {
  it("labels the owner as Main Account and other roles as Staff Account", () => {
    expect(workspaceAccountKind("OWNER")).toBe("Main Account");
    expect(workspaceAccountKind("ADMIN")).toBe("Staff Account");
    expect(workspaceAccountKind("ACCOUNTS")).toBe("Staff Account");
    expect(workspaceAccountKind("DATA_ENTRY")).toBe("Staff Account");
    expect(workspaceAccountKind("VIEW_ONLY")).toBe("Staff Account");
  });

  it("formats company code and username as CODE-username", () => {
    expect(workspaceLoginId("ikr", "ikram123")).toBe("IKR-ikram123");
    expect(workspaceLoginId(" IKR ", " Ikram123 ")).toBe("IKR-Ikram123");
    expect(workspaceLoginId("", "ikram123")).toBe("ikram123");
    expect(workspaceLoginId("IKR", "")).toBe("IKR");
  });

  it("shows the assigned tier as a short plan chip", () => {
    expect(workspacePlanChip(entitlementsFromPlan("free"))).toBe("Free Plan");
    expect(workspacePlanChip(entitlementsFromPlan("pro"))).toBe("Pro Plan");
    expect(workspacePlanChip(entitlementsFromPlan("enterprise"))).toBe("Enterprise Plan");
    expect(workspacePlanChip(entitlementsFromPlan("custom"))).toBe("Custom Plan");
    expect(workspacePlanChip({})).toBe("");
  });
});
