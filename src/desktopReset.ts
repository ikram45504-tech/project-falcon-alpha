import { supabase } from "./supabaseClient";
import { AGENCY_AUTH_STORAGE_KEY, MASTER_AUTH_STORAGE_KEY } from "./supabaseClient";

export function isDesktopApp() {
  return "__TAURI_INTERNALS__" in window;
}

function clearAuthStorage() {
  for (const key of Object.keys(localStorage)) {
    if (
      key.startsWith("sb-") ||
      key.startsWith("travelAccounting") ||
      key.startsWith(AGENCY_AUTH_STORAGE_KEY) ||
      key.startsWith(MASTER_AUTH_STORAGE_KEY)
    ) {
      localStorage.removeItem(key);
    }
  }
}

/** Clears only Master Control Panel auth storage (keeps agency session). */
export function clearMasterAuthStorage() {
  for (const key of Object.keys(localStorage)) {
    if (key.startsWith(MASTER_AUTH_STORAGE_KEY)) {
      localStorage.removeItem(key);
    }
  }
}

/** Clears only agency auth storage (keeps Master session). */
export function clearAgencyAuthStorage() {
  for (const key of Object.keys(localStorage)) {
    if (key.startsWith(AGENCY_AUTH_STORAGE_KEY) || (key.startsWith("sb-") && !key.includes("master"))) {
      localStorage.removeItem(key);
    }
  }
}

export { clearAuthStorage };

/** Wipes local SQLite on next launch, clears auth now, and restarts the desktop app. */
export async function hardResetDesktopApp() {
  try {
    await supabase.auth.signOut({ scope: "local" });
  } catch {
    // Continue even if cloud sign-out fails — local wipe is the goal.
  }
  clearAuthStorage();

  if (isDesktopApp()) {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("hard_reset_desktop_app");
    return;
  }

  window.location.replace("/setup");
}
