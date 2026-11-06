/**
 * REQ-201 — sending a document publishes what is pending on it: the link
 * the customer receives must show what was sent. A locked document (a
 * signed quote, a paid invoice) has nothing pending by construction.
 */
import type { QuoteStore } from "@paperwork/domain/data/quote-store/mod.ts";
import type { InvoiceStore } from "@paperwork/domain/data/invoice-store/mod.ts";
import type { Quote } from "@paperwork/dto/quote.ts";
import type { Invoice } from "@paperwork/dto/invoice.ts";
import {
  invoiceBalance,
  isInvoiceLocked,
  isQuoteLocked,
} from "#documents/versions.ts";

export async function publishPendingQuote(
  quotes: QuoteStore,
  id: string,
  userId: string,
): Promise<Quote> {
  const quote = await quotes.getOwned(id, userId);
  const pending = quote.pendingRevision;
  if (!pending || Object.keys(pending).length === 0 || isQuoteLocked(quote)) {
    return quote;
  }
  return await quotes.publishRevision(id, userId, pending, { userId });
}

export async function publishPendingInvoice(
  invoices: InvoiceStore,
  id: string,
  userId: string,
): Promise<Invoice> {
  const invoice = await invoices.getOwned(id, userId);
  const pending = invoice.pendingRevision;
  if (
    !pending || Object.keys(pending).length === 0 || isInvoiceLocked(invoice)
  ) return invoice;
  return await invoices.publishRevision(
    id,
    userId,
    pending,
    { userId },
    (next) => {
      const { overpaidCents } = invoiceBalance(
        next.amount,
        next.paidCents ?? 0,
      );
      const out = { ...next };
      if (overpaidCents > 0) out.overpaidCents = overpaidCents;
      else delete out.overpaidCents;
      return out;
    },
  );
}
