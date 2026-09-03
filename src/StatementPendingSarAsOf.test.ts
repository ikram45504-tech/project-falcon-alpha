import { describe, expect, it } from "vitest";
import {
  statementPendingSarAsOf,
  type StatementBookingSections,
  type HotelStatementBooking,
} from "./StatementBookingData";

function emptySections(): StatementBookingSections {
  return {
    packageBookings: [],
    ticketBookings: [],
    hotelBookings: [],
    visaBookings: [],
    transportBookings: [],
    miscBookings: [],
  };
}

function hotelBooking(partial: {
  id: string;
  transaction_date: string;
  unconverted_sar: number;
  adjustments?: Array<{ adjustment_date: string; lifecycle_status: "ACTIVE" | "CANCELLED" }>;
}): HotelStatementBooking {
  const adjustments = (partial.adjustments || []).map((row, index) => ({
    id: `${partial.id}-adj-${index}`,
    company_id: "c1",
    booking_id: partial.id,
    adjustment_type: "AMENDMENT" as const,
    adjustment_date: row.adjustment_date,
    requested_by: "INTERNAL" as const,
    category: "",
    reason: "",
    reference: "",
    notes: "",
    previous_total_pkr: 0,
    previous_base_pkr: 0,
    revised_base_pkr: 0,
    charge_pkr: 0,
    credit_pkr: 0,
    account_delta_pkr: 0,
    effective_total_pkr: 1000,
    before_snapshot_json: "",
    after_snapshot_json: "",
    cancelled_lines_json: "",
    revision_no: index + 1,
    lifecycle_status: row.lifecycle_status,
    created_by_user_id: "u1",
    created_at: `${row.adjustment_date}T10:00:00.000Z`,
    service_type: "HOTEL" as const,
  }));

  return {
    id: partial.id,
    company_id: "c1",
    transaction_type: "SALE",
    counterparty_id: "p1",
    transaction_date: partial.transaction_date,
    ub_number: "UB-0001",
    total_sar: 100,
    total_pkr: 28000,
    unconverted_sar: partial.unconverted_sar,
    status: "ACTIVE",
    created_at: `${partial.transaction_date}T09:00:00.000Z`,
    guestRefs: [],
    statementService: "HOTEL",
    statementAdjustments: adjustments,
    statementDisplayAdjustments: adjustments,
    statementEvents: [
      {
        transaction_date: partial.transaction_date,
        total_pkr: 28000,
        unconverted_sar: adjustments.length ? 0 : partial.unconverted_sar,
        service_type: "HOTEL",
        booking_id: partial.id,
        event_type: "BOOKING",
      },
      ...adjustments.map((adjustment, index) => ({
        transaction_date: adjustment.adjustment_date,
        total_pkr: 0,
        unconverted_sar: index === adjustments.length - 1 ? partial.unconverted_sar : 0,
        service_type: "HOTEL" as const,
        booking_id: partial.id,
        event_type: "ADJUSTMENT" as const,
        adjustment_id: adjustment.id,
      })),
    ],
    statementOriginalTotalPkr: 28000,
    statementOriginalSnapshotJson: "",
    statementAsOfTotalPkr: 28000,
    statementPeriodActivityPkr: 28000,
    statementOriginalInPeriod: true,
  } as HotelStatementBooking;
}

describe("statementPendingSarAsOf", () => {
  it("keeps pending SAR when the latest adjustment is after the statement end date", () => {
    const sections = emptySections();
    sections.hotelBookings = [
      hotelBooking({
        id: "h1",
        transaction_date: "2026-03-01",
        unconverted_sar: 2280,
        adjustments: [{ adjustment_date: "2026-05-10", lifecycle_status: "ACTIVE" }],
      }),
    ];

    // Old event-sum approach would be 0 because pending sits on the May adjustment only.
    expect(statementPendingSarAsOf(sections, "2026-04-30", "onOrBefore")).toBe(2280);
    expect(statementPendingSarAsOf(sections, "2026-05-10", "onOrBefore")).toBe(2280);
  });

  it("excludes bookings that start after the as-of date", () => {
    const sections = emptySections();
    sections.hotelBookings = [
      hotelBooking({
        id: "h2",
        transaction_date: "2026-06-01",
        unconverted_sar: 500,
      }),
    ];
    expect(statementPendingSarAsOf(sections, "2026-05-31", "onOrBefore")).toBe(0);
  });

  it("excludes bookings cancelled on or before the as-of date", () => {
    const sections = emptySections();
    sections.hotelBookings = [
      hotelBooking({
        id: "h3",
        transaction_date: "2026-03-01",
        unconverted_sar: 900,
        adjustments: [{ adjustment_date: "2026-03-15", lifecycle_status: "CANCELLED" }],
      }),
    ];
    expect(statementPendingSarAsOf(sections, "2026-03-31", "onOrBefore")).toBe(0);
  });

  it("supports exclusive opening-boundary (before fromDate)", () => {
    const sections = emptySections();
    sections.hotelBookings = [
      hotelBooking({
        id: "h4",
        transaction_date: "2026-04-01",
        unconverted_sar: 100,
      }),
    ];
    expect(statementPendingSarAsOf(sections, "2026-04-01", "before")).toBe(0);
    expect(statementPendingSarAsOf(sections, "2026-04-01", "onOrBefore")).toBe(100);
  });
});
