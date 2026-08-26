import Database from "@tauri-apps/plugin-sql";
import { supabase } from "./supabaseClient";

const DB_PATH = "sqlite:travel-accounting.db";

export type SyncOperation = "INSERT" | "UPDATE" | "DELETE" | "UPSERT" | "REPLACE_CHILDREN";

export type PackageBookingSyncHeader = {
  id: string;
  company_id: string;
  transaction_type: string;
  counterparty_id: string;
  transaction_date: string;
  ub_number: string;
  package_description?: string;
  departure_date?: string;
  return_date?: string;
  no_of_days?: number;
  ziarat_included?: string;
  customer_contact?: string;
  notes?: string;
  total_pkr: number;
  status: string;
  created_at: string;
  updated_at: string;
  created_by_user_id?: string;
  updated_by_user_id?: string;
};

export type PackageBookingSyncLine = {
  id: string;
  booking_id: string;
  passenger_type: string;
  passenger_name: string;
  package_type: string;
  rate_per_person: number;
  person_count: number;
  qty_is_explicit: number;
  line_total_pkr: number;
  sort_order: number;
};

export type PaymentEntrySync = {
  id: string;
  company_id: string;
  party_id: string;
  transaction_date: string;
  receipt_no: string;
  from_account: string;
  to_account: string;
  description: string;
  payment_type: string;
  currency: string;
  amount_entered: number;
  sar: number;
  roe: number;
  paid_amount: number;
  status: string;
  created_at: string;
  updated_at: string;
  created_by_user_id?: string;
  updated_by_user_id?: string;
};

export type PaymentMetaSync = {
  payment_id: string;
  company_id: string;
  transaction_kind: string;
  settlement_account: string;
  reference: string;
  bank_name: string;
  bank_transaction_reference: string;
  account_title: string;
  account_last_digits: string;
  cheque_no: string;
  transfer_date: string;
  handled_by: string;
  location: string;
  internal_notes: string;
  created_by_user_id: string;
  updated_by_user_id: string;
  created_at: string;
  updated_at: string;
};

export function isDesktopApp() {
  return "__TAURI_INTERNALS__" in window;
}

/**
 * Applies one sync operation directly against Supabase.
 * Used by web mode immediately, and by the desktop sync worker.
 */
export async function applyCloudOperation(
  operation: SyncOperation,
  tableName: string,
  recordId: string,
  payload: Record<string, unknown>,
) {
  if (operation === "REPLACE_CHILDREN") {
    const parentColumn = String(payload.parent_column || "booking_id");
    const rows = (payload.rows as Record<string, unknown>[] | undefined) || [];
    const { error: deleteError } = await supabase.from(tableName).delete().eq(parentColumn, recordId);
    if (deleteError) throw new Error(deleteError.message);
    if (rows.length) {
      const { error: insertError } = await supabase.from(tableName).insert(rows);
      if (insertError) throw new Error(insertError.message);
    }
    return;
  }

  if (operation === "DELETE") {
    const idColumn = tableName === "payment_v2_meta" ? "payment_id" : "id";
    const { error } = await supabase.from(tableName).delete().eq(idColumn, recordId);
    if (error) throw new Error(error.message);
    return;
  }

  if (operation === "UPDATE") {
    const idColumn = tableName === "payment_v2_meta" ? "payment_id" : "id";
    const { error } = await supabase.from(tableName).update(payload).eq(idColumn, recordId);
    if (error) throw new Error(error.message);
    return;
  }

  // INSERT and UPSERT both use upsert so desktop retries / web double-writes stay safe.
  const onConflict = tableName === "payment_v2_meta" ? "payment_id" : "id";
  const { error } = await supabase.from(tableName).upsert(payload, { onConflict });
  if (error && (error as { code?: string }).code !== "23505") {
    throw new Error(error.message);
  }
}

/**
 * Desktop: enqueue for background push. Web: push to Supabase immediately.
 */
export async function queueSync(
  operation: SyncOperation,
  tableName: string,
  recordId: string,
  payload: Record<string, unknown>,
) {
  if (!isDesktopApp()) {
    await applyCloudOperation(operation, tableName, recordId, payload);
    return;
  }

  const database = await Database.load(DB_PATH);
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  await database.execute(
    `INSERT INTO sync_queue (id, operation, table_name, record_id, payload, created_at, status, error_message)
     VALUES ($1, $2, $3, $4, $5, $6, 'PENDING', '')`,
    [id, operation, tableName, recordId, JSON.stringify(payload), now],
  );
}

/** Upsert package header + replace all commercial lines in the cloud. */
export async function syncPackageBookingBundle(
  header: PackageBookingSyncHeader,
  lines: PackageBookingSyncLine[],
) {
  await queueSync("UPSERT", "package_bookings", header.id, header as unknown as Record<string, unknown>);
  await queueSync("REPLACE_CHILDREN", "package_booking_lines", header.id, {
    parent_column: "booking_id",
    rows: lines,
  });
}

/** Upsert payment entry + v2 meta in the cloud. */
export async function syncPaymentBundle(entry: PaymentEntrySync, meta: PaymentMetaSync) {
  await queueSync("UPSERT", "payment_entries", entry.id, entry as unknown as Record<string, unknown>);
  await queueSync("UPSERT", "payment_v2_meta", meta.payment_id, meta as unknown as Record<string, unknown>);
}

export type TicketBookingSyncHeader = {
  id: string;
  company_id: string;
  transaction_type: string;
  counterparty_id: string;
  transaction_date: string;
  ub_number: string;
  airline_name?: string;
  pnr?: string;
  sector?: string;
  departure_date?: string;
  return_date?: string;
  flight_no?: string;
  departure_time?: string;
  arrival_time?: string;
  baggage?: string;
  ticket_status?: string;
  customer_contact?: string;
  notes?: string;
  total_pkr: number;
  status: string;
  created_at: string;
  updated_at: string;
  created_by_user_id?: string;
  updated_by_user_id?: string;
};

export type TicketBookingSyncLine = {
  id: string;
  booking_id: string;
  passenger_type: string;
  passenger_name: string;
  airline_name: string;
  pnr: string;
  flight_type: string;
  ticket_route: string;
  eticket_reference: string;
  rate_per_ticket: number;
  ticket_count: number;
  qty_is_explicit: number;
  line_total_pkr: number;
  sort_order: number;
};

/** Upsert ticket header + replace all commercial lines in the cloud. */
export async function syncTicketBookingBundle(header: TicketBookingSyncHeader, lines: TicketBookingSyncLine[]) {
  await queueSync("UPSERT", "ticket_bookings", header.id, header as unknown as Record<string, unknown>);
  await queueSync("REPLACE_CHILDREN", "ticket_booking_lines", header.id, {
    parent_column: "booking_id",
    rows: lines,
  });
}

export async function syncPackageBookingVoid(bookingId: string, updatedAt: string, updatedByUserId: string) {
  await queueSync("UPDATE", "package_bookings", bookingId, {
    status: "VOID",
    updated_at: updatedAt,
    updated_by_user_id: updatedByUserId,
  });
}

export async function syncPaymentVoid(paymentId: string, updatedAt: string, updatedByUserId: string) {
  await queueSync("UPDATE", "payment_entries", paymentId, {
    status: "VOID",
    updated_at: updatedAt,
    updated_by_user_id: updatedByUserId,
  });
}
