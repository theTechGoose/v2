import type { Quote } from "@paperwork/dto/quote.ts";

export function isSendable(quote: Pick<Quote, "summary" | "lineItems">): boolean {
  if (!quote.summary || quote.summary.trim().length === 0) return false;
  if (!quote.lineItems || quote.lineItems.length === 0) return false;
  return quote.lineItems.every((li) => li.quantity > 0 && li.price >= 0);
}
