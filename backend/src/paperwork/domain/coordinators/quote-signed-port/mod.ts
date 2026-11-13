import { Injectable } from "#danet/core";

export interface QuoteSignedEvent {
  /** the business that owns the quote */
  userId: string;
  quoteId: string;
  /** the first invoice the signature billed and sent (SendSignedConfirmation's
   *  `invoiceId`); absent when nothing is due yet (payment after completion) */
  invoiceId?: string;
  /** REQ-697 (demo-loop cycle 5, m22): the after-completion invoice the
   *  signature SCHEDULED (not sent) — the owner is reminded to send it */
  scheduledInvoiceId?: string;
  /** REQ-699: the Field subscription that bills a recurring quote each
   *  period (SendSignedConfirmation's `subscriptionId`) */
  subscriptionId?: string;
}

export type QuoteSignedFn = (e: QuoteSignedEvent) => Promise<unknown>;

/**
 * REQ-563 (demo-loop cycle 4, m3) — the paperwork side's door to the owner's
 * chat. The customer signs on the public /q page (PaperworkPublicController),
 * but the conversation the quote was made in lives in the agents module, and
 * agents imports paperwork (not the other way round). So the agents'
 * AcceptQuote registers itself here when the app boots (the REQ-497
 * InvoiceTranslatorPort pattern), and the public accept tells it once the
 * signature has billed — the chat then says who signed and what went out.
 *
 * Without a registered listener (paperwork booted alone, as in its own
 * tests) `run` is a no-op. A failure is logged, never thrown — the signature
 * stands whatever the chat does.
 */
@Injectable()
export class QuoteSignedPort {
  private fn?: QuoteSignedFn;

  register(fn: QuoteSignedFn): void {
    this.fn = fn;
  }

  async run(e: QuoteSignedEvent): Promise<void> {
    if (!this.fn) return;
    try {
      await this.fn(e);
    } catch (err) {
      console.error(`[quote-signed] quote=${e.quoteId}:`, err);
    }
  }
}
