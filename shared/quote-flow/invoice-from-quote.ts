/**
 * Invoice ⇄ quote parity (raw-plan p6): the invoice carries ALL the quote's
 * information EXCEPT the numbered Terms list, has no signature block, and
 * links to the accepted agreement (the quote itself) once it is accepted.
 */

import { isAccepted } from "./quote-status.ts";

export interface QuoteLike {
  id: string;
  status?: string;
  acceptedAt?: string | null;
  jobName?: string;
  summary?: string;
  description?: string;
  customer?: unknown;
  lineItems?: unknown[];
  estimatedTotal?: number;
  terms?: unknown;
}

export interface InvoiceFromQuote {
  quoteId: string;
  jobName?: string;
  description?: string;
  customer?: unknown;
  lineItems?: unknown[];
  totalCents?: number;
  signedQuoteUrl?: string;
}

export function buildInvoiceFromQuote(quote: QuoteLike): InvoiceFromQuote {
  const invoice: InvoiceFromQuote = {
    quoteId: quote.id,
    jobName: quote.jobName ?? quote.summary,
    description: quote.description,
    customer: quote.customer,
    lineItems: quote.lineItems,
    totalCents: quote.estimatedTotal,
  };
  // Deliberately NO terms and NO signature fields — the invoice is a bill,
  // not an agreement (the agreement is linked instead).
  if (isAccepted(quote)) {
    invoice.signedQuoteUrl = `/q/${quote.id}`;
  }
  return invoice;
}
