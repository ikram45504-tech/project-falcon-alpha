function isTauriShell() {
  return "__TAURI_INTERNALS__" in window;
}

/** Install the web app worker on phones/browsers only — never inside the desktop shell. */
export function registerPwa() {
  if (typeof window === "undefined") return;
  if (isTauriShell()) return;
  if (!("serviceWorker" in navigator)) return;

  const hadController = Boolean(navigator.serviceWorker.controller);
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (hadController) window.location.reload();
  });

  void navigator.serviceWorker.register("/sw.js").catch(() => {
    // Missing worker is expected for desktop builds and local Vite without a production generate.
  });
}
