/** Parse user-entered amount with comma grouping (e.g. "100,000" → 100000). */
export function parseFormattedAmount(value: string): number {
  const cleaned = value.replace(/,/g, "").trim();
  if (!cleaned) return 0;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

/** Format number for amount input display with en-PK comma grouping. */
export function formatAmountInput(value: string | number): string {
  if (value === "" || value === null || value === undefined) return "";
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return "";
    if (/,$/.test(trimmed) || /\.$/.test(trimmed)) return trimmed;
    const parsed = parseFormattedAmount(trimmed);
    if (!parsed && trimmed !== "0") return trimmed;
    return parsed.toLocaleString("en-PK", { maximumFractionDigits: 2 });
  }
  return Number(value || 0).toLocaleString("en-PK", { maximumFractionDigits: 2 });
}

/** Pakistani voucher-style PKR equivalent (read-only field). */
export function pkrEquivalent(value: number) {
  return `Rs ${Number(value || 0).toLocaleString("en-PK", { maximumFractionDigits: 2 })}/=`;
}
