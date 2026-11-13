import { Injectable } from "#danet/core";
import { ChangeOrderStore } from "@paperwork/domain/data/change-order-store/mod.ts";
import { InvoiceStore } from "@paperwork/domain/data/invoice-store/mod.ts";
import { CustomerStore } from "@crm/domain/data/customer-store/mod.ts";
import {
  changeOrderRef,
  customerOnDocument,
  docRef,
} from "@paperwork/domain/business/doc-render/mod.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { BusinessIdentityStore } from "@profile/domain/data/business-identity-store/mod.ts";
import { EmailService } from "@communication/domain/data/email-service/mod.ts";
import { SmsService } from "@users/domain/data/sms/mod.ts";
import { dispatchCustomerSms } from "@paperwork/domain/business/customer-sms/mod.ts";
import { type Lang, t } from "@core/i18n/mod.ts";
import { SITE_ORIGIN } from "#quote-flow/site-meta.ts";
import { EventBus } from "@core/business/events/mod.ts";
import { phoneCantReceiveTexts } from "#quote-flow/sms-number.ts";

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

/** REQ-456 (demo-loop cycle 3, M25): what reached the CUSTOMER, per channel,
 *  so the chat can say "Sent CO-001 to Karen by email (…) — text failed (…)".
 *  A channel with nothing on file has neither its address nor a reason. */
export interface ChangeOrderCustomerDelivery {
  /** "CO-001" */
  number: string;
  /** "/co/<id>?lang=<commsLanguage>" — the approval page, origin-free. */
  approvalPath: string;
  emailedTo?: string;
  emailFailureReason?: string;
  textedTo?: string;
  smsFailureReason?: string;
  /** REQ-681 (cycle 5, m12): the phone on file can't take texts (the shared
   *  REQ-569 predicate), so no text was attempted; the worded reason. */
  smsSkippedReason?: string;
}

