-- Resolve auth email from company code + username OR email (case-insensitive).
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
