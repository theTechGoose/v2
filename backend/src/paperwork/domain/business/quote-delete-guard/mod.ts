import { isAccepted } from "#quote-flow/quote-status.ts";

/** Why a quote may not be deleted, or null when it may. */
export type QuoteDeleteBlock = "locked_accepted" | "locked_invoiced";

/**
 * REQ-485 (demo-loop cycle 3, m22): a signed quote is the binding agreement
 * and stays on the record (`locked_accepted`); a quote billed by any
 * non-void invoice stays too (`locked_invoiced`) — the invoice points at it.
 * `invoices` are the quote's own invoices (deleted ones already excluded).
 */
export function quoteDeleteBlock(
  quote: { status?: string | null; acceptedAt?: string | null },
  invoices: ReadonlyArray<{ status?: string | null }>,
): QuoteDeleteBlock | null {
  if (isAccepted(quote)) return "locked_accepted";
  if (invoices.some((i) => i.status !== "void")) return "locked_invoiced";
  return null;
}
