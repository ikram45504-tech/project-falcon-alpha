import type { PartyInput } from "./db";
import "./AccountForm.css";

type Props = {
  value: PartyInput;
  onChange: (next: PartyInput) => void;
  /** Show Party / Vendor / Unassigned selector (Counterparties unassigned view). */
  showAccountType?: boolean;
  namePlaceholder?: string;
  autoFocus?: boolean;
};

function nameLabel(accountType: PartyInput["accountType"]) {
  if (accountType === "VENDOR") return "Vendor Name *";
  if (accountType === "PARTY") return "Party Name *";
  return "Account Name *";
}

export default function AccountForm({
  value,
  onChange,
  showAccountType = false,
  namePlaceholder = "e.g. ABC Travel & Tours",
  autoFocus = true,
}: Props) {
  const phoneWhatsapp = value.phone || value.whatsapp || "";

  function patch(partial: Partial<PartyInput>) {
    onChange({ ...value, ...partial });
  }

  function setPhoneWhatsapp(raw: string) {
    patch({ phone: raw, whatsapp: raw });
  }

  return (
    <div className="account-form">
      <label className="account-form-wide">
        {nameLabel(value.accountType)}
        <input
          autoFocus={autoFocus}
          value={value.name}
          onChange={(e) => patch({ name: e.target.value })}
          placeholder={namePlaceholder}
        />
      </label>

      <label>
        Contact Person
        <input
          value={value.contactPerson}
          onChange={(e) => patch({ contactPerson: e.target.value })}
          placeholder="Optional"
        />
      </label>

      <label>
        Phone / WhatsApp
        <input
          value={phoneWhatsapp}
          onChange={(e) => setPhoneWhatsapp(e.target.value)}
          placeholder="+92..."
          inputMode="tel"
        />
      </label>

      <label>
        Email
        <input
          type="email"
          value={value.email}
          onChange={(e) => patch({ email: e.target.value })}
          placeholder="Optional"
        />
      </label>

      <label>
        Address
        <input value={value.address} onChange={(e) => patch({ address: e.target.value })} placeholder="Optional" />
      </label>

      <label className="account-form-wide">
        Reference
        <input
          value={value.reference}
          onChange={(e) => patch({ reference: e.target.value })}
          placeholder="Optional internal reference"
        />
      </label>

      {showAccountType && (
        <label>
          Account Type *
          <select
            value={value.accountType}
            onChange={(e) => patch({ accountType: e.target.value as PartyInput["accountType"] })}
          >
            <option value="PARTY">PARTY — Sale / Receivable</option>
            <option value="VENDOR">VENDOR — Purchase / Payable</option>
            <option value="UNASSIGNED">UNASSIGNED — classify later</option>
          </select>
        </label>
      )}

      <label>
        Status
        <select value={value.status} onChange={(e) => patch({ status: e.target.value as PartyInput["status"] })}>
          <option value="ACTIVE">ACTIVE</option>
          <option value="INACTIVE">INACTIVE</option>
        </select>
      </label>
    </div>
  );
}
