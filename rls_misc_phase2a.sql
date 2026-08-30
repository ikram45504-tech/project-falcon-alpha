-- Misc Phase-2A RLS: commercial misc tables + operational details
-- Mirrors hotel/visa company_id JWT policies

ALTER TABLE IF EXISTS misc_bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS misc_booking_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS misc_commercial_family_refs ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS misc_operational_meta ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS misc_operational_services ENABLE ROW LEVEL SECURITY;

-- misc_bookings
DROP POLICY IF EXISTS "company misc_bookings select" ON misc_bookings;
DROP POLICY IF EXISTS "company misc_bookings insert" ON misc_bookings;
DROP POLICY IF EXISTS "company misc_bookings update" ON misc_bookings;
DROP POLICY IF EXISTS "company misc_bookings delete" ON misc_bookings;

CREATE POLICY "company misc_bookings select" ON misc_bookings FOR SELECT TO authenticated
  USING (company_id = (auth.jwt()->'user_metadata'->>'company_id'));
CREATE POLICY "company misc_bookings insert" ON misc_bookings FOR INSERT TO authenticated
  WITH CHECK (company_id = (auth.jwt()->'user_metadata'->>'company_id'));
CREATE POLICY "company misc_bookings update" ON misc_bookings FOR UPDATE TO authenticated
  USING (company_id = (auth.jwt()->'user_metadata'->>'company_id'));
CREATE POLICY "company misc_bookings delete" ON misc_bookings FOR DELETE TO authenticated
  USING (company_id = (auth.jwt()->'user_metadata'->>'company_id'));

-- misc_booking_lines (via parent booking)
DROP POLICY IF EXISTS "company misc_booking_lines select" ON misc_booking_lines;
DROP POLICY IF EXISTS "company misc_booking_lines insert" ON misc_booking_lines;
DROP POLICY IF EXISTS "company misc_booking_lines update" ON misc_booking_lines;
DROP POLICY IF EXISTS "company misc_booking_lines delete" ON misc_booking_lines;

CREATE POLICY "company misc_booking_lines select" ON misc_booking_lines FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM misc_bookings b
    WHERE b.id = misc_booking_lines.booking_id
      AND b.company_id = (auth.jwt()->'user_metadata'->>'company_id')
  ));
CREATE POLICY "company misc_booking_lines insert" ON misc_booking_lines FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM misc_bookings b
    WHERE b.id = misc_booking_lines.booking_id
      AND b.company_id = (auth.jwt()->'user_metadata'->>'company_id')
  ));
CREATE POLICY "company misc_booking_lines update" ON misc_booking_lines FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM misc_bookings b
    WHERE b.id = misc_booking_lines.booking_id
      AND b.company_id = (auth.jwt()->'user_metadata'->>'company_id')
  ));
CREATE POLICY "company misc_booking_lines delete" ON misc_booking_lines FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM misc_bookings b
    WHERE b.id = misc_booking_lines.booking_id
      AND b.company_id = (auth.jwt()->'user_metadata'->>'company_id')
  ));

-- misc_commercial_family_refs
DROP POLICY IF EXISTS "company misc_commercial_family_refs select" ON misc_commercial_family_refs;
DROP POLICY IF EXISTS "company misc_commercial_family_refs insert" ON misc_commercial_family_refs;
DROP POLICY IF EXISTS "company misc_commercial_family_refs update" ON misc_commercial_family_refs;
DROP POLICY IF EXISTS "company misc_commercial_family_refs delete" ON misc_commercial_family_refs;

CREATE POLICY "company misc_commercial_family_refs select" ON misc_commercial_family_refs FOR SELECT TO authenticated
  USING (company_id = (auth.jwt()->'user_metadata'->>'company_id'));
CREATE POLICY "company misc_commercial_family_refs insert" ON misc_commercial_family_refs FOR INSERT TO authenticated
  WITH CHECK (company_id = (auth.jwt()->'user_metadata'->>'company_id'));
CREATE POLICY "company misc_commercial_family_refs update" ON misc_commercial_family_refs FOR UPDATE TO authenticated
  USING (company_id = (auth.jwt()->'user_metadata'->>'company_id'));
CREATE POLICY "company misc_commercial_family_refs delete" ON misc_commercial_family_refs FOR DELETE TO authenticated
  USING (company_id = (auth.jwt()->'user_metadata'->>'company_id'));

-- misc_operational_meta
DROP POLICY IF EXISTS "company misc_operational_meta select" ON misc_operational_meta;
DROP POLICY IF EXISTS "company misc_operational_meta insert" ON misc_operational_meta;
DROP POLICY IF EXISTS "company misc_operational_meta update" ON misc_operational_meta;
DROP POLICY IF EXISTS "company misc_operational_meta delete" ON misc_operational_meta;

CREATE POLICY "company misc_operational_meta select" ON misc_operational_meta FOR SELECT TO authenticated
  USING (company_id = (auth.jwt()->'user_metadata'->>'company_id'));
CREATE POLICY "company misc_operational_meta insert" ON misc_operational_meta FOR INSERT TO authenticated
  WITH CHECK (company_id = (auth.jwt()->'user_metadata'->>'company_id'));
CREATE POLICY "company misc_operational_meta update" ON misc_operational_meta FOR UPDATE TO authenticated
  USING (company_id = (auth.jwt()->'user_metadata'->>'company_id'));
CREATE POLICY "company misc_operational_meta delete" ON misc_operational_meta FOR DELETE TO authenticated
  USING (company_id = (auth.jwt()->'user_metadata'->>'company_id'));

-- misc_operational_services
DROP POLICY IF EXISTS "company misc_operational_services select" ON misc_operational_services;
DROP POLICY IF EXISTS "company misc_operational_services insert" ON misc_operational_services;
DROP POLICY IF EXISTS "company misc_operational_services update" ON misc_operational_services;
DROP POLICY IF EXISTS "company misc_operational_services delete" ON misc_operational_services;

CREATE POLICY "company misc_operational_services select" ON misc_operational_services FOR SELECT TO authenticated
  USING (company_id = (auth.jwt()->'user_metadata'->>'company_id'));
CREATE POLICY "company misc_operational_services insert" ON misc_operational_services FOR INSERT TO authenticated
  WITH CHECK (company_id = (auth.jwt()->'user_metadata'->>'company_id'));
CREATE POLICY "company misc_operational_services update" ON misc_operational_services FOR UPDATE TO authenticated
  USING (company_id = (auth.jwt()->'user_metadata'->>'company_id'));
CREATE POLICY "company misc_operational_services delete" ON misc_operational_services FOR DELETE TO authenticated
  USING (company_id = (auth.jwt()->'user_metadata'->>'company_id'));
