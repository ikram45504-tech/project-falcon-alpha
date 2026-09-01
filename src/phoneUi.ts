import { useEffect, useState } from "react";

export function isTauriShell() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/** Windows / macOS / Linux desktop browser — not a phone/tablet. */
export function isDesktopOperatingSystem() {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  if (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1) return false;
  if (/iPhone|iPod|iPad|Android|webOS|BlackBerry|IEMobile|Opera Mini/i.test(ua)) return false;
  if (/Windows NT|Win64|Macintosh|Mac OS X|Linux x86_64|X11|CrOS/i.test(ua)) return true;
  return window.matchMedia("(hover: hover) and (pointer: fine)").matches;
}

/** Phone/tablet from user agent. */
export function isMobileDevice() {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  if (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1) return true;
  return /iPhone|iPod|iPad|Android|webOS|BlackBerry|IEMobile|Opera Mini|Mobile/i.test(ua);
}

/** Touch-primary screen (works even when browser spoofs desktop UA). */
export function isTouchPrimaryDevice() {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(pointer: coarse)").matches && window.matchMedia("(hover: none)").matches;
}

export function isInstalledStandalone() {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export function isIosDevice() {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  if (/iPhone|iPod|iPad/i.test(ua)) return true;
  return navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
}

/** Chrome, Firefox, Edge, etc. on iOS — cannot install PWAs. */
export function isIosInAppBrowser() {
  if (!isIosDevice()) return false;
  const ua = navigator.userAgent || "";
  return /CriOS|FxiOS|EdgiOS|OPiOS/i.test(ua);
}

export function isIosSafariBrowser() {
  if (!isIosDevice() || isIosInAppBrowser()) return false;
  return /Safari/i.test(navigator.userAgent || "");
}

export function isPhoneViewport() {
  if (typeof window === "undefined") return false;
  if (isTauriShell()) return false;

  // Real phones/tablets — always mobile shell.
  if (isMobileDevice()) return true;

  // Touch-primary device (catches "Desktop site" mode on phones).
  if (isTouchPrimaryDevice()) return true;

  // Installed mobile PWA from home screen.
  if (isInstalledStandalone() && (isTouchPrimaryDevice() || window.matchMedia("(max-width: 820px)").matches)) {
    return true;
  }

  if (isDesktopOperatingSystem()) return false;

  return window.matchMedia("(max-width: 820px)").matches;
}

export function applyPhoneShellDocumentClass() {
  if (typeof document === "undefined") return;
  const mobile = isPhoneViewport();
  document.documentElement.classList.toggle("phone-ui", mobile);
  document.documentElement.dataset.shell = mobile ? "mobile" : "desktop";
  if (mobile) {
    document.documentElement.dataset.layout = "layout-mobile";
  }
}

// Apply before React paints (main.tsx also calls this).
if (typeof document !== "undefined") {
  applyPhoneShellDocumentClass();
}

export function usePhoneUi() {
  const [phone, setPhone] = useState(isPhoneViewport);

  useEffect(() => {
    const apply = () => {
      const next = isPhoneViewport();
      setPhone(next);
      applyPhoneShellDocumentClass();
    };
    apply();
    const mq = window.matchMedia("(max-width: 820px)");
    const displayMq = window.matchMedia("(display-mode: standalone)");
    const coarseMq = window.matchMedia("(pointer: coarse)");
    mq.addEventListener("change", apply);
    displayMq.addEventListener("change", apply);
    coarseMq.addEventListener("change", apply);
    window.addEventListener("resize", apply);
    window.addEventListener("orientationchange", apply);
    return () => {
      mq.removeEventListener("change", apply);
      displayMq.removeEventListener("change", apply);
      coarseMq.removeEventListener("change", apply);
      window.removeEventListener("resize", apply);
      window.removeEventListener("orientationchange", apply);
    };
  }, []);

  return phone;
}
