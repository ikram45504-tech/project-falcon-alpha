import { useEffect, useState } from "react";

export function isTauriShell() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/** Windows / macOS / Linux desktop — including an installed PWA window. Never use the phone shell here. */
export function isDesktopOperatingSystem() {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  if (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1) return false;
  if (/iPhone|iPod|iPad|Android|webOS|BlackBerry|IEMobile|Opera Mini/i.test(ua)) return false;
  if (/Windows NT|Win64|Macintosh|Mac OS X|Linux x86_64|X11|CrOS/i.test(ua)) return true;
  return window.matchMedia("(hover: hover) and (pointer: fine)").matches;
}

/** Phone/tablet browser or installed mobile PWA — not desktop OS or Tauri. */
export function isMobileDevice() {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  // iPad on iOS 13+ reports MacIntel with touch points.
  if (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1) return true;
  return /iPhone|iPod|iPad|Android|webOS|BlackBerry|IEMobile|Opera Mini|Mobile/i.test(ua);
}

export function isInstalledMobilePwa() {
  if (typeof window === "undefined") return false;
  const standalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
  return standalone && isMobileDevice();
}

export function isPhoneViewport() {
  if (typeof window === "undefined") return false;
  if (isTauriShell()) return false;
  if (isDesktopOperatingSystem()) return false;
  // Real phones/tablets always get the mobile shell — not only when width <= 820px.
  if (isMobileDevice() || isInstalledMobilePwa()) return true;
  return window.matchMedia("(max-width: 820px)").matches;
}

export function usePhoneUi() {
  const [phone, setPhone] = useState(isPhoneViewport);

  useEffect(() => {
    const apply = () => {
      const next = isPhoneViewport();
      setPhone(next);
      document.documentElement.classList.toggle("phone-ui", next);
      document.documentElement.dataset.shell = next ? "mobile" : "desktop";
    };
    apply();
    const mq = window.matchMedia("(max-width: 820px)");
    const displayMq = window.matchMedia("(display-mode: standalone)");
    mq.addEventListener("change", apply);
    displayMq.addEventListener("change", apply);
    window.addEventListener("resize", apply);
    window.addEventListener("orientationchange", apply);
    return () => {
      mq.removeEventListener("change", apply);
      displayMq.removeEventListener("change", apply);
      window.removeEventListener("resize", apply);
      window.removeEventListener("orientationchange", apply);
      document.documentElement.classList.remove("phone-ui");
      delete document.documentElement.dataset.shell;
    };
  }, []);

  return phone;
}
