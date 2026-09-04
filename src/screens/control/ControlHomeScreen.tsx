import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  CompanyEntitlements,
  MasterCompanyRow,
  SEGMENT_LABELS,
  SegmentKey,
  companyStatusLabel,
  normalizeEntitlements,
} from "../../companyEntitlements";
import {
  listCompaniesForMaster,
  setCompanyEntitlementsForMaster,
  setCompanyStatusForMaster,
  wipeCompanyForMaster,
} from "../../platformMaster";

const SEGMENTS = Object.keys(SEGMENT_LABELS) as SegmentKey[];

function statusTone(status: string) {
  switch (String(status || "").toUpperCase()) {
    case "ACTIVE":
      return "ok";
    case "PENDING_APPROVAL":
      return "warn";
    case "SUSPENDED":
    case "INACTIVE":
      return "bad";
    default:
      return "";
  }
}

export default function ControlHomeScreen({ masterEmail }: { masterEmail: string }) {
  const [rows, setRows] = useState<MasterCompanyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [filter, setFilter] = useState<"ALL" | "PENDING_APPROVAL" | "ACTIVE" | "SUSPENDED">("ALL");
  const [selectedId, setSelectedId] = useState<string>("");
  const [draft, setDraft] = useState<CompanyEntitlements | null>(null);
  const [busyId, setBusyId] = useState("");

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const list = await listCompaniesForMaster();
      setRows(list);
      if (selectedId && !list.some((row) => row.id === selectedId)) {
        setSelectedId("");
        setDraft(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const pendingCount = useMemo(
    () => rows.filter((row) => String(row.status).toUpperCase() === "PENDING_APPROVAL").length,
    [rows],
  );

  const visible = useMemo(() => {
    if (filter === "ALL") return rows;
    return rows.filter((row) => String(row.status).toUpperCase() === filter);
  }, [rows, filter]);

  const selected = rows.find((row) => row.id === selectedId) || null;

  const openCompany = (row: MasterCompanyRow) => {
    setSelectedId(row.id);
    setDraft(normalizeEntitlements(row.entitlements));
    setMessage("");
    setError("");
  };

  const runStatus = async (companyId: string, status: "ACTIVE" | "PENDING_APPROVAL" | "SUSPENDED" | "INACTIVE") => {
    setBusyId(companyId);
    setError("");
    setMessage("");
    try {
      await setCompanyStatusForMaster(companyId, status);
      setMessage(`Status set to ${companyStatusLabel(status)}.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId("");
    }
  };

  const saveEntitlements = async (e: FormEvent) => {
    e.preventDefault();
    if (!selected || !draft) return;
    setBusyId(selected.id);
    setError("");
    setMessage("");
    try {
      await setCompanyEntitlementsForMaster(selected.id, draft);
      setMessage("Capacity saved.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId("");
    }
  };

  const wipeCompany = async () => {
    if (!selected) return;
    const code = selected.company_code;
    const name = selected.name;
    const confirmed = window.confirm(
      `Delete company "${name}" (${code}) permanently?\n\nThis removes ALL cloud bookings, payments, parties, users, and login accounts for this company. It cannot be undone.`,
    );
    if (!confirmed) return;
    const typed = window.prompt(`Type the Company Code ${code} to confirm permanent delete:`);
    if (
      String(typed || "")
        .trim()
        .toUpperCase() !== code.toUpperCase()
    ) {
      setError("Delete cancelled — Company Code did not match.");
      return;
    }
    setBusyId(selected.id);
    setError("");
    setMessage("");
    try {
      const result = await wipeCompanyForMaster(selected.id);
      setSelectedId("");
      setDraft(null);
      setMessage(
        `Deleted ${result.company_name} (${result.company_code}). Removed ${result.users_removed} user row(s) and ${result.auth_users_removed} login account(s).`,
      );
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId("");
    }
  };

  return (
    <div className="master-control-shell">
      <header className="master-control-topbar">
        <div>
          <div className="master-control-kicker">Master account</div>
          <h1>Control Panel</h1>
          <p className="muted">Approve companies and set limits. No booking or payment access.</p>
        </div>
        <div className="master-control-top-meta">
          <span>{masterEmail}</span>
          <span className="master-stat-pill">{pendingCount} pending</span>
          <button type="button" className="ghost" onClick={() => void load()} disabled={loading}>
            Refresh
          </button>
        </div>
      </header>

      {error && <div className="alert error">{error}</div>}
      {message && <div className="alert success">{message}</div>}

      <div className="master-control-layout">
        <section className="master-control-list card">
          <div className="master-filter-row">
            {(["ALL", "PENDING_APPROVAL", "ACTIVE", "SUSPENDED"] as const).map((item) => (
              <button
                key={item}
                type="button"
                className={filter === item ? "master-filter active" : "master-filter"}
                onClick={() => setFilter(item)}
              >
                {item === "ALL" ? "All" : companyStatusLabel(item)}
              </button>
            ))}
          </div>

          {loading ? (
            <p className="muted">Loading companies...</p>
          ) : visible.length === 0 ? (
            <p className="muted">No companies in this filter.</p>
          ) : (
            <ul className="master-company-list">
              {visible.map((row) => (
                <li key={row.id}>
                  <button
                    type="button"
                    className={selectedId === row.id ? "master-company-item active" : "master-company-item"}
                    onClick={() => openCompany(row)}
                  >
                    <div className="master-company-item-top">
                      <strong>{row.name}</strong>
                      <span className={`master-status ${statusTone(row.status)}`}>
                        {companyStatusLabel(row.status)}
                      </span>
                    </div>
                    <div className="muted">
                      {row.company_code} · {row.email || "no email"}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="master-control-detail card">
          {!selected || !draft ? (
            <p className="muted">Select a company to approve, suspend, or set capacity.</p>
          ) : (
            <>
              <div className="master-detail-head">
                <div>
                  <h2>{selected.name}</h2>
                  <p className="muted">
                    {selected.company_code} · {selected.email} · {selected.phone}
                  </p>
                </div>
                <span className={`master-status ${statusTone(selected.status)}`}>
                  {companyStatusLabel(selected.status)}
                </span>
              </div>

              <div className="master-action-row">
                <button
                  type="button"
                  className="primary"
                  disabled={busyId === selected.id || String(selected.status).toUpperCase() === "ACTIVE"}
                  onClick={() => void runStatus(selected.id, "ACTIVE")}
                >
                  Approve
                </button>
                <button
                  type="button"
                  disabled={busyId === selected.id || String(selected.status).toUpperCase() === "SUSPENDED"}
                  onClick={() => void runStatus(selected.id, "SUSPENDED")}
                >
                  Suspend
                </button>
                <button
                  type="button"
                  disabled={busyId === selected.id || String(selected.status).toUpperCase() === "PENDING_APPROVAL"}
                  onClick={() => void runStatus(selected.id, "PENDING_APPROVAL")}
                >
                  Set pending
                </button>
              </div>

              <div className="master-danger-zone">
                <h3>Delete company</h3>
                <p className="muted">
                  Permanently wipe this company from the cloud database — bookings, payments, parties, staff, and login
                  accounts. Frees Supabase storage for this tenant.
                </p>
                <button
                  type="button"
                  className="master-danger-button"
                  disabled={busyId === selected.id}
                  onClick={() => void wipeCompany()}
                >
                  {busyId === selected.id ? "Deleting..." : "Delete company & all data"}
                </button>
              </div>

              <form className="master-entitlements-form" onSubmit={(e) => void saveEntitlements(e)}>
                <h3>Segments</h3>
                <div className="master-check-grid">
                  {SEGMENTS.map((key) => (
                    <label key={key} className="master-check">
                      <input
                        type="checkbox"
                        checked={draft.segments[key]}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            segments: { ...draft.segments, [key]: e.target.checked },
                          })
                        }
                      />
                      {SEGMENT_LABELS[key]}
                    </label>
                  ))}
                </div>

                <h3>Features</h3>
                <div className="master-check-grid">
                  <label className="master-check">
                    <input
                      type="checkbox"
                      checked={draft.features.booking_adjustments}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          features: { ...draft.features, booking_adjustments: e.target.checked },
                        })
                      }
                    />
                    Booking adjustments
                  </label>
                  <label className="master-check">
                    <input
                      type="checkbox"
                      checked={draft.features.statements}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          features: { ...draft.features, statements: e.target.checked },
                        })
                      }
                    />
                    Statements
                  </label>
                  <label className="master-check">
                    <input
                      type="checkbox"
                      checked={draft.features.pnl}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          features: { ...draft.features, pnl: e.target.checked },
                        })
                      }
                    />
                    P&amp;L
                  </label>
                </div>

                <h3>Limits</h3>
                <p className="muted" style={{ marginTop: 0 }}>
                  Leave blank for unlimited. Limits apply when creating parties, staff, and bookings.
                </p>
                <div className="master-limit-grid">
                  {(
                    [
                      ["bookings_per_segment", "Bookings per segment"],
                      ["parties", "Parties"],
                      ["vendors", "Vendors"],
                      ["staff_users", "Staff users"],
                    ] as const
                  ).map(([key, label]) => (
                    <label key={key}>
                      {label}
                      <input
                        type="number"
                        min={0}
                        placeholder="Unlimited"
                        value={draft.limits[key] ?? ""}
                        onChange={(e) => {
                          const raw = e.target.value.trim();
                          setDraft({
                            ...draft,
                            limits: {
                              ...draft.limits,
                              [key]: raw === "" ? null : Math.max(0, Math.floor(Number(raw) || 0)),
                            },
                          });
                        }}
                      />
                    </label>
                  ))}
                </div>

                <button className="primary" type="submit" disabled={busyId === selected.id}>
                  {busyId === selected.id ? "Saving..." : "Save capacity"}
                </button>
              </form>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
