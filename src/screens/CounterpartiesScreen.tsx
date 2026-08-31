import { useNavigate } from "react-router-dom";
import { useAuth } from "../AuthContext";
import { useWorkspace } from "../WorkspaceContext";
import { hasPermission } from "../permissions";
import "../BookingFinalization.css";

export default function CounterpartiesScreen() {
  const navigate = useNavigate();
  const { session } = useAuth();
  const { partyAccounts, vendorAccounts, unassignedAccounts } = useWorkspace();
  const can = (permission: any) => hasPermission(session?.role, permission);

  return (
    <section className="booking-entry-screen booking-direction-screen">
      <div className="booking-screen-toolbar">
        <span></span>
      </div>
      <div className="booking-screen-heading centered-heading" style={{ marginTop: "20px" }}>
        <span className="eyebrow blue">COUNTERPARTIES</span>
        <h2>Manage Parties & Vendors</h2>
        <p>Organize your customers, agents, and suppliers in one place.</p>
      </div>

      {unassignedAccounts.length > 0 && can("view_parties") && (
        <div
          style={{
            backgroundColor: "#fff3cd",
            border: "1px solid #ffeeba",
            borderRadius: "8px",
            padding: "16px",
            marginBottom: "24px",
            color: "#856404",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            maxWidth: "800px",
            margin: "0 auto 24px auto",
          }}
        >
          <div>
            <strong>Action Required:</strong> You have {unassignedAccounts.length} account(s) that need classification
            (Party vs Vendor).
          </div>
          <button
            className="primary small warning"
            style={{ backgroundColor: "#856404" }}
            onClick={() => navigate("/parties/UNASSIGNED")}
          >
            Review Accounts
          </button>
        </div>
      )}

      <div className="booking-direction-grid">
        {can("view_parties") && (
          <button type="button" className="booking-direction-card sale" onClick={() => navigate("/parties/PARTY")}>
            <span className="direction-card-icon" aria-hidden="true">
              👤
            </span>
            <div>
              <small>PARTIES / CUSTOMERS · {partyAccounts.length} ACTIVE</small>
              <b>Customers</b>
              <p>Manage your direct clients and customers.</p>
            </div>
            <span className="direction-arrow">→</span>
          </button>
        )}

        {can("view_parties") && (
          <button type="button" className="booking-direction-card purchase" onClick={() => navigate("/parties/VENDOR")}>
            <span className="direction-card-icon" aria-hidden="true">
              🏢
            </span>
            <div>
              <small>VENDORS / SUPPLIERS · {vendorAccounts.length} ACTIVE</small>
              <b>Suppliers</b>
              <p>Manage the vendors you purchase travel services from.</p>
            </div>
            <span className="direction-arrow">→</span>
          </button>
        )}
      </div>
    </section>
  );
}
