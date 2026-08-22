# Travel Accounting & Booking Management

A high-performance, locally-hosted desktop application designed specifically for travel agencies and accounting teams. Built for maximum speed, security, and offline reliability.

## 🚀 Technology Stack

This application is powered by a modern, high-efficiency architecture:

- **Frontend:** React + TypeScript + Vite (Lightning-fast UI)
- **Backend / Engine:** Rust + Tauri v2 (Near-zero memory footprint and native OS integration)
- **Database:** SQLite (Local, secure, serverless data storage)
- **Styling:** CSS + Tailwind (Responsive, clean, and modern Dark/Light mode)

## 📦 Core Features

- **Dashboard & Analytics:** Real-time business insights.
- **Client & Vendor Management:** Manage counterparties, ledgers, and balances.
- **Booking Engine:** Package creation, multi-hotel tiers, and pricing algorithms.
- **Payment & Receipt Vouchers:** Secure double-entry accounting features with auto-incrementing document numbers.
- **Reporting:** Export detailed accounting ledgers directly to Microsoft Excel.

## 🛠️ Developer Setup

If you need to run the application locally for development or testing:

1. Ensure **Node.js** (v20+) and **Rust** are installed on your machine.
2. Install frontend dependencies:
   ```bash
   npm install
   ```
3. Run the development server (opens the app locally):
   ```bash
   npm run tauri dev
   ```
4. Build for production (Generates `.exe` or `.dmg`):
   ```bash
   npm run build
   ```

## ☁️ CI/CD Pipeline

This repository is configured with an automated **GitHub Actions Pipeline**.
Whenever new code is pushed to the `main` branch, GitHub's cloud servers will automatically compile the code and generate the production installers (Windows `.msi` and macOS `.dmg`) on the **Releases** page. The app includes a built-in Auto-Updater that will seamlessly deliver these updates to users.
