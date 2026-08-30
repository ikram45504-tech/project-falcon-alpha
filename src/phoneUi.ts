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

export function isPhoneViewport() {
  if (typeof window === "undefined") return false;
  if (isTauriShell()) return false;
  if (isDesktopOperatingSystem()) return false;
  return window.matchMedia("(max-width: 820px)").matches;
}

export function usePhoneUi() {
  const [phone, setPhone] = useState(isPhoneViewport);

  useEffect(() => {
    const apply = () => {
      const next = isPhoneViewport();
      setPhone(next);
      document.documentElement.classList.toggle("phone-ui", next);
    };
    apply();
    const mq = window.matchMedia("(max-width: 820px)");
    mq.addEventListener("change", apply);
    window.addEventListener("resize", apply);
    return () => {
      mq.removeEventListener("change", apply);
      window.removeEventListener("resize", apply);
      document.documentElement.classList.remove("phone-ui");
    };
  }, []);

  return phone;
}
