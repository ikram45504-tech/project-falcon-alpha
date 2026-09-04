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
      return "current";
    }

    await registration.update();

    if (registration.waiting || registration.installing) {
      setPwaUpdatePending(true);
      await applyPwaUpdate();
      return "updated";
    }

    // Controller exists but page may still be on a previous worker generation.
    if (navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({ type: "SKIP_WAITING" });
    }

    return "current";
  } catch (error) {
    console.warn("PWA update check failed:", error);
    return "unavailable";
  }
}

/** Unregister workers + wipe Cache Storage, then reload (escape hatch for white screens). */
export async function hardResetPwaCache(options?: { path?: string }) {
  const { hardResetWebCache } = await import("./AppErrorBoundary");
  if (options?.path) {
    try {
      if ("serviceWorker" in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map((reg) => reg.unregister()));
      }
      if ("caches" in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map((key) => caches.delete(key)));
      }
    } catch (error) {
      console.warn("PWA cache reset failed:", error);
    }
    const next = new URL(options.path, window.location.origin);
    next.searchParams.set("v", String(Date.now()));
    window.location.replace(next.toString());
    return;
  }
  await hardResetWebCache();
}
