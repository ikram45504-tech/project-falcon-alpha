import Database from "@tauri-apps/plugin-sql";
import { hasPermission, type UserRole } from "./permissions";
import { flushDesktopSyncQueue, isDesktopApp, queueSync, syncMiscOperationalBundle } from "./cloudSync";
import { supabase } from "./supabaseClient";

const DB_PATH = "sqlite:travel-accounting.db";
let databasePromise: Promise<Database> | null = null;
let schemaPromise: Promise<void> | null = null;

export type MiscOperationalRow = {
  id: string;
  serviceSortOrder: number;
  serviceDate: string;
  referenceVoucher: string;
  contact: string;
  instructions: string;
  sortOrder: number;
};

export type MiscOperationalDetails = {
  familyHeads: string[];
  services: MiscOperationalRow[];
  notes: string;
};

export type SaveMiscOperationalInput = {
  services: Array<Omit<MiscOperationalRow, "id" | "sortOrder">>;
  notes: string;
};

async function db() {
  if (!databasePromise) {
    if (isDesktopApp()) {
      databasePromise = Database.load(DB_PATH);
    } else {
      databasePromise = Promise.resolve({
        execute: async () => ({ lastInsertId: 0, rowsAffected: 0 }),
        select: async () => [],
      } as unknown as Database);
    }
  }
  return databasePromise;
}

async function ensureSchema() {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      const database = await db();
      await database.execute("PRAGMA busy_timeout = 5000");
      await database.execute(`CREATE TABLE IF NOT EXISTS misc_commercial_family_refs (
        company_id TEXT NOT NULL,
        booking_id TEXT NOT NULL,
        sort_order INTEGER NOT NULL DEFAULT 0,
        family_head TEXT NOT NULL DEFAULT '',
        PRIMARY KEY (company_id, booking_id, sort_order)
      )`);
      await database.execute(`CREATE TABLE IF NOT EXISTS misc_operational_services (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        booking_id TEXT NOT NULL,
        service_sort_order INTEGER NOT NULL DEFAULT 0,
        service_date TEXT NOT NULL DEFAULT '',
        reference_voucher TEXT NOT NULL DEFAULT '',
        contact TEXT NOT NULL DEFAULT '',
        instructions TEXT NOT NULL DEFAULT '',
        sort_order INTEGER NOT NULL DEFAULT 0
      )`);
      await database.execute(`CREATE TABLE IF NOT EXISTS misc_operational_meta (
        booking_id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        notes TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`);
      await database.execute(
        `CREATE INDEX IF NOT EXISTS idx_misc_operational_services ON misc_operational_services(company_id,booking_id,sort_order)`,
      );
    })().catch((error) => {
      schemaPromise = null;
      throw error;
    });
  }
  return schemaPromise;
}

async function requireWrite(companyId: string, userId: string) {
  if (!userId) return;
  const database = await db();
  const rows = await database.select<Array<{ role: UserRole; status: string }>>(
    `SELECT role,status FROM users WHERE id=$1 AND company_id=$2 LIMIT 1`,
    [userId, companyId],
  );
  const actor = rows[0];
  if (
    !actor ||
    actor.status !== "ACTIVE" ||
    (!hasPermission(actor.role, "edit_bookings") && !hasPermission(actor.role, "create_bookings"))
  )
    throw new Error("You do not have permission to save Misc booking details.");
}

async function audit(companyId: string, userId: string, bookingId: string, details: string) {
  if (!userId) return;
  const database = await db();
  const users = await database.select<Array<{ full_name: string }>>(
    `SELECT full_name FROM users WHERE id=$1 AND company_id=$2 LIMIT 1`,
    [userId, companyId],
  );
  await database.execute(
    `INSERT INTO audit_logs (id,company_id,user_id,user_name,action,module,record_id,details,created_at)
     VALUES ($1,$2,$3,$4,'BOOKING_DETAILS_UPDATED','MISC',$5,$6,$7)`,
    [
      crypto.randomUUID(),
      companyId,
      userId,
      users[0]?.full_name || "Unknown User",
      bookingId,
      details,
      new Date().toISOString(),
    ],
  );
}

