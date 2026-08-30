import Database from "@tauri-apps/plugin-sql";
import { hasPermission, type UserRole } from "./permissions";
import { flushDesktopSyncQueue, isDesktopApp, queueSync, syncTransportOperationalBundle } from "./cloudSync";
import { supabase } from "./supabaseClient";

const DB_PATH = "sqlite:travel-accounting.db";
let databasePromise: Promise<Database> | null = null;
let schemaPromise: Promise<void> | null = null;

export type TransportOperationalSector = {
  id: string;
  sectorSortOrder: number;
  pickupTime: string;
  pickupPoint: string;
  driverName: string;
  driverMobile: string;
  vehiclePlate: string;
  confirmationReference: string;
  sortOrder: number;
};

export type TransportOperationalDetails = {
  sectors: TransportOperationalSector[];
  passengerSaudiContact: string;
  groupFamilyHead: string;
  transportInstructions: string;
  notes: string;
};

export type SaveTransportOperationalInput = {
  sectors: Array<Omit<TransportOperationalSector, "id" | "sortOrder">>;
  passengerSaudiContact: string;
  groupFamilyHead: string;
  transportInstructions: string;
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
      await database.execute(`CREATE TABLE IF NOT EXISTS transport_operational_sectors (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        booking_id TEXT NOT NULL,
        sector_sort_order INTEGER NOT NULL DEFAULT 0,
        pickup_time TEXT NOT NULL DEFAULT '',
        pickup_point TEXT NOT NULL DEFAULT '',
        driver_name TEXT NOT NULL DEFAULT '',
        driver_mobile TEXT NOT NULL DEFAULT '',
        vehicle_plate TEXT NOT NULL DEFAULT '',
        confirmation_reference TEXT NOT NULL DEFAULT '',
        sort_order INTEGER NOT NULL DEFAULT 0
      )`);
      await database.execute(`CREATE TABLE IF NOT EXISTS transport_operational_meta (
        booking_id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        passenger_saudi_contact TEXT NOT NULL DEFAULT '',
        group_family_head TEXT NOT NULL DEFAULT '',
        transport_instructions TEXT NOT NULL DEFAULT '',
        notes TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`);
      await database.execute(
        `CREATE INDEX IF NOT EXISTS idx_transport_operational_sector ON transport_operational_sectors(company_id,booking_id,sort_order)`,
      );
    })().catch((error) => {
      schemaPromise = null;
      throw error;
    });
  }
  return schemaPromise;
}

async function requireEdit(companyId: string, userId: string) {
  if (!userId) return;
  const database = await db();
  const rows = await database.select<Array<{ role: UserRole; status: string }>>(
    `SELECT role,status FROM users WHERE id=$1 AND company_id=$2 LIMIT 1`,
    [userId, companyId],
  );
  const actor = rows[0];
  if (!actor || actor.status !== "ACTIVE" || !hasPermission(actor.role, "edit_bookings"))
    throw new Error("You do not have permission to edit Transport booking details.");
}

async function audit(companyId: string, userId: string, bookingId: string) {
  if (!userId) return;
  const database = await db();
  const users = await database.select<Array<{ full_name: string }>>(
    `SELECT full_name FROM users WHERE id=$1 AND company_id=$2 LIMIT 1`,
    [userId, companyId],
  );
  await database.execute(
    `INSERT INTO audit_logs (id,company_id,user_id,user_name,action,module,record_id,details,created_at)
     VALUES ($1,$2,$3,$4,'BOOKING_DETAILS_UPDATED','TRANSPORT',$5,$6,$7)`,
    [
      crypto.randomUUID(),
      companyId,
      userId,
      users[0]?.full_name || "Unknown User",
      bookingId,
      "Transport pickup, driver and vehicle operational details updated without changing Transport totals.",
      new Date().toISOString(),
    ],
  );
}

