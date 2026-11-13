import { Injectable } from "#danet/core";
import { QuoteStore } from "@paperwork/domain/data/quote-store/mod.ts";
import { CustomerStore } from "@crm/domain/data/customer-store/mod.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { BusinessIdentityStore } from "@profile/domain/data/business-identity-store/mod.ts";
import { ShortLinkStore } from "@paperwork/domain/data/shortlink-store/mod.ts";
import {
  quoteSendTexts,
  renderQuoteHtml,
  renderQuoteSubject,
} from "@paperwork/domain/coordinators/send-paperwork-email/mod.ts";
import {
  paperworkShortUrl,
  renderQuoteBody,
} from "@paperwork/domain/coordinators/send-paperwork-sms/mod.ts";
import { customerOnDocument } from "@paperwork/domain/business/doc-render/mod.ts";
import { resolveCommsLanguage } from "#quote-flow/comms-language.ts";
import { outboundSenderName } from "#quote-flow/outbound-identity.ts";
import {
  type QuoteSendPreview,
  type SendPreviewChannel,
  sendPreviewSections,
} from "#quote-flow/send-preview.ts";
import { applyRevision, isQuoteLocked } from "#documents/versions.ts";
import { QuoteTranslatorPort } from "@paperwork/domain/coordinators/quote-translator-port/mod.ts";
import {
  missingHeadingTranslations,
  missingQuoteTranslations,
} from "#quote-flow/quote-translations.ts";
import type { Quote } from "@paperwork/dto/quote.ts";
import type { Customer } from "@crm/dto/customer.ts";
import type { User } from "@users/dto/user.ts";
import type { BusinessIdentity } from "@users/dto/business-identity.ts";

export interface PreviewQuoteSendInput {
  quoteId: string;
  channel: SendPreviewChannel;
  /** The send dialog's "Sends in" pick; else the Settings default, else en. */
  lang?: "en" | "es";
}

/**
 * REQ-461 (demo-loop cycle 3, m8) — PreviewQuoteSend: what the client gets
 * if the contractor presses Send now. Renders the quote's email subject +
 * body and its text with the SAME renderers SendPaperworkEmail /
 * SendPaperworkSms dispatch with, in the picked language — and does nothing
 * else: no dispatch, no publish (a pending edit is applied in memory, as the
 * send would publish it), no lifecycle stamp, no comms log, no language
 * adopted as the account default. The only write is the idempotent short
 * link the send itself reuses.
 */
@Injectable()
export class PreviewQuoteSend {
  constructor(
    private quotes: QuoteStore,
    private customers: CustomerStore,
    private users: UserStore,
    private identity: BusinessIdentityStore,
    private shortlinks: ShortLinkStore,
    private translator?: QuoteTranslatorPort,
  ) {}

  async run(
    userId: string,
    input: PreviewQuoteSendInput,
  ): Promise<QuoteSendPreview> {
    // Ownership first: another user's quote throws before anything renders.
    let stored = await this.quotes.getOwned(input.quoteId, userId);
    const sender = await this.users.get(userId).catch(() => undefined) as
      | User
      | undefined;
    const rawBiz = await this.identity.get(userId).catch(() => null);
    const lang = resolveCommsLanguage({
      override: input.lang,
      identityCommsLanguage: rawBiz?.commsLanguage,
    });
    const displayName = outboundSenderName({
      userName: sender?.name,
      businessName: rawBiz?.businessName ?? rawBiz?.legalName,
    });
    if (!displayName) return { lang, needsName: true };

    // REQ-591 (cycle 4, M32): a language with no cached heading or text yet
    // is translated first, as lock and send do — else the English preview of
    // a Spanish quote renders the Spanish summary as its hero.
    if (
      this.translator &&
      (missingHeadingTranslations(stored, [lang]).length > 0 ||
        missingQuoteTranslations(stored, [lang]).length > 0)
    ) {
      await this.translator.run({
        userId,
        quoteId: stored.id,
        langs: [lang],
      });
      stored = await this.quotes.getOwned(input.quoteId, userId);
    }

    const senderBiz = {
      ...(rawBiz ?? {}),
      commsLanguage: lang,
    } as BusinessIdentity;
    const safeSender = sender ? { ...sender, name: displayName } : sender;
    const quote = asSent(stored, userId, sender?.name);
    const customer = await this.tryGetCustomer(userId, quote.customerId);
    const onDoc = customerOnDocument(quote, customer);
    const want = sendPreviewSections(input.channel);
    const out: QuoteSendPreview = { lang };

    if (want.email) {
      const to = customer?.email ?? onDoc?.email;
      out.email = {
        ...(to ? { to } : {}),
        subject: renderQuoteSubject(quote, safeSender, senderBiz, customer),
        // REQ-682: the same steps the send renders for this channel
        html: renderQuoteHtml(quote, customer, safeSender, senderBiz, {
          textable: quoteSendTexts(input.channel, customer, quote),
        }),
      };
    }
    if (want.sms) {
      const to = customer?.phoneNumber ?? onDoc?.phoneNumber;
      const url = await paperworkShortUrl(this.shortlinks, userId, {
        kind: "quote",
        id: quote.id,
      }, lang);
      out.sms = {
        ...(to ? { to } : {}),
        body: renderQuoteBody(quote, customer, sender, senderBiz, url),
      };
    }
    return out;
  }

  private async tryGetCustomer(
    userId: string,
    customerId: string | undefined,
  ): Promise<Customer | undefined> {
    if (!customerId) return undefined;
    try {
      return await this.customers.getOwned(customerId, userId);
    } catch {
      return undefined;
    }
  }
}

/** The quote as the send would publish it (REQ-201): a pending edit applied
 *  in memory, never written. */
function asSent(quote: Quote, userId: string, name?: string): Quote {
  const pending = quote.pendingRevision;
  if (!pending || Object.keys(pending).length === 0 || isQuoteLocked(quote)) {
    return quote;
  }
  const n = name?.trim();
  return applyRevision(
    quote as Quote & Record<string, unknown>,
    pending as Record<string, unknown>,
    { userId, ...(n ? { name: n } : {}) },
    new Date().toISOString(),
  ).next;
}
