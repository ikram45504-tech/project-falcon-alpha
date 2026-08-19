use serde::{Deserialize, Serialize};
use sqlx::sqlite::SqliteConnectOptions;
use sqlx::{Connection, SqliteConnection};
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};

const DATABASE_FILE: &str = "travel-accounting.db";
const SAFETY_MIGRATION: &str = "database_safety_pack_v1";
const RETIRED_DESTRUCTIVE_MIGRATIONS: [&str; 4] = [
    "phase_7b_clean_test_accounting_data_v1",
    "phase_8_company_scoped_auth_reset_v1",
    "phase_8c_final_fresh_company_start_v1",
    "phase_8d_consolidated_account_fresh_start_v1",
];

// Keep safety SQL as raw multiline strings. Rust's escaped-newline string syntax removes
// both the newline and following indentation, which can accidentally join SQL tokens
// (for example `payment_entriesWHERE`). These constants are also covered by a regression test.
const DUPLICATE_PAYMENT_DOCUMENTS_SQL: &str = r#"
SELECT COUNT(*)
FROM (
  SELECT company_id, UPPER(TRIM(receipt_no)) AS document_no
  FROM payment_entries
  WHERE TRIM(receipt_no) <> ''
  GROUP BY company_id, UPPER(TRIM(receipt_no))
  HAVING COUNT(*) > 1
)
"#;

const CREATE_PAYMENT_DOCUMENT_LOOKUP_INDEX_SQL: &str = r#"
CREATE INDEX IF NOT EXISTS idx_payment_receipt_company_number
ON payment_entries(company_id, receipt_no COLLATE NOCASE)
"#;

const CREATE_PAYMENT_DOCUMENT_UNIQUE_INDEX_SQL: &str = r#"
CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_receipt_company_number
ON payment_entries(company_id, receipt_no COLLATE NOCASE)
WHERE TRIM(receipt_no) <> ''
"#;

const CREATE_APP_MIGRATIONS_SQL: &str = r#"
CREATE TABLE IF NOT EXISTS app_migrations (
  migration_key TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL
)
"#;

#[derive(Debug, Deserialize)]
#[serde(tag = "kind", content = "value", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum DbParam {
    Null,
    Text(String),
    Integer(i64),
    Real(f64),
    Bool(bool),
}

