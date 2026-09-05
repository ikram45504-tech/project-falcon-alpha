/** Desktop background bridge — used by startBackgroundSync in db.ts. */
export const BACKGROUND_SYNC = {
  firstDelayMs: 1500,
  intervalMs: 5000,
  triggers: ["interval", "focus", "online"] as const,
} as const;

export const PULL_SYNC_EPOCH = "2000-01-01T00:00:00.000Z";

/**
 * Incremental pulls re-read 24 hours before the last cursor so clock skew
 * and missed rows still land. Manual Sync ignores the cursor and re-pulls
 * the whole company from epoch.
 */
export function pullSyncCursor(lastPullIso: string | undefined, fullResync: boolean): string {
  if (fullResync) return PULL_SYNC_EPOCH;
  const lastSync = lastPullIso || PULL_SYNC_EPOCH;
  const lastSyncDate = new Date(lastSync);
  if (lastSyncDate.getFullYear() > 2000) {
    lastSyncDate.setHours(lastSyncDate.getHours() - 24);
    return lastSyncDate.toISOString();
  }
  return lastSync;
}

/** Daily cloud bridge is automatic. Dashboard Sync is not required for that. */
export function dashboardNeedsManualCloudSync(): boolean {
  return false;
}

export function isManualFullResync(source: "interval" | "focus" | "online" | "manual"): boolean {
  return source === "manual";
}
