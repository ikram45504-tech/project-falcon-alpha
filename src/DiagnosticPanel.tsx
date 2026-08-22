import { useState } from "react";
import { getParties, dangerouslyEraseAllData } from "./db";
import { getChronologicalLedger, type LedgerRow } from "./LedgerEngine";

type Props = {
  companyId: string;
};

export default function DiagnosticPanel({ companyId }: Props) {
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<string[]>([]);
  const [errors, setErrors] = useState<string[]>([]);

  async function runDiagnostics() {
    setRunning(true);
    setResults([]);
    setErrors([]);

    try {
      const parties = await getParties(companyId, "");
      const allRows: { partyId: string; partyName: string; accountType: string; row: LedgerRow }[] = [];

      for (const party of parties) {
        const rows = await getChronologicalLedger(companyId, party);
        for (const row of rows) {
          if (row.status === "ACTIVE" && row.ref_no && row.ref_no.startsWith("UB-")) {
            allRows.push({ partyId: party.id, partyName: party.name, accountType: party.account_type, row });
          }
        }
      }

      const ubMap = new Map<string, { partyId: string; partyName: string }>();
      let issues = 0;

      // Check for Global UB Ownership Violations (Multiple SALE parties for same UB)
      for (const entry of allRows) {
        if (entry.row.kind === "SALE_BOOKING") {
          const existing = ubMap.get(entry.row.ref_no);
          if (existing && existing.partyId !== entry.partyId) {
            setErrors((prev) => [
              ...prev,
              `[VIOLATION] ${entry.row.ref_no} is assigned as a SALE to both "${existing.partyName}" and "${entry.partyName}".`,
            ]);
            issues++;
          } else {
            ubMap.set(entry.row.ref_no, { partyId: entry.partyId, partyName: entry.partyName });
          }
        }
      }

      setResults([
        `Total Parties Scanned: ${parties.length}`,
        `Total UB Transactions Scanned: ${allRows.length}`,
        `Unique SALE UBs Found: ${ubMap.size}`,
        `Issues Found: ${issues}`,
      ]);
    } catch (e) {
      setErrors((prev) => [...prev, `Error running diagnostics: ${e instanceof Error ? e.message : String(e)}`]);
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="security-form" style={{ maxWidth: 800 }}>
      <div className="form-head">
        <div>
          <h2>System Diagnostics & Integrity Check</h2>
          <p>
            Scan the database for logical errors, missing links, and UB ownership violations across all booking modules.
          </p>
        </div>
      </div>

      <div className="form-group" style={{ marginTop: 24 }}>
        <button type="button" className="primary" onClick={runDiagnostics} disabled={running}>
          {running ? "Scanning Database..." : "Run Database Integrity Scan"}
        </button>
      </div>

      {results.length > 0 && (
        <div
          style={{
            marginTop: 24,
            padding: 16,
            backgroundColor: "var(--bg)",
            borderRadius: 8,
            border: "1px solid var(--border)",
          }}
        >
          <h3 style={{ marginBottom: 12, fontSize: 13, color: "var(--blue)" }}>SCAN RESULTS</h3>
          <ul style={{ margin: 0, paddingLeft: 20, fontSize: 14, color: "var(--text)" }}>
            {results.map((res, i) => (
              <li key={i} style={{ marginBottom: 4 }}>
                {res}
              </li>
            ))}
          </ul>
        </div>
      )}

      {errors.length > 0 && (
        <div
          style={{
            marginTop: 24,
            padding: 16,
            backgroundColor: "var(--bg)",
            borderRadius: 8,
            border: "1px solid var(--red)",
            color: "var(--red)",
          }}
        >
          <h3 style={{ marginBottom: 12, fontSize: 13 }}>ISSUES DETECTED</h3>
          <ul style={{ margin: 0, paddingLeft: 20, fontSize: 14 }}>
            {errors.map((err, i) => (
              <li key={i} style={{ marginBottom: 4 }}>
                {err}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div style={{ marginTop: 40, paddingTop: 24, borderTop: "1px solid var(--border)" }}>
        <h3 style={{ color: "var(--red)", marginBottom: 8 }}>Danger Zone</h3>
        <p style={{ marginBottom: 16, fontSize: 14 }}>
          Wipe all booking, payment, and party data from this company to start fresh. This action cannot be undone.
        </p>
        <button
          type="button"
          className="primary"
          style={{ backgroundColor: "var(--red)" }}
          onClick={async () => {
            if (
              window.confirm(
                "Are you ABSOLUTELY sure you want to erase all data? This will wipe all parties, bookings, and payments.",
              )
            ) {
              if (window.confirm("FINAL WARNING: All data will be permanently deleted. Click OK to proceed.")) {
                setRunning(true);
                await dangerouslyEraseAllData(companyId);
                window.location.reload();
              }
            }
          }}
          disabled={running}
        >
          Erase All Data
        </button>
      </div>
    </div>
  );
}
