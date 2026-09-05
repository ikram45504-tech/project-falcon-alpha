import { FormEvent, useEffect, useMemo, useState } from "react";
import { readControlWorkspace, writeControlWorkspace } from "../../controlWorkspace";
import {
  CompanyEntitlements,
  ENTITLEMENT_PLANS,
  EntitlementPlanId,
  MasterCompanyRow,
  SEGMENT_LABELS,
  SegmentKey,
  applyPlanFloors,
  companyStatusLabel,
  entitlementsFromPlan,
  getEntitlementPlan,
  getPlanLimitFloors,
  isFloorLockedPlan,
  isPaidEntitlementPlan,
  normalizeEntitlements,
} from "../../companyEntitlements";
import MasterPlanRateBox from "./MasterPlanRateBox";
import {
  listCompaniesForMaster,
  getCompanyUsageForMaster,
  extendCompanyAccessForMaster,
  setCompanyAccessEndsAtForMaster,
  setCompanyEntitlementsForMaster,
  assignCompanyPlanForMaster,
  setCompanyStatusForMaster,
  wipeCompanyForMaster,
  type MasterCompanyUsage,
} from "../../platformMaster";
import { accessDaysRemaining, formatAccessEndsAt } from "../../companyAccess";
import { hardResetPwaCache } from "../../registerPwa";
import { ControlTheme } from "./controlTheme";
import MasterCreateCompany, { CreatedCredentialsCard, type CreatedCredentials } from "./MasterCreateCompany";

const SEGMENTS = Object.keys(SEGMENT_LABELS) as SegmentKey[];

function statusTone(status: string) {
  switch (String(status || "").toUpperCase()) {
    case "ACTIVE":
      return "ok";
    case "PENDING_APPROVAL":
      return "warn";
    case "SUSPENDED":
    case "REVOKED":
    case "INACTIVE":
      return "bad";
    default:
      return "";
  }
}

function formatUsage(used: number, limit: number | null) {
  if (limit == null) return `${used} / Unlimited`;
  return `${used} / ${limit}`;
}

function usageTone(used: number, limit: number | null) {
  if (limit == null) return "";
  if (used >= limit) return "full";
  if (used / limit >= 0.9) return "warn";
  return "";
}

const FEATURE_ROWS: Array<[keyof CompanyEntitlements["features"], string]> = [
  ["booking_adjustments", "Booking adjustments"],
  ["statements", "Statements"],
  ["statement_print", "Statement print view"],
  ["pnl", "P&L"],
  ["payment_receipts", "Payment receipts"],
  ["additional_booking_details", "Additional booking details"],
];

const CAPACITY_LIMITS: Array<{
  key: keyof CompanyEntitlements["limits"];
  label: string;
  usage: "parties" | "vendors" | "staff" | "bookings" | "payments" | "none";
}> = [
  { key: "bookings_per_party", label: "Bookings per party", usage: "bookings" },
  { key: "bookings_per_vendor", label: "Bookings per vendor", usage: "bookings" },
  { key: "payments_per_party", label: "Payments per party", usage: "payments" },
  { key: "payments_per_vendor", label: "Payments per vendor", usage: "payments" },
  { key: "parties", label: "Parties", usage: "parties" },
  { key: "vendors", label: "Vendors", usage: "vendors" },
  { key: "staff_users", label: "Team Staff (Employee)", usage: "staff" },
  { key: "adjustment_revisions", label: "Adjustment revisions", usage: "none" },
  { key: "corrections", label: "Corrections", usage: "none" },
];

type Props = {
  masterEmail: string;
  theme: ControlTheme;
  onThemeChange: (theme: ControlTheme) => void;
  onSignOut: () => void;
};

