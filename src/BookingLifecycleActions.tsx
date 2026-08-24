import "./BookingLifecycleActions.css";

type Props = {
  busy?: boolean;
  canOpen?: boolean;
  canAdjust?: boolean;
  canHistory?: boolean;
  canVoid?: boolean;
  canDelete?: boolean;
  onOpen?: () => void;
  onAdjustment?: () => void;
  onHistory?: () => void;
  onVoid?: () => void;
  onDelete?: () => void;
};

export default function BookingLifecycleActions({
  busy = false,
  canOpen = true,
  canAdjust = true,
  canHistory = true,
  canVoid = true,
  canDelete = true,
  onOpen,
  onAdjustment,
  onHistory,
  onVoid,
  onDelete,
}: Props) {
  return (
    <div className="booking-lifecycle-actions">
      {onOpen && (
        <button type="button" className="open" disabled={!canOpen || busy} onClick={onOpen}>
          Open Booking
        </button>
      )}
      {onAdjustment && (
        <button type="button" className="adjustment" disabled={!canAdjust || busy} onClick={onAdjustment}>
          Booking Adjustment
        </button>
      )}
      {onHistory && (
        <button type="button" className="history" disabled={!canHistory || busy} onClick={onHistory}>
          History
        </button>
      )}
      {onVoid && (
        <button type="button" className="void" disabled={!canVoid || busy} onClick={onVoid}>
          Void Booking
        </button>
      )}
      {onDelete && (
        <button
          type="button"
          className="danger"
          style={{ color: "var(--red)", border: "1px solid var(--red)" }}
          disabled={!canDelete || busy}
          onClick={onDelete}
        >
          Delete (Test)
        </button>
      )}
    </div>
  );
}
