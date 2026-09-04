import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  CompanyEntitlements,
  ENTITLEMENT_PLANS,
  EntitlementPlanId,
  MasterCompanyRow,
  SEGMENT_LABELS,
  SegmentKey,
  companyStatusLabel,
  entitlementsFromPlan,
  normalizeEntitlements,
} from "../../companyEntitlements";
import {
  listCompaniesForMaster,
  setCompanyEntitlementsForMaster,
  setCompanyStatusForMaster,
  wipeCompanyForMaster,
} from "../../platformMaster";
import { hardResetPwaCache } from "../../registerPwa";
import { ControlTheme } from "./controlTheme";

const SEGMENTS = Object.keys(SEGMENT_LABELS) as SegmentKey[];

type CompanySort = "name_asc" | "status" | "newest";

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

function statusSortRank(status: string) {
  switch (String(status || "").toUpperCase()) {
    case "PENDING_APPROVAL":
      return 0;
    case "ACTIVE":
      return 1;
    case "SUSPENDED":
      return 2;
    case "INACTIVE":
      return 3;
    default:
      return 4;
  }
}

function companyMatchesSearch(row: MasterCompanyRow, query: string) {
  const clean = query.trim().toLowerCase();
  if (!clean) return true;
  const haystack = [row.name, row.company_code, row.email, row.phone].filter(Boolean).join(" ").toLowerCase();
  return haystack.includes(clean);
}

type Props = {
  masterEmail: string;
  theme: ControlTheme;
  onThemeChange: (theme: ControlTheme) => void;
  onSignOut: () => void;
};

