import { describe, it, expect, vi, beforeEach } from "vitest";
import { getChronologicalLedger } from "./LedgerEngine";
import type { Party } from "./db";

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

describe("LedgerEngine", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
});
