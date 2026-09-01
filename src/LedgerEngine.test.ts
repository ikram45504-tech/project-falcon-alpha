import { describe, it, expect, vi, beforeEach } from "vitest";
import { buildLedgerRows, getChronologicalLedger } from "./LedgerEngine";
import type { Party } from "./db";
import type { LedgerTransaction } from "./LedgerEngine";

// Mock Tauri SQL plugin
const { mockSelect, mockExecute } = vi.hoisted(() => ({ mockSelect: vi.fn(), mockExecute: vi.fn() }));
vi.mock("@tauri-apps/plugin-sql", () => {
  return {
    default: {
      load: vi.fn().mockResolvedValue({
        select: mockSelect,
        execute: mockExecute,
      }),
    },
  };
});

vi.mock("./miscDb", () => ({
  initMiscDatabase: vi.fn().mockResolvedValue(undefined),
}));

const mockGetBookingAccountingEntries = vi.fn();
vi.mock("./BookingAccounting", () => ({
  getBookingAccountingEntries: (...args: unknown[]) => mockGetBookingAccountingEntries(...args),
}));

const mockSupabaseFrom = vi.fn();
vi.mock("./supabaseClient", () => ({
  supabase: {
    from: (...args: unknown[]) => mockSupabaseFrom(...args),
  },
}));

const mockIsDesktopApp = vi.fn();
vi.mock("./cloudSync", () => ({
  isDesktopApp: () => mockIsDesktopApp(),
}));

