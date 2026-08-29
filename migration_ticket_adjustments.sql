-- Ticket segment: dedicated adjustment table (mirrors hotel_booking_adjustments / package_booking_adjustments)

CREATE TABLE IF NOT EXISTS ticket_booking_adjustments (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  booking_id TEXT NOT NULL,
  adjustment_type TEXT NOT NULL,
  adjustment_date TEXT NOT NULL,
  requested_by TEXT NOT NULL DEFAULT 'INTERNAL',
  category TEXT NOT NULL DEFAULT '',
  reason TEXT NOT NULL DEFAULT '',
  reference TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  previous_total_pkr REAL NOT NULL DEFAULT 0,
  previous_base_pkr REAL NOT NULL DEFAULT 0,
  revised_base_pkr REAL NOT NULL DEFAULT 0,
  charge_pkr REAL NOT NULL DEFAULT 0,
  credit_pkr REAL NOT NULL DEFAULT 0,
  account_delta_pkr REAL NOT NULL DEFAULT 0,
  effective_total_pkr REAL NOT NULL DEFAULT 0,
  before_snapshot_json TEXT NOT NULL DEFAULT '',
  after_snapshot_json TEXT NOT NULL DEFAULT '',
  cancelled_lines_json TEXT NOT NULL DEFAULT '',
  revision_no INTEGER NOT NULL DEFAULT 2,
  lifecycle_status TEXT NOT NULL DEFAULT 'ACTIVE',
  created_by_user_id TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ticket_booking_adjustments_lookup
  ON ticket_booking_adjustments(company_id, booking_id, revision_no);
CREATE INDEX IF NOT EXISTS idx_ticket_booking_adjustments_date
  ON ticket_booking_adjustments(company_id, adjustment_date);

-- Migrate existing ticket rows from shared booking_adjustments
INSERT INTO ticket_booking_adjustments (
  id, company_id, booking_id, adjustment_type, adjustment_date, requested_by,
  category, reason, reference, notes,
  previous_total_pkr, previous_base_pkr, revised_base_pkr,
  charge_pkr, credit_pkr, account_delta_pkr, effective_total_pkr,
  before_snapshot_json, after_snapshot_json, cancelled_lines_json,
  revision_no, lifecycle_status, created_by_user_id, created_at
)
SELECT
  id, company_id, booking_id, adjustment_type, adjustment_date, 'INTERNAL',
  category, reason, reference, notes,
  previous_total_pkr, previous_base_pkr, revised_base_pkr,
  charge_pkr, credit_pkr, account_delta_pkr, effective_total_pkr,
  before_snapshot_json, after_snapshot_json, cancelled_lines_json,
  revision_no, lifecycle_status, created_by_user_id, created_at
FROM booking_adjustments
WHERE service_type = 'TICKET'
ON CONFLICT (id) DO NOTHING;
