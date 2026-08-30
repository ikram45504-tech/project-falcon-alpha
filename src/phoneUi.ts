import { useEffect, useState } from "react";

export function isTauriShell() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export function isPhoneViewport() {
  if (typeof window === "undefined") return false;
  if (isTauriShell()) return false;
  return window.matchMedia("(max-width: 820px)").matches;
}

export function usePhoneUi() {
  const [phone, setPhone] = useState(isPhoneViewport);

  useEffect(() => {
    if (isTauriShell()) {
      setPhone(false);
      document.documentElement.classList.remove("phone-ui");
      return;
    }
    const mq = window.matchMedia("(max-width: 820px)");
    const apply = () => {
      setPhone(mq.matches);
      document.documentElement.classList.toggle("phone-ui", mq.matches);
    };
    apply();
    mq.addEventListener("change", apply);
    return () => {
      mq.removeEventListener("change", apply);
      document.documentElement.classList.remove("phone-ui");
    };
  }, []);

  return phone;
}
