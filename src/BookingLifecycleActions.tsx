import "./BookingLifecycleActions.css";

type Props = {
  busy?: boolean;
  canOpen?: boolean;
  canAdjust?: boolean;
  canHistory?: boolean;
  canVoid?: boolean;
  onOpen?: () => void;
  onAdjustment?: () => void;
  onHistory?: () => void;
  onVoid?: () => void;
};

export default function BookingLifecycleActions({
  busy = false,
  canOpen = true,
  canAdjust = true,
  canHistory = true,
  canVoid = true,
  onOpen,
  onAdjustment,
  onHistory,
  onVoid,
}: Props) {
  return <div className="booking-lifecycle-actions">
    {onOpen && <button type="button" className="open" disabled={!canOpen || busy} onClick={onOpen}>Open Booking</button>}
    {onAdjustment && <button type="button" className="adjustment" disabled={!canAdjust || busy} onClick={onAdjustment}>Booking Adjustment</button>}
    {onHistory && <button type="button" className="history" disabled={!canHistory || busy} onClick={onHistory}>History</button>}
    {onVoid && <button type="button" className="void" disabled={!canVoid || busy} onClick={onVoid}>Void Booking</button>}
  </div>;
}
