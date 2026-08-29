/**
 * Generates segment register + adjustment wrapper files from Hotel templates.
 * Run: node scripts/generate-segment-isolation.mjs
 */
import fs from "fs";
import path from "path";

const root = path.resolve(import.meta.dirname, "..");
const segments = [
  {
    key: "Ticket",
    service: "TICKET",
    icon: "TKT",
    flowImport: `{ getTicketCommercialBookings, voidTicketCommercialBooking, type TicketCommercialBooking } from "./TicketFlowDb"`,
    bookingType: "TicketCommercialBooking",
    getBookings: "getTicketCommercialBookings",
    voidBooking: "voidTicketCommercialBooking",
    adjustmentImport: `./TicketBookingAdjustment`,
    adjustmentComponent: "TicketBookingAdjustment",
    adjustmentDbImport: `./TicketAdjustmentDb`,
    summaryFn: "getTicketAdjustmentSummaryMap",
    summaryType: "TicketAdjustmentSummary",
    detailsColumn: "TICKET DETAILS",
    sarColumn: false,
    summary: `(booking) =>
    booking.lines
      .map((line) => \`\${line.passenger_name} · \${line.airline_name} · \${line.ticket_route} · \${line.ticket_count} ticket(s)\`)
      .join(" | ") || "Ticket booking"`,
    linePreview: `booking.lines.map((line) => (
                              <div key={line.id}>
                                <b>{line.passenger_name}</b>
                                <span>{line.airline_name} · {line.pnr}</span>
                                <small>{line.ticket_route} · {line.ticket_count} × {money(line.rate_per_ticket)} = {money(line.line_total_pkr)}</small>
                              </div>
                            ))`,
  },
  {
    key: "Visa",
    service: "VISA",
    icon: "VSA",
    flowImport: `{ getVisaBookings, voidVisaBooking, type VisaBooking } from "./db"`,
    bookingType: "VisaBooking",
    getBookings: "getVisaBookings",
    voidBooking: "voidVisaBooking",
    adjustmentImport: `./VisaBookingAdjustment`,
    adjustmentComponent: "VisaBookingAdjustment",
    adjustmentDbImport: `./VisaAdjustmentDb`,
    summaryFn: "getVisaAdjustmentSummaryMap",
    summaryType: "VisaAdjustmentSummary",
    detailsColumn: "VISA DETAILS",
    sarColumn: true,
    summary: `(booking) =>
    booking.lines
      .map((line) => \`\${line.passenger_name} · \${line.visa_type.replace(/_/g, " ")} · \${line.pax_count} pax\`)
      .join(" | ") || "Visa booking"`,
    linePreview: `booking.lines.map((line) => (
                              <div key={line.id}>
                                <b>{line.passenger_name}</b>
                                <span>{line.visa_type.replace(/_/g, " ")}</span>
                                <small>{line.pax_count} pax · {sar(line.visa_rate_sar)} = {money(line.line_total_pkr)}</small>
                              </div>
                            ))`,
  },
  {
    key: "Transport",
    service: "TRANSPORT",
    icon: "TRN",
    flowImport: `{ getTransportBookings, voidTransportBooking, type TransportBooking } from "./db"`,
    bookingType: "TransportBooking",
    getBookings: "getTransportBookings",
    voidBooking: "voidTransportBooking",
    adjustmentImport: `./TransportBookingAdjustment`,
    adjustmentComponent: "TransportBookingAdjustment",
    adjustmentDbImport: `./TransportAdjustmentDb`,
    summaryFn: "getTransportAdjustmentSummaryMap",
    summaryType: "TransportAdjustmentSummary",
    detailsColumn: "TRANSPORT DETAILS",
    sarColumn: true,
    summary: `(booking) =>
    booking.lines
      .map((line) => \`\${line.from_location} → \${line.to_location} · \${line.transport_type.replace(/_/g, " ")}\`)
      .join(" | ") || "Transport booking"`,
    linePreview: `booking.lines.map((line) => (
                              <div key={line.id}>
                                <b>{line.from_location} → {line.to_location}</b>
                                <span>{line.transport_date}</span>
                                <small>{line.transport_type.replace(/_/g, " ")} · {money(line.line_total_pkr)}</small>
                              </div>
                            ))`,
  },
  {
    key: "Misc",
    service: "MISC",
    icon: "MSC",
    flowImport: `{ getMiscBookings, voidMiscBooking, type MiscBooking } from "./miscDb"`,
    bookingType: "MiscBooking",
    getBookings: "getMiscBookings",
    voidBooking: "voidMiscBooking",
    adjustmentImport: `./MiscBookingAdjustment`,
    adjustmentComponent: "MiscBookingAdjustment",
    adjustmentDbImport: `./MiscAdjustmentDb`,
    summaryFn: "getMiscAdjustmentSummaryMap",
    summaryType: "MiscAdjustmentSummary",
    detailsColumn: "MISC DETAILS",
    sarColumn: true,
    summary: `(booking) =>
    booking.lines.map((line) => \`\${line.service_name} · \${line.pax_count} pax\`).join(" | ") || "Misc booking"`,
    linePreview: `booking.lines.map((line) => (
                              <div key={line.id}>
                                <b>{line.service_name}</b>
                                <small>{line.pax_count} pax · {money(line.line_total_pkr)}</small>
                              </div>
                            ))`,
  },
];

