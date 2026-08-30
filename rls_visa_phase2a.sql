-- Visa Phase-2A RLS: commercial visa tables + operational details
-- Mirrors hotel/ticket company_id JWT policies

ALTER TABLE IF EXISTS visa_bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS visa_booking_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS visa_transport_fleet ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS visa_passport_details ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS visa_operational_meta ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS visa_operational_passengers ENABLE ROW LEVEL SECURITY;

-- visa_bookings
DROP POLICY IF EXISTS "company visa_bookings select" ON visa_bookings;
DROP POLICY IF EXISTS "company visa_bookings insert" ON visa_bookings;
DROP POLICY IF EXISTS "company visa_bookings update" ON visa_bookings;
DROP POLICY IF EXISTS "company visa_bookings delete" ON visa_bookings;

CREATE POLICY "company visa_bookings select" ON visa_bookings FOR SELECT TO authenticated
  USING (company_id = (auth.jwt()->'user_metadata'->>'company_id'));
CREATE POLICY "company visa_bookings insert" ON visa_bookings FOR INSERT TO authenticated
  WITH CHECK (company_id = (auth.jwt()->'user_metadata'->>'company_id'));
CREATE POLICY "company visa_bookings update" ON visa_bookings FOR UPDATE TO authenticated
  USING (company_id = (auth.jwt()->'user_metadata'->>'company_id'));
CREATE POLICY "company visa_bookings delete" ON visa_bookings FOR DELETE TO authenticated
  USING (company_id = (auth.jwt()->'user_metadata'->>'company_id'));

-- visa_booking_lines (via parent booking)
DROP POLICY IF EXISTS "company visa_booking_lines select" ON visa_booking_lines;
DROP POLICY IF EXISTS "company visa_booking_lines insert" ON visa_booking_lines;
DROP POLICY IF EXISTS "company visa_booking_lines update" ON visa_booking_lines;
DROP POLICY IF EXISTS "company visa_booking_lines delete" ON visa_booking_lines;

CREATE POLICY "company visa_booking_lines select" ON visa_booking_lines FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM visa_bookings b
    WHERE b.id = visa_booking_lines.booking_id
      AND b.company_id = (auth.jwt()->'user_metadata'->>'company_id')
  ));
CREATE POLICY "company visa_booking_lines insert" ON visa_booking_lines FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM visa_bookings b
    WHERE b.id = visa_booking_lines.booking_id
      AND b.company_id = (auth.jwt()->'user_metadata'->>'company_id')
  ));
CREATE POLICY "company visa_booking_lines update" ON visa_booking_lines FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM visa_bookings b
    WHERE b.id = visa_booking_lines.booking_id
      AND b.company_id = (auth.jwt()->'user_metadata'->>'company_id')
  ));
CREATE POLICY "company visa_booking_lines delete" ON visa_booking_lines FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM visa_bookings b
    WHERE b.id = visa_booking_lines.booking_id
      AND b.company_id = (auth.jwt()->'user_metadata'->>'company_id')
  ));

-- visa_transport_fleet (via parent booking)
DROP POLICY IF EXISTS "company visa_transport_fleet select" ON visa_transport_fleet;
DROP POLICY IF EXISTS "company visa_transport_fleet insert" ON visa_transport_fleet;
DROP POLICY IF EXISTS "company visa_transport_fleet update" ON visa_transport_fleet;
DROP POLICY IF EXISTS "company visa_transport_fleet delete" ON visa_transport_fleet;

CREATE POLICY "company visa_transport_fleet select" ON visa_transport_fleet FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM visa_bookings b
    WHERE b.id = visa_transport_fleet.booking_id
      AND b.company_id = (auth.jwt()->'user_metadata'->>'company_id')
  ));
CREATE POLICY "company visa_transport_fleet insert" ON visa_transport_fleet FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM visa_bookings b
    WHERE b.id = visa_transport_fleet.booking_id
      AND b.company_id = (auth.jwt()->'user_metadata'->>'company_id')
  ));
CREATE POLICY "company visa_transport_fleet update" ON visa_transport_fleet FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM visa_bookings b
    WHERE b.id = visa_transport_fleet.booking_id
      AND b.company_id = (auth.jwt()->'user_metadata'->>'company_id')
  ));
