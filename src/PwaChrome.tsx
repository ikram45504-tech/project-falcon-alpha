import { useEffect, useState } from "react";
import { isTauriShell } from "./phoneUi";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

const INSTALL_DISMISS_KEY = "travel-hisab-pwa-install-dismissed";

function isStandaloneDisplay() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export function PwaChrome() {
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [installDismissed, setInstallDismissed] = useState(() => sessionStorage.getItem(INSTALL_DISMISS_KEY) === "1");
  const [updateReady, setUpdateReady] = useState(false);
  const [offline, setOffline] = useState(() => !navigator.onLine);

  useEffect(() => {
    if (isTauriShell() || isStandaloneDisplay()) return;

    const onBeforeInstall = (event: Event) => {
      event.preventDefault();
      setInstallEvent(event as BeforeInstallPromptEvent);
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    return () => window.removeEventListener("beforeinstallprompt", onBeforeInstall);
  }, []);

  useEffect(() => {
    const onOnline = () => setOffline(false);
    const onOffline = () => setOffline(true);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  useEffect(() => {
    if (isTauriShell()) return;

    void import("./registerPwa").then(({ registerPwa }) => {
      registerPwa({
        onNeedRefresh: () => setUpdateReady(true),
      });
    });
  }, []);

  async function installApp() {
    if (!installEvent) return;
    await installEvent.prompt();
    const choice = await installEvent.userChoice;
    setInstallEvent(null);
    if (choice.outcome === "dismissed") {
      sessionStorage.setItem(INSTALL_DISMISS_KEY, "1");
      setInstallDismissed(true);
    }
  }

  function dismissInstall() {
    sessionStorage.setItem(INSTALL_DISMISS_KEY, "1");
    setInstallDismissed(true);
    setInstallEvent(null);
  }

  async function applyUpdate() {
    const { applyPwaUpdate } = await import("./registerPwa");
    await applyPwaUpdate();
  }

  if (isTauriShell()) return null;

  const showInstall = Boolean(installEvent) && !installDismissed && !isStandaloneDisplay();

  return (
    <div className="pwa-chrome" aria-live="polite">
      {offline ? (
        <div className="pwa-banner pwa-banner-offline" role="status">
          <span>You are offline. Cached screens may open, but cloud data will not sync until connection returns.</span>
        </div>
      ) : null}

      {updateReady ? (
        <div className="pwa-banner pwa-banner-update" role="status">
          <span>A new version of Travel Hisab is ready.</span>
          <div className="pwa-banner-actions">
            <button type="button" className="pwa-banner-primary" onClick={() => void applyUpdate()}>
              Refresh
            </button>
            <button type="button" className="pwa-banner-ghost" onClick={() => setUpdateReady(false)}>
              Later
            </button>
          </div>
        </div>
      ) : null}

      {showInstall ? (
        <div className="pwa-banner pwa-banner-install" role="dialog" aria-label="Install Travel Hisab">
          <span>Install Travel Hisab on this device for quick access from your home screen.</span>
          <div className="pwa-banner-actions">
            <button type="button" className="pwa-banner-primary" onClick={() => void installApp()}>
              Install
            </button>
            <button type="button" className="pwa-banner-ghost" onClick={dismissInstall}>
              Not now
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
