import { describe, it, expect } from "vitest";
import {
  num,
  whole,
  visaVehicleCapacity,
  calculateVisaSummary,
  ticketRowHasData,
  ticketRowTotal,
  hotelCountNights,
  calculateHotelSummary,
  calculateTransportSummary,
  calculateMiscSummary,
  calculatePackageSummary,
} from "./pricingEngines";

describe("Utility Functions", () => {
  it("num() safely converts values", () => {
    expect(num("10")).toBe(10);
    expect(num(10)).toBe(10);
    expect(num(null)).toBe(0);
    expect(num(undefined)).toBe(0);
    expect(num("abc")).toBe(0); // NaN becomes 0
  });

  it("whole() correctly parses positive integers", () => {
    expect(whole("10.9")).toBe(10);
    expect(whole("-5")).toBe(0);
    expect(whole("5")).toBe(5);
  });
});

describe("Visa Pricing Engine", () => {
  it("visaVehicleCapacity() returns correct capacities", () => {
    expect(visaVehicleCapacity("CAR")).toBe(4);
    expect(visaVehicleCapacity("BUS")).toBe(47);
  });

  it("calculates visa summary correctly", () => {
    const summary = calculateVisaSummary(
      [
        {
          passengerType: "ADULT",
          visaType: "UMRAH_VISA_TRANSPORT",
          visaRateSar: "250",
          paxCount: "2",
          roe: "75",
        },
      ],
      [
        {
          vehicleType: "CAR",
          quantity: "1",
          ratePerVehicleSar: "100",
        },
      ],
      "50",
    );
    expect(summary.visaPax).toBe(2);
    expect(summary.visaSar).toBe(500);
    expect(summary.fleetSar).toBe(100);
    expect(summary.unconvertedSar).toBe(100);
    expect(summary.convertedPkr).toBe(37500);
  });
});

describe("Ticket Pricing Engine", () => {
  it("computes row total correctly", () => {
    const row = {
      passengerType: "ADULT" as const,
      passengerName: "Test",
      airlineName: "SV",
      pnr: "XYZ",
      ticketRoute: "KHI-JED",
      rate: "1000",
      count: "2",
    };
    expect(ticketRowTotal(row)).toBe(2000);
  });

  it("ignores empty rows", () => {
    const row = {
      passengerType: "ADULT" as const,
      passengerName: "",
      airlineName: "",
      pnr: "",
      ticketRoute: "",
      rate: "",
      count: "2",
    };
    expect(ticketRowHasData(row)).toBe(false);
    expect(ticketRowTotal(row)).toBe(0);
  });
});

describe("Hotel Pricing Engine", () => {
  it("calculates nights correctly", () => {
    expect(hotelCountNights("2024-01-01", "2024-01-05")).toBe(4);
    expect(hotelCountNights("2024-01-01", "2024-01-01")).toBe(0);
  });

  it("calculates hotel summary correctly", () => {
    const summary = calculateHotelSummary([
      {
        guestName: "John Doe",
        city: "Makkah",
        hotelName: "Hilton",
        checkIn: "2024-01-01",
        checkOut: "2024-01-05",
        nights: "4",
        roomType: "QUAD",
        quantity: "1",
        rate: "100",
        roe: "75",
      },
    ]);
    expect(summary.stays).toBe(1);
    expect(summary.totalNights).toBe(4);
    expect(summary.rooms).toBe(1);
    expect(summary.totalSar).toBe(400);
    expect(summary.totalPkr).toBe(30000);
  });
});

describe("Transport Pricing Engine", () => {
  it("calculates private transport correctly", () => {
    const summary = calculateTransportSummary([
      {
        transportType: "PRIVATE_VEHICLE",
        vehicleType: "CAR",
        rateSar: "200",
        paxCount: "0",
        vehicleCount: "2",
        roe: "75",
      },
    ]);
    expect(summary.privateVehicles).toBe(2);
    expect(summary.totalSar).toBe(400);
    expect(summary.totalPkr).toBe(30000);
  });
});

describe("Misc Pricing Engine", () => {
  it("calculates misc summary correctly", () => {
    const summary = calculateMiscSummary([
      {
        serviceName: "Ziyarat",
        familyHead: "Test",
        paxCount: "4",
        ratePerPerson: "50",
        roe: "0",
      },
    ]);
    expect(summary.services).toBe(1);
    expect(summary.paxEntries).toBe(4);
    expect(summary.totalSar).toBe(0);
    expect(summary.totalPkr).toBe(200);
  });
});

describe("Package Pricing Engine", () => {
  it("calculates package summary correctly", () => {
    const summary = calculatePackageSummary([
      {
        passengerType: "ADULT",
        passengerName: "Test",
        packageType: "VIP",
        rate: "100000",
        count: "2",
      },
    ]);
    expect(summary.totalPax).toBe(2);
    expect(summary.grandTotal).toBe(200000);
  });
});
