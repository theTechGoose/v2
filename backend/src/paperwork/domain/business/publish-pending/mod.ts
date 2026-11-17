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
  type DocVersionRecord,
  invoiceBalance,
  isInvoiceLocked,
  isQuoteLocked,
} from "#documents/versions.ts";

/** REQ-248: the sender as a publisher — their id and, when on file, their name. */
export function senderAsPublisher(
  userId: string,
  name?: string | null,
): DocVersionRecord["publishedBy"] {
  const n = name?.trim();
  return { userId, ...(n ? { name: n } : {}) };
}

export async function publishPendingQuote(
  quotes: QuoteStore,
  id: string,
  userId: string,
  /** REQ-248: who sent it — `{ userId, name }`, like the publish button's publisherOf */
  by: DocVersionRecord["publishedBy"] = { userId },
): Promise<Quote> {
  const quote = await quotes.getOwned(id, userId);
  const pending = quote.pendingRevision;
  if (!pending || Object.keys(pending).length === 0 || isQuoteLocked(quote)) {
    return quote;
  }
  return await quotes.publishRevision(id, userId, pending, by);
}

export async function publishPendingInvoice(
  invoices: InvoiceStore,
  id: string,
  userId: string,
  by: DocVersionRecord["publishedBy"] = { userId },
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
    by,
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

/**
 * REQ-480 (demo-loop cycle 3, M18): an invoice the contractor has not issued
 * yet (draft / scheduled) is issued BY its delivery — the send endpoints
 * stamp it "sent" only once a channel actually delivers, so an invoice nobody
 * received is never listed as Sent. Until then the message it goes out in
 * already reads as issued.
 */
export function isUnissuedInvoice(invoice: { status?: string }): boolean {
  return invoice.status === "draft" || invoice.status === "scheduled";
}

/** REQ-480: the invoice as its outgoing message shows it — issued. */
export function asDelivered<T extends { status?: string }>(invoice: T): T {
  return isUnissuedInvoice(invoice) ? { ...invoice, status: "sent" } : invoice;
}

/** REQ-480: stamp an unissued invoice "sent" + sentAt after a delivery
 *  succeeded (idempotent: an issued invoice is left alone). REQ-566: returns
 *  the invoice when THIS call issued it, so the caller announces it once. */
export async function stampInvoiceDelivered(
  invoices: InvoiceStore,
  id: string,
  userId: string,
): Promise<Invoice | undefined> {
  const current = await invoices.getOwned(id, userId);
  if (!isUnissuedInvoice(current)) return undefined;
  return await invoices.update(id, userId, {
    status: "sent",
    sentAt: current.sentAt ?? new Date().toISOString(),
  });
}
