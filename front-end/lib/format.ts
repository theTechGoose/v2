/** Money helpers — input is INTEGER CENTS across the board. The unit
 *  convention was unified per audit1 #3:
 *
 *  - aggregates / KPIs (no cents):  fmtMoney(1_420_000)      → "$14,200"
 *  - document totals (with cents):  fmtMoneyExact(1_099_000) → "$10,990.00"
 *  - alias for explicit-no-cents:   fmtMoneyShort = fmtMoney
 *
 *  Anywhere callers used to pass dollars, multiply by 100 once at the
 *  source (DTO field, seed value) — the formatter is intentionally not
 *  unit-tolerant so a dollars-shaped value entering it is a visible bug
 *  ("$1.50" instead of "$150" → instantly catches a missed conversion).
 */
export const fmtMoney = (cents: number | null | undefined): string => {
  if (typeof cents !== "number" || !Number.isFinite(cents)) return "$0";
  // Round-half-away-from-zero (symmetric across positive/negative). JS's
  // Math.round breaks .5 ties toward +∞, so a naive Math.round(-50/100)
  // yields 0 instead of -1 — that asymmetry is wrong for money.
  const dollars = Math.round(Math.abs(cents) / 100);
  // Render negatives as "-$X" rather than "$-X" — refund / overpayment
  // balances read as a debit, not a typo. Suppress the sign on rounded-
  // to-zero values so -49¢ renders as "$0", not "-$0".
  const sign = cents < 0 && dollars > 0 ? "-" : "";
  return `${sign}$${dollars.toLocaleString("en-US")}`;
};
export const fmtMoneyShort = fmtMoney;
export const fmtMoneyExact = (cents: number | null | undefined): string => {
  if (typeof cents !== "number" || !Number.isFinite(cents)) return "—";
  const sign = cents < 0 ? "-" : "";
  return `${sign}$${(Math.abs(cents) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

export const pluralize = (count: number, singular: string, plural?: string): string =>
  `${count} ${count === 1 ? singular : (plural ?? `${singular}s`)}`;

/** Format a US phone number for display.
 *  - "+15125550000" → "(512) 555-0000"
 *  - "5125550000"   → "(512) 555-0000"
 *  - non-NANP / unparseable: returns the input unchanged (still readable). */
export function fmtPhone(raw: string | null | undefined): string {
  if (!raw) return "";
  const digits = raw.replace(/\D/g, "");
  // Strip a leading 1 country code if present.
  const usDigits = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (usDigits.length === 10) {
    return `(${usDigits.slice(0, 3)}) ${usDigits.slice(3, 6)}-${usDigits.slice(6)}`;
  }
  return raw;
}

/** E.164 form for tel: hrefs. Adds +1 for 10-digit US input; passes
 *  through anything already starting with +. */
export function telHref(raw: string | null | undefined): string {
  if (!raw) return "";
  if (raw.trim().startsWith("+")) return `tel:${raw.replace(/[^\d+]/g, "")}`;
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) return `tel:+1${digits}`;
  if (digits.length === 11) return `tel:+${digits}`;
  return `tel:${raw}`;
}

