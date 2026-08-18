import {
  Document,
  Font,
  Image,
  Page,
  StyleSheet,
  Text,
  View,
} from "@react-pdf/renderer";
import type {
  AccommodationEntry,
  Company,
  Party,
  PaymentEntry,
  ServiceEntry,
} from "./db";

Font.registerHyphenationCallback((word) => [word]);

export type StatementPdfData = {
  company: Company;
  party: Party;
  fromDate: string;
  toDate: string;
  generatedOn: string;
  statementRef: string;
  openingBalance: number;
  purchasesDuringPeriod: number;
  paymentsDuringPeriod: number;
  closingBalance: number;
  accommodationSubtotal: number;
  servicesSubtotal: number;
  accommodation: AccommodationEntry[];
  services: ServiceEntry[];
  payments: PaymentEntry[];
};

const COLORS = {
  navy: "#103C70",
  blue: "#AFCBEA",
  blueSoft: "#EDF4FB",
  blueLine: "#AFC0D2",
  green: "#087A43",
  greenHeader: "#C8E7D4",
  greenSoft: "#EDF7F1",
  purple: "#53208A",
  purpleHeader: "#DDC7EC",
  purpleSoft: "#F3EAF8",
  red: "#B52635",
  redSoft: "#FCEBED",
  ink: "#21344A",
  muted: "#68798B",
  border: "#BFCBD8",
  white: "#FFFFFF",
};

