-- Optional: add FKs so Supabase nested selects like parties(name) work.
-- App code no longer requires these, but they help schema quality.
-- Run in Supabase SQL Editor only if the columns exist.

ALTER TABLE package_bookings
  DROP CONSTRAINT IF EXISTS package_bookings_counterparty_id_fkey;
ALTER TABLE package_bookings
  ADD CONSTRAINT package_bookings_counterparty_id_fkey
  FOREIGN KEY (counterparty_id) REFERENCES parties(id);

ALTER TABLE package_booking_lines
  DROP CONSTRAINT IF EXISTS package_booking_lines_booking_id_fkey;
ALTER TABLE package_booking_lines
  ADD CONSTRAINT package_booking_lines_booking_id_fkey
  FOREIGN KEY (booking_id) REFERENCES package_bookings(id) ON DELETE CASCADE;

ALTER TABLE ticket_bookings
  DROP CONSTRAINT IF EXISTS ticket_bookings_counterparty_id_fkey;
ALTER TABLE ticket_bookings
  ADD CONSTRAINT ticket_bookings_counterparty_id_fkey
  FOREIGN KEY (counterparty_id) REFERENCES parties(id);

ALTER TABLE payment_entries
  DROP CONSTRAINT IF EXISTS payment_entries_party_id_fkey;
ALTER TABLE payment_entries
  ADD CONSTRAINT payment_entries_party_id_fkey
  FOREIGN KEY (party_id) REFERENCES parties(id);
