export type PassportValidityLevel = "PENDING" | "VALID" | "AMBER" | "STRONG_AMBER" | "RED";

export type PassportValidityResult = {
  level: PassportValidityLevel;
  label: string;
  latestEligibleTravelDate: string;
  validForTravel: boolean | null;
};

function parseIsoDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || "");
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!year || month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { year, month, day };
}

function daysInMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function subtractCalendarMonths(value: string, months: number) {
  const parsed = parseIsoDate(value);
  if (!parsed) return "";
  const absoluteMonth = parsed.year * 12 + (parsed.month - 1) - months;
  const year = Math.floor(absoluteMonth / 12);
  const monthIndex = absoluteMonth - year * 12;
  const month = monthIndex + 1;
  const day = Math.min(parsed.day, daysInMonth(year, month));
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function passportValidityForTravel(travelDate: string, passportExpiry: string): PassportValidityResult {
  if (!travelDate || !passportExpiry) {
    return {
      level: "PENDING",
      label: "Travel date / expiry pending",
      latestEligibleTravelDate: passportExpiry ? subtractCalendarMonths(passportExpiry, 6) : "",
      validForTravel: null,
    };
  }

  const latest6 = subtractCalendarMonths(passportExpiry, 6);
  const latest7 = subtractCalendarMonths(passportExpiry, 7);
  const latest12 = subtractCalendarMonths(passportExpiry, 12);
  if (!latest6)
    return { level: "PENDING", label: "Expiry date pending", latestEligibleTravelDate: "", validForTravel: null };

  if (travelDate > latest6) {
    return { level: "RED", label: "Less than 6 months", latestEligibleTravelDate: latest6, validForTravel: false };
  }
  if (travelDate > latest7) {
    return {
      level: "STRONG_AMBER",
      label: "About 6–7 months",
      latestEligibleTravelDate: latest6,
      validForTravel: true,
    };
  }
  if (travelDate > latest12) {
    return { level: "AMBER", label: "About 7–12 months", latestEligibleTravelDate: latest6, validForTravel: true };
  }
  return { level: "VALID", label: "12+ months validity", latestEligibleTravelDate: latest6, validForTravel: true };
}
