-- Hotel Phase-2B RLS: hotel_booking_adjustments

ALTER TABLE IF EXISTS hotel_booking_adjustments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "company hotel_booking_adjustments select" ON hotel_booking_adjustments;
DROP POLICY IF EXISTS "company hotel_booking_adjustments insert" ON hotel_booking_adjustments;
DROP POLICY IF EXISTS "company hotel_booking_adjustments update" ON hotel_booking_adjustments;
DROP POLICY IF EXISTS "company hotel_booking_adjustments delete" ON hotel_booking_adjustments;

CREATE POLICY "company hotel_booking_adjustments select" ON hotel_booking_adjustments FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM hotel_bookings b
      WHERE b.id = hotel_booking_adjustments.booking_id
        AND b.company_id = (auth.jwt()->'user_metadata'->>'company_id')
    )
  );
CREATE POLICY "company hotel_booking_adjustments insert" ON hotel_booking_adjustments FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM hotel_bookings b
      WHERE b.id = hotel_booking_adjustments.booking_id
        AND b.company_id = (auth.jwt()->'user_metadata'->>'company_id')
    )
  );
CREATE POLICY "company hotel_booking_adjustments update" ON hotel_booking_adjustments FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM hotel_bookings b
      WHERE b.id = hotel_booking_adjustments.booking_id
        AND b.company_id = (auth.jwt()->'user_metadata'->>'company_id')
    )
  );
CREATE POLICY "company hotel_booking_adjustments delete" ON hotel_booking_adjustments FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM hotel_bookings b
      WHERE b.id = hotel_booking_adjustments.booking_id
        AND b.company_id = (auth.jwt()->'user_metadata'->>'company_id')
    )
  );
