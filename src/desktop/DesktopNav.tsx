import { NavLink, useLocation } from "react-router-dom";
import type { Permission } from "../permissions";

export function DesktopNav({
  can,
  mobileNavOpen,
  onNavClick,
  onBookingRetap,
  onPaymentRetap,
}: {
  can: (permission: Permission) => boolean;
  mobileNavOpen: boolean;
  onNavClick: () => void;
  onBookingRetap: () => void;
  onPaymentRetap: () => void;
}) {
  const location = useLocation();

  return (
    <nav
      className={`workspace-nav main-workspace-nav${mobileNavOpen ? " is-open" : ""}`}
      onClick={(event) => {
        if ((event.target as HTMLElement).closest("a")) onNavClick();
      }}
    >
      <NavLink to="/" end className={({ isActive }) => (isActive ? "active" : "")}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: "10px" }}>
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect x="3" y="3" width="7" height="9"></rect>
            <rect x="14" y="3" width="7" height="5"></rect>
            <rect x="14" y="12" width="7" height="9"></rect>
            <rect x="3" y="16" width="7" height="5"></rect>
          </svg>
          Dashboard
        </span>
      </NavLink>
      {can("view_parties") && (
        <NavLink
          to="/parties"
          className={({ isActive }) => (isActive || window.location.pathname.startsWith("/parties/") ? "active" : "")}
        >
          <span style={{ display: "inline-flex", alignItems: "center", gap: "10px" }}>
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
              <circle cx="9" cy="7" r="4"></circle>
              <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
              <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
            </svg>
            Counterparties
          </span>
        </NavLink>
      )}
      {can("view_bookings") && (
        <NavLink
          to="/bookings"
          className={({ isActive }) => (isActive ? "active" : "")}
          onClick={() => {
            if (location.pathname === "/bookings") onBookingRetap();
          }}
        >
          <span style={{ display: "inline-flex", alignItems: "center", gap: "10px" }}>
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.2-1.1.6L2.5 9l8.1 4.5-3.6 3.6-3.4-.6c-.4-.1-.9.2-1.1.6l-.8 2 5.1 1.4 1.4 5.1 2-.8c.4-.2.7-.7.6-1.1l-.6-3.4 3.6-3.6 4.5 8.1c.4.7 1.3.8 2 .1.4-.4.8-1 .6-1.5z"></path>
            </svg>
            Bookings
          </span>
        </NavLink>
      )}
      {can("view_payments") && (
        <NavLink
          to="/payments"
          className={({ isActive }) => (isActive ? "active" : "")}
          onClick={() => {
            if (location.pathname === "/payments") onPaymentRetap();
          }}
        >
          <span style={{ display: "inline-flex", alignItems: "center", gap: "10px" }}>
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="1" y="4" width="22" height="16" rx="2" ry="2"></rect>
              <line x1="1" y1="10" x2="23" y2="10"></line>
            </svg>
            Payments
          </span>
        </NavLink>
      )}
      {can("view_statements") && (
        <NavLink to="/statements" className={({ isActive }) => (isActive ? "active" : "")}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: "10px" }}>
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
              <polyline points="14 2 14 8 20 8"></polyline>
              <line x1="16" y1="13" x2="8" y2="13"></line>
              <line x1="16" y1="17" x2="8" y2="17"></line>
              <polyline points="10 9 9 9 8 9"></polyline>
            </svg>
            Statements
          </span>
        </NavLink>
      )}
      {can("view_statements") && (
        <NavLink to="/pnl" className={({ isActive }) => (isActive ? "active" : "")}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: "10px" }}>
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="23 6 13.5 15.5 8.5 10.5 1 18"></polyline>
              <polyline points="17 6 23 6 23 12"></polyline>
            </svg>
            PnL Portfolio
          </span>
        </NavLink>
      )}
      <NavLink
        to="/settings"
        className={({ isActive }) =>
          isActive || window.location.pathname.startsWith("/settings")
            ? "active security-nav-button"
            : "security-nav-button"
        }
      >
        <span style={{ display: "inline-flex", alignItems: "center", gap: "10px" }}>
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="12" cy="12" r="3"></circle>
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
          </svg>
          Settings
        </span>
      </NavLink>
    </nav>
  );
}
