-- Allow the same display name for a Party and a Vendor in one company.
-- Uniqueness is per account_type (PARTY / VENDOR / UNASSIGNED), not across all types.
-- Run in Supabase SQL Editor.

-- Drop old company-wide unique name constraints/indexes if they exist.
DROP INDEX IF EXISTS parties_company_id_name_key;
DROP INDEX IF EXISTS idx_parties_company_name_unique;
ALTER TABLE parties DROP CONSTRAINT IF EXISTS parties_company_id_name_key;
ALTER TABLE parties DROP CONSTRAINT IF EXISTS parties_name_company_unique;

-- Preferred unique rule: one name per company + account_type
CREATE UNIQUE INDEX IF NOT EXISTS idx_parties_company_type_name_unique
  ON parties (company_id, account_type, lower(name));