const styles = StyleSheet.create({
  page: {
    paddingTop: 13,
    paddingHorizontal: 10,
    paddingBottom: 24,
    fontFamily: "Helvetica",
    fontSize: 6,
    color: COLORS.ink,
    backgroundColor: COLORS.white,
  },

  continuationHeader: {
    position: "absolute",
    left: 10,
    right: 10,
    top: 5,
    height: 10,
    borderBottomWidth: 0.7,
    borderBottomColor: COLORS.navy,
    fontSize: 5.6,
    color: COLORS.muted,
    paddingBottom: 2,
  },

  topHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 4,
  },
  companySide: {
    width: "57%",
  },
  companyTopRow: {
    flexDirection: "row",
    alignItems: "flex-start",
  },
  logo: {
    width: 27,
    height: 27,
    objectFit: "contain",
    marginRight: 6,
  },
  companyTextWrap: {
    flexGrow: 1,
  },
  companyName: {
    fontSize: 14,
    fontFamily: "Helvetica-Bold",
    color: COLORS.navy,
    lineHeight: 1.05,
  },
  address: {
    fontSize: 5.8,
    marginTop: 2,
    color: COLORS.ink,
  },
  contacts: {
    fontSize: 4.5,
    marginTop: 1.5,
    color: COLORS.muted,
  },
  periodText: {
    fontSize: 5.2,
    marginTop: 4,
  },
  periodLabel: {
    fontFamily: "Helvetica-Bold",
  },
  refBadge: {
    alignSelf: "flex-start",
    marginTop: 2.5,
    paddingVertical: 2,
    paddingHorizontal: 5,
    backgroundColor: "#E7EDF4",
    borderRadius: 2,
    fontSize: 4.8,
    fontFamily: "Helvetica-Bold",
  },

  statementSide: {
    width: "40%",
    alignItems: "flex-end",
  },
  statementTitle: {
    fontSize: 12.4,
    fontFamily: "Helvetica-Bold",
    color: COLORS.navy,
    letterSpacing: 0.3,
  },
  metaRight: {
    marginTop: 3,
    fontSize: 5.4,
    textAlign: "right",
  },
  metaStrong: {
    fontFamily: "Helvetica-Bold",
  },

  divider: {
    height: 1.5,
    backgroundColor: COLORS.navy,
    marginBottom: 5,
  },

  cards: {
    flexDirection: "row",
    gap: 3,
    marginBottom: 5,
  },
  card: {
    width: "25%",
    minHeight: 36,
    paddingHorizontal: 6,
    paddingVertical: 5,
    borderWidth: 0.6,
    borderColor: COLORS.border,
    borderTopWidth: 2.2,
  },
  cardOpening: {
    backgroundColor: "#EDF1F6",
    borderTopColor: COLORS.navy,
  },
  cardPurchase: {
    backgroundColor: "#EDF3FA",
    borderTopColor: "#235C97",
  },
  cardPayment: {
    backgroundColor: COLORS.greenSoft,
    borderTopColor: COLORS.green,
  },
  cardDue: {
    backgroundColor: COLORS.redSoft,
    borderTopColor: COLORS.red,
  },
  cardClear: {
    backgroundColor: COLORS.greenSoft,
    borderTopColor: COLORS.green,
  },
  cardLabel: {
    fontSize: 5.2,
    fontFamily: "Helvetica-Bold",
    color: COLORS.muted,
  },
  cardValue: {
    marginTop: 2,
    fontSize: 10.2,
    fontFamily: "Helvetica-Bold",
    color: COLORS.navy,
  },
  cardValueGreen: {
    color: COLORS.green,
  },
  cardValueRed: {
    color: COLORS.red,
  },
  cardFoot: {
    marginTop: 1,
    fontSize: 4.4,
    color: COLORS.muted,
  },

  section: {
    marginBottom: 4.5,
  },
  sectionTitle: {
    color: COLORS.white,
    fontFamily: "Helvetica-Bold",
    fontSize: 7.8,
    paddingVertical: 4,
    paddingHorizontal: 6,
    letterSpacing: 0.2,
  },
  accommodationTitle: {
    backgroundColor: COLORS.navy,
  },
  servicesTitle: {
    backgroundColor: COLORS.green,
  },
  paymentsTitle: {
    backgroundColor: COLORS.purple,
  },

  table: {
    width: "100%",
    borderLeftWidth: 0.45,
    borderLeftColor: COLORS.border,
    borderRightWidth: 0.45,
    borderRightColor: COLORS.border,
  },
  row: {
    flexDirection: "row",
    alignItems: "stretch",
    minHeight: 12,
    borderBottomWidth: 0.45,
    borderBottomColor: COLORS.border,
  },
  rowAltBlue: {
    backgroundColor: COLORS.blueSoft,
  },
  rowAltGreen: {
    backgroundColor: COLORS.greenSoft,
  },
  rowAltPurple: {
    backgroundColor: COLORS.purpleSoft,
  },
  headerBlue: {
    backgroundColor: COLORS.blue,
  },
  headerGreen: {
    backgroundColor: COLORS.greenHeader,
  },
  headerPurple: {
    backgroundColor: COLORS.purpleHeader,
  },
  cell: {
    paddingHorizontal: 2.6,
    paddingVertical: 2.2,
    borderRightWidth: 0.45,
    borderRightColor: COLORS.border,
    justifyContent: "center",
    lineHeight: 1.12,
  },
  lastCell: {
    borderRightWidth: 0,
  },
  headerCell: {
    paddingVertical: 3,
  },
  headerText: {
    fontSize: 4.9,
    fontFamily: "Helvetica-Bold",
    textAlign: "center",
    color: COLORS.ink,
    lineHeight: 1.05,
  },
  normalText: {
    fontSize: 5.3,
  },
  smallText: {
    fontSize: 4.7,
    color: COLORS.muted,
  },
  boldText: {
    fontFamily: "Helvetica-Bold",
  },
  center: {
    textAlign: "center",
  },
  right: {
    textAlign: "right",
  },
  money: {
    fontFamily: "Helvetica-Bold",
    color: COLORS.green,
    textAlign: "right",
  },

  subtotal: {
    flexDirection: "row",
    justifyContent: "flex-end",
    alignItems: "center",
    minHeight: 12,
    paddingVertical: 2.6,
    paddingHorizontal: 5,
    borderBottomWidth: 0.7,
    borderBottomColor: COLORS.border,
    borderLeftWidth: 0.45,
    borderLeftColor: COLORS.border,
    borderRightWidth: 0.45,
    borderRightColor: COLORS.border,
  },
  subtotalBlue: {
    backgroundColor: "#E6EFF8",
    borderTopWidth: 1.2,
    borderTopColor: COLORS.navy,
  },
  subtotalGreen: {
    backgroundColor: "#E4F2E9",
    borderTopWidth: 1.2,
    borderTopColor: COLORS.green,
  },
  subtotalPurple: {
    backgroundColor: "#EEE3F5",
    borderTopWidth: 1.2,
    borderTopColor: COLORS.purple,
  },
  subtotalLabel: {
    fontSize: 5.2,
    fontFamily: "Helvetica-Bold",
    marginRight: 18,
  },
  subtotalValue: {
    minWidth: 72,
    textAlign: "right",
    fontSize: 5.5,
    fontFamily: "Helvetica-Bold",
  },

  emptyRow: {
    minHeight: 16,
    alignItems: "center",
    justifyContent: "center",
    borderBottomWidth: 0.45,
    borderBottomColor: COLORS.border,
  },
  emptyText: {
    fontSize: 5.2,
    color: COLORS.muted,
  },

  footer: {
    position: "absolute",
    left: 10,
    right: 10,
    bottom: 7,
    paddingTop: 3,
    borderTopWidth: 0.45,
    borderTopColor: COLORS.border,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    fontSize: 4.3,
    color: COLORS.muted,
  },
  footerLeft: {
    width: "31%",
  },
  footerCenter: {
    width: "43%",
    textAlign: "center",
  },
  footerRight: {
    width: "26%",
    textAlign: "right",
  },
});

