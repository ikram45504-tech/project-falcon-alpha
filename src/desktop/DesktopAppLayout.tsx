import { DesktopNav } from "./DesktopNav";
import { WorkspaceRoutes } from "../layout/WorkspaceRoutes";
import type { WorkspaceLayoutState } from "../layout/useWorkspaceLayoutState";
import AccessExpiryBanner from "../AccessExpiryBanner";
import SuspendedAccountBanner from "../SuspendedAccountBanner";
import { workspaceAccountKind, workspaceLoginId, workspacePlanChip } from "../workspaceHeader";

/** Desktop shell — Tauri app and desktop browser/PWA. Unchanged from the original layout. */
export function DesktopAppLayout({ state }: { state: WorkspaceLayoutState }) {
  const { session, company, logout, initials, can, mobileNavOpen, setMobileNavOpen, setBookingReset, setPaymentReset } =
    state;
  const planChip = workspacePlanChip(company?.entitlements);
  const accountKind = workspaceAccountKind(session?.role);
  const loginId = workspaceLoginId(company?.company_code || session?.companyCode, session?.username);

  return (
    <main className="workspace">
      <AccessExpiryBanner accessEndsAt={company?.access_ends_at} />
      <SuspendedAccountBanner status={company?.status} />
      <header className="app-header">
        <div className="identity">
          <div className="header-logo">{company?.logo_data ? <img src={company.logo_data} alt="" /> : initials}</div>
          <div>
            <h1>{company?.name}</h1>
          </div>
        </div>

        <div className="header-actions">
          {planChip ? <span className="header-plan-chip">{planChip}</span> : null}
          <div className="minimal-user-row">
            <div className="minimal-user-text">
              <b>{accountKind}</b>
              <small>{loginId}</small>
            </div>
            <button className="minimal-signout-btn" onClick={logout} title="Sign Out">
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
                <polyline points="16 17 21 12 16 7"></polyline>
                <line x1="21" y1="12" x2="9" y2="12"></line>
              </svg>
              Sign Out
            </button>
          </div>
        </div>
      </header>

      <DesktopNav
        can={can}
        mobileNavOpen={mobileNavOpen}
        onNavClick={() => setMobileNavOpen(false)}
        onBookingRetap={() => setBookingReset((r) => r + 1)}
        onPaymentRetap={() => setPaymentReset((r) => r + 1)}
      />

      <div className="layout-content-wrapper">
        <WorkspaceRoutes state={state} />
      </div>
    </main>
  );
}
