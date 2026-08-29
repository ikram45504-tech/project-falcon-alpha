import { supabase } from "./supabaseClient";

export function isDesktopApp() {
  return "__TAURI_INTERNALS__" in window;
}

function clearAuthStorage() {
  for (const key of Object.keys(localStorage)) {
    if (key.startsWith("sb-") || key.startsWith("travelAccounting")) {
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
