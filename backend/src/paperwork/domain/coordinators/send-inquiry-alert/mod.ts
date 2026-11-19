import { Injectable } from "#danet/core";
import { QuoteStore } from "@paperwork/domain/data/quote-store/mod.ts";
import { CustomerStore } from "@crm/domain/data/customer-store/mod.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { EmailService } from "@communication/domain/data/email-service/mod.ts";
import { SmsService } from "@users/domain/data/sms/mod.ts";
import { LogPaperworkMessage } from "@communication/domain/coordinators/log-paperwork-message/mod.ts";
import { type Lang, t } from "@core/i18n/mod.ts";
import { emailRoot } from "@paperwork/domain/business/email-root/mod.ts"; // REQ-1033
import { SITE_ORIGIN } from "#quote-flow/site-meta.ts";
import {
  type InquiryReplyTargets,
  inquiryReplyTargets,
} from "#quote-flow/inquiry-contact.ts";
import { formatPhoneDisplay } from "#quote-flow/format-helpers.ts";

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

export interface InquiryAlertInput {
  /** The customer's question, verbatim. */
  question: string;
  /** How the customer asked to be reached back (phone or email) — free text. */
  contactBack?: string;
  /** The name the customer typed on the public form. */
  name?: string;
}

/**
 * SendInquiryAlert — REQ-031 (NW-26): fires when a customer uses "Ask a
 * question" on the public quote link (POST /quotes/:id/inquiry).
 *
 * "I filled in the 'Ask a question' box … but I never received the
 * question. Where does it go?" — it went into one notification row no UI
 * showed in full, and the "contact me back" value was dropped. Modelled on
 * SendAcceptedAlert: the CONTRACTOR gets the full question and the
 * contact-back value by email AND text, in their UI language, both logged
 * in the comms trail.
 *
 * Best-effort: errors are logged and swallowed — they never fail the
 * customer's request. The in-app feed notification (NotifyOnEvent) fires
 * independently off the same domain event.
 */
@Injectable()
export class SendInquiryAlert {
  constructor(
    private quotes: QuoteStore,
    private customers: CustomerStore,
    private users: UserStore,
    private email: EmailService,
    private sms: SmsService,
    private commsLog: LogPaperworkMessage,
  ) {}

  async run(
    quoteId: string,
    input: InquiryAlertInput,
  ): Promise<{ ok: boolean; reason?: string }> {
    const question = input.question.trim();
    if (!question) return { ok: false, reason: "no_question" };
    const quote = await this.quotes.get(quoteId);
    const [contractor, customer] = await Promise.all([
      this.users.get(quote.userId).catch(() => undefined),
      quote.customerId
        ? this.customers.getOwned(quote.customerId, quote.userId).catch(() =>
          undefined
        )
        : Promise.resolve(undefined),
    ]);
    if (!contractor) return { ok: false, reason: "no_contractor" };

    const lang: Lang = contractor.language === "es" ? "es" : "en";
    const name = input.name?.trim() || customer?.name?.trim() ||
      t(lang, "notify.fallbackClient");
    const jobName = (quote.jobNameByLang?.[lang] ?? quote.jobName)?.trim() ||
      quote.summary?.trim() || "";
    const contactBack = input.contactBack?.trim() || undefined;
    // REQ-947 (LOOP-007 q1-23): the panel's rule (REQ-701) — the phone or
    // email the customer typed wins, the customer's contact on file fills in
    // the rest — so the alert always carries a way to reach them, even when
    // "how should we reach you" was left empty.
    const reach = inquiryReplyTargets({ contactBack }, customer);
    // REQ-701 (demo-loop cycle 5, M21): straight to the quote's questions —
    // the panel lists this one there, with Text back / Email back / Call.
    const url = `${APP_URL}/quotes?open=${
      encodeURIComponent(quote.id)
    }#questions`;
    const subject = jobName
      ? t(lang, "inquiryAlert.email.subject", { name, job: jobName })
      : t(lang, "inquiryAlert.email.subjectNoJob", { name });
    const trail = `quote ${quoteId} inquiry from ${name}: "${question}"${
      contactBack ? ` (contact: ${contactBack})` : ""
    }`;

    let sentAny = false;
    if (contractor.email?.trim()) {
      try {
        const res = await this.email.send({
          to: contractor.email.trim(),
          subject,
          htmlBody: renderHtml({
            name,
            jobName,
            question,
            contactBack,
            reach,
            url,
            lang,
          }),
          // REQ-947: pressing Reply in the mail client writes to the
          // customer, not to the house From address.
          ...(reach.email ? { replyTo: reach.email.to } : {}),
        });
        console.log(
          `[send-inquiry-alert] quote ${quoteId} email → ${contractor.email}: ok=${res.ok}${
            res.reason ? ` (${res.reason})` : ""
          }`,
        );
        if (res.ok) {
          // Self-notification to the contractor: no paperworkId tag (P-32),
          // the content carries the quote id + the question for the trail.
          await this.commsLog.run({
            userId: quote.userId,
            customerId: quote.customerId,
            channel: "email",
            content: `${trail} — emailed to ${contractor.email.trim()}`,
            subject,
            toAddress: contractor.email.trim(),
          });
        }
        sentAny = sentAny || res.ok;
      } catch (err) {
        console.error("[send-inquiry-alert] email failed:", err);
      }
    }
    if (contractor.phoneNumber?.trim()) {
      try {
        const body = renderSms({
          name,
          jobName,
          question,
          contactBack,
          reach,
          url,
          lang,
        });
        const res = await this.sms.send({
          to: contractor.phoneNumber.trim(),
          body,
        });
        console.log(
          `[send-inquiry-alert] quote ${quoteId} sms → ${contractor.phoneNumber}: ok=${res.ok}${
            res.reason ? ` (${res.reason})` : ""
          }`,
        );
        if (res.ok) {
          await this.commsLog.run({
            userId: quote.userId,
            customerId: quote.customerId,
            channel: "text",
            content: `${trail} — texted: ${body}`,
            toAddress: contractor.phoneNumber.trim(),
          });
        }
        sentAny = sentAny || res.ok;
      } catch (err) {
        console.error("[send-inquiry-alert] sms failed:", err);
      }
    }
    return sentAny ? { ok: true } : { ok: false, reason: "no_contact" };
  }
}

