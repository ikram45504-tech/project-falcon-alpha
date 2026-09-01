import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { bookingLifecycleConfigs } from "./BookingLifecycle";
import { blankPartyInput, normalizePartyInput, partyToInput } from "./db";
import { SEGMENT_ADJUSTMENT_TABLES } from "./SegmentAdjustmentRecord";

const SEGMENTS = ["PACKAGE", "TICKET", "HOTEL", "VISA", "TRANSPORT", "MISC"] as const;

const SEGMENT_MODULES = {
  PACKAGE: {
    flowDb: "src/PackageFlowDb.ts",
    adjustmentDb: "src/PackageAdjustmentDb.ts",
    flowUi: "src/PackageBookingFlowV3.tsx",
    registerUi: null,
    createFn: "createPackageCommercialBooking",
  },
  TICKET: {
    flowDb: "src/TicketFlowDb.ts",
    adjustmentDb: "src/TicketAdjustmentDb.ts",
    flowUi: "src/TicketBookingFlowV3.tsx",
    registerUi: "src/TicketRegister.tsx",
    createFn: "createTicketCommercialBooking",
  },
  HOTEL: {
    flowDb: "src/HotelFlowDb.ts",
    adjustmentDb: "src/HotelAdjustmentDb.ts",
    flowUi: "src/HotelBookingFlowV3.tsx",
    registerUi: "src/HotelRegister.tsx",
    createFn: "createHotelBooking",
  },
  VISA: {
    flowDb: "src/VisaFlowDb.ts",
    adjustmentDb: "src/VisaAdjustmentDb.ts",
    flowUi: "src/VisaBookingFlowV3.tsx",
    registerUi: "src/VisaRegister.tsx",
    createFn: "createVisaBooking",
  },
  TRANSPORT: {
    flowDb: "src/TransportFlowDb.ts",
    adjustmentDb: "src/TransportAdjustmentDb.ts",
    flowUi: "src/TransportBookingFlowV3.tsx",
    registerUi: "src/TransportRegister.tsx",
    createFn: "createTransportBooking",
  },
  MISC: {
    flowDb: "src/MiscFlowDb.ts",
    adjustmentDb: "src/MiscAdjustmentDb.ts",
    flowUi: "src/MiscBookingFlowV3.tsx",
    registerUi: "src/MiscRegister.tsx",
    createFn: "createMiscBooking",
  },
} as const;

function read(path: string) {
  return readFileSync(path, "utf8");
}

describe("six-segment booking readiness", () => {
  it("defines lifecycle config for all six segments", () => {
    expect(Object.keys(bookingLifecycleConfigs).sort()).toEqual([...SEGMENTS].sort());
  });

  it("wires all six services in Bookings hub", () => {
    const bookings = read("src/Bookings.tsx");
    for (const segment of SEGMENTS) {
      expect(bookings).toContain(`"${segment}"`);
    }
    expect(bookings).toContain("PackageBookingFlow");
    expect(bookings).toContain("TicketBookingModule");
    expect(bookings).toContain("HotelBookingModule");
    expect(bookings).toContain("VisaBookingModule");
    expect(bookings).toContain("TransportBookingModule");
    expect(bookings).toContain("MiscBookingModule");
  });

  for (const segment of SEGMENTS) {
    const mod = SEGMENT_MODULES[segment];
    it(`${segment}: has isolated FlowDb, AdjustmentDb, and booking UI`, () => {
      expect(existsSync(mod.flowDb)).toBe(true);
      expect(existsSync(mod.adjustmentDb)).toBe(true);
      expect(existsSync(mod.flowUi)).toBe(true);
      if (mod.registerUi) expect(existsSync(mod.registerUi)).toBe(true);

      const flowDb = read(mod.flowDb);
      expect(flowDb).toContain(`export async function ${mod.createFn}`);
      expect(flowDb).toMatch(/validateBookingCounterparty|validateCounterparty/);
    });
  }

  it("maps each segment to its own adjustment table", () => {
    expect(SEGMENT_ADJUSTMENT_TABLES.map((row) => row.serviceType).sort()).toEqual([...SEGMENTS].sort());
    expect(new Set(SEGMENT_ADJUSTMENT_TABLES.map((row) => row.tableName)).size).toBe(6);
  });

  it("includes all six booking headers in cloud sync ROOT_TABLES", () => {
    const dbSource = read("src/db.ts");
    const rootMatch = dbSource.match(/const ROOT_TABLES = \[([\s\S]*?)\];/);
    expect(rootMatch).toBeTruthy();
    const roots = rootMatch![1];
    for (const table of [
      "package_bookings",
      "ticket_bookings",
      "hotel_bookings",
      "visa_bookings",
      "transport_bookings",
      "misc_bookings",
    ]) {
      expect(roots).toContain(table);
    }
  });

  it("uses ProgressiveBookingIdentity unified Phase 2 flow across all six segments", () => {
    for (const segment of SEGMENTS) {
      const ui = read(SEGMENT_MODULES[segment].flowUi);
      expect(ui).toContain("ProgressiveBookingIdentity");
      expect(ui).toContain("validateBookingUb");
    }
  });
});

