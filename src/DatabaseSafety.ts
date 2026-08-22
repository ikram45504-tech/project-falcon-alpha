import { invoke } from "@tauri-apps/api/core";

export type AtomicSqlStatement = {
  sql: string;
  params?: unknown[];
};

export type DatabaseSafetyReport = {
  backupPath: string | null;
  destructiveMigrationsRetired: boolean;
  paymentDocumentUniqueIndex: boolean;
  duplicatePaymentDocuments: number;
};

type DbParam =
  | { kind: "NULL" }
  | { kind: "TEXT"; value: string }
  | { kind: "INTEGER"; value: number }
  | { kind: "REAL"; value: number }
  | { kind: "BOOL"; value: boolean };

let initializationPromise: Promise<DatabaseSafetyReport> | null = null;

function toDbParam(value: unknown): DbParam {
  if (value == null) return { kind: "NULL" };
  if (typeof value === "string") return { kind: "TEXT", value };
  if (typeof value === "boolean") return { kind: "BOOL", value };
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Database parameters cannot contain NaN or Infinity.");
    return Number.isInteger(value) ? { kind: "INTEGER", value } : { kind: "REAL", value };
  }
  throw new Error(`Unsupported database parameter type: ${typeof value}`);
}

function prepareStatements(statements: AtomicSqlStatement[]) {
  return statements.map((statement) => ({
    sql: statement.sql,
    params: (statement.params || []).map(toDbParam),
  }));
}

export async function runAtomicTransaction(statements: AtomicSqlStatement[]) {
  if (!statements.length) throw new Error("No database statements were supplied.");
  return invoke<{ statementsExecuted: number; rowsAffected: number }>("execute_atomic_transaction", {
    statements: prepareStatements(statements),
  });
}

export function initializeDatabaseSafety() {
  if (!initializationPromise) {
    initializationPromise = invoke<DatabaseSafetyReport>("initialize_database_safety").catch((error) => {
      initializationPromise = null;
      throw error;
    });
  }
  return initializationPromise;
}

export async function ensurePaymentDocumentUniqueness() {
  return invoke<DatabaseSafetyReport>("ensure_payment_document_uniqueness");
}

export async function createDatabaseBackup(label = "manual") {
  return invoke<string | null>("create_database_backup", { label });
}
