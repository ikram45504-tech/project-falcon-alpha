import Database from "@tauri-apps/plugin-sql";
import type { PaymentEntry } from "./db";
import { runAtomicTransaction, type AtomicSqlStatement } from "./DatabaseSafety";
import { isDesktopApp } from "./cloudSync";
import { syncPaymentCorrection } from "./cloudSync";
import {
  getPaymentV2Meta,
  getPaymentEntryById,
  updatePaymentV2,
  type PaymentV2Input,
  type PaymentV2Meta,
} from "./PaymentV2Db";
import { supabase } from "./supabaseClient";

const DB_PATH = "sqlite:travel-accounting.db";
let databasePromise: Promise<Database> | null = null;
let initializationPromise: Promise<void> | null = null;

export type PaymentCorrectionAction = "CORRECTION" | "VOID";

export type PaymentCorrectionRecord = {
  id: string;
  company_id: string;
  payment_id: string;
  correction_no: number;
  action: PaymentCorrectionAction;
  reason: string;
  before_snapshot_json: string;
  after_snapshot_json: string;
  changed_fields_json: string;
  corrected_by_user_id: string;
  corrected_at: string;
};

export type PaymentSnapshot = {
  entry: Record<string, unknown>;
  meta: Record<string, unknown> | null;
};

async function db() {
  if (!databasePromise) {
    const isTauri = "__TAURI_INTERNALS__" in window;
    if (isTauri) {
      databasePromise = Database.load(DB_PATH);
    } else {
      databasePromise = Promise.resolve({
        execute: async () => ({ lastInsertId: 0, rowsAffected: 0 }),
        select: async () => [],
      } as any);
    }
  }
  return databasePromise;
}

export async function initPaymentCorrectionDatabase() {
  if (!isDesktopApp()) return;
  if (initializationPromise) return initializationPromise;
  initializationPromise = (async () => {
    const database = await db();
    await database.execute(`CREATE TABLE IF NOT EXISTS payment_corrections (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL,
      payment_id TEXT NOT NULL,
      correction_no INTEGER NOT NULL DEFAULT 1,
      action TEXT NOT NULL DEFAULT 'CORRECTION',
      reason TEXT NOT NULL DEFAULT '',
      before_snapshot_json TEXT NOT NULL DEFAULT '{}',
      after_snapshot_json TEXT NOT NULL DEFAULT '{}',
      changed_fields_json TEXT NOT NULL DEFAULT '[]',
      corrected_by_user_id TEXT NOT NULL DEFAULT '',
      corrected_at TEXT NOT NULL
    )`);
    await database.execute(`CREATE INDEX IF NOT EXISTS idx_payment_corrections_payment
      ON payment_corrections(company_id, payment_id, correction_no)`);
  })().catch((error) => {
    initializationPromise = null;
    throw error;
  });
  return initializationPromise;
}

async function ready() {
  await initPaymentCorrectionDatabase();
  return db();
}

export function buildPaymentSnapshot(entry: PaymentEntry, meta: PaymentV2Meta | null): PaymentSnapshot {
  return {
    entry: {
      transaction_date: entry.transaction_date,
      receipt_no: entry.receipt_no,
      from_account: entry.from_account,
      to_account: entry.to_account,
      description: entry.description,
      payment_type: entry.payment_type,
      currency: entry.currency,
      amount_entered: entry.amount_entered,
      sar: entry.sar,
      roe: entry.roe,
      paid_amount: entry.paid_amount,
      status: entry.status,
    },
    meta: meta
      ? {
          transaction_kind: meta.transaction_kind,
          settlement_account: meta.settlement_account,
          reference: meta.reference,
          bank_name: meta.bank_name,
          bank_transaction_reference: meta.bank_transaction_reference,
          account_title: meta.account_title,
          account_last_digits: meta.account_last_digits,
          cheque_no: meta.cheque_no,
          transfer_date: meta.transfer_date,
          handled_by: meta.handled_by,
          location: meta.location,
          internal_notes: meta.internal_notes,
        }
      : null,
  };
}

const SNAPSHOT_LABELS: Record<string, string> = {
  transaction_date: "Date",
  receipt_no: "Receipt / Voucher #",
  from_account: "From",
  to_account: "Receiving",
  description: "Description",
  payment_type: "Method",
  currency: "Currency",
  amount_entered: "Amount entered",
  sar: "SAR amount",
  roe: "ROE",
  paid_amount: "PKR amount",
  status: "Status",
  settlement_account: "Settlement account",
  reference: "Reference",
  bank_name: "Bank name",
  bank_transaction_reference: "Bank reference",
  account_title: "Account title",
  account_last_digits: "Account digits",
  cheque_no: "Cheque #",
  transfer_date: "Transfer date",
  handled_by: "Handled by",
  location: "Location",
  internal_notes: "Internal notes",
};

export function diffPaymentSnapshots(before: PaymentSnapshot, after: PaymentSnapshot): string[] {
  const changed: string[] = [];
  for (const [key, label] of Object.entries(SNAPSHOT_LABELS)) {
    const left = before.entry[key] ?? before.meta?.[key];
    const right = after.entry[key] ?? after.meta?.[key];
    if (String(left ?? "") !== String(right ?? "")) changed.push(label);
  }
  return changed;
}

