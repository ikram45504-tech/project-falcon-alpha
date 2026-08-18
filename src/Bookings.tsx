import { useState } from "react";
import PackageBookingFlow from "./PackageBookingFlowV2";
import TicketBookingModule from "./TicketBooking";
import HotelBookingModule from "./HotelBooking";
import VisaBookingModule from "./VisaBooking";
import TransportBookingModule from "./TransportBooking";
import MiscBookingModule from "./MiscBooking";
import type { BookingTransactionType, Party } from "./db";

type BookingService = "PACKAGE" | "TICKET" | "HOTEL" | "VISA" | "TRANSPORT" | "MISC";
type BookingScreen = "DIRECTION" | "SERVICES" | "SERVICE_FORM";

type Props = {
  companyId: string;
  parties: Party[];
  userId?: string;
  canCreate?: boolean;
  canEdit?: boolean;
  canVoid?: boolean;
  onChanged?: () => void | Promise<void>;
};

const serviceCards: Array<{ key: BookingService; title: string; subtitle: string }> = [
  { key: "PACKAGE", title: "Package", subtitle: "Umrah package booking" },
  { key: "TICKET", title: "Ticket", subtitle: "Air ticket booking" },
  { key: "HOTEL", title: "Hotel", subtitle: "Hotel accommodation" },
  { key: "VISA", title: "Visa", subtitle: "Visa services" },
  { key: "TRANSPORT", title: "Transport", subtitle: "Transport services" },
  { key: "MISC", title: "Misc", subtitle: "General-purpose per-person services" },
];

function ServiceIcon({ service }: { service: BookingService }) {
  const common = {
    width: 34,
    height: 34,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };

  if (service === "PACKAGE") {
    return <svg {...common}><rect x="5" y="7" width="14" height="12" rx="2" /><path d="M9 7V5.8A1.8 1.8 0 0 1 10.8 4h2.4A1.8 1.8 0 0 1 15 5.8V7" /><path d="M5 11h14M9 11v2M15 11v2" /></svg>;
  }
  if (service === "TICKET") {
    return <svg {...common}><path d="M4 8.5A2.5 2.5 0 0 0 6.5 6h11.2A1.3 1.3 0 0 1 19 7.3V10a2 2 0 0 0 0 4v2.7a1.3 1.3 0 0 1-1.3 1.3H6.5A2.5 2.5 0 0 0 4 15.5z" /><path d="M13 8.5v1M13 12v1M13 15.5v1" /></svg>;
  }
  if (service === "HOTEL") {
    return <svg {...common}><path d="M5 20V5.5A1.5 1.5 0 0 1 6.5 4h8A1.5 1.5 0 0 1 16 5.5V20" /><path d="M16 9h2.5A1.5 1.5 0 0 1 20 10.5V20M3 20h18" /><path d="M8 8h2M8 11h2M8 14h2M13 8h1M13 11h1M13 14h1" /></svg>;
  }
  if (service === "VISA") {
    return <svg {...common}><rect x="5" y="3" width="14" height="18" rx="2" /><circle cx="12" cy="10" r="3" /><path d="M9 17h6M8 6h8" /></svg>;
  }
  if (service === "TRANSPORT") {
    return <svg {...common}><rect x="4" y="5" width="16" height="13" rx="3" /><path d="M7 18v2M17 18v2M4 13h16M7 8h4M14 8h3" /><circle cx="8" cy="16" r="1" /><circle cx="16" cy="16" r="1" /></svg>;
  }
  return <svg {...common}><circle cx="6" cy="12" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="18" cy="12" r="1.5" /></svg>;
}

