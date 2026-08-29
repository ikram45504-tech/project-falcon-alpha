# Legacy Cleanup QA Report

**Branch:** `chore/legacy-cleanup-segment-statements`  
**PR:** https://github.com/ikram45504-tech/project-falcon-alpha/pull/22  
**Date:** 2026-08-29  
**Scope:** Segment-only statements, sync cleanup, legacy table removal, Supabase data reset

---

## Automated results (agent-run)

| Check                      | Result                                                                                |
| -------------------------- | ------------------------------------------------------------------------------------- |
| `npm test -- --run`        | **PASS** — 13 tests (2 files) + 4 new legacy cleanup tests after this report          |
| `npm run build`            | **PASS** — tsc + vite                                                                 |
| `schema.sql` legacy tables | **PASS** — no `booking_adjustments`, `accommodation_entries`, `service_entries`       |
| `StatementBookingData.ts`  | **PASS** — uses `loadSegmentAdjustmentsForStatements` only                            |
| `ROOT_TABLES` sync         | **PASS** — 6 booking headers + parties/vendors/payments (no legacy)                   |
| Supabase legacy tables     | **PASS** — `booking_adjustments`, `accommodation_entries`, `service_entries` **gone** |
| Supabase row counts        | **0 rows** — all tables empty (fresh cloud)                                           |
| Segment adjustment tables  | **PASS** — all 6 exist with RLS                                                       |

---

## Your manual checklist

### A. First-time setup (required — cloud was wiped)

- [ ] **A1** Open web app → should land on **Setup** (no companies)
- [ ] **A2** Create company + admin user
- [ ] **A3** Restart desktop app (or delete local `travel-accounting.db`) → run Setup with same company
- [ ] **A4** Login works on both web and desktop

### B. One booking per segment

For each module create **one SALE** booking linked to a test party:

| Module    | Path                        | Pass |
| --------- | --------------------------- | ---- |
| Package   | Bookings → Package → Save   | [ ]  |
| Ticket    | Bookings → Ticket → Save    | [ ]  |
| Hotel     | Bookings → Hotel → Save     | [ ]  |
| Visa      | Bookings → Visa → Save      | [ ]  |
| Transport | Bookings → Transport → Save | [ ]  |
| Misc      | Bookings → Misc → Save      | [ ]  |

### C. Amendment lifecycle (pick Ticket + Hotel minimum)

On each test booking:

- [ ] **C1** Open **Booking Register** → shows `ACTIVE · REV 1`
- [ ] **C2** Run **Amendment** → total changes, register shows `REV 2` / `AMENDED`
- [ ] **C3** **History** modal lists the amendment
- [ ] **C4** Commercial line rows actually changed (not header-only)

### D. Statements (segment sections)

Open **Statements** for the test party:

- [ ] **D1** Each segment appears in its **own section** (Package, Ticket, Hotel, etc.)
- [ ] **D2** Original booking line shows correct total
- [ ] **D3** Amendment line shows delta (charge/credit)
- [ ] **D4** Period total matches register
- [ ] **D5** PDF preview generates without error

### E. Sync desktop ↔ web

After amendment on desktop:

- [ ] **E1** Sync completes (no console errors)
- [ ] **E2** Web register shows same revision + history
- [ ] **E3** Web statement matches desktop

### F. Legacy removal sanity

- [ ] **F1** No errors mentioning `booking_adjustments` in browser/devtools console
- [ ] **F2** Accommodation / Services menus show “moved to Hotel/Misc” (not old ledger)
- [ ] **F3** Desktop app restart does not recreate legacy tables (optional: inspect local DB)

---

## Known items (not blockers)

| Item                        | Notes                                                                          |
| --------------------------- | ------------------------------------------------------------------------------ |
| `audit_logs` RLS disabled   | Pre-existing Supabase advisory — enable RLS + policies when ready              |
| PR #22 not merged to `main` | Vercel production may still run older code until merge                         |
| Local SQLite                | May retain old data until app restart runs `legacy_v3_drop_obsolete_tables_v1` |

---

## Sign-off

| Role    | Name | Date | Result      |
| ------- | ---- | ---- | ----------- |
| PM / QA |      |      | PASS / FAIL |

**Notes:**
