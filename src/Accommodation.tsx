import { useEffect, useMemo, useState } from "react";
import {
  AccommodationEntry,
  AccommodationInput,
  Party,
  createAccommodation,
  getAccommodations,
  updateAccommodation,
  voidAccommodation,
} from "./db";

type AccommodationFormState = {
  partyId: string;
  transactionDate: string;
  ubNumber: string;
  bookingPartyName: string;
  city: string;
  hotelName: string;
  checkIn: string;
  checkOut: string;
  nights: string;
  rate: string;
  bedRoomCount: string;
  currency: "PKR" | "SAR";
  roe: string;
};

type ModalProps = {
  companyId: string;
  parties: Party[];
  initialPartyId?: string;
  editing?: AccommodationEntry | null;
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

function parseIsoDate(value: string) {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function dateDifferenceNights(checkIn: string, checkOut: string) {
  const start = parseIsoDate(checkIn);
  const end = parseIsoDate(checkOut);
  if (!start || !end) return 0;
  const diff = Math.round((end.getTime() - start.getTime()) / 86_400_000);
  return Math.max(0, diff);
}

function addDays(dateValue: string, days: number) {
  const date = parseIsoDate(dateValue);
  if (!date || days <= 0) return "";
  date.setDate(date.getDate() + days);
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60_000).toISOString().slice(0, 10);
}

export function formatDate(value: string) {
  const date = parseIsoDate(value);
  if (!date) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date).replace(/ /g, "-");
}

export function formatMoney(value: number) {
  return `Rs ${Math.round(Number(value) || 0).toLocaleString("en-PK")}`;
}

export function formatNumber(value: number, decimals = 2) {
  const number = Number(value) || 0;
  return number.toLocaleString("en-US", {
    maximumFractionDigits: decimals,
    minimumFractionDigits: Number.isInteger(number) ? 0 : Math.min(2, decimals),
  });
}

function blankForm(initialPartyId = ""): AccommodationFormState {
  return {
    partyId: initialPartyId,
    transactionDate: todayIso(),
    ubNumber: "",
    bookingPartyName: "",
    city: "",
    hotelName: "",
    checkIn: "",
    checkOut: "",
    nights: "",
    rate: "",
    bedRoomCount: "",
    currency: "PKR",
    roe: "",
  };
}

function entryToForm(entry: AccommodationEntry): AccommodationFormState {
  return {
    partyId: entry.party_id,
    transactionDate: entry.transaction_date,
    ubNumber: entry.ub_number,
    bookingPartyName: entry.booking_party_name,
    city: entry.city,
    hotelName: entry.hotel_name,
    checkIn: entry.check_in,
    checkOut: entry.check_out,
    nights: String(entry.nights || ""),
    rate: String(entry.rate || ""),
    bedRoomCount: String(entry.bed_room_count || ""),
    currency: entry.currency,
    roe: entry.currency === "SAR" ? String(entry.roe || "") : "",
  };
}

function calculatePreview(form: AccommodationFormState) {
  const nights = Math.max(0, Number(form.nights) || 0);
  const beds = Math.max(0, Number(form.bedRoomCount) || 0);
  const rate = Math.max(0, Number(form.rate) || 0);
  const base = nights * beds * rate;

  if (form.currency === "SAR") {
    const roe = Math.max(0, Number(form.roe) || 0);
    return { totalSar: base, totalPkr: base * roe };
  }

  return { totalSar: 0, totalPkr: base };
}

function toDbInput(form: AccommodationFormState): AccommodationInput {
  return {
    partyId: form.partyId,
    transactionDate: form.transactionDate,
    ubNumber: form.ubNumber,
    bookingPartyName: form.bookingPartyName,
    city: form.city,
    hotelName: form.hotelName,
    checkIn: form.checkIn,
    checkOut: form.checkOut,
    nights: Number(form.nights) || 0,
    rate: Number(form.rate) || 0,
    bedRoomCount: Number(form.bedRoomCount) || 0,
    currency: form.currency,
    roe: form.currency === "SAR" ? Number(form.roe) || 0 : 0,
  };
}

