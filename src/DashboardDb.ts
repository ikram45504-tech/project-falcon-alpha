import Database from "@tauri-apps/plugin-sql";

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

export type DashboardMetrics = {
  monthlySales: number;
  monthlyPurchases: number;
  monthlyProfit: number;
  activeBookingsCount: number;
};

export type RecentActivity = {
  id: string;
  date: string;
  type: string;
  description: string;
  amount: number;
  status: string;
};

const bookingUnion = `
  SELECT id, company_id, 'PACKAGE' AS service_type, transaction_type, counterparty_id, transaction_date, ub_number AS ref_no, total_pkr, status, created_at FROM package_bookings
  UNION ALL
  SELECT id, company_id, 'TICKET' AS service_type, transaction_type, counterparty_id, transaction_date, ub_number AS ref_no, total_pkr, status, created_at FROM ticket_bookings
  UNION ALL
  SELECT id, company_id, 'HOTEL' AS service_type, transaction_type, counterparty_id, transaction_date, ub_number AS ref_no, total_pkr, status, created_at FROM hotel_bookings
  UNION ALL
  SELECT id, company_id, 'VISA' AS service_type, transaction_type, counterparty_id, transaction_date, ub_number AS ref_no, total_pkr, status, created_at FROM visa_bookings
  UNION ALL
  SELECT id, company_id, 'TRANSPORT' AS service_type, transaction_type, counterparty_id, transaction_date, ub_number AS ref_no, total_pkr, status, created_at FROM transport_bookings
  UNION ALL
  SELECT id, company_id, 'MISC' AS service_type, transaction_type, counterparty_id, transaction_date, ub_number AS ref_no, total_pkr, status, created_at FROM misc_bookings
`;

import { supabase } from "./supabaseClient";

export async function getDashboardMetrics(companyId: string): Promise<DashboardMetrics> {
  const isTauri = "__TAURI_INTERNALS__" in window;
  const currentMonthStr = new Date().toISOString().substring(0, 7); // YYYY-MM

  if (!isTauri) {
    const tables = [
      "package_bookings",
      "ticket_bookings",
      "hotel_bookings",
      "visa_bookings",
      "transport_bookings",
      "misc_bookings",
    ];
    let sales = 0;
    let purchases = 0;
    let bookings = 0;

    for (const t of tables) {
      const { data } = await supabase
        .from(t)
        .select("transaction_type, total_pkr")
        .eq("company_id", companyId)
        .eq("status", "ACTIVE")
        .like("transaction_date", `${currentMonthStr}%`);

      if (data) {
        bookings += data.length;
        for (const row of data) {
          if (row.transaction_type === "SALE") sales += row.total_pkr;
          if (row.transaction_type === "PURCHASE") purchases += row.total_pkr;
        }
      }
    }
    return {
      monthlySales: sales,
      monthlyPurchases: purchases,
      monthlyProfit: sales - purchases,
      activeBookingsCount: bookings,
    };
  }

  const database = await db();
  // Aggregate Sales and Purchases for current month
  const results = await database.select<{ sales: number; purchases: number; bookings: number }[]>(
    `
    SELECT 
      SUM(CASE WHEN transaction_type = 'SALE' THEN total_pkr ELSE 0 END) as sales,
      SUM(CASE WHEN transaction_type = 'PURCHASE' THEN total_pkr ELSE 0 END) as purchases,
      COUNT(id) as bookings
    FROM (${bookingUnion})
    WHERE company_id = $1 
      AND status = 'ACTIVE' 
      AND transaction_date LIKE $2
  `,
    [companyId, `${currentMonthStr}%`],
  );

  const sales = results[0]?.sales || 0;
  const purchases = results[0]?.purchases || 0;
  const bookings = results[0]?.bookings || 0;

  return {
    monthlySales: sales,
    monthlyPurchases: purchases,
    monthlyProfit: sales - purchases,
    activeBookingsCount: bookings,
  };
}

export async function getRecentActivity(companyId: string, limit: number = 5): Promise<RecentActivity[]> {
  const isTauri = "__TAURI_INTERNALS__" in window;

  if (!isTauri) {
    const tables = [
      { name: "package_bookings", type: "PACKAGE" },
      { name: "ticket_bookings", type: "TICKET" },
      { name: "hotel_bookings", type: "HOTEL" },
      { name: "visa_bookings", type: "VISA" },
      { name: "transport_bookings", type: "TRANSPORT" },
      { name: "misc_bookings", type: "MISC" },
    ];
    const allActivities: RecentActivity[] = [];

    for (const t of tables) {
      const { data } = await supabase
        .from(t.name)
        .select("id, transaction_date, transaction_type, ub_number, total_pkr, status, created_at")
        .eq("company_id", companyId)
        .order("created_at", { ascending: false })
        .limit(limit);

      if (data) {
        for (const row of data) {
          allActivities.push({
            id: row.id,
            date: row.transaction_date,
            type: `${t.type} ${row.transaction_type}`,
            description: `UB: ${row.ub_number}`,
            amount: row.total_pkr,
            status: row.status,
            // @ts-expect-error - created_at exists on row but is not typed
            created_at: row.created_at,
          });
        }
      }
    }

    // Sort all combined by created_at desc, then limit
    // @ts-expect-error - sort mutates array and created_at exists
    allActivities.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    return allActivities.slice(0, limit);
  }

  const database = await db();

  // Get latest 5 bookings
  const activities = await database.select<RecentActivity[]>(
    `
    SELECT 
      id,
      transaction_date as date,
      service_type || ' ' || transaction_type as type,
      'UB: ' || ref_no as description,
      total_pkr as amount,
      status
    FROM (${bookingUnion})
    WHERE company_id = $1
    ORDER BY created_at DESC
    LIMIT $2
  `,
    [companyId, limit],
  );

  return activities;
}
