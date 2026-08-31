import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { useAuth } from "../AuthContext";
import { useWorkspace } from "../WorkspaceContext";
import { hasPermission } from "../permissions";
import { isOfflineOnlyBuild, productNameForBuild } from "../appMode";

export function useWorkspaceLayoutState() {
  const { session, company, logout } = useAuth();
  const { parties, loadFinancialTotals, loadParties } = useWorkspace();
  const location = useLocation();

  const [statementPartyId, setStatementPartyId] = useState("");
  const [bookingReset, setBookingReset] = useState(0);
  const [paymentReset, setPaymentReset] = useState(0);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const phoneMenuFromPointer = useRef(false);

  useEffect(() => {
    setMobileNavOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    document.documentElement.classList.toggle("mobile-nav-open", mobileNavOpen);
    document.body.classList.toggle("mobile-nav-open", mobileNavOpen);
    return () => {
      document.documentElement.classList.remove("mobile-nav-open");
      document.body.classList.remove("mobile-nav-open");
    };
  }, [mobileNavOpen]);

  useEffect(() => {
    const isTauri = "__TAURI_INTERNALS__" in window;
    if (!isTauri) return;

    const updateTitle = async () => {
      const status = isOfflineOnlyBuild()
        ? "Offline Edition"
        : navigator.onLine
          ? "Connected (Online)"
          : "Offline Mode";
      const newTitle = `${productNameForBuild()} - ${status}`;
      document.title = newTitle;

      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        await getCurrentWindow().setTitle(newTitle);
      } catch (e) {
        console.error("Failed to update window title", e);
      }
    };

    updateTitle();
    window.addEventListener("online", updateTitle);
    window.addEventListener("offline", updateTitle);

    if (isOfflineOnlyBuild()) {
      return () => {
        window.removeEventListener("online", updateTitle);
        window.removeEventListener("offline", updateTitle);
      };
    }

    let active = true;
    const runCheck = async () => {
      try {
        const { check } = await import("@tauri-apps/plugin-updater");
        const { ask, message } = await import("@tauri-apps/plugin-dialog");
        const update = await check();
        if (active && update) {
          const yes = await ask(`Update to ${update.version} is available!\n\nRelease notes: ${update.body}`, {
            title: "Update Available",
            kind: "info",
          });
          if (yes) {
            await update.downloadAndInstall();
            await message("Update installed successfully! Please restart the application to apply changes.", {
              title: "Update Complete",
              kind: "info",
            });
          }
        }
      } catch (err) {
        console.error("Auto update check failed:", err);
      }
    };
    runCheck();

    return () => {
      active = false;
      window.removeEventListener("online", updateTitle);
      window.removeEventListener("offline", updateTitle);
    };
  }, []);

  const initials = useMemo(() => {
    const text = company?.name || "TA";
    return text
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((x) => x[0]?.toUpperCase())
      .join("");
  }, [company]);

  const can = (permission: Parameters<typeof hasPermission>[1]) => hasPermission(session?.role, permission);

  return {
    session,
    company,
    logout,
    parties,
    loadFinancialTotals,
    loadParties,
    location,
    statementPartyId,
    setStatementPartyId,
    bookingReset,
    setBookingReset,
    paymentReset,
    setPaymentReset,
    mobileNavOpen,
    setMobileNavOpen,
    phoneMenuFromPointer,
    initials,
    can,
  };
}

export type WorkspaceLayoutState = ReturnType<typeof useWorkspaceLayoutState>;
