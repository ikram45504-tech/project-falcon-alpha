-- Package Phase-2 RLS: operational tables + adjustments
-- Mirrors package_booking_lines pattern (scoped via parent booking company_id)

ALTER TABLE IF EXISTS package_booking_adjustments ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS package_operational_meta ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS package_operational_passengers ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS package_operational_hotels ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS package_operational_flights ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS package_operational_flight_stopovers ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS package_movement_events ENABLE ROW LEVEL SECURITY;

-- Adjustments
DROP POLICY IF EXISTS "company package_booking_adjustments select" ON package_booking_adjustments;
DROP POLICY IF EXISTS "company package_booking_adjustments insert" ON package_booking_adjustments;
DROP POLICY IF EXISTS "company package_booking_adjustments update" ON package_booking_adjustments;
DROP POLICY IF EXISTS "company package_booking_adjustments delete" ON package_booking_adjustments;

CREATE POLICY "company package_booking_adjustments select" ON package_booking_adjustments FOR SELECT TO authenticated
  USING (company_id = (auth.jwt()->'user_metadata'->>'company_id'));
CREATE POLICY "company package_booking_adjustments insert" ON package_booking_adjustments FOR INSERT TO authenticated
  WITH CHECK (company_id = (auth.jwt()->'user_metadata'->>'company_id'));
CREATE POLICY "company package_booking_adjustments update" ON package_booking_adjustments FOR UPDATE TO authenticated
  USING (company_id = (auth.jwt()->'user_metadata'->>'company_id'));
CREATE POLICY "company package_booking_adjustments delete" ON package_booking_adjustments FOR DELETE TO authenticated
  USING (company_id = (auth.jwt()->'user_metadata'->>'company_id'));

-- Helper expression reused via EXISTS parent booking
-- Operational meta
DROP POLICY IF EXISTS "company package_operational_meta select" ON package_operational_meta;
DROP POLICY IF EXISTS "company package_operational_meta insert" ON package_operational_meta;
DROP POLICY IF EXISTS "company package_operational_meta update" ON package_operational_meta;
DROP POLICY IF EXISTS "company package_operational_meta delete" ON package_operational_meta;

CREATE POLICY "company package_operational_meta select" ON package_operational_meta FOR SELECT TO authenticated
  USING (company_id = (auth.jwt()->'user_metadata'->>'company_id'));
CREATE POLICY "company package_operational_meta insert" ON package_operational_meta FOR INSERT TO authenticated
  WITH CHECK (company_id = (auth.jwt()->'user_metadata'->>'company_id'));
CREATE POLICY "company package_operational_meta update" ON package_operational_meta FOR UPDATE TO authenticated
  USING (company_id = (auth.jwt()->'user_metadata'->>'company_id'));
CREATE POLICY "company package_operational_meta delete" ON package_operational_meta FOR DELETE TO authenticated
  USING (company_id = (auth.jwt()->'user_metadata'->>'company_id'));

-- Passengers
DROP POLICY IF EXISTS "company package_operational_passengers select" ON package_operational_passengers;
DROP POLICY IF EXISTS "company package_operational_passengers insert" ON package_operational_passengers;
DROP POLICY IF EXISTS "company package_operational_passengers update" ON package_operational_passengers;
DROP POLICY IF EXISTS "company package_operational_passengers delete" ON package_operational_passengers;

CREATE POLICY "company package_operational_passengers select" ON package_operational_passengers FOR SELECT TO authenticated
  USING (company_id = (auth.jwt()->'user_metadata'->>'company_id'));
CREATE POLICY "company package_operational_passengers insert" ON package_operational_passengers FOR INSERT TO authenticated
  WITH CHECK (company_id = (auth.jwt()->'user_metadata'->>'company_id'));
CREATE POLICY "company package_operational_passengers update" ON package_operational_passengers FOR UPDATE TO authenticated
  USING (company_id = (auth.jwt()->'user_metadata'->>'company_id'));
CREATE POLICY "company package_operational_passengers delete" ON package_operational_passengers FOR DELETE TO authenticated
  USING (company_id = (auth.jwt()->'user_metadata'->>'company_id'));

-- Hotels
DROP POLICY IF EXISTS "company package_operational_hotels select" ON package_operational_hotels;
DROP POLICY IF EXISTS "company package_operational_hotels insert" ON package_operational_hotels;
DROP POLICY IF EXISTS "company package_operational_hotels update" ON package_operational_hotels;
DROP POLICY IF EXISTS "company package_operational_hotels delete" ON package_operational_hotels;

