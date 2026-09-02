import type { StatementPdfData } from "./StatementJsPdf";
import {
  buildStatementReconciliationRows,
  buildStatementViewSections,
  type StatementViewCell,
  type StatementViewRow,
  type StatementViewSection,
} from "./StatementViewSections";
import "./StatementDocument.css";

function money(value: number) {
  return `Rs ${Number(value || 0).toLocaleString("en-PK", { maximumFractionDigits: 2 })}`;
}

function sar(value: number) {
  return `SAR ${Number(value || 0).toLocaleString("en-PK", { maximumFractionDigits: 2 })}`;
}

function formatDate(value: string) {
  if (!value) return "—";
  const [y, m, d] = value.split("-").map(Number);
  if (!y || !m || !d) return value;
  return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" })
    .format(new Date(y, m - 1, d))
    .replace(/ /g, "-");
}

function formatSubtotal(subtotal: StatementViewSection["subtotal"]) {
  const parts: string[] = [];
  if (subtotal.sar != null && subtotal.sar !== 0) parts.push(sar(subtotal.sar));
  if (subtotal.pkr != null) parts.push(money(subtotal.pkr));
  if (subtotal.pendingSar) parts.push(`Pending ${sar(subtotal.pendingSar)}`);
  return parts.join(" | ");
}

function cellAlignClass(align?: StatementViewCell["align"]) {
  if (align === "right") return "align-right";
  if (align === "center") return "align-center";
  return "align-left";
}

function gridTemplateColumns(columns: StatementViewSection["columns"]) {
  const total = columns.reduce((sum, column) => sum + column.width, 0);
  return columns.map((column) => `${((column.width / total) * 100).toFixed(3)}fr`).join(" ");
}

