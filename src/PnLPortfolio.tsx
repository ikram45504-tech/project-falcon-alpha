import { useEffect, useMemo, useState } from "react";
import { getChronologicalLedger, type LedgerRow } from "./LedgerEngine";
import { getParties, type Party } from "./db";
import { downloadExcel } from "./exportUtils";
import "./BookingFinalization.css";

type Props = { companyId: string; onBack: () => void };

function money(value: number) {
  return `Rs ${Number(value || 0).toLocaleString("en-PK", { maximumFractionDigits: 2 })}`;
}

export default function PnLPortfolio({ companyId, onBack }: Props) {
  const [parties, setParties] = useState<Party[]>([]);
  const [ledgers, setLedgers] = useState<Map<string, LedgerRow[]>>(new Map());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [activeTab, setActiveTab] = useState<"UB" | "PARTY" | "SERVICE">("UB");
  const [searchUbTab, setSearchUbTab] = useState("");
  const [searchPartyTab, setSearchPartyTab] = useState("");

  useEffect(() => {
    void load();
  }, [companyId]);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const partyList = await getParties(companyId, "");
      setParties(partyList);

      const ledgerMap = new Map<string, LedgerRow[]>();
      await Promise.all(
        partyList.map(async (party) => {
          const rows = await getChronologicalLedger(companyId, party);
          ledgerMap.set(party.id, rows);
        }),
      );
      setLedgers(ledgerMap);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  // UB-Level Profitability
  const ubProfits = useMemo(() => {
    const ubMap = new Map<
      string,
      { ub: string; service: string; sale: number; purchase: number; parties: Set<string> }
    >();

    // Group all active bookings by UB AND Service
    for (const [partyId, rows] of ledgers.entries()) {
      const party = parties.find((p) => p.id === partyId);
      if (!party) continue;

      for (const row of rows) {
        if (row.status !== "ACTIVE" || !row.ref_no?.startsWith("UB-")) continue;

        const key = `${row.ref_no}|${row.service_type}`;
        const current = ubMap.get(key) || {
          ub: row.ref_no,
          service: row.service_type,
          sale: 0,
          purchase: 0,
          parties: new Set(),
        };
        if (row.kind === "SALE_BOOKING") {
          current.sale += row.total_pkr;
          if (party.account_type === "PARTY") current.parties.add(party.name);
        } else if (row.kind === "PURCHASE_BOOKING") {
          current.purchase += row.total_pkr;
        }
        ubMap.set(key, current);
      }
    }

    return Array.from(ubMap.values())
      .map((totals) => ({
        key: `${totals.ub}|${totals.service}`,
        ub: totals.ub,
        service: totals.service,
        partyNames: Array.from(totals.parties).join(", ") || "-",
        sale: totals.sale,
        purchase: totals.purchase,
        margin: totals.sale - totals.purchase,
        marginPercent: totals.sale > 0 ? ((totals.sale - totals.purchase) / totals.sale) * 100 : 0,
      }))
      .filter((item) =>
        searchUbTab
          ? item.partyNames.toLowerCase().includes(searchUbTab.toLowerCase()) ||
            item.ub.toLowerCase().includes(searchUbTab.toLowerCase())
          : true,
      )
      .sort((a, b) => a.ub.localeCompare(b.ub) || a.service.localeCompare(b.service));
  }, [ledgers, parties, searchUbTab]);

  const partyProfits = useMemo(() => {
    // 1. First, calculate the total Sale and Purchase for each UB globally
    const ubTotals = new Map<string, { sale: number; purchase: number }>();

    for (const rows of ledgers.values()) {
      for (const row of rows) {
        if (row.status !== "ACTIVE" || !row.ref_no?.startsWith("UB-")) continue;
        const current = ubTotals.get(row.ref_no) || { sale: 0, purchase: 0 };
        if (row.kind === "SALE_BOOKING") current.sale += row.total_pkr;
        else if (row.kind === "PURCHASE_BOOKING") current.purchase += row.total_pkr;
        ubTotals.set(row.ref_no, current);
      }
    }

    // 2. Map these UB profits to the Customers (Parties who have a SALE_BOOKING in that UB)
    const partyMap = new Map<string, { sale: number; purchase: number }>();

    for (const [partyId, rows] of ledgers.entries()) {
      const party = parties.find((p) => p.id === partyId);
      // We only calculate profitability for CUSTOMERS, not VENDORS. Vendors are costs.
      if (!party || party.account_type === "VENDOR") continue;

      // Find all unique UBs that this customer was billed for
      const partyUbs = new Set<string>();
      for (const row of rows) {
        if (row.status === "ACTIVE" && row.ref_no?.startsWith("UB-") && row.kind === "SALE_BOOKING") {
          partyUbs.add(row.ref_no);
        }
      }

      // Sum up the global UB totals for this party
      const current = { sale: 0, purchase: 0 };
      for (const ub of partyUbs) {
        const totals = ubTotals.get(ub);
        if (totals) {
          current.sale += totals.sale;
          current.purchase += totals.purchase;
        }
      }

      if (current.sale > 0 || current.purchase > 0) {
        partyMap.set(party.id, current);
      }
    }

    return Array.from(partyMap.entries())
      .map(([partyId, totals]) => {
        const party = parties.find((p) => p.id === partyId);
        return {
          partyName: party?.name || "Unknown",
          accountType: party?.account_type || "PARTY",
          sale: totals.sale,
          purchase: totals.purchase,
          margin: totals.sale - totals.purchase,
        };
      })
      .filter((item) => (searchPartyTab ? item.partyName.toLowerCase().includes(searchPartyTab.toLowerCase()) : true))
      .sort((a, b) => b.margin - a.margin);
  }, [ledgers, parties, searchPartyTab]);

  const serviceProfits = useMemo(() => {
    const sMap = new Map<string, { sale: number; purchase: number }>();

    for (const rows of ledgers.values()) {
      for (const row of rows) {
        if (row.status !== "ACTIVE" || !row.service_type) continue;
        const current = sMap.get(row.service_type) || { sale: 0, purchase: 0 };
        if (row.kind === "SALE_BOOKING") current.sale += row.total_pkr;
        else if (row.kind === "PURCHASE_BOOKING") current.purchase += row.total_pkr;
        sMap.set(row.service_type, current);
      }
    }

    return Array.from(sMap.entries())
      .map(([service, totals]) => ({
        service,
        sale: totals.sale,
        purchase: totals.purchase,
        margin: totals.sale - totals.purchase,
      }))
      .filter((s) => s.sale > 0 || s.purchase > 0)
      .sort((a, b) => b.margin - a.margin);
  }, [ledgers]);

  function handleExport() {
    if (activeTab === "UB") {
      const data = ubProfits.map((ub, i) => ({
        "SR #": i + 1,
        "UB Number": ub.ub,
        "Party Name": ub.partyNames,
        "Service Type": ub.service,
        "Total Sales (PKR)": ub.sale,
        "Total Purchases (PKR)": ub.purchase,
        "Gross Margin (PKR)": ub.margin,
        "Margin %": `${ub.marginPercent.toFixed(1)}%`,
      }));
      downloadExcel([{ name: "UB Profitability", data }], `UB_Profitability_${new Date().toISOString().split("T")[0]}`);
    } else if (activeTab === "PARTY") {
      const data = partyProfits.map((p, i) => ({
        "SR #": i + 1,
        "Party Name": p.partyName,
        "Account Type": p.accountType,
        "Total Sales (PKR)": p.sale,
        "Associated Purchases (PKR)": p.purchase,
        "Gross Margin (PKR)": p.margin,
      }));
      downloadExcel(
        [{ name: "Party Profitability", data }],
        `Party_Profitability_${new Date().toISOString().split("T")[0]}`,
      );
    } else if (activeTab === "SERVICE") {
      const data = serviceProfits.map((s, i) => ({
        "SR #": i + 1,
        "Service Type": s.service,
        "Total Sales (PKR)": s.sale,
        "Total Purchases (PKR)": s.purchase,
        "Gross Margin (PKR)": s.margin,
      }));
      downloadExcel(
        [{ name: "Service Profitability", data }],
        `Service_Profitability_${new Date().toISOString().split("T")[0]}`,
      );
    }
  }

  return (
    <section className="booking-entry-screen bf-page bf-ub-control">
      <div className="booking-screen-toolbar">
        <button className="booking-back-button" onClick={onBack}>
          ← Back to Dashboard
        </button>
        <span className="booking-foundation-badge active-engine">PnL PORTFOLIO</span>
      </div>

      <div className="bf-title">
        <div>
          <span className="eyebrow blue">FINANCIAL INTELLIGENCE</span>
          <h2>Profit & Loss Portfolio</h2>
          <p>Analyze exact profit margins across specific UBs, Parties, and Services.</p>
        </div>
        <div style={{ display: "flex", gap: "12px" }}>
          <button className="secondary" onClick={handleExport}>
            Export to Excel
          </button>
          <button className="secondary" onClick={() => void load()} disabled={loading}>
            {loading ? "Calculating..." : "Refresh Portfolio"}
          </button>
        </div>
      </div>

      {error && <div className="alert error">{error}</div>}

      <div
        className="dashboard-subnav"
        style={{ marginBottom: 24, borderBottom: "1px solid var(--border)", paddingBottom: 16 }}
      >
        <button className={activeTab === "UB" ? "active" : ""} onClick={() => setActiveTab("UB")}>
          UB-Level Profitability
        </button>
        <button className={activeTab === "PARTY" ? "active" : ""} onClick={() => setActiveTab("PARTY")}>
          Party-Level Profitability
        </button>
        <button className={activeTab === "SERVICE" ? "active" : ""} onClick={() => setActiveTab("SERVICE")}>
          Service-Level Profitability
        </button>
      </div>

      {activeTab === "UB" && (
        <section className="bf-card">
          <div className="bf-section-head">
            <div>
              <span>01</span>
              <div>
                <b>UMBRELLA BOOKING MARGINS (CROSS-SERVICE)</b>
                <small>Aggregated Sale minus Purchase for every UB</small>
              </div>
            </div>
            <div className="search-box" style={{ width: 300, alignSelf: "center", marginBottom: 0 }}>
              <span>🔍</span>
              <input
                type="text"
                placeholder="Search by Party or UB..."
                value={searchUbTab}
                onChange={(e) => setSearchUbTab(e.target.value)}
              />
            </div>
          </div>
          <div className="bf-table-wrap">
            <table className="bf-table">
              <thead>
                <tr>
                  <th style={{ width: 50 }}>SR #</th>
                  <th>UB NUMBER</th>
                  <th>PARTY NAME</th>
                  <th>SERVICE TYPE</th>
                  <th style={{ textAlign: "right" }}>TOTAL SALES</th>
                  <th style={{ textAlign: "right" }}>TOTAL PURCHASES</th>
                  <th style={{ textAlign: "right" }}>GROSS MARGIN</th>
                  <th style={{ textAlign: "right" }}>MARGIN %</th>
                </tr>
              </thead>
              <tbody>
                {ubProfits.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="bf-empty-cell">
                      No UBs found.
                    </td>
                  </tr>
                ) : (
                  ubProfits.map((ub, i) => (
                    <tr key={ub.key}>
                      <td style={{ color: "#778595", fontSize: 11, fontWeight: 800 }}>{i + 1}</td>
                      <td>
                        <b>{ub.ub}</b>
                      </td>
                      <td>
                        <span className="party-name">{ub.partyNames}</span>
                      </td>
                      <td>{ub.service}</td>
                      <td className="bf-money" style={{ textAlign: "right" }}>
                        {money(ub.sale)}
                      </td>
                      <td className="bf-money" style={{ textAlign: "right" }}>
                        {money(ub.purchase)}
                      </td>
                      <td
                        className="bf-money"
                        style={{
                          textAlign: "right",
                          color: ub.margin >= 0 ? "var(--green)" : "var(--red)",
                          fontWeight: 600,
                        }}
                      >
                        {money(ub.margin)}
                      </td>
                      <td style={{ textAlign: "right", color: ub.margin >= 0 ? "var(--green)" : "var(--red)" }}>
                        {ub.marginPercent.toFixed(1)}%
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {activeTab === "PARTY" && (
        <section className="bf-card">
          <div className="bf-section-head">
            <div>
              <span>02</span>
              <div>
                <b>PARTY PROFITABILITY</b>
                <small>Aggregated profit per Customer / Agent</small>
              </div>
            </div>
            <div className="search-box" style={{ width: 300, alignSelf: "center", marginBottom: 0 }}>
              <span>🔍</span>
              <input
                type="text"
                placeholder="Search party..."
                value={searchPartyTab}
                onChange={(e) => setSearchPartyTab(e.target.value)}
              />
            </div>
          </div>
          <div className="bf-table-wrap">
            <table className="bf-table">
              <thead>
                <tr>
                  <th style={{ width: 50 }}>SR #</th>
                  <th>PARTY NAME</th>
                  <th style={{ textAlign: "right" }}>TOTAL SALES</th>
                  <th style={{ textAlign: "right" }}>ASSOCIATED PURCHASES</th>
                  <th style={{ textAlign: "right" }}>GROSS MARGIN</th>
                </tr>
              </thead>
              <tbody>
                {partyProfits.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="bf-empty-cell">
                      No parties found with transactions.
                    </td>
                  </tr>
                ) : (
                  partyProfits.map((p, i) => (
                    <tr key={p.partyName}>
                      <td style={{ color: "#778595", fontSize: 11, fontWeight: 800 }}>{i + 1}</td>
                      <td>
                        <b>{p.partyName}</b> <small>({p.accountType})</small>
                      </td>
                      <td className="bf-money" style={{ textAlign: "right" }}>
                        {money(p.sale)}
                      </td>
                      <td className="bf-money" style={{ textAlign: "right" }}>
                        {money(p.purchase)}
                      </td>
                      <td
                        className="bf-money"
                        style={{
                          textAlign: "right",
                          color: p.margin >= 0 ? "var(--green)" : "var(--red)",
                          fontWeight: 600,
                        }}
                      >
                        {money(p.margin)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {activeTab === "SERVICE" && (
        <section className="bf-card">
          <div className="bf-section-head">
            <div>
              <span>03</span>
              <div>
                <b>SERVICE PROFITABILITY</b>
                <small>Aggregated profit per Service Type</small>
              </div>
            </div>
          </div>
          <div className="bf-table-wrap">
            <table className="bf-table">
              <thead>
                <tr>
                  <th>SERVICE TYPE</th>
                  <th style={{ textAlign: "right" }}>TOTAL SALES</th>
                  <th style={{ textAlign: "right" }}>TOTAL PURCHASES</th>
                  <th style={{ textAlign: "right" }}>GROSS MARGIN</th>
                </tr>
              </thead>
              <tbody>
                {serviceProfits.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="bf-empty-cell">
                      No services found.
                    </td>
                  </tr>
                ) : (
                  serviceProfits.map((s) => (
                    <tr key={s.service}>
                      <td>
                        <b>{s.service}</b>
                      </td>
                      <td className="bf-money" style={{ textAlign: "right" }}>
                        {money(s.sale)}
                      </td>
                      <td className="bf-money" style={{ textAlign: "right" }}>
                        {money(s.purchase)}
                      </td>
                      <td
                        className="bf-money"
                        style={{
                          textAlign: "right",
                          color: s.margin >= 0 ? "var(--green)" : "var(--red)",
                          fontWeight: 600,
                        }}
                      >
                        {money(s.margin)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </section>
  );
}
