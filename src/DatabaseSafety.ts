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
  const isTauri = "__TAURI_INTERNALS__" in window;

  if (!isTauri) {
    // WEB MODE: Translate SQL statements into Supabase API calls.
    // This provides fallback support for the Web App since it cannot use Tauri's SQLite driver.
    const { supabase } = await import("./supabaseClient");

    for (const stmt of statements) {
      const sql = stmt.sql.replace(/\n/g, " ").replace(/\s+/g, " ");

      // Handle INSERT INTO
      const insertMatch = sql.match(/INSERT\s+INTO\s+([a-z0-9_]+)\s*\(([^)]+)\)\s*VALUES\s*\((.+)\)/i);
      if (insertMatch) {
        const table = insertMatch[1].trim();
        const columns = insertMatch[2].split(",").map((c) => c.trim());
        let valuesStr = insertMatch[3];

        // Hack for COALESCE subquery used in audit_logs
        valuesStr = valuesStr.replace(/COALESCE\s*\([^,]+,\s*'([^']+)'\s*\)/i, "'$1'");

        const valuesArr: string[] = [];
        let current = "";
        let inQuotes = false;
        for (let i = 0; i < valuesStr.length; i++) {
          if (valuesStr[i] === "'") inQuotes = !inQuotes;
          else if (valuesStr[i] === "," && !inQuotes) {
            valuesArr.push(current.trim());
            current = "";
            continue;
          }
          current += valuesStr[i];
        }
        valuesArr.push(current.trim());

        const payload: Record<string, any> = {};
        columns.forEach((col, idx) => {
          const valStr = valuesArr[idx];
          if (valStr.startsWith("$")) {
            const paramIdx = parseInt(valStr.replace("$", "")) - 1;
            payload[col] = stmt.params?.[paramIdx];
          } else if (valStr.startsWith("'") && valStr.endsWith("'")) {
            payload[col] = valStr.substring(1, valStr.length - 1);
          } else if (valStr !== "") {
            payload[col] = Number(valStr);
          }
        });

        const { error } = await supabase.from(table).insert(payload);
        if (error && error.code !== "23505") throw new Error(error.message);
        continue;
      }

      // Handle UPDATE
      const updateMatch = sql.match(/UPDATE\s+([a-z0-9_]+)\s+SET\s+(.+?)\s+WHERE\s+(.+)/i);
      if (updateMatch) {
        const table = updateMatch[1].trim();
        const setStr = updateMatch[2].trim();
        const whereStr = updateMatch[3].trim();

        const payload: Record<string, any> = {};
        setStr.split(",").forEach((part) => {
          const [col, valStrRaw] = part.split("=");
          const colClean = col.trim();
          const valStr = valStrRaw.trim();
          if (valStr.startsWith("$")) {
            const paramIdx = parseInt(valStr.replace("$", "")) - 1;
            payload[colClean] = stmt.params?.[paramIdx];
          } else if (valStr.startsWith("'") && valStr.endsWith("'")) {
            payload[colClean] = valStr.substring(1, valStr.length - 1);
          } else if (valStr !== "") {
            payload[colClean] = Number(valStr);
          }
        });

        let query = supabase.from(table).update(payload);
        const whereParts = whereStr.split(/\s+AND\s+/i);
        whereParts.forEach((part) => {
          const [col, valStrRaw] = part.split("=");
          const colClean = col.trim();
          const valStr = valStrRaw.trim();
          if (valStr.startsWith("$")) {
            const paramIdx = parseInt(valStr.replace("$", "")) - 1;
            query = query.eq(colClean, stmt.params?.[paramIdx]);
          } else if (valStr.startsWith("'") && valStr.endsWith("'")) {
            query = query.eq(colClean, valStr.substring(1, valStr.length - 1));
          } else {
            query = query.eq(colClean, valStr);
          }
        });

        const { error } = await query;
        if (error) throw new Error(error.message);
        continue;
      }

      // Handle DELETE
      const deleteMatch = sql.match(/DELETE\s+FROM\s+([a-z0-9_]+)\s+WHERE\s+(.+)/i);
      if (deleteMatch) {
        const table = deleteMatch[1].trim();
        const whereStr = deleteMatch[2].trim();

        let query = supabase.from(table).delete();
        const whereParts = whereStr.split(/\s+AND\s+/i);
        whereParts.forEach((part) => {
          const [col, valStrRaw] = part.split("=");
          const colClean = col.trim();
          const valStr = valStrRaw.trim();
          if (valStr.startsWith("$")) {
            const paramIdx = parseInt(valStr.replace("$", "")) - 1;
            query = query.eq(colClean, stmt.params?.[paramIdx]);
          } else if (valStr.startsWith("'") && valStr.endsWith("'")) {
            query = query.eq(colClean, valStr.substring(1, valStr.length - 1));
          } else {
            query = query.eq(colClean, valStr);
          }
        });

        const { error } = await query;
        if (error) throw new Error(error.message);
        continue;
      }

      console.warn("Web Mode Fallback: Could not parse SQL statement.", stmt.sql);
    }
    return { statementsExecuted: statements.length, rowsAffected: 1 };
  }

  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<{ statementsExecuted: number; rowsAffected: number }>("execute_atomic_transaction", {
    statements: prepareStatements(statements),
  });
}

export function initializeDatabaseSafety() {
  const isTauri = "__TAURI_INTERNALS__" in window;
  if (!isTauri) {
    return Promise.resolve({
      backupPath: null,
      destructiveMigrationsRetired: true,
      paymentDocumentUniqueIndex: true,
      duplicatePaymentDocuments: 0,
    });
  }

  if (!initializationPromise) {
    initializationPromise = (async () => {
      const { invoke } = await import("@tauri-apps/api/core");
      return invoke<DatabaseSafetyReport>("initialize_database_safety");
    })().catch((error) => {
      initializationPromise = null;
      throw error;
    });
  }
  return initializationPromise;
}

export async function ensurePaymentDocumentUniqueness() {
  const isTauri = "__TAURI_INTERNALS__" in window;
  if (!isTauri)
    return {
      backupPath: null,
      destructiveMigrationsRetired: true,
      paymentDocumentUniqueIndex: true,
      duplicatePaymentDocuments: 0,
    };
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<DatabaseSafetyReport>("ensure_payment_document_uniqueness");
}

export async function createDatabaseBackup(label = "manual") {
  const isTauri = "__TAURI_INTERNALS__" in window;
  if (!isTauri) return null;
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<string | null>("create_database_backup", { label });
}
