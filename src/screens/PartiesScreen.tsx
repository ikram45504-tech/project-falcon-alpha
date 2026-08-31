import { useState, useEffect } from "react";
import { useWorkspace } from "../WorkspaceContext";
import { useAuth } from "../AuthContext";
import { hasPermission } from "../permissions";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Party, PartyInput, createParty, updateParty, deleteParty } from "../db";

const blankParty: PartyInput = {
  name: "",
  phone: "",
  whatsapp: "",
  address: "",
  notes: "",
  status: "ACTIVE",
  accountType: "PARTY",
};

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
  const [partyForm, setPartyForm] = useState<PartyInput>(blankParty);
  const [editingParty, setEditingParty] = useState<Party | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const can = (permission: any) => hasPermission(session?.role, permission);

  // Deriving visible accounts based on URL param
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
    setPartyForm({ ...blankParty, accountType: type });
    setError("");
    setPartyModalOpen(true);
  }

  function editParty(party: Party) {
    if (!can("edit_parties")) {
      setError("Your role has read-only access to Party/Vendor accounts.");
      return;
    }
    setEditingParty(party);
    setPartyForm({
      name: party.name,
      phone: party.phone,
      whatsapp: party.whatsapp,
      address: party.address,
      notes: party.notes,
      status: party.status,
      accountType: party.account_type,
    });
    setError("");
    setPartyModalOpen(true);
  }

  async function saveParty() {
    if (!company || !session) return;
    if (!can("edit_parties")) return setError("Your role does not allow changing Party/Vendor accounts.");
    if (!partyForm.name.trim()) {
      setError(`${partyForm.accountType === "VENDOR" ? "Vendor" : "Party"} name is required.`);
      return;
    }

    setBusy(true);
    setError("");
    try {
      if (editingParty) {
        await updateParty(editingParty.id, company.id, partyForm, session.userId);
        setMessage(`${partyForm.accountType === "VENDOR" ? "Vendor" : "Party"} updated successfully.`);
      } else {
        await createParty(company.id, partyForm, session.userId);
        setMessage(`${partyForm.accountType === "VENDOR" ? "Vendor" : "Party"} created successfully.`);
      }

      setPartyModalOpen(false);
      setEditingParty(null);
      setPartyForm(blankParty);
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
              placeholder={`Search ${accountView === "PARTY" ? "parties" : accountView === "VENDOR" ? "vendors" : "accounts"} by name, phone, WhatsApp or address...`}
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
                {currentVisibleAccounts.map((party, index) => (
                  <tr key={party.id}>
                    <td className="centered">{index + 1}</td>
                    <td>
                      <b className="party-name">{party.name}</b>
                      <small className={`account-type-chip ${party.account_type.toLowerCase()}`}>
                        {party.account_type}
                      </small>
                      {party.notes && <small className="table-note">{party.notes}</small>}
                    </td>
                    <td>
                      <span>{party.phone || "—"}</span>
                      {party.whatsapp && <small className="table-note">WA: {party.whatsapp}</small>}
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
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {partyModalOpen && (
        <div className="modal-backdrop" onMouseDown={() => setPartyModalOpen(false)}>
          <section className="modal-card" onMouseDown={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <div>
                <span className="eyebrow blue">ACCOUNT MASTER</span>
                <h3>
                  {editingParty
                    ? `Edit ${partyForm.accountType === "VENDOR" ? "Vendor" : partyForm.accountType === "PARTY" ? "Party" : "Account"}`
                    : `Add New ${partyForm.accountType === "VENDOR" ? "Vendor" : "Party"}`}
                </h3>
              </div>
              <button className="close-btn" onClick={() => setPartyModalOpen(false)}>
                ×
              </button>
            </div>

            {error && <div className="alert error">{error}</div>}

            <div className="form">
              <label>
                {partyForm.accountType === "VENDOR"
                  ? "Vendor Name *"
                  : partyForm.accountType === "PARTY"
                    ? "Party Name *"
                    : "Account Name *"}
                <input
                  autoFocus
                  value={partyForm.name}
                  onChange={(e) => setPartyForm((prev) => ({ ...prev, name: e.target.value }))}
                  placeholder="e.g. Father Umrah Accounts"
                />
              </label>

              <div className="two">
                <label>
                  Phone
                  <input
                    value={partyForm.phone}
                    onChange={(e) => setPartyForm((prev) => ({ ...prev, phone: e.target.value }))}
                    placeholder="+92..."
                  />
                </label>
                <label>
                  WhatsApp
                  <input
                    value={partyForm.whatsapp}
                    onChange={(e) => setPartyForm((prev) => ({ ...prev, whatsapp: e.target.value }))}
                    placeholder="+92..."
                  />
                </label>
              </div>

              <label>
                Address
                <textarea
                  rows={2}
                  value={partyForm.address}
                  onChange={(e) => setPartyForm((prev) => ({ ...prev, address: e.target.value }))}
                  placeholder="Optional address"
                />
              </label>

              <label>
                Notes
                <textarea
                  rows={3}
                  value={partyForm.notes}
                  onChange={(e) => setPartyForm((prev) => ({ ...prev, notes: e.target.value }))}
                  placeholder="Optional internal note"
                />
              </label>

              {accountView === "UNASSIGNED" && (
                <label>
                  Account Type *
                  <select
                    value={partyForm.accountType}
                    onChange={(e) =>
                      setPartyForm((prev) => ({
                        ...prev,
                        accountType: e.target.value as "PARTY" | "VENDOR" | "UNASSIGNED",
                      }))
                    }
                  >
                    <option value="PARTY">PARTY — Sale / Receivable</option>
                    <option value="VENDOR">VENDOR — Purchase / Payable</option>
                    <option value="UNASSIGNED">UNASSIGNED — classify later</option>
                  </select>
                </label>
              )}

              <label>
                Status
                <select
                  value={partyForm.status}
                  onChange={(e) =>
                    setPartyForm((prev) => ({
                      ...prev,
                      status: e.target.value as "ACTIVE" | "INACTIVE",
                    }))
                  }
                >
                  <option value="ACTIVE">ACTIVE</option>
                  <option value="INACTIVE">INACTIVE</option>
                </select>
              </label>
            </div>

            <div className="modal-buttons">
              <button className="secondary" onClick={() => setPartyModalOpen(false)}>
                Cancel
              </button>
              <button className="primary" onClick={saveParty} disabled={busy}>
                {busy
                  ? "Saving..."
                  : editingParty
                    ? "Save Changes"
                    : `Create ${partyForm.accountType === "VENDOR" ? "Vendor" : "Party"}`}
              </button>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
