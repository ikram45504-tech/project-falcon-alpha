import Database from "@tauri-apps/plugin-sql";
import { initMiscDatabase } from "./miscDb";
import type { Party } from "./db";

const DB_PATH = "sqlite:travel-accounting.db";
let databasePromise: Promise<Database> | null = null;

async function db() {
  if (!databasePromise) {
    const isTauri = "__TAURI_INTERNALS__" in window;
    if (isTauri) {
      databasePromise = Database.load(DB_PATH);
    } else {
      console.warn("Running in Web Mode. Local database is not available for " + DB_PATH);
      databasePromise = Promise.resolve({
        execute: async () => ({ lastInsertId: 0, rowsAffected: 0 }),
        select: async () => [],
      } as any);
    }
  }
  return databasePromise;
}

export type LedgerTransaction = {
  id: string;
  transaction_date: string;
  created_at: string;
  kind: "SALE_BOOKING" | "PURCHASE_BOOKING" | "PAYMENT";
  service_type: string;
  ref_no: string;
  description: string;
  total_pkr: number;
  status: "ACTIVE" | "VOID";
  payment_kind?: string;
};

export type LedgerRow = LedgerTransaction & {
  debit: number;
  credit: number;
  running_balance: number;
};

const bookingUnion = `
  SELECT b.id,b.company_id,'PACKAGE' AS service_type,b.transaction_type,b.counterparty_id,
         b.transaction_date,b.ub_number AS ref_no,
         b.total_pkr,b.status,b.created_at
  FROM package_bookings b
  UNION ALL
  SELECT b.id,b.company_id,'TICKET' AS service_type,b.transaction_type,b.counterparty_id,
         b.transaction_date,b.ub_number AS ref_no,
         b.total_pkr,b.status,b.created_at
  FROM ticket_bookings b
  UNION ALL
  SELECT b.id,b.company_id,'HOTEL' AS service_type,b.transaction_type,b.counterparty_id,
         b.transaction_date,b.ub_number AS ref_no,
         b.total_pkr,b.status,b.created_at
  FROM hotel_bookings b
  UNION ALL
  SELECT b.id,b.company_id,'VISA' AS service_type,b.transaction_type,b.counterparty_id,
         b.transaction_date,b.ub_number AS ref_no,
         b.total_pkr,b.status,b.created_at
  FROM visa_bookings b
  UNION ALL
  SELECT b.id,b.company_id,'TRANSPORT' AS service_type,b.transaction_type,b.counterparty_id,
         b.transaction_date,b.ub_number AS ref_no,
         b.total_pkr,b.status,b.created_at
  FROM transport_bookings b
  UNION ALL
  SELECT b.id,b.company_id,'MISC' AS service_type,b.transaction_type,b.counterparty_id,
         b.transaction_date,b.ub_number AS ref_no,
         b.total_pkr,b.status,b.created_at
  FROM misc_bookings b
`;

export async function getChronologicalLedger(companyId: string, party: Party): Promise<LedgerRow[]> {
  await initMiscDatabase();
  const database = await db();

  const transactions = await database.select<LedgerTransaction[]>(
    `SELECT * FROM (
      SELECT 
        id,
        transaction_date,
        created_at,
        CASE 
          WHEN transaction_type = 'SALE' THEN 'SALE_BOOKING'
          ELSE 'PURCHASE_BOOKING'
        END AS kind,
        service_type,
        ref_no,
        service_type || ' Booking' AS description,
        total_pkr,
        status,
        NULL AS payment_kind
      FROM (${bookingUnion}) b
      WHERE b.company_id = $1 AND b.counterparty_id = $2
      
      UNION ALL
      
      SELECT 
        id,
        transaction_date,
        created_at,
        'PAYMENT' AS kind,
        payment_type AS service_type,
        receipt_no AS ref_no,
        description,
        paid_amount AS total_pkr,
        status,
        (SELECT transaction_kind FROM payment_v2_meta WHERE payment_id = p.id LIMIT 1) AS payment_kind
      FROM payment_entries p
      WHERE p.company_id = $1 AND p.party_id = $2
    ) q
    ORDER BY q.transaction_date ASC, q.created_at ASC`,
    [companyId, party.id],
  );

  const isVendor = party.account_type === "VENDOR";
  let running_balance = 0;

  return transactions.map((tx) => {
    let debit = 0;
    let credit = 0;
    let description = tx.description;

    if (tx.status === "ACTIVE") {
      if (isVendor) {
        // For VENDOR: Payable Balance
        if (tx.kind === "PURCHASE_BOOKING") {
          credit = tx.total_pkr; // Vendor provided service, they credit our account (we owe them)
          running_balance += credit;
        } else if (tx.kind === "PAYMENT") {
          if (tx.payment_kind === "VENDOR_REFUND") {
            credit = tx.total_pkr; // Vendor refunded us, increases what we owe them (reverses payment)
            running_balance += credit;
          } else {
            debit = tx.total_pkr; // We paid vendor, reduces what we owe
            running_balance -= debit;
          }
        } else if (tx.kind === "SALE_BOOKING") {
          debit = tx.total_pkr; // VENDOR buys from us -> reduces payable
          running_balance -= debit;
          description = `${tx.description} [Cross-type: SALE on VENDOR]`;
        }
      } else {
        // For PARTY (Customer): Receivable Balance
        if (tx.kind === "SALE_BOOKING") {
          debit = tx.total_pkr; // We provided service, we debit their account (they owe us)
          running_balance += debit;
        } else if (tx.kind === "PAYMENT") {
          if (tx.payment_kind === "PARTY_REFUND") {
            debit = tx.total_pkr; // We refunded customer, increases what they owe us (reverses receipt)
            running_balance += debit;
          } else {
            credit = tx.total_pkr; // They paid us, reduces what they owe
            running_balance -= credit;
          }
        } else if (tx.kind === "PURCHASE_BOOKING") {
          credit = tx.total_pkr; // WE buy from PARTY -> reduces receivable
          running_balance -= credit;
          description = `${tx.description} [Cross-type: PURCHASE on PARTY]`;
        }
      }
    }

    return {
      ...tx,
      description,
      debit,
      credit,
      running_balance,
    };
  });
}

export async function getGlobalUbSaleOwner(
  companyId: string,
  ubNumber: string,
): Promise<{ partyId: string; service: string } | null> {
  const database = await db();
  const owners = await database.select<{ party_id: string; service: string }[]>(
    `SELECT counterparty_id AS party_id, service_type AS service
     FROM (${bookingUnion}) b
     WHERE b.company_id = $1 
       AND b.ref_no = $2 
       AND b.transaction_type = 'SALE'
       AND b.status = 'ACTIVE'
     LIMIT 1`,
    [companyId, ubNumber],
  );
  return owners.length > 0 ? { partyId: owners[0].party_id, service: owners[0].service } : null;
}
