-- Hotel Phase-2A RLS: commercial hotel tables + ops
-- Mirrors ticket company_id JWT policies

ALTER TABLE IF EXISTS hotel_bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS hotel_booking_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS hotel_commercial_guest_refs ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS hotel_operational_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS hotel_operational_guests ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS hotel_operational_meta ENABLE ROW LEVEL SECURITY;

-- hotel_bookings
DROP POLICY IF EXISTS "company hotel_bookings select" ON hotel_bookings;
DROP POLICY IF EXISTS "company hotel_bookings insert" ON hotel_bookings;
DROP POLICY IF EXISTS "company hotel_bookings update" ON hotel_bookings;
DROP POLICY IF EXISTS "company hotel_bookings delete" ON hotel_bookings;

CREATE POLICY "company hotel_bookings select" ON hotel_bookings FOR SELECT TO authenticated
  USING (company_id = (auth.jwt()->'user_metadata'->>'company_id'));
CREATE POLICY "company hotel_bookings insert" ON hotel_bookings FOR INSERT TO authenticated
  WITH CHECK (company_id = (auth.jwt()->'user_metadata'->>'company_id'));
CREATE POLICY "company hotel_bookings update" ON hotel_bookings FOR UPDATE TO authenticated
  USING (company_id = (auth.jwt()->'user_metadata'->>'company_id'));
CREATE POLICY "company hotel_bookings delete" ON hotel_bookings FOR DELETE TO authenticated
  USING (company_id = (auth.jwt()->'user_metadata'->>'company_id'));

-- hotel_booking_lines (via parent booking)
DROP POLICY IF EXISTS "company hotel_booking_lines select" ON hotel_booking_lines;
DROP POLICY IF EXISTS "company hotel_booking_lines insert" ON hotel_booking_lines;
DROP POLICY IF EXISTS "company hotel_booking_lines update" ON hotel_booking_lines;
DROP POLICY IF EXISTS "company hotel_booking_lines delete" ON hotel_booking_lines;

CREATE POLICY "company hotel_booking_lines select" ON hotel_booking_lines FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM hotel_bookings b
    WHERE b.id = hotel_booking_lines.booking_id
      AND b.company_id = (auth.jwt()->'user_metadata'->>'company_id')
  ));
CREATE POLICY "company hotel_booking_lines insert" ON hotel_booking_lines FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM hotel_bookings b
    WHERE b.id = hotel_booking_lines.booking_id
      AND b.company_id = (auth.jwt()->'user_metadata'->>'company_id')
  ));
CREATE POLICY "company hotel_booking_lines update" ON hotel_booking_lines FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM hotel_bookings b
    WHERE b.id = hotel_booking_lines.booking_id
      AND b.company_id = (auth.jwt()->'user_metadata'->>'company_id')
  ));
CREATE POLICY "company hotel_booking_lines delete" ON hotel_booking_lines FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM hotel_bookings b
    WHERE b.id = hotel_booking_lines.booking_id
      AND b.company_id = (auth.jwt()->'user_metadata'->>'company_id')
  ));

-- hotel_commercial_guest_refs
DROP POLICY IF EXISTS "company hotel_commercial_guest_refs select" ON hotel_commercial_guest_refs;
DROP POLICY IF EXISTS "company hotel_commercial_guest_refs insert" ON hotel_commercial_guest_refs;
DROP POLICY IF EXISTS "company hotel_commercial_guest_refs update" ON hotel_commercial_guest_refs;
DROP POLICY IF EXISTS "company hotel_commercial_guest_refs delete" ON hotel_commercial_guest_refs;

CREATE POLICY "company hotel_commercial_guest_refs select" ON hotel_commercial_guest_refs FOR SELECT TO authenticated
  USING (company_id = (auth.jwt()->'user_metadata'->>'company_id'));
CREATE POLICY "company hotel_commercial_guest_refs insert" ON hotel_commercial_guest_refs FOR INSERT TO authenticated
  WITH CHECK (company_id = (auth.jwt()->'user_metadata'->>'company_id'));
