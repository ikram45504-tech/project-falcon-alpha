import { createPortal } from "react-dom";
import { NavLink } from "react-router-dom";
import type { Permission } from "../permissions";
import { useTheme, type ThemeMode } from "../ThemeContext";

const MOBILE_THEMES: { id: ThemeMode; icon: string; label: string }[] = [
  { id: "light", icon: "☀️", label: "Bright" },
  { id: "dark", icon: "🌙", label: "Dark" },
  { id: "ocean", icon: "🌊", label: "Ocean" },
];

export function MobileMenu({
  open,
  onClose,
  can,
  onSignOut,
  onBookingRetap,
  onPaymentRetap,
}: {
  open: boolean;
  onClose: () => void;
  can: (permission: Permission) => boolean;
  onSignOut: () => void;
  onBookingRetap?: () => void;
  onPaymentRetap?: () => void;
}) {
  const { mode, setMode } = useTheme();

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div className="th-phone-layer">
      <button type="button" className="th-phone-backdrop" aria-label="Close menu" onClick={onClose} />
      <nav className="th-phone-drawer" role="dialog" aria-modal="true" aria-label="App menu">
        <div className="th-phone-drawer-head">
          <strong>Menu</strong>
          <button type="button" className="th-phone-drawer-close" onClick={onClose}>
            Close
          </button>
        </div>

        <div className="th-phone-drawer-section">
          <span className="th-phone-drawer-label">Navigate</span>
          <NavLink to="/" end onClick={onClose}>
            Dashboard
          </NavLink>
          {can("view_parties") && (
            <NavLink to="/parties" onClick={onClose}>
              Counterparties
            </NavLink>
          )}
          {can("view_bookings") && (
            <NavLink
              to="/bookings"
              onClick={() => {
                onBookingRetap?.();
                onClose();
              }}
            >
              Bookings
            </NavLink>
          )}
          {can("view_payments") && (
            <NavLink
              to="/payments"
              onClick={() => {
                onPaymentRetap?.();
                onClose();
              }}
            >
              Payments
            </NavLink>
          )}
          {can("view_statements") && (
            <NavLink to="/statements" onClick={onClose}>
              Statements
            </NavLink>
          )}
          {can("view_statements") && (
            <NavLink to="/pnl" onClick={onClose}>
              PnL Portfolio
            </NavLink>
          )}
          <NavLink to="/settings" onClick={onClose}>
            Settings
          </NavLink>
        </div>

        <div className="th-phone-drawer-section">
          <span className="th-phone-drawer-label">Theme</span>
          <div className="th-phone-theme-row">
            {MOBILE_THEMES.map((theme) => (
              <button
                key={theme.id}
                type="button"
                className={`th-phone-theme-btn${mode === theme.id ? " active" : ""}`}
                onClick={() => setMode(theme.id)}
                aria-pressed={mode === theme.id}
              >
                {theme.icon} {theme.label}
              </button>
            ))}
          </div>
        </div>

        <div className="th-phone-drawer-footer">
          <button type="button" className="th-phone-signout" onClick={onSignOut}>
            Sign Out
          </button>
        </div>
      </nav>
    </div>,
    document.body,
  );
}

export function MobileTabBar({
  can,
  onOpenMenu,
}: {
  can: (permission: Permission) => boolean;
  onOpenMenu: () => void;
}) {
  return (
    <nav className="th-phone-tabs" aria-label="Phone shortcuts">
      <NavLink to="/" end>
        Home
      </NavLink>
      {can("view_parties") && <NavLink to="/parties">Parties</NavLink>}
      {can("view_bookings") && <NavLink to="/bookings">Bookings</NavLink>}
      {can("view_payments") && <NavLink to="/payments">Pay</NavLink>}
      <button type="button" onClick={onOpenMenu} aria-label="Open menu">
        Menu
      </button>
    </nav>
  );
}
