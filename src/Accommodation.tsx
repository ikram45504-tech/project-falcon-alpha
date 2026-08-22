import type { Party } from "./db";

type ModuleProps = {
  companyId: string;
  parties: Party[];
  onOpenLedger: (party: Party) => void;
  onChanged: () => void | Promise<void>;
};

type ModalProps = {
  companyId: string;
  parties: Party[];
  initialPartyId?: string;
  editing?: unknown;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
};

function parseIsoDate(value: string) {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatDate(value: string) {
  const date = parseIsoDate(value);
  if (!date) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  })
    .format(date)
    .replace(/ /g, "-");
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

/**
 * Legacy compatibility component.
 *
 * Accommodation is now entered through Bookings → Hotel. This component is
 * intentionally read-only so an old workspace route cannot create a second,
 * disconnected accommodation ledger.
 */
export function AccommodationModule(_props: ModuleProps) {
  return (
    <section className="content-card">
      <div className="page-title">
        <div>
          <span className="eyebrow blue">LEGACY MODULE RETIRED</span>
          <h2>Accommodation moved to Hotel Bookings</h2>
          <p>
            Use Bookings → Sale/Purchase → Hotel. Hotel bookings now feed account ledgers and Statements automatically.
          </p>
        </div>
      </div>
      <div className="alert info">
        Manual Accommodation entries are disabled to prevent duplicate accounting records.
      </div>
    </section>
  );
}

/** Kept only as a compile-safe compatibility export for older imports. */
export function AccommodationFormModal({ onClose }: ModalProps) {
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <section className="modal-card" onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-head">
          <div>
            <span className="eyebrow blue">LEGACY MODULE RETIRED</span>
            <h3>Use Hotel Bookings</h3>
          </div>
          <button className="close-btn" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="alert info">Accommodation transactions must now be created from Bookings → Hotel.</div>
        <div className="modal-buttons">
          <button className="primary" onClick={onClose}>
            Close
          </button>
        </div>
      </section>
    </div>
  );
}
