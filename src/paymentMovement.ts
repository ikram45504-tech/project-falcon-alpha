import type { PaymentMethod, PaymentTransactionKind } from "./PaymentV2Db";

export function fromReceivingLabels(method: PaymentMethod) {
  return method === "BANK"
    ? { from: "From (Account)", receiving: "Receiving (Account)" }
    : { from: "From (Person)", receiving: "Receiving (Person)" };
}

export function movementAccounts(kind: PaymentTransactionKind, accountName: string, settlementAccount: string) {
  if (kind === "PARTY_RECEIPT") return { from: accountName, to: settlementAccount };
  if (kind === "VENDOR_PAYMENT") return { from: settlementAccount, to: accountName };
  if (kind === "PARTY_REFUND") return { from: settlementAccount, to: accountName };
  return { from: accountName, to: settlementAccount };
}

export function settlementSideForKind(kind: PaymentTransactionKind): "from" | "receiving" {
  return kind === "PARTY_RECEIPT" || kind === "VENDOR_REFUND" ? "receiving" : "from";
}

export function settlementAccountFromMovement(kind: PaymentTransactionKind, fromAccount: string, toAccount: string) {
  return settlementSideForKind(kind) === "receiving" ? toAccount.trim() : fromAccount.trim();
}

export function defaultSettlementForMethod(paymentType: PaymentMethod, current = "") {
  if (paymentType === "CASH") return current.trim() && current !== "Cash in Hand" ? current : "Cash in Hand";
  return current.trim() === "Cash in Hand" ? "" : current;
}

/** Prefill movement rows when party or payment method changes; keeps user edits on the settlement side when possible. */
export function buildMovementFields(input: {
  transactionKind: PaymentTransactionKind;
  accountName: string;
  paymentType: PaymentMethod;
  fromAccount?: string;
  toAccount?: string;
  preferSettlement?: string;
}) {
  const settlementSide = settlementSideForKind(input.transactionKind);
  const existingSettlement =
    settlementSide === "receiving" ? (input.toAccount || "").trim() : (input.fromAccount || "").trim();
  const settlement =
    input.preferSettlement?.trim() ||
    defaultSettlementForMethod(input.paymentType, existingSettlement) ||
    existingSettlement;
  const { from, to } = movementAccounts(input.transactionKind, input.accountName, settlement);
  return {
    fromAccount: from,
    toAccount: to,
    settlementAccount: settlement,
  };
}

export function patchMovementField(input: {
  transactionKind: PaymentTransactionKind;
  side: "from" | "receiving";
  value: string;
  fromAccount: string;
  toAccount: string;
}) {
  const fromAccount = input.side === "from" ? input.value : input.fromAccount;
  const toAccount = input.side === "receiving" ? input.value : input.toAccount;
  return {
    fromAccount,
    toAccount,
    settlementAccount: settlementAccountFromMovement(input.transactionKind, fromAccount, toAccount),
  };
}
