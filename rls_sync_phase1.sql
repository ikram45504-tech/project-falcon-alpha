-- Phase 1 sync: allow authenticated company users to read/write
-- parties, package bookings (+ lines), and payments (+ meta).
-- Run this in the Supabase SQL editor if these tables already exist.
-- Adjust company_id claim path if your JWT metadata differs.

-- Helpers: company id from JWT user_metadata
-- (auth.jwt()->'user_metadata'->>'company_id')

ALTER TABLE IF EXISTS parties ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS package_bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS package_booking_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS payment_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS payment_v2_meta ENABLE ROW LEVEL SECURITY;

-- Parties
DROP POLICY IF EXISTS "company parties select" ON parties;
DROP POLICY IF EXISTS "company parties insert" ON parties;
DROP POLICY IF EXISTS "company parties update" ON parties;
DROP POLICY IF EXISTS "company parties delete" ON parties;

CREATE POLICY "company parties select" ON parties FOR SELECT TO authenticated
  USING (company_id = (auth.jwt()->'user_metadata'->>'company_id'));
CREATE POLICY "company parties insert" ON parties FOR INSERT TO authenticated
  WITH CHECK (company_id = (auth.jwt()->'user_metadata'->>'company_id'));
CREATE POLICY "company parties update" ON parties FOR UPDATE TO authenticated
  USING (company_id = (auth.jwt()->'user_metadata'->>'company_id'));
CREATE POLICY "company parties delete" ON parties FOR DELETE TO authenticated
  USING (company_id = (auth.jwt()->'user_metadata'->>'company_id'));

-- Package bookings
DROP POLICY IF EXISTS "company package_bookings select" ON package_bookings;
DROP POLICY IF EXISTS "company package_bookings insert" ON package_bookings;
DROP POLICY IF EXISTS "company package_bookings update" ON package_bookings;
DROP POLICY IF EXISTS "company package_bookings delete" ON package_bookings;

CREATE POLICY "company package_bookings select" ON package_bookings FOR SELECT TO authenticated
  USING (company_id = (auth.jwt()->'user_metadata'->>'company_id'));
CREATE POLICY "company package_bookings insert" ON package_bookings FOR INSERT TO authenticated
  WITH CHECK (company_id = (auth.jwt()->'user_metadata'->>'company_id'));
CREATE POLICY "company package_bookings update" ON package_bookings FOR UPDATE TO authenticated
  USING (company_id = (auth.jwt()->'user_metadata'->>'company_id'));
CREATE POLICY "company package_bookings delete" ON package_bookings FOR DELETE TO authenticated
  USING (company_id = (auth.jwt()->'user_metadata'->>'company_id'));

-- Package lines (scoped via parent booking)
DROP POLICY IF EXISTS "company package_booking_lines select" ON package_booking_lines;
DROP POLICY IF EXISTS "company package_booking_lines insert" ON package_booking_lines;
DROP POLICY IF EXISTS "company package_booking_lines update" ON package_booking_lines;
DROP POLICY IF EXISTS "company package_booking_lines delete" ON package_booking_lines;

CREATE POLICY "company package_booking_lines select" ON package_booking_lines FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM package_bookings b
      WHERE b.id = package_booking_lines.booking_id
        AND b.company_id = (auth.jwt()->'user_metadata'->>'company_id')
    )
  );
CREATE POLICY "company package_booking_lines insert" ON package_booking_lines FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM package_bookings b
      WHERE b.id = package_booking_lines.booking_id
        AND b.company_id = (auth.jwt()->'user_metadata'->>'company_id')
    )
  );
CREATE POLICY "company package_booking_lines update" ON package_booking_lines FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM package_bookings b
      WHERE b.id = package_booking_lines.booking_id
        AND b.company_id = (auth.jwt()->'user_metadata'->>'company_id')
    )
  );
CREATE POLICY "company package_booking_lines delete" ON package_booking_lines FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM package_bookings b
      WHERE b.id = package_booking_lines.booking_id
        AND b.company_id = (auth.jwt()->'user_metadata'->>'company_id')
    )
  );

-- Payments
DROP POLICY IF EXISTS "company payment_entries select" ON payment_entries;
DROP POLICY IF EXISTS "company payment_entries insert" ON payment_entries;
DROP POLICY IF EXISTS "company payment_entries update" ON payment_entries;
DROP POLICY IF EXISTS "company payment_entries delete" ON payment_entries;

CREATE POLICY "company payment_entries select" ON payment_entries FOR SELECT TO authenticated
  USING (company_id = (auth.jwt()->'user_metadata'->>'company_id'));
CREATE POLICY "company payment_entries insert" ON payment_entries FOR INSERT TO authenticated
  WITH CHECK (company_id = (auth.jwt()->'user_metadata'->>'company_id'));
CREATE POLICY "company payment_entries update" ON payment_entries FOR UPDATE TO authenticated
  USING (company_id = (auth.jwt()->'user_metadata'->>'company_id'));
CREATE POLICY "company payment_entries delete" ON payment_entries FOR DELETE TO authenticated
  USING (company_id = (auth.jwt()->'user_metadata'->>'company_id'));

-- Payment meta
DROP POLICY IF EXISTS "company payment_v2_meta select" ON payment_v2_meta;
DROP POLICY IF EXISTS "company payment_v2_meta insert" ON payment_v2_meta;
DROP POLICY IF EXISTS "company payment_v2_meta update" ON payment_v2_meta;
DROP POLICY IF EXISTS "company payment_v2_meta delete" ON payment_v2_meta;

CREATE POLICY "company payment_v2_meta select" ON payment_v2_meta FOR SELECT TO authenticated
  USING (company_id = (auth.jwt()->'user_metadata'->>'company_id'));
CREATE POLICY "company payment_v2_meta insert" ON payment_v2_meta FOR INSERT TO authenticated
  WITH CHECK (company_id = (auth.jwt()->'user_metadata'->>'company_id'));
CREATE POLICY "company payment_v2_meta update" ON payment_v2_meta FOR UPDATE TO authenticated
  USING (company_id = (auth.jwt()->'user_metadata'->>'company_id'));
CREATE POLICY "company payment_v2_meta delete" ON payment_v2_meta FOR DELETE TO authenticated
  USING (company_id = (auth.jwt()->'user_metadata'->>'company_id'));
