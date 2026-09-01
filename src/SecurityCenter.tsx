import { useEffect, useMemo, useState } from "react";
import { useBodyScrollLock } from "./useBodyScrollLock";
import {
  AuditLog,
  Company,
  CompanyUser,
  UserSession,
  changeOwnPassword,
  createCompanyUser,
  getAuditLogs,
  getCompanyById,
  getCompanyUsers,
  resetCompanyUserPassword,
  setCompanyUserStatus,
  updateCompanyProfile,
  updateCompanyUser,
} from "./db";
import { EMPLOYEE_ROLES, ROLE_LABELS, UserRole, hasPermission, roleDescription } from "./permissions";
import DiagnosticPanel from "./DiagnosticPanel";

type Props = {
  company: Company;
  session: UserSession;
  onCompanyUpdated: (company: Company) => void;
  category: "ACCOUNT" | "SECURITY";
};

type SecurityTab = "MY_ACCOUNT" | "USERS" | "COMPANY" | "AUDIT" | "DIAGNOSTICS";

type UserForm = {
  fullName: string;
  username: string;
  email: string;
  phone: string;
  password: string;
  confirmPassword: string;
  role: Exclude<UserRole, "OWNER">;
};

const blankUser: UserForm = {
  fullName: "",
  username: "",
  email: "",
  phone: "",
  password: "",
  confirmPassword: "",
  role: "DATA_ENTRY",
};

function formatDateTime(value: string) {
  if (!value) return "Never";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("en-PK");
}

