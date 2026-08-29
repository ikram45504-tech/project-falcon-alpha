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
      const deduped = [...rows]
        .reverse()
        .filter((row, index, list) => {
          const id = String((row as { id?: string }).id || "");
          return id ? list.findIndex((item) => String((item as { id?: string }).id || "") === id) === index : true;
        })
        .reverse();
      const { error: insertError } = await supabase.from(tableName).upsert(deduped, { onConflict: "id" });
      if (insertError) throw new Error(insertError.message);
    }
    return;
  }

  if (operation === "DELETE") {
    const idColumn =
      tableName === "payment_v2_meta"
        ? "payment_id"
        : tableName === "package_operational_meta" ||
            tableName === "ticket_operational_meta" ||
            tableName === "hotel_operational_meta"
          ? "booking_id"
          : "id";
    const { error } = await supabase.from(tableName).delete().eq(idColumn, recordId);
    if (error) throw new Error(error.message);
    return;
  }

  if (operation === "UPDATE") {
    const idColumn =
      tableName === "payment_v2_meta"
        ? "payment_id"
        : tableName === "package_operational_meta" ||
            tableName === "ticket_operational_meta" ||
            tableName === "hotel_operational_meta"
          ? "booking_id"
          : "id";
    const { error } = await supabase.from(tableName).update(payload).eq(idColumn, recordId);
    if (error) throw new Error(error.message);
    return;
  }

  // INSERT and UPSERT both use upsert so desktop retries / web double-writes stay safe.
  const onConflict =
    tableName === "payment_v2_meta"
      ? "payment_id"
      : tableName === "package_operational_meta" ||
          tableName === "ticket_operational_meta" ||
          tableName === "hotel_operational_meta"
        ? "booking_id"
        : "id";
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
export async function syncPackageBookingBundle(header: PackageBookingSyncHeader, lines: PackageBookingSyncLine[]) {
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

export async function syncTicketBookingVoid(bookingId: string, updatedAt: string, updatedByUserId: string) {
  await queueSync("UPDATE", "ticket_bookings", bookingId, {
    status: "VOID",
    updated_at: updatedAt,
    updated_by_user_id: updatedByUserId,
  });
}

export async function syncTicketOperationalBundle(
  bookingId: string,
  companyId: string,
  payload: {
    notes: string;
    createdAt: string;
    updatedAt: string;
    passengers: Record<string, unknown>[];
    flights: Record<string, unknown>[];
  },
) {
  await queueSync("UPSERT", "ticket_operational_meta", bookingId, {
    booking_id: bookingId,
    company_id: companyId,
    notes: payload.notes,
    created_at: payload.createdAt,
    updated_at: payload.updatedAt,
  });
  await queueSync("REPLACE_CHILDREN", "ticket_operational_passengers", bookingId, {
    parent_column: "booking_id",
    rows: payload.passengers,
  });
  await queueSync("REPLACE_CHILDREN", "ticket_operational_flights", bookingId, {
    parent_column: "booking_id",
    rows: payload.flights,
  });
}

export type HotelBookingSyncHeader = {
  id: string;
  company_id: string;
  transaction_type: string;
  counterparty_id: string;
  transaction_date: string;
  ub_number: string;
  confirmation_voucher: string;
  meal_plan: string;
  guest_family_name: string;
  guest_count: number;
  customer_contact: string;
  special_requests: string;
  notes: string;
  total_sar: number;
  total_pkr: number;
  unconverted_sar: number;
  status: string;
  created_at: string;
  updated_at: string;
  created_by_user_id: string;
  updated_by_user_id: string;
};

export type HotelBookingSyncLine = {
  id: string;
  booking_id: string;
  city: string;
  hotel_name: string;
  check_in: string;
  check_out: string;
  nights: number;
  room_type: string;
  rate_per_night_sar: number;
  quantity: number;
  roe: number;
  line_total_sar: number;
  line_total_pkr: number;
  sort_order: number;
};

/** Upsert hotel header + replace all commercial stay lines in the cloud. */
export async function syncHotelBookingBundle(header: HotelBookingSyncHeader, lines: HotelBookingSyncLine[]) {
  await queueSync("UPSERT", "hotel_bookings", header.id, header as unknown as Record<string, unknown>);
  await queueSync("REPLACE_CHILDREN", "hotel_booking_lines", header.id, {
    parent_column: "booking_id",
    rows: lines,
  });
}

export async function syncHotelBookingVoid(bookingId: string, updatedAt: string, updatedByUserId: string) {
  await queueSync("UPDATE", "hotel_bookings", bookingId, {
    status: "VOID",
    updated_at: updatedAt,
    updated_by_user_id: updatedByUserId,
  });
}

export async function syncHotelGuestRefs(
  bookingId: string,
  _companyId: string,
  rows: Array<{ company_id: string; booking_id: string; sort_order: number; guest_name: string }>,
) {
  await queueSync("REPLACE_CHILDREN", "hotel_commercial_guest_refs", bookingId, {
    parent_column: "booking_id",
    rows,
  });
}

export async function syncHotelOperationalBundle(
  bookingId: string,
  companyId: string,
  payload: {
    customerContact: string;
    specialRequests: string;
    checkinInstructions: string;
    notes: string;
    createdAt: string;
    updatedAt: string;
    guestRefs: Record<string, unknown>[];
    reservations: Record<string, unknown>[];
    guests: Record<string, unknown>[];
  },
) {
  await queueSync("UPSERT", "hotel_operational_meta", bookingId, {
    booking_id: bookingId,
    company_id: companyId,
    customer_contact: payload.customerContact,
    special_requests: payload.specialRequests,
    checkin_instructions: payload.checkinInstructions,
    notes: payload.notes,
    created_at: payload.createdAt,
    updated_at: payload.updatedAt,
  });
  await queueSync("REPLACE_CHILDREN", "hotel_commercial_guest_refs", bookingId, {
    parent_column: "booking_id",
    rows: payload.guestRefs,
  });
  await queueSync("REPLACE_CHILDREN", "hotel_operational_reservations", bookingId, {
    parent_column: "booking_id",
    rows: payload.reservations,
  });
  await queueSync("REPLACE_CHILDREN", "hotel_operational_guests", bookingId, {
    parent_column: "booking_id",
    rows: payload.guests,
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

/** Clear all known child rows for a booking in the cloud (used by permanent delete). */
export async function syncClearBookingChildren(bookingId: string, childTables: string[]) {
  for (const table of childTables) {
    if (
      table === "package_operational_meta" ||
      table === "ticket_operational_meta" ||
      table === "hotel_operational_meta"
    ) {
      await queueSync("DELETE", table, bookingId, {});
      continue;
    }
    await queueSync("REPLACE_CHILDREN", table, bookingId, {
      parent_column: "booking_id",
      rows: [],
    });
  }
}

export async function syncPackageOperationalBundle(
  bookingId: string,
  companyId: string,
  payload: {
    notes: string;
    createdAt: string;
    updatedAt: string;
    passengers: Record<string, unknown>[];
    hotels: Record<string, unknown>[];
    flights: Record<string, unknown>[];
    stopovers: Record<string, unknown>[];
    movementEvents: Record<string, unknown>[];
  },
) {
  await queueSync("UPSERT", "package_operational_meta", bookingId, {
    booking_id: bookingId,
    company_id: companyId,
    notes: payload.notes,
    created_at: payload.createdAt,
    updated_at: payload.updatedAt,
  });
  await queueSync("REPLACE_CHILDREN", "package_operational_passengers", bookingId, {
    parent_column: "booking_id",
    rows: payload.passengers,
  });
  await queueSync("REPLACE_CHILDREN", "package_operational_hotels", bookingId, {
    parent_column: "booking_id",
    rows: payload.hotels,
  });
  await queueSync("REPLACE_CHILDREN", "package_operational_flights", bookingId, {
    parent_column: "booking_id",
    rows: payload.flights,
  });
  await queueSync("REPLACE_CHILDREN", "package_operational_flight_stopovers", bookingId, {
    parent_column: "booking_id",
    rows: payload.stopovers,
  });
  await queueSync("REPLACE_CHILDREN", "package_movement_events", bookingId, {
    parent_column: "booking_id",
    rows: payload.movementEvents,
  });
}

export async function syncPackageAdjustmentBundle(input: {
  bookingId: string;
  companyId: string;
  totalPkr: number;
  updatedAt: string;
  updatedByUserId: string;
  lines: PackageBookingSyncLine[];
  adjustment: Record<string, unknown>;
}) {
  await queueSync("UPDATE", "package_bookings", input.bookingId, {
    total_pkr: input.totalPkr,
    updated_at: input.updatedAt,
    updated_by_user_id: input.updatedByUserId,
  });
  await queueSync("REPLACE_CHILDREN", "package_booking_lines", input.bookingId, {
    parent_column: "booking_id",
    rows: input.lines,
  });
  await queueSync("UPSERT", "package_booking_adjustments", String(input.adjustment.id), input.adjustment);
}

export async function syncHotelAdjustmentBundle(input: {
  bookingId: string;
  companyId: string;
  totalSar: number;
  totalPkr: number;
  unconvertedSar: number;
  updatedAt: string;
  updatedByUserId: string;
  lines: HotelBookingSyncLine[];
  adjustment: Record<string, unknown>;
}) {
  await queueSync("UPDATE", "hotel_bookings", input.bookingId, {
    total_sar: input.totalSar,
    total_pkr: input.totalPkr,
    unconverted_sar: input.unconvertedSar,
    updated_at: input.updatedAt,
    updated_by_user_id: input.updatedByUserId,
  });
  await queueSync("REPLACE_CHILDREN", "hotel_booking_lines", input.bookingId, {
    parent_column: "booking_id",
    rows: input.lines,
  });
  await queueSync("UPSERT", "hotel_booking_adjustments", String(input.adjustment.id), input.adjustment);
}

/**
 * Desktop: immediately push PENDING/FAILED sync_queue jobs to Supabase.
 * Used after package adjustments so web sees the change without waiting for the 5s timer.
 */
export async function flushDesktopSyncQueue() {
  if (!isDesktopApp() || !navigator.onLine) return;

  const database = await Database.load(DB_PATH);
  await database.execute(`UPDATE sync_queue SET status = 'PENDING' WHERE status = 'FAILED'`);
  const pending = await database.select<
    Array<{
      id: string;
      operation: SyncOperation;
      table_name: string;
      record_id: string;
      payload: string;
    }>
  >(
    "SELECT id, operation, table_name, record_id, payload FROM sync_queue WHERE status = 'PENDING' ORDER BY created_at ASC",
  );

  for (const job of pending) {
    try {
      const payload = JSON.parse(job.payload) as Record<string, unknown>;
      await applyCloudOperation(job.operation, job.table_name, job.record_id, payload);
      await database.execute("DELETE FROM sync_queue WHERE id = $1", [job.id]);
    } catch (jobError: unknown) {
      const message = jobError instanceof Error ? jobError.message : String(jobError);
      console.error("Sync job failed:", jobError);
      await database.execute("UPDATE sync_queue SET status = 'FAILED', error_message = $1 WHERE id = $2", [
        message,
        job.id,
      ]);
      const syncError = new Error(`Cloud sync failed: ${message}`);
      throw syncError;
    }
  }
}
