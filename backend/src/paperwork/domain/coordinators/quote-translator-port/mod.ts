import { Injectable } from "#danet/core";

export interface TranslateQuoteRequest {
  userId: string;
  quoteId: string;
  /** Languages to fill; the translator's default (every language) if unset. */
  langs?: readonly ("en" | "es")[];
}

export type QuoteTranslateFn = (req: TranslateQuoteRequest) => Promise<unknown>;

/**
 * REQ-591 (demo-loop cycle 4, M32) — the paperwork side's door to the quote
 * translator, like REQ-497's InvoiceTranslatorPort. Translation needs the
 * LLM, which lives in the agents module, and agents imports paperwork (not
 * the other way round), so the agents' TranslateQuote registers itself here
 * when the app boots. PreviewQuoteSend runs it when the picked language has
 * no cached heading/description yet, so the English preview of a Spanish
 * quote is English — what lock and send already do before they dispatch.
 *
 * Without a registered translator (paperwork booted alone, as in its own
 * tests) `run` is a no-op. A translator failure is logged, never thrown — an
 * untranslated preview is still a preview.
 */
@Injectable()
export class QuoteTranslatorPort {
  private fn?: QuoteTranslateFn;

  register(fn: QuoteTranslateFn): void {
    this.fn = fn;
  }

  async run(req: TranslateQuoteRequest): Promise<void> {
    if (!this.fn) return;
    try {
      await this.fn(req);
    } catch (err) {
      console.error(`[quote-translator] quote=${req.quoteId}:`, err);
    }
  }
}