CREATE POLICY "company hotel_commercial_guest_refs update" ON hotel_commercial_guest_refs FOR UPDATE TO authenticated
  USING (company_id = (auth.jwt()->'user_metadata'->>'company_id'));
CREATE POLICY "company hotel_commercial_guest_refs delete" ON hotel_commercial_guest_refs FOR DELETE TO authenticated
  USING (company_id = (auth.jwt()->'user_metadata'->>'company_id'));

-- hotel_operational_reservations
DROP POLICY IF EXISTS "company hotel_operational_reservations select" ON hotel_operational_reservations;
DROP POLICY IF EXISTS "company hotel_operational_reservations insert" ON hotel_operational_reservations;
DROP POLICY IF EXISTS "company hotel_operational_reservations update" ON hotel_operational_reservations;
DROP POLICY IF EXISTS "company hotel_operational_reservations delete" ON hotel_operational_reservations;

CREATE POLICY "company hotel_operational_reservations select" ON hotel_operational_reservations FOR SELECT TO authenticated
  USING (company_id = (auth.jwt()->'user_metadata'->>'company_id'));
CREATE POLICY "company hotel_operational_reservations insert" ON hotel_operational_reservations FOR INSERT TO authenticated
  WITH CHECK (company_id = (auth.jwt()->'user_metadata'->>'company_id'));
CREATE POLICY "company hotel_operational_reservations update" ON hotel_operational_reservations FOR UPDATE TO authenticated
  USING (company_id = (auth.jwt()->'user_metadata'->>'company_id'));
CREATE POLICY "company hotel_operational_reservations delete" ON hotel_operational_reservations FOR DELETE TO authenticated
  USING (company_id = (auth.jwt()->'user_metadata'->>'company_id'));

-- hotel_operational_guests
DROP POLICY IF EXISTS "company hotel_operational_guests select" ON hotel_operational_guests;
DROP POLICY IF EXISTS "company hotel_operational_guests insert" ON hotel_operational_guests;
DROP POLICY IF EXISTS "company hotel_operational_guests update" ON hotel_operational_guests;
DROP POLICY IF EXISTS "company hotel_operational_guests delete" ON hotel_operational_guests;

CREATE POLICY "company hotel_operational_guests select" ON hotel_operational_guests FOR SELECT TO authenticated
  USING (company_id = (auth.jwt()->'user_metadata'->>'company_id'));
CREATE POLICY "company hotel_operational_guests insert" ON hotel_operational_guests FOR INSERT TO authenticated
  WITH CHECK (company_id = (auth.jwt()->'user_metadata'->>'company_id'));
CREATE POLICY "company hotel_operational_guests update" ON hotel_operational_guests FOR UPDATE TO authenticated
  USING (company_id = (auth.jwt()->'user_metadata'->>'company_id'));
CREATE POLICY "company hotel_operational_guests delete" ON hotel_operational_guests FOR DELETE TO authenticated
  USING (company_id = (auth.jwt()->'user_metadata'->>'company_id'));

-- hotel_operational_meta
DROP POLICY IF EXISTS "company hotel_operational_meta select" ON hotel_operational_meta;
DROP POLICY IF EXISTS "company hotel_operational_meta insert" ON hotel_operational_meta;
DROP POLICY IF EXISTS "company hotel_operational_meta update" ON hotel_operational_meta;
DROP POLICY IF EXISTS "company hotel_operational_meta delete" ON hotel_operational_meta;

CREATE POLICY "company hotel_operational_meta select" ON hotel_operational_meta FOR SELECT TO authenticated
  USING (company_id = (auth.jwt()->'user_metadata'->>'company_id'));
CREATE POLICY "company hotel_operational_meta insert" ON hotel_operational_meta FOR INSERT TO authenticated
  WITH CHECK (company_id = (auth.jwt()->'user_metadata'->>'company_id'));
CREATE POLICY "company hotel_operational_meta update" ON hotel_operational_meta FOR UPDATE TO authenticated
  USING (company_id = (auth.jwt()->'user_metadata'->>'company_id'));
CREATE POLICY "company hotel_operational_meta delete" ON hotel_operational_meta FOR DELETE TO authenticated
  USING (company_id = (auth.jwt()->'user_metadata'->>'company_id'));
