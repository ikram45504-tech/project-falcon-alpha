import { useEffect, useMemo, useState } from "react";
import type { BookingTransactionType, HotelBooking, PackageBooking, TransportBooking, VisaBooking } from "./db";
import { deleteBooking, getPackageBookings, voidPackageBooking } from "./db";
import { getHotelBookings, voidHotelBooking } from "./HotelFlowDb";
import { getTicketCommercialBookings, voidTicketCommercialBooking, type TicketCommercialBooking } from "./TicketFlowDb";
import { getVisaBookings, voidVisaBooking } from "./VisaFlowDb";
import { getTransportBookings, voidTransportBooking } from "./TransportFlowDb";
import { getMiscBookings, voidMiscBooking, type MiscBooking } from "./miscDb";
import { getPackageAdjustmentSummaryMap, type PackageAdjustmentSummary } from "./PackageAdjustmentDb";
import { getTicketAdjustmentSummaryMap, type TicketAdjustmentSummary } from "./TicketAdjustmentDb";
import { getHotelAdjustmentSummaryMap, type HotelAdjustmentSummary } from "./HotelAdjustmentDb";
import { getVisaAdjustmentSummaryMap, type VisaAdjustmentSummary } from "./VisaAdjustmentDb";
import { getTransportAdjustmentSummaryMap, type TransportAdjustmentSummary } from "./TransportAdjustmentDb";
import { getMiscAdjustmentSummaryMap, type MiscAdjustmentSummary } from "./MiscAdjustmentDb";
import { bookingLifecycleConfigs, type BookingLifecycleStatus, type BookingServiceName } from "./BookingLifecycle";
import BookingLifecycleActions from "./BookingLifecycleActions";
import PackageBookingAdjustment from "./PackageBookingAdjustment";
import TicketBookingAdjustment from "./TicketBookingAdjustment";
import HotelBookingAdjustment from "./HotelBookingAdjustment";
import VisaBookingAdjustment from "./VisaBookingAdjustment";
import TransportBookingAdjustment from "./TransportBookingAdjustment";
import MiscBookingAdjustment from "./MiscBookingAdjustment";
import { usePhoneUi } from "./phoneUi";
import "./BookingFinalization.css";
import "./BookingLifecycleCenter.css";
import "./PackageBookingFlow.css";
import "./DirectionBookingLedger.css";

type Props = {
  companyId: string;
  userId?: string;
  canEdit?: boolean;
  canVoid?: boolean;
  onBack: () => void;
  onOpenBooking?: (
    service: BookingServiceName,
    bookingId: string,
    transactionType: BookingTransactionType,
  ) => void | Promise<void>;
  onChanged?: () => void | Promise<void>;
};

type LedgerRow =
  | { service: "PACKAGE"; booking: PackageBooking }
  | { service: "TICKET"; booking: TicketCommercialBooking }
  | { service: "HOTEL"; booking: HotelBooking }
  | { service: "VISA"; booking: VisaBooking }
  | { service: "TRANSPORT"; booking: TransportBooking }
  | { service: "MISC"; booking: MiscBooking };

type AdjustmentTarget = LedgerRow & { view: "ADJUSTMENT" | "HISTORY" };

type ServiceFilter = "ALL" | BookingServiceName;
type TypeFilter = "ALL" | BookingTransactionType;

const SERVICE_FILTERS: ServiceFilter[] = ["ALL", "PACKAGE", "TICKET", "HOTEL", "VISA", "TRANSPORT", "MISC"];
const TYPE_FILTERS: TypeFilter[] = ["ALL", "SALE", "PURCHASE"];

function money(value: number) {
  return `Rs ${Number(value || 0).toLocaleString("en-PK", { maximumFractionDigits: 2 })}`;
}

function formatDate(value: string) {
  if (!value) return "—";
  const [y, m, d] = value.split("-").map(Number);
  if (!y || !m || !d) return value;
  return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" })
    .format(new Date(y, m - 1, d))
    .replace(/ /g, "-");
}

