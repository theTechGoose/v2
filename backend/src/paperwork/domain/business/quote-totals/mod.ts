import type { LineItemDto } from "@paperwork/dto/quote.ts";

export function quoteTotal(lineItems: LineItemDto[]): number {
  return lineItems.reduce((sum, li) => sum + li.quantity * li.price, 0);
}
