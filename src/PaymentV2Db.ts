import Database from "@tauri-apps/plugin-sql";
import { ensurePaymentDocumentUniqueness, runAtomicTransaction, type AtomicSqlStatement } from "./DatabaseSafety";
import {
  isDesktopApp,
  syncPaymentBundle,
  syncPaymentVoid,
  type PaymentEntrySync,
  type PaymentMetaSync,
} from "./cloudSync";
import { supabase } from "./supabaseClient";

const DB_PATH = "sqlite:travel-accounting.db";
let databasePromise: Promise<Database> | null = null;
let initializationPromise: Promise<void> | null = null;

const BUSY_RETRY_DELAYS_MS = [120, 250, 500, 900];

export type PaymentTransactionKind = "PARTY_RECEIPT" | "VENDOR_PAYMENT" | "PARTY_REFUND" | "VENDOR_REFUND";

export type PaymentMethod = "BANK" | "CASH";
export type PaymentCurrency = "PKR" | "SAR";

export type PaymentV2Meta = {
  payment_id: string;
  company_id: string;
  transaction_kind: PaymentTransactionKind;
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

export type PaymentV2Input = {
  transactionKind: PaymentTransactionKind;
  partyId: string;
  transactionDate: string;
  documentNo: string;
  paymentType: PaymentMethod;
  currency: PaymentCurrency;
  amount: number;
  roe: number;
  settlementAccount: string;
  description: string;
  reference: string;
  bankName: string;
  bankTransactionReference: string;
  accountTitle: string;
  accountLastDigits: string;
  chequeNo: string;
  transferDate: string;
  handledBy: string;
  location: string;
  internalNotes: string;
};

type ReceiptRow = { id: string; receipt_no: string };
type CountRow = { count: number };

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

function sleep(ms: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, ms));
}

function isDatabaseBusy(error: unknown) {
  const text = (error instanceof Error ? error.message : String(error)).toLowerCase();
  return text.includes("database is locked") || text.includes("sqlite_busy") || text.includes("code: 5");
}

async function withBusyRetry<T>(operation: () => Promise<T>): Promise<T> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt <= BUSY_RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!isDatabaseBusy(error) || attempt === BUSY_RETRY_DELAYS_MS.length) throw error;
      await sleep(BUSY_RETRY_DELAYS_MS[attempt]);
    }
  }
  throw lastError;
}

export async function initPaymentV2Database() {
  if (!isDesktopApp()) return;
  if (initializationPromise) return initializationPromise;
  initializationPromise = (async () => {
    const database = await db();
    await database.execute("PRAGMA busy_timeout = 5000");
    await withBusyRetry(() =>
      database.execute(`CREATE TABLE IF NOT EXISTS payment_v2_meta (
      payment_id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL,
      transaction_kind TEXT NOT NULL DEFAULT 'PARTY_RECEIPT',
      settlement_account TEXT NOT NULL DEFAULT '',
      reference TEXT NOT NULL DEFAULT '',
      bank_name TEXT NOT NULL DEFAULT '',
      bank_transaction_reference TEXT NOT NULL DEFAULT '',
      account_title TEXT NOT NULL DEFAULT '',
      account_last_digits TEXT NOT NULL DEFAULT '',
      cheque_no TEXT NOT NULL DEFAULT '',
      transfer_date TEXT NOT NULL DEFAULT '',
      handled_by TEXT NOT NULL DEFAULT '',
      location TEXT NOT NULL DEFAULT '',
      internal_notes TEXT NOT NULL DEFAULT '',
      created_by_user_id TEXT NOT NULL DEFAULT '',
      updated_by_user_id TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`),
    );
    await withBusyRetry(() =>
      database.execute(`CREATE INDEX IF NOT EXISTS idx_payment_v2_meta_company_kind
      ON payment_v2_meta(company_id, transaction_kind)`),
    );
    await withBusyRetry(() =>
      database.execute(`CREATE INDEX IF NOT EXISTS idx_payment_receipt_company_number
      ON payment_entries(company_id, receipt_no)`),
    );

    const safety = await ensurePaymentDocumentUniqueness();
    if (safety.duplicatePaymentDocuments > 0) {
      throw new Error(
        `${safety.duplicatePaymentDocuments} duplicate Receipt / Voucher number group(s) already exist. Resolve those duplicates before creating new payments.`,
      );
    }
  })().catch((error) => {
    initializationPromise = null;
    throw error;
  });
  return initializationPromise;
}

