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

/**
 * Legacy compatibility component.
 * Package, Ticket, Visa, Transport and Misc are now created from the unified
 * Bookings module. Keeping this route read-only prevents duplicate ledgers.
 */
export function ServicesModule(_props: ModuleProps) {
  return (
    <section className="content-card">
      <div className="page-title">
        <div>
          <span className="eyebrow green-text">LEGACY MODULE RETIRED</span>
          <h2>Services moved to Bookings</h2>
          <p>
            Use Bookings → Sale/Purchase and select Package, Ticket, Visa, Transport or Misc. Those records now feed
            ledgers and Statements automatically.
          </p>
        </div>
      </div>
      <div className="alert info">Manual Service entries are disabled to prevent duplicate accounting records.</div>
    </section>
  );
}

/** Kept only as a compile-safe compatibility export for older imports. */
export function ServiceFormModal({ onClose }: ModalProps) {
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <section className="modal-card" onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-head">
          <div>
            <span className="eyebrow green-text">LEGACY MODULE RETIRED</span>
            <h3>Use the Bookings module</h3>
          </div>
          <button className="close-btn" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="alert info">Service transactions must now be created from Bookings.</div>
        <div className="modal-buttons">
          <button className="primary" onClick={onClose}>
            Close
          </button>
        </div>
      </section>
    </div>
  );
}