export default function ControlHomeScreen({ theme, onThemeChange, onSignOut }: Props) {
  const restored = useMemo(() => readControlWorkspace(), []);
  const [rows, setRows] = useState<MasterCompanyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [filter, setFilter] = useState<"ALL" | "ACTIVE" | "SUSPENDED" | "REVOKED">(restored.filter);
  const [mainTab, setMainTab] = useState<"approved" | "pending">(restored.mainTab);
  const [pendingSearch, setPendingSearch] = useState("");
  const [planId, setPlanId] = useState<EntitlementPlanId | "">(restored.planId);
  const [selectedId, setSelectedId] = useState<string>(restored.selectedId);
  const [draft, setDraft] = useState<CompanyEntitlements | null>(restored.draft);
  const [usage, setUsage] = useState<MasterCompanyUsage | null>(null);
  const [usageLoading, setUsageLoading] = useState(false);
  const [createOpen, setCreateOpen] = useState(restored.createOpen);
  const [createdCreds, setCreatedCreds] = useState<CreatedCredentials | null>(null);
  const [busyId, setBusyId] = useState("");
  const [cacheBusy, setCacheBusy] = useState(false);
  const [rejectTarget, setRejectTarget] = useState<MasterCompanyRow | null>(null);

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
      return list;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return [] as MasterCompanyRow[];
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    writeControlWorkspace({
      selectedId,
      mainTab,
      filter,
      planId,
      draft,
      createOpen,
    });
  }, [selectedId, mainTab, filter, planId, draft, createOpen]);

  useEffect(() => {
    if (!selectedId || draft || createOpen) return;
    const row = rows.find((item) => item.id === selectedId);
    if (row) openCompany(row);
  }, [rows, selectedId, draft, createOpen]);

  const pendingCount = useMemo(
    () => rows.filter((row) => String(row.status).toUpperCase() === "PENDING_APPROVAL").length,
    [rows],
  );

  const pendingRows = useMemo(() => {
    const tokens = pendingSearch.trim().toLowerCase().split(/\s+/).filter(Boolean);

    return rows
      .filter((row) => String(row.status).toUpperCase() === "PENDING_APPROVAL")
      .filter((row) => {
        if (tokens.length === 0) return true;
        const name = String(row.name || "").toLowerCase();
        const code = String(row.company_code || "").toLowerCase();
        const email = String(row.email || "").toLowerCase();
        const phone = String(row.phone || "").toLowerCase();
        const phoneDigits = phone.replace(/\D/g, "");
        return tokens.every((token) => {
          const tokenDigits = token.replace(/\D/g, "");
          return (
            name.includes(token) ||
            code.includes(token) ||
            email.includes(token) ||
            phone.includes(token) ||
            (tokenDigits.length > 0 && phoneDigits.includes(tokenDigits))
          );
        });
      })
      .sort(
        (a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")) || a.name.localeCompare(b.name),
      );
  }, [rows, pendingSearch]);

  const visible = useMemo(() => {
    const filtered = rows.filter((row) => {
      const status = String(row.status).toUpperCase();
      if (status === "PENDING_APPROVAL") return false;
      if (filter === "ACTIVE") return status === "ACTIVE";
      if (filter === "SUSPENDED") return status === "SUSPENDED";
      if (filter === "REVOKED") return status === "REVOKED";
      return status === "ACTIVE" || status === "SUSPENDED" || status === "REVOKED" || status === "INACTIVE";
    });
    return [...filtered].sort(
      (a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")) || a.name.localeCompare(b.name),
    );
  }, [rows, filter]);

  const selected = rows.find((row) => row.id === selectedId) || null;
  const showCreate = createOpen || Boolean(createdCreds);
  const activePlanId = planId || draft?.planId || "";
  const floorPlan = isFloorLockedPlan(activePlanId) ? getEntitlementPlan(activePlanId as EntitlementPlanId) : undefined;
  const limitFloors = isFloorLockedPlan(activePlanId) ? getPlanLimitFloors(activePlanId) : null;
  const statusKey = String(selected?.status || "").toUpperCase();

  const openCompany = (row: MasterCompanyRow) => {
    const next = normalizeEntitlements(row.entitlements, row.plan_id || "");
    setSelectedId(row.id);
    setDraft(next);
    setPlanId(row.plan_id || next.planId || "");
    setUsage(null);
    setCreateOpen(false);
    setCreatedCreds(null);
    setMessage("");
    setError("");
  };

  const closeDetail = () => {
    setSelectedId("");
    setDraft(null);
    setPlanId("");
    setUsage(null);
    setCreateOpen(false);
    setCreatedCreds(null);
  };

  const openCreate = () => {
    setSelectedId("");
    setDraft(null);
    setPlanId("");
    setUsage(null);
    setCreatedCreds(null);
    setCreateOpen(true);
    setMainTab("approved");
    setError("");
    setMessage("");
  };

  const switchMainTab = (tab: "approved" | "pending") => {
    setMainTab(tab);
    setCreateOpen(false);
    setCreatedCreds(null);
    setSelectedId("");
    setDraft(null);
    setPlanId("");
    setUsage(null);
    setPendingSearch("");
    setRejectTarget(null);
    setError("");
    setMessage("");
  };

  const onCompanyPickerChange = (companyId: string) => {
    if (!companyId) {
      closeDetail();
      return;
    }
    const row = rows.find((item) => item.id === companyId);
    if (row) openCompany(row);
  };

  useEffect(() => {
    if (!selectedId) return;
    let cancelled = false;
    setUsageLoading(true);
    void getCompanyUsageForMaster(selectedId)
      .then((data) => {
        if (!cancelled) {
          setUsage(data);
          setUsageLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setUsage(null);
          setUsageLoading(false);
          setError(err instanceof Error ? err.message : String(err));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  const runStatus = async (companyId: string, status: "ACTIVE" | "SUSPENDED" | "REVOKED") => {
    if (status === "REVOKED") {
      const confirmed = window.confirm(
        "Revoke this company? Users cannot sign in. Anyone already signed in will be blocked and asked to contact SMC Softwares.",
      );
      if (!confirmed) return;
    }
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

  const approvePendingCompany = async (row: MasterCompanyRow) => {
    setBusyId(row.id);
    setError("");
    setMessage("");
    try {
      await setCompanyStatusForMaster(row.id, "ACTIVE");
      setMessage(`Approved ${row.name} (${row.company_code}). Moved to Approved Users.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId("");
    }
  };

  const rejectPendingCompany = async (row: MasterCompanyRow) => {
    setRejectTarget(null);
    setBusyId(row.id);
    setError("");
    setMessage("");
    try {
      const result = await wipeCompanyForMaster(row.id);
      setMessage(
        `Rejected and removed ${result.company_name} (${result.company_code}). They can register again with the same credentials.`,
      );
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId("");
    }
  };

  const assignPlan = async (nextPlanId: EntitlementPlanId) => {
    if (!selected) return;
    const plan = ENTITLEMENT_PLANS.find((item) => item.id === nextPlanId);
    const next = entitlementsFromPlan(nextPlanId);
    setPlanId(nextPlanId);
    setDraft(next);
    setBusyId(selected.id);
    setError("");
    setMessage("");
    try {
      await assignCompanyPlanForMaster(selected.id, nextPlanId);
      setMessage(
        plan
          ? `Assigned ${plan.label}.${
              nextPlanId === "free"
                ? " Trial / access end cleared."
                : plan.trialDays
                  ? ` ${plan.trialDays}-day trial started.`
                  : ""
            }`
          : "Plan assigned.",
      );
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
      const next = applyPlanFloors(draft, activePlanId);
      setDraft(next);
      await setCompanyEntitlementsForMaster(selected.id, next);
      setMessage("Services, features, and limits saved.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId("");
    }
  };

  const extendAccess = async (days: number) => {
    if (!selected) return;
    setBusyId(selected.id);
    setError("");
    setMessage("");
    try {
      await extendCompanyAccessForMaster(selected.id, days);
      setMessage(
        `Access extended by ${days} days${String(selected.status).toUpperCase() === "SUSPENDED" ? " and reactivated" : ""}.`,
      );
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId("");
    }
  };

  const clearAccessEnd = async () => {
    if (!selected) return;
    const confirmed = window.confirm(
      `Remove the access end date for "${selected.name}"?\n\nThe company will have no trial/expiry until you set one again.`,
    );
    if (!confirmed) return;
    setBusyId(selected.id);
    setError("");
    setMessage("");
    try {
      await setCompanyAccessEndsAtForMaster(selected.id, null);
      setMessage("Access end date cleared (no expiry).");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId("");
    }
  };

  const setAccessEndDaysFromNow = async (days: number) => {
    if (!selected) return;
    const ends = new Date(Date.now() + days * 86_400_000).toISOString();
    setBusyId(selected.id);
    setError("");
    setMessage("");
    try {
      await setCompanyAccessEndsAtForMaster(selected.id, ends);
      setMessage(`Access end set to ${formatAccessEndsAt(ends)}.`);
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
      setPlanId("");
      setUsage(null);
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
    setMessage("Refreshing Control Panel…");
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
        <div className="master-control-brand">
          <div className="master-control-kicker">Master account</div>
          <h1>Master Control Panel</h1>
          <p className="muted master-control-tagline">
            Approve companies and set limits. No booking or payment access.
          </p>
        </div>
        <div className="master-control-top-meta">
          <div className="master-header-tabs" role="tablist" aria-label="Control Panel sections">
            <button
              type="button"
              role="tab"
              aria-selected={mainTab === "approved"}
              className={mainTab === "approved" ? "active" : ""}
              onClick={() => switchMainTab("approved")}
            >
              Approved Users
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mainTab === "pending"}
              className={mainTab === "pending" ? "active" : ""}
              onClick={() => switchMainTab("pending")}
            >
              Pending Approvals{pendingCount > 0 ? ` (${pendingCount})` : ""}
            </button>
          </div>
          <div className="master-theme-switch" role="group" aria-label="Control Panel theme">
            <button type="button" className={theme === "dark" ? "active" : ""} onClick={() => onThemeChange("dark")}>
              Dark
            </button>
            <button type="button" className={theme === "ocean" ? "active" : ""} onClick={() => onThemeChange("ocean")}>
              Ocean
            </button>
          </div>
          <button type="button" className="primary master-create-open" onClick={openCreate}>
            Create company
          </button>
          <button
            type="button"
            className="ghost master-tool-btn"
            onClick={() => void clearCacheAndReload()}
            disabled={loading || cacheBusy}
            title="Clear cache and reload the latest Control Panel"
          >
            {cacheBusy ? "Updating…" : "Refresh"}
          </button>
          <button type="button" className="ghost master-tool-btn" onClick={onSignOut} disabled={cacheBusy}>
            Sign out
          </button>
        </div>
      </header>

      {error && <div className="alert error">{error}</div>}
      {message && <div className="alert success">{message}</div>}

      {rejectTarget ? (
        <div className="master-confirm-backdrop" role="presentation" onClick={() => setRejectTarget(null)}>
          <div
            className="master-confirm-dialog"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="master-reject-title"
            aria-describedby="master-reject-desc"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="master-reject-title">Reject this company?</h3>
            <p id="master-reject-desc" className="muted">
              Reject <strong>{rejectTarget.name}</strong> ({rejectTarget.company_code})? This permanently deletes the
              company and login accounts so they can apply again with the same credentials. This cannot be undone.
            </p>
            <div className="master-confirm-actions">
              <button
                type="button"
                className="ghost"
                onClick={() => setRejectTarget(null)}
                disabled={busyId === rejectTarget.id}
              >
                Cancel
              </button>
              <button
                type="button"
                className="master-reject-btn"
                disabled={busyId === rejectTarget.id}
                onClick={() => void rejectPendingCompany(rejectTarget)}
              >
                {busyId === rejectTarget.id ? "Rejecting…" : "Reject & delete"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {mainTab === "pending" && !showCreate ? (
        <section className="master-pending-panel" aria-label="Pending Approvals">
          <div className="master-pending-head">
            <h2>Pending Approvals</h2>
            <label className="master-search-box master-pending-search">
              <span className="master-search-icon" aria-hidden="true">
                ⌕
              </span>
              <input
                type="search"
                value={pendingSearch}
                onChange={(e) => setPendingSearch(e.target.value)}
                placeholder="Search name, code, email, phone…"
                aria-label="Search pending approvals"
              />
            </label>
          </div>
          {loading ? (
            <p className="muted">Loading companies...</p>
          ) : pendingRows.length === 0 ? (
            <p className="muted">
              {pendingSearch.trim() ? "No pending companies match this search." : "No companies waiting for approval."}
            </p>
          ) : (
            <ul className="master-pending-list">
              {pendingRows.map((row) => (
                <li key={row.id} className="master-pending-item">
                  <div className="master-pending-item-main">
                    <strong>
                      {row.company_code} · {row.name}
                    </strong>
                    <span className="muted">
                      {row.email || "no email"}
                      {row.phone ? ` · ${row.phone}` : ""}
                    </span>
                  </div>
                  <div className="master-pending-item-actions">
                    <button
                      type="button"
                      className="primary"
                      disabled={busyId === row.id}
                      onClick={() => void approvePendingCompany(row)}
                    >
                      {busyId === row.id ? "Working…" : "Approve"}
                    </button>
                    <button
                      type="button"
                      className="master-reject-btn"
                      disabled={busyId === row.id}
                      onClick={() => {
                        setError("");
                        setMessage("");
                        setRejectTarget(row);
                      }}
                    >
                      Reject
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : (
        <div className="master-control-layout">
          <nav className="master-control-taskbar" aria-label="Approved users toolbar">
            <div className="master-filter-row">
              {(["ALL", "ACTIVE", "SUSPENDED", "REVOKED"] as const).map((item) => (
                <button
                  key={item}
                  type="button"
                  className={filter === item ? "master-filter active" : "master-filter"}
                  onClick={() => setFilter(item)}
                >
                  {item === "ALL" ? "All approved" : companyStatusLabel(item)}
                </button>
              ))}
            </div>

            <div className="master-taskbar-tools">
              <label className="master-company-picker">
                <span className="master-company-picker-label">Company</span>
                <select
                  value={showCreate ? "" : selectedId}
                  onChange={(e) => onCompanyPickerChange(e.target.value)}
                  aria-label="Select company"
                  disabled={loading}
                >
                  <option value="">
                    {loading ? "Loading…" : visible.length === 0 ? "No companies" : "Select a company…"}
                  </option>
                  {visible.map((row) => (
                    <option key={row.id} value={row.id}>
                      {row.company_code} · {row.name}
                      {row.phone ? ` · ${row.phone}` : ""}
                      {row.email ? ` · ${row.email}` : ""}
                    </option>
                  ))}
                </select>
              </label>

              <div className="master-taskbar-status">
                <span className="master-company-picker-label">Status</span>
                <div
                  className={`master-status-toggle${!selected || showCreate ? " is-disabled" : ""}`}
                  role="group"
                  aria-label="Company status: Active full access, Suspend view only, Revoke block login"
                >
                  <button
                    type="button"
                    className={selected && !showCreate && statusKey === "ACTIVE" ? "active" : ""}
                    disabled={!selected || showCreate || busyId === selected?.id || statusKey === "ACTIVE"}
                    onClick={() => selected && void runStatus(selected.id, "ACTIVE")}
                  >
                    Active
                  </button>
                  <button
                    type="button"
                    className={selected && !showCreate && statusKey === "SUSPENDED" ? "active bad" : ""}
                    disabled={!selected || showCreate || busyId === selected?.id || statusKey === "SUSPENDED"}
                    onClick={() => selected && void runStatus(selected.id, "SUSPENDED")}
                  >
                    Suspend
                  </button>
                  <button
                    type="button"
                    className={selected && !showCreate && statusKey === "REVOKED" ? "active bad" : ""}
                    disabled={!selected || showCreate || busyId === selected?.id || statusKey === "REVOKED"}
                    onClick={() => selected && void runStatus(selected.id, "REVOKED")}
                  >
                    Revoke
                  </button>
                </div>
              </div>
            </div>
          </nav>

          <section className="master-control-detail">
            {createdCreds ? (
              <>
                <div className="master-back-row">
                  <button type="button" className="ghost" onClick={closeDetail}>
                    ← Back
                  </button>
                </div>
                <CreatedCredentialsCard
                  created={createdCreds}
                  onDone={() => {
                    const created = createdCreds;
                    setCreatedCreds(null);
                    setCreateOpen(false);
                    setMessage(`Created ${created.company_name} (${created.company_code}).`);
                    void load().then((list) => {
                      const row = list.find((item) => item.id === created.company_id);
                      if (row) openCompany(row);
                    });
                  }}
                />
              </>
            ) : createOpen ? (
              <>
                <div className="master-back-row">
                  <button type="button" className="ghost" onClick={closeDetail}>
                    ← Back
                  </button>
                </div>
                <MasterCreateCompany
                  busy={busyId === "create"}
                  onBusy={(next) => setBusyId(next ? "create" : "")}
                  onError={setError}
                  onCreated={setCreatedCreds}
                  onCancel={closeDetail}
                />
              </>
            ) : selectedId && (!selected || !draft) ? (
              <div className="master-empty-detail">
                <p className="muted">{loading ? "Loading company…" : "Restoring the company you were editing…"}</p>
              </div>
            ) : !selected || !draft ? (
              <div className="master-empty-detail">
                <p className="muted">Select a company to set plan, services, and trial. Or create one.</p>
              </div>
            ) : (
              <>
                <div className="master-back-row">
                  <button type="button" className="ghost" onClick={closeDetail}>
                    ← Clear selection
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

                <section className="master-detail-section" aria-label="Plan tiers">
                  <h3 className="master-detail-section-title">Plan tier</h3>
                  <p className="muted" style={{ marginTop: 0 }}>
                    Free, Pro, and Enterprise are fixed packs. Off items stay grey in Control Panel and in the agency
                    account. For a Pro or Enterprise demo, assign Custom and tick what they may try.
                  </p>
                  <div className="master-plan-tiers" role="group" aria-label="Plan tiers">
                    {ENTITLEMENT_PLANS.map((plan) => (
                      <button
                        key={plan.id}
                        type="button"
                        className={planId === plan.id ? "master-plan-tier active" : "master-plan-tier"}
                        disabled={busyId === selected.id}
                        onClick={() => void assignPlan(plan.id)}
                      >
                        {planId === plan.id ? <em className="master-plan-tier-mark">Selected</em> : null}
                        <strong>{plan.label}</strong>
                        <span>{plan.commercialNotes || "—"}</span>
                      </button>
                    ))}
                  </div>
                </section>

                <form className="master-entitlements-form" onSubmit={(e) => void saveEntitlements(e)}>
                  <section className="master-detail-section master-entitlement-card" aria-label="Services and Features">
                    <div className="master-entitlement-card-head">
                      <h3 className="master-detail-section-title">Services &amp; Features</h3>
                      <p className="master-entitlement-card-lead">
                        {floorPlan
                          ? "This pack is locked. Off items stay grey here and in the agency account. Assign Custom to change ticks."
                          : "Tick what this company can use. Changes apply to the selected account after Save."}
                      </p>
                    </div>

                    <div className="master-tick-panels">
                      <section className="master-tick-panel" aria-labelledby="master-tick-segments-title">
                        <header className="master-tick-panel-head">
                          <h4 id="master-tick-segments-title" className="master-detail-subhead master-tick-panel-title">
                            Segments
                          </h4>
                          <span className="master-tick-panel-meta">
                            {SEGMENTS.filter((key) => draft.segments[key]).length} on
                          </span>
                        </header>
                        <div className="master-check-grid">
                          {SEGMENTS.map((key) => (
                            <label
                              key={key}
                              className={`master-check${floorPlan ? " is-plan-locked" : ""}${
                                draft.segments[key] ? "" : " is-plan-off"
                              }`}
                            >
                              <input
                                type="checkbox"
                                checked={draft.segments[key]}
                                disabled={Boolean(floorPlan)}
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
                      </section>

                      <section className="master-tick-panel" aria-labelledby="master-tick-features-title">
                        <header className="master-tick-panel-head">
                          <h4 id="master-tick-features-title" className="master-detail-subhead master-tick-panel-title">
                            Features
                          </h4>
                          <span className="master-tick-panel-meta">
                            {FEATURE_ROWS.filter(([key]) => draft.features[key]).length} on
                          </span>
                        </header>
                        <div className="master-check-grid">
                          {FEATURE_ROWS.map(([key, label]) => (
                            <label
                              key={key}
                              className={`master-check${floorPlan ? " is-plan-locked" : ""}${
                                draft.features[key] ? "" : " is-plan-off"
                              }`}
                            >
                              <input
                                type="checkbox"
                                checked={draft.features[key]}
                                disabled={Boolean(floorPlan)}
                                onChange={(e) =>
                                  setDraft({
                                    ...draft,
                                    features: { ...draft.features, [key]: e.target.checked },
                                  })
                                }
                              />
                              <span className="master-check-label">{label}</span>
                              <span className="master-check-state" aria-hidden="true">
                                {draft.features[key] ? "On" : "Off"}
                              </span>
                            </label>
                          ))}
                        </div>
                      </section>
                    </div>
                  </section>

                  <section className="master-detail-section master-entitlement-card" aria-label="Capacity and limits">
                    <div className="master-entitlement-card-head">
                      <h3 className="master-detail-section-title">Capacity &amp; Limits</h3>
                      <p className="master-entitlement-card-lead">
                        {floorPlan
                          ? "Limits are fixed on this plan. Assign Custom to raise or lower caps. Existing records are not deleted."
                          : "Leave blank for unlimited. Lowering a cap does not delete existing records."}
                      </p>
                    </div>
                    <div className="master-limit-grid">
                      {CAPACITY_LIMITS.map(({ key, label, usage: usageKind }) => {
                        const cap = draft.limits[key];
                        const floor = limitFloors?.[key] ?? null;
                        const used =
                          usageKind === "parties"
                            ? (usage?.parties ?? 0)
                            : usageKind === "vendors"
                              ? (usage?.vendors ?? 0)
                              : usageKind === "staff"
                                ? Math.max(0, (usage?.staff_users ?? 0) - 1)
                                : usageKind === "bookings"
                                  ? (usage?.bookings_active_total ?? 0)
                                  : usageKind === "payments"
                                    ? (usage?.payments_active ?? 0)
                                    : null;
                        const tone = used == null ? "" : usageTone(used, cap);
                        const meta =
                          used == null
                            ? `${floor != null ? `Min ${floor} · ` : ""}${cap == null ? "Unlimited" : `Cap ${cap}`}`
                            : `${floor != null ? `Min ${floor} · ` : ""}${formatUsage(used, cap)}`;
                        return (
                          <label key={key}>
                            {label}
                            <input
                              type="number"
                              min={floor ?? 0}
                              placeholder="Unlimited"
                              disabled={Boolean(floorPlan)}
                              value={draft.limits[key] ?? ""}
                              onChange={(e) => {
                                const raw = e.target.value.trim();
                                const nextValue =
                                  raw === "" ? null : Math.max(floor ?? 0, Math.max(0, Math.floor(Number(raw) || 0)));
                                setDraft({
                                  ...draft,
                                  limits: {
                                    ...draft.limits,
                                    [key]: nextValue,
                                  },
                                });
                              }}
                            />
                            <span className={`master-usage-meta${tone ? ` ${tone}` : ""}`}>
                              {usageLoading ? "Usage…" : meta}
                            </span>
                          </label>
                        );
                      })}
                    </div>

                    {isPaidEntitlementPlan(activePlanId) ? (
                      <MasterPlanRateBox planId={activePlanId} limits={draft.limits} />
                    ) : null}

                    {floorPlan ? (
                      <p className="muted" style={{ marginTop: 14 }}>
                        Save is only needed on Custom. Assign Custom if this agency needs a mixed demo of Pro or
                        Enterprise tools.
                      </p>
                    ) : (
                      <button className="primary" type="submit" disabled={busyId === selected.id}>
                        {busyId === selected.id ? "Saving..." : "Save changes"}
                      </button>
                    )}
                  </section>
                </form>

                <section
                  className="master-detail-section master-health-card master-trial-card"
                  aria-label="Trial and access end"
                >
                  <h3 className="master-detail-section-title">Trial &amp; access end</h3>
                  <p className="muted" style={{ marginTop: 0 }}>
                    Agency sees a warning within 7 days of this date. When the date passes, the company auto-suspends.
                    Extend reactivates if currently suspended.
                  </p>
                  <div className="master-trial-meta">
                    <div>
                      <small>Ends</small>
                      <b>{formatAccessEndsAt(selected.access_ends_at)}</b>
                    </div>
                    <div>
                      <small>Days left</small>
                      <b>
                        {(() => {
                          const days = accessDaysRemaining(selected.access_ends_at);
                          if (days == null) return "Unlimited";
                          if (days < 0) return `Expired ${Math.abs(days)}d ago`;
                          if (days === 0) return "Ends today";
                          return `${days} day${days === 1 ? "" : "s"}`;
                        })()}
                      </b>
                    </div>
                  </div>
                  <div className="master-action-row master-trial-actions">
                    <button type="button" disabled={busyId === selected.id} onClick={() => void extendAccess(30)}>
                      Extend +30 days
                    </button>
                    <button type="button" disabled={busyId === selected.id} onClick={() => void extendAccess(90)}>
                      Extend +90 days
                    </button>
                    <button
                      type="button"
                      disabled={busyId === selected.id}
                      onClick={() => void setAccessEndDaysFromNow(14)}
                    >
                      Set 14-day trial
                    </button>
                    <button
                      type="button"
                      disabled={busyId === selected.id || !selected.access_ends_at}
                      onClick={() => void clearAccessEnd()}
                    >
                      Clear expiry
                    </button>
                  </div>
                </section>

                <section className="master-detail-section master-danger-zone" aria-label="Danger">
                  <h3 className="master-detail-section-title">Delete company</h3>
                  <p className="muted">
                    Permanently wipe this company from the cloud database — bookings, payments, parties, staff, and
                    login accounts. Frees Supabase storage for this tenant.
                  </p>
                  <button
                    type="button"
                    className="master-danger-button"
                    disabled={busyId === selected.id}
                    onClick={() => void wipeCompany()}
                  >
                    {busyId === selected.id ? "Deleting..." : "Delete company & all data"}
                  </button>
                </section>
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
