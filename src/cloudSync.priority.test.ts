import { describe, expect, it } from "vitest";
import { sortSyncQueueJobs, syncTablePriority } from "./cloudSync";

describe("syncTablePriority", () => {
  it("pushes counterparties before bookings and payments", () => {
    expect(syncTablePriority("vendors")).toBeLessThan(syncTablePriority("package_bookings"));
    expect(syncTablePriority("parties")).toBeLessThan(syncTablePriority("payment_entries"));
    expect(syncTablePriority("payment_entries")).toBeLessThan(syncTablePriority("payment_v2_meta"));
  });

  it("sorts mixed queue jobs by dependency while keeping stable order", () => {
    const jobs = [
      { id: "1", table_name: "package_bookings" },
      { id: "2", table_name: "vendors" },
      { id: "3", table_name: "payment_entries" },
      { id: "4", table_name: "parties" },
      { id: "5", table_name: "package_booking_lines" },
    ];
    expect(sortSyncQueueJobs(jobs).map((job) => job.id)).toEqual(["2", "4", "1", "3", "5"]);
  });
});