async function ready() {
  await initPaymentV2Database();
  return db();
}

export function paymentDocumentPrefix(kind: PaymentTransactionKind, method: PaymentMethod) {
  const kindPrefix =
    kind === "PARTY_RECEIPT"
      ? "RCPT"
      : kind === "VENDOR_PAYMENT"
        ? "PV"
        : kind === "PARTY_REFUND"
          ? "RF-CUST"
          : "RF-VEND";
  const methodPrefix = method === "BANK" ? "BNK" : "CSH";
  return `${kindPrefix}-${methodPrefix}-`;
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export async function getNextPaymentDocumentNumber(
  companyId: string,
  kind: PaymentTransactionKind,
  method: PaymentMethod,
) {
  const prefix = paymentDocumentPrefix(kind, method);
  const matcher = new RegExp(`^${escapeRegex(prefix)}(\\d+)$`, "i");
  let max = 0;

  if (!isDesktopApp()) {
    const { data, error } = await supabase
      .from("payment_entries")
      .select("receipt_no")
      .eq("company_id", companyId)
      .ilike("receipt_no", `${prefix}%`);
    if (error) throw new Error(error.message);
    for (const row of data || []) {
      const match = matcher.exec(String(row.receipt_no || "").trim());
      if (!match) continue;
      max = Math.max(max, Number(match[1]) || 0);
    }
    return `${prefix}${String(max + 1).padStart(4, "0")}`;
  }

  const database = await ready();
  const rows = await database.select<ReceiptRow[]>(
    `SELECT id,receipt_no FROM payment_entries
     WHERE company_id=$1 AND receipt_no LIKE $2 COLLATE NOCASE`,
    [companyId, `${prefix}%`],
  );
  for (const row of rows) {
    const match = matcher.exec(String(row.receipt_no || "").trim());
    if (!match) continue;
    max = Math.max(max, Number(match[1]) || 0);
  }
  return `${prefix}${String(max + 1).padStart(4, "0")}`;
}

export async function getPaymentV2Meta(companyId: string, paymentId: string) {
  if (!isDesktopApp()) {
    const { data, error } = await supabase
      .from("payment_v2_meta")
      .select("*")
      .eq("company_id", companyId)
      .eq("payment_id", paymentId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return (data as PaymentV2Meta | null) ?? null;
  }

  const database = await ready();
  const rows = await database.select<PaymentV2Meta[]>(
    `SELECT payment_id,company_id,transaction_kind,settlement_account,reference,
            bank_name,bank_transaction_reference,account_title,account_last_digits,
            cheque_no,transfer_date,handled_by,location,internal_notes,
            created_by_user_id,updated_by_user_id,created_at,updated_at
     FROM payment_v2_meta
     WHERE company_id=$1 AND payment_id=$2
     LIMIT 1`,
    [companyId, paymentId],
  );
  return rows[0] ?? null;
}

export async function getPaymentV2MetaMap(companyId: string) {
  if (!isDesktopApp()) {
    const { data, error } = await supabase.from("payment_v2_meta").select("*").eq("company_id", companyId);
    if (error) throw new Error(error.message);
    return new Map((data as PaymentV2Meta[] | null)?.map((row) => [row.payment_id, row]) || []);
  }

  const database = await ready();
  const rows = await database.select<PaymentV2Meta[]>(
    `SELECT payment_id,company_id,transaction_kind,settlement_account,reference,
            bank_name,bank_transaction_reference,account_title,account_last_digits,
            cheque_no,transfer_date,handled_by,location,internal_notes,
            created_by_user_id,updated_by_user_id,created_at,updated_at
     FROM payment_v2_meta
     WHERE company_id=$1`,
    [companyId],
  );
  return new Map(rows.map((row) => [row.payment_id, row]));
}

function expectedAccountType(kind: PaymentTransactionKind) {
  return kind === "PARTY_RECEIPT" || kind === "PARTY_REFUND" ? "PARTY" : "VENDOR";
}

async function validateAndResolveAccount(companyId: string, input: PaymentV2Input) {
  if (!input.partyId) throw new Error("Select a Party / Vendor account.");
  if (!input.transactionDate) throw new Error("Payment date is required.");
  if (!input.documentNo.trim()) throw new Error("Receipt / Voucher number is required.");
  if (!input.settlementAccount.trim())
    throw new Error(
      input.paymentType === "BANK" ? "Bank / settlement account is required." : "Cash settlement account is required.",
    );
  const amount = Math.max(0, Number(input.amount) || 0);
  if (amount <= 0) throw new Error("Amount must be greater than zero.");
  const roe = input.currency === "SAR" ? Math.max(0, Number(input.roe) || 0) : 0;
  if (input.currency === "SAR" && roe <= 0) throw new Error("ROE is required for a SAR payment.");

  const { getAccountById } = await import("./CounterpartyDb");
  const account = await getAccountById(companyId, input.partyId);

  const expected = expectedAccountType(input.transactionKind);
  if (!account || account.status !== "ACTIVE" || account.account_type !== expected) {
    throw new Error(
      expected === "PARTY"
        ? "Select an active Party / Customer account."
        : "Select an active Vendor / Supplier account.",
    );
  }

  return { account, amount, roe, paidAmount: input.currency === "SAR" ? amount * roe : amount };
}

async function ensureDocumentAvailable(companyId: string, documentNo: string, excludePaymentId = "") {
  if (!isDesktopApp()) {
    let query = supabase
      .from("payment_entries")
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId)
      .ilike("receipt_no", documentNo.trim());
    if (excludePaymentId) query = query.neq("id", excludePaymentId);
    const { count, error } = await query;
    if (error) throw new Error(error.message);
    if ((count || 0) > 0) {
      throw new Error(`${documentNo.trim()} already exists. Generate the next Receipt / Voucher number.`);
    }
    return;
  }

  const database = await ready();
  const rows = await database.select<CountRow[]>(
    `SELECT COUNT(*) AS count FROM payment_entries
     WHERE company_id=$1 AND receipt_no=$2 COLLATE NOCASE AND ($3='' OR id<>$3)`,
    [companyId, documentNo.trim(), excludePaymentId],
  );
  if (Number(rows[0]?.count || 0) > 0) {
    throw new Error(`${documentNo.trim()} already exists. Generate the next Receipt / Voucher number.`);
  }
}

function buildPaymentSyncPayloads(
  companyId: string,
  paymentId: string,
  input: PaymentV2Input,
  accountName: string,
  amount: number,
  roe: number,
  paidAmount: number,
  userId: string,
  now: string,
  createdAt: string,
  status: "ACTIVE" | "VOID" = "ACTIVE",
): { entry: PaymentEntrySync; meta: PaymentMetaSync } {
  const documentNo = input.documentNo.trim().toUpperCase();
  const settlement = input.settlementAccount.trim();
  const movement = movementAccounts(input.transactionKind, accountName, settlement);
  return {
    entry: {
      id: paymentId,
      company_id: companyId,
      party_id: input.partyId,
      transaction_date: input.transactionDate,
      receipt_no: documentNo,
      from_account: movement.from,
      to_account: movement.to,
      description: input.description.trim(),
      payment_type: input.paymentType,
      currency: input.currency,
      amount_entered: amount,
      sar: input.currency === "SAR" ? amount : 0,
      roe,
      paid_amount: paidAmount,
      status,
      created_at: createdAt,
      updated_at: now,
      created_by_user_id: userId,
      updated_by_user_id: userId,
    },
    meta: {
      payment_id: paymentId,
      company_id: companyId,
      transaction_kind: input.transactionKind,
      settlement_account: settlement,
      reference: input.reference.trim(),
      bank_name: input.bankName.trim(),
      bank_transaction_reference: input.bankTransactionReference.trim(),
      account_title: input.accountTitle.trim(),
      account_last_digits: input.accountLastDigits.trim(),
      cheque_no: input.chequeNo.trim(),
      transfer_date: input.transferDate,
      handled_by: input.handledBy.trim(),
      location: input.location.trim(),
      internal_notes: input.internalNotes.trim(),
      created_by_user_id: userId,
      updated_by_user_id: userId,
      created_at: createdAt,
      updated_at: now,
    },
  };
}

function movementAccounts(kind: PaymentTransactionKind, accountName: string, settlementAccount: string) {
  if (kind === "PARTY_RECEIPT") return { from: accountName, to: settlementAccount };
  if (kind === "VENDOR_PAYMENT") return { from: settlementAccount, to: accountName };
  if (kind === "PARTY_REFUND") return { from: settlementAccount, to: accountName };
  return { from: accountName, to: settlementAccount };
}

function metaStatement(
  companyId: string,
  paymentId: string,
  input: PaymentV2Input,
  userId: string,
  now: string,
): AtomicSqlStatement {
  return {
    sql: `INSERT INTO payment_v2_meta
      (payment_id,company_id,transaction_kind,settlement_account,reference,
       bank_name,bank_transaction_reference,account_title,account_last_digits,
       cheque_no,transfer_date,handled_by,location,internal_notes,
       created_by_user_id,updated_by_user_id,created_at,updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$15,$16,$16)
      ON CONFLICT(payment_id) DO UPDATE SET
        transaction_kind=excluded.transaction_kind,
        settlement_account=excluded.settlement_account,
        reference=excluded.reference,
        bank_name=excluded.bank_name,
        bank_transaction_reference=excluded.bank_transaction_reference,
        account_title=excluded.account_title,
        account_last_digits=excluded.account_last_digits,
        cheque_no=excluded.cheque_no,
        transfer_date=excluded.transfer_date,
        handled_by=excluded.handled_by,
        location=excluded.location,
        internal_notes=excluded.internal_notes,
        updated_by_user_id=excluded.updated_by_user_id,
        updated_at=excluded.updated_at`,
    params: [
      paymentId,
      companyId,
      input.transactionKind,
      input.settlementAccount.trim(),
      input.reference.trim(),
      input.bankName.trim(),
      input.bankTransactionReference.trim(),
      input.accountTitle.trim(),
      input.accountLastDigits.trim(),
      input.chequeNo.trim(),
      input.transferDate,
      input.handledBy.trim(),
      input.location.trim(),
      input.internalNotes.trim(),
      userId,
      now,
    ],
  };
}

function auditStatement(
  companyId: string,
  userId: string,
  action: string,
  recordId: string,
  details: string,
  now: string,
): AtomicSqlStatement | null {
  if (!userId) return null;
  return {
    sql: `INSERT INTO audit_logs
      (id,company_id,user_id,user_name,action,module,record_id,details,created_at)
      VALUES ($1,$2,$3,
        COALESCE((SELECT full_name FROM users WHERE id=$3 AND company_id=$2 LIMIT 1),'Unknown User'),
        $4,'PAYMENTS',$5,$6,$7)`,
    params: [crypto.randomUUID(), companyId, userId, action, recordId, details, now],
  };
}

export async function createPaymentV2(companyId: string, input: PaymentV2Input, userId = "") {
  const { account, amount, roe, paidAmount } = await validateAndResolveAccount(companyId, input);
  const documentNo = input.documentNo.trim().toUpperCase();
  const settlement = input.settlementAccount.trim();
  const movement = movementAccounts(input.transactionKind, account.name, settlement);
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  await ensureDocumentAvailable(companyId, documentNo);

  if (isDesktopApp()) {
    const statements: AtomicSqlStatement[] = [
      {
        sql: `INSERT INTO payment_entries
          (id,company_id,party_id,transaction_date,receipt_no,from_account,to_account,
           description,payment_type,currency,amount_entered,sar,roe,paid_amount,status,created_at,updated_at,
           created_by_user_id,updated_by_user_id)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'ACTIVE',$15,$15,$16,$16)`,
        params: [
          id,
          companyId,
          input.partyId,
          input.transactionDate,
          documentNo,
          movement.from,
          movement.to,
          input.description.trim(),
          input.paymentType,
          input.currency,
          amount,
          input.currency === "SAR" ? amount : 0,
          roe,
          paidAmount,
          now,
          userId,
        ],
      },
      metaStatement(companyId, id, input, userId, now),
    ];
    const audit = auditStatement(
      companyId,
      userId,
      "PAYMENT_CREATED",
      id,
      `${input.transactionKind} ${documentNo} - PKR ${paidAmount.toFixed(2)}`,
      now,
    );
    if (audit) statements.push(audit);

    try {
      await runAtomicTransaction(statements);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/unique constraint failed|idx_payment_receipt_company_number/i.test(message)) {
        // eslint-disable-next-line
        throw new Error(`${documentNo} was just used by another payment. Generate the next Receipt / Voucher number.`);
      }
      throw error;
    }
  }

  const payloads = buildPaymentSyncPayloads(
    companyId,
    id,
    input,
    account.name,
    amount,
    roe,
    paidAmount,
    userId,
    now,
    now,
  );
  await syncPaymentBundle(payloads.entry, payloads.meta);
  return id;
}

