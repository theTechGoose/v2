import { Injectable } from "#danet/core";
import { ChangeOrderStore } from "@paperwork/domain/data/change-order-store/mod.ts";
import { CustomerStore } from "@crm/domain/data/customer-store/mod.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { BusinessIdentityStore } from "@profile/domain/data/business-identity-store/mod.ts";
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

/** Format a signed cents delta for human copy ("+$120.00" / "−$50.00"). */
function fmtDelta(cents: number): string {
  const sign = cents < 0 ? "−" : "+";
  const abs = Math.abs(cents) / 100;
  return `${sign}$${
    abs.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  }`;
}

/**
 * SendChangeOrderAlert — fires when a contractor CREATES or EDITS a change
 * order (roadmap p.12 + change-order editability). Editing re-opens approval
 * (status → pending), so approval is (re-)triggered to BOTH parties:
 *
 *   • the CUSTOMER gets an approval-request email + SMS with the public /co
 *     link, in the contractor's outgoing-comms language (customer-facing);
 *   • the CONTRACTOR gets an email + SMS heads-up (their UI language) with the
 *     same link as a backup to share, mirroring SendAcceptedAlert.
 *
 * Best-effort: every send is independently try/caught so a missing address
 * never fails the create/edit request.
 */
@Injectable()
export class SendChangeOrderAlert {
  constructor(
    private changeOrders: ChangeOrderStore,
    private customers: CustomerStore,
    private users: UserStore,
    private identity: BusinessIdentityStore,
    private email: EmailService,
    private sms: SmsService,
  ) {}

  async run(changeOrderId: string): Promise<{ ok: boolean; reason?: string }> {
    const co = await this.changeOrders.get(changeOrderId);
    const [contractor, customer, ident] = await Promise.all([
      this.users.get(co.userId).catch(() => undefined),
      co.customerId
        ? this.customers.getOwned(co.customerId, co.userId).catch(() =>
          undefined
        )
        : Promise.resolve(undefined),
      this.identity.get(co.userId).catch(() => null),
    ]);
    if (!contractor) return { ok: false, reason: "no_contractor" };

    // Contractor copy = their UI language; customer copy = outgoing-comms
    // language (roadmap p.13), like every other customer-facing document.
    const cxLang: Lang = contractor.language === "es" ? "es" : "en";
    const coLang: Lang = ident?.commsLanguage === "es" ? "es" : "en";
    const businessName = ident?.businessName?.trim() ||
      (ident as { legalName?: string } | null)?.legalName?.trim() ||
      contractor.name?.trim() || t(coLang, "brand.name");
    const customerName = customer?.name?.trim() ||
      t(cxLang, "notify.fallbackClient");
    const delta = fmtDelta(co.deltaAmountCents);
    const url = `${APP_URL}/co/${co.id}`;

    let sentAny = false;

    // ── Customer: the actual approval request ───────────────────────────
    if (customer?.email?.trim()) {
      try {
        const res = await this.email.send({
          to: customer.email.trim(),
          subject: t(coLang, "changeOrderRequest.email.subject", {
            business: businessName,
          }),
          htmlBody: renderCustomerHtml({
            businessName,
            delta,
            description: co.description,
            url,
            lang: coLang,
          }),
        });
        console.log(
          `[send-change-order-alert] co ${co.id} customer-email → ${customer.email}: ok=${res.ok}${
            res.reason ? ` (${res.reason})` : ""
          }`,
        );
        sentAny = sentAny || res.ok;
      } catch (err) {
        console.error("[send-change-order-alert] customer email failed:", err);
      }
    }
    if (customer?.phoneNumber?.trim()) {
      try {
        const res = await this.sms.send({
          to: customer.phoneNumber.trim(),
          body: t(coLang, "changeOrderRequest.sms.body", {
            business: businessName,
            delta,
            url,
          }),
        });
        console.log(
          `[send-change-order-alert] co ${co.id} customer-sms → ${customer.phoneNumber}: ok=${res.ok}${
            res.reason ? ` (${res.reason})` : ""
          }`,
        );
        sentAny = sentAny || res.ok;
      } catch (err) {
        console.error("[send-change-order-alert] customer sms failed:", err);
      }
    }

    // ── Contractor: heads-up + the link as a backup to share ────────────
    if (contractor.email?.trim()) {
      try {
        const res = await this.email.send({
          to: contractor.email.trim(),
          subject: t(cxLang, "changeOrderAlert.email.subject", {
            name: customerName,
            delta,
          }),
          htmlBody: renderContractorHtml({
            customerName,
            delta,
            description: co.description,
            url,
            lang: cxLang,
          }),
        });
        console.log(
          `[send-change-order-alert] co ${co.id} email → ${contractor.email}: ok=${res.ok}${
            res.reason ? ` (${res.reason})` : ""
          }`,
        );
        sentAny = sentAny || res.ok;
      } catch (err) {
        console.error("[send-change-order-alert] email failed:", err);
      }
    }
    if (contractor.phoneNumber?.trim()) {
      try {
        const res = await this.sms.send({
          to: contractor.phoneNumber.trim(),
          body: t(cxLang, "changeOrderAlert.sms.body", {
            name: customerName,
            delta,
            url,
          }),
        });
        console.log(
          `[send-change-order-alert] co ${co.id} sms → ${contractor.phoneNumber}: ok=${res.ok}${
            res.reason ? ` (${res.reason})` : ""
          }`,
        );
        sentAny = sentAny || res.ok;
      } catch (err) {
        console.error("[send-change-order-alert] sms failed:", err);
      }
    }

    return sentAny ? { ok: true } : { ok: false, reason: "no_contact" };
  }
}

