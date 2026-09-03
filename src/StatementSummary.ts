import type { Party, PaymentEntry } from "./db";
import type { StatementBookingMeta, StatementBookingSections } from "./StatementBookingData";
import type { PaymentV2Meta, PaymentTransactionKind } from "./PaymentV2Db";
import { inferPaymentKind, signedPaymentSettlement } from "./accountBalance";

function isCancelled(row: StatementBookingMeta) {
  const latest = row.statementDisplayAdjustments[row.statementDisplayAdjustments.length - 1];
  return latest?.lifecycle_status === "CANCELLED";
}

function effectiveSarTotal(rows: Array<StatementBookingMeta & { total_sar?: number }>) {
  return rows.reduce((total, row) => {
    if (isCancelled(row)) return total;
    return total + Number(row.total_sar || 0);
  }, 0);
}

/** Period commercial SAR (hotel / visa / transport / misc). */
export function statementPeriodActivitySar(sections: StatementBookingSections) {
  return (
    effectiveSarTotal(sections.hotelBookings) +
    effectiveSarTotal(sections.visaBookings) +
    effectiveSarTotal(sections.transportBookings) +
    effectiveSarTotal(sections.miscBookings)
  );
}

export function statementActivityLabel(accountType: Party["account_type"]) {
  return accountType === "VENDOR" ? "TOTAL PURCHASE" : "TOTAL SALES";
}

/** Dynamic closing-balance box title from account type + PKR sign. */
export function statementClosingBalanceLabel(accountType: Party["account_type"], closingBalancePkr: number) {
  const n = Number(closingBalancePkr || 0);
  if (Math.abs(n) < 0.005) return "SETTLED BALANCE";
  if (accountType === "VENDOR") return n > 0 ? "PAYABLE BALANCE" : "SUPPLIER ADVANCE";
  return n > 0 ? "RECEIVABLE BALANCE" : "ADVANCE BALANCE";
}

/** Advance / settled show absolute PKR; due balances stay positive as-is. */
export function statementClosingBalanceDisplayPkr(closingBalancePkr: number) {
  return Math.abs(Number(closingBalancePkr || 0));
}

export function signedPaymentSarAmount(entry: PaymentEntry, kind: PaymentTransactionKind) {
  if (entry.currency !== "SAR") return 0;
  const amount = Number(entry.sar || 0);
  return kind === "PARTY_REFUND" || kind === "VENDOR_REFUND" ? -amount : amount;
}

export function sumSignedPaymentSar(
  payments: PaymentEntry[],
  paymentMeta: Map<string, PaymentV2Meta> | undefined,
  accountType: Party["account_type"],
) {
  return payments.reduce((total, entry) => {
    const kind = inferPaymentKind(paymentMeta?.get(entry.id), accountType);
    return total + signedPaymentSarAmount(entry, kind);
  }, 0);
}

export function sumSignedPaymentPkr(
  payments: PaymentEntry[],
  paymentMeta: Map<string, PaymentV2Meta> | undefined,
  accountType: Party["account_type"],
) {
  return payments.reduce((total, entry) => {
    const kind = inferPaymentKind(paymentMeta?.get(entry.id), accountType);
    return total + signedPaymentSettlement(entry.paid_amount, kind);
  }, 0);
}

/** Hide SAR secondary when zero (or tiny). */
export function hasSarFigure(value: number | null | undefined) {
  return Math.abs(Number(value || 0)) >= 0.005;
}