interface CopyOpts {
  name: string;
  jobName: string;
  question: string;
  contactBack?: string;
  /** REQ-947: where the customer can be reached (typed wins, file fills in) */
  reach: InquiryReplyTargets;
  url: string;
  lang: Lang;
}

function renderSms(o: CopyOpts): string {
  const lead = o.jobName
    ? t(o.lang, "inquiryAlert.sms.body", {
      name: o.name,
      job: o.jobName,
      question: o.question,
    })
    : t(o.lang, "inquiryAlert.sms.bodyNoJob", {
      name: o.name,
      question: o.question,
    });
  const contact = o.contactBack
    ? ` ${t(o.lang, "inquiryAlert.contactBack", { contact: o.contactBack })}`
    : "";
  // REQ-947: the channels the customer did not type come from the file, so
  // the text always names a way to reach them.
  const fill = [
    o.reach.text && !o.reach.text.fromContactBack
      ? formatPhoneDisplay(o.reach.text.to)
      : undefined,
    o.reach.email && !o.reach.email.fromContactBack
      ? o.reach.email.to
      : undefined,
  ].filter((v): v is string => !!v);
  const reach = fill.length
    ? ` ${t(o.lang, "inquiryAlert.reach", { contact: fill.join(" · ") })}`
    : "";
  return `${lead}${contact}${reach} → ${o.url}`;
}

function renderHtml(o: CopyOpts): string {
  const { lang } = o;
  const headline = o.jobName
    ? t(lang, "inquiryAlert.email.headline", {
      name: escapeHtml(o.name),
      job: escapeHtml(o.jobName),
    })
    : t(lang, "inquiryAlert.email.headlineNoJob", {
      name: escapeHtml(o.name),
    });
  const contact = o.contactBack
    ? `<p style="margin:14px 0 0;color:#1c2c30;font-size:15px;line-height:1.55"><strong>${
      escapeHtml(
        t(lang, "inquiryAlert.contactBack", { contact: o.contactBack }),
      )
    }</strong></p>`
    : "";
  // REQ-947: tap-to-call / tap-to-email for every channel we can reach them on
  const links = [
    o.reach.text
      ? `<a href="${o.reach.call}" style="color:#144852">${
        escapeHtml(formatPhoneDisplay(o.reach.text.to))
      }</a>`
      : undefined,
    o.reach.email
      ? `<a href="mailto:${
        escapeHtml(o.reach.email.to)
      }" style="color:#144852">${escapeHtml(o.reach.email.to)}</a>`
      : undefined,
  ].filter((v): v is string => !!v);
  const reach = links.length
    ? `<p style="margin:14px 0 0;color:#1c2c30;font-size:15px;line-height:1.55">${
      t(lang, "inquiryAlert.reach", { contact: links.join(" · ") })
    }</p>`
    : "";
  return `${emailRoot(lang)}<body style="margin:0;padding:32px 16px;background:#f7f6f1;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1c2c30">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:18px;padding:28px 32px;box-shadow:0 8px 32px rgba(20,72,82,0.08)">
    <div style="font-size:11px;font-weight:800;letter-spacing:.18em;text-transform:uppercase;color:#d94e4e">${
    escapeHtml(t(lang, "brand.name"))
  }</div>
    <div style="margin-top:18px;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-weight:900;font-size:24px;letter-spacing:-0.02em;color:#144852">${headline}</div>
    <blockquote style="margin:16px 0 0;padding:14px 18px;border-left:4px solid #519843;background:#f4f8f2;border-radius:8px;color:#1c2c30;font-size:16px;line-height:1.55;white-space:pre-wrap">${
    escapeHtml(o.question)
  }</blockquote>
    ${contact}
    ${reach}
    <p style="margin:14px 0 0;color:#1c2c30;font-size:15px;line-height:1.55">${
    escapeHtml(t(lang, "inquiryAlert.email.body"))
  }</p>
    <a href="${o.url}" style="display:inline-block;margin-top:20px;background:#519843;color:#fff;font-weight:800;font-size:14px;padding:12px 22px;border-radius:12px;text-decoration:none">${
    escapeHtml(t(lang, "inquiryAlert.email.cta"))
  }</a>
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