export async function updatePaymentV2(companyId: string, paymentId: string, input: PaymentV2Input, userId = "") {
  const { account, amount, roe, paidAmount } = await validateAndResolveAccount(companyId, input);
  const existingMeta = await getPaymentV2Meta(companyId, paymentId);
  if (existingMeta && existingMeta.transaction_kind !== input.transactionKind) {
    throw new Error("Payment direction is locked after the Receipt / Voucher is saved.");
  }
  const documentNo = input.documentNo.trim().toUpperCase();
  const settlement = input.settlementAccount.trim();
  const movement = movementAccounts(input.transactionKind, account.name, settlement);
  const now = new Date().toISOString();
  const createdAt = existingMeta?.created_at || now;

  await ensureDocumentAvailable(companyId, documentNo, paymentId);

  if (isDesktopApp()) {
    const statements: AtomicSqlStatement[] = [
      {
        sql: `UPDATE payment_entries SET
          party_id=$1,transaction_date=$2,receipt_no=$3,from_account=$4,to_account=$5,
          description=$6,payment_type=$7,currency=$8,amount_entered=$9,sar=$10,roe=$11,
          paid_amount=$12,updated_at=$13,updated_by_user_id=$14
          WHERE id=$15 AND company_id=$16 AND status='ACTIVE'`,
        params: [
          input.partyId,
          input.transactionDate,
          documentNo,
          movement.from,
          movement.to,
          input.description.trim(),
          input.paymentType,
          input.currency,
          amount,
          input.currency === "SAR" ? amount : 0,
          roe,
          paidAmount,
          now,
          userId,
          paymentId,
          companyId,
        ],
      },
      metaStatement(companyId, paymentId, input, userId, now),
    ];
    const audit = auditStatement(
      companyId,
      userId,
      "PAYMENT_UPDATED",
      paymentId,
      `${input.transactionKind} ${documentNo} - PKR ${paidAmount.toFixed(2)}`,
      now,
    );
    if (audit) statements.push(audit);

    try {
      await runAtomicTransaction(statements);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/unique constraint failed|idx_payment_receipt_company_number/i.test(message)) {
        // eslint-disable-next-line
        throw new Error(`${documentNo} already exists. Generate the next Receipt / Voucher number.`);
      }
      throw error;
    }
  }

  const payloads = buildPaymentSyncPayloads(
    companyId,
    paymentId,
    input,
    account.name,
    amount,
    roe,
    paidAmount,
    userId,
    now,
    createdAt,
  );
  await syncPaymentBundle(payloads.entry, payloads.meta);
}

export async function voidPaymentV2(companyId: string, paymentId: string, userId = "") {
  const now = new Date().toISOString();

  if (isDesktopApp()) {
    const database = await ready();
    const rows = await database.select<Array<{ receipt_no: string; paid_amount: number }>>(
      `SELECT receipt_no,paid_amount FROM payment_entries WHERE company_id=$1 AND id=$2 LIMIT 1`,
      [companyId, paymentId],
    );
    const record = rows[0] || null;
    const statements: AtomicSqlStatement[] = [
      {
        sql: `UPDATE payment_entries SET status='VOID',updated_at=$1,updated_by_user_id=$2
          WHERE id=$3 AND company_id=$4 AND status='ACTIVE'`,
        params: [now, userId, paymentId, companyId],
      },
    ];
    if (record) {
      const audit = auditStatement(
        companyId,
        userId,
        "PAYMENT_VOIDED",
        paymentId,
        `${record.receipt_no || "Payment"} - PKR ${Number(record.paid_amount || 0).toFixed(2)}`,
        now,
      );
      if (audit) statements.push(audit);
    }
    await runAtomicTransaction(statements);
  }

  await syncPaymentVoid(paymentId, now, userId);
}
