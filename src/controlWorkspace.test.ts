import { describe, expect, it } from "vitest";
import { entitlementsFromPlan } from "./companyEntitlements";
import { emptyControlWorkspace, parseControlWorkspace } from "./controlWorkspace";

describe("control workspace restore", () => {
  it("keeps the selected company and unsaved custom draft after a remount", () => {
    const draft = entitlementsFromPlan("custom");
    draft.segments.PACKAGE = false;
    draft.features.pnl = false;
    draft.limits.parties = 0;

    const restored = parseControlWorkspace({
      selectedId: "company-ikr",
      mainTab: "approved",
      filter: "ACTIVE",
      planId: "custom",
      draft,
      createOpen: false,
    });

    expect(restored.selectedId).toBe("company-ikr");
    expect(restored.planId).toBe("custom");
    expect(restored.draft?.segments.PACKAGE).toBe(false);
    expect(restored.draft?.features.pnl).toBe(false);
    expect(restored.draft?.limits.parties).toBe(0);
  });

  it("falls back to an empty desk when storage is missing or invalid", () => {
    expect(parseControlWorkspace(null)).toEqual(emptyControlWorkspace());
    expect(parseControlWorkspace({ selectedId: 12, mainTab: "nope" }).mainTab).toBe("approved");
  });
});