function detailLines(row: LedgerRow): string[] {
  if (row.service === "PACKAGE") {
    return row.booking.lines.map(
      (line) =>
        `${line.passenger_type} · ${line.passenger_name || "—"} · ${line.package_type} · ${line.person_count} × ${money(line.rate_per_person)}`,
    );
  }
  if (row.service === "TICKET") {
    return row.booking.lines.map(
      (line) => `${line.passenger_name} · ${line.airline_name} · ${line.ticket_route} · ${line.ticket_count} ticket(s)`,
    );
  }
  if (row.service === "HOTEL") {
    return row.booking.lines.map(
      (line) =>
        `${line.hotel_name} · ${line.nights}N · ${line.quantity} ${String(line.room_type || "").replace(/_/g, " ")}`,
    );
  }
  if (row.service === "VISA") {
    return row.booking.lines.map(
      (line) => `${line.passenger_name || "—"} · ${line.visa_type || "Visa"} · ${line.pax_count || 1} pax`,
    );
  }
  if (row.service === "TRANSPORT") {
    return row.booking.lines.map(
      (line) => `${line.from_location} → ${line.to_location} · ${String(line.transport_type || "").replace(/_/g, " ")}`,
    );
  }
  return row.booking.lines.map(
    (line) => `${line.service_name || "Misc"} · ${line.pax_count || 1} × ${money(line.rate_per_person)}`,
  );
}

