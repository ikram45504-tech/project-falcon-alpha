-- Split single parties table into parties (customers), vendors (suppliers), unassigned_accounts.
-- Run in Supabase SQL editor. Safe to re-run (uses ON CONFLICT DO NOTHING).

CREATE TABLE IF NOT EXISTS vendors (
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
);

CREATE TABLE IF NOT EXISTS unassigned_accounts (
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
);

CREATE INDEX IF NOT EXISTS idx_vendors_company_name ON vendors(company_id, name);
CREATE INDEX IF NOT EXISTS idx_unassigned_accounts_company_name ON unassigned_accounts(company_id, name);

-- Migrate existing rows (same UUIDs — booking counterparty_id stays valid)
INSERT INTO vendors (
  id, company_id, name, phone, whatsapp, address, notes, status,
  created_at, updated_at, created_by_user_id, updated_by_user_id
)
SELECT
  id, company_id, name, phone, whatsapp, address, notes, status,
  created_at, updated_at,
  COALESCE(created_by_user_id, ''),
  COALESCE(updated_by_user_id, '')
FROM parties
WHERE account_type = 'VENDOR'
ON CONFLICT (id) DO NOTHING;

INSERT INTO unassigned_accounts (
  id, company_id, name, phone, whatsapp, address, notes, status,
  created_at, updated_at, created_by_user_id, updated_by_user_id
)
SELECT
  id, company_id, name, phone, whatsapp, address, notes, status,
  created_at, updated_at,
  COALESCE(created_by_user_id, ''),
  COALESCE(updated_by_user_id, '')
FROM parties
WHERE account_type = 'UNASSIGNED'
ON CONFLICT (id) DO NOTHING;

DELETE FROM parties WHERE account_type IN ('VENDOR', 'UNASSIGNED');

CREATE UNIQUE INDEX IF NOT EXISTS parties_name_unique
  ON parties (company_id, lower(name));
CREATE UNIQUE INDEX IF NOT EXISTS vendors_name_unique
  ON vendors (company_id, lower(name));
CREATE UNIQUE INDEX IF NOT EXISTS unassigned_accounts_name_unique
  ON unassigned_accounts (company_id, lower(name));