export default function SecurityCenter({ company, session, onCompanyUpdated, category }: Props) {
  const canManageUsers = hasPermission(session.role, "manage_users");
  const canManageCompany = hasPermission(session.role, "manage_company");
  const canViewAudit = hasPermission(session.role, "view_audit");

  const defaultTab: SecurityTab = category === "ACCOUNT" ? "MY_ACCOUNT" : canManageUsers ? "USERS" : "AUDIT";
  const [tab, setTab] = useState<SecurityTab>(defaultTab);
  const [users, setUsers] = useState<CompanyUser[]>([]);
  const [audit, setAudit] = useState<AuditLog[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const [showUserForm, setShowUserForm] = useState(false);
  const [editingUser, setEditingUser] = useState<CompanyUser | null>(null);
  const [userForm, setUserForm] = useState<UserForm>(blankUser);
  const [resetUser, setResetUser] = useState<CompanyUser | null>(null);
  const [resetPassword, setResetPassword] = useState("");
  const [resetConfirm, setResetConfirm] = useState("");

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");

  const [companyForm, setCompanyForm] = useState({
    name: company.name,
    dtsLicense: company.dts_license,
    address: company.address,
    phone: company.phone,
    whatsapp: company.whatsapp,
    email: company.email,
    baseCurrency: company.base_currency,
    foreignCurrency: company.foreign_currency,
    logoData: company.logo_data,
  });

  useBodyScrollLock(showUserForm || Boolean(resetUser));

  useEffect(() => {
    setCompanyForm({
      name: company.name,
      dtsLicense: company.dts_license,
      address: company.address,
      phone: company.phone,
      whatsapp: company.whatsapp,
      email: company.email,
      baseCurrency: company.base_currency,
      foreignCurrency: company.foreign_currency,
      logoData: company.logo_data,
    });
  }, [company]);

  useEffect(() => {
    if (canManageUsers) void loadUsers();
    if (canViewAudit) void loadAudit();
  }, [company.id, canManageUsers, canViewAudit]);

  const activeUsers = useMemo(() => users.filter((user) => user.status === "ACTIVE").length, [users]);

  async function loadUsers() {
    try {
      setUsers(await getCompanyUsers(company.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function loadAudit() {
    try {
      setAudit(await getAuditLogs(company.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  function clearAlerts() {
    setError("");
    setMessage("");
  }

  function openNewUser() {
    clearAlerts();
    setEditingUser(null);
    setUserForm(blankUser);
    setShowUserForm(true);
  }

  function openEditUser(user: CompanyUser) {
    if (user.role === "OWNER") return;
    clearAlerts();
    setEditingUser(user);
    setUserForm({
      fullName: user.full_name,
      username: user.username,
      email: user.email,
      phone: user.phone,
      password: "",
      confirmPassword: "",
      role: user.role as Exclude<UserRole, "OWNER">,
    });
    setShowUserForm(true);
  }

  async function saveUser() {
    clearAlerts();
    if (!userForm.fullName.trim()) return setError("Full name is required.");
    if (!userForm.username.trim()) return setError("Username is required.");
    if (!editingUser && userForm.password.length < 8)
      return setError("Temporary password must be at least 8 characters.");
    if (!editingUser && userForm.password !== userForm.confirmPassword) return setError("Passwords do not match.");

    setBusy(true);
    try {
      if (editingUser) {
        await updateCompanyUser(company.id, session.userId, editingUser.id, {
          fullName: userForm.fullName,
          username: userForm.username,
          email: userForm.email,
          phone: userForm.phone,
          role: userForm.role,
        });
        setMessage("Employee account updated successfully.");
      } else {
        await createCompanyUser(company.id, session.userId, {
          fullName: userForm.fullName,
          username: userForm.username,
          email: userForm.email,
          phone: userForm.phone,
          password: userForm.password,
          role: userForm.role,
        });
        setMessage("Employee login created successfully.");
      }
      setShowUserForm(false);
      setEditingUser(null);
      setUserForm(blankUser);
      await Promise.all([loadUsers(), loadAudit()]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function toggleUser(user: CompanyUser) {
    clearAlerts();
    const next = user.status === "ACTIVE" ? "DISABLED" : "ACTIVE";
    if (next === "DISABLED" && !window.confirm(`Disable login for ${user.full_name}?`)) return;
    setBusy(true);
    try {
      await setCompanyUserStatus(company.id, session.userId, user.id, next);
      setMessage(`${user.full_name} is now ${next}.`);
      await Promise.all([loadUsers(), loadAudit()]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function saveResetPassword() {
    if (!resetUser) return;
    clearAlerts();
    if (resetPassword.length < 8) return setError("New password must be at least 8 characters.");
    if (resetPassword !== resetConfirm) return setError("Passwords do not match.");
    setBusy(true);
    try {
      await resetCompanyUserPassword(company.id, session.userId, resetUser.id, resetPassword);
      setResetUser(null);
      setResetPassword("");
      setResetConfirm("");
      setMessage("Employee password reset successfully.");
      await loadAudit();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function saveOwnPassword() {
    clearAlerts();
    if (newPassword.length < 8) return setError("New password must be at least 8 characters.");
    if (newPassword !== confirmNewPassword) return setError("New passwords do not match.");
    setBusy(true);
    try {
      await changeOwnPassword(company.id, session.userId, currentPassword, newPassword);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmNewPassword("");
      setMessage("Your password has been changed.");
      if (canViewAudit) await loadAudit();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function saveCompany() {
    clearAlerts();
    setBusy(true);
    try {
      await updateCompanyProfile(company.id, session.userId, companyForm);
      const latest = await getCompanyById(company.id);
      if (latest) onCompanyUpdated(latest);
      setMessage("Company profile updated successfully.");
      if (canViewAudit) await loadAudit();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function companyLogoChange(file?: File) {
    if (!file) return setCompanyForm((current) => ({ ...current, logoData: null }));
    if (!file.type.startsWith("image/")) return setError("Please choose an image file.");
    if (file.size > 2 * 1024 * 1024) return setError("Please use a logo smaller than 2 MB.");
    const data = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(new Error("Could not read the logo."));
      reader.readAsDataURL(file);
    });
    setCompanyForm((current) => ({ ...current, logoData: data }));
  }

  async function copyCompanyCode() {
    try {
      await navigator.clipboard.writeText(company.company_code);
      setMessage("Company Code copied.");
    } catch {
      setMessage(`Company Code: ${company.company_code}`);
    }
  }

  return (
    <section className="content-card security-page" style={{ margin: 0 }}>
      <div className="page-title security-title">
        <div>
          <span className="eyebrow blue">{category === "ACCOUNT" ? "ACCOUNT & PROFILE" : "SECURITY & ACCESS"}</span>
          <h2>{category === "ACCOUNT" ? "Personal & Company Settings" : "Company access control"}</h2>
          <p>
            {category === "ACCOUNT"
              ? "Manage your login credentials and the global agency branding."
              : "Manage team permissions and review security audit activity."}
          </p>
        </div>
        <div className="company-code-card">
          <small>COMPANY CODE / AGENCY ID</small>
          <b>{company.company_code}</b>
          <button type="button" onClick={copyCompanyCode}>
            Copy
          </button>
        </div>
      </div>

      <div className="security-tabs">
        {category === "ACCOUNT" && (
          <>
            <button
              className={tab === "MY_ACCOUNT" ? "active" : ""}
              onClick={() => {
                clearAlerts();
                setTab("MY_ACCOUNT");
              }}
            >
              My Account
            </button>
            {canManageCompany && (
              <button
                className={tab === "COMPANY" ? "active" : ""}
                onClick={() => {
                  clearAlerts();
                  setTab("COMPANY");
                }}
              >
                Company Profile
              </button>
            )}
          </>
        )}
        {category === "SECURITY" && (
          <>
            {canManageUsers && (
              <button
                className={tab === "USERS" ? "active" : ""}
                onClick={() => {
                  clearAlerts();
                  setTab("USERS");
                }}
              >
                Users & Permissions
              </button>
            )}
            {canViewAudit && (
              <button
                className={tab === "AUDIT" ? "active" : ""}
                onClick={() => {
                  clearAlerts();
                  setTab("AUDIT");
                  void loadAudit();
                }}
              >
                Audit Log
              </button>
            )}
            {canManageCompany && (
              <button
                className={tab === "DIAGNOSTICS" ? "active warning" : "warning"}
                onClick={() => {
                  clearAlerts();
                  setTab("DIAGNOSTICS");
                }}
              >
                Diagnostics
              </button>
            )}
          </>
        )}
      </div>

      {message && <div className="alert success">{message}</div>}
      {error && <div className="alert error">{error}</div>}

      {tab === "MY_ACCOUNT" && (
        <div className="security-grid two-column-security">
          <article className="security-panel">
            <span className="eyebrow blue">SIGNED-IN USER</span>
            <h3>{session.fullName}</h3>
            <div className="security-kv">
              <span>Username</span>
              <b>{session.username}</b>
            </div>
            <div className="security-kv">
              <span>Role</span>
              <b>{ROLE_LABELS[session.role]}</b>
            </div>
            <div className="security-kv">
              <span>Email</span>
              <b>{session.email || "—"}</b>
            </div>
            <div className="security-kv">
              <span>Phone</span>
              <b>{session.phone || "—"}</b>
            </div>
            <p className="role-note">{roleDescription(session.role)}</p>
          </article>

          <article className="security-panel">
            <span className="eyebrow blue">PASSWORD</span>
            <h3>Change my password</h3>
            <div className="form compact-form">
              <label>
                Current Password
                <input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} />
              </label>
              <label>
                New Password
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Minimum 8 characters"
                />
              </label>
              <label>
                Confirm New Password
                <input
                  type="password"
                  value={confirmNewPassword}
                  onChange={(e) => setConfirmNewPassword(e.target.value)}
                />
              </label>
              <button className="primary" type="button" disabled={busy} onClick={saveOwnPassword}>
                Change Password
              </button>
            </div>
          </article>
        </div>
      )}

      {tab === "USERS" && canManageUsers && (
        <>
          <div className="security-summary-row">
            <div>
              <small>TOTAL USERS</small>
              <b>{users.length}</b>
            </div>
            <div>
              <small>ACTIVE USERS</small>
              <b>{activeUsers}</b>
            </div>
            <div>
              <small>MASTER OWNER</small>
              <b>{users.find((u) => u.role === "OWNER")?.full_name || session.fullName}</b>
            </div>
            <button className="primary" type="button" onClick={openNewUser}>
              + Add Employee User
            </button>
          </div>

          <div className="party-table-wrap security-user-table-wrap">
            <table className="party-table security-user-table">
              <thead>
                <tr>
                  <th>USER</th>
                  <th>LOGIN</th>
                  <th>ROLE</th>
                  <th>STATUS</th>
                  <th>LAST LOGIN</th>
                  <th>ACTIONS</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <tr key={user.id}>
                    <td>
                      <b>{user.full_name}</b>
                      <small className="table-note">{user.email || user.phone || "No email/phone"}</small>
                    </td>
                    <td>
                      <b>{user.username}</b>
                    </td>
                    <td>
                      <span className={`role-chip ${user.role.toLowerCase()}`}>{ROLE_LABELS[user.role]}</span>
                    </td>
                    <td>
                      <span className={`status ${user.status === "ACTIVE" ? "active" : "inactive"}`}>
                        {user.status}
                      </span>
                    </td>
                    <td>{formatDateTime(user.last_login_at)}</td>
                    <td>
                      {user.role === "OWNER" ? (
                        <small>Protected master account</small>
                      ) : (
                        <div className="row-actions security-actions">
                          <button type="button" disabled={busy} onClick={() => openEditUser(user)}>
                            Edit
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => {
                              setResetUser(user);
                              setResetPassword("");
                              setResetConfirm("");
                              clearAlerts();
                            }}
                          >
                            Reset Password
                          </button>
                          <button type="button" disabled={busy} onClick={() => void toggleUser(user)}>
                            {user.status === "ACTIVE" ? "Disable" : "Enable"}
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="permission-guide">
            <h3>Role permissions</h3>
            <div className="permission-cards">
              {EMPLOYEE_ROLES.map((role) => (
                <article key={role}>
                  <b>{ROLE_LABELS[role]}</b>
                  <p>{roleDescription(role)}</p>
                </article>
              ))}
            </div>
          </div>
        </>
      )}

      {tab === "COMPANY" && canManageCompany && (
        <div className="security-grid company-settings-grid">
          <article className="security-panel">
            <span className="eyebrow blue">PERMANENT LOGIN ID</span>
            <h3>{company.company_code}</h3>
            <p className="role-note">
              This Company Code identifies the agency at login. Employees need this code plus their own username and
              password. The code is intentionally not editable.
            </p>
            <button className="secondary" type="button" onClick={copyCompanyCode}>
              Copy Company Code
            </button>
          </article>
          <article className="security-panel company-profile-panel">
            <span className="eyebrow blue">COMPANY PROFILE</span>
            <h3>Branding & contacts</h3>
            <div className="form">
              <label>
                Company Name
                <input
                  value={companyForm.name}
                  onChange={(e) => setCompanyForm((c) => ({ ...c, name: e.target.value }))}
                />
              </label>
              <label>
                DTS License # <small>(Optional)</small>
                <input
                  value={companyForm.dtsLicense}
                  onChange={(e) => setCompanyForm((c) => ({ ...c, dtsLicense: e.target.value }))}
                  placeholder="e.g. DTS-123456"
                />
              </label>
              <label>
                Company Logo
                <input type="file" accept="image/*" onChange={(e) => void companyLogoChange(e.target.files?.[0])} />
              </label>
              <label>
                Address
                <textarea
                  rows={2}
                  value={companyForm.address}
                  onChange={(e) => setCompanyForm((c) => ({ ...c, address: e.target.value }))}
                />
              </label>
              <div className="two">
                <label>
                  Phone
                  <input
                    value={companyForm.phone}
                    onChange={(e) => setCompanyForm((c) => ({ ...c, phone: e.target.value }))}
                  />
                </label>
                <label>
                  WhatsApp
                  <input
                    value={companyForm.whatsapp}
                    onChange={(e) => setCompanyForm((c) => ({ ...c, whatsapp: e.target.value }))}
                  />
                </label>
              </div>
              <label>
                Email
                <input
                  type="email"
                  value={companyForm.email}
                  onChange={(e) => setCompanyForm((c) => ({ ...c, email: e.target.value }))}
                />
              </label>
              <div className="two">
                <label>
                  Base Currency
                  <select
                    value={companyForm.baseCurrency}
                    onChange={(e) => setCompanyForm((c) => ({ ...c, baseCurrency: e.target.value }))}
                  >
                    <option value="PKR">PKR</option>
                  </select>
                </label>
                <label>
                  Foreign Currency
                  <select
                    value={companyForm.foreignCurrency}
                    onChange={(e) => setCompanyForm((c) => ({ ...c, foreignCurrency: e.target.value }))}
                  >
                    <option value="SAR">SAR</option>
                  </select>
                </label>
              </div>
              <button className="primary" type="button" disabled={busy} onClick={saveCompany}>
                Save Company Profile
              </button>
            </div>
          </article>
        </div>
      )}

      {tab === "AUDIT" && canViewAudit && (
        <div className="audit-wrap">
          <div className="audit-head">
            <div>
              <h3>Audit Log</h3>
              <p>
                Security actions are recorded automatically. Booking/account actions will continue using the same audit
                structure as modules are finalized.
              </p>
            </div>
            <button className="secondary" type="button" onClick={() => void loadAudit()}>
              Refresh
            </button>
          </div>
          {audit.length === 0 ? (
            <div className="empty-state">
              <h3>No audit activity yet</h3>
            </div>
          ) : (
            <div className="party-table-wrap">
              <table className="party-table audit-table">
                <thead>
                  <tr>
                    <th>DATE / TIME</th>
                    <th>USER</th>
                    <th>ACTION</th>
                    <th>MODULE</th>
                    <th>DETAILS</th>
                  </tr>
                </thead>
                <tbody>
                  {audit.map((row) => (
                    <tr key={row.id}>
                      <td>{formatDateTime(row.created_at)}</td>
                      <td>
                        <b>{row.user_name}</b>
                      </td>
                      <td>
                        <span className="audit-action">{row.action.replace(/_/g, " ")}</span>
                      </td>
                      <td>{row.module}</td>
                      <td>{row.details || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {showUserForm && (
        <div className="modal-backdrop" onMouseDown={() => setShowUserForm(false)}>
          <section className="modal-card security-modal" onMouseDown={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <div>
                <span className="eyebrow blue">USERS & PERMISSIONS</span>
                <h3>{editingUser ? "Edit Employee User" : "Create Employee Login"}</h3>
              </div>
              <button className="close-btn" type="button" onClick={() => setShowUserForm(false)}>
                ×
              </button>
            </div>
            <div className="form">
              <label>
                Full Name *
                <input
                  autoFocus
                  value={userForm.fullName}
                  onChange={(e) => setUserForm((u) => ({ ...u, fullName: e.target.value }))}
                />
              </label>
              <div className="two">
                <label>
                  Username *
                  <input
                    value={userForm.username}
                    onChange={(e) => setUserForm((u) => ({ ...u, username: e.target.value }))}
                    placeholder="e.g. ahmed"
                  />
                </label>
                <label>
                  Role
                  <select
                    value={userForm.role}
                    onChange={(e) => setUserForm((u) => ({ ...u, role: e.target.value as Exclude<UserRole, "OWNER"> }))}
                  >
                    {EMPLOYEE_ROLES.map((role) => (
                      <option key={role} value={role}>
                        {ROLE_LABELS[role]}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="two">
                <label>
                  Email
                  <input
                    type="email"
                    value={userForm.email}
                    onChange={(e) => setUserForm((u) => ({ ...u, email: e.target.value }))}
                  />
                </label>
                <label>
                  Phone
                  <input
                    value={userForm.phone}
                    onChange={(e) => setUserForm((u) => ({ ...u, phone: e.target.value }))}
                  />
                </label>
              </div>
              {!editingUser && (
                <div className="two">
                  <label>
                    Temporary Password *
                    <input
                      type="password"
                      value={userForm.password}
                      onChange={(e) => setUserForm((u) => ({ ...u, password: e.target.value }))}
                    />
                  </label>
                  <label>
                    Confirm Password *
                    <input
                      type="password"
                      value={userForm.confirmPassword}
                      onChange={(e) => setUserForm((u) => ({ ...u, confirmPassword: e.target.value }))}
                    />
                  </label>
                </div>
              )}
              <div className="role-preview">
                <b>{ROLE_LABELS[userForm.role]}</b>
                <span>{roleDescription(userForm.role)}</span>
              </div>
            </div>
            <div className="modal-buttons">
              <button className="secondary" type="button" onClick={() => setShowUserForm(false)}>
                Cancel
              </button>
              <button className="primary" type="button" disabled={busy} onClick={saveUser}>
                {busy ? "Saving..." : editingUser ? "Save User" : "Create User"}
              </button>
            </div>
          </section>
        </div>
      )}

      {resetUser && (
        <div className="modal-backdrop" onMouseDown={() => setResetUser(null)}>
          <section className="modal-card security-modal small-security-modal" onMouseDown={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <div>
                <span className="eyebrow blue">RESET PASSWORD</span>
                <h3>{resetUser.full_name}</h3>
              </div>
              <button className="close-btn" type="button" onClick={() => setResetUser(null)}>
                ×
              </button>
            </div>
            <div className="form">
              <label>
                New Password
                <input
                  type="password"
                  autoFocus
                  value={resetPassword}
                  onChange={(e) => setResetPassword(e.target.value)}
                />
              </label>
              <label>
                Confirm New Password
                <input type="password" value={resetConfirm} onChange={(e) => setResetConfirm(e.target.value)} />
              </label>
            </div>
            <div className="modal-buttons">
              <button className="secondary" type="button" onClick={() => setResetUser(null)}>
                Cancel
              </button>
              <button className="primary" type="button" disabled={busy} onClick={saveResetPassword}>
                Reset Password
              </button>
            </div>
          </section>
        </div>
      )}

      {tab === "DIAGNOSTICS" && canManageCompany && <DiagnosticPanel companyId={company.id} />}
    </section>
  );
}
