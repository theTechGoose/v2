import { Injectable } from "#danet/core";
import { type Lang, t } from "@core/i18n/mod.ts";
import { NotFoundError } from "@core/data/repository/mod.ts";
import {
  type QuoteInquiry,
  QuoteInquiryStore,
} from "@paperwork/domain/data/inquiry-store/mod.ts";
import { QuoteStore } from "@paperwork/domain/data/quote-store/mod.ts";
import { ReplyTokenStore } from "@paperwork/domain/data/reply-token-store/mod.ts";
import { dispatchCustomerSms } from "@paperwork/domain/business/customer-sms/mod.ts";
import {
  inboundDomain,
  replyAddress,
} from "@paperwork/domain/business/inbound-reply/mod.ts";
import { CustomerStore } from "@crm/domain/data/customer-store/mod.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { BusinessIdentityStore } from "@profile/domain/data/business-identity-store/mod.ts";
import { EmailService } from "@communication/domain/data/email-service/mod.ts";
import { SmsService } from "@users/domain/data/sms/mod.ts";
import { LogPaperworkMessage } from "@communication/domain/coordinators/log-paperwork-message/mod.ts";
import { aliasFrom } from "@communication/domain/business/sender/mod.ts";
import {
  type InquiryReplyChannel,
  inquiryReplyTargets,
} from "#quote-flow/inquiry-contact.ts";
import {
  outboundSenderFirstName,
  senderIdentityRefusal,
} from "#quote-flow/outbound-identity.ts";
import { quoteSendLang, withSendLang } from "#quote-flow/share-link.ts";
import type { SmsFailureCode } from "#quote-flow/sms-failure.ts";
import { SITE_ORIGIN } from "#quote-flow/site-meta.ts";

const APP_URL = (() => {
  const explicit = Deno.env.get("APP_URL")?.trim() || undefined;
  const isProd = Deno.env.get("APP_ENV")?.toLowerCase() === "prod" ||
    !!Deno.env.get("DENO_DEPLOYMENT_ID");
  if (isProd) return explicit ?? SITE_ORIGIN;
  if (explicit && /^https?:\/\/(localhost|127\.0\.0\.1)/i.test(explicit)) {
    return explicit;
  }
  return "http://localhost:5280";
})();

export interface ReplyToInquiryInput {
  quoteId: string;
  inquiryId: string;
  channel: InquiryReplyChannel;
  /** the contractor's answer, in their own words */
  message: string;
}

/** Why an answer did not go out: the text dispatch's own codes (REQ-226),
 *  plus no sender name (P-06) and an empty answer. The panel words each. */
export type InquiryReplyFailure = SmsFailureCode | "needsName" | "empty";

export interface ReplyToInquiryResult {
  ok: boolean;
  channel: InquiryReplyChannel;
  /** where it went (E.164 or email); "" when nothing was dialled */
  to: string;
  failureCode?: InquiryReplyFailure;
  /** the provider's or the gate's words, for logs — the UI shows its own */
  reason?: string;
  /** the question, now answered */
  inquiry?: QuoteInquiry;
}

/**
 * ReplyToInquiry — REQ-701 (demo-loop cycle 5, issue M21): the contractor
 * answers a client's question from the quote panel ("Text back" / "Email
 * back"). Pair 9: "Linda's question text is NOWHERE on that panel, no reply
 * box. How do I answer her?"
 *
 * The answer goes where the client asked to be reached (the contact-back
 * value), else to the customer's contact on file (`inquiryReplyTargets`),
 * through the services the paperwork sends use: the guarded customer text
 * (REQ-403 — a missing, invalid or fictional number never reaches the
 * provider) and EmailService from the business alias, the contractor in Cc
 * and the customer's reply-to address (REQ-175). The P-06 gate first: an
 * account with no real name or business never writes to a client.
 *
 * Delivered → logged in the customer's comms thread (no paperworkId: an
 * answer is not a quote send, so the panel's "Texted to" receipts and the
 * quote's delivery state are untouched) and the question is marked answered.
 * Not delivered → nothing is logged or marked; `failureCode` says why.
 */
