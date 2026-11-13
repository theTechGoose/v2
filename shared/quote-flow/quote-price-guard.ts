/**
 * REQ-302 (demo-loop cycle 1, issues B1 + M29) — the one rule for a quote's
 * money, shared by the server (chat coordinator, DTOs, QuoteStore, lock, send)
 * and the chat island (the "Lock it in" button):
 *
 *   a line is never negative, and the total is always above zero.
 *
 * A $0 line is legal on its own (REQ-267: "Paint supplied by Castro Painting"
 * is an included item) as long as the quote as a whole has a price. "price
 * abc" (one line at 0) and "-500" (a negative line) are not prices.
 *
 * All amounts are INTEGER CENTS (audit1 #3).
 */

import { jobNameInSentence } from "./job-name.ts";

export type QuotePriceProblem = "negative_line" | "no_total";

export interface PricedLine {
  description?: string;
  amountCents?: number;
}

export interface StoredPricedLine {
  description?: string;
  /** per-unit price in cents */
  price?: number;
  quantity?: number;
}

/** Thrown by the store, lock and send when a quote has no price. The message
 *  is already in the contractor's language (the caller picks it). */
export class QuotePriceError extends Error {
  constructor(public readonly problem: QuotePriceProblem, message: string) {
    super(message);
    this.name = "QuotePriceError";
  }
}

function finite(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

/**
 * Judge a quote by its line amounts (cents) and, when given, its explicit
 * total. Returns the problem, or undefined when the quote has a price.
 *
 * - any finite negative line → "negative_line"
 * - total (explicit when given, else the sum of the finite lines) not above
 *   zero → "no_total"
 */
export function quotePriceProblem(
  lines: readonly PricedLine[],
  totalCents?: number,
): QuotePriceProblem | undefined {
  for (const l of lines) {
    if (finite(l.amountCents) && l.amountCents < 0) return "negative_line";
  }
  const total = finite(totalCents) ? totalCents : lines.reduce(
    (s, l) => s + (finite(l.amountCents) ? l.amountCents : 0),
    0,
  );
  if (!(total > 0)) return "no_total";
  return undefined;
}

export function quoteHasPrice(
  lines: readonly PricedLine[],
  totalCents?: number,
): boolean {
  return quotePriceProblem(lines, totalCents) === undefined;
}

/** The stored shape: per-unit `price` × `quantity`, plus `estimatedTotal`. */
export function storedQuotePriceProblem(q: {
  lineItems?: readonly StoredPricedLine[];
  estimatedTotal?: number;
}): QuotePriceProblem | undefined {
  const lines = (q.lineItems ?? []).map((li) => ({
    description: li.description,
    amountCents: finite(li.price)
      ? li.price * (finite(li.quantity) ? li.quantity : 1)
      : undefined,
  }));
  return quotePriceProblem(lines, q.estimatedTotal);
}

/** The line to name in the "what should X cost?" ask: the first negative
 *  line, else the first line, else the fallback (the quote's summary).
 *  REQ-394 (cycle 2, p9): it lands mid-sentence, so it is lowered —
 *  "What should recessed lighting installation (6 lights) cost?". */
export function priceProblemItem(
  lines: readonly PricedLine[],
  fallback: string,
): string {
  const bad = lines.find((l) => finite(l.amountCents) && l.amountCents < 0) ??
    lines[0];
  const d = bad?.description?.trim();
  return jobNameInSentence(d || fallback);
}
