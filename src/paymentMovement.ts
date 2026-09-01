import type { PaymentMethod, PaymentTransactionKind } from "./PaymentV2Db";

export function fromReceivingLabels(method: PaymentMethod) {
  return method === "BANK"
    ? { from: "From (Account)", receiving: "Receiving (Account)" }
    : { from: "From (Person)", receiving: "Receiving (Person)" };
}

function movementAccounts(kind: PaymentTransactionKind, accountName: string, settlementAccount: string) {
  if (kind === "PARTY_RECEIPT") return { from: accountName, to: settlementAccount };
  if (kind === "VENDOR_PAYMENT") return { from: settlementAccount, to: accountName };
  if (kind === "PARTY_REFUND") return { from: settlementAccount, to: accountName };
  return { from: accountName, to: settlementAccount };
}

export function movementFieldState(kind: PaymentTransactionKind, accountName: string, settlementAccount: string) {
  const { from, to } = movementAccounts(kind, accountName, settlementAccount);
  const settlementOnReceiving = kind === "PARTY_RECEIPT" || kind === "VENDOR_REFUND";
  return {
    fromValue: from,
    receivingValue: to,
    fromLocked: settlementOnReceiving,
    receivingLocked: !settlementOnReceiving,
  };
}

export function settlementSideForKind(kind: PaymentTransactionKind): "from" | "receiving" {
  return kind === "PARTY_RECEIPT" || kind === "VENDOR_REFUND" ? "receiving" : "from";
}
