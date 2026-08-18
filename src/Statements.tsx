import { useEffect, useMemo, useState } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";
import { downloadDir, join } from "@tauri-apps/api/path";

import {
  AccommodationEntry,
  Company,
  Party,
  PaymentEntry,
  ServiceEntry,
  getAccommodations,
  getPayments,
  getServices,
} from "./db";

import {
  buildStatementPdf,
  StatementPdfData,
} from "./StatementJsPdf";

type PeriodType =
  | "FULL_LEDGER"
  | "THIS_MONTH"
  | "LAST_MONTH"
  | "CUSTOM";

type Props = {
  company: Company;
  parties: Party[];
  initialPartyId?: string;
  onOpenLedger: (party: Party) => void;
};

function todayIso() {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function isoFromDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function thisMonthRange() {
  const now = new Date();
  return {
    from: isoFromDate(
      new Date(now.getFullYear(), now.getMonth(), 1)
    ),
    to: todayIso(),
  };
}

function lastMonthRange() {
  const now = new Date();
  return {
    from: isoFromDate(
      new Date(now.getFullYear(), now.getMonth() - 1, 1)
    ),
    to: isoFromDate(
      new Date(now.getFullYear(), now.getMonth(), 0)
    ),
  };
}

function generatedDate() {
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  })
    .format(new Date())
    .replace(/ /g, "-");
}

function makeStatementRef() {
  const now = new Date();

  const date =
    `${now.getFullYear()}` +
    `${String(now.getMonth() + 1).padStart(2, "0")}` +
    `${String(now.getDate()).padStart(2, "0")}`;

  const time =
    `${String(now.getHours()).padStart(2, "0")}` +
    `${String(now.getMinutes()).padStart(2, "0")}` +
    `${String(now.getSeconds()).padStart(2, "0")}`;

  return `FT-${date}-${time}`;
}

function safeFileName(text: string) {
  return text
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, "_");
}

function activeOnly<T extends { status: string }>(rows: T[]) {
  return rows.filter((row) => row.status === "ACTIVE");
}

function inPeriod(date: string, from: string, to: string) {
  return date >= from && date <= to;
}

function beforePeriod(date: string, from: string) {
  return date < from;
}

function sum<T>(
  rows: T[],
  selector: (row: T) => number
) {
  return rows.reduce(
    (total, row) => total + Number(selector(row) || 0),
    0
  );
}

function formatDate(value: string) {
  if (!value) return "—";

  const [y, m, d] = value.split("-").map(Number);

  if (!y || !m || !d) return value;

  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  })
    .format(new Date(y, m - 1, d))
    .replace(/ /g, "-");
}

