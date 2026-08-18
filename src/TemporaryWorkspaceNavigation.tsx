import { useEffect } from "react";
import "./BookingFinalization.css";

export default function TemporaryWorkspaceNavigation() {
  useEffect(() => {
    let accountRequested = false;
    let observedDashboardButton: HTMLButtonElement | null = null;

    const markAccountRequested = () => { accountRequested = true; };

    function apply() {
      const nav = document.querySelector<HTMLElement>(".main-workspace-nav");
      if (!nav) return;
      const buttons = Array.from(nav.querySelectorAll<HTMLButtonElement>("button"));
      const dashboard = buttons.find((button) => ["Dashboard", "Accounts"].includes((button.textContent || "").trim()));
      const bookings = buttons.find((button) => (button.textContent || "").trim() === "Bookings");

      if (dashboard) {
        if (observedDashboardButton !== dashboard) {
          observedDashboardButton?.removeEventListener("click", markAccountRequested, true);
          observedDashboardButton = dashboard;
          dashboard.addEventListener("click", markAccountRequested, true);
        }
        if ((dashboard.textContent || "").trim() !== "Accounts") dashboard.textContent = "Accounts";
      }

      const subnav = document.querySelector<HTMLElement>(".dashboard-subnav");
      if (subnav) {
        const overview = Array.from(subnav.querySelectorAll<HTMLButtonElement>("button")).find((button) => (button.textContent || "").trim().startsWith("Overview"));
        overview?.classList.add("workspace-temp-hide");
      }

      const legacyDashboardVisible = Boolean(document.querySelector(".workspace > .welcome"));
      if (!legacyDashboardVisible) return;

      if (accountRequested) {
        const partyButton = Array.from(document.querySelectorAll<HTMLButtonElement>(".dashboard-subnav button")).find((button) => (button.textContent || "").trim().startsWith("Parties"));
        if (partyButton) {
          accountRequested = false;
          partyButton.click();
        }
        return;
      }

      if (bookings && !bookings.classList.contains("active")) bookings.click();
    }

    const observer = new MutationObserver(apply);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
    apply();
    return () => {
      observer.disconnect();
      observedDashboardButton?.removeEventListener("click", markAccountRequested, true);
    };
  }, []);

  return null;
}