describe("LedgerEngine", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsDesktopApp.mockReturnValue(true);
    // Force desktop path so SQLite mocks are used (jsdom has no Tauri runtime).
    (window as any).__TAURI_INTERNALS__ = {};
  });

  it("calculates customer receivable balances correctly", async () => {
    // Customer starts at 0 balance.
    // 1. We provide SALE_BOOKING of 1000 PKR (Debit 1000, Balance +1000)
    // 2. Customer pays us PAYMENT of 500 PKR (Credit 500, Balance +500)

    const mockParty = {
      id: "party_1",
      company_id: "comp_1",
      name: "Customer One",
      account_type: "PARTY",
      created_at: "2024-01-01",
    } as Party;

    mockSelect.mockResolvedValueOnce([
      {
        id: "tx_1",
        transaction_date: "2024-01-01",
        created_at: "2024-01-01",
        kind: "SALE_BOOKING",
        service_type: "PACKAGE",
        ref_no: "UB-001",
        description: "Full Package Booking",
        total_pkr: 1000,
        status: "ACTIVE",
        payment_kind: null,
      },
      {
        id: "tx_2",
        transaction_date: "2024-01-02",
        created_at: "2024-01-02",
        kind: "PAYMENT",
        service_type: "BANK",
        ref_no: "REC-001",
        description: "Payment Received",
        total_pkr: 500,
        status: "ACTIVE",
        payment_kind: null,
      },
    ]);

    const ledger = await getChronologicalLedger("comp_1", mockParty);

    expect(ledger).toHaveLength(2);

    expect(ledger[0].debit).toBe(1000);
    expect(ledger[0].credit).toBe(0);
    expect(ledger[0].running_balance).toBe(1000);

    expect(ledger[1].debit).toBe(0);
    expect(ledger[1].credit).toBe(500);
    expect(ledger[1].running_balance).toBe(500);
  });

  it("calculates vendor payable balances correctly", async () => {
    // Vendor starts at 0 balance.
    // 1. Vendor provides PURCHASE_BOOKING of 2000 PKR (Credit 2000, Balance +2000)
    // 2. We pay vendor PAYMENT of 1500 PKR (Debit 1500, Balance +500)

    const mockVendor = {
      id: "vendor_1",
      company_id: "comp_1",
      name: "Vendor One",
      account_type: "VENDOR",
      created_at: "2024-01-01",
    } as Party;

    mockSelect.mockResolvedValueOnce([
      {
        id: "tx_1",
        transaction_date: "2024-01-01",
        created_at: "2024-01-01",
        kind: "PURCHASE_BOOKING",
        service_type: "HOTEL",
        ref_no: "UB-002",
        description: "HOTEL Booking",
        total_pkr: 2000,
        status: "ACTIVE",
        payment_kind: null,
      },
      {
        id: "tx_2",
        transaction_date: "2024-01-02",
        created_at: "2024-01-02",
        kind: "PAYMENT",
        service_type: "BANK",
        ref_no: "PAY-001",
        description: "Payment Sent",
        total_pkr: 1500,
        status: "ACTIVE",
        payment_kind: null,
      },
    ]);

    const ledger = await getChronologicalLedger("comp_1", mockVendor);

    expect(ledger).toHaveLength(2);

    expect(ledger[0].debit).toBe(0);
    expect(ledger[0].credit).toBe(2000);
    expect(ledger[0].running_balance).toBe(2000); // We owe 2000

    expect(ledger[1].debit).toBe(1500); // We paid 1500
    expect(ledger[1].credit).toBe(0);
    expect(ledger[1].running_balance).toBe(500); // We owe 500
  });

  it("includes all six booking segments on web ledger", async () => {
    mockIsDesktopApp.mockReturnValue(false);
    delete (window as any).__TAURI_INTERNALS__;

    mockGetBookingAccountingEntries.mockResolvedValue([
      {
        id: "pkg_1",
        company_id: "comp_1",
        service_type: "PACKAGE",
        transaction_type: "SALE",
        counterparty_id: "party_1",
        counterparty_name: "Customer One",
        transaction_date: "2026-09-01",
        ub_number: "UB-0001",
        total_sar: 0,
        total_pkr: 1000,
        unconverted_sar: 0,
        status: "ACTIVE",
        created_at: "2026-09-01T10:00:00.000Z",
      },
      {
        id: "tkt_1",
        company_id: "comp_1",
        service_type: "TICKET",
        transaction_type: "SALE",
        counterparty_id: "party_1",
        counterparty_name: "Customer One",
        transaction_date: "2026-09-02",
        ub_number: "UB-0002",
        total_sar: 0,
        total_pkr: 2500,
        unconverted_sar: 0,
        status: "ACTIVE",
        created_at: "2026-09-02T10:00:00.000Z",
      },
    ]);

    const paymentSelect = vi.fn().mockResolvedValue({
      data: [
        {
          id: "pay_1",
          transaction_date: "2026-09-03",
          created_at: "2026-09-03T10:00:00.000Z",
          payment_type: "CASH",
          receipt_no: "RCPT-CSH-0001",
          description: "Cash receipt",
          paid_amount: 500,
          status: "ACTIVE",
        },
      ],
      error: null,
    });
    const metaSelect = vi.fn().mockResolvedValue({
      data: [{ payment_id: "pay_1", transaction_kind: "PARTY_RECEIPT" }],
      error: null,
    });
    mockSupabaseFrom.mockImplementation((table: string) => {
      if (table === "payment_entries") {
        return {
          select: () => ({
            eq: () => ({
              eq: paymentSelect,
            }),
          }),
        };
      }
      if (table === "payment_v2_meta") {
        return {
          select: () => ({
            in: metaSelect,
          }),
        };
      }
      return { select: vi.fn() };
    });

    const mockParty = {
      id: "party_1",
      company_id: "comp_1",
      name: "Customer One",
      account_type: "PARTY",
      created_at: "2024-01-01",
    } as Party;

    const ledger = await getChronologicalLedger("comp_1", mockParty);

    expect(mockGetBookingAccountingEntries).toHaveBeenCalledWith("comp_1", "party_1");
    expect(ledger).toHaveLength(3);
    expect(ledger.map((row) => row.service_type)).toEqual(["PACKAGE", "TICKET", "CASH"]);
    expect(ledger[2].running_balance).toBe(3000);
  });

  it("handles customer refunds in running balance", () => {
    const party = { account_type: "PARTY" } as Party;
    const rows = buildLedgerRows(
      [
        {
          id: "sale_1",
          transaction_date: "2026-09-01",
          created_at: "2026-09-01",
          kind: "SALE_BOOKING",
          service_type: "PACKAGE",
          ref_no: "UB-0001",
          description: "Package Booking",
          total_pkr: 1000,
          status: "ACTIVE",
        },
        {
          id: "refund_1",
          transaction_date: "2026-09-02",
          created_at: "2026-09-02",
          kind: "PAYMENT",
          service_type: "CASH",
          ref_no: "RF-CUST-CSH-0001",
          description: "Refund",
          total_pkr: 200,
          status: "ACTIVE",
          payment_kind: "PARTY_REFUND",
        },
      ] as LedgerTransaction[],
      party,
    );

    expect(rows[0].running_balance).toBe(1000);
    expect(rows[1].running_balance).toBe(1200);
  });
});
