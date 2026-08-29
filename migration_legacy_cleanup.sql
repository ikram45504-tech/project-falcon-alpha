-- Legacy cleanup: remove obsolete tables, mirror trigger, and wipe all data for fresh V3 start.
-- User-approved full reset including companies and users.

DROP TRIGGER IF EXISTS trg_mirror_hotel_booking_adjustment_to_legacy ON hotel_booking_adjustments;
DROP FUNCTION IF EXISTS public.mirror_hotel_booking_adjustment_to_legacy();

-- Child / detail tables first
TRUNCATE TABLE
  package_booking_lines,
  package_booking_adjustments,
  package_operational_meta,
  package_operational_passengers,
  package_operational_hotels,
  package_operational_flights,
  package_operational_flight_stopovers,
  package_movement_events,
  ticket_booking_lines,
  ticket_booking_adjustments,
  ticket_operational_meta,
  ticket_operational_passengers,
  ticket_operational_flights,
  hotel_booking_lines,
  hotel_booking_adjustments,
  hotel_commercial_guest_refs,
  hotel_operational_reservations,
  hotel_operational_guests,
  hotel_operational_meta,
  visa_booking_lines,
  visa_booking_adjustments,
  visa_transport_fleet,
  visa_passport_details,
  visa_operational_meta,
  visa_operational_passengers,
  transport_booking_lines,
  transport_booking_adjustments,
  transport_operational_sectors,
  transport_operational_meta,
  misc_booking_lines,
  misc_booking_adjustments,
  misc_commercial_family_refs,
  misc_operational_services,
  misc_operational_meta,
  misc_booking_details,
  package_booking_lines_v2,
  payment_v2_meta,
  payment_entries,
  package_bookings,
  ticket_bookings,
  hotel_bookings,
  visa_bookings,
  transport_bookings,
  misc_bookings,
  parties,
  vendors,
  unassigned_accounts,
  audit_logs,
  remembered_sessions,
  users,
  companies
RESTART IDENTITY;

DROP TABLE IF EXISTS booking_adjustments;
DROP TABLE IF EXISTS accommodation_entries;
DROP TABLE IF EXISTS service_entries;
DROP TABLE IF EXISTS package_booking_lines_v2;
DROP TABLE IF EXISTS misc_booking_details;
