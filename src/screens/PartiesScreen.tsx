import { useState, useEffect } from "react";
import { useWorkspace } from "../WorkspaceContext";
import { useAuth } from "../AuthContext";
import { hasPermission } from "../permissions";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  Party,
  PartyInput,
  blankPartyInput,
  partyToInput,
  normalizePartyInput,
  createParty,
  updateParty,
  deleteParty,
} from "../db";
import AccountForm from "../AccountForm";
import AccountFormModal from "../AccountFormModal";

function formatMoney(value: number) {
  return `Rs ${Math.round(Number(value) || 0).toLocaleString("en-PK")}`;
}

export default function PartiesScreen() {
  const { view = "PARTY" } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const accountView = view.toUpperCase();
  const navigate = useNavigate();

  const { session, company } = useAuth();
  const { partySearch, searchParties, partyBookingTotals, partyPaymentTotals, loadParties, loadFinancialTotals } =
    useWorkspace();

  const [partyModalOpen, setPartyModalOpen] = useState(false);
  const [partyForm, setPartyForm] = useState<PartyInput>(blankPartyInput());
  const [editingParty, setEditingParty] = useState<Party | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const can = (permission: any) => hasPermission(session?.role, permission);

  const { parties } = useWorkspace();
  const currentVisibleAccounts = parties.filter((item) => item.account_type === accountView);

  useEffect(() => {
    if (searchParams.get("new") === "true") {
      newParty(accountView as "PARTY" | "VENDOR");
      searchParams.delete("new");
      setSearchParams(searchParams);
    }
  }, [searchParams, accountView]);

  function newParty(type: "PARTY" | "VENDOR" = "PARTY") {
    if (!can("edit_parties")) {
      setError("Your role does not allow creating Party/Vendor accounts.");
      return;
    }
    setEditingParty(null);
    setPartyForm(blankPartyInput(type));
    setError("");
    setPartyModalOpen(true);
  }

  function editParty(party: Party) {
    if (!can("edit_parties")) {
      setError("Your role has read-only access to Party/Vendor accounts.");
      return;
    }
    setEditingParty(party);
    setPartyForm(partyToInput(party));
    setError("");
    setPartyModalOpen(true);
  }

  async function saveParty() {
    if (!company || !session) return;
    if (!can("edit_parties")) return setError("Your role does not allow changing Party/Vendor accounts.");
    const normalized = normalizePartyInput(partyForm);
    if (!normalized.name) {
      setError(`${normalized.accountType === "VENDOR" ? "Vendor" : "Party"} name is required.`);
      return;
    }

    setBusy(true);
    setError("");
    try {
      if (editingParty) {
        await updateParty(editingParty.id, company.id, normalized, session.userId);
        setMessage(`${normalized.accountType === "VENDOR" ? "Vendor" : "Party"} updated successfully.`);
      } else {
        await createParty(company.id, normalized, session.userId);
        setMessage(`${normalized.accountType === "VENDOR" ? "Vendor" : "Party"} created successfully.`);
      }

      setPartyModalOpen(false);
      setEditingParty(null);
      setPartyForm(blankPartyInput());
      await loadParties(partySearch);
      await loadFinancialTotals();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function openLedger(party: Party) {
    navigate(`/parties/ledger/${party.id}`);
  }

  return (
    <>
      <section className="content-card parties-page">
        <div className="page-title">
          <div>
            <span className="eyebrow blue">MASTER ACCOUNTS</span>
            <h2>
              {accountView === "PARTY"
                ? "Parties"
                : accountView === "VENDOR"
                  ? "Vendors"
                  : "Accounts Needing Classification"}
            </h2>
            <p>
              {accountView === "PARTY"
                ? "Customers / agents that you sell services to."
                : accountView === "VENDOR"
                  ? "Suppliers that you purchase services from."
                  : "Existing accounts are kept safe until you classify each one as Party or Vendor."}
            </p>
          </div>
          {can("edit_parties") && accountView !== "UNASSIGNED" && (
            <button className="primary" onClick={() => newParty(accountView === "VENDOR" ? "VENDOR" : "PARTY")}>
              + Add New {accountView === "PARTY" ? "Party" : "Vendor"}
            </button>
          )}
        </div>

        {message && <div className="alert success">{message}</div>}
        {error && !partyModalOpen && <div className="alert error">{error}</div>}

        <div className="party-toolbar">
          <div className="search-box">
            <span>⌕</span>
            <input
              value={partySearch}
              onChange={(e) => void searchParties(e.target.value)}
              placeholder={`Search ${accountView === "PARTY" ? "parties" : accountView === "VENDOR" ? "vendors" : "accounts"} by name, contact, phone, email or address...`}
            />
          </div>
          <div className="party-count">
            <b>{currentVisibleAccounts.length}</b>
            <span>records shown</span>
          </div>
        </div>

        {currentVisibleAccounts.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">PV</div>
            <h3>
              {accountView === "UNASSIGNED"
                ? "No accounts need classification"
                : `No ${accountView === "PARTY" ? "parties" : "vendors"} created yet`}
            </h3>
            <p>
              {accountView === "UNASSIGNED"
                ? "All existing master accounts have been classified."
                : `Create your first ${accountView === "PARTY" ? "Party" : "Vendor"} account.`}
            </p>
            {can("edit_parties") && accountView !== "UNASSIGNED" && (
              <button className="primary" onClick={() => newParty(accountView === "VENDOR" ? "VENDOR" : "PARTY")}>
                Create First {accountView === "PARTY" ? "Party" : "Vendor"}
              </button>
            )}
          </div>
        ) : (
          <div className="party-table-wrap">
            <table className="party-table">
              <thead>
                <tr>
                  <th>SR</th>
                  <th>
                    {accountView === "PARTY" ? "PARTY NAME" : accountView === "VENDOR" ? "VENDOR NAME" : "ACCOUNT NAME"}
                  </th>
                  <th>PHONE / WHATSAPP</th>
                  <th>ADDRESS</th>
                  <th>STATUS</th>
                  <th>
                    {accountView === "PARTY" ? "RECEIVABLE" : accountView === "VENDOR" ? "PAYABLE" : "ACCOUNT BALANCE"}
                  </th>
                  <th>ACTIONS</th>
                </tr>
              </thead>
              <tbody>
                {currentVisibleAccounts.map((party, index) => {
                  const phone = party.phone || party.whatsapp || "";
                  const reference = party.reference || party.notes || "";
                  return (
                    <tr key={party.id}>
                      <td className="centered">{index + 1}</td>
                      <td>
                        <b className="party-name">{party.name}</b>
                        <small className={`account-type-chip ${party.account_type.toLowerCase()}`}>
                          {party.account_type}
                        </small>
                        {party.contact_person && <small className="table-note">Contact: {party.contact_person}</small>}
                        {reference && <small className="table-note">{reference}</small>}
                      </td>
                      <td>
                        <span>{phone || "—"}</span>
                        {party.email && <small className="table-note">{party.email}</small>}
                      </td>
                      <td>{party.address || "—"}</td>
                      <td>
                        <span className={`status ${party.status.toLowerCase()}`}>{party.status}</span>
                      </td>
                      <td className="amount">
                        {formatMoney(
                          (party.account_type === "PARTY"
                            ? partyBookingTotals[party.id]?.sale_total || 0
                            : party.account_type === "VENDOR"
                              ? partyBookingTotals[party.id]?.purchase_total || 0
                              : 0) - (partyPaymentTotals[party.id] || 0),
                        )}
                      </td>
                      <td>
                        <div className="row-actions">
                          <button onClick={() => openLedger(party)}>Open Ledger</button>
                          {can("edit_parties") && <button onClick={() => editParty(party)}>Edit</button>}
                          {can("edit_parties") && (
                            <button
                              className="danger"
                              onClick={async () => {
                                if (
                                  window.confirm(
                                    "Are you sure you want to permanently delete this Party/Vendor? This is a temporary testing function.",
                                  )
                                ) {
                                  try {
                                    await deleteParty(party.id, company?.id || "", session?.userId || "");
                                    await loadParties(partySearch);
                                  } catch (e) {
                                    alert(e instanceof Error ? e.message : String(e));
                                  }
                                }
                              }}
                            >
                              Delete
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {partyModalOpen && (
        <AccountFormModal
          title={
            editingParty
              ? `Edit ${partyForm.accountType === "VENDOR" ? "Vendor" : partyForm.accountType === "PARTY" ? "Party" : "Account"}`
              : `Add New ${partyForm.accountType === "VENDOR" ? "Vendor" : "Party"}`
          }
          error={error}
          busy={busy}
          primaryLabel={
            editingParty ? "Save Changes" : `Create ${partyForm.accountType === "VENDOR" ? "Vendor" : "Party"}`
          }
          onClose={() => setPartyModalOpen(false)}
          onSubmit={() => void saveParty()}
        >
          <AccountForm value={partyForm} onChange={setPartyForm} showAccountType={accountView === "UNASSIGNED"} />
        </AccountFormModal>
      )}
    </>
  );
}
