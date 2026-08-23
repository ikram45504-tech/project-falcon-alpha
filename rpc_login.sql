CREATE OR REPLACE FUNCTION get_user_email(p_company_code TEXT, p_username TEXT)
RETURNS TEXT AS $$
DECLARE
  v_email TEXT;
BEGIN
  SELECT u.email INTO v_email
  FROM users u
  JOIN companies c ON u.company_id = c.id
  WHERE c.company_code = p_company_code AND u.username = p_username
  LIMIT 1;
  
  RETURN v_email;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
