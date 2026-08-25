import { Injectable } from "#danet/core";
import { InvoiceStore } from "@paperwork/domain/data/invoice-store/mod.ts";
import { PaymentStore } from "@paperwork/domain/data/payment-store/mod.ts";
import { CustomerStore } from "@crm/domain/data/customer-store/mod.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { BusinessIdentityStore } from "@profile/domain/data/business-identity-store/mod.ts";
import { EmailService } from "@communication/domain/data/email-service/mod.ts";
import { SmsService } from "@users/domain/data/sms/mod.ts";
import { ShortLinkStore } from "@paperwork/domain/data/shortlink-store/mod.ts";
import { RenderReceiptPdf } from "@paperwork/domain/coordinators/render-receipt-pdf/mod.ts";
import { LogPaperworkMessage } from "@communication/domain/coordinators/log-paperwork-message/mod.ts";
import { EventBus } from "@core/business/events/mod.ts";
import { type Lang, t } from "@core/i18n/mod.ts";
import { outboundSenderFirstName } from "#quote-flow/outbound-identity.ts";
import type { PaymentMethod } from "@paperwork/dto/invoice.ts";
import type { PaymentMethod as PaymentStorageMethod } from "@paperwork/dto/payment.ts";

/**
 * ConfirmPayment — contractor-side "I got it" coordinator.
 *
 * Wires up the closing half of the manual-payment loop:
 *   1. Take the customer's existing `paymentIntent` on the invoice.
 *   2. Mint a real `Payment` row (the canonical record-of-funds-received).
 *   3. Flip the invoice to `paid`, stamp `paidAt`, clear the intent.
 *   4. Render a receipt PDF (via RenderReceiptPdf, sibling of the agreement PDF).
 *   5. Fire receipt email (to customer + CC contractor) + SMS receipt
 *      with a short-link to the public invoice page.
 *   6. Emit an `invoice:paid` domain event.
 *
 * Idempotent: if the invoice is already `paid`, the coordinator no-ops
 * and returns `{ ok: true, reason: 'already_paid' }`. Dispatch failures
 * (email/SMS) DON'T roll back the Payment row — the contractor still
 * sees it as paid; the receipt resend is a separate retry.
 */
@Injectable()
export class ConfirmPayment {
  constructor(
    private invoices: InvoiceStore,
    private payments: PaymentStore,
    private customers: CustomerStore,
    private users: UserStore,
    private identity: BusinessIdentityStore,
    private email: EmailService,
    private sms: SmsService,
    private shortlinks: ShortLinkStore,
    private receiptPdf: RenderReceiptPdf,
    private commsLog: LogPaperworkMessage,
    private bus: EventBus,
  ) {}

