-- Transport Phase-2A RLS: commercial transport tables + operational details
-- Mirrors hotel/visa company_id JWT policies

ALTER TABLE IF EXISTS transport_bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS transport_booking_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS transport_operational_meta ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS transport_operational_sectors ENABLE ROW LEVEL SECURITY;

-- transport_bookings
DROP POLICY IF EXISTS "company transport_bookings select" ON transport_bookings;
DROP POLICY IF EXISTS "company transport_bookings insert" ON transport_bookings;
DROP POLICY IF EXISTS "company transport_bookings update" ON transport_bookings;
DROP POLICY IF EXISTS "company transport_bookings delete" ON transport_bookings;

CREATE POLICY "company transport_bookings select" ON transport_bookings FOR SELECT TO authenticated
  USING (company_id = (auth.jwt()->'user_metadata'->>'company_id'));
CREATE POLICY "company transport_bookings insert" ON transport_bookings FOR INSERT TO authenticated
  WITH CHECK (company_id = (auth.jwt()->'user_metadata'->>'company_id'));
CREATE POLICY "company transport_bookings update" ON transport_bookings FOR UPDATE TO authenticated
  USING (company_id = (auth.jwt()->'user_metadata'->>'company_id'));
CREATE POLICY "company transport_bookings delete" ON transport_bookings FOR DELETE TO authenticated
  USING (company_id = (auth.jwt()->'user_metadata'->>'company_id'));

-- transport_booking_lines (via parent booking)
DROP POLICY IF EXISTS "company transport_booking_lines select" ON transport_booking_lines;
DROP POLICY IF EXISTS "company transport_booking_lines insert" ON transport_booking_lines;
DROP POLICY IF EXISTS "company transport_booking_lines update" ON transport_booking_lines;
DROP POLICY IF EXISTS "company transport_booking_lines delete" ON transport_booking_lines;

CREATE POLICY "company transport_booking_lines select" ON transport_booking_lines FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM transport_bookings b
    WHERE b.id = transport_booking_lines.booking_id
      AND b.company_id = (auth.jwt()->'user_metadata'->>'company_id')
  ));
CREATE POLICY "company transport_booking_lines insert" ON transport_booking_lines FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM transport_bookings b
    WHERE b.id = transport_booking_lines.booking_id
      AND b.company_id = (auth.jwt()->'user_metadata'->>'company_id')
  ));
CREATE POLICY "company transport_booking_lines update" ON transport_booking_lines FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM transport_bookings b
    WHERE b.id = transport_booking_lines.booking_id
      AND b.company_id = (auth.jwt()->'user_metadata'->>'company_id')
  ));
CREATE POLICY "company transport_booking_lines delete" ON transport_booking_lines FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM transport_bookings b
    WHERE b.id = transport_booking_lines.booking_id
      AND b.company_id = (auth.jwt()->'user_metadata'->>'company_id')
  ));

-- transport_operational_meta
DROP POLICY IF EXISTS "company transport_operational_meta select" ON transport_operational_meta;
DROP POLICY IF EXISTS "company transport_operational_meta insert" ON transport_operational_meta;
DROP POLICY IF EXISTS "company transport_operational_meta update" ON transport_operational_meta;
DROP POLICY IF EXISTS "company transport_operational_meta delete" ON transport_operational_meta;

CREATE POLICY "company transport_operational_meta select" ON transport_operational_meta FOR SELECT TO authenticated
  USING (company_id = (auth.jwt()->'user_metadata'->>'company_id'));
CREATE POLICY "company transport_operational_meta insert" ON transport_operational_meta FOR INSERT TO authenticated
  WITH CHECK (company_id = (auth.jwt()->'user_metadata'->>'company_id'));
CREATE POLICY "company transport_operational_meta update" ON transport_operational_meta FOR UPDATE TO authenticated
  USING (company_id = (auth.jwt()->'user_metadata'->>'company_id'));
CREATE POLICY "company transport_operational_meta delete" ON transport_operational_meta FOR DELETE TO authenticated
  USING (company_id = (auth.jwt()->'user_metadata'->>'company_id'));

-- transport_operational_sectors (via parent booking)
DROP POLICY IF EXISTS "company transport_operational_sectors select" ON transport_operational_sectors;
DROP POLICY IF EXISTS "company transport_operational_sectors insert" ON transport_operational_sectors;
DROP POLICY IF EXISTS "company transport_operational_sectors update" ON transport_operational_sectors;
DROP POLICY IF EXISTS "company transport_operational_sectors delete" ON transport_operational_sectors;

CREATE POLICY "company transport_operational_sectors select" ON transport_operational_sectors FOR SELECT TO authenticated
  USING (company_id = (auth.jwt()->'user_metadata'->>'company_id'));
CREATE POLICY "company transport_operational_sectors insert" ON transport_operational_sectors FOR INSERT TO authenticated
  WITH CHECK (company_id = (auth.jwt()->'user_metadata'->>'company_id'));
CREATE POLICY "company transport_operational_sectors update" ON transport_operational_sectors FOR UPDATE TO authenticated
  USING (company_id = (auth.jwt()->'user_metadata'->>'company_id'));
CREATE POLICY "company transport_operational_sectors delete" ON transport_operational_sectors FOR DELETE TO authenticated
  USING (company_id = (auth.jwt()->'user_metadata'->>'company_id'));
