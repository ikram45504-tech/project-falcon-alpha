-- Run this once in Supabase SQL Editor (fixes company load after signup + username login).

-- 1) Companies RLS: allow read when user row links to company (even if JWT metadata is stale)
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

-- 2) Login RPC: resolve auth email from company code + username OR email (case-insensitive)
CREATE OR REPLACE FUNCTION get_user_email(p_company_code TEXT, p_username TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email TEXT;
BEGIN
  SELECT u.email INTO v_email
  FROM users u
  JOIN companies c ON u.company_id = c.id
  WHERE upper(trim(c.company_code)) = upper(trim(p_company_code))
    AND (
      lower(trim(u.username)) = lower(trim(p_username))
      OR lower(trim(u.email)) = lower(trim(p_username))
    )
  LIMIT 1;

  RETURN v_email;
END;
$$;

REVOKE ALL ON FUNCTION get_user_email(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_user_email(TEXT, TEXT) TO anon, authenticated;

-- 3) Company code availability check (bypasses RLS during signup)
CREATE OR REPLACE FUNCTION is_company_code_available(p_company_code TEXT)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT NOT EXISTS (
    SELECT 1
    FROM companies
    WHERE upper(trim(company_code)) = upper(trim(p_company_code))
  );
$$;

REVOKE ALL ON FUNCTION is_company_code_available(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION is_company_code_available(TEXT) TO anon, authenticated;
