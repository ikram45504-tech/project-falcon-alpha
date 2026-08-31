import { registerSW } from "virtual:pwa-register";

function isTauriShell() {
  return "__TAURI_INTERNALS__" in window;
}

type PwaHandlers = {
  onNeedRefresh?: () => void;
  onOfflineReady?: () => void;
};

let applyUpdate: ((reloadPage?: boolean) => Promise<void>) | undefined;

/** Install the web app worker on phones/browsers only — never inside the desktop shell. */
export function registerPwa(handlers: PwaHandlers = {}) {
  if (typeof window === "undefined") return;
  if (isTauriShell()) return;
  if (!("serviceWorker" in navigator)) return;

  applyUpdate = registerSW({
    immediate: true,
    onNeedRefresh() {
      handlers.onNeedRefresh?.();
      // Auto-apply updates so installed PWAs pick up new mobile shell without manual refresh.
      void applyPwaUpdate();
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
