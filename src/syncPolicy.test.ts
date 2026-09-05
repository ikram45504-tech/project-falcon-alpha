import { describe, expect, it } from "vitest";
import { isCloudSyncEnabled, isOfflineOnlyBuild } from "./appMode";
import {
  BACKGROUND_SYNC,
  PULL_SYNC_EPOCH,
  dashboardNeedsManualCloudSync,
  isManualFullResync,
  pullSyncCursor,
} from "./syncPolicy";

describe("cloud + local talking without the dashboard Sync button", () => {
  it("web Vitest/browser builds talk to Supabase directly — they have no local SQLite bridge", () => {
    expect(isOfflineOnlyBuild()).toBe(false);
    expect(isCloudSyncEnabled()).toBe(false);
  });

  it("desktop keeps SQLite aligned automatically on a timer, window focus, and coming back online", () => {
    expect(BACKGROUND_SYNC.firstDelayMs).toBe(1500);
    expect(BACKGROUND_SYNC.intervalMs).toBe(5000);
    expect(BACKGROUND_SYNC.triggers).toEqual(["interval", "focus", "online"]);
    expect(isManualFullResync("interval")).toBe(false);
    expect(isManualFullResync("focus")).toBe(false);
    expect(isManualFullResync("online")).toBe(false);
  });

  it("incremental pull is the daily path; dashboard Sync is not required for that", () => {
    expect(dashboardNeedsManualCloudSync()).toBe(false);
    expect(isManualFullResync("manual")).toBe(true);

    const lastPull = "2026-09-05T12:00:00.000Z";
    const skewed = new Date(lastPull);
    skewed.setHours(skewed.getHours() - 24);
    expect(pullSyncCursor(lastPull, false)).toBe(skewed.toISOString());
    expect(pullSyncCursor(lastPull, false)).not.toBe(PULL_SYNC_EPOCH);

    expect(pullSyncCursor("2026-09-05T12:00:00.000Z", true)).toBe(PULL_SYNC_EPOCH);
    expect(pullSyncCursor(undefined, false)).toBe(PULL_SYNC_EPOCH);
  });
});
