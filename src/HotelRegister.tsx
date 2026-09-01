import { useEffect, useMemo, useState } from "react";
import { useBodyScrollLock } from "./useBodyScrollLock";
import type { BookingTransactionType, HotelBooking } from "./db";
import { deleteBooking } from "./db";
import { getHotelBookings, voidHotelBooking } from "./HotelFlowDb";
import { getHotelAdjustmentSummaryMap, type HotelAdjustmentSummary } from "./HotelAdjustmentDb";
import { bookingLifecycleConfigs, type BookingLifecycleStatus } from "./BookingLifecycle";
import BookingLifecycleActions from "./BookingLifecycleActions";
import HotelBookingAdjustment from "./HotelBookingAdjustment";
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

const config = bookingLifecycleConfigs.HOTEL;

function money(value: number) {
  return `Rs ${Number(value || 0).toLocaleString("en-PK", { maximumFractionDigits: 2 })}`;
}

function sar(value: number) {
  return `SAR ${Number(value || 0).toLocaleString("en-PK", { maximumFractionDigits: 2 })}`;
}

function bookingSummary(booking: HotelBooking) {
  return (
    booking.lines
      .map((line) => `${line.hotel_name} · ${line.nights}N · ${line.quantity} ${line.room_type.replace(/_/g, " ")}`)
      .join(" | ") || "Hotel booking"
  );
}

export default function HotelRegister({
  companyId,
  transactionType,
  userId = "",
  canEdit = true,
  canVoid = true,
  onBack,
  onOpenBooking,
  onChanged,
}: Props) {
  const [bookings, setBookings] = useState<HotelBooking[]>([]);
  const [summaries, setSummaries] = useState<Record<string, HotelAdjustmentSummary>>({});
  const [filter, setFilter] = useState<Filter>(transactionType);
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [adjustmentBooking, setAdjustmentBooking] = useState<HotelBooking | null>(null);
  const [historyBooking, setHistoryBooking] = useState<HotelBooking | null>(null);
  const [previewBooking, setPreviewBooking] = useState<HotelBooking | null>(null);
  useBodyScrollLock(Boolean(previewBooking));

  useEffect(() => {
    setFilter(transactionType);
  }, [transactionType]);

  useEffect(() => {
    void load();
  }, [companyId]);

  async function load(nextSearch = search) {
    try {
      const [raw, nextSummaries] = await Promise.all([
        getHotelBookings(companyId, nextSearch),
        getHotelAdjustmentSummaryMap(companyId),
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

  async function voidBooking(booking: HotelBooking) {
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
      await voidHotelBooking(companyId, booking.id, userId);
      await load();
      await onChanged?.();
      setMessage(`${config.label} booking ${booking.ub_number} voided.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function doDelete(booking: HotelBooking) {
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

  async function openBooking(booking: HotelBooking, lifecycle: BookingLifecycleStatus) {
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
          <span className="booking-foundation-badge active-engine">HOTEL REGISTER</span>
        </div>
        <div className="package14-register-title">
          <div>
            <span className="eyebrow blue">HOTEL BOOKING REGISTER</span>
            <h2>{config.label} Booking Register</h2>
            <p>
              Open Booking, Booking Adjustment, History and Void Booking stay in the same Actions column. Hotel
              adjustments are stored in dedicated Hotel revision history.
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
            <div className="empty-icon">HTL</div>
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
                  <th>HOTEL DETAILS</th>
                  <th>TOTAL SAR</th>
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
                                <b>{line.hotel_name}</b>
                                <span>{line.city}</span>
                                <small>
                                  {line.check_in} → {line.check_out} · {line.nights}N · {line.quantity} ×{" "}
                                  {sar(line.rate_per_night_sar)} = {money(line.line_total_pkr)}
                                </small>
                              </div>
                            ))
                          ) : (
                            <span>All commercial rows cancelled</span>
                          )}
                        </div>
                      </td>
                      <td>{cancelled ? "—" : Number(booking.total_sar || 0) > 0 ? sar(booking.total_sar) : "—"}</td>
                      <td className="amount">
                        <b>{money(booking.total_pkr)}</b>
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
                <span className="eyebrow blue">OPEN HOTEL BOOKING</span>
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
                  <b>CURRENT HOTEL COMMERCIAL ROWS</b>
                  <small>Read-only. Use Booking Adjustment for any commercial change.</small>
                </div>
              </div>
              <div className="adj-lines-table-wrap">
                <table className="adj-lines-table">
                  <thead>
                    <tr>
                      <th>CITY</th>
                      <th>HOTEL</th>
                      <th>CHECK IN</th>
                      <th>CHECK OUT</th>
                      <th>NIGHTS</th>
                      <th>ROOM</th>
                      <th>QTY</th>
                      <th>RATE SAR</th>
                      <th>ROE</th>
                      <th>PKR VALUE</th>
                    </tr>
                  </thead>
                  <tbody>
                    {previewBooking.lines.map((line) => (
                      <tr key={line.id}>
                        <td>{line.city}</td>
                        <td>{line.hotel_name}</td>
                        <td>{line.check_in}</td>
                        <td>{line.check_out}</td>
                        <td>{line.nights}</td>
                        <td>{line.room_type.replace(/_/g, " ")}</td>
                        <td>{line.quantity}</td>
                        <td>{sar(line.rate_per_night_sar)}</td>
                        <td>{Number(line.roe || 0) > 0 ? line.roe : "—"}</td>
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
        <HotelBookingAdjustment
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
        <HotelBookingAdjustment
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
