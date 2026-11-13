/**
 * A customer card's balance sub-line as DATA (REQ-367) worded by the reader
 * in the language live on screen (REQ-350, demo-loop cycle 1 m9).
 *
 * REQ-350 localized the line ("INV-001 · vencida", "esperando el pago", one /
 * other for "due in N days"); REQ-367 keeps every word off the GET /clients
 * card so an EN/ES switch reaches it without a refetch. Reconciled on
 * demo-fixes: the backend sends `balanceSubParts` (kind + its values) and the
 * client words it with `balanceSubLabel`; the card's `balanceSub` string is
 * the same words in English, the language-neutral base.
 *
 * Dependency-free (but for the shared date formatter): imported by the
 * backend (#quote-flow/), the front-end and the Jest unit suite. Translation
 * is injected.
 */
import { formatShortDate } from "./format-helpers.ts";

export type BalanceSubKind =
  | "overdue"
  | "dueToday"
  | "dueIn"
  | "owes"
  | "onFile"
  | "quoteOut"
  | "toBill"
  | "settled";

export interface BalanceSubParts {
  kind: BalanceSubKind;
  /** The invoice's own number ("INV-001") — overdue / dueToday / dueIn. */
  ref?: string;
  /** Days until due — dueIn. */
  days?: number;
  /** Credit on file / the open quote's total / what is still to bill, in
   *  cents — onFile / quoteOut / toBill. */
  amountCents?: number;
  /** REQ-696: the soonest scheduled installment's send day (YYYY-MM-DD) — toBill. */
  date?: string;
}

/** `tFor(lang, key, vars)` (front-end) / `t(lang, key, vars)` (backend). */
export type Translate = (
  lang: "en" | "es",
  key: string,
  vars?: Record<string, string | number>,
) => string;

/** "$1,240" — whole dollars, like the card's other amounts. */
export function balanceDollars(cents: number): string {
  return `$${Math.round(cents / 100).toLocaleString("en-US")}`;
}

/** The balance sub-line in `lang` (clientsDisplay.balanceSub.*). */
export function balanceSubLabel(
  parts: BalanceSubParts,
  lang: "en" | "es",
  t: Translate,
): string {
  const key = `clientsDisplay.balanceSub.${parts.kind}`;
  switch (parts.kind) {
    case "overdue":
    case "dueToday":
      return t(lang, key, { ref: parts.ref ?? "" });
    case "dueIn": {
      const n = parts.days ?? 0;
      return t(lang, `${key}.${n === 1 ? "one" : "other"}`, {
        n,
        ref: parts.ref ?? "",
      });
    }
    case "onFile":
    case "quoteOut":
      return t(lang, key, { amount: balanceDollars(parts.amountCents ?? 0) });
    // REQ-696 (demo-loop cycle 5, M5): "$350 to bill · Nov 20"
    case "toBill": {
      const amount = balanceDollars(parts.amountCents ?? 0);
      return parts.date
        ? t(lang, key, { amount, date: formatShortDate(parts.date, lang) })
        : t(lang, `${key}.undated`, { amount });
    }
    default:
      return t(lang, key);
  }
}
