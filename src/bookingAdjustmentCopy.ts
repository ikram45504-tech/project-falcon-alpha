import type { BookingAdjustmentKind } from "./BookingLifecycle";

export type AdjustmentChoice = {
  type: BookingAdjustmentKind;
  title: string;
  text: string;
  badge: string;
  urdu: string;
};

export const adjustmentSelectionIntro = {
  title: "What do you want to do?",
  text: "Every option keeps the original UB and records Booking History. Cancellation updates the account balance only — use Payments when you actually return cash to the customer or receive cash from a vendor.",
  urdu: "Cancellation se account balance change hota hai. Customer ko paisay wapas dene ke liye Payments → Refund to Customer use karein.",
};

export function adjustmentTypeLabel(type: BookingAdjustmentKind | string) {
  if (type === "CORRECTION") return "Data Correction";
  if (type === "AMENDMENT") return "Booking Amendment";
  if (type === "PARTIAL_CANCELLATION") return "Partial Cancellation";
  return "Full Cancellation";
}

export function buildAdjustmentChoices(serviceLabel: string, partialItemLabel: string): AdjustmentChoice[] {
  return [
    {
      type: "CORRECTION",
      title: "Data Correction",
      badge: "NO FEE · AUDIT ONLY",
      text: "Fix typing or entry mistakes only. No fee, not a commercial revision, and hidden from customer Statements.",
      urdu: "Sirf ghalat entry theek karni ho — koi extra charge nahi.",
    },
    {
      type: "AMENDMENT",
      title: "Booking Amendment",
      badge: "COMMERCIAL CHANGE",
      text: "Record a genuine post-booking change. The result may be an extra charge, an account credit, or no financial change.",
      urdu: "Booking mein asal tabdeeli — charge ya credit ho sakta hai.",
    },
    {
      type: "PARTIAL_CANCELLATION",
      title: "Partial Cancellation",
      badge: "ACCOUNT CREDIT",
      text: `Cancel selected ${partialItemLabel}, apply cancellation charges, and credit the account balance. This is not a cash refund.`,
      urdu: "Kuch hissa cancel — balance credit hoga. Cash refund alag se Payments se.",
    },
    {
      type: "FULL_CANCELLATION",
      title: "Full Cancellation",
      badge: "FULL BOOKING",
      text: `Cancel the complete ${serviceLabel} booking, keep any cancellation fee, and credit the account. Record cash returned separately in Payments.`,
      urdu: "Poori booking cancel — balance adjust. Paisay wapas Payments → Refund se.",
    },
  ];
}