export default function StatementsModule({
  company,
  parties,
  initialPartyId = "",
  onOpenLedger,
}: Props) {
  const [partyId, setPartyId] = useState(
    initialPartyId || parties[0]?.id || ""
  );

  const [periodType, setPeriodType] =
    useState<PeriodType>("FULL_LEDGER");

  const [fromDate, setFromDate] = useState(todayIso());
  const [toDate, setToDate] = useState(todayIso());

  const [allAccommodation, setAllAccommodation] =
    useState<AccommodationEntry[]>([]);

  const [allServices, setAllServices] =
    useState<ServiceEntry[]>([]);

  const [allPayments, setAllPayments] =
    useState<PaymentEntry[]>([]);

  const [statementRef, setStatementRef] =
    useState(makeStatementRef());

  const [generatedOn, setGeneratedOn] =
    useState(generatedDate());

  const [previewUrl, setPreviewUrl] = useState("");
  const [pdfBlob, setPdfBlob] = useState<Blob | null>(null);

  const [loading, setLoading] = useState(false);
  const [buildingPdf, setBuildingPdf] = useState(false);
  const [savingPdf, setSavingPdf] = useState(false);

  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const selectedParty = useMemo(
    () =>
      parties.find((party) => party.id === partyId) ?? null,
    [parties, partyId]
  );

  useEffect(() => {
    if (
      initialPartyId &&
      parties.some((party) => party.id === initialPartyId)
    ) {
      setPartyId(initialPartyId);
    } else if (!partyId && parties[0]) {
      setPartyId(parties[0].id);
    }
  }, [initialPartyId, parties]);

  useEffect(() => {
    if (!partyId) {
      setAllAccommodation([]);
      setAllServices([]);
      setAllPayments([]);
      return;
    }

    loadPartyTransactions(partyId);
  }, [company.id, partyId]);

  async function loadPartyTransactions(
    selectedPartyId: string
  ) {
    setLoading(true);
    setError("");
    setMessage("");

    try {
      const [
        accommodationRows,
        serviceRows,
        paymentRows,
      ] = await Promise.all([
        getAccommodations(
          company.id,
          "",
          selectedPartyId
        ),
        getServices(
          company.id,
          "",
          selectedPartyId
        ),
        getPayments(
          company.id,
          "",
          selectedPartyId
        ),
      ]);

      const accommodation =
        activeOnly(accommodationRows);

      const services =
        activeOnly(serviceRows);

      const payments =
        activeOnly(paymentRows);

      setAllAccommodation(accommodation);
      setAllServices(services);
      setAllPayments(payments);

      applyAutomaticPeriod(
        periodType,
        accommodation,
        services,
        payments
      );

      refreshStatementIdentity();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : String(e)
      );
    } finally {
      setLoading(false);
    }
  }

  function applyAutomaticPeriod(
    type: PeriodType,
    accommodation = allAccommodation,
    services = allServices,
    payments = allPayments
  ) {
    if (type === "CUSTOM") return;

    if (type === "THIS_MONTH") {
      const range = thisMonthRange();
      setFromDate(range.from);
      setToDate(range.to);
      return;
    }

    if (type === "LAST_MONTH") {
      const range = lastMonthRange();
      setFromDate(range.from);
      setToDate(range.to);
      return;
    }

    const dates = [
      ...accommodation.map(
        (row) => row.transaction_date
      ),
      ...services.map(
        (row) => row.transaction_date
      ),
      ...payments.map(
        (row) => row.transaction_date
      ),
    ]
      .filter(Boolean)
      .sort();

    if (dates.length) {
      setFromDate(dates[0]);
      setToDate(dates[dates.length - 1]);
    } else {
      const today = todayIso();
      setFromDate(today);
      setToDate(today);
    }
  }

  function changePeriod(type: PeriodType) {
    setPeriodType(type);
    setError("");
    setMessage("");

    applyAutomaticPeriod(type);
    refreshStatementIdentity();
  }

  function refreshStatementIdentity() {
    setStatementRef(makeStatementRef());
    setGeneratedOn(generatedDate());
  }

  function validatePeriod() {
    if (!partyId) {
      setError("Select a Party / Vendor.");
      return false;
    }

    if (!fromDate || !toDate) {
      setError(
        "Select both From Date and To Date."
      );
      return false;
    }

    if (fromDate > toDate) {
      setError(
        "From Date cannot be after To Date."
      );
      return false;
    }

    return true;
  }

  function refreshPreview() {
    if (!validatePeriod()) return;

    setError("");
    setMessage("");
    refreshStatementIdentity();
  }

  const periodAccommodation = useMemo(
    () =>
      allAccommodation
        .filter((row) =>
          inPeriod(
            row.transaction_date,
            fromDate,
            toDate
          )
        )
        .sort(
          (a, b) =>
            a.transaction_date.localeCompare(
              b.transaction_date
            ) ||
            a.created_at.localeCompare(
              b.created_at
            )
        ),
    [allAccommodation, fromDate, toDate]
  );

  const periodServices = useMemo(
    () =>
      allServices
        .filter((row) =>
          inPeriod(
            row.transaction_date,
            fromDate,
            toDate
          )
        )
        .sort(
          (a, b) =>
            a.transaction_date.localeCompare(
              b.transaction_date
            ) ||
            a.created_at.localeCompare(
              b.created_at
            )
        ),
    [allServices, fromDate, toDate]
  );

  const periodPayments = useMemo(
    () =>
      allPayments
        .filter((row) =>
          inPeriod(
            row.transaction_date,
            fromDate,
            toDate
          )
        )
        .sort(
          (a, b) =>
            a.transaction_date.localeCompare(
              b.transaction_date
            ) ||
            a.created_at.localeCompare(
              b.created_at
            )
        ),
    [allPayments, fromDate, toDate]
  );

  const openingPurchases = useMemo(
    () =>
      sum(
        allAccommodation.filter((row) =>
          beforePeriod(
            row.transaction_date,
            fromDate
          )
        ),
        (row) => row.total_pkr
      ) +
      sum(
        allServices.filter((row) =>
          beforePeriod(
            row.transaction_date,
            fromDate
          )
        ),
        (row) => row.total_pkr
      ),
    [allAccommodation, allServices, fromDate]
  );

  const openingPayments = useMemo(
    () =>
      sum(
        allPayments.filter((row) =>
          beforePeriod(
            row.transaction_date,
            fromDate
          )
        ),
        (row) => row.paid_amount
      ),
    [allPayments, fromDate]
  );

  const openingBalance =
    openingPurchases - openingPayments;

  const accommodationSubtotal = sum(
    periodAccommodation,
    (row) => row.total_pkr
  );

  const servicesSubtotal = sum(
    periodServices,
    (row) => row.total_pkr
  );

  const purchasesDuringPeriod =
    accommodationSubtotal +
    servicesSubtotal;

  const paymentsDuringPeriod = sum(
    periodPayments,
    (row) => row.paid_amount
  );

  const closingBalance =
    openingBalance +
    purchasesDuringPeriod -
    paymentsDuringPeriod;

  const pdfData =
    useMemo<StatementPdfData | null>(() => {
      if (
        !selectedParty ||
        !fromDate ||
        !toDate
      ) {
        return null;
      }

      return {
        company,
        party: selectedParty,
        fromDate,
        toDate,
        generatedOn,
        statementRef,
        openingBalance,
        purchasesDuringPeriod,
        paymentsDuringPeriod,
        closingBalance,
        accommodationSubtotal,
        servicesSubtotal,
        accommodation:
          periodAccommodation,
        services: periodServices,
        payments: periodPayments,
      };
    }, [
      company,
      selectedParty,
      fromDate,
      toDate,
      generatedOn,
      statementRef,
      openingBalance,
      purchasesDuringPeriod,
      paymentsDuringPeriod,
      closingBalance,
      accommodationSubtotal,
      servicesSubtotal,
      periodAccommodation,
      periodServices,
      periodPayments,
    ]);

  useEffect(() => {
    let cancelled = false;
    let nextUrl = "";

    async function buildPreview() {
      if (!pdfData) {
        setPdfBlob(null);
        setPreviewUrl("");
        return;
      }

      setBuildingPdf(true);
      setError("");

      try {
        const doc = buildStatementPdf(pdfData);
        const blob = doc.output("blob");

        if (cancelled) return;

        nextUrl = URL.createObjectURL(blob);

        setPdfBlob(blob);
        setPreviewUrl(nextUrl);
      } catch (e) {
        if (!cancelled) {
          setError(
            `Could not build statement PDF: ${
              e instanceof Error
                ? e.message
                : String(e)
            }`
          );
        }
      } finally {
        if (!cancelled) {
          setBuildingPdf(false);
        }
      }
    }

    buildPreview();

    return () => {
      cancelled = true;

      if (nextUrl) {
        URL.revokeObjectURL(nextUrl);
      }
    };
  }, [pdfData]);

  async function savePdf() {
    if (
      !pdfBlob ||
      !pdfData ||
      !selectedParty
    ) {
      setError(
        "Statement PDF is not ready yet."
      );
      return;
    }

    if (!validatePeriod()) return;

    setSavingPdf(true);
    setError("");
    setMessage("");

    try {
      const bytes = new Uint8Array(
        await pdfBlob.arrayBuffer()
      );

      const fileName =
        `${safeFileName(company.name)}_Statement_` +
        `${safeFileName(selectedParty.name)}_` +
        `${fromDate}_to_${toDate}.pdf`;

      const defaultPath = await join(
        await downloadDir(),
        fileName
      );

      const filePath = await save({
        title: "Save Statement PDF",
        defaultPath,
        filters: [
          {
            name: "PDF Document",
            extensions: ["pdf"],
          },
        ],
      });

      if (!filePath) return;

      await writeFile(filePath, bytes);

      setMessage(
        "PDF saved successfully."
      );
    } catch (e) {
      setError(
        `Could not save PDF: ${
          e instanceof Error
            ? e.message
            : String(e)
        }`
      );
    } finally {
      setSavingPdf(false);
    }
  }

  if (!parties.length) {
    return (
      <section className="content-card statement-no-party">
        <span className="eyebrow blue">
          STATEMENT GENERATOR
        </span>

        <h2>
          No Party / Vendor available
        </h2>

        <p>
          Create at least one Party / Vendor
          before generating an account statement.
        </p>
      </section>
    );
  }

  return (
    <section className="statement-v6-page">
      <div className="statement-v6-controls">
        <div className="statement-v6-title-row">
          <div>
            <span className="eyebrow blue">
              MANUAL A4 PDF ENGINE
            </span>

            <h2>
              Statement of Account
            </h2>

            <p>
              The preview below is the exact PDF
              that will be saved. Rows and page
              breaks are drawn at fixed A4
              coordinates.
            </p>
          </div>

          {selectedParty && (
            <button
              className="secondary"
              onClick={() =>
                onOpenLedger(selectedParty)
              }
            >
              Open Party Ledger
            </button>
          )}
        </div>

        {error && (
          <div className="alert error">
            {error}
          </div>
        )}

        {message && (
          <div className="alert success">
            {message}
          </div>
        )}

        <div className="statement-v6-form">
          <label>
            Party / Vendor
            <select
              value={partyId}
              onChange={(e) => {
                setPartyId(e.target.value);
                setError("");
                setMessage("");
              }}
            >
              {parties.map((party) => (
                <option
                  key={party.id}
                  value={party.id}
                >
                  {party.name}
                  {party.status === "INACTIVE"
                    ? " (INACTIVE)"
                    : ""}
                </option>
              ))}
            </select>
          </label>

          <label>
            Period Type
            <select
              value={periodType}
              onChange={(e) =>
                changePeriod(
                  e.target.value as PeriodType
                )
              }
            >
              <option value="FULL_LEDGER">
                FULL LEDGER
              </option>

              <option value="THIS_MONTH">
                THIS MONTH
              </option>

              <option value="LAST_MONTH">
                LAST MONTH
              </option>

              <option value="CUSTOM">
                CUSTOM DATE RANGE
              </option>
            </select>
          </label>

          <label>
            From Date
            <input
              type="date"
              value={fromDate}
              disabled={
                periodType !== "CUSTOM"
              }
              onChange={(e) => {
                setFromDate(e.target.value);
                setError("");
                setMessage("");
              }}
            />
          </label>

          <label>
            To Date
            <input
              type="date"
              value={toDate}
              disabled={
                periodType !== "CUSTOM"
              }
              onChange={(e) => {
                setToDate(e.target.value);
                setError("");
                setMessage("");
              }}
            />
          </label>
        </div>

        <div className="statement-v6-actions">
          <div className="statement-v6-period">
            <small>
              SELECTED PERIOD
            </small>

            <b>
              {formatDate(fromDate)}
              {" → "}
              {formatDate(toDate)}
            </b>
          </div>

          <div className="statement-v6-badge">
            EXACT PDF PREVIEW
          </div>

          <button
            className="secondary"
            onClick={refreshPreview}
            disabled={loading}
          >
            {loading
              ? "Loading..."
              : "Refresh Preview"}
          </button>

          <button
            className="primary statement-v6-save"
            onClick={savePdf}
            disabled={
              savingPdf ||
              buildingPdf ||
              loading ||
              !pdfBlob
            }
          >
            {savingPdf
              ? "Saving..."
              : buildingPdf
              ? "Building PDF..."
              : "Save PDF"}
          </button>
        </div>
      </div>

      <div className="statement-v6-preview-shell">
        {previewUrl ? (
          <iframe
            className="statement-v6-pdf-viewer"
            src={`${previewUrl}#toolbar=0&navpanes=0&scrollbar=1`}
            title="Statement PDF Preview"
          />
        ) : (
          <div className="statement-v6-loading">
            {buildingPdf
              ? "Building exact A4 statement..."
              : "Preparing statement..."}
          </div>
        )}
      </div>
    </section>
  );
}
