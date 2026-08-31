import { useEffect, useState } from "react";
import { isTauriShell } from "./phoneUi";
import { usePwaUpdatePending } from "./usePwaUpdate";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

const INSTALL_DISMISS_KEY = "travel-hisab-pwa-install-dismissed";
const UPDATE_REMIND_MS = 20_000;

function isStandaloneDisplay() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export function PwaChrome() {
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [installDismissed, setInstallDismissed] = useState(() => sessionStorage.getItem(INSTALL_DISMISS_KEY) === "1");
  const { updatePending, setUpdatePending } = usePwaUpdatePending();
  const [bannerVisible, setBannerVisible] = useState(false);
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
        onNeedRefresh: () => {
          setUpdatePending(true);
          setBannerVisible(true);
        },
      });
    });
  }, [setUpdatePending]);

  // If update is pending but banner was dismissed, remind every 20 seconds.
  useEffect(() => {
    if (!updatePending || bannerVisible || isTauriShell()) return;

    const timer = window.setInterval(() => {
      setBannerVisible(true);
    }, UPDATE_REMIND_MS);

    return () => window.clearInterval(timer);
  }, [updatePending, bannerVisible]);

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

  function dismissUpdateBanner() {
    setBannerVisible(false);
  }

  async function applyUpdate() {
    const { applyPwaUpdate } = await import("./registerPwa");
    await applyPwaUpdate();
  }

  if (isTauriShell()) return null;

  const showInstall = Boolean(installEvent) && !installDismissed && !isStandaloneDisplay();
  const showUpdate = updatePending && bannerVisible;

  return (
    <div className="pwa-chrome" aria-live="polite">
      {offline ? (
        <div className="pwa-banner pwa-banner-offline" role="status">
          <span>You are offline. Cached screens may open, but cloud data will not sync until connection returns.</span>
        </div>
      ) : null}

      {showUpdate ? (
        <div className="pwa-banner pwa-banner-update" role="status">
          <span>A new version of Travel Hisab is ready. Refresh to apply the update.</span>
          <div className="pwa-banner-actions">
            <button type="button" className="pwa-banner-primary" onClick={() => void applyUpdate()}>
              Refresh Now
            </button>
            <button type="button" className="pwa-banner-ghost" onClick={dismissUpdateBanner}>
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