function money(value: number) {
  const n = Number(value || 0);
  const sign = n < 0 ? "-" : "";
  return `${sign}Rs ${Math.abs(n).toLocaleString("en-US", {
    maximumFractionDigits: 2,
  })}`;
}

function number(value: number) {
  return Number(value || 0).toLocaleString("en-US", {
    maximumFractionDigits: 2,
  });
}

function shortDate(value: string) {
  if (!value) return "—";
  const [y, m, d] = value.split("-").map(Number);
  if (!y || !m || !d) return value;
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
  })
    .format(new Date(y, m - 1, d))
    .replace(/ /g, "-");
}

function dateLong(value: string) {
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

function rateText(currency: string, value: number) {
  return currency === "SAR" ? `SAR ${number(value)}` : money(value);
}

function Cell({
  width,
  children,
  last = false,
  header = false,
  align = "left",
  moneyCell = false,
}: {
  width: string;
  children: React.ReactNode;
  last?: boolean;
  header?: boolean;
  align?: "left" | "center" | "right";
  moneyCell?: boolean;
}) {
  return (
    <View
      style={[
        styles.cell,
        { width },
        header ? styles.headerCell : {},
        last ? styles.lastCell : {},
      ]}
    >
      <Text
        style={[
          header ? styles.headerText : styles.normalText,
          align === "center" ? styles.center : {},
          align === "right" ? styles.right : {},
          moneyCell ? styles.money : {},
        ]}
      >
        {children}
      </Text>
    </View>
  );
}

function PartyUbCell({
  width,
  party,
  ub,
}: {
  width: string;
  party: string;
  ub: string;
}) {
  return (
    <View style={[styles.cell, { width }]}>
      <Text style={[styles.normalText, styles.boldText]}>{party || "—"}</Text>
      <Text style={styles.smallText}>{ub || "—"}</Text>
    </View>
  );
}

function AccommodationSection({
  rows,
  subtotal,
}: {
  rows: AccommodationEntry[];
  subtotal: number;
}) {
  return (
    <View style={styles.section}>
      <View
        style={[styles.sectionTitle, styles.accommodationTitle]}
        wrap={false}
        minPresenceAhead={28}
      >
        <Text>ACCOMMODATION</Text>
      </View>

      <View style={styles.table}>
        <View style={[styles.row, styles.headerBlue]} wrap={false}>
          <Cell width="4%" header align="center">SR</Cell>
          <Cell width="7%" header align="center">DATE</Cell>
          <Cell width="16%" header align="center">PARTY NAME{"\n"}/ UB #</Cell>
          <Cell width="5.5%" header align="center">CITY</Cell>
          <Cell width="14%" header align="center">HOTEL NAME</Cell>
          <Cell width="8%" header align="center">CHECK-IN</Cell>
          <Cell width="6%" header align="center">NO. OF{"\n"}NIGHTS</Cell>
          <Cell width="9%" header align="center">RATE</Cell>
          <Cell width="7.5%" header align="center">NO. OF{"\n"}BED/ROOM</Cell>
          <Cell width="9%" header align="center">TOTAL SAR</Cell>
          <Cell width="14%" header align="center" last>TOTAL PKR</Cell>
        </View>

        {rows.length === 0 ? (
          <View style={styles.emptyRow} wrap={false}>
            <Text style={styles.emptyText}>No accommodation transactions in selected period.</Text>
          </View>
        ) : (
          rows.map((entry, index) => (
            <View
              key={entry.id}
              style={[styles.row, index % 2 === 1 ? styles.rowAltBlue : {}]}
              wrap={false}
            >
              <Cell width="4%" align="center">{index + 1}</Cell>
              <Cell width="7%" align="center">{shortDate(entry.transaction_date)}</Cell>
              <PartyUbCell
                width="16%"
                party={entry.booking_party_name}
                ub={entry.ub_number}
              />
              <Cell width="5.5%" align="center">{entry.city || "—"}</Cell>
              <Cell width="14%">{entry.hotel_name || "—"}</Cell>
              <Cell width="8%" align="center">{shortDate(entry.check_in)}</Cell>
              <Cell width="6%" align="center">{entry.nights}</Cell>
              <Cell width="9%" align="right">{rateText(entry.currency, entry.rate)}</Cell>
              <Cell width="7.5%" align="center">{entry.bed_room_count}</Cell>
              <Cell width="9%" align="right">
                {entry.currency === "SAR" ? number(entry.total_sar) : "—"}
              </Cell>
              <Cell width="14%" align="right" moneyCell last>
                {money(entry.total_pkr)}
              </Cell>
            </View>
          ))
        )}
      </View>

      <View style={[styles.subtotal, styles.subtotalBlue]} wrap={false}>
        <Text style={styles.subtotalLabel}>ACCOMMODATION SUBTOTAL</Text>
        <Text style={styles.subtotalValue}>{money(subtotal)}</Text>
      </View>
    </View>
  );
}

function ServicesSection({
  rows,
  subtotal,
}: {
  rows: ServiceEntry[];
  subtotal: number;
}) {
  return (
    <View style={styles.section}>
      <View
        style={[styles.sectionTitle, styles.servicesTitle]}
        wrap={false}
        minPresenceAhead={28}
      >
        <Text>SERVICES</Text>
      </View>

      <View style={styles.table}>
        <View style={[styles.row, styles.headerGreen]} wrap={false}>
          <Cell width="4%" header align="center">SR</Cell>
          <Cell width="8%" header align="center">DATE</Cell>
          <Cell width="22%" header align="center">PARTY NAME{"\n"}/ UB #</Cell>
          <Cell width="25%" header align="center">SERVICE TYPE</Cell>
          <Cell width="14%" header align="center">RATE{"\n"}(PER HEAD)</Cell>
          <Cell width="7%" header align="center">NO. OF{"\n"}PAX</Cell>
          <Cell width="10%" header align="center">SAR × ROE</Cell>
          <Cell width="10%" header align="center" last>TOTAL PKR</Cell>
        </View>

        {rows.length === 0 ? (
          <View style={styles.emptyRow} wrap={false}>
            <Text style={styles.emptyText}>No service transactions in selected period.</Text>
          </View>
        ) : (
          rows.map((entry, index) => (
            <View
              key={entry.id}
              style={[styles.row, index % 2 === 1 ? styles.rowAltGreen : {}]}
              wrap={false}
            >
              <Cell width="4%" align="center">{index + 1}</Cell>
              <Cell width="8%" align="center">{shortDate(entry.transaction_date)}</Cell>
              <PartyUbCell
                width="22%"
                party={entry.booking_party_name}
                ub={entry.ub_number}
              />
              <Cell width="25%">{entry.service_type || "—"}</Cell>
              <Cell width="14%" align="right">{rateText(entry.currency, entry.rate)}</Cell>
              <Cell width="7%" align="center">{entry.pax}</Cell>
              <Cell width="10%" align="center">
                {entry.currency === "SAR"
                  ? `${number(entry.total_sar)} × ${number(entry.roe)}`
                  : "—"}
              </Cell>
              <Cell width="10%" align="right" moneyCell last>
                {money(entry.total_pkr)}
              </Cell>
            </View>
          ))
        )}
      </View>

      <View style={[styles.subtotal, styles.subtotalGreen]} wrap={false}>
        <Text style={styles.subtotalLabel}>SERVICES SUBTOTAL</Text>
        <Text style={styles.subtotalValue}>{money(subtotal)}</Text>
      </View>
    </View>
  );
}

function PaymentsSection({
  rows,
  subtotal,
}: {
  rows: PaymentEntry[];
  subtotal: number;
}) {
  return (
    <View style={styles.section}>
      <View
        style={[styles.sectionTitle, styles.paymentsTitle]}
        wrap={false}
        minPresenceAhead={28}
      >
        <Text>PAYMENTS</Text>
      </View>

      <View style={styles.table}>
        <View style={[styles.row, styles.headerPurple]} wrap={false}>
          <Cell width="4%" header align="center">SR</Cell>
          <Cell width="7%" header align="center">DATE</Cell>
          <Cell width="8%" header align="center">RECIEPT #</Cell>
          <Cell width="14%" header align="center">FROM ACCOUNT</Cell>
          <Cell width="14%" header align="center">TO ACCOUNT</Cell>
          <Cell width="25%" header align="center">DESCRIPTION</Cell>
          <Cell width="7%" header align="center">TYPE</Cell>
          <Cell width="7%" header align="center">SAR</Cell>
          <Cell width="14%" header align="center" last>PAID AMOUNT</Cell>
        </View>

        {rows.length === 0 ? (
          <View style={styles.emptyRow} wrap={false}>
            <Text style={styles.emptyText}>No payment transactions in selected period.</Text>
          </View>
        ) : (
          rows.map((entry, index) => (
            <View
              key={entry.id}
              style={[styles.row, index % 2 === 1 ? styles.rowAltPurple : {}]}
              wrap={false}
            >
              <Cell width="4%" align="center">{index + 1}</Cell>
              <Cell width="7%" align="center">{shortDate(entry.transaction_date)}</Cell>
              <Cell width="8%" align="center">{entry.receipt_no || "—"}</Cell>
              <Cell width="14%">{entry.from_account || "—"}</Cell>
              <Cell width="14%">{entry.to_account || "—"}</Cell>
              <Cell width="25%">{entry.description || "—"}</Cell>
              <Cell width="7%" align="center">{entry.payment_type}</Cell>
              <Cell width="7%" align="right">
                {entry.currency === "SAR" ? number(entry.sar) : "—"}
              </Cell>
              <Cell width="14%" align="right" moneyCell last>
                {money(entry.paid_amount)}
              </Cell>
            </View>
          ))
        )}
      </View>

      <View style={[styles.subtotal, styles.subtotalPurple]} wrap={false}>
        <Text style={styles.subtotalLabel}>PAYMENTS SUBTOTAL</Text>
        <Text style={styles.subtotalValue}>{money(subtotal)}</Text>
      </View>
    </View>
  );
}

export default function StatementPdfDocument({ data }: { data: StatementPdfData }) {
  const {
    company,
    party,
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
    accommodation,
    services,
    payments,
  } = data;

  const closingLabel =
    closingBalance > 0
      ? "OUTSTANDING BALANCE"
      : closingBalance < 0
        ? "RECEIVABLE / ADVANCE"
        : "SETTLED BALANCE";

  const companyContacts = [company.phone, company.whatsapp, company.email]
    .filter(Boolean)
    .join("  •  ");

  return (
    <Document
      title={`${company.name} - Statement - ${party.name}`}
      author={company.name}
      subject={`Statement of Account - ${party.name}`}
      creator="Travel Accounting"
      producer="Travel Accounting"
      pageLayout="singlePage"
    >
      <Page size="A4" orientation="portrait" wrap style={styles.page}>
        <Text
          fixed
          style={styles.continuationHeader}
          render={({ pageNumber }) =>
            pageNumber > 1
              ? `${company.name}  •  STATEMENT OF ACCOUNT  •  ${party.name}  •  ${dateLong(fromDate)} to ${dateLong(toDate)}`
              : ""
          }
        />

        <View style={styles.topHeader} wrap={false}>
          <View style={styles.companySide}>
            <View style={styles.companyTopRow}>
              {company.logo_data ? (
                <Image style={styles.logo} src={company.logo_data} />
              ) : null}
              <View style={styles.companyTextWrap}>
                <Text style={styles.companyName}>{company.name}</Text>
                <Text style={styles.address}>{company.address || "—"}</Text>
                {companyContacts ? (
                  <Text style={styles.contacts}>{companyContacts}</Text>
                ) : null}
              </View>
            </View>

            <Text style={styles.periodText}>
              <Text style={styles.periodLabel}>Statement Period: </Text>
              {dateLong(fromDate)} to {dateLong(toDate)}
            </Text>
            <Text style={styles.refBadge}>Statement Ref: {statementRef}</Text>
          </View>

          <View style={styles.statementSide}>
            <Text style={styles.statementTitle}>STATEMENT OF ACCOUNT</Text>
            <Text style={styles.metaRight}>
              Ledger: <Text style={styles.metaStrong}>{party.name}</Text>
            </Text>
            <Text style={styles.metaRight}>
              Date Generated: <Text style={styles.metaStrong}>{generatedOn}</Text>
            </Text>
          </View>
        </View>

        <View style={styles.divider} />

        <View style={styles.cards} wrap={false}>
          <View style={[styles.card, styles.cardOpening]}>
            <Text style={styles.cardLabel}>OPENING BALANCE</Text>
            <Text style={styles.cardValue}>{money(openingBalance)}</Text>
            <Text style={styles.cardFoot}>Before selected period</Text>
          </View>

          <View style={[styles.card, styles.cardPurchase]}>
            <Text style={styles.cardLabel}>TOTAL PURCHASES</Text>
            <Text style={styles.cardValue}>{money(purchasesDuringPeriod)}</Text>
            <Text style={styles.cardFoot}>During selected period</Text>
          </View>

          <View style={[styles.card, styles.cardPayment]}>
            <Text style={styles.cardLabel}>TOTAL PAYMENTS</Text>
            <Text style={[styles.cardValue, styles.cardValueGreen]}>
              {money(paymentsDuringPeriod)}
            </Text>
            <Text style={styles.cardFoot}>During selected period</Text>
          </View>

          <View
            style={[
              styles.card,
              closingBalance > 0 ? styles.cardDue : styles.cardClear,
            ]}
          >
            <Text style={styles.cardLabel}>{closingLabel}</Text>
            <Text
              style={[
                styles.cardValue,
                closingBalance > 0 ? styles.cardValueRed : styles.cardValueGreen,
              ]}
            >
              {money(Math.abs(closingBalance))}
            </Text>
            <Text style={styles.cardFoot}>Closing position</Text>
          </View>
        </View>

        <AccommodationSection
          rows={accommodation}
          subtotal={accommodationSubtotal}
        />

        <ServicesSection
          rows={services}
          subtotal={servicesSubtotal}
        />

        <PaymentsSection
          rows={payments}
          subtotal={paymentsDuringPeriod}
        />

        <View fixed style={styles.footer}>
          <Text style={styles.footerLeft}>
            Base Currency: {company.base_currency}  |  Foreign Currency: {company.foreign_currency}
          </Text>

          <Text style={styles.footerCenter}>
            Please report any discrepancy with the relevant SR / Receipt / UB reference.
          </Text>

          <Text
            style={styles.footerRight}
            render={({ pageNumber, totalPages }) =>
              `${statementRef}  •  Page ${pageNumber} of ${totalPages}`
            }
          />
        </View>
      </Page>
    </Document>
  );
}
