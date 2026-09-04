import { useAuth } from "./AuthContext";
import { normalizeEntitlements } from "./companyEntitlements";
import "./BookingLifecycleActions.css";

type Props = {
  busy?: boolean;
  compact?: boolean;
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
  compact = false,
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
  const { company } = useAuth();
  const planAllowsAdjust = normalizeEntitlements(company?.entitlements).features.booking_adjustments;
  const adjustEnabled = canAdjust && planAllowsAdjust;
  return (
    <div className={`booking-lifecycle-actions${compact ? " compact" : ""}`}>
      {onOpen && (
        <button type="button" className="open" disabled={!canOpen || busy} onClick={onOpen}>
          {compact ? "Open" : "Open Booking"}
        </button>
      )}
      {onAdjustment && (
        <button
          type="button"
          className="adjustment"
          disabled={!adjustEnabled || busy}
          title={
            planAllowsAdjust
              ? undefined
              : "Booking adjustments are not included on Free Tier. Upgrade plans will be offered here later."
          }
          onClick={onAdjustment}
        >
          {compact ? "Adjust" : "Booking Adjustment"}
        </button>
      )}
      {onHistory && (
        <button type="button" className="history" disabled={!canHistory || busy} onClick={onHistory}>
          History
        </button>
      )}
      {onVoid && (
        <button type="button" className="void" disabled={!canVoid || busy} onClick={onVoid}>
          {compact ? "Void" : "Void Booking"}
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
          {compact ? "Delete" : "Delete (Test)"}
        </button>
      )}
    </div>
  );
}
