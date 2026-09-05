import { createPortal } from "react-dom";
import { NavLink } from "react-router-dom";
import { useAuth } from "../AuthContext";
import { normalizeEntitlements } from "../companyEntitlements";
import type { Permission } from "../permissions";
import { PLAN_LOCKED_HINT } from "../planLocked";
import { COMPANY_SUSPENDED_MESSAGE, companyAllowsWrites, notifyCompanySuspended } from "../companyStatus";
import { workspaceAccountKind, workspaceLoginId } from "../workspaceHeader";

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
  const { company, session } = useAuth();
  const planFeatures = normalizeEntitlements(company?.entitlements).features;
  const canWrite = companyAllowsWrites(company?.status);
  const statementsOpen = planFeatures.statements && canWrite;
  const pnlOpen = planFeatures.pnl && canWrite;
  const lockedHint = canWrite ? PLAN_LOCKED_HINT : COMPANY_SUSPENDED_MESSAGE;
  const accountKind = workspaceAccountKind(session?.role);
  const loginId = workspaceLoginId(company?.company_code || session?.companyCode, session?.username);
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
          {can("view_statements") &&
            (statementsOpen ? (
              <NavLink to="/statements" onClick={onClose}>
                Statements
              </NavLink>
            ) : (
              <span
                className="plan-locked-nav"
                title={lockedHint}
                aria-disabled="true"
                onClick={() => {
                  if (!canWrite) notifyCompanySuspended();
                }}
              >
                Statements
              </span>
            ))}
          {can("view_statements") &&
            (pnlOpen ? (
              <NavLink to="/pnl" onClick={onClose}>
                PnL Portfolio
              </NavLink>
            ) : (
              <span
                className="plan-locked-nav"
                title={lockedHint}
                aria-disabled="true"
                onClick={() => {
                  if (!canWrite) notifyCompanySuspended();
                }}
              >
                PnL Portfolio
              </span>
            ))}
          <NavLink to="/settings" onClick={onClose}>
            Settings
          </NavLink>
          <NavLink to="/settings/about" onClick={onClose}>
            About
          </NavLink>
        </div>

        <div className="th-phone-drawer-footer">
          <div className="th-phone-account">
            <b>{accountKind}</b>
            <small>{loginId}</small>
          </div>
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