const hotelRegister = fs.readFileSync(path.join(root, "src/HotelRegister.tsx"), "utf8");

for (const seg of segments) {
  let content = hotelRegister
    .replaceAll("HotelBooking", seg.bookingType)
    .replaceAll("HotelRegister", `${seg.key}Register`)
    .replaceAll("HotelBookingAdjustment", seg.adjustmentComponent)
    .replaceAll("./HotelBookingAdjustment", seg.adjustmentImport)
    .replaceAll("./HotelAdjustmentDb", seg.adjustmentDbImport)
    .replaceAll("getHotelAdjustmentSummaryMap", seg.summaryFn)
    .replaceAll("HotelAdjustmentSummary", seg.summaryType)
    .replaceAll("getHotelBookings", seg.getBookings)
    .replaceAll("voidHotelBooking", seg.voidBooking)
    .replaceAll('bookingLifecycleConfigs.HOTEL', `bookingLifecycleConfigs.${seg.service}`)
    .replaceAll("HOTEL REGISTER", `${seg.service} REGISTER`)
    .replaceAll("HOTEL BOOKING REGISTER", `${seg.service} BOOKING REGISTER`)
    .replaceAll("Hotel adjustments are stored in dedicated Hotel revision history.", `${seg.key} adjustments are stored in dedicated ${seg.key} revision history.`)
    .replaceAll("HOTEL DETAILS", seg.detailsColumn)
    .replaceAll("OPEN HOTEL BOOKING", `OPEN ${seg.service} BOOKING`)
    .replaceAll("CURRENT HOTEL COMMERCIAL ROWS", `CURRENT ${seg.service} COMMERCIAL ROWS`)
    .replaceAll("All commercial rows cancelled", "All commercial rows cancelled")
    .replaceAll('import type { BookingTransactionType, HotelBooking } from "./db";', `import type { BookingTransactionType } from "./db";\nimport ${seg.flowImport};`)
    .replaceAll('import { getHotelBookings, voidHotelBooking } from "./HotelFlowDb";', "")
    .replaceAll("function bookingSummary(booking: HotelBooking)", `function bookingSummary(booking: ${seg.bookingType})`)
    .replaceAll('<div className="empty-icon">HTL</div>', `<div className="empty-icon">${seg.icon}</div>`);

  content = content.replace(
    /function bookingSummary\(booking: [^\)]+\) \{[\s\S]*?\n\}/,
    `function bookingSummary(booking: ${seg.bookingType}) {\n  return (\n    ${seg.summary}\n  );\n}`,
  );

  if (!seg.sarColumn) {
    content = content.replace(/\s*<th>TOTAL SAR<\/th>\n/, "\n");
    content = content.replace(
      /\s*<td>\{cancelled \? "—" : Number\(booking\.total_sar[\s\S]*?<\/td>\n/,
      "\n",
    );
  }

  content = content.replace(
    /\{booking\.lines\.length \? \([\s\S]*?\) : \([\s\S]*?\)\}/,
    `{booking.lines.length ? (${seg.linePreview}) : (<span>All commercial rows cancelled</span>)}`,
  );

  fs.writeFileSync(path.join(root, `src/${seg.key}Register.tsx`), content);
  console.log(`Wrote ${seg.key}Register.tsx`);
}

console.log("Done");