export function AccommodationFormModal({
  companyId,
  parties,
  initialPartyId = "",
  editing = null,
  onClose,
  onSaved,
}: ModalProps) {
  const [form, setForm] = useState<AccommodationFormState>(
    editing ? entryToForm(editing) : blankForm(initialPartyId)
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setForm(editing ? entryToForm(editing) : blankForm(initialPartyId));
    setError("");
  }, [editing, initialPartyId]);

  const preview = useMemo(() => calculatePreview(form), [form]);

  function patch<K extends keyof AccommodationFormState>(
    key: K,
    value: AccommodationFormState[K]
  ) {
    setError("");
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function changeCheckIn(value: string) {
    setError("");
    setForm((prev) => {
      const next = { ...prev, checkIn: value };
      if (value && prev.checkOut) {
        const nights = dateDifferenceNights(value, prev.checkOut);
        next.nights = nights > 0 ? String(nights) : "";
      } else if (value && Number(prev.nights) > 0) {
        next.checkOut = addDays(value, Number(prev.nights));
      }
      return next;
    });
  }

  function changeCheckOut(value: string) {
    setError("");
    setForm((prev) => {
      const nights = dateDifferenceNights(prev.checkIn, value);
      return {
        ...prev,
        checkOut: value,
        nights: nights > 0 ? String(nights) : "",
      };
    });
  }

  function changeNights(value: string) {
    const normalized = value.replace(/[^\d]/g, "");
    setError("");
    setForm((prev) => {
      const nights = Number(normalized) || 0;
      return {
        ...prev,
        nights: normalized,
        checkOut:
          prev.checkIn && nights > 0 ? addDays(prev.checkIn, nights) : prev.checkOut,
      };
    });
  }

  async function save() {
    if (!form.partyId) return setError("Select a Party / Vendor account.");
    if (!form.transactionDate) return setError("Transaction date is required.");
    if (!form.bookingPartyName.trim()) return setError("Party Name is required.");
    if (!form.city.trim()) return setError("City is required.");
    if (!form.hotelName.trim()) return setError("Hotel Name is required.");
    if (!form.checkIn) return setError("Check-In date is required.");
    if (!form.checkOut) return setError("Check-Out date is required.");
    if ((Number(form.nights) || 0) <= 0) return setError("No. of Nights must be greater than zero.");
    if ((Number(form.rate) || 0) <= 0) return setError("Rate must be greater than zero.");
    if ((Number(form.bedRoomCount) || 0) <= 0) return setError("No. of Bed/Room must be greater than zero.");
    if (form.currency === "SAR" && (Number(form.roe) || 0) <= 0) {
      return setError("ROE is required for a SAR transaction.");
    }

    const checkIn = parseIsoDate(form.checkIn);
    const checkOut = parseIsoDate(form.checkOut);
    if (!checkIn || !checkOut || checkOut <= checkIn) {
      return setError("Check-Out must be after Check-In.");
    }

    setBusy(true);
    setError("");
    try {
      if (editing) {
        await updateAccommodation(companyId, editing.id, toDbInput(form));
      } else {
        await createAccommodation(companyId, toDbInput(form));
      }
      await onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const activeParties = parties.filter((party) => party.status === "ACTIVE");

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <section
        className="modal-card accommodation-modal"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal-head">
          <div>
            <span className="eyebrow blue">ACCOMMODATION ENTRY</span>
            <h3>{editing ? "Edit Accommodation" : "Add Accommodation"}</h3>
          </div>
          <button className="close-btn" onClick={onClose}>×</button>
        </div>

        {error && <div className="alert error">{error}</div>}

        <div className="accommodation-form-grid">
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
              placeholder="e.g. Chohan 20 Pax"
            />
          </label>

          <label>
            City *
            <input
              value={form.city}
              onChange={(e) => patch("city", e.target.value)}
              placeholder="e.g. Makkah"
            />
          </label>

          <label>
            Hotel Name *
            <input
              value={form.hotelName}
              onChange={(e) => patch("hotelName", e.target.value)}
              placeholder="Hotel name"
            />
          </label>

          <label>
            Check-In *
            <input
              type="date"
              value={form.checkIn}
              onChange={(e) => changeCheckIn(e.target.value)}
            />
          </label>

          <label>
            Check-Out *
            <input
              type="date"
              value={form.checkOut}
              onChange={(e) => changeCheckOut(e.target.value)}
            />
          </label>

          <label>
            No. of Nights *
            <input
              inputMode="numeric"
              value={form.nights}
              onChange={(e) => changeNights(e.target.value)}
              placeholder="0"
            />
            <small className="field-hint">Auto-calculated from Check-In / Check-Out.</small>
          </label>

          <label>
            No. of Bed/Room *
            <input
              inputMode="numeric"
              value={form.bedRoomCount}
              onChange={(e) => patch("bedRoomCount", e.target.value.replace(/[^\d]/g, ""))}
              placeholder="0"
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
            Rate ({form.currency}) *
            <input
              type="number"
              min="0"
              step="0.01"
              value={form.rate}
              onChange={(e) => patch("rate", e.target.value)}
              placeholder="0.00"
            />
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

        <div className="calculation-preview">
          <div>
            <small>CALCULATION</small>
            <b>{form.rate || "0"} × {form.nights || "0"} × {form.bedRoomCount || "0"}</b>
          </div>
          <div>
            <small>TOTAL SAR</small>
            <b>{form.currency === "SAR" ? `SAR ${formatNumber(preview.totalSar)}` : "—"}</b>
          </div>
          <div className="highlight">
            <small>TOTAL PKR</small>
            <b>{formatMoney(preview.totalPkr)}</b>
          </div>
        </div>

        <div className="modal-buttons">
          <button className="secondary" onClick={onClose}>Cancel</button>
          <button className="primary" onClick={save} disabled={busy}>
            {busy ? "Saving..." : editing ? "Save Changes" : "Save Accommodation"}
          </button>
        </div>
      </section>
    </div>
  );
}

export function AccommodationModule({
  companyId,
  parties,
  onOpenLedger,
  onChanged,
}: ModuleProps) {
  const [entries, setEntries] = useState<AccommodationEntry[]>([]);
  const [search, setSearch] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<AccommodationEntry | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function load(value = search) {
    try {
      setEntries(await getAccommodations(companyId, value));
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
    setMessage(editing ? "Accommodation updated successfully." : "Accommodation saved successfully.");
    setError("");
    setEditing(null);
    await load();
    await onChanged();
  }

  async function voidEntry(entry: AccommodationEntry) {
    if (!window.confirm(`Void accommodation entry for ${entry.booking_party_name}?`)) return;

    try {
      await voidAccommodation(companyId, entry.id);
      setMessage("Accommodation entry marked VOID.");
      setError("");
      await load();
      await onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const partyById = new Map(parties.map((party) => [party.id, party]));

  return (
    <section className="content-card accommodation-page">
      <div className="page-title">
        <div>
          <span className="eyebrow blue">HOTEL PURCHASES</span>
          <h2>Accommodation</h2>
          <p>Record hotel purchases in PKR or SAR and post them to Party / Vendor ledgers.</p>
        </div>
        <button
          className="primary"
          onClick={() => {
            setEditing(null);
            setModalOpen(true);
          }}
          disabled={parties.filter((party) => party.status === "ACTIVE").length === 0}
        >
          + Add Accommodation
        </button>
      </div>

      {message && <div className="alert success">{message}</div>}
      {error && <div className="alert error">{error}</div>}

      {parties.length === 0 && (
        <div className="alert info">
          Create a Party / Vendor first. Every accommodation purchase must post to an account ledger.
        </div>
      )}

      <div className="module-summary-row">
        <div>
          <small>RECORDS SHOWN</small>
          <b>{entries.length}</b>
        </div>
        <div>
          <small>ACTIVE PURCHASE TOTAL</small>
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
            placeholder="Search UB, Party Name, City, Hotel or Ledger Account..."
          />
        </div>
      </div>

      {entries.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon hotel-icon">HT</div>
          <h3>No accommodation entries yet</h3>
          <p>Add your first hotel purchase after creating a Party / Vendor account.</p>
        </div>
      ) : (
        <div className="party-table-wrap accommodation-list-wrap">
          <table className="party-table accommodation-list-table">
            <thead>
              <tr>
                <th>DATE</th>
                <th>LEDGER ACCOUNT</th>
                <th>UB # / PARTY NAME</th>
                <th>CITY / HOTEL</th>
                <th>CHECK-IN / OUT</th>
                <th>NIGHTS</th>
                <th>RATE</th>
                <th>BED/ROOM</th>
                <th>TOTAL PKR</th>
                <th>STATUS</th>
                <th>ACTIONS</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id} className={entry.status === "VOID" ? "void-row" : ""}>
                  <td>{formatDate(entry.transaction_date)}</td>
                  <td>
                    <b className="party-name">{entry.ledger_party_name || "—"}</b>
                  </td>
                  <td>
                    <span>{entry.ub_number || "—"}</span>
                    <small className="table-note">{entry.booking_party_name}</small>
                  </td>
                  <td>
                    <span>{entry.city}</span>
                    <small className="table-note">{entry.hotel_name}</small>
                  </td>
                  <td>
                    <span>{formatDate(entry.check_in)}</span>
                    <small className="table-note">{formatDate(entry.check_out)}</small>
                  </td>
                  <td className="centered">{entry.nights}</td>
                  <td>
                    {entry.currency === "SAR"
                      ? `SAR ${formatNumber(entry.rate)}`
                      : formatMoney(entry.rate)}
                  </td>
                  <td className="centered">{entry.bed_room_count}</td>
                  <td className="amount">{formatMoney(entry.total_pkr)}</td>
                  <td>
                    <span className={`status ${entry.status.toLowerCase()}`}>{entry.status}</span>
                  </td>
                  <td>
                    <div className="row-actions">
                      <button
                        onClick={() => {
                          const party = partyById.get(entry.party_id);
                          if (party) onOpenLedger(party);
                        }}
                      >
                        Ledger
                      </button>
                      <button
                        disabled={entry.status === "VOID"}
                        onClick={() => {
                          setEditing(entry);
                          setModalOpen(true);
                        }}
                      >
                        Edit
                      </button>
                      <button
                        className="danger-action"
                        disabled={entry.status === "VOID"}
                        onClick={() => voidEntry(entry)}
                      >
                        Void
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modalOpen && (
        <AccommodationFormModal
          companyId={companyId}
          parties={parties}
          editing={editing}
          onClose={() => {
            setModalOpen(false);
            setEditing(null);
          }}
          onSaved={saved}
        />
      )}
    </section>
  );
}
