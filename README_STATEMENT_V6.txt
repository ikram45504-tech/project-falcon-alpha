TRAVEL ACCOUNTING — STATEMENT V6
MANUAL jsPDF A4 ENGINE

WHY V6 IS DIFFERENT
-------------------
V6 does NOT use:
- HTML table printing
- window.print()
- Microsoft Print to PDF
- React-PDF Flexbox rows
- browser-controlled row height
- browser-controlled page breaks

V6 draws the report directly on an A4 PDF canvas using exact millimeter
coordinates.

This means unused page space cannot make a transaction row taller.

MASTER DESIGN
-------------
The layout follows the compact accounting statement reference:
- company branding
- Statement of Account
- Statement Period
- Statement Ref
- 4 financial cards
- dark blue Accommodation section
- green Services section
- purple Payments section
- compact data rows
- alternating pale row background
- subtotal immediately after each section
- A4 portrait
- footer with currencies, discrepancy note, Statement Ref and Page X of Y

ROW HEIGHT RULE
---------------
For every transaction:
1. jsPDF checks each cell's actual text.
2. splitTextToSize wraps that text to the exact column width.
3. The software counts the number of lines in each cell.
4. The row height equals only the tallest cell's text height + small padding.

Therefore:
1-line transaction = short compact row
2-line transaction = slightly taller row
3-line transaction = only as tall as needed

EMPTY A4 SPACE DOES NOT CHANGE ROW HEIGHT.

PAGE BREAK RULE
---------------
Before each row the software checks:
current Y position + next row height.

If the row fits:
draw it on the current page.

If it does not fit:
create next A4 page
draw compact continuation header
repeat section title + column header
then draw the row.

The last row also reserves room for its subtotal.

PREVIEW RULE
------------
The app first builds the actual PDF Blob.

That SAME Blob is:
1. shown inside the Statement Module preview
2. written to disk when Save PDF is clicked

Therefore:
PREVIEW = SAVED PDF

INSTALL
-------

STEP 1
Close travel-accounting.

STEP 2
VS Code Terminal:
Ctrl + C

STEP 3 — INSTALL jsPDF
Run:

npm.cmd install jspdf

jsPDF = the PDF drawing engine.

If you already installed Dialog and FS during V5, DO NOT add them again.

If you did NOT install them previously, run:

npm.cmd run tauri add dialog
npm.cmd run tauri add fs

STEP 4 — COPY FILES
From this ZIP copy:

src\Statements.tsx
src\StatementJsPdf.ts
src\App.css

Paste into:

C:\Users\LAPTOOL TECHNOLOGY\travel-accounting\src

Choose Replace for:
Statements.tsx
App.css

StatementJsPdf.ts is NEW.

STEP 5 — CAPABILITY
Copy:

src-tauri\capabilities\default.json

Paste into:

C:\Users\LAPTOOL TECHNOLOGY\travel-accounting\src-tauri\capabilities

Choose Replace.

STEP 6 — START
Run:

npm.cmd run tauri dev

FIRST TEST
----------
1. Login.
2. Open Statements.
3. Select your test party.
4. Select FULL LEDGER.
5. Refresh Preview.
6. Check the ACTUAL PDF preview.
7. Accommodation rows must be compact.
8. Services rows must be compact.
9. Payments rows must be compact.
10. Subtotals must sit immediately after rows.
11. Click Save PDF.
12. Open the saved PDF.

IMPORTANT:
Do NOT use Microsoft Print to PDF.
Use the application's Save PDF button.

DATA SAFETY
-----------
Do NOT delete the SQLite database.
Do NOT recreate company.
Do NOT delete any Party / Accommodation / Services / Payments data.

OLD PACKAGE
-----------
You may leave @react-pdf/renderer installed. V6 does not import or use it.
If everything works later, it can be removed as cleanup.

ACCOUNTING LOGIC
----------------
Opening Balance =
Purchases before From Date
minus
Payments before From Date

Closing Balance =
Opening Balance
+ Purchases during selected period
- Payments during selected period

Period filtering continues to use TRANSACTION DATE, not Check-In date.
