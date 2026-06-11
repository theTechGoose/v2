import { Injectable } from "#danet/core";
import { QuoteStore } from "@paperwork/domain/data/quote-store/mod.ts";
import { CustomerStore } from "@crm/domain/data/customer-store/mod.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { EmailService } from "@communication/domain/data/email-service/mod.ts";
import { SmsService } from "@users/domain/data/sms/mod.ts";
import { type Lang, t } from "@core/i18n/mod.ts";

const APP_URL = (() => {
  const explicit = Deno.env.get("APP_URL")?.trim() || undefined;
  const isProd = Deno.env.get("APP_ENV")?.toLowerCase() === "prod" ||
    !!Deno.env.get("DENO_DEPLOYMENT_ID");
  if (isProd) return explicit ?? "https://paperworkmonster.com";
  if (explicit && /^https?:\/\/(localhost|127\.0\.0\.1)/i.test(explicit)) {
    return explicit;
  }
  return "http://localhost:5280";
})();

/**
 * SendAcceptedAlert — fires after a customer APPROVES a standalone quote
 * (POST /quotes/:id/accept). Completes the roadmap p.10 "completion Text +
 * Email" loop for the quote path; the contract path is covered by
 * SendSignedConfirmation.
 *
 * Recipient is the CONTRACTOR (the customer just clicked the button — they
 * don't need an email; the contractor needs to know the job is approved).
 * Copy renders in the contractor's UI language, not commsLanguage (which is
 * for customer-facing documents).
 *
 * Best-effort: errors are logged and swallowed — they never fail the
 * customer's accept request. The in-app bell notification (NotifyOnEvent)
 * fires independently off the same domain event.
 */
@Injectable()
export class SendAcceptedAlert {
  constructor(
    private quotes: QuoteStore,
    private customers: CustomerStore,
    private users: UserStore,
    private email: EmailService,
    private sms: SmsService,
  ) {}

  async run(quoteId: string): Promise<{ ok: boolean; reason?: string }> {
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
    const customerName = customer?.name?.trim() ||
      quote.acceptedName?.trim() ||
      t(lang, "notify.fallbackClient");
    const jobName = quote.jobName?.trim() || quote.summary?.trim() || "";
    const url = `${APP_URL}/quotes`;

    let sentAny = false;
    if (contractor.email?.trim()) {
      try {
        const res = await this.email.send({
          to: contractor.email.trim(),
          subject: jobName
            ? t(lang, "acceptedAlert.email.subjectJob", {
              name: customerName,
              job: jobName,
            })
            : t(lang, "acceptedAlert.email.subject", { name: customerName }),
          htmlBody: renderHtml({ customerName, jobName, url, lang }),
        });
        console.log(
          `[send-accepted-alert] quote ${quoteId} email → ${contractor.email}: ok=${res.ok}${
            res.reason ? ` (${res.reason})` : ""
          }`,
        );
        sentAny = sentAny || res.ok;
      } catch (err) {
        console.error("[send-accepted-alert] email failed:", err);
      }
    }
    if (contractor.phoneNumber?.trim()) {
      try {
        const body = jobName
          ? t(lang, "acceptedAlert.sms.bodyJob", {
            name: customerName,
            job: jobName,
            url,
          })
          : t(lang, "acceptedAlert.sms.body", { name: customerName, url });
        const res = await this.sms.send({
          to: contractor.phoneNumber.trim(),
          body,
        });
        console.log(
          `[send-accepted-alert] quote ${quoteId} sms → ${contractor.phoneNumber}: ok=${res.ok}${
            res.reason ? ` (${res.reason})` : ""
          }`,
        );
        sentAny = sentAny || res.ok;
      } catch (err) {
        console.error("[send-accepted-alert] sms failed:", err);
      }
    }
    return sentAny ? { ok: true } : { ok: false, reason: "no_contact" };
  }
}

function renderHtml(opts: {
  customerName: string;
  jobName: string;
  url: string;
  lang: Lang;
}): string {
  const { lang } = opts;
  const headline = opts.jobName
    ? t(lang, "acceptedAlert.email.headlineJob", {
      name: escapeHtml(opts.customerName),
      job: escapeHtml(opts.jobName),
    })
    : t(lang, "acceptedAlert.email.headline", {
      name: escapeHtml(opts.customerName),
    });
  return `<!doctype html>
<html><body style="margin:0;padding:32px 16px;background:#f7f6f1;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1c2c30">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:18px;padding:28px 32px;box-shadow:0 8px 32px rgba(20,72,82,0.08)">
    <div style="font-size:11px;font-weight:800;letter-spacing:.18em;text-transform:uppercase;color:#d94e4e">${
    escapeHtml(t(lang, "brand.name"))
  }</div>
    <div style="margin-top:18px;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-weight:900;font-size:24px;letter-spacing:-0.02em;color:#144852">${headline}</div>
    <p style="margin:14px 0 0;color:#1c2c30;font-size:15px;line-height:1.55">${
    t(lang, "acceptedAlert.email.body")
  }</p>
    <a href="${opts.url}" style="display:inline-block;margin-top:20px;background:#519843;color:#fff;font-weight:800;font-size:14px;padding:12px 22px;border-radius:12px;text-decoration:none">${
    t(lang, "acceptedAlert.email.cta")
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