CREATE POLICY "company visa_transport_fleet delete" ON visa_transport_fleet FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM visa_bookings b
    WHERE b.id = visa_transport_fleet.booking_id
      AND b.company_id = (auth.jwt()->'user_metadata'->>'company_id')
  ));

-- visa_passport_details (via parent booking)
DROP POLICY IF EXISTS "company visa_passport_details select" ON visa_passport_details;
DROP POLICY IF EXISTS "company visa_passport_details insert" ON visa_passport_details;
DROP POLICY IF EXISTS "company visa_passport_details update" ON visa_passport_details;
DROP POLICY IF EXISTS "company visa_passport_details delete" ON visa_passport_details;

CREATE POLICY "company visa_passport_details select" ON visa_passport_details FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM visa_bookings b
    WHERE b.id = visa_passport_details.booking_id
      AND b.company_id = (auth.jwt()->'user_metadata'->>'company_id')
  ));
CREATE POLICY "company visa_passport_details insert" ON visa_passport_details FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM visa_bookings b
    WHERE b.id = visa_passport_details.booking_id
      AND b.company_id = (auth.jwt()->'user_metadata'->>'company_id')
  ));
CREATE POLICY "company visa_passport_details update" ON visa_passport_details FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM visa_bookings b
    WHERE b.id = visa_passport_details.booking_id
      AND b.company_id = (auth.jwt()->'user_metadata'->>'company_id')
  ));
CREATE POLICY "company visa_passport_details delete" ON visa_passport_details FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM visa_bookings b
    WHERE b.id = visa_passport_details.booking_id
      AND b.company_id = (auth.jwt()->'user_metadata'->>'company_id')
  ));

-- visa_operational_meta
DROP POLICY IF EXISTS "company visa_operational_meta select" ON visa_operational_meta;
DROP POLICY IF EXISTS "company visa_operational_meta insert" ON visa_operational_meta;
DROP POLICY IF EXISTS "company visa_operational_meta update" ON visa_operational_meta;
DROP POLICY IF EXISTS "company visa_operational_meta delete" ON visa_operational_meta;

CREATE POLICY "company visa_operational_meta select" ON visa_operational_meta FOR SELECT TO authenticated
  USING (company_id = (auth.jwt()->'user_metadata'->>'company_id'));
CREATE POLICY "company visa_operational_meta insert" ON visa_operational_meta FOR INSERT TO authenticated
  WITH CHECK (company_id = (auth.jwt()->'user_metadata'->>'company_id'));
CREATE POLICY "company visa_operational_meta update" ON visa_operational_meta FOR UPDATE TO authenticated
  USING (company_id = (auth.jwt()->'user_metadata'->>'company_id'));
CREATE POLICY "company visa_operational_meta delete" ON visa_operational_meta FOR DELETE TO authenticated
  USING (company_id = (auth.jwt()->'user_metadata'->>'company_id'));

-- visa_operational_passengers
DROP POLICY IF EXISTS "company visa_operational_passengers select" ON visa_operational_passengers;
DROP POLICY IF EXISTS "company visa_operational_passengers insert" ON visa_operational_passengers;
DROP POLICY IF EXISTS "company visa_operational_passengers update" ON visa_operational_passengers;
DROP POLICY IF EXISTS "company visa_operational_passengers delete" ON visa_operational_passengers;

CREATE POLICY "company visa_operational_passengers select" ON visa_operational_passengers FOR SELECT TO authenticated
  USING (company_id = (auth.jwt()->'user_metadata'->>'company_id'));
CREATE POLICY "company visa_operational_passengers insert" ON visa_operational_passengers FOR INSERT TO authenticated
  WITH CHECK (company_id = (auth.jwt()->'user_metadata'->>'company_id'));
CREATE POLICY "company visa_operational_passengers update" ON visa_operational_passengers FOR UPDATE TO authenticated
  USING (company_id = (auth.jwt()->'user_metadata'->>'company_id'));
CREATE POLICY "company visa_operational_passengers delete" ON visa_operational_passengers FOR DELETE TO authenticated
  USING (company_id = (auth.jwt()->'user_metadata'->>'company_id'));
