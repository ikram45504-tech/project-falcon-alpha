import { describe, expect, it } from "vitest";
import { shouldShowDashboardSkeleton } from "./dashboardView";

describe("dashboard keep-last-numbers", () => {
  it("does not blank KPI cards when a snapshot already exists", () => {
    expect(shouldShowDashboardSkeleton(true, true)).toBe(false);
    expect(shouldShowDashboardSkeleton(true, false)).toBe(false);
  });

  it("shows skeletons only on the first load with no snapshot", () => {
    expect(shouldShowDashboardSkeleton(false, true)).toBe(true);
    expect(shouldShowDashboardSkeleton(false, false)).toBe(false);
  });
});