describe("counterparties readiness", () => {
  it("stores new account fields in CounterpartyDb", () => {
    const source = read("src/CounterpartyDb.ts");
    for (const column of ["contact_person", "email", "reference"]) {
      expect(source).toContain(column);
    }
    expect(source).toContain("normalizePartyInput");
  });

  it("uses shared AccountForm in PartiesScreen and AccountFormModal", () => {
    expect(read("src/screens/PartiesScreen.tsx")).toContain("AccountForm");
    expect(read("src/screens/PartiesScreen.tsx")).toContain("AccountFormModal");
    expect(read("src/AccountForm.tsx")).toContain("Phone / WhatsApp");
    expect(read("src/AccountForm.tsx")).toContain("Reference");
  });

  it("routes counterparties hub and ledger views", () => {
    const routes = read("src/layout/WorkspaceRoutes.tsx");
    expect(routes).toContain('path="/parties"');
    expect(routes).toContain("PartiesScreen");
    expect(routes).toContain('path="/parties/ledger/:id"');
    expect(read("src/screens/CounterpartiesScreen.tsx")).toContain("/parties/PARTY");
    expect(read("src/screens/CounterpartiesScreen.tsx")).toContain("/parties/VENDOR");
  });

  it("normalizes combined phone/whatsapp and reference for create/update", () => {
    const normalized = normalizePartyInput({
      ...blankPartyInput("VENDOR"),
      name: " ABC Travel ",
      phone: "+92 300 1111111",
      whatsapp: "",
      reference: "  Desk ref ",
    });
    expect(normalized.name).toBe("ABC Travel");
    expect(normalized.phone).toBe("+92 300 1111111");
    expect(normalized.whatsapp).toBe("+92 300 1111111");
    expect(normalized.reference).toBe("Desk ref");
    expect(normalized.accountType).toBe("VENDOR");
  });

  it("maps stored party rows back into the unified form", () => {
    const input = partyToInput({
      id: "p1",
      company_id: "c1",
      name: "Father Umrah",
      contact_person: "Ikram",
      phone: "+92300",
      whatsapp: "+92300",
      email: "a@b.com",
      address: "Lahore",
      reference: "Ref-1",
      notes: "legacy note",
      status: "ACTIVE",
      account_type: "PARTY",
      created_at: "",
      updated_at: "",
    });
    expect(input.contactPerson).toBe("Ikram");
    expect(input.reference).toBe("Ref-1");
    expect(input.phone).toBe("+92300");
  });

  it("syncs parties, vendors, and unassigned accounts separately", () => {
    const dbSource = read("src/db.ts");
    expect(dbSource).toContain('"parties"');
    expect(dbSource).toContain('"vendors"');
    expect(dbSource).toContain('"unassigned_accounts"');
    expect(dbSource).toContain("reconcileCounterpartyTable");
  });
});
