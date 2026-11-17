import { Injectable } from "#danet/core";

export interface TranslateInvoiceRequest {
  userId: string;
  invoiceId: string;
  /** The contractor's app language — a hint. REQ-710 (cycle 5, M4): the
   *  language the invoice's text reads in wins; this decides only when the
   *  text can't tell. */
  baseLang?: "en" | "es";
}

export type InvoiceTranslateFn = (
  req: TranslateInvoiceRequest,
) => Promise<unknown>;

/**
 * REQ-497 (demo-loop cycle 3, m23) — the paperwork side's door to the
 * invoice translator. Translation needs the LLM, which lives in the agents
 * module, and agents imports paperwork (not the other way round). So the
 * agents' TranslateInvoice registers itself here when the app boots (Danet
 * builds singleton injectables at bootstrap, like NotifyOnEvent's EventBus
 * subscription), and POST /invoices calls `run` without knowing about agents.
 *
 * Without a registered translator (paperwork booted alone, as in its own
 * tests) `run` is a no-op. A translator failure is logged, never thrown — an
 * untranslated invoice is still an invoice.
 */
@Injectable()
export class InvoiceTranslatorPort {
  private fn?: InvoiceTranslateFn;

  register(fn: InvoiceTranslateFn): void {
    this.fn = fn;
  }

  async run(req: TranslateInvoiceRequest): Promise<void> {
    if (!this.fn) return;
    try {
      await this.fn(req);
    } catch (err) {
      console.error(`[invoice-translator] invoice=${req.invoiceId}:`, err);
    }
  }
}