export default function DirectionBookingLedger({
  companyId,
  userId = "",
  canEdit = true,
  canVoid = true,
  onBack,
  onOpenBooking,
  onChanged,
}: Props) {
  const isPhone = usePhoneUi();
  const [rows, setRows] = useState<LedgerRow[]>([]);
  const [packageSummaries, setPackageSummaries] = useState<Record<string, PackageAdjustmentSummary>>({});
  const [ticketSummaries, setTicketSummaries] = useState<Record<string, TicketAdjustmentSummary>>({});
  const [hotelSummaries, setHotelSummaries] = useState<Record<string, HotelAdjustmentSummary>>({});
  const [visaSummaries, setVisaSummaries] = useState<Record<string, VisaAdjustmentSummary>>({});
  const [transportSummaries, setTransportSummaries] = useState<Record<string, TransportAdjustmentSummary>>({});
  const [miscSummaries, setMiscSummaries] = useState<Record<string, MiscAdjustmentSummary>>({});
  const [serviceFilter, setServiceFilter] = useState<ServiceFilter>("ALL");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("ALL");
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [adjustmentTarget, setAdjustmentTarget] = useState<AdjustmentTarget | null>(null);

  function summaryFor(row: LedgerRow) {
    if (row.service === "PACKAGE") return packageSummaries[row.booking.id];
    if (row.service === "TICKET") return ticketSummaries[row.booking.id];
    if (row.service === "HOTEL") return hotelSummaries[row.booking.id];
    if (row.service === "VISA") return visaSummaries[row.booking.id];
    if (row.service === "TRANSPORT") return transportSummaries[row.booking.id];
    return miscSummaries[row.booking.id];
  }

  function lifecycleOf(row: LedgerRow): BookingLifecycleStatus {
    if (row.booking.status === "VOID") return "VOID";
    return summaryFor(row)?.lifecycleStatus || "ACTIVE";
  }

  async function load() {
    setLoading(true);
    setError("");
    try {
      const [
        packages,
        tickets,
        hotels,
        visas,
        transports,
        miscs,
        nextPackageSummaries,
        nextTicketSummaries,
        nextHotelSummaries,
        nextVisaSummaries,
        nextTransportSummaries,
        nextMiscSummaries,
      ] = await Promise.all([
        getPackageBookings(companyId),
        getTicketCommercialBookings(companyId),
        getHotelBookings(companyId),
        getVisaBookings(companyId),
        getTransportBookings(companyId),
        getMiscBookings(companyId),
        getPackageAdjustmentSummaryMap(companyId),
        getTicketAdjustmentSummaryMap(companyId),
        getHotelAdjustmentSummaryMap(companyId),
        getVisaAdjustmentSummaryMap(companyId),
        getTransportAdjustmentSummaryMap(companyId),
        getMiscAdjustmentSummaryMap(companyId),
      ]);

      const nextRows: LedgerRow[] = [
        ...packages.map((booking) => ({ service: "PACKAGE" as const, booking })),
        ...tickets.map((booking) => ({ service: "TICKET" as const, booking })),
        ...hotels.map((booking) => ({ service: "HOTEL" as const, booking })),
        ...visas.map((booking) => ({ service: "VISA" as const, booking })),
        ...transports.map((booking) => ({ service: "TRANSPORT" as const, booking })),
        ...miscs.map((booking) => ({ service: "MISC" as const, booking })),
      ].sort(
        (a, b) =>
          b.booking.transaction_date.localeCompare(a.booking.transaction_date) ||
          b.booking.created_at.localeCompare(a.booking.created_at) ||
          a.service.localeCompare(b.service),
      );

      setRows(nextRows);
      setPackageSummaries(nextPackageSummaries);
      setTicketSummaries(nextTicketSummaries);
      setHotelSummaries(nextHotelSummaries);
      setVisaSummaries(nextVisaSummaries);
      setTransportSummaries(nextTransportSummaries);
      setMiscSummaries(nextMiscSummaries);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setRows([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [companyId]);

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (serviceFilter !== "ALL" && row.service !== serviceFilter) return false;
      if (typeFilter !== "ALL" && row.booking.transaction_type !== typeFilter) return false;
      if (!term) return true;
      const details = detailLines(row).join(" ");
      return `${row.booking.ub_number} ${row.booking.counterparty_name} ${row.booking.transaction_type} ${row.service} ${bookingLifecycleConfigs[row.service].label} ${details}`
        .toLowerCase()
        .includes(term);
    });
  }, [rows, search, serviceFilter, typeFilter]);

  const stats = useMemo(() => {
    const live = visible.filter((row) => row.booking.status === "ACTIVE" && lifecycleOf(row) !== "CANCELLED");
    const adjustments =
      Object.values(packageSummaries).reduce((sum, item) => sum + Number(item.adjustmentCount || 0), 0) +
      Object.values(ticketSummaries).reduce((sum, item) => sum + Number(item.adjustmentCount || 0), 0) +
      Object.values(hotelSummaries).reduce((sum, item) => sum + Number(item.adjustmentCount || 0), 0) +
      Object.values(visaSummaries).reduce((sum, item) => sum + Number(item.adjustmentCount || 0), 0) +
      Object.values(transportSummaries).reduce((sum, item) => sum + Number(item.adjustmentCount || 0), 0) +
      Object.values(miscSummaries).reduce((sum, item) => sum + Number(item.adjustmentCount || 0), 0);
    return {
      live: live.length,
      saleTotal: live
        .filter((row) => row.booking.transaction_type === "SALE")
        .reduce((sum, row) => sum + Number(row.booking.total_pkr || 0), 0),
      purchaseTotal: live
        .filter((row) => row.booking.transaction_type === "PURCHASE")
        .reduce((sum, row) => sum + Number(row.booking.total_pkr || 0), 0),
      adjustments,
    };
  }, [visible, packageSummaries, ticketSummaries, hotelSummaries, visaSummaries, transportSummaries, miscSummaries]);

  async function voidRow(row: LedgerRow) {
    const lifecycle = lifecycleOf(row);
    if (!canVoid || row.booking.status !== "ACTIVE" || lifecycle === "CANCELLED" || busy) return;
    const label = bookingLifecycleConfigs[row.service].label;
    if (
      !window.confirm(
        `Void ${label} booking ${row.booking.ub_number}? Use Void only when this booking should never have existed. Genuine cancellations should use Booking Adjustment.`,
      )
    )
      return;
    setBusy(true);
    setError("");
    try {
      if (row.service === "PACKAGE") await voidPackageBooking(companyId, row.booking.id, userId);
      else if (row.service === "TICKET") await voidTicketCommercialBooking(companyId, row.booking.id, userId);
      else if (row.service === "HOTEL") await voidHotelBooking(companyId, row.booking.id, userId);
      else if (row.service === "VISA") await voidVisaBooking(companyId, row.booking.id, userId);
      else if (row.service === "TRANSPORT") await voidTransportBooking(companyId, row.booking.id, userId);
      else await voidMiscBooking(companyId, row.booking.id, userId);
      await load();
      await onChanged?.();
      setMessage(`${label} booking ${row.booking.ub_number} voided.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function deleteRow(row: LedgerRow) {
    const label = bookingLifecycleConfigs[row.service].label;
    if (
      !window.confirm(
        `Are you sure you want to permanently delete this ${label} Booking (${row.booking.ub_number})? This is a temporary testing function.`,
      )
    )
      return;
    setBusy(true);
    setError("");
    try {
      await deleteBooking(row.booking.id, companyId, userId || "");
      await load();
      await onChanged?.();
      setMessage(`${label} booking ${row.booking.ub_number} deleted.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function openRow(row: LedgerRow) {
    const lifecycle = lifecycleOf(row);
    if (row.booking.status === "VOID" || lifecycle === "CANCELLED" || !onOpenBooking) {
      setError(
        row.booking.status === "VOID" || lifecycle === "CANCELLED"
          ? "This booking cannot be opened for edit. Use History to review revisions."
          : "Open Booking is not available.",
      );
      return;
    }
    try {
      await onOpenBooking(row.service, row.booking.id, row.booking.transaction_type);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function adjustmentSaved(nextMessage: string) {
    setMessage(nextMessage);
    setAdjustmentTarget(null);
    await load();
    await onChanged?.();
  }

  function renderRowActions(row: LedgerRow) {
    const summary = summaryFor(row);
    const lifecycle = lifecycleOf(row);
    const cancelled = lifecycle === "CANCELLED";
    return (
      <BookingLifecycleActions
        busy={busy}
        canOpen={row.booking.status === "ACTIVE" && !cancelled}
        canAdjust={canEdit && row.booking.status === "ACTIVE" && !cancelled}
        canHistory={row.booking.status !== "VOID" || Boolean(summary)}
        canVoid={canVoid && row.booking.status === "ACTIVE" && !cancelled}
        canDelete={canVoid}
        onOpen={() => void openRow(row)}
        onAdjustment={() => setAdjustmentTarget({ ...row, view: "ADJUSTMENT" })}
        onHistory={() => setAdjustmentTarget({ ...row, view: "HISTORY" })}
        onVoid={() => void voidRow(row)}
        onDelete={() => void deleteRow(row)}
      />
    );
  }

  function renderMobileCards() {
    return (
      <div className="all-booking-register-cards">
        {visible.map((row) => {
          const summary = summaryFor(row);
          const lifecycle = lifecycleOf(row);
          const revision = summary?.revisionNo || 1;
          const cancelled = lifecycle === "CANCELLED";
          const lifecycleClass = lifecycle.toLowerCase().replace(/_/g, "-");
          const lines = detailLines(row);
          return (
            <article
              key={`${row.service}:${row.booking.id}`}
              className={`all-booking-register-card${row.booking.status === "VOID" ? " void-row" : ""}`}
            >
              <div className="all-booking-register-card-top">
                <div>
                  <h3>{row.booking.ub_number}</h3>
                  <small>{row.booking.counterparty_name || "—"}</small>
                </div>
                <div className="all-booking-register-card-badges">
                  <span className={`direction-badge ${row.booking.transaction_type === "SALE" ? "sale" : "purchase"}`}>
                    {row.booking.transaction_type}
                  </span>
                  <span className="booking-foundation-badge">{bookingLifecycleConfigs[row.service].label}</span>
                </div>
              </div>

              <div className="all-booking-register-card-meta">
                <div>
                  <span>Date</span>
                  <b>{formatDate(row.booking.transaction_date)}</b>
                </div>
                <div className="amount">
                  <span>Effective total</span>
                  <b>{cancelled ? money(0) : money(row.booking.total_pkr)}</b>
                </div>
                <div>
                  <span>Lifecycle</span>
                  <b>
                    <span className={`status lifecycle-status ${lifecycleClass}`}>
                      {lifecycle} · REV {revision}
                    </span>
                  </b>
                </div>
              </div>

              <div className="all-booking-register-card-details">
                <span>Booking details</span>
                <div className="package14-register-lines">
                  {lines.length ? (
                    lines.map((line, index) => (
                      <div key={`${row.booking.id}-line-${index}`}>
                        <span>{line}</span>
                      </div>
                    ))
                  ) : (
                    <span>All commercial rows cancelled</span>
                  )}
                </div>
              </div>

              {renderRowActions(row)}
            </article>
          );
        })}
      </div>
    );
  }

  function renderDesktopTable() {
    return (
      <div className="party-table-wrap package14-register-wrap lifecycle-table-wrap">
        <table className="party-table package14-register-table lifecycle-table">
          <thead>
            <tr>
              <th>DATE</th>
              <th>UB #</th>
              <th>TYPE</th>
              <th>SEGMENT</th>
              <th>PARTY / VENDOR</th>
              <th>BOOKING DETAILS</th>
              <th>EFFECTIVE TOTAL PKR</th>
              <th>LIFECYCLE</th>
              <th>ACTIONS</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((row) => {
              const summary = summaryFor(row);
              const lifecycle = lifecycleOf(row);
              const revision = summary?.revisionNo || 1;
              const cancelled = lifecycle === "CANCELLED";
              const lifecycleClass = lifecycle.toLowerCase().replace(/_/g, "-");
              const lines = detailLines(row);
              return (
                <tr
                  key={`${row.service}:${row.booking.id}`}
                  className={row.booking.status === "VOID" ? "void-row" : ""}
                >
                  <td>{formatDate(row.booking.transaction_date)}</td>
                  <td>
                    <b>{row.booking.ub_number}</b>
                  </td>
                  <td>
                    <span
                      className={`direction-badge ${row.booking.transaction_type === "SALE" ? "sale" : "purchase"}`}
                    >
                      {row.booking.transaction_type}
                    </span>
                  </td>
                  <td>
                    <span className="booking-foundation-badge">{bookingLifecycleConfigs[row.service].label}</span>
                  </td>
                  <td>
                    <b>{row.booking.counterparty_name || "—"}</b>
                  </td>
                  <td>
                    <div className="package14-register-lines">
                      {lines.length ? (
                        lines.map((line, index) => (
                          <div key={`${row.booking.id}-line-${index}`}>
                            <span>{line}</span>
                          </div>
                        ))
                      ) : (
                        <span>All commercial rows cancelled</span>
                      )}
                    </div>
                  </td>
                  <td className="amount">
                    <b>{cancelled ? money(0) : money(row.booking.total_pkr)}</b>
                  </td>
                  <td>
                    <span className={`status lifecycle-status ${lifecycleClass}`}>
                      {lifecycle} · REV {revision}
                    </span>
                  </td>
                  <td>{renderRowActions(row)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <>
      <section className="booking-entry-screen package14-page package14-register-page lifecycle-register-page all-booking-register">
        <div className="booking-screen-toolbar package14-toolbar">
          <button type="button" className="booking-back-button" onClick={onBack}>
            ← Back to Bookings
          </button>
          <span className="booking-foundation-badge active-engine">ALL BOOKING REGISTER</span>
        </div>

        <div className="package14-register-title">
          <div>
            <span className="eyebrow blue">ALL BOOKING REGISTER</span>
            <h2>All Booking Register</h2>
            <p>
              Company-wide view of every booking across Package, Ticket, Hotel, Visa, Transport and Misc. Each segment
              still keeps its own dedicated register — use this when you want everything in one place. Open Booking,
              Booking Adjustment, History and Void stay in the same Actions column.
            </p>
          </div>
          <div className="package14-register-stats">
            <div>
              <small>LIVE BOOKINGS</small>
              <b>{stats.live}</b>
            </div>
            <div>
              <small>SALES</small>
              <b>{money(stats.saleTotal)}</b>
            </div>
            <div>
              <small>PURCHASES</small>
              <b>{money(stats.purchaseTotal)}</b>
            </div>
            <div>
              <small>ADJUSTMENTS</small>
              <b>{stats.adjustments}</b>
            </div>
          </div>
        </div>

        {message && <div className="alert success">{message}</div>}
        {error && <div className="alert error">{error}</div>}

        <div className="package14-register-controls">
          <div className="package-register-filter-tabs">
            {TYPE_FILTERS.map((item) => (
              <button
                type="button"
                key={item}
                className={typeFilter === item ? "active" : ""}
                onClick={() => setTypeFilter(item)}
              >
                {item === "ALL" ? "All bookings" : item === "SALE" ? "Sales" : "Purchases"}
              </button>
            ))}
          </div>
          <div className="package-register-filter-tabs">
            {SERVICE_FILTERS.map((item) => (
              <button
                type="button"
                key={item}
                className={serviceFilter === item ? "active" : ""}
                onClick={() => setServiceFilter(item)}
              >
                {item === "ALL" ? "All segments" : bookingLifecycleConfigs[item].label}
              </button>
            ))}
          </div>
          <div className="search-box package-search">
            <span>⌕</span>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search UB, party/vendor, segment or booking details…"
            />
          </div>
        </div>

        {loading && !rows.length ? (
          <div className="empty-state compact-empty">
            <h3>Loading bookings…</h3>
          </div>
        ) : !visible.length ? (
          <div className="empty-state compact-empty">
            <div className="empty-icon">BK</div>
            <h3>No bookings found</h3>
            <p>Create a booking or change the filter/search.</p>
          </div>
        ) : isPhone ? (
          renderMobileCards()
        ) : (
          renderDesktopTable()
        )}
      </section>

      {adjustmentTarget?.service === "PACKAGE" && (
        <PackageBookingAdjustment
          companyId={companyId}
          booking={adjustmentTarget.booking}
          userId={userId}
          canEdit={canEdit}
          initialView={adjustmentTarget.view}
          onClose={() => setAdjustmentTarget(null)}
          onSaved={adjustmentSaved}
        />
      )}
      {adjustmentTarget?.service === "TICKET" && (
        <TicketBookingAdjustment
          companyId={companyId}
          booking={adjustmentTarget.booking}
          userId={userId}
          canEdit={canEdit}
          initialView={adjustmentTarget.view}
          onClose={() => setAdjustmentTarget(null)}
          onSaved={adjustmentSaved}
        />
      )}
      {adjustmentTarget?.service === "HOTEL" && (
        <HotelBookingAdjustment
          companyId={companyId}
          booking={adjustmentTarget.booking}
          userId={userId}
          canEdit={canEdit}
          initialView={adjustmentTarget.view}
          onClose={() => setAdjustmentTarget(null)}
          onSaved={adjustmentSaved}
        />
      )}
      {adjustmentTarget?.service === "VISA" && (
        <VisaBookingAdjustment
          companyId={companyId}
          booking={adjustmentTarget.booking}
          userId={userId}
          canEdit={canEdit}
          initialView={adjustmentTarget.view}
          onClose={() => setAdjustmentTarget(null)}
          onSaved={adjustmentSaved}
        />
      )}
      {adjustmentTarget?.service === "TRANSPORT" && (
        <TransportBookingAdjustment
          companyId={companyId}
          booking={adjustmentTarget.booking}
          userId={userId}
          canEdit={canEdit}
          initialView={adjustmentTarget.view}
          onClose={() => setAdjustmentTarget(null)}
          onSaved={adjustmentSaved}
        />
      )}
      {adjustmentTarget?.service === "MISC" && (
        <MiscBookingAdjustment
          companyId={companyId}
          booking={adjustmentTarget.booking}
          userId={userId}
          canEdit={canEdit}
          initialView={adjustmentTarget.view}
          onClose={() => setAdjustmentTarget(null)}
          onSaved={adjustmentSaved}
        />
      )}
    </>
  );
}
