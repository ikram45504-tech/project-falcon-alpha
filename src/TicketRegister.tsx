import { useEffect, useMemo, useState } from "react";
import type { BookingTransactionType } from "./db";
import { deleteBooking } from "./db";
import { getTicketCommercialBookings, voidTicketCommercialBooking, type TicketCommercialBooking } from "./TicketFlowDb";
import { getTicketAdjustmentSummaryMap, type TicketAdjustmentSummary } from "./TicketAdjustmentDb";
import { bookingLifecycleConfigs, type BookingLifecycleStatus } from "./BookingLifecycle";
import BookingLifecycleActions from "./BookingLifecycleActions";
import TicketBookingAdjustment from "./TicketBookingAdjustment";
import "./BookingLifecycleCenter.css";
import "./PackageBookingFlow.css";

type Filter = "ALL" | BookingTransactionType;

type Props = {
  companyId: string;
  transactionType: BookingTransactionType;
  userId?: string;
  canEdit?: boolean;
  canVoid?: boolean;
  onBack: () => void;
  onOpenBooking?: (bookingId: string) => void | Promise<void>;
  onChanged?: () => void | Promise<void>;
};

const config = bookingLifecycleConfigs.TICKET;

function money(value: number) {
  return `Rs ${Number(value || 0).toLocaleString("en-PK", { maximumFractionDigits: 2 })}`;
}

function flightLabel(value: string) {
  if (value === "ONE_WAY") return "One Way";
  if (value === "MULTI_CITY") return "Multi-City";
  return "Return";
}

function bookingSummary(booking: TicketCommercialBooking) {
  return (
    booking.lines
      .map(
        (line) =>
          `${line.passenger_name} · ${line.airline_name} · ${line.ticket_route} · ${line.ticket_count} ticket(s)`,
      )
      .join(" | ") || "Ticket booking"
  );
}

