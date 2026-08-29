-- RLS for ticket/visa/transport/misc dedicated adjustment tables

ALTER TABLE IF EXISTS ticket_booking_adjustments ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS visa_booking_adjustments ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS transport_booking_adjustments ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS misc_booking_adjustments ENABLE ROW LEVEL SECURITY;

-- ticket_booking_adjustments
DROP POLICY IF EXISTS "company ticket_booking_adjustments select" ON ticket_booking_adjustments;
DROP POLICY IF EXISTS "company ticket_booking_adjustments insert" ON ticket_booking_adjustments;
DROP POLICY IF EXISTS "company ticket_booking_adjustments update" ON ticket_booking_adjustments;
DROP POLICY IF EXISTS "company ticket_booking_adjustments delete" ON ticket_booking_adjustments;

CREATE POLICY "company ticket_booking_adjustments select" ON ticket_booking_adjustments FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM ticket_bookings b
    WHERE b.id = ticket_booking_adjustments.booking_id
      AND b.company_id = (auth.jwt()->'user_metadata'->>'company_id')
  ));
CREATE POLICY "company ticket_booking_adjustments insert" ON ticket_booking_adjustments FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM ticket_bookings b
    WHERE b.id = ticket_booking_adjustments.booking_id
      AND b.company_id = (auth.jwt()->'user_metadata'->>'company_id')
  ));
CREATE POLICY "company ticket_booking_adjustments update" ON ticket_booking_adjustments FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM ticket_bookings b
    WHERE b.id = ticket_booking_adjustments.booking_id
      AND b.company_id = (auth.jwt()->'user_metadata'->>'company_id')
  ));
CREATE POLICY "company ticket_booking_adjustments delete" ON ticket_booking_adjustments FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM ticket_bookings b
    WHERE b.id = ticket_booking_adjustments.booking_id
      AND b.company_id = (auth.jwt()->'user_metadata'->>'company_id')
  ));

-- visa_booking_adjustments
DROP POLICY IF EXISTS "company visa_booking_adjustments select" ON visa_booking_adjustments;
DROP POLICY IF EXISTS "company visa_booking_adjustments insert" ON visa_booking_adjustments;
DROP POLICY IF EXISTS "company visa_booking_adjustments update" ON visa_booking_adjustments;
DROP POLICY IF EXISTS "company visa_booking_adjustments delete" ON visa_booking_adjustments;

CREATE POLICY "company visa_booking_adjustments select" ON visa_booking_adjustments FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM visa_bookings b
    WHERE b.id = visa_booking_adjustments.booking_id
      AND b.company_id = (auth.jwt()->'user_metadata'->>'company_id')
  ));
CREATE POLICY "company visa_booking_adjustments insert" ON visa_booking_adjustments FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM visa_bookings b
    WHERE b.id = visa_booking_adjustments.booking_id
      AND b.company_id = (auth.jwt()->'user_metadata'->>'company_id')
  ));
CREATE POLICY "company visa_booking_adjustments update" ON visa_booking_adjustments FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM visa_bookings b
    WHERE b.id = visa_booking_adjustments.booking_id
      AND b.company_id = (auth.jwt()->'user_metadata'->>'company_id')
  ));
CREATE POLICY "company visa_booking_adjustments delete" ON visa_booking_adjustments FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM visa_bookings b
    WHERE b.id = visa_booking_adjustments.booking_id
      AND b.company_id = (auth.jwt()->'user_metadata'->>'company_id')
  ));

-- transport_booking_adjustments
DROP POLICY IF EXISTS "company transport_booking_adjustments select" ON transport_booking_adjustments;
DROP POLICY IF EXISTS "company transport_booking_adjustments insert" ON transport_booking_adjustments;
DROP POLICY IF EXISTS "company transport_booking_adjustments update" ON transport_booking_adjustments;
DROP POLICY IF EXISTS "company transport_booking_adjustments delete" ON transport_booking_adjustments;

CREATE POLICY "company transport_booking_adjustments select" ON transport_booking_adjustments FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM transport_bookings b
    WHERE b.id = transport_booking_adjustments.booking_id
      AND b.company_id = (auth.jwt()->'user_metadata'->>'company_id')
  ));
CREATE POLICY "company transport_booking_adjustments insert" ON transport_booking_adjustments FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM transport_bookings b
    WHERE b.id = transport_booking_adjustments.booking_id
      AND b.company_id = (auth.jwt()->'user_metadata'->>'company_id')
  ));
CREATE POLICY "company transport_booking_adjustments update" ON transport_booking_adjustments FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM transport_bookings b
    WHERE b.id = transport_booking_adjustments.booking_id
      AND b.company_id = (auth.jwt()->'user_metadata'->>'company_id')
  ));
CREATE POLICY "company transport_booking_adjustments delete" ON transport_booking_adjustments FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM transport_bookings b
    WHERE b.id = transport_booking_adjustments.booking_id
      AND b.company_id = (auth.jwt()->'user_metadata'->>'company_id')
  ));

-- misc_booking_adjustments
DROP POLICY IF EXISTS "company misc_booking_adjustments select" ON misc_booking_adjustments;
DROP POLICY IF EXISTS "company misc_booking_adjustments insert" ON misc_booking_adjustments;
DROP POLICY IF EXISTS "company misc_booking_adjustments update" ON misc_booking_adjustments;
DROP POLICY IF EXISTS "company misc_booking_adjustments delete" ON misc_booking_adjustments;

CREATE POLICY "company misc_booking_adjustments select" ON misc_booking_adjustments FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM misc_bookings b
    WHERE b.id = misc_booking_adjustments.booking_id
      AND b.company_id = (auth.jwt()->'user_metadata'->>'company_id')
  ));
CREATE POLICY "company misc_booking_adjustments insert" ON misc_booking_adjustments FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM misc_bookings b
    WHERE b.id = misc_booking_adjustments.booking_id
      AND b.company_id = (auth.jwt()->'user_metadata'->>'company_id')
  ));
CREATE POLICY "company misc_booking_adjustments update" ON misc_booking_adjustments FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM misc_bookings b
    WHERE b.id = misc_booking_adjustments.booking_id
      AND b.company_id = (auth.jwt()->'user_metadata'->>'company_id')
  ));
CREATE POLICY "company misc_booking_adjustments delete" ON misc_booking_adjustments FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM misc_bookings b
    WHERE b.id = misc_booking_adjustments.booking_id
      AND b.company_id = (auth.jwt()->'user_metadata'->>'company_id')
  ));