export default function BookingsModule({ companyId, parties, userId = "", canCreate = true, canEdit = true, canVoid = true, onChanged }: Props) {
  const [screen, setScreen] = useState<BookingScreen>("DIRECTION");
  const [transactionType, setTransactionType] = useState<BookingTransactionType | null>(null);
  const [service, setService] = useState<BookingService | null>(null);

  function chooseDirection(next: BookingTransactionType) {
    setTransactionType(next);
    setService(null);
    setScreen("SERVICES");
  }

  function chooseService(next: BookingService) {
    setService(next);
    setScreen("SERVICE_FORM");
  }

  function backToDirections() {
    setTransactionType(null);
    setService(null);
    setScreen("DIRECTION");
  }

  function backToServices() {
    setService(null);
    setScreen("SERVICES");
  }

  function renderDirectionScreen() {
    return (
      <section className="booking-entry-screen booking-direction-screen">
        <div className="booking-screen-heading centered-heading">
          <span className="eyebrow blue">BOOKINGS</span>
          <h2>What type of transaction are you entering?</h2>
          <p>Choose the accounting direction first. The next screen will show the booking services.</p>
        </div>
        <div className="booking-direction-grid">
          <button type="button" className="booking-direction-card sale" onClick={() => chooseDirection("SALE")}>
            <span className="direction-card-icon" aria-hidden="true">↗</span>
            <div><small>SALE</small><b>Sale to Party</b><p>Create a booking sold to a Party / customer account.</p></div>
            <span className="direction-arrow">→</span>
          </button>
          <button type="button" className="booking-direction-card purchase" onClick={() => chooseDirection("PURCHASE")}>
            <span className="direction-card-icon" aria-hidden="true">↙</span>
            <div><small>PURCHASE</small><b>Purchase from Vendor / Supplier</b><p>Record a booking purchased from a Vendor / supplier account.</p></div>
            <span className="direction-arrow">→</span>
          </button>
        </div>
      </section>
    );
  }

  function renderServicesScreen() {
    if (!transactionType) return renderDirectionScreen();
    return (
      <section className="booking-entry-screen booking-services-screen">
        <div className="booking-screen-toolbar">
          <button type="button" className="booking-back-button" onClick={backToDirections}>← Change Transaction Type</button>
          <span className={`direction-badge ${transactionType === "SALE" ? "sale" : "purchase"}`}>{transactionType === "SALE" ? "SALE TO PARTY" : "PURCHASE FROM VENDOR / SUPPLIER"}</span>
        </div>
        <div className="booking-screen-heading">
          <span className="eyebrow blue">SELECT BOOKING SERVICE</span>
          <h2>{transactionType === "SALE" ? "Sale to Party" : "Purchase from Vendor / Supplier"}</h2>
          <p>Select the type of booking you want to enter.</p>
        </div>
        <div className="booking-service-tile-grid">
          {serviceCards.map((item) => (
            <button type="button" className={`booking-service-tile service-${item.key.toLowerCase()}`} key={item.key} onClick={() => chooseService(item.key)}>
              <span className="booking-service-icon"><ServiceIcon service={item.key} /></span>
              <b>{item.title}</b><small>{item.subtitle}</small>
              <span className="booking-service-status live">LIVE</span>
            </button>
          ))}
        </div>
      </section>
    );
  }

  return (
    <section className="content-card bookings-page bookings-flow-v2">
      {screen === "DIRECTION" && renderDirectionScreen()}
      {screen === "SERVICES" && renderServicesScreen()}

      {screen === "SERVICE_FORM" && service === "PACKAGE" && transactionType && (
        <PackageBookingFlow
          companyId={companyId}
          parties={parties}
          transactionType={transactionType}
          userId={userId}
          canCreate={canCreate}
          canEdit={canEdit}
          canVoid={canVoid}
          onBack={backToServices}
          onChanged={onChanged}
        />
      )}

      {screen === "SERVICE_FORM" && service === "TICKET" && transactionType && (
        <TicketBookingModule companyId={companyId} parties={parties} transactionType={transactionType} userId={userId} canCreate={canCreate} canEdit={canEdit} canVoid={canVoid} onBack={backToServices} onChanged={onChanged} />
      )}
      {screen === "SERVICE_FORM" && service === "HOTEL" && transactionType && (
        <HotelBookingModule companyId={companyId} parties={parties} transactionType={transactionType} userId={userId} canCreate={canCreate} canEdit={canEdit} canVoid={canVoid} onBack={backToServices} onChanged={onChanged} />
      )}
      {screen === "SERVICE_FORM" && service === "VISA" && transactionType && (
        <VisaBookingModule companyId={companyId} parties={parties} transactionType={transactionType} userId={userId} canCreate={canCreate} canEdit={canEdit} canVoid={canVoid} onBack={backToServices} onChanged={onChanged} />
      )}
      {screen === "SERVICE_FORM" && service === "TRANSPORT" && transactionType && (
        <TransportBookingModule companyId={companyId} parties={parties} transactionType={transactionType} userId={userId} canCreate={canCreate} canEdit={canEdit} canVoid={canVoid} onBack={backToServices} onChanged={onChanged} />
      )}
      {screen === "SERVICE_FORM" && service === "MISC" && transactionType && (
        <MiscBookingModule companyId={companyId} parties={parties} transactionType={transactionType} userId={userId} canCreate={canCreate} canEdit={canEdit} canVoid={canVoid} onBack={backToServices} onChanged={onChanged} />
      )}
    </section>
  );
}
