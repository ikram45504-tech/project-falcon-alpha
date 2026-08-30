/** True for the dedicated offline desktop build (no Supabase auth or cloud sync). */
export function isOfflineOnlyBuild() {
  return import.meta.env.VITE_OFFLINE_ONLY === "true";
}

/** Desktop builds that push/pull booking data with Supabase. */
export function isCloudSyncEnabled() {
  if (isOfflineOnlyBuild()) return false;
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export function productNameForBuild() {
  return isOfflineOnlyBuild() ? "Travel Hisab Offline" : "Travel Hisab";
}
