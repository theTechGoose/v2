import { Injectable } from "#danet/core";
import { InvoiceStore } from "@paperwork/domain/data/invoice-store/mod.ts";
import { CustomerStore } from "@crm/domain/data/customer-store/mod.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { BusinessIdentityStore } from "@profile/domain/data/business-identity-store/mod.ts";
import { EmailService } from "@communication/domain/data/email-service/mod.ts";
import { SmsService } from "@users/domain/data/sms/mod.ts";
import { businessFrom } from "@communication/domain/business/sender/mod.ts";
import {
  emailLogo,
  emailLogoHtml,
} from "@paperwork/domain/business/email-logo/mod.ts";
import { ShortLinkStore } from "@paperwork/domain/data/shortlink-store/mod.ts";
import { t } from "@core/i18n/mod.ts";
import { emailRoot } from "@paperwork/domain/business/email-root/mod.ts";
import type { Invoice } from "@paperwork/dto/invoice.ts";
import { SITE_ORIGIN } from "#quote-flow/site-meta.ts";
import {
  customerOnDocument,
  docRef,
  docTitle,
} from "@paperwork/domain/business/doc-render/mod.ts";
import { resolveCommsLanguage } from "#quote-flow/comms-language.ts";
import { withSendLang } from "#quote-flow/share-link.ts";
import { LogPaperworkMessage } from "@communication/domain/coordinators/log-paperwork-message/mod.ts";
import { customerLabel } from "@communication/domain/business/outbox-entry/mod.ts";
import { ConversationStore } from "@communication/domain/data/conversation-store/mod.ts";
import { MessageStore } from "@communication/domain/data/message-store/mod.ts";
import { OutboxStore } from "@communication/domain/data/outbox-store/mod.ts";
import {
  type VoidNoticeChannel,
  voidNoticeChannels,
  wasSent,
} from "#documents/void-notice.ts";

/** What the void's "Let <customer> know" did — returned with the void. */
export interface VoidNoticeResult {
  /** the channels the provider took the notice on */
  channels: VoidNoticeChannel[];
  /** why nothing reached her, when nothing did */
  reason?: "never_sent" | "no_recipient" | "not_delivered";
}

/**
 * SendInvoiceCancelled — REQ-1135 (LOOP-007 cycle 3, q3-60), AMENDMENT of
 * REQ-627. After an invoice is voided, tell the customer it is cancelled and
 * nothing is due, with her /i link (which says so). Branded like every
 * customer message (REQ-628: the business's From name and logo), in the
 * language the invoice went out in, on the channels it went out on, and
 * recorded in the outbox (REQ-784). Never the void reason or who voided it —
 * REQ-627's decision for the customer's side.
 *
 * Best-effort: it never throws, so a failed send can never undo the void.
 */
@Injectable()
export class SendInvoiceCancelled {
  constructor(
    private invoices: InvoiceStore,
    private customers: CustomerStore,
    private users: UserStore,
    private identity: BusinessIdentityStore,
    private email: EmailService,
    private sms: SmsService,
    private shortlinks: ShortLinkStore,
    private commsLog: LogPaperworkMessage = new LogPaperworkMessage(
      new ConversationStore(),
      new MessageStore(),
    ),
  ) {}

  /** what already reached her about the invoice (REQ-784's outbox) */
  private outboxStore = new OutboxStore();

  async run(
    userId: string,
    invoiceId: string,
    opts: { corrected?: boolean } = {},
  ): Promise<VoidNoticeResult> {
    try {
      return await this.send(userId, invoiceId, opts);
    } catch (err) {
      console.error(
        `[send-invoice-cancelled] invoice=${invoiceId} failed:`,
        err,
      );
      return { channels: [], reason: "not_delivered" };
    }
  }