function renderGridRow(section: StatementViewSection, row: StatementViewRow, rowIndex: number, columns: string) {
  return (
    <div
      key={`${section.title}-${rowIndex}`}
      className={[
        "statement-grid-row",
        row.kind === "adjustment" ? "adjustment" : row.kind === "reference" ? "reference" : "",
        row.bookingGroup ? "booking-group" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      style={{ gridTemplateColumns: columns }}
    >
      {row.cells.map((cell, cellIndex) => (
        <div
          key={`${section.title}-${rowIndex}-${cellIndex}`}
          className={[
            "statement-grid-cell",
            cellAlignClass(cell.align || section.columns[cellIndex]?.align),
            cell.bold ? "bold" : "",
          ]
            .filter(Boolean)
            .join(" ")}
        >
          <span className="cell-primary">{cell.text}</span>
          {cell.secondary ? <span className="cell-secondary">{cell.secondary}</span> : null}
        </div>
      ))}
    </div>
  );
}

function groupSectionRows(rows: StatementViewRow[]) {
  const groups: Array<{ bookingKey?: string; rows: StatementViewRow[] }> = [];
  for (const row of rows) {
    const last = groups[groups.length - 1];
    if (row.bookingKey && last?.bookingKey === row.bookingKey) {
      last.rows.push(row);
      continue;
    }
    groups.push({ bookingKey: row.bookingKey, rows: [row] });
  }
  return groups;
}

function StatementSectionTable({ section }: { section: StatementViewSection }) {
  if (!section.rows.length) return null;
  const columns = gridTemplateColumns(section.columns);
  const rowGroups = groupSectionRows(section.rows);
  return (
    <div className="statement-doc-section">
      <div className="statement-doc-section-card">
        <div className="statement-doc-section-title">{section.title}</div>
        <div className="statement-doc-table-wrap">
          <div className="statement-grid-table">
            <div className="statement-grid-head-row" style={{ gridTemplateColumns: columns }}>
              {section.columns.map((column, index) => (
                <div
                  key={`${section.title}-head-${index}`}
                  className={`statement-grid-head ${cellAlignClass(column.align)}`}
                >
                  {column.header}
                </div>
              ))}
            </div>
            {rowGroups.map((group, groupIndex) =>
              group.bookingKey ? (
                <div
                  key={`${section.title}-group-${group.bookingKey}-${groupIndex}`}
                  className="statement-booking-block"
                >
                  {group.rows.map((row, rowIndex) => renderGridRow(section, row, groupIndex * 100 + rowIndex, columns))}
                </div>
              ) : (
                group.rows.map((row, rowIndex) => renderGridRow(section, row, groupIndex * 100 + rowIndex, columns))
              ),
            )}
          </div>
        </div>
        <div className="statement-doc-subtotal">
          <span>{section.subtotal.label}</span>
          <span>{formatSubtotal(section.subtotal)}</span>
        </div>
      </div>
    </div>
  );
}

export default function StatementDocument({ data }: { data: StatementPdfData }) {
  const isVendor = data.party.account_type === "VENDOR";
  const directionTitle = isVendor ? "PURCHASE / PAYABLE STATEMENT" : "SALE / RECEIVABLE STATEMENT";
  const bookedLabel = isVendor ? "PURCHASE ACTIVITY" : "SALE ACTIVITY";
  const balanceLabel = isVendor ? "PAYABLE BALANCE" : "RECEIVABLE BALANCE";
  const contacts = [data.company.phone, data.company.whatsapp, data.company.email].filter(Boolean).join(" · ");
  const sections = buildStatementViewSections(data);
  const reconciliationRows = buildStatementReconciliationRows(data);
  const printView = data.previewMode === "print";

  return (
    <div className={`statement-doc-shell ${printView ? "statement-doc-print" : ""}`}>
      <article className="statement-doc-paper">
        <header className="statement-doc-head">
          <div className="statement-doc-company">
            <h1>{data.company.name}</h1>
            {data.company.address && <p>{data.company.address}</p>}
            {contacts && <p>{contacts}</p>}
          </div>
          <div className="statement-doc-title">
            <h2>STATEMENT OF ACCOUNT</h2>
            <p>{directionTitle}</p>
          </div>
        </header>

        <div className="statement-doc-meta">
          <div>
            <b>Account:</b> {data.party.name}
          </div>
          <div>
            <b>Account type:</b> {data.party.account_type}
          </div>
          <div>
            <b>Period:</b> {formatDate(data.fromDate)} to {formatDate(data.toDate)}
          </div>
          <div>
            <b>Statement ref:</b> {data.statementRef}
          </div>
          <div>
            <b>Generated:</b> {data.generatedOn}
          </div>
        </div>

        <div className="statement-doc-glance">
          <div className="statement-doc-glance-item">
            <small>OPENING BALANCE</small>
            <b>{money(data.openingBalance)}</b>
          </div>
          <div className="statement-doc-glance-item">
            <small>{bookedLabel}</small>
            <b>{money(data.bookingsDuringPeriod)}</b>
          </div>
          <div className="statement-doc-glance-item">
            <small>PAYMENTS</small>
            <b>{money(data.paymentsDuringPeriod)}</b>
          </div>
          <div className="statement-doc-glance-item">
            <small>{balanceLabel}</small>
            <b>{money(data.closingBalance)}</b>
          </div>
          <div className="statement-doc-glance-item">
            <small>PENDING SAR</small>
            <b>{sar(data.pendingSarBalance)}</b>
          </div>
        </div>

        {sections.map((section) => (
          <StatementSectionTable key={section.title} section={section} />
        ))}

        {data.includeReconciliation && (
          <div className="statement-doc-recon">
            <h3>FINAL RECONCILIATION</h3>
            {reconciliationRows.map(([label, amount]) => (
              <div key={label} className="statement-doc-recon-row">
                <span>{label}</span>
                <b>{money(amount)}</b>
              </div>
            ))}
            <div className="statement-doc-recon-row total">
              <span>Total commercial activity</span>
              <b>{money(data.bookingsDuringPeriod)}</b>
            </div>
            <div className="statement-doc-recon-row">
              <span>Less: payments</span>
              <b>{money(data.paymentsDuringPeriod)}</b>
            </div>
            <div className="statement-doc-recon-row">
              <span>Add: opening balance</span>
              <b>{money(data.openingBalance)}</b>
            </div>
            <div className="statement-doc-recon-row closing">
              <span>{balanceLabel}</span>
              <b>{money(data.closingBalance)}</b>
            </div>
            <div className="statement-doc-recon-row pending">
              <span>Pending SAR conversion</span>
              <b>{sar(data.pendingSarBalance)}</b>
            </div>
          </div>
        )}

        <p className="statement-doc-note">
          Original booking lines shown after an amendment are reference only — amounts are not counted again. The
          adjustment row under each UB shows the booking total and period account impact.
        </p>

        {data.includeLedger && data.ledgerRows && data.ledgerRows.length > 0 && (
          <div className="statement-doc-section">
            <div className="statement-doc-section-card">
              <div className="statement-doc-section-title">FINANCIAL LEDGER SUMMARY</div>
              <div className="statement-doc-table-wrap">
                <div className="statement-grid-table">
                  <div
                    className="statement-grid-head-row"
                    style={{ gridTemplateColumns: "0.9fr 1.2fr 1.8fr 0.9fr 0.9fr 1fr" }}
                  >
                    {["DATE", "REF NO.", "DESCRIPTION", "DEBIT", "CREDIT", "BALANCE"].map((label, index) => (
                      <div key={label} className={`statement-grid-head ${index >= 3 ? "align-right" : "align-left"}`}>
                        {label}
                      </div>
                    ))}
                  </div>
                  {data.ledgerRows.map((row) => (
                    <div
                      key={row.id + row.transaction_date}
                      className="statement-grid-row"
                      style={{ gridTemplateColumns: "0.9fr 1.2fr 1.8fr 0.9fr 0.9fr 1fr" }}
                    >
                      <div className="statement-grid-cell align-left">{formatDate(row.transaction_date)}</div>
                      <div className="statement-grid-cell align-left">{row.ref_no || "—"}</div>
                      <div className="statement-grid-cell align-left">{row.description}</div>
                      <div className="statement-grid-cell align-right">{row.debit ? money(row.debit) : "—"}</div>
                      <div className="statement-grid-cell align-right">{row.credit ? money(row.credit) : "—"}</div>
                      <div className="statement-grid-cell align-right bold">{money(row.running_balance)}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
      </article>
    </div>
  );
}