@Injectable()
export class ReplyToInquiry {
  private replyTokens = new ReplyTokenStore();

  constructor(
    private inquiries: QuoteInquiryStore,
    private quotes: QuoteStore,
    private customers: CustomerStore,
    private users: UserStore,
    private identity: BusinessIdentityStore,
    private email: EmailService,
    private sms: SmsService,
    private commsLog: LogPaperworkMessage,
  ) {}

  async run(
    userId: string,
    input: ReplyToInquiryInput,
  ): Promise<ReplyToInquiryResult> {
    const { channel } = input;
    const quote = await this.quotes.getOwned(input.quoteId, userId);
    const inquiry = await this.inquiries.get(quote.id, input.inquiryId);
    if (!inquiry || inquiry.userId !== userId) {
      throw new NotFoundError("quote_inquiry", input.inquiryId);
    }
    const message = input.message.trim();
    if (!message) return { ok: false, channel, to: "", failureCode: "empty" };

    const [sender, biz, customer] = await Promise.all([
      this.users.get(userId).catch(() => undefined),
      this.identity.get(userId).catch(() => null),
      quote.customerId
        ? this.customers.getOwned(quote.customerId, userId).catch(() =>
          undefined
        )
        : Promise.resolve(undefined),
    ]);
    const business = biz?.businessName?.trim() || biz?.legalName?.trim() ||
      undefined;
    const refusal = senderIdentityRefusal({
      userName: sender?.name,
      businessName: business,
    });
    if (refusal) {
      return {
        ok: false,
        channel,
        to: "",
        failureCode: "needsName",
        reason: refusal.reason,
      };
    }
    const first = outboundSenderFirstName(sender?.name);
    const signature = first && business
      ? `${first} (${business})`
      : (first ?? business)!;
    const uiLang: Lang = sender?.language === "es" ? "es" : "en";
    // The client reads the wrapper in the language they asked in.
    const docLang: Lang = inquiry.lang ?? quoteSendLang(quote) ??
      (biz?.commsLanguage === "es" || biz?.commsLanguage === "en"
        ? biz.commsLanguage
        : uiLang);
    const targets = inquiryReplyTargets(inquiry, customer);

    if (channel === "text") {
      if (!targets.text) {
        return { ok: false, channel, to: "", failureCode: "missing" };
      }
      const body = `${message} — ${signature}`;
      const sent = await dispatchCustomerSms(this.sms, {
        to: targets.text.to,
        body,
        uiLang,
      });
      console.log(
        `[reply-to-inquiry] quote ${quote.id} inquiry ${inquiry.id} text → ${sent.to}: ok=${sent.ok}${
          sent.reason ? ` (${sent.reason})` : ""
        }`,
      );
      if (!sent.ok) {
        return {
          ok: false,
          channel,
          to: sent.to,
          failureCode: sent.failureCode ?? "other",
          ...(sent.reason ? { reason: sent.reason } : {}),
        };
      }
      await this.commsLog.run({
        userId,
        customerId: quote.customerId,
        channel: "text",
        content: body,
        toAddress: sent.to,
      });
      const answered = await this.inquiries.markAnswered(
        quote.id,
        inquiry.id,
        { channel, to: sent.to, message },
      );
      return { ok: true, channel, to: sent.to, inquiry: answered };
    }

    if (!targets.email) {
      return { ok: false, channel, to: "", failureCode: "missing" };
    }
    const to = targets.email.to;
    const job = (quote.jobNameByLang?.[docLang] ?? quote.jobName)?.trim() ||
      (quote.summaryByLang?.[docLang] ?? quote.summary)?.trim() || "";
    const subject = job
      ? t(docLang, "inquiryReply.email.subject", { job })
      : t(docLang, "inquiryReply.email.subjectNoJob");
    const htmlBody = renderReplyHtml({
      lang: docLang,
      brand: business ?? signature,
      who: signature,
      replyName: first ?? business ?? signature,
      message,
      question: inquiry.question,
      url: withSendLang(`${APP_URL}/q/${quote.id}`, docLang),
    });
    const replyTo = quote.customerId
      ? replyAddress(
        await this.replyTokens.forCustomer(userId, quote.customerId),
        inboundDomain(),
      )
      : undefined;
    const sent = await this.email.send({
      to,
      subject,
      htmlBody,
      from: aliasFrom(biz?.emailAlias),
      ...(sender?.email?.trim() ? { cc: [sender.email.trim()] } : {}),
      ...(replyTo ? { replyTo } : {}),
    });
    console.log(
      `[reply-to-inquiry] quote ${quote.id} inquiry ${inquiry.id} email → ${to}: ok=${sent.ok}${
        sent.reason ? ` (${sent.reason})` : ""
      }`,
    );
    if (!sent.ok) {
      return {
        ok: false,
        channel,
        to,
        failureCode: "other",
        ...(sent.reason ? { reason: sent.reason } : {}),
      };
    }
    await this.commsLog.run({
      userId,
      customerId: quote.customerId,
      channel: "email",
      content: message,
      subject,
      htmlBody,
      toAddress: to,
    });
    const answered = await this.inquiries.markAnswered(quote.id, inquiry.id, {
      channel,
      to,
      message,
    });
    return { ok: true, channel, to, inquiry: answered };
  }
}

