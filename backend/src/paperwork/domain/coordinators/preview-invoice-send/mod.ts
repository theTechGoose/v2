import { Injectable } from "#danet/core";
import { InvoiceStore } from "@paperwork/domain/data/invoice-store/mod.ts";
import { QuoteStore } from "@paperwork/domain/data/quote-store/mod.ts";
import { CustomerStore } from "@crm/domain/data/customer-store/mod.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { BusinessIdentityStore } from "@profile/domain/data/business-identity-store/mod.ts";
import { ShortLinkStore } from "@paperwork/domain/data/shortlink-store/mod.ts";
import {
  renderInvoiceHtml,
  renderInvoiceSubject,
} from "@paperwork/domain/coordinators/send-paperwork-email/mod.ts";
import {
  paperworkShortUrl,
  renderInvoiceBody,
} from "@paperwork/domain/coordinators/send-paperwork-sms/mod.ts";
import {
  asDelivered,
  isUnissuedInvoice,
} from "@paperwork/domain/business/publish-pending/mod.ts";
import { customerOnDocument } from "@paperwork/domain/business/doc-render/mod.ts";
import { resolveCommsLanguage } from "#quote-flow/comms-language.ts";
import { outboundSenderName } from "#quote-flow/outbound-identity.ts";
import { invoiceDocLang } from "#quote-flow/share-link.ts";
import {
  type QuoteSendPreview,
  type SendPreviewChannel,
  type SendPreviewDates,
  sendPreviewSections,
} from "#quote-flow/send-preview.ts";
import { applyRevision, isInvoiceLocked } from "#documents/versions.ts";
import type { Invoice } from "@paperwork/dto/invoice.ts";
import type { Quote } from "@paperwork/dto/quote.ts";
import type { Customer } from "@crm/dto/customer.ts";
import type { User } from "@users/dto/user.ts";
import type { BusinessIdentity } from "@users/dto/business-identity.ts";

export interface PreviewInvoiceSendInput extends SendPreviewDates {
  invoiceId: string;
  channel: SendPreviewChannel;
  /** The send sheet's "Sends in" pick; else the invoice's own language. */
  lang?: "en" | "es";
}

/**
 * REQ-727 (demo-loop cycle 5, c4-M16) — PreviewInvoiceSend: what the client
 * gets if the contractor presses the invoice send sheet's Send now. Renders
 * the invoice's email subject + body and its text with the SAME renderers
 * SendPaperworkEmail / SendPaperworkSms dispatch with, as the send will
 * publish it: issued (an unissued invoice reads "Sent", REQ-480), with the
 * dates "Finish + send" / "Send now" stamp first, and a pending edit applied.
 *
 * The language is the pick, else the invoice's own (REQ-586's
 * invoiceDocLang: its typed `lang`, else the language its quote went out
 * in), else the Settings default, else en — and it says which in `lang`.
 *
 * It does nothing else: no dispatch, no publish, no dates written, no
 * lifecycle stamp, no comms log, no language adopted as the account default.
 * The only write is the idempotent short link the send itself reuses.
 */
@Injectable()
export class PreviewInvoiceSend {
  constructor(
    private invoices: InvoiceStore,
    private quotes: QuoteStore,
    private customers: CustomerStore,
    private users: UserStore,
    private identity: BusinessIdentityStore,
    private shortlinks: ShortLinkStore,
  ) {}

  async run(
    userId: string,
    input: PreviewInvoiceSendInput,
  ): Promise<QuoteSendPreview> {
    // Ownership first: another user's invoice throws before anything renders.
    const stored = await this.invoices.getOwned(input.invoiceId, userId);
    const quote = await this.tryGetQuote(userId, stored.quoteId);
    const sender = await this.users.get(userId).catch(() => undefined) as
      | User
      | undefined;
    const rawBiz = await this.identity.get(userId).catch(() => null);
    const lang = resolveCommsLanguage({
      override: input.lang ?? invoiceDocLang(stored, quote),
      identityCommsLanguage: rawBiz?.commsLanguage,
    });
    const displayName = outboundSenderName({
      userName: sender?.name,
      businessName: rawBiz?.businessName ?? rawBiz?.legalName,
    });
    if (!displayName) return { lang, needsName: true };

    const senderBiz = {
      ...(rawBiz ?? {}),
      commsLanguage: lang,
    } as BusinessIdentity;
    const safeSender = sender ? { ...sender, name: displayName } : sender;
    const invoice = asSent(stored, userId, sender?.name, input);
    const customer = await this.tryGetCustomer(userId, invoice.customerId);
    const onDoc = customerOnDocument(invoice, customer);
    const want = sendPreviewSections(input.channel);
    const out: QuoteSendPreview = { lang };

    if (want.email) {
      const to = customer?.email ?? onDoc?.email;
      out.email = {
        ...(to ? { to } : {}),
        subject: renderInvoiceSubject(invoice, safeSender, lang, senderBiz),
        html: renderInvoiceHtml(
          invoice,
          customer,
          safeSender,
          senderBiz,
          quote,
        ),
      };
    }
    if (want.sms) {
      const to = customer?.phoneNumber ?? onDoc?.phoneNumber;
      const url = await paperworkShortUrl(this.shortlinks, userId, {
        kind: "invoice",
        id: invoice.id,
      }, lang);
      out.sms = {
        ...(to ? { to } : {}),
        body: renderInvoiceBody(invoice, customer, sender, url, lang),
      };
    }
    return out;
  }

  private async tryGetQuote(
    userId: string,
    quoteId: string | undefined,
  ): Promise<Quote | undefined> {
    if (!quoteId) return undefined;
    try {
      return await this.quotes.getOwned(quoteId, userId);
    } catch {
      return undefined;
    }
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

/** The invoice as the send would publish it, never written: the dates the
 *  send stamps first (an unissued invoice only — an issued one keeps its
 *  own), then a pending edit applied (REQ-201), then issued (REQ-480). */
function asSent(
  stored: Invoice,
  userId: string,
  name: string | undefined,
  dates: SendPreviewDates,
): Invoice {
  let inv: Invoice = stored;
  if (isUnissuedInvoice(stored)) {
    inv = {
      ...inv,
      ...(dates.issuedDate ? { issuedDate: dates.issuedDate } : {}),
      ...(dates.dueDate ? { dueDate: dates.dueDate } : {}),
    };
  }
  const pending = inv.pendingRevision;
  if (pending && Object.keys(pending).length > 0 && !isInvoiceLocked(inv)) {
    const n = name?.trim();
    inv = applyRevision(
      inv as Invoice & Record<string, unknown>,
      pending as Record<string, unknown>,
      { userId, ...(n ? { name: n } : {}) },
      new Date().toISOString(),
    ).next;
  }
  return asDelivered(inv);
}
