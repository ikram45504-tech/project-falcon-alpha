import { useEffect, useMemo, useState } from "react";
import {
  AccommodationEntry,
  Party,
  ServiceEntry,
  PaymentEntry,
  getAccommodations,
  getServices,
  getPayments,
  voidAccommodation,
  voidService,
  voidPayment,
} from "./db";
import {
  AccommodationFormModal,
  formatDate,
  formatMoney,
  formatNumber,
} from "./Accommodation";
import { ServiceFormModal } from "./Services";
import { PaymentFormModal } from "./Payments";

type Props = {
  companyId: string;
  party: Party;
  parties: Party[];
  onBack: () => void;
  onEditParty: (party: Party) => void;
  onGenerateStatement: (party: Party) => void;
  onChanged: () => void | Promise<void>;
};

export default function PartyLedger({
  companyId,
  party,
  parties,
  onBack,
  onEditParty,
  onGenerateStatement,
  onChanged,
}: Props) {
  const [accommodationEntries, setAccommodationEntries] = useState<AccommodationEntry[]>([]);
  const [serviceEntries, setServiceEntries] = useState<ServiceEntry[]>([]);
  const [paymentEntries, setPaymentEntries] = useState<PaymentEntry[]>([]);

  const [accommodationModalOpen, setAccommodationModalOpen] = useState(false);
  const [editingAccommodation, setEditingAccommodation] = useState<AccommodationEntry | null>(null);
  const [serviceModalOpen, setServiceModalOpen] = useState(false);
  const [editingService, setEditingService] = useState<ServiceEntry | null>(null);
  const [paymentModalOpen, setPaymentModalOpen] = useState(false);
  const [editingPayment, setEditingPayment] = useState<PaymentEntry | null>(null);

  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function load() {
    try {
      const [accommodationRows, serviceRows, paymentRows] = await Promise.all([
        getAccommodations(companyId, "", party.id),
        getServices(companyId, "", party.id),
        getPayments(companyId, "", party.id),
      ]);

      const chronologicalAccommodation = [...accommodationRows].sort((a, b) => {
        const byDate = a.transaction_date.localeCompare(b.transaction_date);
        return byDate !== 0 ? byDate : a.created_at.localeCompare(b.created_at);
      });

      const chronologicalServices = [...serviceRows].sort((a, b) => {
        const byDate = a.transaction_date.localeCompare(b.transaction_date);
        return byDate !== 0 ? byDate : a.created_at.localeCompare(b.created_at);
      });

      const chronologicalPayments = [...paymentRows].sort((a, b) => {
        const byDate = a.transaction_date.localeCompare(b.transaction_date);
        return byDate !== 0 ? byDate : a.created_at.localeCompare(b.created_at);
      });

      setAccommodationEntries(chronologicalAccommodation);
      setServiceEntries(chronologicalServices);
      setPaymentEntries(chronologicalPayments);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  useEffect(() => {
    load();
  }, [companyId, party.id]);

  const accommodationTotal = useMemo(
    () => accommodationEntries
      .filter((entry) => entry.status === "ACTIVE")
      .reduce((sum, entry) => sum + Number(entry.total_pkr || 0), 0),
    [accommodationEntries]
  );

  const serviceTotal = useMemo(
    () => serviceEntries
      .filter((entry) => entry.status === "ACTIVE")
      .reduce((sum, entry) => sum + Number(entry.total_pkr || 0), 0),
    [serviceEntries]
  );

  const paymentTotal = useMemo(
    () => paymentEntries
      .filter((entry) => entry.status === "ACTIVE")
      .reduce((sum, entry) => sum + Number(entry.paid_amount || 0), 0),
    [paymentEntries]
  );

  const purchaseTotal = accommodationTotal + serviceTotal;
  const paidTotal = paymentTotal;
  const balance = purchaseTotal - paidTotal;

  async function accommodationSaved() {
    setMessage(editingAccommodation ? "Accommodation updated successfully." : "Accommodation saved successfully.");
    setError("");
    setEditingAccommodation(null);
    await load();
    await onChanged();
  }

  async function serviceSaved() {
    setMessage(editingService ? "Service updated successfully." : "Service saved successfully.");
    setError("");
    setEditingService(null);
    await load();
    await onChanged();
  }

  async function paymentSaved() {
    setMessage(editingPayment ? "Payment updated successfully." : "Payment saved successfully.");
    setError("");
    setEditingPayment(null);
    await load();
    await onChanged();
  }

  async function voidAccommodationEntry(entry: AccommodationEntry) {
    if (!window.confirm(`Void accommodation entry for ${entry.booking_party_name}?`)) return;
    try {
      await voidAccommodation(companyId, entry.id);
      setMessage("Accommodation entry marked VOID.");
      setError("");
      await load();
      await onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function voidServiceEntry(entry: ServiceEntry) {
    if (!window.confirm(`Void service entry for ${entry.booking_party_name}?`)) return;
    try {
      await voidService(companyId, entry.id);
      setMessage("Service entry marked VOID.");
      setError("");
      await load();
      await onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function voidPaymentEntry(entry: PaymentEntry) {
    if (!window.confirm(`Void payment of ${formatMoney(entry.paid_amount)}?`)) return;
    try {
      await voidPayment(companyId, entry.id);
      setMessage("Payment marked VOID.");
      setError("");
      await load();
      await onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <section className="ledger-page">
      <div className="ledger-top">
        <div>
          <button className="back-link" onClick={onBack}>← Back to Parties</button>
          <span className="eyebrow blue">ACCOUNT LEDGER</span>
          <h2>{party.name}</h2>
          <p>{party.address || "No address"} · {party.phone || party.whatsapp || "No contact"}</p>
        </div>

        <div className="ledger-actions">
          <span className={`status ${party.status.toLowerCase()}`}>{party.status}</span>
          <button className="statement-ledger-btn" onClick={() => onGenerateStatement(party)}>
            Generate Statement
          </button>
          <button className="secondary" onClick={() => onEditParty(party)}>Edit Party</button>
        </div>
      </div>

      {message && <div className="alert success ledger-alert">{message}</div>}
      {error && <div className="alert error ledger-alert">{error}</div>}

      <div className="ledger-summary">
        <div className="purchase">
          <small>PURCHASE</small>
          <b>{formatMoney(purchaseTotal)}</b>
        </div>
        <div className="paid">
          <small>PAID</small>
          <b>{formatMoney(paidTotal)}</b>
        </div>
        <div className="balance">
          <small>BALANCE</small>
          <b>{formatMoney(balance)}</b>
        </div>
      </div>

      <div className="ledger-section blue-section accommodation-ledger-section">
        <div className="ledger-section-title">
          <b>SECTION FOR ACCOMMODATION</b>
          <div className="section-right">
            <strong>TOTAL: {formatMoney(accommodationTotal)}</strong>
            <button
              className="section-add-btn"
              onClick={() => {
                setEditingAccommodation(null);
                setAccommodationModalOpen(true);
              }}
              disabled={party.status !== "ACTIVE"}
            >
              + Add
            </button>
          </div>
        </div>

        {accommodationEntries.length === 0 ? (
          <div className="coming-data">No accommodation entries yet.</div>
        ) : (
          <div className="ledger-table-wrap">
            <table className="ledger-accommodation-table">
              <thead>
                <tr>
                  <th>SR</th><th>DATE</th><th>UB #</th><th>PARTY NAME</th><th>CITY</th>
                  <th>HOTEL NAME</th><th>CHECK-IN</th><th>CHECK-OUT</th><th>NIGHTS</th>
                  <th>RATE</th><th>NO. OF<br />BED/ROOM</th><th>TOTAL PKR</th><th>ROE</th>
                  <th>TOTAL SAR</th><th>ACTION</th>
                </tr>
              </thead>
              <tbody>
                {accommodationEntries.map((entry, index) => (
                  <tr key={entry.id} className={entry.status === "VOID" ? "void-row" : ""}>
                    <td className="centered">{index + 1}</td>
                    <td>{formatDate(entry.transaction_date)}</td>
                    <td>{entry.ub_number || "—"}</td>
                    <td><b>{entry.booking_party_name}</b>{entry.status === "VOID" && <small className="void-label">VOID</small>}</td>
                    <td>{entry.city}</td>
                    <td>{entry.hotel_name}</td>
                    <td>{formatDate(entry.check_in)}</td>
                    <td>{formatDate(entry.check_out)}</td>
                    <td className="centered">{entry.nights}</td>
                    <td className="right">{entry.currency === "SAR" ? `SAR ${formatNumber(entry.rate)}` : formatMoney(entry.rate)}</td>
                    <td className="centered">{entry.bed_room_count}</td>
                    <td className="right total-pkr">{formatMoney(entry.total_pkr)}</td>
                    <td className="right">{entry.currency === "SAR" ? formatNumber(entry.roe) : "—"}</td>
                    <td className="right">{entry.currency === "SAR" ? formatNumber(entry.total_sar) : "—"}</td>
                    <td>
                      <div className="row-actions compact-actions">
                        <button disabled={entry.status === "VOID"} onClick={() => { setEditingAccommodation(entry); setAccommodationModalOpen(true); }}>Edit</button>
                        <button className="danger-action" disabled={entry.status === "VOID"} onClick={() => voidAccommodationEntry(entry)}>Void</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="ledger-section green-section services-ledger-section">
        <div className="ledger-section-title">
          <b>SECTION FOR SERVICES</b>
          <div className="section-right">
            <strong>TOTAL: {formatMoney(serviceTotal)}</strong>
            <button
              className="section-add-btn service-section-add"
              onClick={() => { setEditingService(null); setServiceModalOpen(true); }}
              disabled={party.status !== "ACTIVE"}
            >+ Add</button>
          </div>
        </div>

        {serviceEntries.length === 0 ? (
          <div className="coming-data">No service entries yet.</div>
        ) : (
          <div className="ledger-table-wrap">
            <table className="ledger-service-table">
              <thead>
                <tr>
                  <th>SR</th><th>DATE</th><th>UB #</th><th>PARTY NAME</th><th>SERVICE TYPE</th>
                  <th>RATE</th><th>NO. PAX</th><th>TOTAL PKR</th><th>SPT</th><th>SHR</th>
                  <th>ROE</th><th>TOTAL SAR</th><th>ACTION</th>
                </tr>
              </thead>
              <tbody>
                {serviceEntries.map((entry, index) => (
                  <tr key={entry.id} className={entry.status === "VOID" ? "void-row" : ""}>
                    <td className="centered">{index + 1}</td>
                    <td>{formatDate(entry.transaction_date)}</td>
                    <td>{entry.ub_number || "—"}</td>
                    <td><b>{entry.booking_party_name}</b>{entry.status === "VOID" && <small className="void-label">VOID</small>}</td>
                    <td>{entry.service_type}</td>
                    <td className="right">{entry.currency === "SAR" ? `SAR ${formatNumber(entry.rate)}` : formatMoney(entry.rate)}</td>
                    <td className="centered">{entry.pax}</td>
                    <td className="right total-pkr">{formatMoney(entry.total_pkr)}</td>
                    <td className="right">{entry.spt ? formatNumber(entry.spt) : "—"}</td>
                    <td className="right">{entry.shr ? formatNumber(entry.shr) : "—"}</td>
                    <td className="right">{entry.currency === "SAR" ? formatNumber(entry.roe) : "—"}</td>
                    <td className="right">{entry.currency === "SAR" ? formatNumber(entry.total_sar) : "—"}</td>
                    <td>
                      <div className="row-actions compact-actions">
                        <button disabled={entry.status === "VOID"} onClick={() => { setEditingService(entry); setServiceModalOpen(true); }}>Edit</button>
                        <button className="danger-action" disabled={entry.status === "VOID"} onClick={() => voidServiceEntry(entry)}>Void</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="ledger-section purple-section payments-ledger-section">
        <div className="ledger-section-title">
          <b>SECTION FOR PAYMENTS</b>
          <div className="section-right">
            <strong>TOTAL: {formatMoney(paymentTotal)}</strong>
            <button
              className="section-add-btn payment-section-add"
              onClick={() => { setEditingPayment(null); setPaymentModalOpen(true); }}
              disabled={party.status !== "ACTIVE"}
            >+ Add</button>
          </div>
        </div>

        {paymentEntries.length === 0 ? (
          <div className="coming-data">No payment entries yet.</div>
        ) : (
          <div className="ledger-table-wrap">
            <table className="ledger-payment-table">
              <thead>
                <tr>
                  <th>SR</th><th>DATE</th><th>RECEIPT #</th><th>FROM ACCOUNT</th>
                  <th>TO ACCOUNT</th><th>DESCRIPTION</th><th>TYPE</th><th>SAR</th>
                  <th>ROE</th><th>PAID AMOUNT</th><th>ACTION</th>
                </tr>
              </thead>
              <tbody>
                {paymentEntries.map((entry, index) => (
                  <tr key={entry.id} className={entry.status === "VOID" ? "void-row" : ""}>
                    <td className="centered">{index + 1}</td>
                    <td>{formatDate(entry.transaction_date)}</td>
                    <td>{entry.receipt_no || "—"}</td>
                    <td>{entry.from_account}</td>
                    <td>{entry.to_account}</td>
                    <td className="payment-description-cell">{entry.description || "—"}{entry.status === "VOID" && <small className="void-label">VOID</small>}</td>
                    <td className="centered">{entry.payment_type}</td>
                    <td className="right">{entry.currency === "SAR" ? formatNumber(entry.sar) : "—"}</td>
                    <td className="right">{entry.currency === "SAR" ? formatNumber(entry.roe) : "—"}</td>
                    <td className="right payment-paid-amount">{formatMoney(entry.paid_amount)}</td>
                    <td>
                      <div className="row-actions compact-actions">
                        <button disabled={entry.status === "VOID"} onClick={() => { setEditingPayment(entry); setPaymentModalOpen(true); }}>Edit</button>
                        <button className="danger-action" disabled={entry.status === "VOID"} onClick={() => voidPaymentEntry(entry)}>Void</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {accommodationModalOpen && (
        <AccommodationFormModal
          companyId={companyId}
          parties={parties}
          initialPartyId={party.id}
          editing={editingAccommodation}
          onClose={() => { setAccommodationModalOpen(false); setEditingAccommodation(null); }}
          onSaved={accommodationSaved}
        />
      )}

      {serviceModalOpen && (
        <ServiceFormModal
          companyId={companyId}
          parties={parties}
          initialPartyId={party.id}
          editing={editingService}
          onClose={() => { setServiceModalOpen(false); setEditingService(null); }}
          onSaved={serviceSaved}
        />
      )}

      {paymentModalOpen && (
        <PaymentFormModal
          companyId={companyId}
          parties={parties}
          initialPartyId={party.id}
          editing={editingPayment}
          onClose={() => { setPaymentModalOpen(false); setEditingPayment(null); }}
          onSaved={paymentSaved}
        />
      )}
    </section>
  );
}
