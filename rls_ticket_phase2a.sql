-- Ticket Phase-2A RLS: commercial ticket tables + ops + shared booking_adjustments
-- Mirrors package company_id JWT policies

ALTER TABLE IF EXISTS ticket_bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS ticket_booking_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS ticket_operational_meta ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS ticket_operational_passengers ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS ticket_operational_flights ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS booking_adjustments ENABLE ROW LEVEL SECURITY;

-- ticket_bookings
DROP POLICY IF EXISTS "company ticket_bookings select" ON ticket_bookings;
DROP POLICY IF EXISTS "company ticket_bookings insert" ON ticket_bookings;
DROP POLICY IF EXISTS "company ticket_bookings update" ON ticket_bookings;
DROP POLICY IF EXISTS "company ticket_bookings delete" ON ticket_bookings;

CREATE POLICY "company ticket_bookings select" ON ticket_bookings FOR SELECT TO authenticated
  USING (company_id = (auth.jwt()->'user_metadata'->>'company_id'));
CREATE POLICY "company ticket_bookings insert" ON ticket_bookings FOR INSERT TO authenticated
  WITH CHECK (company_id = (auth.jwt()->'user_metadata'->>'company_id'));
CREATE POLICY "company ticket_bookings update" ON ticket_bookings FOR UPDATE TO authenticated
  USING (company_id = (auth.jwt()->'user_metadata'->>'company_id'));
CREATE POLICY "company ticket_bookings delete" ON ticket_bookings FOR DELETE TO authenticated
  USING (company_id = (auth.jwt()->'user_metadata'->>'company_id'));

-- ticket_booking_lines (via parent booking)
DROP POLICY IF EXISTS "company ticket_booking_lines select" ON ticket_booking_lines;
DROP POLICY IF EXISTS "company ticket_booking_lines insert" ON ticket_booking_lines;
DROP POLICY IF EXISTS "company ticket_booking_lines update" ON ticket_booking_lines;
DROP POLICY IF EXISTS "company ticket_booking_lines delete" ON ticket_booking_lines;

CREATE POLICY "company ticket_booking_lines select" ON ticket_booking_lines FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM ticket_bookings b
    WHERE b.id = ticket_booking_lines.booking_id
      AND b.company_id = (auth.jwt()->'user_metadata'->>'company_id')
  ));
CREATE POLICY "company ticket_booking_lines insert" ON ticket_booking_lines FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM ticket_bookings b
    WHERE b.id = ticket_booking_lines.booking_id
      AND b.company_id = (auth.jwt()->'user_metadata'->>'company_id')
  ));
CREATE POLICY "company ticket_booking_lines update" ON ticket_booking_lines FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM ticket_bookings b
    WHERE b.id = ticket_booking_lines.booking_id
      AND b.company_id = (auth.jwt()->'user_metadata'->>'company_id')
  ));
CREATE POLICY "company ticket_booking_lines delete" ON ticket_booking_lines FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM ticket_bookings b
    WHERE b.id = ticket_booking_lines.booking_id
      AND b.company_id = (auth.jwt()->'user_metadata'->>'company_id')
  ));

-- ticket_operational_meta
DROP POLICY IF EXISTS "company ticket_operational_meta select" ON ticket_operational_meta;
DROP POLICY IF EXISTS "company ticket_operational_meta insert" ON ticket_operational_meta;
DROP POLICY IF EXISTS "company ticket_operational_meta update" ON ticket_operational_meta;
DROP POLICY IF EXISTS "company ticket_operational_meta delete" ON ticket_operational_meta;

CREATE POLICY "company ticket_operational_meta select" ON ticket_operational_meta FOR SELECT TO authenticated
  USING (company_id = (auth.jwt()->'user_metadata'->>'company_id'));
CREATE POLICY "company ticket_operational_meta insert" ON ticket_operational_meta FOR INSERT TO authenticated
  WITH CHECK (company_id = (auth.jwt()->'user_metadata'->>'company_id'));
