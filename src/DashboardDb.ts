import Database from "@tauri-apps/plugin-sql";

const DB_PATH = "sqlite:travel-accounting.db";
let databasePromise: Promise<Database> | null = null;

async function db() {
  if (!databasePromise) databasePromise = Database.load(DB_PATH);
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

export async function getDashboardMetrics(companyId: string): Promise<DashboardMetrics> {
  const database = await db();
  
  const currentMonthStr = new Date().toISOString().substring(0, 7); // YYYY-MM

  // Aggregate Sales and Purchases for current month
  const results = await database.select<{ sales: number, purchases: number, bookings: number }[]>(`
    SELECT 
      SUM(CASE WHEN transaction_type = 'SALE' THEN total_pkr ELSE 0 END) as sales,
      SUM(CASE WHEN transaction_type = 'PURCHASE' THEN total_pkr ELSE 0 END) as purchases,
      COUNT(id) as bookings
    FROM (${bookingUnion})
    WHERE company_id = $1 
      AND status = 'ACTIVE' 
      AND transaction_date LIKE $2
  `, [companyId, `${currentMonthStr}%`]);

  const sales = results[0]?.sales || 0;
  const purchases = results[0]?.purchases || 0;
  const bookings = results[0]?.bookings || 0;

  return {
    monthlySales: sales,
    monthlyPurchases: purchases,
    monthlyProfit: sales - purchases,
    activeBookingsCount: bookings
  };
}

export async function getRecentActivity(companyId: string, limit: number = 5): Promise<RecentActivity[]> {
  const database = await db();
  
  // Get latest 5 bookings
  const activities = await database.select<RecentActivity[]>(`
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
  `, [companyId, limit]);

  return activities;
}
