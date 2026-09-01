-- Keep legacy booking_adjustments in sync for production web until HotelRegister is deployed.
-- New hotel amendments write to hotel_booking_adjustments; web (BookingLifecycleCenter) still reads booking_adjustments.

CREATE OR REPLACE FUNCTION public.mirror_hotel_booking_adjustment_to_legacy()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO booking_adjustments (
    id,
    company_id,
    service_type,
    booking_id,
    adjustment_type,
    adjustment_date,
    category,
    reason,
    reference,
    notes,
    previous_total_pkr,
    previous_base_pkr,
    revised_base_pkr,
    charge_pkr,
    credit_pkr,
    account_delta_pkr,
    effective_total_pkr,
    before_snapshot_json,
    after_snapshot_json,
    cancelled_lines_json,
    revision_no,
    lifecycle_status,
    created_by_user_id,
    created_at
  )
  VALUES (
    NEW.id,
    NEW.company_id,
    'HOTEL',
    NEW.booking_id,
    NEW.adjustment_type,
    NEW.adjustment_date,
    NEW.category,
    NEW.reason,
    NEW.reference,
    NEW.notes,
    NEW.previous_total_pkr,
    NEW.previous_base_pkr,
    NEW.revised_base_pkr,
    NEW.charge_pkr,
    NEW.credit_pkr,
    NEW.account_delta_pkr,
    NEW.effective_total_pkr,
    NEW.before_snapshot_json,
    NEW.after_snapshot_json,
    NEW.cancelled_lines_json,
    NEW.revision_no,
    NEW.lifecycle_status,
    NEW.created_by_user_id,
    NEW.created_at
  )
  ON CONFLICT (id) DO UPDATE SET
    company_id = EXCLUDED.company_id,
    service_type = EXCLUDED.service_type,
    booking_id = EXCLUDED.booking_id,
    adjustment_type = EXCLUDED.adjustment_type,
    adjustment_date = EXCLUDED.adjustment_date,
    category = EXCLUDED.category,
    reason = EXCLUDED.reason,
    reference = EXCLUDED.reference,
    notes = EXCLUDED.notes,
    previous_total_pkr = EXCLUDED.previous_total_pkr,
    previous_base_pkr = EXCLUDED.previous_base_pkr,
    revised_base_pkr = EXCLUDED.revised_base_pkr,
    charge_pkr = EXCLUDED.charge_pkr,
    credit_pkr = EXCLUDED.credit_pkr,
    account_delta_pkr = EXCLUDED.account_delta_pkr,
    effective_total_pkr = EXCLUDED.effective_total_pkr,
    before_snapshot_json = EXCLUDED.before_snapshot_json,
    after_snapshot_json = EXCLUDED.after_snapshot_json,
    cancelled_lines_json = EXCLUDED.cancelled_lines_json,
    revision_no = EXCLUDED.revision_no,
    lifecycle_status = EXCLUDED.lifecycle_status,
    created_by_user_id = EXCLUDED.created_by_user_id,
    created_at = EXCLUDED.created_at;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_mirror_hotel_booking_adjustment_to_legacy ON hotel_booking_adjustments;

CREATE TRIGGER trg_mirror_hotel_booking_adjustment_to_legacy
AFTER INSERT OR UPDATE ON hotel_booking_adjustments
FOR EACH ROW
EXECUTE FUNCTION public.mirror_hotel_booking_adjustment_to_legacy();

-- Backfill existing dedicated hotel adjustments into legacy table for current web app.
INSERT INTO booking_adjustments (
  id,
  company_id,
  service_type,
  booking_id,
  adjustment_type,
  adjustment_date,
  category,
  reason,
  reference,
  notes,
  previous_total_pkr,
  previous_base_pkr,
  revised_base_pkr,
  charge_pkr,
  credit_pkr,
  account_delta_pkr,
  effective_total_pkr,
  before_snapshot_json,
  after_snapshot_json,
  cancelled_lines_json,
  revision_no,
  lifecycle_status,
  created_by_user_id,
  created_at
)
SELECT
  id,
  company_id,
  'HOTEL',
  booking_id,
  adjustment_type,
  adjustment_date,
  category,
  reason,
  reference,
  notes,
  previous_total_pkr,
  previous_base_pkr,
  revised_base_pkr,
  charge_pkr,
  credit_pkr,
  account_delta_pkr,
  effective_total_pkr,
  before_snapshot_json,
  after_snapshot_json,
  cancelled_lines_json,
  revision_no,
  lifecycle_status,
  created_by_user_id,
  created_at
FROM hotel_booking_adjustments
ON CONFLICT (id) DO UPDATE SET
  company_id = EXCLUDED.company_id,
  service_type = EXCLUDED.service_type,
  booking_id = EXCLUDED.booking_id,
  adjustment_type = EXCLUDED.adjustment_type,
  adjustment_date = EXCLUDED.adjustment_date,
  category = EXCLUDED.category,
  reason = EXCLUDED.reason,
  reference = EXCLUDED.reference,
  notes = EXCLUDED.notes,
  previous_total_pkr = EXCLUDED.previous_total_pkr,
  previous_base_pkr = EXCLUDED.previous_base_pkr,
  revised_base_pkr = EXCLUDED.revised_base_pkr,
  charge_pkr = EXCLUDED.charge_pkr,
  credit_pkr = EXCLUDED.credit_pkr,
  account_delta_pkr = EXCLUDED.account_delta_pkr,
  effective_total_pkr = EXCLUDED.effective_total_pkr,
  before_snapshot_json = EXCLUDED.before_snapshot_json,
  after_snapshot_json = EXCLUDED.after_snapshot_json,
  cancelled_lines_json = EXCLUDED.cancelled_lines_json,
  revision_no = EXCLUDED.revision_no,
  lifecycle_status = EXCLUDED.lifecycle_status,
  created_by_user_id = EXCLUDED.created_by_user_id,
  created_at = EXCLUDED.created_at;
