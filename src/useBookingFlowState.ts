import { useState, useEffect } from "react";
import type { BookingTransactionType } from "./db";
import { normalizeBookingUb } from "./bookingUb";
import { getGlobalUbSaleOwner } from "./LedgerEngine";
import { getPartyById } from "./db";

type CommonEntry = {
  id: string;
  transaction_type: string;
  counterparty_id: string;
  ub_number: string;
  status?: string;
};

export type Mode = "FORM" | "REGISTER";

export function localDate() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function useBookingFlowState<T extends CommonEntry>(
  companyId: string,
  transactionType: BookingTransactionType,
  entries: T[],
  serviceLabel: string,
) {
  const [mode, setMode] = useState<Mode>("FORM");
  const [tx, setTx] = useState<BookingTransactionType>(transactionType);
  const [counterpartyId, setCounterpartyId] = useState("");
  const [bookingDate, setBookingDate] = useState(localDate());
  const [ubDigits, setUbDigits] = useState("");
  const [ubNumber, setUbNumber] = useState("");
  const [saved, setSaved] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!editingId) setTx(transactionType);
  }, [transactionType, editingId]);

  function resetState() {
    setTx(transactionType);
    setCounterpartyId("");
    setBookingDate(localDate());
    setUbDigits("");
    setUbNumber("");
    setSaved(false);
    setDetailsOpen(false);
    setEditingId(null);
    setError("");
    setMessage("");
  }

  async function validateBookingUb(formatted: string): Promise<boolean> {
    setError("");
    if (!counterpartyId) {
      setError(tx === "SALE" ? "Select a Party / Customer first." : "Select a Vendor / Supplier first.");
      return false;
    }
    if (!bookingDate) {
      setError("Date of Booking is required.");
      return false;
    }
    if (!formatted) {
      setError("Enter a booking number using 1 to 4 digits.");
      return false;
    }

    const duplicate = entries.find((entry) => {
      if (editingId && entry.id === editingId) return false;
      if (entry.status && entry.status !== "ACTIVE") return false;
      if (normalizeBookingUb(entry.ub_number) !== formatted) return false;
      return tx === "SALE"
        ? entry.transaction_type === "SALE"
        : entry.transaction_type === "PURCHASE" && entry.counterparty_id === counterpartyId;
    });

    if (duplicate) {
      setError(
        tx === "SALE"
          ? `${formatted} already has a ${serviceLabel} Sale booking.`
          : `This Vendor already has a ${serviceLabel} Purchase booking for ${formatted}.`,
      );
      return false;
    }

    try {
      setBusy(true);
      const owner = await getGlobalUbSaleOwner(companyId, formatted);
      if (owner && tx === "SALE" && owner.partyId !== counterpartyId) {
        const partyInfo = await getPartyById(companyId, owner.partyId);
        const partyName = partyInfo?.name || "another customer";
        setError(
          `This Unique Booking # (${formatted}) is designed for ${partyName} only. Please change unique number.`,
        );
        return false;
      }
    } catch (e) {
      setError(`Failed to validate UB ownership: ${e instanceof Error ? e.message : String(e)}`);
      return false;
    } finally {
      setBusy(false);
    }

    return true;
  }

  return {
    mode,
    setMode,
    tx,
    setTx,
    counterpartyId,
    setCounterpartyId,
    bookingDate,
    setBookingDate,
    ubDigits,
    setUbDigits,
    ubNumber,
    setUbNumber,
    saved,
    setSaved,
    detailsOpen,
    setDetailsOpen,
    editingId,
    setEditingId,
    busy,
    setBusy,
    error,
    setError,
    message,
    setMessage,
    validateBookingUb,
    resetState,
  };
}
