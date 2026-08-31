import { MobileMenu, MobileTabBar } from "./MobileNav";
import { WorkspaceRoutes } from "../layout/WorkspaceRoutes";
import type { WorkspaceLayoutState } from "../layout/useWorkspaceLayoutState";

/** Mobile PWA shell — isolated from desktop so changes here do not affect desktop/Tauri. */
export function MobileAppLayout({ state }: { state: WorkspaceLayoutState }) {
  const { company, logout, initials, can, mobileNavOpen, setMobileNavOpen, setBookingReset, setPaymentReset } = state;

  return (
    <main className="workspace mobile-workspace">
      <header className="app-header mobile-app-header">
        <div className="identity mobile-identity">
          <div className="header-logo mobile-header-logo">
            {company?.logo_data ? (
              <img src={company.logo_data} alt={`${company.name} logo`} />
            ) : (
              <span className="mobile-header-initials">{initials}</span>
            )}
          </div>
          <div className="mobile-identity-text">
            <h1>{company?.name || "Travel Hisab"}</h1>
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
