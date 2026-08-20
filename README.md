# Travel Accounting

A desktop accounting workspace for travel businesses. It manages company access, customer and vendor accounts, service bookings, settlements, ledgers, and statements in a local SQLite-backed Tauri application.

## What it covers

- Company setup, sign-in, remembered sessions, and role-based access
- Party/customer and vendor/supplier account management
- Sale and purchase bookings for Package, Ticket, Hotel, Visa, Transport, and Misc services
- Booking lifecycle controls: open, adjust, review history, and void
- Party receipts and vendor payments, with PKR and SAR support
- Account ledgers and service-wise statements with PDF export
- Audit-aware, atomic SQLite writes for critical bookings and payments
- Automatic safety checks for payment document numbers and a backend database-backup command

## Technology

- Desktop shell: [Tauri 2](https://v2.tauri.app/)
- Frontend: React 19, TypeScript, and Vite
- Local data: SQLite through `@tauri-apps/plugin-sql`
- Backend safety layer: Rust, Tauri commands, and SQLx
- PDF generation: jsPDF and `@react-pdf/renderer`

## Requirements

- Node.js 22 (the CI version)
- npm
- Rust stable and Cargo
- Platform prerequisites required by Tauri for your operating system

For Linux development, install the Tauri/WebKit build packages before running the Rust checks. The repository's GitHub Actions workflow contains the current Ubuntu package list.

## Get started

```bash
git clone https://github.com/ikram45504-tech/travel-accounting.git
cd travel-accounting
npm ci
npm run tauri dev
```

Tauri starts the Vite development server on port 1420. To run only the browser frontend during UI development:

```bash
npm run dev
```

## Build and verify

```bash
# Type-check and create the frontend bundle
npm run build

# Run the Rust backend and database-safety tests
cargo test --manifest-path src-tauri/Cargo.toml --lib
```

Pull requests to `main` run the **Verify App** GitHub Actions workflow. It installs dependencies, checks TypeScript, creates a Vite production build, and runs the Rust library tests.

## Project layout

```text
src/                    React workspace, booking modules, payments, ledgers, and statements
src/BookingAccounting.ts Shared booking accounting read model
src/PaymentV2Db.ts      Payment validation, metadata, and transactional writes
src/DatabaseSafety.ts   Frontend bridge to the Rust database-safety layer
src-tauri/              Tauri configuration and Rust backend
.github/workflows/      Pull-request verification workflow
```

## Data and accounting notes

The application uses a local SQLite database named `travel-accounting.db`. Critical multi-statement booking and payment operations use the Rust safety layer so they can commit or roll back together. Before editing existing data or deploying a new build, keep a tested backup and validate the workflow against a copy of real data.

Payment receipt and voucher numbers are enforced as case-insensitively unique per company. If historical duplicates exist, resolve them before recording new payments.

## Contributing

1. Create a feature branch from `main`.
2. Keep changes focused and avoid destructive schema changes.
3. Run the build and Rust test commands above.
4. Open a pull request against `main`; GitHub Actions will run **Verify App**.

## Status

The core booking, payment, ledger, statement, and database-safety flows are implemented. Continue using pull requests and test against representative local data before treating any release as production-ready.