export default function ControlHomeScreen({ masterEmail, theme, onThemeChange, onSignOut }: Props) {
  const [rows, setRows] = useState<MasterCompanyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [filter, setFilter] = useState<"ALL" | "PENDING_APPROVAL" | "ACTIVE" | "SUSPENDED">("ALL");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<CompanySort>("newest");
  const [planId, setPlanId] = useState<EntitlementPlanId | "">("");
  const [selectedId, setSelectedId] = useState<string>("");
  const [draft, setDraft] = useState<CompanyEntitlements | null>(null);
  const [busyId, setBusyId] = useState("");
  const [cacheBusy, setCacheBusy] = useState(false);
  const [isNarrow, setIsNarrow] = useState(() =>
    typeof window !== "undefined" ? window.matchMedia("(max-width: 900px)").matches : false,
  );

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 900px)");
    const sync = () => setIsNarrow(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

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
    const filtered = rows.filter((row) => {
      if (filter !== "ALL" && String(row.status).toUpperCase() !== filter) return false;
      return companyMatchesSearch(row, search);
    });
    return [...filtered].sort((a, b) => {
      if (sort === "name_asc") return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
      if (sort === "status") {
        const rank = statusSortRank(a.status) - statusSortRank(b.status);
        if (rank !== 0) return rank;
        return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
      }
      // newest first
      return String(b.created_at || "").localeCompare(String(a.created_at || "")) || a.name.localeCompare(b.name);
    });
  }, [rows, filter, search, sort]);

  const selected = rows.find((row) => row.id === selectedId) || null;
  const showDetail = Boolean(selected && draft);
  const layoutClass = isNarrow ? (showDetail ? "mobile-detail" : "mobile-list") : "";
  const selectedPlan = planId ? ENTITLEMENT_PLANS.find((plan) => plan.id === planId) : undefined;

  const openCompany = (row: MasterCompanyRow) => {
    setSelectedId(row.id);
    setDraft(normalizeEntitlements(row.entitlements));
    setPlanId("");
    setMessage("");
    setError("");
  };

  const closeDetail = () => {
    setSelectedId("");
    setDraft(null);
    setPlanId("");
  };

  const applyPlanToDraft = () => {
    if (!planId || !draft) return;
    setDraft(entitlementsFromPlan(planId));
    const plan = ENTITLEMENT_PLANS.find((item) => item.id === planId);
    setMessage(
      plan
        ? `Applied ${plan.label} plan to the form. Click Save capacity to persist.`
        : "Plan applied to the form. Click Save capacity to persist.",
    );
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

  const clearCacheAndReload = async () => {
    setCacheBusy(true);
    setError("");
    setMessage("Clearing cache and loading the latest Control Panel…");
    try {
      await hardResetPwaCache({ path: "/control" });
    } catch (err) {
      setCacheBusy(false);
      setError(err instanceof Error ? err.message : String(err));
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
          <div className="master-theme-switch" role="group" aria-label="Control Panel theme">
            <button type="button" className={theme === "dark" ? "active" : ""} onClick={() => onThemeChange("dark")}>
              Dark
            </button>
            <button type="button" className={theme === "ocean" ? "active" : ""} onClick={() => onThemeChange("ocean")}>
              Ocean
            </button>
          </div>
          <span className="master-email-chip" title={masterEmail}>
            {masterEmail}
          </span>
          <span className="master-stat-pill">{pendingCount} pending</span>
          <button type="button" className="ghost" onClick={() => void load()} disabled={loading || cacheBusy}>
            Reload list
          </button>
          <button
            type="button"
            className="ghost master-cache-refresh"
            onClick={() => void clearCacheAndReload()}
            disabled={cacheBusy}
            title="Clear PWA/browser cache and reload the latest deployment"
          >
            {cacheBusy ? "Updating…" : "Clear cache & reload"}
          </button>
          <button type="button" className="ghost" onClick={onSignOut} disabled={cacheBusy}>
            Sign out
          </button>
        </div>
      </header>

      {error && <div className="alert error">{error}</div>}
      {message && <div className="alert success">{message}</div>}

      <div className={`master-control-layout ${layoutClass}`.trim()}>
        <section className="master-control-list">
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

          <div className="master-list-tools">
            <label className="master-search-box">
              <span className="master-search-icon" aria-hidden="true">
                ⌕
              </span>
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search name, code, email…"
                aria-label="Search companies"
              />
            </label>
            <label className="master-sort-box">
              Sort
              <select value={sort} onChange={(e) => setSort(e.target.value as CompanySort)} aria-label="Sort companies">
                <option value="newest">Newest first</option>
                <option value="name_asc">Name A–Z</option>
                <option value="status">Status</option>
              </select>
            </label>
          </div>

          {loading ? (
            <p className="muted">Loading companies...</p>
          ) : visible.length === 0 ? (
            <p className="muted">
              {search.trim() ? "No companies match this search." : "No companies in this filter."}
            </p>
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
                      {row.phone ? ` · ${row.phone}` : ""}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="master-control-detail">
          {!selected || !draft ? (
            <div className="master-empty-detail">
              <p className="muted">Select a company to approve, suspend, set capacity, or delete.</p>
            </div>
          ) : (
            <>
              <div className="master-back-row">
                <button type="button" className="ghost" onClick={closeDetail}>
                  ← Back to companies
                </button>
              </div>

              <div className="master-detail-head">
                <div>
                  <h2>{selected.name}</h2>
                  <p className="muted">
                    {selected.company_code} · {selected.email || "no email"}
                    {selected.phone ? ` · ${selected.phone}` : ""}
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
                <h3>Plan template</h3>
                <p className="muted" style={{ marginTop: 0 }}>
                  Apply a preset into this form, then click <strong>Save capacity</strong> to store it.
                </p>
                <div className="master-plan-row">
                  <label className="master-plan-select">
                    Plan
                    <select
                      value={planId}
                      onChange={(e) => setPlanId(e.target.value as EntitlementPlanId | "")}
                      aria-label="Entitlement plan template"
                    >
                      <option value="">Custom (current form)</option>
                      {ENTITLEMENT_PLANS.map((plan) => (
                        <option key={plan.id} value={plan.id}>
                          {plan.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button type="button" className="ghost" disabled={!planId} onClick={applyPlanToDraft}>
                    Apply plan
                  </button>
                </div>
                {selectedPlan ? <p className="master-plan-hint muted">{selectedPlan.description}</p> : null}

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
                      <span className="master-check-label">{SEGMENT_LABELS[key]}</span>
                      <span className="master-check-state" aria-hidden="true">
                        {draft.segments[key] ? "On" : "Off"}
                      </span>
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
                    <span className="master-check-label">Booking adjustments</span>
                    <span className="master-check-state" aria-hidden="true">
                      {draft.features.booking_adjustments ? "On" : "Off"}
                    </span>
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
                    <span className="master-check-label">Statements</span>
                    <span className="master-check-state" aria-hidden="true">
                      {draft.features.statements ? "On" : "Off"}
                    </span>
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
                    <span className="master-check-label">P&amp;L</span>
                    <span className="master-check-state" aria-hidden="true">
                      {draft.features.pnl ? "On" : "Off"}
                    </span>
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
