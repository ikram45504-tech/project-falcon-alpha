import { MobileMenu, MobileTabBar } from "./MobileNav";
import { WorkspaceRoutes } from "../layout/WorkspaceRoutes";
import type { WorkspaceLayoutState } from "../layout/useWorkspaceLayoutState";

/** Mobile PWA shell — isolated from desktop so changes here do not affect desktop/Tauri. */
export function MobileAppLayout({ state }: { state: WorkspaceLayoutState }) {
  const { session, company, logout, initials, can, mobileNavOpen, setMobileNavOpen, setBookingReset, setPaymentReset } =
    state;

  return (
    <main className="workspace mobile-workspace">
      <header className="app-header mobile-app-header">
        <div className="identity">
          <div className="header-logo">{company?.logo_data ? <img src={company.logo_data} alt="" /> : initials}</div>
          <div>
            <h1>{company?.name}</h1>
            {session ? <small className="mobile-header-subtitle">{session.username || session.fullName}</small> : null}
          </div>
        </div>
      </header>

      <MobileMenu
        open={mobileNavOpen}
        onClose={() => setMobileNavOpen(false)}
        can={can}
        onSignOut={logout}
        onBookingRetap={() => setBookingReset((r) => r + 1)}
        onPaymentRetap={() => setPaymentReset((r) => r + 1)}
      />
      <MobileTabBar can={can} onOpenMenu={() => setMobileNavOpen(true)} />

      <div className="layout-content-wrapper mobile-layout-content">
        <WorkspaceRoutes state={state} />
      </div>
    </main>
  );
}
