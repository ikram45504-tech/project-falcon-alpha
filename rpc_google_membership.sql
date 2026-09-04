CREATE OR REPLACE FUNCTION get_company_member_for_email(p_company_code TEXT)
RETURNS TABLE (
  company_id TEXT,
  company_code TEXT,
  company_name TEXT,
  role TEXT,
  full_name TEXT,
  username TEXT,
  phone TEXT,
  status TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  v_email := lower(trim(coalesce(auth.jwt() ->> 'email', '')));
  IF v_email = '' THEN
    RAISE EXCEPTION 'Signed-in account has no email.';
  END IF;

  RETURN QUERY
  SELECT
    c.id,
    c.company_code,
    c.name,
    u.role,
    u.full_name,
    u.username,
    u.phone,
    u.status
  FROM users u
  JOIN companies c ON u.company_id = c.id
  WHERE upper(trim(c.company_code)) = upper(trim(p_company_code))
    AND lower(trim(u.email)) = v_email
  LIMIT 1;
END;
$$;

REVOKE ALL ON FUNCTION get_company_member_for_email(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION get_company_member_for_email(TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION get_company_member_for_email(TEXT) TO authenticated;
