import { fmtPayHandle, fmtPhone } from "../../shared/identity/phone.ts";

/** Money helpers — input is INTEGER CENTS across the board. The unit
 *  convention was unified per audit1 #3:
 *
 *  - aggregates / KPIs (no cents):  fmtMoney(1_420_000)      → "$14,200"
 *  - document totals (with cents):  fmtMoneyExact(1_099_000) → "$10,990.00"
 *  - alias for explicit-no-cents:   fmtMoneyShort = fmtMoney
 *  - totals read against an exact document (REQ-961): fmtMoneyTotal —
 *    whole dollars when the total is whole ("$2,400"), to the cent when it
 *    is not ("$2,489.75"), so it always reconciles with the invoice.
 *
 *  REQ-961: ONE invoice's or payment's amount is a document total — always
 *  fmtMoneyExact, never fmtMoney (which would print $2,489.75 as "$2,490").
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
  return `${sign}$${
    (Math.abs(cents) / 100).toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  }`;
};

/** REQ-961 (q1-35): a total that reads against exact documents — the money
 *  bar's buckets, PAID THIS MONTH, the /payments month total. A whole-dollar
 *  total stays compact ("$2,400", "$0"); anything else keeps its cents
 *  ("$2,489.75"), so it never disagrees with the invoice it sums. */
export const fmtMoneyTotal = (cents: number | null | undefined): string => {
  if (typeof cents !== "number" || !Number.isFinite(cents)) return "$0";
  return Math.round(cents) % 100 === 0 ? fmtMoney(cents) : fmtMoneyExact(cents);
};

export const pluralize = (
  count: number,
  singular: string,
  plural?: string,
): string => `${count} ${count === 1 ? singular : (plural ?? `${singular}s`)}`;

/** Format a US phone number for display — REQ-836: the one formatter, shared with the backend
 *  (shared/identity/phone.ts). */
export { fmtPhone };

/** REQ-326 (demo m39): a pay handle shown to the customer — a phone-shaped handle reads
 *  "(512) 555-0108", anything else as typed. Lives in shared/identity/phone.ts (REQ-1032) so the
 *  backend's email uses the same formatter. */
export { fmtPayHandle };

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

/** Split a quote's free-text `description` into scope-of-work lines.
 *  The "I know my price" flow stores newline-separated bullets here;
 *  legacy/LLM flows store a 1–3 sentence paragraph (one line). Strips any
 *  leading bullet glyph so the renderer can supply its own marker. Callers
 *  render a bulleted list when >1 line, else a single paragraph. */
export function detailLines(description: string | null | undefined): string[] {
  return (description ?? "")
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*[••\-*]\s*/, "").trim())
    .filter((l) => l.length > 0);
}

/** REQ-1042 (q2-26): a calendar date with its year — "Nov 19, 2026" (en), "19 nov 2026" (es).
 *  The whole date goes through Intl with `year: "numeric"`, so en-US puts its comma in; never glue
 *  the ISO year onto a month-day string by hand. Reads the ISO calendar day (UTC), so a late-UTC
 *  timestamp stays on its own day. No date → "—". */
export function fmtDayYear(
  iso: string | null | undefined,
  lang: "en" | "es",
): string {
  if (!iso) return "—";
  return new Date(iso.slice(0, 10) + "T12:00:00Z").toLocaleDateString(
    lang === "es" ? "es-US" : "en-US",
    { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" },
  );
}
