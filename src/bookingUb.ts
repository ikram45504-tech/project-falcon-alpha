export function cleanBookingDigits(value: string) {
  return value.replace(/\D/g, "").slice(0, 4);
}

export function bookingUbFromDigits(value: string) {
  const digits = cleanBookingDigits(value);
  return digits ? `UB-${digits.padStart(4, "0")}` : "";
}

export function bookingDigitsFromUb(value: string) {
  const match = value
    .trim()
    .toUpperCase()
    .match(/^UB-(\d{1,4})$/);
  return match ? String(Number(match[1])) : "";
}

export function normalizeBookingUb(value: string) {
  return value.trim().replace(/\s+/g, " ").toUpperCase();
}
