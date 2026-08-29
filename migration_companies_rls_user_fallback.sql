-- Allow reading a company when the signed-in auth user belongs to it,
-- even if JWT user_metadata.company_id is not refreshed yet after signup.
DROP POLICY IF EXISTS "Allow users to view their own company" ON companies;

CREATE POLICY "Allow users to view their own company"
  ON companies FOR SELECT
  TO authenticated
  USING (
    id = (auth.jwt()->'user_metadata'->>'company_id')::text
    OR EXISTS (
      SELECT 1
      FROM users u
      WHERE u.id = auth.uid()::text
        AND u.company_id = companies.id
    )
  );

DROP POLICY IF EXISTS "Allow users to update their own company" ON companies;

CREATE POLICY "Allow users to update their own company"
  ON companies FOR UPDATE
  TO authenticated
  USING (
    id = (auth.jwt()->'user_metadata'->>'company_id')::text
    OR EXISTS (
      SELECT 1
      FROM users u
      WHERE u.id = auth.uid()::text
        AND u.company_id = companies.id
    )
  );