async function nextCorrectionNo(companyId: string, paymentId: string) {
  if (!isDesktopApp()) {
    const { data, error } = await supabase
      .from("payment_corrections")
      .select("correction_no")
      .eq("company_id", companyId)
      .eq("payment_id", paymentId)
      .order("correction_no", { ascending: false })
      .limit(1);
    if (error) throw new Error(error.message);
    return Number(data?.[0]?.correction_no || 0) + 1;
  }
  const database = await ready();
  const rows = await database.select<Array<{ correction_no: number }>>(
    `SELECT correction_no FROM payment_corrections
     WHERE company_id=$1 AND payment_id=$2
     ORDER BY correction_no DESC LIMIT 1`,
    [companyId, paymentId],
  );
  return Number(rows[0]?.correction_no || 0) + 1;
}

async function insertCorrectionRecord(record: PaymentCorrectionRecord) {
  if (isDesktopApp()) {
    const statements: AtomicSqlStatement[] = [
      {
        sql: `INSERT INTO payment_corrections
          (id,company_id,payment_id,correction_no,action,reason,
           before_snapshot_json,after_snapshot_json,changed_fields_json,
           corrected_by_user_id,corrected_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        params: [
          record.id,
          record.company_id,
          record.payment_id,
          record.correction_no,
          record.action,
          record.reason,
          record.before_snapshot_json,
          record.after_snapshot_json,
          record.changed_fields_json,
          record.corrected_by_user_id,
          record.corrected_at,
        ],
      },
    ];
    await runAtomicTransaction(statements);
  } else {
    const { error } = await supabase.from("payment_corrections").upsert(record);
    if (error) throw new Error(error.message);
  }
  await syncPaymentCorrection(record);
}

export async function getPaymentCorrections(companyId: string, paymentId: string) {
  if (!isDesktopApp()) {
    const { data, error } = await supabase
      .from("payment_corrections")
      .select("*")
      .eq("company_id", companyId)
      .eq("payment_id", paymentId)
      .order("correction_no", { ascending: false });
    if (error) throw new Error(error.message);
    return (data as PaymentCorrectionRecord[]) || [];
  }
  const database = await ready();
  return database.select<PaymentCorrectionRecord[]>(
    `SELECT id,company_id,payment_id,correction_no,action,reason,
            before_snapshot_json,after_snapshot_json,changed_fields_json,
            corrected_by_user_id,corrected_at
     FROM payment_corrections
     WHERE company_id=$1 AND payment_id=$2
     ORDER BY correction_no DESC`,
    [companyId, paymentId],
  );
}

export async function correctPaymentV2(
  companyId: string,
  paymentId: string,
  input: PaymentV2Input,
  userId: string,
  reason: string,
  beforeEntry: PaymentEntry,
  beforeMeta: PaymentV2Meta | null,
) {
  const trimmedReason = reason.trim();
  if (!trimmedReason) throw new Error("Correction reason is required for the office record.");

  const beforeSnapshot = buildPaymentSnapshot(beforeEntry, beforeMeta);
  await updatePaymentV2(companyId, paymentId, input, userId);

  const afterEntry = await getPaymentEntryById(companyId, paymentId);
  const afterMeta = await getPaymentV2Meta(companyId, paymentId);
  if (!afterEntry) throw new Error("Payment not found after correction.");

  const afterSnapshot = buildPaymentSnapshot(afterEntry, afterMeta);
  const changed = diffPaymentSnapshots(beforeSnapshot, afterSnapshot);
  const now = new Date().toISOString();
  const correctionNo = await nextCorrectionNo(companyId, paymentId);

  await insertCorrectionRecord({
    id: crypto.randomUUID(),
    company_id: companyId,
    payment_id: paymentId,
    correction_no: correctionNo,
    action: "CORRECTION",
    reason: trimmedReason,
    before_snapshot_json: JSON.stringify(beforeSnapshot),
    after_snapshot_json: JSON.stringify(afterSnapshot),
    changed_fields_json: JSON.stringify(changed),
    corrected_by_user_id: userId,
    corrected_at: now,
  });
}

export async function recordPaymentVoidHistory(
  companyId: string,
  paymentId: string,
  userId: string,
  reason: string,
  beforeEntry: PaymentEntry,
  beforeMeta: PaymentV2Meta | null,
) {
  const trimmedReason = reason.trim();
  if (!trimmedReason) throw new Error("Void reason is required for the office record.");

  const beforeSnapshot = buildPaymentSnapshot(beforeEntry, beforeMeta);
  const afterSnapshot = buildPaymentSnapshot({ ...beforeEntry, status: "VOID" }, beforeMeta);
  const now = new Date().toISOString();
  const correctionNo = await nextCorrectionNo(companyId, paymentId);

  await insertCorrectionRecord({
    id: crypto.randomUUID(),
    company_id: companyId,
    payment_id: paymentId,
    correction_no: correctionNo,
    action: "VOID",
    reason: trimmedReason,
    before_snapshot_json: JSON.stringify(beforeSnapshot),
    after_snapshot_json: JSON.stringify(afterSnapshot),
    changed_fields_json: JSON.stringify(["Status"]),
    corrected_by_user_id: userId,
    corrected_at: now,
  });
}