export interface ChangeOrderAlertResult {
  ok: boolean;
  reason?: string;
  /** REQ-456: absent only when there was no contractor to send as. */
  customer?: ChangeOrderCustomerDelivery;
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
    private invoices: InvoiceStore,
    private bus?: EventBus,
  ) {}

  async run(changeOrderId: string): Promise<ChangeOrderAlertResult> {
    const co = await this.changeOrders.get(changeOrderId);
    const [contractor, liveCustomer, ident, invoice] = await Promise.all([
      this.users.get(co.userId).catch(() => undefined),
      co.customerId
        ? this.customers.getOwned(co.customerId, co.userId).catch(() =>
          undefined
        )
        : Promise.resolve(undefined),
      this.identity.get(co.userId).catch(() => null),
      // REQ-204: the alert names "CO-001 on INV-5000"
      this.invoices.get(co.invoiceId).catch(() => undefined),
    ]);
    if (!contractor) return { ok: false, reason: "no_contractor" };
    // REQ-204: the change order names the customer as snapshotted when it was raised
    const customer = customerOnDocument(co, liveCustomer);
    const contact = {
      email: liveCustomer?.email?.trim() || customer?.email?.trim(),
      phoneNumber: liveCustomer?.phoneNumber?.trim() || customer?.phoneNumber?.trim(),
    };

    // Contractor copy = their UI language; customer copy = outgoing-comms
    // language (roadmap p.13), like every other customer-facing document.
    const cxLang: Lang = contractor.language === "es" ? "es" : "en";
    const coLang: Lang = ident?.commsLanguage === "es" ? "es" : "en";
    const businessName = ident?.businessName?.trim() ||
      (ident as { legalName?: string } | null)?.legalName?.trim() ||
      contractor.name?.trim() || t(coLang, "brand.name");
    const customerName = customer?.name?.trim() || customer?.businessName?.trim() ||
      t(cxLang, "notify.fallbackClient");
    const delta = fmtDelta(co.deltaAmountCents);
    // REQ-398 (demo p13-j, REQ-342 parity): the link carries the language
    // the order was sent in; /co reads ?lang= first and its EN | ES toggle
    // flips it from there.
    const approvalPath = `/co/${co.id}?lang=${coLang}`;
    const url = `${APP_URL}${approvalPath}`;
    const refCo = changeOrderRef(co, invoice, coLang);
    const refCx = changeOrderRef(co, invoice, cxLang);

    let sentAny = false;
    const delivered: ChangeOrderCustomerDelivery = {
      number: docRef(co),
      approvalPath,
    };

    // ── Customer: the actual approval request ───────────────────────────
    if (contact.email) {
      try {
        const res = await this.email.send({
          to: contact.email,
          subject: `${
            t(coLang, "changeOrderRequest.email.subject", {
              business: businessName,
            })
          } — ${refCo}`,
          htmlBody: renderCustomerHtml({
            businessName,
            delta,
            description: co.description,
            url,
            lang: coLang,
            ref: refCo,
          }),
        });
        console.log(
          `[send-change-order-alert] co ${co.id} customer-email → ${contact.email}: ok=${res.ok}${
            res.reason ? ` (${res.reason})` : ""
          }`,
        );
        sentAny = sentAny || res.ok;
        if (res.ok) delivered.emailedTo = contact.email;
        else delivered.emailFailureReason = res.reason ?? "failed";
      } catch (err) {
        console.error("[send-change-order-alert] customer email failed:", err);
        delivered.emailFailureReason = errText(err);
      }
    }
    if (phoneCantReceiveTexts(contact.phoneNumber)) {
      // REQ-681 (demo-loop cycle 5, m12): the send dialog already rules out
      // texting this number (REQ-569) — don't attempt it here either, and say
      // why it was skipped rather than reporting a failed text.
      delivered.smsSkippedReason = t(cxLang, "sms.fictionalNumber");
    } else if (contact.phoneNumber) {
      try {
        // REQ-588 (demo-loop cycle 4, M29): the ONE guarded customer-text
        // dispatch (REQ-403) — a missing/invalid/555 number never reaches the
        // provider, and the failure reason comes back worded in the
        // contractor's UI language instead of a raw "sms.fictionalNumber" key.
        const res = await dispatchCustomerSms(this.sms, {
          to: contact.phoneNumber,
          body: `${refCo}: ${
            t(coLang, "changeOrderRequest.sms.body", {
              business: businessName,
              delta,
              url,
            })
          }`,
          uiLang: cxLang,
        });
        console.log(
          `[send-change-order-alert] co ${co.id} customer-sms → ${contact.phoneNumber}: ok=${res.ok}${
            res.reason ? ` (${res.reason})` : ""
          }`,
        );
        sentAny = sentAny || res.ok;
        if (res.ok) delivered.textedTo = contact.phoneNumber;
        else delivered.smsFailureReason = res.reason ?? "failed";
      } catch (err) {
        console.error("[send-change-order-alert] customer sms failed:", err);
        delivered.smsFailureReason = errText(err);
      }
    }

    // ── Contractor: heads-up + the link as a backup to share ────────────
    if (contractor.email?.trim()) {
      try {
        const res = await this.email.send({
          to: contractor.email.trim(),
          subject: `${
            t(cxLang, "changeOrderAlert.email.subject", {
              name: customerName,
              delta,
            })
          } — ${refCx}`,
          htmlBody: renderContractorHtml({
            customerName,
            delta,
            description: co.description,
            url,
            lang: cxLang,
            ref: refCx,
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
          body: `${refCx}: ${
            t(cxLang, "changeOrderAlert.sms.body", {
              name: customerName,
              delta,
              url,
            })
          }`,
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

    // REQ-698 (demo-loop cycle 5, m14): a change order that reached the
    // customer is the owner's work — "What we handled today" (built from
    // notifications) never showed pair 5's CO-002. Every send path (the
    // assistant, a chat edit, the invoice controller) comes through here.
    if (delivered.emailedTo || delivered.textedTo) {
      await this.bus?.emit({
        userId: co.userId,
        entityType: "invoice",
        entityId: co.invoiceId,
        action: "change_order_sent",
        data: {
          number: delivered.number,
          delta,
          ...(customer?.name?.trim() || customer?.businessName?.trim()
            ? {
              customerName: customer?.name?.trim() ||
                customer?.businessName?.trim(),
            }
            : {}),
          ...(contractor.language ? { language: contractor.language } : {}),
        },
      }).catch((err) =>
        console.error("[send-change-order-alert] emit failed:", err)
      );
    }

    return sentAny
      ? { ok: true, customer: delivered }
      : { ok: false, reason: "no_contact", customer: delivered };
  }
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Customer-facing approval request (commsLanguage). */
function renderCustomerHtml(opts: {
  businessName: string;
  delta: string;
  description: string;
  url: string;
  lang: Lang;
  /** REQ-204: "CO-001 on INV-5000" */
  ref: string;
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
    <div data-doc-ref style="margin-top:10px;font-size:12px;font-weight:800;color:#6b7a7e">${
    escapeHtml(opts.ref)
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
  /** REQ-204: "CO-001 on INV-5000" */
  ref: string;
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
    <div data-doc-ref style="margin-top:10px;font-size:12px;font-weight:800;color:#6b7a7e">${
    escapeHtml(opts.ref)
  }</div>
    <div style="margin-top:18px;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-weight:900;font-size:24px;letter-spacing:-0.02em;color:#144852">${headline}</div>
    <p style="margin:14px 0 0;color:#1c2c30;font-size:15px;line-height:1.55">${
    escapeHtml(opts.description)
  }</p>
    <p style="margin:14px 0 0;color:#6b7a7e;font-size:14px;line-height:1.55">${
    escapeHtml(
      t(lang, "changeOrderAlert.email.body", { name: opts.customerName }),
    )
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
