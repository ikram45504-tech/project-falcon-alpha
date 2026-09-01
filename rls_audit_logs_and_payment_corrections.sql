-- Enable company-scoped RLS on audit_logs (was exposed without RLS)
-- and add missing policies on payment_corrections (RLS on but blocked all access).
-- JWT claim: auth.jwt()->'user_metadata'->>'company_id'

ALTER TABLE IF EXISTS audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "company audit_logs select" ON audit_logs;
DROP POLICY IF EXISTS "company audit_logs insert" ON audit_logs;
DROP POLICY IF EXISTS "company audit_logs update" ON audit_logs;

CREATE POLICY "company audit_logs select" ON audit_logs FOR SELECT TO authenticated
  USING (company_id = (auth.jwt()->'user_metadata'->>'company_id'));
CREATE POLICY "company audit_logs insert" ON audit_logs FOR INSERT TO authenticated
  WITH CHECK (company_id = (auth.jwt()->'user_metadata'->>'company_id'));
CREATE POLICY "company audit_logs update" ON audit_logs FOR UPDATE TO authenticated
  USING (company_id = (auth.jwt()->'user_metadata'->>'company_id'));

-- Payment corrections (web + desktop sync)
DROP POLICY IF EXISTS "company payment_corrections select" ON payment_corrections;
DROP POLICY IF EXISTS "company payment_corrections insert" ON payment_corrections;
DROP POLICY IF EXISTS "company payment_corrections update" ON payment_corrections;
DROP POLICY IF EXISTS "company payment_corrections delete" ON payment_corrections;

CREATE POLICY "company payment_corrections select" ON payment_corrections FOR SELECT TO authenticated
  USING (company_id = (auth.jwt()->'user_metadata'->>'company_id'));
CREATE POLICY "company payment_corrections insert" ON payment_corrections FOR INSERT TO authenticated
  WITH CHECK (company_id = (auth.jwt()->'user_metadata'->>'company_id'));
CREATE POLICY "company payment_corrections update" ON payment_corrections FOR UPDATE TO authenticated
  USING (company_id = (auth.jwt()->'user_metadata'->>'company_id'));
CREATE POLICY "company payment_corrections delete" ON payment_corrections FOR DELETE TO authenticated
  USING (company_id = (auth.jwt()->'user_metadata'->>'company_id'));
