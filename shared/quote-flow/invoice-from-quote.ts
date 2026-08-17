/**
 * Invoice ⇄ quote parity (raw-plan p6): the invoice carries ALL the quote's
 * information EXCEPT the numbered Terms list, has no signature block, and
 * links to the signed agreement when one exists.
 */

export interface QuoteLike {
  id: string;
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

export function buildInvoiceFromQuote(
  quote: QuoteLike,
  signedContract?: { contractId: string; signedAt: string },
): InvoiceFromQuote {
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
  if (signedContract) {
    invoice.signedQuoteUrl = `/c/${signedContract.contractId}`;
  }
  return invoice;
}
