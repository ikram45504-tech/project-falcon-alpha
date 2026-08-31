import Database from "@tauri-apps/plugin-sql";
import { supabase } from "./supabaseClient";
import { isDesktopApp, queueSync } from "./cloudSync";
import type { Party, PartyInput, BookingTransactionType } from "./db";
import { normalizePartyInput } from "./db";

const DB_PATH = "sqlite:travel-accounting.db";
let databasePromise: Promise<Database> | null = null;

async function localDb() {
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
export type CounterpartyTable = "parties" | "vendors" | "unassigned_accounts";
export type AccountType = PartyInput["accountType"];

type AccountRow = {
  id: string;
  company_id: string;
  name: string;
  contact_person: string;
  phone: string;
  whatsapp: string;
  email: string;
  address: string;
  reference: string;
  notes: string;
  status: "ACTIVE" | "INACTIVE";
  created_at: string;
  updated_at: string;
  created_by_user_id?: string;
  updated_by_user_id?: string;
};

const ACCOUNT_COLUMNS = `id,company_id,name,contact_person,phone,whatsapp,email,address,reference,notes,status,created_at,updated_at`;

function tableForAccountType(accountType: AccountType): CounterpartyTable {
  if (accountType === "VENDOR") return "vendors";
  if (accountType === "UNASSIGNED") return "unassigned_accounts";
  return "parties";
}

function accountTypeForTable(table: CounterpartyTable): AccountType {
  if (table === "vendors") return "VENDOR";
  if (table === "unassigned_accounts") return "UNASSIGNED";
  return "PARTY";
}

function toParty(row: AccountRow, accountType: AccountType): Party {
  const reference = String(row.reference || row.notes || "").trim();
  return {
    id: row.id,
    company_id: row.company_id,
    name: row.name,
    contact_person: String(row.contact_person || ""),
    phone: row.phone || "",
    whatsapp: row.whatsapp || "",
    email: String(row.email || ""),
    address: row.address || "",
    reference,
    notes: reference,
    status: row.status,
    account_type: accountType,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function rowFromInput(
  id: string,
  companyId: string,
  input: PartyInput,
  now: string,
  actorUserId: string,
  createdAt?: string,
): AccountRow {
  const normalized = normalizePartyInput(input);
  return {
    id,
    company_id: companyId,
    name: normalized.name,
    contact_person: normalized.contactPerson,
    phone: normalized.phone,
    whatsapp: normalized.whatsapp,
    email: normalized.email,
    address: normalized.address,
    reference: normalized.reference,
    notes: normalized.reference,
    status: normalized.status,
    created_at: createdAt || now,
    updated_at: now,
    created_by_user_id: actorUserId,
    updated_by_user_id: actorUserId,
  };
}

export async function initCounterpartyTables(database: Database) {
  async function ensureColumn(table: string, column: string, definition: string) {
    const columns = await database.select<Record<string, unknown>[]>(`PRAGMA table_info(${table})`);
    const exists = columns.some((item) => String(item["name"] ?? "").toLowerCase() === column.toLowerCase());
    if (exists) return;
    await database.execute(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }

  await database.execute(`CREATE TABLE IF NOT EXISTS vendors (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    name TEXT NOT NULL,
    phone TEXT NOT NULL DEFAULT '',
    whatsapp TEXT NOT NULL DEFAULT '',
    address TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'ACTIVE',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    created_by_user_id TEXT NOT NULL DEFAULT '',
    updated_by_user_id TEXT NOT NULL DEFAULT ''
  )`);

  await database.execute(`CREATE TABLE IF NOT EXISTS unassigned_accounts (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    name TEXT NOT NULL,
    phone TEXT NOT NULL DEFAULT '',
    whatsapp TEXT NOT NULL DEFAULT '',
    address TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'ACTIVE',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    created_by_user_id TEXT NOT NULL DEFAULT '',
    updated_by_user_id TEXT NOT NULL DEFAULT ''
  )`);

  await database.execute(`CREATE INDEX IF NOT EXISTS idx_vendors_company_name ON vendors(company_id, name)`);
  await database.execute(
    `CREATE INDEX IF NOT EXISTS idx_unassigned_accounts_company_name ON unassigned_accounts(company_id, name)`,
  );

  for (const table of ["parties", "vendors", "unassigned_accounts"] as const) {
    await ensureColumn(table, "created_by_user_id", "TEXT NOT NULL DEFAULT ''");
    await ensureColumn(table, "updated_by_user_id", "TEXT NOT NULL DEFAULT ''");
    await ensureColumn(table, "contact_person", "TEXT NOT NULL DEFAULT ''");
    await ensureColumn(table, "email", "TEXT NOT NULL DEFAULT ''");
    await ensureColumn(table, "reference", "TEXT NOT NULL DEFAULT ''");
  }

  const vendorCount = await database.select<Array<{ count: number }>>(`SELECT COUNT(*) AS count FROM vendors`);
  if (Number(vendorCount[0]?.count || 0) === 0) {
    await database.execute(
      `INSERT OR IGNORE INTO vendors
       (id,company_id,name,phone,whatsapp,address,notes,status,created_at,updated_at,created_by_user_id,updated_by_user_id,contact_person,email,reference)
       SELECT id,company_id,name,phone,whatsapp,address,notes,status,created_at,updated_at,
              COALESCE(created_by_user_id,''), COALESCE(updated_by_user_id,''),
              COALESCE(contact_person,''), COALESCE(email,''), COALESCE(NULLIF(TRIM(reference),''), notes, '')
       FROM parties WHERE account_type='VENDOR'`,
    );
    await database.execute(
      `INSERT OR IGNORE INTO unassigned_accounts
       (id,company_id,name,phone,whatsapp,address,notes,status,created_at,updated_at,created_by_user_id,updated_by_user_id,contact_person,email,reference)
       SELECT id,company_id,name,phone,whatsapp,address,notes,status,created_at,updated_at,
              COALESCE(created_by_user_id,''), COALESCE(updated_by_user_id,''),
              COALESCE(contact_person,''), COALESCE(email,''), COALESCE(NULLIF(TRIM(reference),''), notes, '')
       FROM parties WHERE account_type='UNASSIGNED'`,
    );
    await database.execute(`DELETE FROM parties WHERE account_type IN ('VENDOR','UNASSIGNED')`);
  }

  for (const table of ["parties", "vendors", "unassigned_accounts"] as const) {
    await database.execute(
      `UPDATE ${table} SET reference = notes WHERE TRIM(COALESCE(reference,'')) = '' AND TRIM(COALESCE(notes,'')) <> ''`,
    );
  }
}

async function findAccountTable(companyId: string, accountId: string): Promise<CounterpartyTable | null> {
  if (isDesktopApp()) {
    const database = await localDb();
    for (const table of ["parties", "vendors", "unassigned_accounts"] as CounterpartyTable[]) {
      const rows = await database.select<Array<{ id: string }>>(
        `SELECT id FROM ${table} WHERE id=$1 AND company_id=$2 LIMIT 1`,
        [accountId, companyId],
      );
      if (rows[0]) return table;
    }
    return null;
  }

  for (const table of ["parties", "vendors", "unassigned_accounts"] as CounterpartyTable[]) {
    const { data, error } = await supabase
      .from(table)
      .select("id")
      .eq("company_id", companyId)
      .eq("id", accountId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (data) return table;
  }
  return null;
}

function accountLabel(accountType: AccountType) {
  if (accountType === "VENDOR") return "Vendor";
  if (accountType === "UNASSIGNED") return "Unassigned account";
  return "Party";
}

async function assertUniqueAccountName(companyId: string, accountType: AccountType, name: string, excludeId = "") {
  const cleanName = name.trim();
  const table = tableForAccountType(accountType);

  if (!isDesktopApp()) {
    let query = supabase.from(table).select("id").eq("company_id", companyId).ilike("name", cleanName).limit(1);
    if (excludeId) query = query.neq("id", excludeId);
    const { data: duplicate, error } = await query;
    if (error) throw new Error(error.message);
    if (duplicate && duplicate.length > 0) {
      throw new Error(`A ${accountLabel(accountType).toLowerCase()} named "${cleanName}" already exists.`);
    }
    return;
  }

  const database = await localDb();
  const duplicate = await database.select<Array<{ count: number }>>(
    `SELECT COUNT(*) AS count FROM ${table}
     WHERE company_id=$1 AND name=$2 COLLATE NOCASE AND ($3='' OR id<>$3)`,
    [companyId, cleanName, excludeId],
  );
  if (Number(duplicate[0]?.count ?? 0) > 0) {
    throw new Error(`A ${accountLabel(accountType).toLowerCase()} named "${cleanName}" already exists.`);
  }
}

function sortAccounts(rows: Party[]) {
  return rows.sort((a, b) => {
    if (a.status === "ACTIVE" && b.status !== "ACTIVE") return -1;
    if (a.status !== "ACTIVE" && b.status === "ACTIVE") return 1;
    return a.name.localeCompare(b.name);
  });
}

async function selectAllFromTable(companyId: string, table: CounterpartyTable, search: string): Promise<Party[]> {
  const accountType = accountTypeForTable(table);
  const clean = search.trim();

  if (!isDesktopApp()) {
    let query = supabase.from(table).select(ACCOUNT_COLUMNS).eq("company_id", companyId);
    if (clean) {
      query = query.or(
        `name.ilike.%${clean}%,contact_person.ilike.%${clean}%,phone.ilike.%${clean}%,whatsapp.ilike.%${clean}%,email.ilike.%${clean}%,address.ilike.%${clean}%,reference.ilike.%${clean}%,notes.ilike.%${clean}%`,
      );
    }
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return (data as AccountRow[]).map((row) => toParty(row, accountType));
  }

  const database = await localDb();
  if (!clean) {
    const rows = await database.select<AccountRow[]>(
      `SELECT ${ACCOUNT_COLUMNS} FROM ${table}
       WHERE company_id=$1
       ORDER BY CASE WHEN status='ACTIVE' THEN 0 ELSE 1 END, name COLLATE NOCASE`,
      [companyId],
    );
    return rows.map((row) => toParty(row, accountType));
  }

  const term = `%${clean}%`;
  const rows = await database.select<AccountRow[]>(
    `SELECT ${ACCOUNT_COLUMNS} FROM ${table}
     WHERE company_id=$1 AND (
       name LIKE $2 COLLATE NOCASE OR contact_person LIKE $2 COLLATE NOCASE OR
       phone LIKE $2 OR whatsapp LIKE $2 OR email LIKE $2 COLLATE NOCASE OR
       address LIKE $2 COLLATE NOCASE OR reference LIKE $2 COLLATE NOCASE OR notes LIKE $2 COLLATE NOCASE
     )
     ORDER BY CASE WHEN status='ACTIVE' THEN 0 ELSE 1 END, name COLLATE NOCASE`,
    [companyId, term],
  );
  return rows.map((row) => toParty(row, accountType));
}

export async function getAllAccounts(companyId: string, search = ""): Promise<Party[]> {
  const merged = [
    ...(await selectAllFromTable(companyId, "parties", search)),
    ...(await selectAllFromTable(companyId, "vendors", search)),
    ...(await selectAllFromTable(companyId, "unassigned_accounts", search)),
  ];
  return sortAccounts(merged);
}

export async function getAccountsByType(companyId: string, accountType: AccountType, search = "") {
  return sortAccounts(await selectAllFromTable(companyId, tableForAccountType(accountType), search));
}

export async function getAccountById(companyId: string, accountId: string): Promise<Party | null> {
  const table = await findAccountTable(companyId, accountId);
  if (!table) return null;
  const accountType = accountTypeForTable(table);

  if (!isDesktopApp()) {
    const { data, error } = await supabase
      .from(table)
      .select(ACCOUNT_COLUMNS)
      .eq("company_id", companyId)
      .eq("id", accountId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data ? toParty(data as AccountRow, accountType) : null;
  }

  const database = await localDb();
  const rows = await database.select<AccountRow[]>(
    `SELECT ${ACCOUNT_COLUMNS} FROM ${table} WHERE company_id=$1 AND id=$2 LIMIT 1`,
    [companyId, accountId],
  );
  return rows[0] ? toParty(rows[0], accountType) : null;
}

export async function fetchCounterpartyNameMap(companyId: string) {
  const map = new Map<string, string>();
  for (const table of ["parties", "vendors", "unassigned_accounts"] as CounterpartyTable[]) {
    if (!isDesktopApp()) {
      const { data, error } = await supabase.from(table).select("id, name").eq("company_id", companyId);
      if (error) throw new Error(error.message);
      for (const row of data || []) map.set(String(row.id), String(row.name || ""));
    } else {
      const database = await localDb();
      const rows = await database.select<Array<{ id: string; name: string }>>(
        `SELECT id, name FROM ${table} WHERE company_id=$1`,
        [companyId],
      );
      for (const row of rows) map.set(row.id, row.name || "");
    }
  }
  return map;
}

export async function validateParty(companyId: string, partyId: string) {
  if (!partyId) throw new Error("Select a Party.");
  const account = await getAccountById(companyId, partyId);
  if (!account || account.status !== "ACTIVE" || account.account_type !== "PARTY") {
    throw new Error("Sale bookings can only be saved against an active Party.");
  }
}

export async function validateVendor(companyId: string, vendorId: string) {
  if (!vendorId) throw new Error("Select a Vendor.");
  const account = await getAccountById(companyId, vendorId);
  if (!account || account.status !== "ACTIVE" || account.account_type !== "VENDOR") {
    throw new Error("Purchase bookings can only be saved against an active Vendor.");
  }
}

export async function validateBookingCounterparty(
  companyId: string,
  transactionType: BookingTransactionType,
  counterpartyId: string,
) {
  if (transactionType === "SALE") await validateParty(companyId, counterpartyId);
  else await validateVendor(companyId, counterpartyId);
}

function syncPayload(row: AccountRow, accountType: AccountType, actorUserId: string) {
  const table = tableForAccountType(accountType);
  const payload: Record<string, unknown> = {
    id: row.id,
    company_id: row.company_id,
    name: row.name,
    contact_person: row.contact_person,
    phone: row.phone,
    whatsapp: row.whatsapp,
    email: row.email,
    address: row.address,
    reference: row.reference,
    notes: row.notes,
    status: row.status,
    updated_at: row.updated_at,
    updated_by_user_id: actorUserId,
  };
  if (table === "parties") {
    payload.account_type = "PARTY";
    payload.created_at = row.created_at;
    payload.created_by_user_id = row.created_by_user_id || actorUserId;
  }
  return { table, payload };
}

const INSERT_COLS = `id,company_id,name,contact_person,phone,whatsapp,email,address,reference,notes,status,created_at,updated_at,created_by_user_id,updated_by_user_id`;

export async function createAccount(companyId: string, input: PartyInput, actorUserId = "") {
  await assertUniqueAccountName(companyId, input.accountType, input.name);
  const table = tableForAccountType(input.accountType);
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const row = rowFromInput(id, companyId, input, now, actorUserId);

  if (isDesktopApp()) {
    const database = await localDb();
    await database.execute(
      `INSERT INTO ${table}
       (${INSERT_COLS})
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12,$13,$13)`,
      [
        id,
        companyId,
        row.name,
        row.contact_person,
        row.phone,
        row.whatsapp,
        row.email,
        row.address,
        row.reference,
        row.notes,
        row.status,
        now,
        actorUserId,
      ],
    );
  }

  const { table: syncTable, payload } = syncPayload(row, input.accountType, actorUserId);
  if (syncTable === "parties") {
    await queueSync("INSERT", syncTable, id, payload);
  } else {
    await queueSync("INSERT", syncTable, id, {
      ...payload,
      created_at: now,
      created_by_user_id: actorUserId,
    });
  }
  return id;
}

export async function updateAccount(accountId: string, companyId: string, input: PartyInput, actorUserId = "") {
  await assertUniqueAccountName(companyId, input.accountType, input.name, accountId);
  const currentTable = await findAccountTable(companyId, accountId);
  if (!currentTable) throw new Error("Account not found.");
  const targetTable = tableForAccountType(input.accountType);
  const now = new Date().toISOString();
  const row = rowFromInput(accountId, companyId, input, now, actorUserId, now);

  if (isDesktopApp()) {
    const database = await localDb();
    if (currentTable !== targetTable) {
      const existing = await database.select<AccountRow[]>(
        `SELECT ${ACCOUNT_COLUMNS},created_by_user_id FROM ${currentTable} WHERE id=$1 AND company_id=$2 LIMIT 1`,
        [accountId, companyId],
      );
      const source = existing[0];
      if (!source) throw new Error("Account not found.");
      await database.execute(`DELETE FROM ${currentTable} WHERE id=$1 AND company_id=$2`, [accountId, companyId]);
      await database.execute(
        `INSERT INTO ${targetTable}
         (${INSERT_COLS})
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
        [
          accountId,
          companyId,
          row.name,
          row.contact_person,
          row.phone,
          row.whatsapp,
          row.email,
          row.address,
          row.reference,
          row.notes,
          row.status,
          source.created_at,
          now,
          source.created_by_user_id || actorUserId,
          actorUserId,
        ],
      );
      await queueSync("DELETE", currentTable, accountId, {});
    } else {
      await database.execute(
        `UPDATE ${targetTable}
         SET name=$1,contact_person=$2,phone=$3,whatsapp=$4,email=$5,address=$6,reference=$7,notes=$8,status=$9,updated_at=$10,updated_by_user_id=$11
         WHERE id=$12 AND company_id=$13`,
        [
          row.name,
          row.contact_person,
          row.phone,
          row.whatsapp,
          row.email,
          row.address,
          row.reference,
          row.notes,
          row.status,
          now,
          actorUserId,
          accountId,
          companyId,
        ],
      );
    }
  } else if (currentTable !== targetTable) {
    const existing = await getAccountById(companyId, accountId);
    if (!existing) throw new Error("Account not found.");
    await queueSync("DELETE", currentTable, accountId, {});
    await queueSync("INSERT", targetTable, accountId, {
      id: accountId,
      company_id: companyId,
      name: row.name,
      contact_person: row.contact_person,
      phone: row.phone,
      whatsapp: row.whatsapp,
      email: row.email,
      address: row.address,
      reference: row.reference,
      notes: row.notes,
      status: row.status,
      created_at: existing.created_at,
      updated_at: now,
      created_by_user_id: actorUserId,
      updated_by_user_id: actorUserId,
    });
    return;
  }

  const { table: syncTable, payload } = syncPayload(row, input.accountType, actorUserId);
  await queueSync("UPDATE", syncTable, accountId, payload);
}

export async function deleteAccount(accountId: string, companyId: string) {
  const table = await findAccountTable(companyId, accountId);
  if (!table) return;

  if (isDesktopApp()) {
    const database = await localDb();
    await database.execute(`DELETE FROM ${table} WHERE id=$1 AND company_id=$2`, [accountId, companyId]);
  }
  await queueSync("DELETE", table, accountId, {});
}

export { getAllAccounts as getParties };
