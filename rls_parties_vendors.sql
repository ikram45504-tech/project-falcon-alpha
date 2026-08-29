-- RLS for vendors and unassigned_accounts (parties already covered in rls_sync_phase1.sql)

ALTER TABLE IF EXISTS vendors ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS unassigned_accounts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "company vendors select" ON vendors;
DROP POLICY IF EXISTS "company vendors insert" ON vendors;
DROP POLICY IF EXISTS "company vendors update" ON vendors;
DROP POLICY IF EXISTS "company vendors delete" ON vendors;

CREATE POLICY "company vendors select" ON vendors FOR SELECT TO authenticated
  USING (company_id = (auth.jwt()->'user_metadata'->>'company_id'));
CREATE POLICY "company vendors insert" ON vendors FOR INSERT TO authenticated
  WITH CHECK (company_id = (auth.jwt()->'user_metadata'->>'company_id'));
CREATE POLICY "company vendors update" ON vendors FOR UPDATE TO authenticated
  USING (company_id = (auth.jwt()->'user_metadata'->>'company_id'));
CREATE POLICY "company vendors delete" ON vendors FOR DELETE TO authenticated
  USING (company_id = (auth.jwt()->'user_metadata'->>'company_id'));

DROP POLICY IF EXISTS "company unassigned_accounts select" ON unassigned_accounts;
DROP POLICY IF EXISTS "company unassigned_accounts insert" ON unassigned_accounts;
DROP POLICY IF EXISTS "company unassigned_accounts update" ON unassigned_accounts;
DROP POLICY IF EXISTS "company unassigned_accounts delete" ON unassigned_accounts;

CREATE POLICY "company unassigned_accounts select" ON unassigned_accounts FOR SELECT TO authenticated
  USING (company_id = (auth.jwt()->'user_metadata'->>'company_id'));
CREATE POLICY "company unassigned_accounts insert" ON unassigned_accounts FOR INSERT TO authenticated
  WITH CHECK (company_id = (auth.jwt()->'user_metadata'->>'company_id'));
CREATE POLICY "company unassigned_accounts update" ON unassigned_accounts FOR UPDATE TO authenticated
  USING (company_id = (auth.jwt()->'user_metadata'->>'company_id'));
CREATE POLICY "company unassigned_accounts delete" ON unassigned_accounts FOR DELETE TO authenticated
  USING (company_id = (auth.jwt()->'user_metadata'->>'company_id'));