#[derive(Debug, Deserialize)]
pub struct DbStatement {
    pub sql: String,
    #[serde(default)]
    pub params: Vec<DbParam>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AtomicExecutionResult {
    pub statements_executed: usize,
    pub rows_affected: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseSafetyReport {
    pub backup_path: Option<String>,
    pub destructive_migrations_retired: bool,
    pub payment_document_unique_index: bool,
    pub duplicate_payment_documents: i64,
}

fn app_database_path(app: &AppHandle) -> Result<PathBuf, String> {
    let directory = app
        .path()
        .app_config_dir()
        .map_err(|error| format!("Could not resolve the app database directory: {error}"))?;
    std::fs::create_dir_all(&directory)
        .map_err(|error| format!("Could not create the app database directory: {error}"))?;
    Ok(directory.join(DATABASE_FILE))
}

fn connection_options(path: &Path) -> SqliteConnectOptions {
    SqliteConnectOptions::new()
        .filename(path)
        .create_if_missing(true)
        .busy_timeout(Duration::from_secs(5))
        .foreign_keys(true)
}

async fn open_connection(app: &AppHandle) -> Result<SqliteConnection, String> {
    let path = app_database_path(app)?;
    let mut connection = SqliteConnection::connect_with(&connection_options(&path))
        .await
        .map_err(|error| format!("Could not open the accounting database: {error}"))?;
    sqlx::query("PRAGMA busy_timeout = 5000")
        .execute(&mut connection)
        .await
        .map_err(|error| format!("Could not configure SQLite busy timeout: {error}"))?;
    Ok(connection)
}

fn backup_name(label: &str) -> String {
    let clean: String = label
        .chars()
        .map(|ch| if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' { ch } else { '-' })
        .collect();
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    format!("travel-accounting-{}-{}.db", clean.trim_matches('-'), stamp)
}

async fn vacuum_backup(
    connection: &mut SqliteConnection,
    source_path: &Path,
    label: &str,
) -> Result<Option<String>, String> {
    if !source_path.exists() {
        return Ok(None);
    }
    let metadata = std::fs::metadata(source_path)
        .map_err(|error| format!("Could not inspect the accounting database before backup: {error}"))?;
    if metadata.len() == 0 {
        return Ok(None);
    }

    let parent = source_path
        .parent()
        .ok_or_else(|| "Could not resolve the database backup directory.".to_string())?;
    let backup_dir = parent.join("backups");
    std::fs::create_dir_all(&backup_dir)
        .map_err(|error| format!("Could not create the database backup directory: {error}"))?;
    let backup_path = backup_dir.join(backup_name(label));
    let escaped = backup_path.to_string_lossy().replace('\'', "''");
    sqlx::query(&format!("VACUUM INTO '{escaped}'"))
        .execute(&mut *connection)
        .await
        .map_err(|error| format!("Could not create a safety backup: {error}"))?;
    Ok(Some(backup_path.to_string_lossy().to_string()))
}

async fn table_exists(connection: &mut SqliteConnection, table: &str) -> Result<bool, String> {
    let count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=?1",
    )
    .bind(table)
    .fetch_one(&mut *connection)
    .await
    .map_err(|error| format!("Could not inspect SQLite schema: {error}"))?;
    Ok(count > 0)
}

async fn enforce_payment_document_uniqueness_inner(
    connection: &mut SqliteConnection,
) -> Result<(bool, i64), String> {
    if !table_exists(connection, "payment_entries").await? {
        return Ok((false, 0));
    }

    let duplicate_groups: i64 = sqlx::query_scalar(DUPLICATE_PAYMENT_DOCUMENTS_SQL)
        .fetch_one(&mut *connection)
        .await
        .map_err(|error| format!("Could not validate payment document numbers: {error}"))?;

    sqlx::query("DROP INDEX IF EXISTS idx_payment_receipt_company_number")
        .execute(&mut *connection)
        .await
        .map_err(|error| format!("Could not refresh the payment document index: {error}"))?;

    if duplicate_groups > 0 {
        sqlx::query(CREATE_PAYMENT_DOCUMENT_LOOKUP_INDEX_SQL)
            .execute(&mut *connection)
            .await
            .map_err(|error| format!("Could not restore the payment document lookup index: {error}"))?;
        return Ok((false, duplicate_groups));
    }

    sqlx::query(CREATE_PAYMENT_DOCUMENT_UNIQUE_INDEX_SQL)
        .execute(&mut *connection)
        .await
        .map_err(|error| format!("Could not protect payment document numbers: {error}"))?;
    Ok((true, 0))
}

async fn execute_one(
    connection: &mut SqliteConnection,
    statement: DbStatement,
) -> Result<u64, String> {
    let sql = statement.sql.trim();
    if sql.is_empty() {
        return Err("An empty SQL statement was supplied to the atomic writer.".to_string());
    }

    let mut query = sqlx::query(sql);
    for param in statement.params {
        query = match param {
            DbParam::Null => query.bind(Option::<String>::None),
            DbParam::Text(value) => query.bind(value),
            DbParam::Integer(value) => query.bind(value),
            DbParam::Real(value) => query.bind(value),
            DbParam::Bool(value) => query.bind(if value { 1_i64 } else { 0_i64 }),
        };
    }

    query
        .execute(&mut *connection)
        .await
        .map(|result| result.rows_affected())
        .map_err(|error| format!("Atomic database write failed: {error}"))
}

#[tauri::command]
pub async fn execute_atomic_transaction(
    app: AppHandle,
    statements: Vec<DbStatement>,
) -> Result<AtomicExecutionResult, String> {
    if statements.is_empty() {
        return Err("No database statements were supplied.".to_string());
    }

    let statement_count = statements.len();
    let mut connection = open_connection(&app).await?;
    sqlx::query("BEGIN IMMEDIATE")
        .execute(&mut connection)
        .await
        .map_err(|error| format!("Could not begin atomic database transaction: {error}"))?;

    let mut rows_affected = 0_u64;
    for statement in statements {
        match execute_one(&mut connection, statement).await {
            Ok(rows) => rows_affected += rows,
            Err(error) => {
                let _ = sqlx::query("ROLLBACK").execute(&mut connection).await;
                return Err(error);
            }
        }
    }

    sqlx::query("COMMIT")
        .execute(&mut connection)
        .await
        .map_err(|error| format!("Could not commit atomic database transaction: {error}"))?;

    Ok(AtomicExecutionResult {
        statements_executed: statement_count,
        rows_affected,
    })
}

#[tauri::command]
pub async fn ensure_payment_document_uniqueness(
    app: AppHandle,
) -> Result<DatabaseSafetyReport, String> {
    let mut connection = open_connection(&app).await?;
    let (unique, duplicate_groups) = enforce_payment_document_uniqueness_inner(&mut connection).await?;
    Ok(DatabaseSafetyReport {
        backup_path: None,
        destructive_migrations_retired: true,
        payment_document_unique_index: unique,
        duplicate_payment_documents: duplicate_groups,
    })
}

#[tauri::command]
pub async fn create_database_backup(
    app: AppHandle,
    label: String,
) -> Result<Option<String>, String> {
    let path = app_database_path(&app)?;
    let mut connection = open_connection(&app).await?;
    vacuum_backup(
        &mut connection,
        &path,
        if label.trim().is_empty() { "manual" } else { &label },
    )
    .await
}

#[tauri::command]
pub async fn initialize_database_safety(
    app: AppHandle,
) -> Result<DatabaseSafetyReport, String> {
    let path = app_database_path(&app)?;
    let existed_before = path.exists()
        && std::fs::metadata(&path)
            .map(|meta| meta.len() > 0)
            .unwrap_or(false);
    let mut connection = open_connection(&app).await?;

    sqlx::query(CREATE_APP_MIGRATIONS_SQL)
        .execute(&mut connection)
        .await
        .map_err(|error| format!("Could not prepare database safety markers: {error}"))?;

    let already_applied: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM app_migrations WHERE migration_key=?1",
    )
    .bind(SAFETY_MIGRATION)
    .fetch_one(&mut connection)
    .await
    .map_err(|error| format!("Could not inspect database safety state: {error}"))?;

    let backup_path = if already_applied == 0 && existed_before {
        vacuum_backup(&mut connection, &path, "pre-safety-pack").await?
    } else {
        None
    };

    sqlx::query("BEGIN IMMEDIATE")
        .execute(&mut connection)
        .await
        .map_err(|error| format!("Could not begin database safety migration: {error}"))?;

    let applied_at = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
        .to_string();

    for migration in RETIRED_DESTRUCTIVE_MIGRATIONS {
        if let Err(error) = sqlx::query(
            "INSERT OR IGNORE INTO app_migrations (migration_key, applied_at) VALUES (?1, ?2)",
        )
        .bind(migration)
        .bind(&applied_at)
        .execute(&mut connection)
        .await
        {
            let _ = sqlx::query("ROLLBACK").execute(&mut connection).await;
            return Err(format!("Could not retire an old destructive migration: {error}"));
        }
    }

    if let Err(error) = sqlx::query(
        "INSERT OR IGNORE INTO app_migrations (migration_key, applied_at) VALUES (?1, ?2)",
    )
    .bind(SAFETY_MIGRATION)
    .bind(&applied_at)
    .execute(&mut connection)
    .await
    {
        let _ = sqlx::query("ROLLBACK").execute(&mut connection).await;
        return Err(format!("Could not record database safety migration: {error}"));
    }

    sqlx::query("COMMIT")
        .execute(&mut connection)
        .await
        .map_err(|error| format!("Could not commit database safety migration: {error}"))?;

    let (unique, duplicate_groups) = enforce_payment_document_uniqueness_inner(&mut connection).await?;

    Ok(DatabaseSafetyReport {
        backup_path,
        destructive_migrations_retired: true,
        payment_document_unique_index: unique,
        duplicate_payment_documents: duplicate_groups,
    })
}

#[cfg(test)]
mod tests {
    use super::{
        CREATE_APP_MIGRATIONS_SQL, CREATE_PAYMENT_DOCUMENT_LOOKUP_INDEX_SQL,
        CREATE_PAYMENT_DOCUMENT_UNIQUE_INDEX_SQL, DUPLICATE_PAYMENT_DOCUMENTS_SQL,
    };

    #[test]
    fn safety_sql_keeps_required_token_boundaries() {
        assert!(DUPLICATE_PAYMENT_DOCUMENTS_SQL.contains("FROM payment_entries\n"));
        assert!(DUPLICATE_PAYMENT_DOCUMENTS_SQL.contains("WHERE TRIM(receipt_no)"));
        assert!(!DUPLICATE_PAYMENT_DOCUMENTS_SQL.contains("payment_entriesWHERE"));

        assert!(CREATE_PAYMENT_DOCUMENT_LOOKUP_INDEX_SQL.contains("\nON payment_entries"));
        assert!(CREATE_PAYMENT_DOCUMENT_UNIQUE_INDEX_SQL.contains("\nWHERE TRIM(receipt_no)"));
        assert!(CREATE_APP_MIGRATIONS_SQL.contains("app_migrations (\n"));
    }
}
