-- Ticket commercial line columns (V3 fare grid).
-- Run in Supabase SQL Editor if ticket save fails with:
-- "Could not find the 'airline_name' column of 'ticket_booking_lines' in the schema cache"
--
-- Desktop SQLite already has these via ensureColumn(); cloud must match.

ALTER TABLE ticket_booking_lines
  ADD COLUMN IF NOT EXISTS airline_name TEXT NOT NULL DEFAULT '';

ALTER TABLE ticket_booking_lines
  ADD COLUMN IF NOT EXISTS pnr TEXT NOT NULL DEFAULT '';

ALTER TABLE ticket_booking_lines
  ADD COLUMN IF NOT EXISTS flight_type TEXT NOT NULL DEFAULT 'RETURN';

ALTER TABLE ticket_booking_lines
  ADD COLUMN IF NOT EXISTS ticket_route TEXT NOT NULL DEFAULT '';

-- Refresh PostgREST schema cache (Supabase usually picks this up within seconds).
NOTIFY pgrst, 'reload schema';
