# Segment Isolation Template

Use **Hotel** (completed) and **Package** (original) as references when isolating Ticket, Visa, Transport, and Misc.

## Per-segment file set

| Layer                | Files                                                             |
| -------------------- | ----------------------------------------------------------------- |
| Commercial CRUD      | `{Segment}FlowDb.ts`                                              |
| Adjustments DB       | `{Segment}AdjustmentDb.ts`                                        |
| Adjustment UI        | `{Segment}BookingAdjustment.tsx`                                  |
| Register             | `{Segment}Register.tsx` or inline in `{Segment}BookingFlowV3.tsx` |
| Operational (if any) | `{Segment}OperationalDb.ts`                                       |

## Per-segment Supabase / SQLite tables

- `{segment}_bookings` + `{segment}_booking_lines` (already exist)
- `{segment}_booking_adjustments` (dedicated — **not** shared `booking_adjustments`)
- Operational child tables as needed

## Sync checklist

1. Add `{segment}_booking_adjustments` to `CHILD_TABLES.{segment}_bookings` in `db.ts`
2. Add `sync{Segment}AdjustmentBundle()` in `cloudSync.ts`
3. Remove segment from `UNIVERSAL_ADJUSTMENT_PARENTS` in pull sync
4. Remove segment from `UniversalBookingAdjustmentDb` service map
5. Remove segment branches from `BookingLifecycleCenter.tsx`
6. Add `rls_{segment}_phase2b.sql` for adjustment table RLS
7. Dual-read old `booking_adjustments` rows in `StatementBookingData.ts` during transition

## Counterparty tables (shared foundation)

- `parties` — customers (Sale)
- `vendors` — suppliers (Purchase)
- `unassigned_accounts` — pending classification
- Bookings keep `counterparty_id`; SALE → `parties.id`, PURCHASE → `vendors.id`

## Rollout order

1. Hotel — done
2. Ticket
3. Visa
4. Transport
5. Misc

After all segments migrated: retire `booking_adjustments`, `UniversalBookingAdjustmentDb.ts`, `UniversalBookingAdjustment.tsx`, and `BookingLifecycleCenter.tsx`.

## SQL scripts to run on Supabase (manual)

- `migration_split_parties_vendors.sql`
- `rls_parties_vendors.sql`
- `migration_hotel_adjustments.sql`
- `rls_hotel_phase2b.sql`