  async run(
    userId: string,
    invoiceId: string,
  ): Promise<{ ok: boolean; reason?: string; paymentId?: string }> {
    const invoice = await this.invoices.getOwned(invoiceId, userId);
    if (invoice.status === "paid") {
      return { ok: true, reason: "already_paid" };
    }
    const intent = invoice.paymentIntent;
    if (!intent) {
      return { ok: false, reason: "no_payment_intent" };
    }

    // 1. Mint the Payment row.
    const payment = await this.payments.create(userId, {
      invoiceId: invoice.id,
      amount: intent.amount,
      method: mapMethod(intent.method),
      receivedAt: new Date().toISOString(),
      ...(intent.reference ? { reference: intent.reference } : {}),
    });

    // 2. Flip invoice to paid. We pass `paymentIntent: undefined` as a
    // hint, but the store filters undefined out so the intent stays
    // until we explicitly wipe it. The intent isn't surfaced once the
    // status is `paid` (the public page renders the receipt note instead).
    const paidAt = new Date().toISOString();
    const updated = await this.invoices.update(invoice.id, userId, {
      status: "paid",
      paidAt,
    });

    // 3. Best-effort receipt dispatch.
    try {
      const [customer, contractor, biz] = await Promise.all([
        invoice.customerId
          ? this.customers.getOwned(invoice.customerId, userId).catch(() =>
            undefined
          )
          : Promise.resolve(undefined),
        this.users.get(userId).catch(() => undefined),
        this.identity.get(userId).catch(() => null),
      ]);
      const businessName = biz?.businessName?.trim() ||
        biz?.legalName?.trim() || contractor?.name?.trim();
      const lang: Lang = biz?.commsLanguage === "es" ? "es" : "en";
      const pdfBytes = await this.receiptPdf.run({
        invoice: updated,
        customer,
        contractor,
        ...(businessName ? { businessName } : {}),
        method: intent.method,
        ...(intent.reference ? { reference: intent.reference } : {}),
        confirmedAt: paidAt,
      });

      if (customer?.email) {
        const subject = t(lang, "confirmPayment.email.subject", {
          id: invoice.id.slice(0, 8).toUpperCase(),
        });
        const htmlBody = renderReceiptHtml({
          customer,
          contractor,
          businessName,
          intent,
          amount: intent.amount,
          lang,
        });
        await this.email.send({
          to: customer.email,
          subject,
          htmlBody,
          ...(contractor?.email ? { cc: [contractor.email] } : {}),
          attachments: [{
            name: t(lang, "confirmPayment.email.attachmentName", {
              id: invoice.id.slice(0, 8).toUpperCase(),
            }),
            content: pdfBytes,
            contentType: "application/pdf",
          }],
        });
        // UX-30: the promised receipt must be auditable in the comms trail,
        // like every other outbound paperwork dispatch.
        await this.commsLog.run({
          userId,
          customerId: invoice.customerId,
          channel: "email",
          content: t(lang, "confirmPayment.email.body", {
            amount: fmtUSD(intent.amount),
            ref: "",
          }),
          subject,
          htmlBody,
          toAddress: customer.email,
          paperworkId: invoice.id,
          paperworkType: "invoice",
        });
      }
      if (customer?.phoneNumber) {
        // Mint a shortlink back to the public invoice page so the SMS
        // receipt is a single short line.
        let shortUrl = "";
        try {
          const link = await this.shortlinks.findOrCreate(
            userId,
            "invoice",
            invoice.id,
          );
          const appUrl = Deno.env.get("APP_URL") ??
            "https://paperworkmonster.com";
          shortUrl = `${appUrl}/s/${link.code}`;
        } catch { /* fall through to no-url body */ }
        const customerFirst = customer.name?.trim().split(/\s+/)[0];
        // UX-26: the receipt sender token goes through the shared identity
        // helper — the seeded placeholder ("Nuevo"/"New") never leaks out.
        const senderFirst = outboundSenderFirstName(contractor?.name);
        const lead = customerFirst
          ? t(lang, "confirmPayment.sms.lead", { name: customerFirst })
          : "";
        const tail = senderFirst
          ? t(lang, "confirmPayment.sms.tail", { name: senderFirst })
          : "";
        const body = t(lang, "confirmPayment.sms.body", {
          lead,
          amount: fmtUSD(intent.amount),
          url: shortUrl,
          tail,
        });
        await this.sms.send({ to: customer.phoneNumber, body });
        // UX-30: log the receipt SMS to the comms trail.
        await this.commsLog.run({
          userId,
          customerId: invoice.customerId,
          channel: "text",
          content: body,
          toAddress: customer.phoneNumber,
          paperworkId: invoice.id,
          paperworkType: "invoice",
        });
      }
    } catch (err) {
      console.error("[confirm-payment] receipt dispatch failed:", err);
    }

    // 4. Emit event for activity feed + dashboard counters.
    try {
      await this.bus.emit({
        userId,
        entityType: "invoice",
        entityId: invoice.id,
        action: "paid",
        data: {
          amount: intent.amount,
          method: intent.method,
          ...(intent.reference ? { reference: intent.reference } : {}),
        },
      });
    } catch (err) {
      console.error("[confirm-payment] event emit failed:", err);
    }

    return { ok: true, paymentId: payment.id };
  }
}

/** Map the invoice payment-intent method to the stored Payment method. The
 *  Payment DTO now carries the peer-to-peer wallets too, so we preserve HOW
 *  the customer paid (Zelle/Venmo/Cash App/PayPal) instead of flattening to
 *  "other". Anything unrecognised still falls back to "other". */
function mapMethod(m: PaymentMethod): PaymentStorageMethod {
  switch (m) {
    case "cash":
      return "cash";
    case "check":
      return "check";
    case "ach":
      return "ach";
    case "venmo":
      return "venmo";
    case "zelle":
      return "zelle";
    case "cashapp":
      return "cashapp";
    case "paypal":
      return "paypal";
    case "card":
      return "card";
    default:
      return "other";
  }
}

function fmtUSD(cents: number): string {
  return `$${
    (cents / 100).toLocaleString("en-US", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    })
  }`;
}

function renderReceiptHtml(opts: {
  customer?: { name?: string; email?: string };
  contractor?: { name?: string };
  businessName?: string;
  intent: { method: PaymentMethod; reference?: string };
  amount: number;
  lang: Lang;
}): string {
  const { lang } = opts;
  const businessLabel = opts.businessName ?? opts.contractor?.name ??
    t(lang, "brand.name");
  const customerFirst = opts.customer?.name?.trim().split(/\s+/)[0];
  const headline = customerFirst
    ? t(lang, "confirmPayment.email.headline", {
      name: escapeHtml(customerFirst),
    })
    : t(lang, "confirmPayment.email.headlineNoName");
  const ref = opts.intent.reference
    ? t(lang, "confirmPayment.email.refSuffix", {
      reference: escapeHtml(opts.intent.reference),
    })
    : "";
  return `<!doctype html>
<html><body style="margin:0;padding:32px 16px;background:#f7f6f1;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1c2c30">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:18px;padding:28px 32px;box-shadow:0 8px 32px rgba(20,72,82,0.08)">
    <div style="font-size:11px;font-weight:800;letter-spacing:.18em;text-transform:uppercase;color:#d94e4e">${
    escapeHtml(businessLabel)
  }</div>
    <div style="margin-top:18px;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-weight:900;font-size:24px;letter-spacing:-0.02em;color:#144852">${headline}</div>
    <p style="margin:14px 0 0;color:#1c2c30;font-size:15px;line-height:1.55">
      ${
    t(lang, "confirmPayment.email.body", { amount: fmtUSD(opts.amount), ref })
  }
    </p>
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
