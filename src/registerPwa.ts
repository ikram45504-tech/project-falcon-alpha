import { registerSW } from "virtual:pwa-register";
import { setPwaUpdatePending } from "./pwaUpdateState";

function isTauriShell() {
  return "__TAURI_INTERNALS__" in window;
}

type PwaHandlers = {
  onNeedRefresh?: () => void;
  onOfflineReady?: () => void;
};

let applyUpdate: ((reloadPage?: boolean) => Promise<void>) | undefined;
let registered = false;

/** Install the web app worker on phones/browsers only — never inside the desktop shell. */
export function registerPwa(handlers: PwaHandlers = {}) {
  if (typeof window === "undefined") return;
  if (isTauriShell()) return;
  if (!("serviceWorker" in navigator)) return;
  if (registered) return;
  registered = true;

  applyUpdate = registerSW({
    immediate: true,
    onNeedRefresh() {
      setPwaUpdatePending(true);
      handlers.onNeedRefresh?.();
    },
    onOfflineReady() {
      handlers.onOfflineReady?.();
    },
    onRegisterError(error) {
      console.warn("PWA registration failed:", error);
    },
  });
}

export async function applyPwaUpdate() {
  if (applyUpdate) {
    await applyUpdate(true);
    return;
  }
  window.location.reload();
}

/** Force a service-worker update check, then apply if a new version is waiting. */
export async function checkAndApplyPwaUpdate(): Promise<"updated" | "current" | "unavailable"> {
  if (typeof window === "undefined" || isTauriShell() || !("serviceWorker" in navigator)) {
    return "unavailable";
  }

  registerPwa();

  try {
    const registration = await navigator.serviceWorker.getRegistration();
    if (!registration) {
      window.location.reload();
      return "updated";
    }

    await registration.update();

    if (registration.waiting || registration.installing) {
      setPwaUpdatePending(true);
      await applyPwaUpdate();
      return "updated";
    }

    return "current";
  } catch (error) {
    console.warn("PWA update check failed:", error);
    window.location.reload();
    return "updated";
  }
}
