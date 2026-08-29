-- Company code availability check (bypasses RLS during signup).
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