export default function TicketRegister({
  companyId,
  transactionType,
  userId = "",
  canEdit = true,
  canVoid = true,
  onBack,
  onOpenBooking,
  onChanged,
}: Props) {
  const [bookings, setBookings] = useState<TicketCommercialBooking[]>([]);
  const [summaries, setSummaries] = useState<Record<string, TicketAdjustmentSummary>>({});
  const [filter, setFilter] = useState<Filter>(transactionType);
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [adjustmentBooking, setAdjustmentBooking] = useState<TicketCommercialBooking | null>(null);
  const [historyBooking, setHistoryBooking] = useState<TicketCommercialBooking | null>(null);
  const [previewBooking, setPreviewBooking] = useState<TicketCommercialBooking | null>(null);

  useEffect(() => {
    setFilter(transactionType);
  }, [transactionType]);

  useEffect(() => {
    void load();
  }, [companyId]);

  async function load(nextSearch = search) {
    try {
      const [raw, nextSummaries] = await Promise.all([
        getTicketCommercialBookings(companyId, nextSearch),
        getTicketAdjustmentSummaryMap(companyId),
      ]);
      setBookings(raw);
      setSummaries(nextSummaries);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return bookings.filter((booking) => {
      if (filter !== "ALL" && booking.transaction_type !== filter) return false;
      if (!term) return true;
      return `${booking.ub_number} ${booking.counterparty_name} ${bookingSummary(booking)}`
        .toLowerCase()
        .includes(term);
    });
  }, [bookings, filter, search]);

  async function voidBooking(booking: TicketCommercialBooking) {
    const summary = summaries[booking.id];
    if (!canVoid || booking.status !== "ACTIVE" || summary?.lifecycleStatus === "CANCELLED" || busy) return;
    if (
      !window.confirm(
        `Void ${config.label} booking ${booking.ub_number}? Use Void only when this booking should never have existed. Genuine cancellations should use Booking Adjustment.`,
      )
    )
      return;
    setBusy(true);
    setError("");
    try {
      await voidTicketCommercialBooking(companyId, booking.id, userId);
      await load();
      await onChanged?.();
      setMessage(`${config.label} booking ${booking.ub_number} voided.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function doDelete(booking: TicketCommercialBooking) {
    if (
      !window.confirm(
        `Are you sure you want to permanently delete this ${config.label} Booking (${booking.ub_number})? This is a temporary testing function.`,
      )
    )
      return;
    setBusy(true);
    setError("");
    try {
      await deleteBooking(booking.id, companyId, userId || "");
      await load();
      await onChanged?.();
      setMessage(`${config.label} booking ${booking.ub_number} deleted.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function adjustmentSaved(nextMessage: string) {
    setMessage(nextMessage);
    await load();
    await onChanged?.();
  }

  async function openBooking(booking: TicketCommercialBooking, lifecycle: BookingLifecycleStatus) {
    if (booking.status === "VOID" || lifecycle === "CANCELLED" || !onOpenBooking) {
      setPreviewBooking(booking);
      return;
    }
    try {
      await onOpenBooking(booking.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const activeCount = bookings.filter(
    (booking) => booking.status === "ACTIVE" && summaries[booking.id]?.lifecycleStatus !== "CANCELLED",
  ).length;
  const saleTotal = bookings
    .filter((booking) => booking.status === "ACTIVE" && booking.transaction_type === "SALE")
    .reduce((sum, booking) => sum + Number(booking.total_pkr || 0), 0);
  const purchaseTotal = bookings
    .filter((booking) => booking.status === "ACTIVE" && booking.transaction_type === "PURCHASE")
    .reduce((sum, booking) => sum + Number(booking.total_pkr || 0), 0);
  const adjustmentCount = Object.values(summaries).reduce((sum, item) => sum + Number(item.adjustmentCount || 0), 0);

  return (
    <>
      <section className="booking-entry-screen package14-page package14-register-page lifecycle-register-page">
        <div className="booking-screen-toolbar package14-toolbar">
          <button type="button" className="booking-back-button" onClick={onBack}>
            ← Back to {config.label} Booking
          </button>
          <span className="booking-foundation-badge active-engine">TICKET REGISTER</span>
        </div>
        <div className="package14-register-title">
          <div>
            <span className="eyebrow blue">TICKET BOOKING REGISTER</span>
            <h2>{config.label} Booking Register</h2>
            <p>
              Open Booking, Booking Adjustment, History and Void Booking stay in the same Actions column. Ticket
              adjustments are stored in dedicated Ticket revision history.
            </p>
          </div>
          <div className="package14-register-stats">
            <div>
              <small>LIVE BOOKINGS</small>
              <b>{activeCount}</b>
            </div>
            <div>
              <small>SALES</small>
              <b>{money(saleTotal)}</b>
            </div>
            <div>
              <small>PURCHASES</small>
              <b>{money(purchaseTotal)}</b>
            </div>
            <div>
              <small>ADJUSTMENTS</small>
              <b>{adjustmentCount}</b>
            </div>
          </div>
        </div>
        {message && <div className="alert success">{message}</div>}
        {error && <div className="alert error">{error}</div>}
        <div className="package14-register-controls">
          <div className="package-register-filter-tabs">
            {(["ALL", "SALE", "PURCHASE"] as Filter[]).map((item) => (
              <button
                type="button"
                key={item}
                className={filter === item ? "active" : ""}
                onClick={() => setFilter(item)}
              >
                {item === "ALL" ? `All ${config.label} Bookings` : item === "SALE" ? "Sales" : "Purchases"}
              </button>
            ))}
          </div>
          <div className="search-box package-search">
            <span>⌕</span>
            <input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                void load(e.target.value);
              }}
              placeholder={`Search ${config.label} UB, Party/Vendor or booking details...`}
            />
          </div>
        </div>
        {!visible.length ? (
          <div className="empty-state compact-empty">
            <div className="empty-icon">TKT</div>
            <h3>No {config.label} bookings found</h3>
            <p>Create a booking or change the filter/search.</p>
          </div>
        ) : (
          <div className="party-table-wrap package14-register-wrap lifecycle-table-wrap">
            <table className="party-table package14-register-table lifecycle-table">
              <thead>
                <tr>
                  <th>DATE</th>
                  <th>UB #</th>
                  <th>TYPE</th>
                  <th>PARTY / VENDOR</th>
                  <th>TICKET DETAILS</th>
                  <th>EFFECTIVE TOTAL PKR</th>
                  <th>LIFECYCLE</th>
                  <th>ACTIONS</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((booking) => {
                  const summary = summaries[booking.id];
                  const lifecycle: BookingLifecycleStatus =
                    booking.status === "VOID" ? "VOID" : summary?.lifecycleStatus || "ACTIVE";
                  const revision = summary?.revisionNo || 1;
                  const cancelled = lifecycle === "CANCELLED";
                  const lifecycleClass = lifecycle.toLowerCase().replace(/_/g, "-");
                  return (
                    <tr key={booking.id} className={booking.status === "VOID" ? "void-row" : ""}>
                      <td>{booking.transaction_date}</td>
                      <td>
                        <b>{booking.ub_number}</b>
                      </td>
                      <td>
                        <span
                          className={`direction-badge ${booking.transaction_type === "SALE" ? "sale" : "purchase"}`}
                        >
                          {booking.transaction_type}
                        </span>
                      </td>
                      <td>
                        <b>{booking.counterparty_name || "—"}</b>
                      </td>
                      <td>
                        <div className="package14-register-lines">
                          {booking.lines.length ? (
                            booking.lines.map((line) => (
                              <div key={line.id}>
                                <b>{line.passenger_name}</b>
                                <span>
                                  {line.passenger_type} · {line.airline_name} · {flightLabel(line.flight_type)}
                                </span>
                                <small>
                                  {line.ticket_route} · PNR {line.pnr || "—"} · {line.ticket_count} ×{" "}
                                  {money(line.rate_per_ticket)} = {money(line.line_total_pkr)}
                                </small>
                              </div>
                            ))
                          ) : (
                            <span>All commercial rows cancelled</span>
                          )}
                        </div>
                      </td>
                      <td className="amount">
                        <b>{cancelled ? money(0) : money(booking.total_pkr)}</b>
                      </td>
                      <td>
                        <span className={`status lifecycle-status ${lifecycleClass}`}>
                          {lifecycle} · REV {revision}
                        </span>
                      </td>
                      <td>
                        <BookingLifecycleActions
                          busy={busy}
                          canOpen={booking.status === "ACTIVE"}
                          canAdjust={canEdit && booking.status === "ACTIVE" && !cancelled}
                          canHistory={booking.status !== "VOID" || Boolean(summary)}
                          canVoid={canVoid && booking.status === "ACTIVE" && !cancelled}
                          canDelete={canVoid}
                          onOpen={() => void openBooking(booking, lifecycle)}
                          onAdjustment={() => setAdjustmentBooking(booking)}
                          onHistory={() => setHistoryBooking(booking)}
                          onVoid={() => void voidBooking(booking)}
                          onDelete={() => void doDelete(booking)}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {previewBooking && (
        <div
          className="modal-backdrop adj-backdrop"
          onMouseDown={(e) => e.currentTarget === e.target && setPreviewBooking(null)}
        >
          <section className="adj-shell lifecycle-preview" onMouseDown={(e) => e.stopPropagation()}>
            <div className="adj-toolbar">
              <div>
                <span className="eyebrow blue">OPEN TICKET BOOKING</span>
                <h2>{previewBooking.ub_number}</h2>
                <p>
                  {previewBooking.counterparty_name} · {previewBooking.transaction_type} · Current Effective Value{" "}
                  {money(previewBooking.total_pkr)}
                </p>
              </div>
              <button type="button" className="adj-close" onClick={() => setPreviewBooking(null)}>
                ×
              </button>
            </div>
            <div className="adj-identity-strip">
              <div>
                <small>UB</small>
                <b>{previewBooking.ub_number}</b>
              </div>
              <div>
                <small>ACCOUNT</small>
                <b>{previewBooking.counterparty_name}</b>
              </div>
              <div>
                <small>BOOKING DATE</small>
                <b>{previewBooking.transaction_date}</b>
              </div>
              <div>
                <small>TRANSACTION</small>
                <b>{previewBooking.transaction_type}</b>
              </div>
              <div>
                <small>CURRENT VALUE</small>
                <b>{money(previewBooking.total_pkr)}</b>
              </div>
            </div>
            <section className="adj-section">
              <div className="adj-section-title">
                <span>02</span>
                <div>
                  <b>CURRENT TICKET COMMERCIAL ROWS</b>
                  <small>Read-only. Use Booking Adjustment for any commercial change.</small>
                </div>
              </div>
              <div className="adj-lines-table-wrap">
                <table className="adj-lines-table">
                  <thead>
                    <tr>
                      <th>PAX TYPE</th>
                      <th>PASSENGER</th>
                      <th>AIRLINE</th>
                      <th>PNR</th>
                      <th>FLIGHT TYPE</th>
                      <th>ROUTE</th>
                      <th>RATE</th>
                      <th>QTY</th>
                      <th>PKR VALUE</th>
                    </tr>
                  </thead>
                  <tbody>
                    {previewBooking.lines.map((line) => (
                      <tr key={line.id}>
                        <td>{line.passenger_type}</td>
                        <td>{line.passenger_name}</td>
                        <td>{line.airline_name}</td>
                        <td>{line.pnr || "—"}</td>
                        <td>{flightLabel(line.flight_type)}</td>
                        <td>{line.ticket_route}</td>
                        <td>{money(line.rate_per_ticket)}</td>
                        <td>{line.ticket_count}</td>
                        <td>
                          <b>{money(line.line_total_pkr)}</b>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </section>
        </div>
      )}

      {adjustmentBooking && (
        <TicketBookingAdjustment
          companyId={companyId}
          booking={adjustmentBooking}
          userId={userId}
          canEdit={canEdit}
          initialView="ADJUSTMENT"
          onClose={() => setAdjustmentBooking(null)}
          onSaved={adjustmentSaved}
        />
      )}
      {historyBooking && (
        <TicketBookingAdjustment
          companyId={companyId}
          booking={historyBooking}
          userId={userId}
          canEdit={canEdit}
          initialView="HISTORY"
          onClose={() => setHistoryBooking(null)}
          onSaved={adjustmentSaved}
        />
      )}
    </>
  );
}