CREATE POLICY "company ticket_operational_meta update" ON ticket_operational_meta FOR UPDATE TO authenticated
  USING (company_id = (auth.jwt()->'user_metadata'->>'company_id'));
CREATE POLICY "company ticket_operational_meta delete" ON ticket_operational_meta FOR DELETE TO authenticated
  USING (company_id = (auth.jwt()->'user_metadata'->>'company_id'));

-- ticket_operational_passengers
DROP POLICY IF EXISTS "company ticket_operational_passengers select" ON ticket_operational_passengers;
DROP POLICY IF EXISTS "company ticket_operational_passengers insert" ON ticket_operational_passengers;
DROP POLICY IF EXISTS "company ticket_operational_passengers update" ON ticket_operational_passengers;
DROP POLICY IF EXISTS "company ticket_operational_passengers delete" ON ticket_operational_passengers;

CREATE POLICY "company ticket_operational_passengers select" ON ticket_operational_passengers FOR SELECT TO authenticated
  USING (company_id = (auth.jwt()->'user_metadata'->>'company_id'));
CREATE POLICY "company ticket_operational_passengers insert" ON ticket_operational_passengers FOR INSERT TO authenticated
  WITH CHECK (company_id = (auth.jwt()->'user_metadata'->>'company_id'));
CREATE POLICY "company ticket_operational_passengers update" ON ticket_operational_passengers FOR UPDATE TO authenticated
  USING (company_id = (auth.jwt()->'user_metadata'->>'company_id'));
CREATE POLICY "company ticket_operational_passengers delete" ON ticket_operational_passengers FOR DELETE TO authenticated
  USING (company_id = (auth.jwt()->'user_metadata'->>'company_id'));

-- ticket_operational_flights
DROP POLICY IF EXISTS "company ticket_operational_flights select" ON ticket_operational_flights;
DROP POLICY IF EXISTS "company ticket_operational_flights insert" ON ticket_operational_flights;
DROP POLICY IF EXISTS "company ticket_operational_flights update" ON ticket_operational_flights;
DROP POLICY IF EXISTS "company ticket_operational_flights delete" ON ticket_operational_flights;

CREATE POLICY "company ticket_operational_flights select" ON ticket_operational_flights FOR SELECT TO authenticated
  USING (company_id = (auth.jwt()->'user_metadata'->>'company_id'));
CREATE POLICY "company ticket_operational_flights insert" ON ticket_operational_flights FOR INSERT TO authenticated
  WITH CHECK (company_id = (auth.jwt()->'user_metadata'->>'company_id'));
CREATE POLICY "company ticket_operational_flights update" ON ticket_operational_flights FOR UPDATE TO authenticated
  USING (company_id = (auth.jwt()->'user_metadata'->>'company_id'));
CREATE POLICY "company ticket_operational_flights delete" ON ticket_operational_flights FOR DELETE TO authenticated
  USING (company_id = (auth.jwt()->'user_metadata'->>'company_id'));

-- booking_adjustments (shared across services)
DROP POLICY IF EXISTS "company booking_adjustments select" ON booking_adjustments;
DROP POLICY IF EXISTS "company booking_adjustments insert" ON booking_adjustments;
DROP POLICY IF EXISTS "company booking_adjustments update" ON booking_adjustments;
DROP POLICY IF EXISTS "company booking_adjustments delete" ON booking_adjustments;

CREATE POLICY "company booking_adjustments select" ON booking_adjustments FOR SELECT TO authenticated
  USING (company_id = (auth.jwt()->'user_metadata'->>'company_id'));
CREATE POLICY "company booking_adjustments insert" ON booking_adjustments FOR INSERT TO authenticated
  WITH CHECK (company_id = (auth.jwt()->'user_metadata'->>'company_id'));
CREATE POLICY "company booking_adjustments update" ON booking_adjustments FOR UPDATE TO authenticated
  USING (company_id = (auth.jwt()->'user_metadata'->>'company_id'));
CREATE POLICY "company booking_adjustments delete" ON booking_adjustments FOR DELETE TO authenticated
  USING (company_id = (auth.jwt()->'user_metadata'->>'company_id'));
