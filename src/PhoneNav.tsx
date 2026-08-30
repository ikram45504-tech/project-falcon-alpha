import { createPortal } from "react-dom";
import { NavLink } from "react-router-dom";
import type { Permission } from "./permissions";

export function PhoneMenu({
  open,
  onClose,
  can,
}: {
  open: boolean;
  onClose: () => void;
  can: (permission: Permission) => boolean;
}) {
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
        <NavLink to="/" end onClick={onClose}>
          Dashboard
        </NavLink>
        {can("view_parties") && (
          <NavLink to="/parties" onClick={onClose}>
            Counterparties
          </NavLink>
        )}
        {can("view_bookings") && (
          <NavLink to="/bookings" onClick={onClose}>
            Bookings
          </NavLink>
        )}
        {can("view_payments") && (
          <NavLink to="/payments" onClick={onClose}>
            Payments
          </NavLink>
        )}
        {can("view_statements") && (
          <NavLink to="/statements" onClick={onClose}>
            Statements
          </NavLink>
        )}
        <NavLink to="/settings" onClick={onClose}>
          Settings
        </NavLink>
      </nav>
    </div>,
    document.body,
  );
}

export function PhoneTabBar({
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
      <button type="button" onClick={onOpenMenu}>
        Menu
      </button>
    </nav>
  );
}