  private async send(
    userId: string,
    invoiceId: string,
    opts: { corrected?: boolean },
  ): Promise<VoidNoticeResult> {
    const invoice = await this.invoices.getOwned(invoiceId, userId);
    if (!wasSent(invoice)) return { channels: [], reason: "never_sent" };

    const [customer, sender, biz, history] = await Promise.all([
      invoice.customerId
        ? this.customers.getOwned(invoice.customerId, userId).catch(() =>
          undefined
        )
        : Promise.resolve(undefined),
      this.users.get(userId).catch(() => undefined),
      this.identity.get(userId).catch(() => null),
      this.outboxStore.listByUser(userId, { limit: 1000 }).catch(() => []),
    ]);
    // what reached her about this invoice, newest first
    const went = history.filter((r) =>
      r.docId === invoice.id && r.status === "sent" &&
      r.kind !== "invoiceCancelled"
    );
    const shown = customerOnDocument(invoice, customer);
    const toEmail = customer?.email || shown?.email || undefined;
    const toPhone = customer?.phoneNumber || shown?.phoneNumber || undefined;
    const channels = voidNoticeChannels(
      [...new Set(went.map((r) => r.channel))],
      { email: toEmail, phone: toPhone },
    );
    if (channels.length === 0) return { channels: [], reason: "no_recipient" };

    // the language the invoice went out in, else the usual resolution
    const lang: "en" | "es" = went[0]?.language ?? resolveCommsLanguage({
      customerLanguage: customer?.language,
      identityCommsLanguage: biz?.commsLanguage,
      sendLanguages: biz?.commsLanguages,
    });
    // REQ-628: under the business's name, never DocuMonster
    const businessName = biz?.businessName?.trim() || biz?.legalName?.trim() ||
      sender?.name?.trim() || t(lang, "paymentReminder.senderFallback");
    const appUrl = Deno.env.get("APP_URL") ?? SITE_ORIGIN;
    const logoHtml = emailLogoHtml(
      emailLogo({
        appUrl,
        kind: "invoice",
        id: invoice.id,
        biz,
        fallbackName: businessName,
      }),
    );
    const copy = composeCancelledCopy({
      lang,
      businessName,
      invoice,
      customerFirst: (shown?.name ?? shown?.businessName)?.trim().split(
        /\s+/,
      )[0],
      corrected: !!opts.corrected,
      logoHtml,
    });
    let url = "";
    try {
      const link = await this.shortlinks.findOrCreate(
        userId,
        "invoice",
        invoice.id,
      );
      url = withSendLang(`${appUrl}/s/${link.code}`, lang);
    } catch { /* the message still says it */ }

    const toOutbox = (
      channel: VoidNoticeChannel,
      ok: boolean,
      what: {
        to: string;
        subject?: string;
        body?: string;
        reasonCode?: string;
        reason?: string;
      },
    ) =>
      this.commsLog.outbox({
        userId,
        channel,
        kind: "invoiceCancelled",
        language: lang,
        ok,
        customerId: invoice.customerId,
        customerName: customerLabel(shown),
        docId: invoice.id,
        docRef: docRef(invoice),
        ...what,
      });

    const delivered: VoidNoticeChannel[] = [];
    if (channels.includes("email") && toEmail) {
      const html = copy.emailHtml(url);
      try {
        const res = await this.email.send({
          to: toEmail,
          subject: copy.emailSubject,
          htmlBody: html,
          from: businessFrom({ alias: biz?.emailAlias, name: businessName }),
          ...(sender?.email ? { cc: [sender.email] } : {}),
        });
        if (res.ok) delivered.push("email");
        await toOutbox("email", res.ok, {
          to: toEmail,
          subject: copy.emailSubject,
          body: html,
          ...(res.ok ? {} : { reason: res.reason }),
        });
      } catch (err) {
        await toOutbox("email", false, {
          to: toEmail,
          subject: copy.emailSubject,
          reason: (err as Error)?.message ?? String(err),
        });
      }
    }
    if (channels.includes("text") && toPhone) {
      const body = copy.smsBody(url);
      try {
        const res = await this.sms.send({ to: toPhone, body });
        if (res.ok) delivered.push("text");
        await toOutbox("text", res.ok, {
          to: toPhone,
          body,
          ...(res.ok
            ? {}
            : { reasonCode: res.failureCode, reason: res.reason }),
        });
      } catch (err) {
        await toOutbox("text", false, {
          to: toPhone,
          reason: (err as Error)?.message ?? String(err),
        });
      }
    }
    return delivered.length > 0
      ? { channels: delivered }
      : { channels: [], reason: "not_delivered" };
  }
}

/** REQ-1135: the cancellation notice's words. Pure — unit tested. Takes no
 *  void reason and no voider, so it cannot leak either (REQ-627). */
export function composeCancelledCopy(opts: {
  lang?: "en" | "es";
  businessName: string;
  invoice: Pick<Invoice, "id" | "number"> & Partial<Invoice>;
  customerFirst?: string;
  /** "Void & duplicate": a corrected invoice follows */
  corrected?: boolean;
  logoHtml?: string;
}): {
  emailSubject: string;
  emailHtml: (url: string) => string;
  smsBody: (url: string) => string;
} {
  const lang = opts.lang === "es" ? "es" : "en";
  const { businessName, invoice } = opts;
  const ref = docRef(invoice);
  const lead = t(lang, "invoiceCancelled.lead", { businessName, ref });
  const follow = opts.corrected
    ? ` ${t(lang, "invoiceCancelled.corrected")}`
    : "";
  const hi = opts.customerFirst
    ? t(lang, "invoiceCancelled.greeting", { name: opts.customerFirst })
    : "";
  return {
    emailSubject: t(lang, "invoiceCancelled.subject", { businessName, ref }),
    emailHtml: (url: string) =>
      `${
        emailRoot(lang)
      }<body style="margin:0;padding:32px 16px;background:#f7f6f1;font-family:-apple-system,sans-serif;color:#1c2c30">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:18px;padding:28px 32px">
    ${
        opts.logoHtml
          ? `<div style="margin:0 0 16px">${opts.logoHtml}</div>`
          : ""
      }
    <div data-doc-ref style="margin:0 0 12px;font-size:12px;font-weight:800;color:#6b7a7e">${
        docTitle("invoice", invoice, lang)
      }</div>
    ${
        hi
          ? `<p style="margin:0 0 10px;font-size:15px;line-height:1.55">${hi}</p>`
          : ""
      }
    <p data-cancelled style="margin:0;font-size:15px;line-height:1.55"><strong>${lead}</strong>${follow}</p>
    ${
        url
          ? `<p style="margin:18px 0 0"><a href="${url}" style="display:inline-block;background:#fff;border:1px solid #d8dcd5;color:#144852;text-decoration:none;font-weight:700;padding:12px 18px;border-radius:10px">${
            t(lang, "invoiceCancelled.cta")
          }</a></p>`
          : ""
      }
    <p style="margin:18px 0 0;font-size:13px;color:#6b7a7e">${businessName}</p>
  </div>
</body></html>`,
    smsBody: (url: string) => `${lead}${follow}${url ? ` ${url}` : ""}`,
  };
}
