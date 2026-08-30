-- Visa commercial columns missing from early Supabase schema.
-- Run in Supabase SQL Editor. Safe to re-run.

ALTER TABLE IF EXISTS visa_bookings
  ADD COLUMN IF NOT EXISTS expected_entry_date TEXT NOT NULL DEFAULT '';

ALTER TABLE IF EXISTS visa_passport_details
  ADD COLUMN IF NOT EXISTS surname TEXT NOT NULL DEFAULT '';

ALTER TABLE IF EXISTS visa_passport_details
  ADD COLUMN IF NOT EXISTS given_name TEXT NOT NULL DEFAULT '';

ALTER TABLE IF EXISTS visa_passport_details
  ADD COLUMN IF NOT EXISTS passport_issuance TEXT NOT NULL DEFAULT '';
