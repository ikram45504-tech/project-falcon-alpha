import { describe, expect, it } from "vitest";
import {
  buildPackageMovementEvents,
  derivePackageTravelWindow,
  syncPackagePassengerRoster,
  type PackageFlightJourney,
} from "./PackageOperationalDb";

const ub1144Flights = [
  {
    journey: "OUTBOUND" as PackageFlightJourney,
    flightType: "DIRECT" as const,
    departureDate: "2026-10-10",
    pnr: "ABC123",
    flightNo: "SV302",
    fromAirport: "KHI",
    toAirport: "JED",
    departureTime: "02:00",
    arrivalTime: "05:00",
  },
  {
    journey: "RETURN" as PackageFlightJourney,
    flightType: "DIRECT" as const,
    departureDate: "2026-10-20",
    pnr: "ABC123",
    flightNo: "SV303",
    fromAirport: "JED",
    toAirport: "KHI",
    departureTime: "21:00",
    arrivalTime: "04:00",
  },
];

const ub1144Hotels = [
  { cityName: "MAKKAH", hotelName: "MAKKAH TOWER", checkIn: "2026-10-10", checkOut: "2026-10-13", nights: 3 },
  {
    cityName: "MADINAH",
    hotelName: "ANWAR AL MADINAH MOVENPICK",
    checkIn: "2026-10-13",
    checkOut: "2026-10-17",
    nights: 4,
  },
  { cityName: "MAKKAH", hotelName: "LE MERDIAN TOWER", checkIn: "2026-10-17", checkOut: "2026-10-20", nights: 3 },
];

describe("Package section sync — passenger roster", () => {
  function blank(type: "ADULT" | "CHILD" | "INFANT") {
    return { passengerType: type, givenName: "", id: `${type}-new` };
  }

  it("builds one operational passenger row per booked adult/child/infant", () => {
    const roster = syncPackagePassengerRoster([], { adult: 3, child: 2, infant: 2 }, blank);
    expect(roster.map((row) => row.passengerType)).toEqual([
      "ADULT",
      "ADULT",
      "ADULT",
      "CHILD",
      "CHILD",
      "INFANT",
      "INFANT",
    ]);
  });

  it("keeps existing names when commercial pax increases", () => {
    const current = [
      { passengerType: "ADULT" as const, givenName: "Ali", id: "a1" },
      { passengerType: "ADULT" as const, givenName: "Omar", id: "a2" },
      { passengerType: "CHILD" as const, givenName: "Sara", id: "c1" },
    ];
    const roster = syncPackagePassengerRoster(current, { adult: 3, child: 1, infant: 1 }, blank);
    expect(roster.map((row) => row.givenName)).toEqual(["Ali", "Omar", "", "Sara", ""]);
    expect(roster[2].passengerType).toBe("ADULT");
    expect(roster[4].passengerType).toBe("INFANT");
  });

  it("drops extra operational rows when commercial pax decreases after an amendment", () => {
    const current = [
      { passengerType: "ADULT" as const, givenName: "One", id: "a1" },
      { passengerType: "ADULT" as const, givenName: "Two", id: "a2" },
      { passengerType: "CHILD" as const, givenName: "Kid", id: "c1" },
    ];
    const roster = syncPackagePassengerRoster(current, { adult: 1, child: 0, infant: 0 }, blank);
    expect(roster).toEqual([{ passengerType: "ADULT", givenName: "One", id: "a1" }]);
  });
});

describe("Package section sync — flights, hotels, movement", () => {
  it("rebuilds the movement timeline from the live UB-1144 itinerary", () => {
    const events = buildPackageMovementEvents(ub1144Flights, ub1144Hotels);
    expect(events.map((event) => event.eventType)).toEqual([
      "OUTBOUND_DEPARTURE",
      "HOTEL_CHECKOUT_TRANSFER",
      "HOTEL_CHECKOUT_TRANSFER",
      "FINAL_HOTEL_CHECKOUT",
      "RETURN_DEPARTURE",
    ]);
    expect(events[0]).toMatchObject({ eventDate: "2026-10-10", fromLocation: "KHI", toLocation: "JED" });
    expect(events[1]).toMatchObject({ eventDate: "2026-10-13", fromLocation: "MAKKAH", toLocation: "MADINAH" });
    expect(events[2]).toMatchObject({ eventDate: "2026-10-17", fromLocation: "MADINAH", toLocation: "MAKKAH" });
    expect(events[3]).toMatchObject({ eventDate: "2026-10-20", fromLocation: "MAKKAH", toLocation: "JED" });
    expect(events[4]).toMatchObject({ eventDate: "2026-10-20", fromLocation: "JED", toLocation: "KHI" });
  });

  it("includes stopover airports in outbound movement text", () => {
    const events = buildPackageMovementEvents(
      [
        {
          ...ub1144Flights[0],
          flightType: "INDIRECT",
        },
      ],
      [],
      [{ journey: "OUTBOUND", airport: "DXB", departureDate: "2026-10-10", departureTime: "06:00" }],
    );
    expect(events[0].description).toContain("via DXB");
  });

  it("copies operational flight dates onto the commercial travel window", () => {
    expect(derivePackageTravelWindow(ub1144Flights, ub1144Hotels)).toEqual({
      departureDate: "2026-10-10",
      returnDate: "2026-10-20",
      noOfDays: 10,
    });
  });

  it("falls back to hotel dates when flights have no dates yet", () => {
    expect(
      derivePackageTravelWindow(
        [
          { journey: "OUTBOUND", departureDate: "" },
          { journey: "RETURN", departureDate: "" },
        ],
        ub1144Hotels,
      ),
    ).toEqual({
      departureDate: "2026-10-10",
      returnDate: "2026-10-20",
      noOfDays: 10,
    });
  });
});
