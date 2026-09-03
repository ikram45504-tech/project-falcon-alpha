import type { BookingServiceName } from "./BookingLifecycle";

/** Unit name shown next to charge rate / qty on adjustment screens. */
export function adjustmentChargeUnitLabel(service: BookingServiceName): string {
  if (service === "PACKAGE" || service === "VISA") return "Pax";
  if (service === "TICKET") return "Ticket";
  if (service === "HOTEL") return "Room / Bed";
  return "Unit";
}

/** Clamp typed charge qty to 0..maxAvailable (booking available units). */
export function clampChargeQty(qtyInput: string, maxAvailable: number) {
  const max = Math.max(0, Math.trunc(maxAvailable));
  const qty = Math.max(0, Math.trunc(Number(qtyInput) || 0));
  return Math.min(qty, max);
}

/** Total charge saved to charge_pkr = rate × qty (qty capped by maxAvailable when provided). */
export function totalChargeFromRateAndQty(rateInput: string, qtyInput: string, maxAvailable?: number) {
  const rate = Math.max(0, Number(rateInput) || 0);
  const qty =
    maxAvailable != null ? clampChargeQty(qtyInput, maxAvailable) : Math.max(0, Math.trunc(Number(qtyInput) || 0));
  return rate * qty;
}

type AdjustmentChargeFieldsProps = {
  mode: "amendment" | "cancellation";
  /** e.g. Additional Amendment Charge / Cancellation Charge / Supplier Amendment Cost */
  chargeLabel: string;
  chargeHelp: string;
  unitLabel: string;
  rate: string;
  qty: string;
  onRateChange: (value: string) => void;
  onQtyChange: (value: string) => void;
  totalCharge: number;
  formatMoney: (value: number) => string;
  /** Max units allowed (= current available qty on the booking). */
  maxQty: number;
  /** Partial/full cancel: show net account credit preview beside the inputs. */
  cancellationNetCredit?: number;
};

/**
 * Charge = (amount per unit) × qty.
 * Credit/discount is intentionally omitted from adjustment UI.
 */
export function AdjustmentChargeFields({
  mode,
  chargeLabel,
  chargeHelp,
  unitLabel,
  rate,
  qty,
  onRateChange,
  onQtyChange,
  totalCharge,
  formatMoney,
  maxQty,
  cancellationNetCredit,
}: AdjustmentChargeFieldsProps) {
  const max = Math.max(0, Math.trunc(maxQty));

  function handleQtyChange(raw: string) {
    if (raw === "") {
      onQtyChange(raw);
      return;
    }
    const parsed = Math.trunc(Number(raw) || 0);
    if (parsed > max) {
      onQtyChange(String(max));
      return;
    }
    if (parsed < 0) {
      onQtyChange("0");
      return;
    }
    onQtyChange(raw);
  }

  return (
    <div className={`adj-charge-grid ${mode === "cancellation" ? "has-cancel-preview" : ""}`}>
      <label>
        {chargeLabel} / {unitLabel} (PKR)
        <input
          type="number"
          min="0"
          step="0.01"
          value={rate}
          onChange={(e) => onRateChange(e.target.value)}
          placeholder="0"
        />
        <small>{chargeHelp}</small>
      </label>
      <label>
        Qty ({unitLabel})
        <input
          type="number"
          min="0"
          max={max}
          step="1"
          value={qty}
          onChange={(e) => handleQtyChange(e.target.value)}
          placeholder="1"
        />
        <small>
          Max {max} available · Charge × qty = <b>{formatMoney(totalCharge)}</b>
        </small>
      </label>
      {mode === "cancellation" && cancellationNetCredit != null ? (
        <div className="adj-credit-preview">
          <small>NET ACCOUNT CREDIT</small>
          <b>{formatMoney(cancellationNetCredit)}</b>
          <span>This is not a cash refund. Refund movement is recorded later in Payments if money is returned.</span>
        </div>
      ) : null}
    </div>
  );
}
