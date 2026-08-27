import { jsPDF } from "jspdf";
import { writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outPath = join(__dirname, "..", "reports", "Travel-Accounting-Deep-Scan-Report.pdf");

const reportDate = "August 27, 2026";

const sections = [
  {
    title: "1. Executive Summary",
    lines: [
      "Overall Rating: 7.8 / 10",
      "Phase 1 sync (Parties, Packages, Tickets create, Payments) is production-usable.",
      "Desktop v1.0.10 tested successfully by user. Web and GitHub aligned on same commit.",
      "Hotel / Visa / Transport / Misc booking sync not yet implemented (Phase 2).",
      "MCP integrations active: Supabase, Vercel, GitHub — live deep scan enabled.",
    ],
  },
  {
    title: "2. Stack Alignment (Live Verified)",
    lines: [
      "GitHub Release: app-v1.0.10 | commit 21956e0",
      "Vercel Production: READY | commit 21956e0 | main branch",
      "Web URL: https://travel-accounting-alpha.vercel.app",
      "Desktop: v1.0.10 installer published (x64-setup.exe, MSI, Mac DMG)",
      "Supabase Project: riszmwqmjbkscpzfoumq.supabase.co",
      "GitHub Repo: ikram45504-tech/project-falcon-alpha",
      "Vercel Team: travel-soft | Project: travel-accounting | Framework: Vite",
    ],
  },
  {
    title: "3. MCP Connection Status",
    lines: [
      "Supabase MCP: CONNECTED — 20 tools (project-scoped)",
      "Vercel MCP: CONNECTED — 37 tools (Plugin active)",
      "GitHub MCP: CONNECTED — 44 tools, 4 resources",
      "All three verified with live API calls on scan date.",
    ],
  },
  {
    title: "4. Live Supabase Data (Row Counts)",
    lines: [
      "parties .......................... 2 rows",
      "package_bookings ................. 1 row (UB-1115, PURCHASE)",
      "package_booking_lines ............ 11 rows",
      "ticket_bookings .................. 0 rows",
      "ticket_booking_lines ............. 0 rows",
      "payment_entries .................. 0 rows",
      "payment_v2_meta .................. 0 rows",
      "hotel_bookings ................... 0 rows",
      "visa_bookings .................... 0 rows",
      "transport_bookings ............... 0 rows",
      "misc_bookings .................... 0 rows",
      "Total public tables in schema .. 48 tables",
      "Ticket line columns (airline_name, pnr, flight_type, ticket_route): APPLIED",
    ],
  },
  {
    title: "5. Section Ratings",
    lines: [
      "Parties / Vendors ............... 9/10  OK — full bidirectional sync",
      "Package Bookings .............. 9/10  OK — reference implementation",
      "Ticket Bookings ............... 7/10  Create OK; edit/void need polish",
      "Payments V2 ................... 8/10  Code ready; 0 rows in cloud yet",
      "Sync Engine ................... 8/10  Push/pull/reconcile working",
      "Desktop App v1.0.10 ........... 8.5/10 User confirmed working",
      "Web App (Vercel) .............. 8/10  Deploy aligned with v1.0.10",
      "Hotel/Visa/Transport/Misc ..... 3/10  Desktop-only, no cloud push",
      "Ledger / Statements ........... 5/10  Web partial (package+payments only)",
      "Supabase RLS / Security ....... 6/10  Phase 1 OK; gaps on tickets/hotel",
    ],
  },
  {
    title: "6. Security Findings (Supabase Advisor)",
    lines: [
      "RLS OK (with policies): parties, package_bookings, package_booking_lines,",
      "  payment_entries, payment_v2_meta, companies, users",
      "RLS OFF (ERROR): ticket_bookings, ticket_booking_lines, audit_logs,",
      "  booking_adjustments, package_booking_adjustments",
      "RLS ON but NO policies (~30 tables): hotel, visa, transport, misc,",
      "  operational tables — web blocked until policies added",
      "RLS uses user_metadata for company_id — flagged as insecure long-term",
      "Recommendation: migrate to app_metadata or users table join",
    ],
  },
  {
    title: "7. What's Working (Confirmed)",
    lines: [
      "Party/Vendor create, edit, delete — web ↔ desktop ↔ Supabase",
      "Package booking create/update/void — web ↔ desktop sync",
      "Package delete on web removes from desktop after Sync",
      "Ticket booking create on web (after schema column fix)",
      "Payment V2 sync code (create/update/void bundles)",
      "Auto sync every 5s + manual Sync button on desktop",
      "GitHub release pipeline — Windows + Mac installers",
      "Vercel auto-deploy from main branch",
    ],
  },
  {
    title: "8. Needs Polish (Priority Order)",
    lines: [
      "P1 — Ticket update/void cloud sync + Supabase RLS for ticket tables",
      "P1 — Payment delete reconcile on desktop pull",
      "P2 — Web ledger/totals (getPartyBookingTotals Supabase branch)",
      "P2 — Hotel booking cloud sync (mirror PackageFlowDb pattern)",
      "P3 — Visa, Transport, Misc cloud sync (one module at a time)",
      "P3 — Operational details sync (passengers, flights, hotels)",
      "P4 — Fix RLS user_metadata → secure company scoping",
      "P4 — Failed sync queue auto-retry + last synced timestamp UI",
    ],
  },
  {
    title: "9. Recommended Phase Roadmap",
    lines: [
      "Phase 1 (DONE): Parties, Packages, Ticket create, Payments, Delete reconcile",
      "Phase 2A (Next): Ticket edit/void, Ticket RLS, Payment delete reconcile",
      "Phase 2B: Hotel → Visa → Transport → Misc (one by one)",
      "Phase 3: Operational details sync, Adjustments, Audit logs",
      "Phase 4: Supabase Realtime, full RLS hardening, web statements complete",
    ],
  },
  {
    title: "10. Conclusion",
    lines: [
      "The setup is real and working — not just code on paper.",
      "Desktop v1.0.10 is suitable for daily Phase 1 operations.",
      "Web app matches desktop code (commit 21956e0).",
      "Full MCP access now enables autonomous DB/deploy/repo checks.",
      "Proceed with Phase 2A before expanding to hotel/visa modules.",
    ],
  },
];

function addWrappedText(doc, text, x, y, maxWidth, lineHeight) {
  const lines = doc.splitTextToSize(text, maxWidth);
  doc.text(lines, x, y);
  return y + lines.length * lineHeight;
}

const doc = new jsPDF({ unit: "mm", format: "a4" });
const pageW = doc.internal.pageSize.getWidth();
const margin = 18;
const maxW = pageW - margin * 2;
let y = 20;

// Cover
doc.setFont("helvetica", "bold");
doc.setFontSize(22);
doc.text("Travel Accounting", margin, y);
y += 10;
doc.setFontSize(16);
doc.text("Deep Scan Report", margin, y);
y += 8;
doc.setFont("helvetica", "normal");
doc.setFontSize(11);
doc.setTextColor(80, 80, 80);
doc.text(`Generated: ${reportDate}`, margin, y);
y += 6;
doc.text("Sources: Live Supabase + Vercel + GitHub MCP + Codebase Analysis", margin, y);
y += 6;
doc.text("Version under review: Desktop & Web v1.0.10", margin, y);
doc.setTextColor(0, 0, 0);

// Rating box
y += 12;
doc.setFillColor(240, 248, 255);
doc.rect(margin, y, maxW, 18, "F");
doc.setFont("helvetica", "bold");
doc.setFontSize(14);
doc.text("Overall Rating: 7.8 / 10", margin + 4, y + 7);
doc.setFont("helvetica", "normal");
doc.setFontSize(10);
doc.text("Phase 1 production-ready | Phase 2 polish recommended", margin + 4, y + 14);

y += 26;

for (const section of sections) {
  if (y > 260) {
    doc.addPage();
    y = 20;
  }
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.setTextColor(20, 60, 120);
  doc.text(section.title, margin, y);
  doc.setTextColor(0, 0, 0);
  y += 7;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  for (const line of section.lines) {
    if (y > 275) {
      doc.addPage();
      y = 20;
    }
    y = addWrappedText(doc, line, margin + 2, y, maxW - 4, 5);
    y += 1.5;
  }
  y += 4;
}

// Footer on all pages
const total = doc.getNumberOfPages();
for (let i = 1; i <= total; i++) {
  doc.setPage(i);
  doc.setFontSize(8);
  doc.setTextColor(120, 120, 120);
  doc.text(
    `Travel Accounting Deep Scan | ${reportDate} | Page ${i} of ${total}`,
    margin,
    doc.internal.pageSize.getHeight() - 8,
  );
}

writeFileSync(outPath, Buffer.from(doc.output("arraybuffer")));
console.log(`PDF written to: ${outPath}`);
