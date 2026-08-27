import { beforeEach, describe, expect, it, vi } from "vitest";

type Call = { table: string; op: string; payload?: unknown; rows?: unknown; eq?: [string, unknown]; opts?: unknown };

const { calls, mockFrom } = vi.hoisted(() => {
  const calls: Call[] = [];
  const mockFrom = vi.fn((table: string) => {
    const rec: { table: string; op: string; payload?: unknown; rows?: unknown; eq?: [string, unknown] } = {
      table,
      op: "",
    };
    const api: {
      delete: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
      insert: ReturnType<typeof vi.fn>;
      upsert: ReturnType<typeof vi.fn>;
      eq: ReturnType<typeof vi.fn>;
    } = {
      delete: vi.fn(() => {
        rec.op = "delete";
        return api;
      }),
      update: vi.fn((payload: unknown) => {
        rec.op = "update";
        rec.payload = payload;
        return api;
      }),
      insert: vi.fn(async (rows: unknown) => {
        calls.push({ table, op: "insert", rows });
        return { error: null };
      }),
      upsert: vi.fn(async (payload: unknown, opts?: unknown) => {
        calls.push({ table, op: "upsert", payload, opts });
        return { error: null };
      }),
      eq: vi.fn(async (column: string, value: unknown) => {
        rec.eq = [column, value];
        calls.push({ ...rec });
        return { error: null };
      }),
    };
    return api;
  });
  return { calls, mockFrom };
});

vi.mock("./supabaseClient", () => ({
  supabase: { from: mockFrom },
}));

import {
  applyCloudOperation,
  syncPackageAdjustmentBundle,
  syncPackageBookingBundle,
  syncPackageOperationalBundle,
} from "./cloudSync";

describe("Package cloud sync bundles (web path)", () => {
  beforeEach(() => {
    calls.length = 0;
    mockFrom.mockClear();
    delete (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  });

  it("pushes commercial header then replaces all passenger rate lines", async () => {
    const header = {
      id: "bkg-1",
      company_id: "co-1",
      transaction_type: "SALE",
      counterparty_id: "pty-1",
      transaction_date: "2026-08-27",
      ub_number: "UB-1144",
      total_pkr: 1260000,
      status: "ACTIVE",
      created_at: "2026-08-27T00:00:00.000Z",
      updated_at: "2026-08-27T00:00:00.000Z",
    };
    const lines = [
      {
        id: "l1",
        booking_id: "bkg-1",
        passenger_type: "ADULT",
        passenger_name: "FARMAN SHAH",
        package_type: "15 Days Umrah Package",
        rate_per_person: 250000,
        person_count: 3,
        qty_is_explicit: 1,
        line_total_pkr: 750000,
        sort_order: 1,
      },
    ];

    await syncPackageBookingBundle(header, lines);

    expect(calls.map((call) => `${call.op}:${call.table}`)).toEqual([
      "upsert:package_bookings",
      "delete:package_booking_lines",
      "insert:package_booking_lines",
    ]);
    expect(calls[0].payload).toMatchObject({ id: "bkg-1", ub_number: "UB-1144", total_pkr: 1260000 });
    expect(calls[1].eq).toEqual(["booking_id", "bkg-1"]);
    expect(calls[2].rows).toEqual(lines);
  });

  it("pushes every operational child table for one booking", async () => {
    await syncPackageOperationalBundle("bkg-1", "co-1", {
      notes: "group notes",
      createdAt: "2026-08-27T00:00:00.000Z",
      updatedAt: "2026-08-27T00:00:00.000Z",
      passengers: [{ id: "p1", booking_id: "bkg-1" }],
      hotels: [{ id: "h1", booking_id: "bkg-1" }],
      flights: [{ id: "f1", booking_id: "bkg-1" }],
      stopovers: [],
      movementEvents: [{ id: "m1", booking_id: "bkg-1" }],
    });

    expect(calls.map((call) => `${call.op}:${call.table}`)).toEqual([
      "upsert:package_operational_meta",
      "delete:package_operational_passengers",
      "insert:package_operational_passengers",
      "delete:package_operational_hotels",
      "insert:package_operational_hotels",
      "delete:package_operational_flights",
      "insert:package_operational_flights",
      "delete:package_operational_flight_stopovers",
      "delete:package_movement_events",
      "insert:package_movement_events",
    ]);
    expect(calls[0].opts).toEqual({ onConflict: "booking_id" });
    expect(
      calls.find((call) => call.table === "package_operational_flight_stopovers" && call.op === "insert"),
    ).toBeUndefined();
  });

  it("keeps amendment totals, lines, and history in one cloud write", async () => {
    await syncPackageAdjustmentBundle({
      bookingId: "bkg-1",
      companyId: "co-1",
      totalPkr: 1310000,
      updatedAt: "2026-08-27T01:00:00.000Z",
      updatedByUserId: "user-1",
      lines: [
        {
          id: "l2",
          booking_id: "bkg-1",
          passenger_type: "ADULT",
          passenger_name: "FARMAN SHAH",
          package_type: "15 Days Umrah Package",
          rate_per_person: 250000,
          person_count: 3,
          qty_is_explicit: 1,
          line_total_pkr: 1260000,
          sort_order: 1,
        },
      ],
      adjustment: { id: "adj-1", booking_id: "bkg-1", revision_no: 2, lifecycle_status: "AMENDED" },
    });

    expect(calls.map((call) => `${call.op}:${call.table}`)).toEqual([
      "update:package_bookings",
      "delete:package_booking_lines",
      "insert:package_booking_lines",
      "upsert:package_booking_adjustments",
    ]);
    expect(calls[0].payload).toEqual({
      total_pkr: 1310000,
      updated_at: "2026-08-27T01:00:00.000Z",
      updated_by_user_id: "user-1",
    });
    expect(calls[0].eq).toEqual(["id", "bkg-1"]);
  });

  it("uses booking_id as the key for package operational meta", async () => {
    await applyCloudOperation("UPDATE", "package_operational_meta", "bkg-1", { notes: "n" });
    expect(calls[0]).toMatchObject({ table: "package_operational_meta", op: "update", eq: ["booking_id", "bkg-1"] });
  });
});