export async function saveMiscFamilyHeads(companyId: string, bookingId: string, familyHeads: string[], userId = "") {
  await requireWrite(companyId, userId);
  await ensureSchema();
  const now = new Date().toISOString();
  const familyRefs = familyHeads.map((familyHead, index) => ({
    company_id: companyId,
    booking_id: bookingId,
    sort_order: index,
    family_head: familyHead.trim(),
  }));

  if (isDesktopApp()) {
    const database = await db();
    await database.execute(`DELETE FROM misc_commercial_family_refs WHERE company_id=$1 AND booking_id=$2`, [
      companyId,
      bookingId,
    ]);
    for (const ref of familyRefs) {
      await database.execute(
        `INSERT INTO misc_commercial_family_refs (company_id,booking_id,sort_order,family_head) VALUES ($1,$2,$3,$4)`,
        [ref.company_id, ref.booking_id, ref.sort_order, ref.family_head],
      );
    }
  }

  let createdAt = now;
  if (isDesktopApp()) {
    const database = await db();
    const metaRows = await database.select<Array<{ created_at: string }>>(
      `SELECT created_at FROM misc_operational_meta WHERE booking_id=$1 LIMIT 1`,
      [bookingId],
    );
    if (metaRows[0]?.created_at) createdAt = metaRows[0].created_at;
  } else {
    const { data } = await supabase
      .from("misc_operational_meta")
      .select("created_at,notes")
      .eq("booking_id", bookingId)
      .maybeSingle();
    if (data?.created_at) createdAt = data.created_at;
  }

  const details = await getMiscOperationalDetails(companyId, bookingId);
  const services = details.services.map((service, index) => ({
    id: service.id,
    company_id: companyId,
    booking_id: bookingId,
    service_sort_order: service.serviceSortOrder,
    service_date: service.serviceDate,
    reference_voucher: service.referenceVoucher,
    contact: service.contact,
    instructions: service.instructions,
    sort_order: index,
  }));

  await syncMiscOperationalBundle(bookingId, companyId, {
    notes: details.notes,
    createdAt,
    updatedAt: now,
    familyRefs,
    services,
  });
  await queueSync("UPDATE", "misc_bookings", bookingId, { updated_at: now });
  if (isDesktopApp()) await flushDesktopSyncQueue();
}

export async function getMiscFamilyHeadsByBookingIds(
  companyId: string,
  bookingIds: string[],
): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  const ids = bookingIds.filter(Boolean);
  if (!ids.length) return map;

  await ensureSchema();

  if (!isDesktopApp()) {
    const { data, error } = await supabase
      .from("misc_commercial_family_refs")
      .select("booking_id,family_head,sort_order")
      .eq("company_id", companyId)
      .in("booking_id", ids)
      .order("sort_order", { ascending: true });
    if (error) throw new Error(error.message);

    for (const row of data || []) {
      const bookingId = String(row.booking_id);
      const current = map.get(bookingId) || [];
      current.push(String(row.family_head || ""));
      map.set(bookingId, current);
    }
    return map;
  }

  const database = await db();
  const placeholders = ids.map((_, index) => `$${index + 2}`).join(",");
  const rows = await database.select<Array<{ booking_id: string; family_head: string; sort_order: number }>>(
    `SELECT booking_id,family_head,sort_order FROM misc_commercial_family_refs
     WHERE company_id=$1 AND booking_id IN (${placeholders})
     ORDER BY booking_id,sort_order`,
    [companyId, ...ids],
  );
  for (const row of rows) {
    const bookingId = String(row.booking_id);
    const current = map.get(bookingId) || [];
    current.push(String(row.family_head || ""));
    map.set(bookingId, current);
  }
  return map;
}