export async function getTransportOperationalDetails(
  companyId: string,
  bookingId: string,
): Promise<TransportOperationalDetails> {
  await ensureSchema();

  if (!isDesktopApp()) {
    const [sectorsRes, metaRes] = await Promise.all([
      supabase
        .from("transport_operational_sectors")
        .select(
          "id,sector_sort_order,pickup_time,pickup_point,driver_name,driver_mobile,vehicle_plate,confirmation_reference,sort_order",
        )
        .eq("company_id", companyId)
        .eq("booking_id", bookingId)
        .order("sort_order", { ascending: true }),
      supabase
        .from("transport_operational_meta")
        .select("passenger_saudi_contact,group_family_head,transport_instructions,notes")
        .eq("company_id", companyId)
        .eq("booking_id", bookingId)
        .maybeSingle(),
    ]);
    if (sectorsRes.error) throw new Error(sectorsRes.error.message);
    if (metaRes.error) throw new Error(metaRes.error.message);

    return {
      sectors: (sectorsRes.data || []).map((item) => ({
        id: item.id,
        sectorSortOrder: item.sector_sort_order,
        pickupTime: item.pickup_time,
        pickupPoint: item.pickup_point,
        driverName: item.driver_name,
        driverMobile: item.driver_mobile,
        vehiclePlate: item.vehicle_plate,
        confirmationReference: item.confirmation_reference,
        sortOrder: item.sort_order,
      })),
      passengerSaudiContact: metaRes.data?.passenger_saudi_contact || "",
      groupFamilyHead: metaRes.data?.group_family_head || "",
      transportInstructions: metaRes.data?.transport_instructions || "",
      notes: metaRes.data?.notes || "",
    };
  }

  const database = await db();
  const sectors = await database.select<
    Array<{
      id: string;
      sector_sort_order: number;
      pickup_time: string;
      pickup_point: string;
      driver_name: string;
      driver_mobile: string;
      vehicle_plate: string;
      confirmation_reference: string;
      sort_order: number;
    }>
  >(
    `SELECT id,sector_sort_order,pickup_time,pickup_point,driver_name,driver_mobile,vehicle_plate,confirmation_reference,sort_order FROM transport_operational_sectors WHERE company_id=$1 AND booking_id=$2 ORDER BY sort_order`,
    [companyId, bookingId],
  );
  const meta = await database.select<
    Array<{ passenger_saudi_contact: string; group_family_head: string; transport_instructions: string; notes: string }>
  >(
    `SELECT passenger_saudi_contact,group_family_head,transport_instructions,notes FROM transport_operational_meta WHERE company_id=$1 AND booking_id=$2 LIMIT 1`,
    [companyId, bookingId],
  );
  return {
    sectors: sectors.map((item) => ({
      id: item.id,
      sectorSortOrder: item.sector_sort_order,
      pickupTime: item.pickup_time,
      pickupPoint: item.pickup_point,
      driverName: item.driver_name,
      driverMobile: item.driver_mobile,
      vehiclePlate: item.vehicle_plate,
      confirmationReference: item.confirmation_reference,
      sortOrder: item.sort_order,
    })),
    passengerSaudiContact: meta[0]?.passenger_saudi_contact || "",
    groupFamilyHead: meta[0]?.group_family_head || "",
    transportInstructions: meta[0]?.transport_instructions || "",
    notes: meta[0]?.notes || "",
  };
}

export async function saveTransportOperationalDetails(
  companyId: string,
  bookingId: string,
  input: SaveTransportOperationalInput,
  userId = "",
) {
  await requireEdit(companyId, userId);
  await ensureSchema();
  const now = new Date().toISOString();

  const sectors = input.sectors.map((sector, index) => ({
    id: crypto.randomUUID(),
    company_id: companyId,
    booking_id: bookingId,
    sector_sort_order: sector.sectorSortOrder,
    pickup_time: sector.pickupTime,
    pickup_point: sector.pickupPoint.trim(),
    driver_name: sector.driverName.trim(),
    driver_mobile: sector.driverMobile.trim(),
    vehicle_plate: sector.vehiclePlate.trim().toUpperCase(),
    confirmation_reference: sector.confirmationReference.trim().toUpperCase(),
    sort_order: index,
  }));

  let createdAt = now;
  if (isDesktopApp()) {
    const database = await db();
    const metaRows = await database.select<Array<{ created_at: string }>>(
      `SELECT created_at FROM transport_operational_meta WHERE booking_id=$1 LIMIT 1`,
      [bookingId],
    );
    if (metaRows[0]?.created_at) createdAt = metaRows[0].created_at;

    await database.execute(`DELETE FROM transport_operational_sectors WHERE company_id=$1 AND booking_id=$2`, [
      companyId,
      bookingId,
    ]);
    for (const sector of sectors) {
      await database.execute(
        `INSERT INTO transport_operational_sectors (id,company_id,booking_id,sector_sort_order,pickup_time,pickup_point,driver_name,driver_mobile,vehicle_plate,confirmation_reference,sort_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [
          sector.id,
          sector.company_id,
          sector.booking_id,
          sector.sector_sort_order,
          sector.pickup_time,
          sector.pickup_point,
          sector.driver_name,
          sector.driver_mobile,
          sector.vehicle_plate,
          sector.confirmation_reference,
          sector.sort_order,
        ],
      );
    }
    await database.execute(
      `INSERT INTO transport_operational_meta (booking_id,company_id,passenger_saudi_contact,group_family_head,transport_instructions,notes,created_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT(booking_id) DO UPDATE SET company_id=excluded.company_id,passenger_saudi_contact=excluded.passenger_saudi_contact,group_family_head=excluded.group_family_head,transport_instructions=excluded.transport_instructions,notes=excluded.notes,updated_at=excluded.updated_at`,
      [
        bookingId,
        companyId,
        input.passengerSaudiContact.trim(),
        input.groupFamilyHead.trim(),
        input.transportInstructions.trim(),
        input.notes.trim(),
        createdAt,
        now,
      ],
    );
    await audit(companyId, userId, bookingId);
  } else {
    const { data } = await supabase
      .from("transport_operational_meta")
      .select("created_at")
      .eq("booking_id", bookingId)
      .maybeSingle();
    if (data?.created_at) createdAt = data.created_at;
  }

  await syncTransportOperationalBundle(bookingId, companyId, {
    passengerSaudiContact: input.passengerSaudiContact.trim(),
    groupFamilyHead: input.groupFamilyHead.trim(),
    transportInstructions: input.transportInstructions.trim(),
    notes: input.notes.trim(),
    createdAt,
    updatedAt: now,
    sectors,
  });
  await queueSync("UPDATE", "transport_bookings", bookingId, { updated_at: now });
  if (isDesktopApp()) await flushDesktopSyncQueue();
}
