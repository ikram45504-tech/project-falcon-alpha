import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SEGMENT_ADJUSTMENT_TABLES } from "./SegmentAdjustmentRecord";

describe("legacy cleanup — segment-only architecture", () => {
  it("defines six isolated segment adjustment tables", () => {
    expect(SEGMENT_ADJUSTMENT_TABLES.map((row) => row.serviceType)).toEqual([
      "PACKAGE",
      "HOTEL",
      "TICKET",
      "VISA",
      "TRANSPORT",
      "MISC",
    ]);
    expect(new Set(SEGMENT_ADJUSTMENT_TABLES.map((row) => row.tableName)).size).toBe(6);
  });

  it("statements read only from segment adjustment tables", () => {
    const statementSource = readFileSync("src/StatementBookingData.ts", "utf8");
    expect(statementSource).toContain("loadSegmentAdjustmentsForStatements");
    expect(statementSource).not.toMatch(/FROM booking_adjustments/i);
    expect(statementSource).not.toMatch(/initLegacyBookingAdjustmentsTable/);
  });

  it("schema.sql has no legacy booking/accommodation/service tables", () => {
    const schema = readFileSync("schema.sql", "utf8");
    expect(schema).not.toMatch(/CREATE TABLE IF NOT EXISTS booking_adjustments/i);
    expect(schema).not.toMatch(/CREATE TABLE IF NOT EXISTS accommodation_entries/i);
    expect(schema).not.toMatch(/CREATE TABLE IF NOT EXISTS service_entries/i);
    expect(schema).toMatch(/ticket_booking_adjustments/i);
    expect(schema).toMatch(/misc_booking_adjustments/i);
  });

  it("sync pull roots exclude legacy tables", () => {
    const dbSource = readFileSync("src/db.ts", "utf8");
    const rootMatch = dbSource.match(/const ROOT_TABLES = \[([\s\S]*?)\];/);
    expect(rootMatch).toBeTruthy();
    const roots = rootMatch![1];
    expect(roots).not.toMatch(/booking_adjustments/);
    expect(roots).not.toMatch(/accommodation_entries/);
    expect(roots).not.toMatch(/service_entries/);
    expect(roots).toMatch(/ticket_bookings/);
    expect(roots).toMatch(/misc_bookings/);
  });
});