CREATE POLICY "company package_operational_hotels select" ON package_operational_hotels FOR SELECT TO authenticated
  USING (company_id = (auth.jwt()->'user_metadata'->>'company_id'));
CREATE POLICY "company package_operational_hotels insert" ON package_operational_hotels FOR INSERT TO authenticated
  WITH CHECK (company_id = (auth.jwt()->'user_metadata'->>'company_id'));
CREATE POLICY "company package_operational_hotels update" ON package_operational_hotels FOR UPDATE TO authenticated
  USING (company_id = (auth.jwt()->'user_metadata'->>'company_id'));
CREATE POLICY "company package_operational_hotels delete" ON package_operational_hotels FOR DELETE TO authenticated
  USING (company_id = (auth.jwt()->'user_metadata'->>'company_id'));

-- Flights
DROP POLICY IF EXISTS "company package_operational_flights select" ON package_operational_flights;
DROP POLICY IF EXISTS "company package_operational_flights insert" ON package_operational_flights;
DROP POLICY IF EXISTS "company package_operational_flights update" ON package_operational_flights;
DROP POLICY IF EXISTS "company package_operational_flights delete" ON package_operational_flights;

CREATE POLICY "company package_operational_flights select" ON package_operational_flights FOR SELECT TO authenticated
  USING (company_id = (auth.jwt()->'user_metadata'->>'company_id'));
CREATE POLICY "company package_operational_flights insert" ON package_operational_flights FOR INSERT TO authenticated
  WITH CHECK (company_id = (auth.jwt()->'user_metadata'->>'company_id'));
CREATE POLICY "company package_operational_flights update" ON package_operational_flights FOR UPDATE TO authenticated
  USING (company_id = (auth.jwt()->'user_metadata'->>'company_id'));
CREATE POLICY "company package_operational_flights delete" ON package_operational_flights FOR DELETE TO authenticated
  USING (company_id = (auth.jwt()->'user_metadata'->>'company_id'));

-- Stopovers
DROP POLICY IF EXISTS "company package_operational_flight_stopovers select" ON package_operational_flight_stopovers;
DROP POLICY IF EXISTS "company package_operational_flight_stopovers insert" ON package_operational_flight_stopovers;
DROP POLICY IF EXISTS "company package_operational_flight_stopovers update" ON package_operational_flight_stopovers;
DROP POLICY IF EXISTS "company package_operational_flight_stopovers delete" ON package_operational_flight_stopovers;

CREATE POLICY "company package_operational_flight_stopovers select" ON package_operational_flight_stopovers FOR SELECT TO authenticated
  USING (company_id = (auth.jwt()->'user_metadata'->>'company_id'));
CREATE POLICY "company package_operational_flight_stopovers insert" ON package_operational_flight_stopovers FOR INSERT TO authenticated
  WITH CHECK (company_id = (auth.jwt()->'user_metadata'->>'company_id'));
CREATE POLICY "company package_operational_flight_stopovers update" ON package_operational_flight_stopovers FOR UPDATE TO authenticated
  USING (company_id = (auth.jwt()->'user_metadata'->>'company_id'));
CREATE POLICY "company package_operational_flight_stopovers delete" ON package_operational_flight_stopovers FOR DELETE TO authenticated
  USING (company_id = (auth.jwt()->'user_metadata'->>'company_id'));

-- Movement events
DROP POLICY IF EXISTS "company package_movement_events select" ON package_movement_events;
DROP POLICY IF EXISTS "company package_movement_events insert" ON package_movement_events;
DROP POLICY IF EXISTS "company package_movement_events update" ON package_movement_events;
DROP POLICY IF EXISTS "company package_movement_events delete" ON package_movement_events;

CREATE POLICY "company package_movement_events select" ON package_movement_events FOR SELECT TO authenticated
  USING (company_id = (auth.jwt()->'user_metadata'->>'company_id'));
CREATE POLICY "company package_movement_events insert" ON package_movement_events FOR INSERT TO authenticated
  WITH CHECK (company_id = (auth.jwt()->'user_metadata'->>'company_id'));
CREATE POLICY "company package_movement_events update" ON package_movement_events FOR UPDATE TO authenticated
  USING (company_id = (auth.jwt()->'user_metadata'->>'company_id'));
CREATE POLICY "company package_movement_events delete" ON package_movement_events FOR DELETE TO authenticated
  USING (company_id = (auth.jwt()->'user_metadata'->>'company_id'));

NOTIFY pgrst, 'reload schema';
