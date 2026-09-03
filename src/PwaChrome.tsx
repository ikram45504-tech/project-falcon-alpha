import { useEffect, useState } from "react";
import {
  isIosDevice,
  isIosInAppBrowser,
  isIosSafariBrowser,
  isMobileDevice,
  isPhoneViewport,
  isTauriShell,
} from "./phoneUi";
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
  const [showIosInstallGuide, setShowIosInstallGuide] = useState(false);
  const { updatePending, setUpdatePending } = usePwaUpdatePending();
  const [bannerVisible, setBannerVisible] = useState(false);
  const [offline, setOffline] = useState(() => !navigator.onLine);
  const [isMobileShell, setIsMobileShell] = useState(() => isPhoneViewport());

  useEffect(() => {
    const syncShell = () => setIsMobileShell(isPhoneViewport());
    syncShell();
    window.addEventListener("resize", syncShell);
    return () => window.removeEventListener("resize", syncShell);
  }, []);

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
    if (isTauriShell() || isStandaloneDisplay() || installDismissed) return;
    if (!isMobileDevice() || !isIosDevice()) return;
    setShowIosInstallGuide(true);
  }, [installDismissed]);

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

    void import("./registerPwa").then(({ registerPwa, applyPwaUpdate }) => {
      registerPwa({
        onNeedRefresh: () => {
          // Desktop web / desktop PWA: apply silently.
          // Mobile PWA: show banner + Settings update button (stickier caches).
          if (isPhoneViewport()) {
            setUpdatePending(true);
            setBannerVisible(true);
            return;
          }
          void applyPwaUpdate();
        },
      });
    });
  }, [setUpdatePending]);

  // Mobile only: if update is pending but banner was dismissed, remind every 20 seconds.
  useEffect(() => {
    if (!isMobileShell || !updatePending || bannerVisible || isTauriShell()) return;

    const timer = window.setInterval(() => {
      setBannerVisible(true);
    }, UPDATE_REMIND_MS);

    return () => window.clearInterval(timer);
  }, [isMobileShell, updatePending, bannerVisible]);

  async function installApp() {
    if (!installEvent) return;
    try {
      await installEvent.prompt();
      const choice = await installEvent.userChoice;
      setInstallEvent(null);
      if (choice.outcome === "dismissed") {
        sessionStorage.setItem(INSTALL_DISMISS_KEY, "1");
        setInstallDismissed(true);
      }
    } catch (error) {
      console.warn("PWA install prompt failed:", error);
      setInstallEvent(null);
    }
  }

  function dismissInstall() {
    sessionStorage.setItem(INSTALL_DISMISS_KEY, "1");
    setInstallDismissed(true);
    setInstallEvent(null);
    setShowIosInstallGuide(false);
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
  const showIosInstall = showIosInstallGuide && !installDismissed && !isStandaloneDisplay() && !showInstall;
  const showUpdate = isMobileShell && updatePending && bannerVisible;
  const iosInstallMessage = isIosInAppBrowser()
    ? "Install on iPhone works in Safari only. Open travelhisab.vercel.app in Safari, tap Share, then Add to Home Screen."
    : isIosSafariBrowser()
      ? "Install Travel Hisab: tap Share at the bottom of Safari, then Add to Home Screen."
      : "Install Travel Hisab on iPhone: open this site in Safari, tap Share, then Add to Home Screen.";

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

      {showIosInstall ? (
        <div className="pwa-banner pwa-banner-install" role="dialog" aria-label="Install Travel Hisab on iPhone">
          <span>{iosInstallMessage}</span>
          <div className="pwa-banner-actions">
            <button type="button" className="pwa-banner-ghost" onClick={dismissInstall}>
              Got it
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