/** Customer-facing approval request (commsLanguage). */
function renderCustomerHtml(opts: {
  businessName: string;
  delta: string;
  description: string;
  url: string;
  lang: Lang;
}): string {
  const { lang } = opts;
  const headline = t(lang, "changeOrderRequest.email.headline", {
    business: escapeHtml(opts.businessName),
  });
  return `<!doctype html>
<html><body style="margin:0;padding:32px 16px;background:#f7f6f1;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1c2c30">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:18px;padding:28px 32px;box-shadow:0 8px 32px rgba(20,72,82,0.08)">
    <div style="font-size:11px;font-weight:800;letter-spacing:.18em;text-transform:uppercase;color:#d94e4e">${
    escapeHtml(opts.businessName)
  }</div>
    <div style="margin-top:18px;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-weight:900;font-size:24px;letter-spacing:-0.02em;color:#144852">${headline}</div>
    <p style="margin:14px 0 0;color:#1c2c30;font-size:15px;line-height:1.55">${
    escapeHtml(opts.description)
  }</p>
    <p style="margin:10px 0 0;color:#144852;font-size:15px;font-weight:800">${
    escapeHtml(opts.delta)
  }</p>
    <p style="margin:14px 0 0;color:#6b7a7e;font-size:14px;line-height:1.55">${
    escapeHtml(t(lang, "changeOrderRequest.email.body"))
  }</p>
    <a href="${
    opts.url
  }" style="display:inline-block;margin-top:20px;background:#519843;color:#fff;font-weight:800;font-size:14px;padding:12px 22px;border-radius:12px;text-decoration:none">${
    escapeHtml(t(lang, "changeOrderRequest.email.cta"))
  }</a>
    <div style="margin-top:12px;font-size:12px;color:#6b7a7e;word-break:break-all"><a href="${
    opts.url
  }" style="color:#6b7a7e">${escapeHtml(opts.url)}</a></div>
  </div>
</body></html>`;
}

/** Contractor heads-up (UI language). */
function renderContractorHtml(opts: {
  customerName: string;
  delta: string;
  description: string;
  url: string;
  lang: Lang;
}): string {
  const { lang } = opts;
  const headline = t(lang, "changeOrderAlert.email.headline", {
    name: escapeHtml(opts.customerName),
    delta: opts.delta,
  });
  return `<!doctype html>
<html><body style="margin:0;padding:32px 16px;background:#f7f6f1;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1c2c30">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:18px;padding:28px 32px;box-shadow:0 8px 32px rgba(20,72,82,0.08)">
    <div style="font-size:11px;font-weight:800;letter-spacing:.18em;text-transform:uppercase;color:#d94e4e">${
    escapeHtml(t(lang, "brand.name"))
  }</div>
    <div style="margin-top:18px;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-weight:900;font-size:24px;letter-spacing:-0.02em;color:#144852">${headline}</div>
    <p style="margin:14px 0 0;color:#1c2c30;font-size:15px;line-height:1.55">${
    escapeHtml(opts.description)
  }</p>
    <p style="margin:14px 0 0;color:#6b7a7e;font-size:14px;line-height:1.55">${
    escapeHtml(t(lang, "changeOrderAlert.email.body"))
  }</p>
    <a href="${
    opts.url
  }" style="display:inline-block;margin-top:20px;background:#519843;color:#fff;font-weight:800;font-size:14px;padding:12px 22px;border-radius:12px;text-decoration:none">${
    escapeHtml(t(lang, "changeOrderAlert.email.cta"))
  }</a>
    <div style="margin-top:12px;font-size:12px;color:#6b7a7e;word-break:break-all"><a href="${
    opts.url
  }" style="color:#6b7a7e">${escapeHtml(opts.url)}</a></div>
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
