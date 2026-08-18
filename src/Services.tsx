import { useEffect, useMemo, useState } from "react";
import {
  Party,
  ServiceEntry,
  ServiceInput,
  createService,
  getServices,
  updateService,
  voidService,
} from "./db";
import { formatDate, formatMoney, formatNumber } from "./Accommodation";

type ServiceFormState = {
  partyId: string;
  transactionDate: string;
  ubNumber: string;
  bookingPartyName: string;
  serviceType: string;
  rate: string;
  pax: string;
  spt: string;
  shr: string;
  currency: "PKR" | "SAR";
  roe: string;
};

type ModalProps = {
  companyId: string;
  parties: Party[];
  initialPartyId?: string;
  editing?: ServiceEntry | null;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
};

type ModuleProps = {
  companyId: string;
  parties: Party[];
  onOpenLedger: (party: Party) => void;
  onChanged: () => void | Promise<void>;
};

function todayIso() {
  const now = new Date();
  const offset = now.getTimezoneOffset();
  return new Date(now.getTime() - offset * 60_000).toISOString().slice(0, 10);
}

function blankForm(initialPartyId = ""): ServiceFormState {
  return {
    partyId: initialPartyId,
    transactionDate: todayIso(),
    ubNumber: "",
    bookingPartyName: "",
    serviceType: "",
    rate: "",
    pax: "",
    spt: "",
    shr: "",
    currency: "PKR",
    roe: "",
  };
}

function entryToForm(entry: ServiceEntry): ServiceFormState {
  return {
    partyId: entry.party_id,
    transactionDate: entry.transaction_date,
    ubNumber: entry.ub_number,
    bookingPartyName: entry.booking_party_name,
    serviceType: entry.service_type,
    rate: String(entry.rate || ""),
    pax: String(entry.pax || ""),
    spt: String(entry.spt || ""),
    shr: String(entry.shr || ""),
    currency: entry.currency,
    roe: entry.currency === "SAR" ? String(entry.roe || "") : "",
  };
}

function calculatePreview(form: ServiceFormState) {
  const rate = Math.max(0, Number(form.rate) || 0);
  const pax = Math.max(0, Number(form.pax) || 0);
  const spt = Math.max(0, Number(form.spt) || 0);
  const shr = Math.max(0, Number(form.shr) || 0);
  const base = ((rate + shr) * pax) + spt;

  if (form.currency === "SAR") {
    const roe = Math.max(0, Number(form.roe) || 0);
    return { base, totalSar: base, totalPkr: base * roe };
  }

  return { base, totalSar: 0, totalPkr: base };
}

function toDbInput(form: ServiceFormState): ServiceInput {
  return {
    partyId: form.partyId,
    transactionDate: form.transactionDate,
    ubNumber: form.ubNumber,
    bookingPartyName: form.bookingPartyName,
    serviceType: form.serviceType,
    rate: Number(form.rate) || 0,
    pax: Number(form.pax) || 0,
    spt: Number(form.spt) || 0,
    shr: Number(form.shr) || 0,
    currency: form.currency,
    roe: form.currency === "SAR" ? Number(form.roe) || 0 : 0,
  };
}

