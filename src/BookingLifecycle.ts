import type { BookingTransactionType } from "./db";

export type BookingServiceName = "PACKAGE" | "TICKET" | "HOTEL" | "VISA" | "TRANSPORT" | "MISC";
export type BookingAdjustmentKind = "CORRECTION" | "AMENDMENT" | "PARTIAL_CANCELLATION" | "FULL_CANCELLATION";
export type BookingLifecycleStatus = "ACTIVE" | "AMENDED" | "PARTIALLY_CANCELLED" | "CANCELLED" | "VOID";

export type BookingLifecycleConfig = {
  service: BookingServiceName;
  label: string;
  amendmentTypes: string[];
  partialCancellationLabel: string;
};

export const bookingLifecycleConfigs: Record<BookingServiceName, BookingLifecycleConfig> = {
  PACKAGE: {
    service: "PACKAGE",
    label: "Full Package",
    amendmentTypes: [
      "Travel Date Change",
      "Passenger / Pax Change",
      "Full Package Change",
      "Included Service Change",
      "Rate / Price Change",
      "Hotel Component Change",
      "Ticket / Flight Component Change",
      "Other",
    ],
    partialCancellationLabel: "Passenger / package quantity",
  },
  TICKET: {
    service: "TICKET",
    label: "Ticket",
    amendmentTypes: [
      "Travel Date / Flight Change",
      "Airline Change",
      "Route Change",
      "Passenger Change",
      "Fare / Reissue Change",
      "Ticket Quantity Change",
      "Other",
    ],
    partialCancellationLabel: "Passenger / ticket quantity",
  },
  HOTEL: {
    service: "HOTEL",
    label: "Hotel",
    amendmentTypes: [
      "Hotel / City Change",
      "Stay Dates / Nights Change",
      "Room Type Change",
      "Room Quantity Change",
      "Guest / Pax Change",
      "Rate / ROE Change",
      "Other",
    ],
    partialCancellationLabel: "Hotel stay / room quantity",
  },
  VISA: {
    service: "VISA",
    label: "Visa",
    amendmentTypes: [
      "Visa Type Change",
      "Passenger / Pax Change",
      "Transport / Fleet Change",
      "Rate / ROE Change",
      "Expected Entry Date Change",
      "Other",
    ],
    partialCancellationLabel: "Passenger / visa quantity",
  },
  TRANSPORT: {
    service: "TRANSPORT",
    label: "Transport",
    amendmentTypes: [
      "Travel Date Change",
      "Sector Change",
      "Vehicle Type Change",
      "Vehicle Quantity Change",
      "Passenger / Pax Change",
      "Rate / ROE Change",
      "Other",
    ],
    partialCancellationLabel: "Sector / vehicle quantity",
  },
  MISC: {
    service: "MISC",
    label: "Misc",
    amendmentTypes: ["Service Change", "Passenger / Pax Change", "Rate Change", "Currency / ROE Change", "Other"],
    partialCancellationLabel: "Service / passenger quantity",
  },
};

export function bookingAccountTerms(transactionType: BookingTransactionType) {
  if (transactionType === "SALE") {
    return {
      accountImpact: "Party Receivable",
      chargeLabel: "Additional Amendment Charge",
      chargeHelp: "Additional commercial charge to the Party / Customer.",
      creditLabel: "Credit / Discount to Party",
      creditHelp: "Commercial credit or discount reducing the Party receivable.",
    };
  }
  return {
    accountImpact: "Vendor Payable",
    chargeLabel: "Supplier Amendment Cost",
    chargeHelp: "Additional commercial cost charged by the Vendor / Supplier.",
    creditLabel: "Vendor Credit / Deduction",
    creditHelp: "Commercial credit or deduction reducing the Vendor payable.",
  };
}
