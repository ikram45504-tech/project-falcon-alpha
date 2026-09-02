import type { Party } from "./db";
import type { PaymentTransactionKind } from "./PaymentV2Db";

export function defaultPaymentKind(accountType: Party["account_type"]): PaymentTransactionKind {
  return accountType === "VENDOR" ? "VENDOR_PAYMENT" : "PARTY_RECEIPT";
}

export function inferPaymentKind(
  meta: { transaction_kind?: PaymentTransactionKind } | null | undefined,
  accountType: Party["account_type"],
): PaymentTransactionKind {
  if (meta?.transaction_kind) return meta.transaction_kind;
  return defaultPaymentKind(accountType);
}

/** Positive = money received from / paid to counterparty that reduces the open balance. */
export function signedPaymentSettlement(paidAmount: number, kind: PaymentTransactionKind): number {
  const amount = Number(paidAmount || 0);
  if (kind === "PARTY_REFUND" || kind === "VENDOR_REFUND") return -amount;
  return amount;
}

export function sumSignedPaymentSettlements(
  rows: Array<{ paid_amount: number }>,
  kindForIndex: (index: number) => PaymentTransactionKind,
): number {
  return rows.reduce((sum, row, index) => sum + signedPaymentSettlement(row.paid_amount, kindForIndex(index)), 0);
}

export function accountBalanceFromTotals(bookingTotal: number, signedPaymentSettlementTotal: number) {
  return Number(bookingTotal || 0) - Number(signedPaymentSettlementTotal || 0);
}

export function paymentKindLabel(kind: PaymentTransactionKind) {
  if (kind === "PARTY_REFUND" || kind === "VENDOR_REFUND") return "Refund";
  return "Payment";
}