export async function getMiscOperationalDetails(companyId: string, bookingId: string): Promise<MiscOperationalDetails> {
  await ensureSchema();

  if (!isDesktopApp()) {
    const [refsRes, servicesRes, metaRes] = await Promise.all([
      supabase
        .from("misc_commercial_family_refs")
        .select("family_head,sort_order")
        .eq("company_id", companyId)
        .eq("booking_id", bookingId)
        .order("sort_order", { ascending: true }),
      supabase
        .from("misc_operational_services")
        .select("id,service_sort_order,service_date,reference_voucher,contact,instructions,sort_order")
        .eq("company_id", companyId)
        .eq("booking_id", bookingId)
        .order("sort_order", { ascending: true }),
      supabase
        .from("misc_operational_meta")
        .select("notes")
        .eq("company_id", companyId)
        .eq("booking_id", bookingId)
        .maybeSingle(),
    ]);
    if (refsRes.error) throw new Error(refsRes.error.message);
    if (servicesRes.error) throw new Error(servicesRes.error.message);
    if (metaRes.error) throw new Error(metaRes.error.message);

    return {
      familyHeads: (refsRes.data || []).map((item) => item.family_head),
      services: (servicesRes.data || []).map((item) => ({
        id: item.id,
        serviceSortOrder: item.service_sort_order,
        serviceDate: item.service_date,
        referenceVoucher: item.reference_voucher,
        contact: item.contact,
        instructions: item.instructions,
        sortOrder: item.sort_order,
      })),
      notes: metaRes.data?.notes || "",
    };
  }

  const database = await db();
  const refs = await database.select<Array<{ family_head: string; sort_order: number }>>(
    `SELECT family_head,sort_order FROM misc_commercial_family_refs WHERE company_id=$1 AND booking_id=$2 ORDER BY sort_order`,
    [companyId, bookingId],
  );
  const services = await database.select<
    Array<{
      id: string;
      service_sort_order: number;
      service_date: string;
      reference_voucher: string;
      contact: string;
      instructions: string;
      sort_order: number;
    }>
  >(
    `SELECT id,service_sort_order,service_date,reference_voucher,contact,instructions,sort_order FROM misc_operational_services WHERE company_id=$1 AND booking_id=$2 ORDER BY sort_order`,
    [companyId, bookingId],
  );
  const meta = await database.select<Array<{ notes: string }>>(
    `SELECT notes FROM misc_operational_meta WHERE company_id=$1 AND booking_id=$2 LIMIT 1`,
    [companyId, bookingId],
  );
  return {
    familyHeads: refs.map((item) => item.family_head),
    services: services.map((item) => ({
      id: item.id,
      serviceSortOrder: item.service_sort_order,
      serviceDate: item.service_date,
      referenceVoucher: item.reference_voucher,
      contact: item.contact,
      instructions: item.instructions,
      sortOrder: item.sort_order,
    })),
    notes: meta[0]?.notes || "",
  };
}

export async function saveMiscOperationalDetails(
  companyId: string,
  bookingId: string,
  input: SaveMiscOperationalInput,
  userId = "",
) {
  await requireWrite(companyId, userId);
  const { enforceFeature } = await import("./companyAccess");
  await enforceFeature(companyId, "additional_booking_details", "Additional booking details");
  await ensureSchema();
  const now = new Date().toISOString();

  const services = input.services.map((service, index) => ({
    id: crypto.randomUUID(),
    company_id: companyId,
    booking_id: bookingId,
    service_sort_order: service.serviceSortOrder,
    service_date: service.serviceDate,
    reference_voucher: service.referenceVoucher.trim().toUpperCase(),
    contact: service.contact.trim(),
    instructions: service.instructions.trim(),
    sort_order: index,
  }));

  let createdAt = now;
  if (isDesktopApp()) {
    const database = await db();
    const metaRows = await database.select<Array<{ created_at: string }>>(
      `SELECT created_at FROM misc_operational_meta WHERE booking_id=$1 LIMIT 1`,
      [bookingId],
    );
    if (metaRows[0]?.created_at) createdAt = metaRows[0].created_at;

    await database.execute(`DELETE FROM misc_operational_services WHERE company_id=$1 AND booking_id=$2`, [
      companyId,
      bookingId,
    ]);
    for (const service of services) {
      await database.execute(
        `INSERT INTO misc_operational_services (id,company_id,booking_id,service_sort_order,service_date,reference_voucher,contact,instructions,sort_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          service.id,
          service.company_id,
          service.booking_id,
          service.service_sort_order,
          service.service_date,
          service.reference_voucher,
          service.contact,
          service.instructions,
          service.sort_order,
        ],
      );
    }
    await database.execute(
      `INSERT INTO misc_operational_meta (booking_id,company_id,notes,created_at,updated_at) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT(booking_id) DO UPDATE SET company_id=excluded.company_id,notes=excluded.notes,updated_at=excluded.updated_at`,
      [bookingId, companyId, input.notes.trim(), createdAt, now],
    );
    await audit(
      companyId,
      userId,
      bookingId,
      "Misc service dates, references, contacts and instructions updated without changing service totals.",
    );
  } else {
    const { data } = await supabase
      .from("misc_operational_meta")
      .select("created_at")
      .eq("booking_id", bookingId)
      .maybeSingle();
    if (data?.created_at) createdAt = data.created_at;
  }

  const details = await getMiscOperationalDetails(companyId, bookingId);
  const familyRefs = details.familyHeads.map((familyHead, index) => ({
    company_id: companyId,
    booking_id: bookingId,
    sort_order: index,
    family_head: familyHead,
  }));

  await syncMiscOperationalBundle(bookingId, companyId, {
    notes: input.notes.trim(),
    createdAt,
    updatedAt: now,
    familyRefs,
    services,
  });
  await queueSync("UPDATE", "misc_bookings", bookingId, { updated_at: now });
  if (isDesktopApp()) await flushDesktopSyncQueue();
}