interface ReplyHtml {
  lang: Lang;
  /** the eyebrow: the business */
  brand: string;
  /** "Rosa (Junk Monsters)" */
  who: string;
  /** "Rosa" — who a reply to the email reaches */
  replyName: string;
  message: string;
  question: string;
  url: string;
}

function renderReplyHtml(o: ReplyHtml): string {
  const { lang } = o;
  return `<!doctype html>
<html><body style="margin:0;padding:32px 16px;background:#f7f6f1;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1c2c30">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:18px;padding:28px 32px;box-shadow:0 8px 32px rgba(20,72,82,0.08)">
    <div style="font-size:11px;font-weight:800;letter-spacing:.18em;text-transform:uppercase;color:#d94e4e">${
    escapeHtml(o.brand)
  }</div>
    <div style="margin-top:18px;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-weight:900;font-size:22px;letter-spacing:-0.02em;color:#144852">${
    escapeHtml(t(lang, "inquiryReply.email.headline", { who: o.who }))
  }</div>
    <p style="margin:16px 0 0;color:#1c2c30;font-size:16px;line-height:1.55;white-space:pre-wrap">${
    escapeHtml(o.message)
  }</p>
    <div style="margin-top:20px;font-size:11px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:#6b7a7e">${
    escapeHtml(t(lang, "inquiryReply.email.yourQuestion"))
  }</div>
    <blockquote style="margin:8px 0 0;padding:12px 16px;border-left:4px solid #519843;background:#f4f8f2;border-radius:8px;color:#1c2c30;font-size:14px;line-height:1.5;white-space:pre-wrap">${
    escapeHtml(o.question)
  }</blockquote>
    <a href="${o.url}" style="display:inline-block;margin-top:20px;background:#519843;color:#fff;font-weight:800;font-size:14px;padding:12px 22px;border-radius:12px;text-decoration:none">${
    escapeHtml(t(lang, "inquiryReply.email.cta"))
  }</a>
    <p style="margin:16px 0 0;color:#6b7a7e;font-size:13px;line-height:1.5">${
    escapeHtml(t(lang, "inquiryReply.email.replyHint", { who: o.replyName }))
  }</p>
  </div>
</body></html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => {
    switch (c) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });
}