export function ServiceFormModal({
  companyId,
  parties,
  initialPartyId = "",
  editing = null,
  onClose,
  onSaved,
}: ModalProps) {
  const [form, setForm] = useState<ServiceFormState>(
    editing ? entryToForm(editing) : blankForm(initialPartyId)
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setForm(editing ? entryToForm(editing) : blankForm(initialPartyId));
    setError("");
  }, [editing, initialPartyId]);

  const preview = useMemo(() => calculatePreview(form), [form]);
  const activeParties = parties.filter((party) => party.status === "ACTIVE");

  function patch<K extends keyof ServiceFormState>(key: K, value: ServiceFormState[K]) {
    setError("");
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function save() {
    if (!form.partyId) return setError("Select a Party / Vendor account.");
    if (!form.transactionDate) return setError("Transaction date is required.");
    if (!form.bookingPartyName.trim()) return setError("Party Name is required.");
    if (!form.serviceType.trim()) return setError("Service Type is required.");
    if ((Number(form.rate) || 0) <= 0) return setError("Rate must be greater than zero.");
    if ((Number(form.pax) || 0) <= 0) return setError("No. of Pax must be greater than zero.");
    if (form.currency === "SAR" && (Number(form.roe) || 0) <= 0) {
      return setError("ROE is required for a SAR transaction.");
    }

    setBusy(true);
    setError("");
    try {
      if (editing) {
        await updateService(companyId, editing.id, toDbInput(form));
      } else {
        await createService(companyId, toDbInput(form));
      }
      await onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <section className="modal-card service-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <span className="eyebrow green-text">SERVICE ENTRY</span>
            <h3>{editing ? "Edit Service" : "Add Service"}</h3>
          </div>
          <button className="close-btn" onClick={onClose}>×</button>
        </div>

        {error && <div className="alert error">{error}</div>}

        <div className="service-form-grid">
          <label className="span-2">
            Party / Vendor Account *
            <select
              value={form.partyId}
              onChange={(e) => patch("partyId", e.target.value)}
              disabled={Boolean(initialPartyId && !editing)}
            >
              <option value="">Select account...</option>
              {activeParties.map((party) => (
                <option key={party.id} value={party.id}>{party.name}</option>
              ))}
            </select>
          </label>

          <label>
            Date *
            <input
              type="date"
              value={form.transactionDate}
              onChange={(e) => patch("transactionDate", e.target.value)}
            />
          </label>

          <label>
            UB #
            <input
              value={form.ubNumber}
              onChange={(e) => patch("ubNumber", e.target.value)}
              placeholder="Optional UB / booking ref"
            />
          </label>

          <label className="span-2">
            Party Name *
            <input
              value={form.bookingPartyName}
              onChange={(e) => patch("bookingPartyName", e.target.value)}
              placeholder="e.g. Solangi 8 Pax"
            />
          </label>

          <label className="span-2">
            Service Type *
            <input
              value={form.serviceType}
              onChange={(e) => patch("serviceType", e.target.value)}
              placeholder="e.g. Full Package, Visa + Transport, Return Ticket"
            />
          </label>

          <label>
            Currency *
            <select
              value={form.currency}
              onChange={(e) => {
                const currency = e.target.value as "PKR" | "SAR";
                setForm((prev) => ({
                  ...prev,
                  currency,
                  roe: currency === "PKR" ? "" : prev.roe,
                }));
              }}
            >
              <option value="PKR">PKR — Pakistani Rupee</option>
              <option value="SAR">SAR — Saudi Riyal</option>
            </select>
          </label>

          <label>
            Rate Per Head ({form.currency}) *
            <input
              type="number"
              min="0"
              step="0.01"
              value={form.rate}
              onChange={(e) => patch("rate", e.target.value)}
              placeholder="0.00"
            />
          </label>

          <label>
            No. of Pax *
            <input
              inputMode="numeric"
              value={form.pax}
              onChange={(e) => patch("pax", e.target.value.replace(/[^\d]/g, ""))}
              placeholder="0"
            />
          </label>

          <label>
            SPT
            <input
              type="number"
              min="0"
              step="0.01"
              value={form.spt}
              onChange={(e) => patch("spt", e.target.value)}
              placeholder="0.00"
            />
            <small className="field-hint">One-time extra amount added after Pax calculation.</small>
          </label>

          <label>
            SHR
            <input
              type="number"
              min="0"
              step="0.01"
              value={form.shr}
              onChange={(e) => patch("shr", e.target.value)}
              placeholder="0.00"
            />
            <small className="field-hint">Per-head extra amount added to Rate.</small>
          </label>

          <label className={form.currency === "PKR" ? "muted-field" : ""}>
            ROE {form.currency === "SAR" ? "*" : ""}
            <input
              type="number"
              min="0"
              step="0.01"
              value={form.roe}
              onChange={(e) => patch("roe", e.target.value)}
              placeholder={form.currency === "SAR" ? "e.g. 76.50" : "Not required"}
              disabled={form.currency === "PKR"}
            />
          </label>
        </div>

        <div className="calculation-preview service-calculation-preview">
          <div>
            <small>CALCULATION</small>
            <b>({form.rate || "0"} + {form.shr || "0"}) × {form.pax || "0"} + {form.spt || "0"}</b>
          </div>
          <div>
            <small>TOTAL SAR</small>
            <b>{form.currency === "SAR" ? `SAR ${formatNumber(preview.totalSar)}` : "—"}</b>
          </div>
          <div className="highlight green-highlight">
            <small>TOTAL PKR</small>
            <b>{formatMoney(preview.totalPkr)}</b>
          </div>
        </div>

        <div className="modal-buttons">
          <button className="secondary" onClick={onClose}>Cancel</button>
          <button className="primary green-primary" onClick={save} disabled={busy}>
            {busy ? "Saving..." : editing ? "Save Changes" : "Save Service"}
          </button>
        </div>
      </section>
    </div>
  );
}

export function ServicesModule({
  companyId,
  parties,
  onOpenLedger,
  onChanged,
}: ModuleProps) {
  const [entries, setEntries] = useState<ServiceEntry[]>([]);
  const [search, setSearch] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<ServiceEntry | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function load(value = search) {
    try {
      setEntries(await getServices(companyId, value));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  useEffect(() => {
    load("");
  }, [companyId]);

  const activeTotal = useMemo(
    () => entries
      .filter((entry) => entry.status === "ACTIVE")
      .reduce((sum, entry) => sum + Number(entry.total_pkr || 0), 0),
    [entries]
  );

  async function saved() {
    setMessage(editing ? "Service updated successfully." : "Service saved successfully.");
    setError("");
    setEditing(null);
    await load();
    await onChanged();
  }

  async function voidEntry(entry: ServiceEntry) {
    if (!window.confirm(`Void service entry for ${entry.booking_party_name}?`)) return;

    try {
      await voidService(companyId, entry.id);
      setMessage("Service entry marked VOID.");
      setError("");
      await load();
      await onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const partyById = new Map(parties.map((party) => [party.id, party]));

  return (
    <section className="content-card services-page">
      <div className="page-title">
        <div>
          <span className="eyebrow green-text">VISA • TRANSPORT • TICKETS • PACKAGES</span>
          <h2>Services</h2>
          <p>Record service purchases in PKR or SAR and post them to Party / Vendor ledgers.</p>
        </div>
        <button
          className="primary green-primary"
          onClick={() => {
            setEditing(null);
            setModalOpen(true);
          }}
          disabled={parties.filter((party) => party.status === "ACTIVE").length === 0}
        >
          + Add Service
        </button>
      </div>

      {message && <div className="alert success">{message}</div>}
      {error && <div className="alert error">{error}</div>}

      {parties.length === 0 && (
        <div className="alert info">
          Create a Party / Vendor first. Every service purchase must post to an account ledger.
        </div>
      )}

      <div className="module-summary-row service-summary-row">
        <div>
          <small>RECORDS SHOWN</small>
          <b>{entries.length}</b>
        </div>
        <div>
          <small>ACTIVE SERVICE PURCHASE</small>
          <b>{formatMoney(activeTotal)}</b>
        </div>
      </div>

      <div className="party-toolbar">
        <div className="search-box">
          <span>⌕</span>
          <input
            value={search}
            onChange={async (e) => {
              const value = e.target.value;
              setSearch(value);
              await load(value);
            }}
            placeholder="Search UB, Party Name, Service Type or Ledger Account..."
          />
        </div>
      </div>

      {entries.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon service-icon">SV</div>
          <h3>No service entries yet</h3>
          <p>Add your first visa, transport, ticket or package purchase.</p>
        </div>
      ) : (
        <div className="party-table-wrap service-list-wrap">
          <table className="party-table service-list-table">
            <thead>
              <tr>
                <th>DATE</th>
                <th>LEDGER ACCOUNT</th>
                <th>UB # / PARTY NAME</th>
                <th>SERVICE TYPE</th>
                <th>RATE</th>
                <th>PAX</th>
                <th>SPT / SHR</th>
                <th>SAR / ROE</th>
                <th>TOTAL PKR</th>
                <th>STATUS</th>
                <th>ACTIONS</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id} className={entry.status === "VOID" ? "void-row" : ""}>
                  <td>{formatDate(entry.transaction_date)}</td>
                  <td><b className="party-name">{entry.ledger_party_name || "—"}</b></td>
                  <td>
                    <span>{entry.ub_number || "—"}</span>
                    <small className="table-note">{entry.booking_party_name}</small>
                  </td>
                  <td>{entry.service_type}</td>
                  <td>{entry.currency === "SAR" ? `SAR ${formatNumber(entry.rate)}` : formatMoney(entry.rate)}</td>
                  <td className="centered">{entry.pax}</td>
                  <td>
                    <span>SPT {formatNumber(entry.spt)}</span>
                    <small className="table-note">SHR {formatNumber(entry.shr)}</small>
                  </td>
                  <td>
                    {entry.currency === "SAR" ? (
                      <>
                        <span>SAR {formatNumber(entry.total_sar)}</span>
                        <small className="table-note">ROE {formatNumber(entry.roe)}</small>
                      </>
                    ) : "—"}
                  </td>
                  <td className="amount">{formatMoney(entry.total_pkr)}</td>
                  <td><span className={`status ${entry.status.toLowerCase()}`}>{entry.status}</span></td>
                  <td>
                    <div className="row-actions">
                      <button
                        disabled={entry.status === "VOID"}
                        onClick={() => { setEditing(entry); setModalOpen(true); }}
                      >Edit</button>
                      <button
                        className="danger-action"
                        disabled={entry.status === "VOID"}
                        onClick={() => voidEntry(entry)}
                      >Void</button>
                      <button
                        onClick={() => {
                          const party = partyById.get(entry.party_id);
                          if (party) onOpenLedger(party);
                        }}
                      >Ledger</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modalOpen && (
        <ServiceFormModal
          companyId={companyId}
          parties={parties}
          editing={editing}
          onClose={() => { setModalOpen(false); setEditing(null); }}
          onSaved={saved}
        />
      )}
    </section>
  );
}
