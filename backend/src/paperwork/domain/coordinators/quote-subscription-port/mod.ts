import { Injectable } from "#danet/core";

export interface QuoteSubscriptionEvent {
  /** the business that owns the quote */
  userId: string;
  /** the signed quote whose payment term is recurring */
  quoteId: string;
}

export type QuoteSubscriptionFn = (
  e: QuoteSubscriptionEvent,
) => Promise<{ subscriptionId: string } | null>;

/**
 * REQ-699 (demo-loop cycle 5, M20) — the paperwork side's door to Field's
 * subscriptions. Signing a quote whose payment term is recurring ("Monthly ·
 * $180/mo") must start that billing, but the Subscription model lives in the
 * Field module, and Field imports paperwork (not the other way round). So
 * Field's FieldQuoteSubscriptions registers itself here when the app boots
 * (the REQ-497 / REQ-563 port pattern), and SendSignedConfirmation asks it
 * without knowing about Field.
 *
 * `run` answers the subscription that bills the quote, or null — nothing
 * registered (paperwork booted alone, as in its own tests), the quote is not
 * recurring, or Field could not make one. A failure is logged, never thrown:
 * the caller then bills the period once, the signature stands regardless.
 */
@Injectable()
export class QuoteSubscriptionPort {
  private fn?: QuoteSubscriptionFn;

  register(fn: QuoteSubscriptionFn): void {
    this.fn = fn;
  }

  async run(
    e: QuoteSubscriptionEvent,
  ): Promise<{ subscriptionId: string } | null> {
    if (!this.fn) return null;
    try {
      return await this.fn(e);
    } catch (err) {
      console.error(`[quote-subscription] quote=${e.quoteId}:`, err);
      return null;
    }
  }
}
