import type { ReactNode } from "react";
import "./AccountForm.css";

type Props = {
  title: string;
  eyebrow?: string;
  error?: string;
  busy?: boolean;
  busyLabel?: string;
  primaryLabel: string;
  onClose: () => void;
  onSubmit: () => void;
  children: ReactNode;
  /** Extra class on backdrop (e.g. package booking overlay). */
  backdropClassName?: string;
};

/** Shared Party/Vendor modal chrome — same layout as Counterparties. */
export default function AccountFormModal({
  title,
  eyebrow = "ACCOUNT MASTER",
  error,
  busy = false,
  busyLabel = "Saving...",
  primaryLabel,
  onClose,
  onSubmit,
  children,
  backdropClassName = "",
}: Props) {
  return (
    <div
      className={`modal-backdrop ${backdropClassName}`.trim()}
      onMouseDown={(e) => {
        if (e.currentTarget === e.target) onClose();
      }}
    >
      <section className="modal-card account-form-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <span className="eyebrow blue">{eyebrow}</span>
            <h3>{title}</h3>
          </div>
          <button type="button" className="close-btn" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        {error ? <div className="alert error">{error}</div> : null}

        {children}

        <div className="modal-buttons">
          <button type="button" className="secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="primary" disabled={busy} onClick={onSubmit}>
            {busy ? busyLabel : primaryLabel}
          </button>
        </div>
      </section>
    </div>
  );
}
