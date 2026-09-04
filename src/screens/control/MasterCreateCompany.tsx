import { FormEvent, useState } from "react";
import {
  ENTITLEMENT_PLANS,
  EntitlementPlanId,
  entitlementsFromPlan,
  getEntitlementPlan,
} from "../../companyEntitlements";
import { validateStrongPassword } from "../../db";
import { createCompanyForMaster, type MasterCreatedCompany } from "../../platformMaster";

export type CreatedCredentials = MasterCreatedCompany & { password: string };

type Props = {
  busy: boolean;
  onBusy: (busy: boolean) => void;
  onError: (message: string) => void;
  onCreated: (created: CreatedCredentials) => void;
  onCancel: () => void;
};

export default function MasterCreateCompany({ busy, onBusy, onError, onCreated, onCancel }: Props) {
  const [companyName, setCompanyName] = useState("");
  const [companyCode, setCompanyCode] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [planId, setPlanId] = useState<EntitlementPlanId>("free");
  const [status, setStatus] = useState<"ACTIVE" | "PENDING_APPROVAL">("ACTIVE");
  const [trial14, setTrial14] = useState(false);
  const selectedCreatePlan = getEntitlementPlan(planId);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    onError("");
    try {
      const name = companyName.trim();
      const ownerUsername = username.trim();
      if (name.length < 2) throw new Error("Company name is required.");
      if (ownerUsername.length < 3 || !/^[A-Za-z0-9._-]+$/.test(ownerUsername)) {
        throw new Error(
          "Username must be at least 3 characters and use letters, numbers, dot, underscore or dash only.",
        );
      }
      validateStrongPassword(password);
      if (password !== confirm) throw new Error("Password and confirm password do not match.");
      const code = companyCode.trim().toUpperCase();
      if (code && !/^[A-Z]{3}$/.test(code)) {
        throw new Error("Company code must be 3 letters, or leave blank to auto-generate.");
      }

      onBusy(true);
      const created = await createCompanyForMaster({
        companyName: name,
        ownerUsername,
        ownerPassword: password,
        companyCode: code || undefined,
        phone,
        email,
        entitlements: entitlementsFromPlan(planId),
        status,
        trialDays: selectedCreatePlan?.trialDays ?? (trial14 && planId !== "free" ? 14 : null),
      });
      onCreated({ ...created, password });
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      onBusy(false);
    }
  };

  return (
    <form className="master-entitlements-form master-create-form" onSubmit={(e) => void submit(e)}>
      <h3>Create company</h3>
      <p className="muted" style={{ marginTop: 0 }}>
        Master sets the owner username and password. Give these details to the agency once — they sign in with Company
        Code + username.
      </p>

      <label>
        Company name
        <input value={companyName} onChange={(e) => setCompanyName(e.target.value)} required autoComplete="off" />
      </label>
      <label>
        Company code (optional)
        <input
          value={companyCode}
          onChange={(e) => setCompanyCode(e.target.value.toUpperCase())}
          maxLength={3}
          placeholder="Auto 3 letters"
          autoComplete="off"
        />
      </label>
      <label>
        Owner username
        <input value={username} onChange={(e) => setUsername(e.target.value)} required autoComplete="off" />
      </label>
      <label>
        Owner password
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          autoComplete="new-password"
        />
      </label>
      <label>
        Confirm password
        <input
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          required
          autoComplete="new-password"
        />
      </label>
      <label>
        Phone (optional)
        <input value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="off" />
      </label>
      <label>
        Email (optional)
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Only if they have one"
          autoComplete="off"
        />
      </label>
      <label>
        Plan
        <select value={planId} onChange={(e) => setPlanId(e.target.value as EntitlementPlanId)}>
          {ENTITLEMENT_PLANS.map((plan) => (
            <option key={plan.id} value={plan.id}>
              {plan.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        Start as
        <select value={status} onChange={(e) => setStatus(e.target.value as "ACTIVE" | "PENDING_APPROVAL")}>
          <option value="ACTIVE">Active (can sign in now)</option>
          <option value="PENDING_APPROVAL">Pending approval</option>
        </select>
      </label>
      {selectedCreatePlan?.trialDays ? (
        <p className="muted">
          {selectedCreatePlan.label} includes a {selectedCreatePlan.trialDays}-day trial. After it ends, the price is{" "}
          {selectedCreatePlan.commercialNotes || "billed per 3 months"}.
        </p>
      ) : planId !== "free" ? (
        <label className="master-create-trial">
          <input type="checkbox" checked={trial14} onChange={(e) => setTrial14(e.target.checked)} />
          <span>14-day trial (auto-suspend when it ends)</span>
        </label>
      ) : (
        <p className="muted">Free has no trial or access end date.</p>
      )}

      <div className="master-action-row">
        <button type="submit" className="primary" disabled={busy}>
          {busy ? "Creating…" : "Create company"}
        </button>
        <button type="button" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

export function CreatedCredentialsCard({ created, onDone }: { created: CreatedCredentials; onDone: () => void }) {
  const [copied, setCopied] = useState(false);
  const text = [
    `Company: ${created.company_name}`,
    `Company Code: ${created.company_code}`,
    `Username: ${created.owner_username}`,
    `Password: ${created.password}`,
    created.owner_email ? `Email: ${created.owner_email}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="master-health-card master-created-card">
      <h3>Copy these details now</h3>
      <p className="muted" style={{ marginTop: 0 }}>
        This password is shown once. The agency signs in at Travel Hisab with Company Code + username + password.
      </p>
      <dl className="master-created-dl">
        <div>
          <dt>Company code</dt>
          <dd>{created.company_code}</dd>
        </div>
        <div>
          <dt>Username</dt>
          <dd>{created.owner_username}</dd>
        </div>
        <div>
          <dt>Password</dt>
          <dd>{created.password}</dd>
        </div>
      </dl>
      <div className="master-action-row">
        <button type="button" className="primary" onClick={() => void copy()}>
          {copied ? "Copied" : "Copy login details"}
        </button>
        <button type="button" onClick={onDone}>
          Done
        </button>
      </div>
    </div>
  );
}
