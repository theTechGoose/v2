import { Injectable } from "#danet/core";
import { LoadBusinessLogo } from "@paperwork/domain/coordinators/load-business-logo/mod.ts";
import { InvoiceStore } from "@paperwork/domain/data/invoice-store/mod.ts";
import { CustomerStore } from "@crm/domain/data/customer-store/mod.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { BusinessIdentityStore } from "@profile/domain/data/business-identity-store/mod.ts";
import { EmailService } from "@communication/domain/data/email-service/mod.ts";
import { SmsService } from "@users/domain/data/sms/mod.ts";
import {
  customerSmsTarget,
  dispatchCustomerSms,
} from "@paperwork/domain/business/customer-sms/mod.ts";
import { businessFrom } from "@communication/domain/business/sender/mod.ts";
import {
  emailLogo,
  emailLogoHtml,
} from "@paperwork/domain/business/email-logo/mod.ts";
import { ShortLinkStore } from "@paperwork/domain/data/shortlink-store/mod.ts";
import { ReplyTokenStore } from "@paperwork/domain/data/reply-token-store/mod.ts";
import {
  inboundDomain,
  replyAddress,
} from "@paperwork/domain/business/inbound-reply/mod.ts";
import { RenderReceiptPdf } from "@paperwork/domain/coordinators/render-receipt-pdf/mod.ts";
import { LogPaperworkMessage } from "@communication/domain/coordinators/log-paperwork-message/mod.ts";
import { type Lang, t } from "@core/i18n/mod.ts";
import { outboundSenderFirstName } from "#quote-flow/outbound-identity.ts";
import { resolveCommsLanguage } from "#quote-flow/comms-language.ts"; // REQ-715
import { withSendLang } from "#quote-flow/share-link.ts"; // REQ-715
import type { PaymentMethod } from "@paperwork/dto/invoice.ts";
import { balanceDue } from "@paperwork/domain/business/invoice-balance/mod.ts";
import { SITE_ORIGIN } from "#quote-flow/site-meta.ts";
import {
  customerOnDocument,
  docRef,
} from "@paperwork/domain/business/doc-render/mod.ts";
import {
  fmtUSD,
  renderReceiptHtml,
  renderReceiptSubject,
} from "@paperwork/domain/business/payment-receipt/mod.ts";

/** The money the receipt is for. INTEGER CENTS. */
export interface ReceiptPayment {
  amount: number;
  method: PaymentMethod;
  reference?: string;
  /** When it was received — printed on the receipt PDF. ISO. */
  receivedAt: string;
}

export interface ReceiptResult {
  /** The receipt email was accepted by the provider. */
  emailed: boolean;
  /** The receipt text was accepted by the provider. */
  texted: boolean;
  /** REQ-224: the client as the bill names them (for the feed line). */
  customerName?: string;
}

/**
 * SendPaymentReceipt — REQ-963 (LOOP-007 q1-37): the ONE payment receipt.
 *
 * Extracted from ConfirmPayment so every path that records money the
 * customer paid receipts it the same way: the claim confirm and the
 * assistant (ConfirmPayment) and the Record payment dialog
 * (POST /payments, PaymentController.create — for a payment that leaves a
 * balance; the one that closes it gets the PAID invoice, REQ-020).
 *
 *   1. Render the receipt PDF (RenderReceiptPdf) in the customer's language.
 *   2. Email it to the customer, the contractor cc'd; list it in the outbox
 *      (REQ-784) and the comms trail (UX-30).
 *   3. Text a short receipt with a link to the invoice (REQ-523 guard).
 *   4. REQ-556: stamp `receiptSentVia` with where it actually went.
 *
 * Best-effort: a dispatch failure never throws — the payment stays recorded.
 */
@Injectable()
export class SendPaymentReceipt {
  // REQ-1017 / REQ-175: the same per-(contractor, customer) reply token the
  // invoice emails use (send-paperwork-email holds it the same way).
  private replyTokens = new ReplyTokenStore();

  constructor(
    private invoices: InvoiceStore,
    private customers: CustomerStore,
    private users: UserStore,
    private identity: BusinessIdentityStore,
    private email: EmailService,
    private sms: SmsService,
    private shortlinks: ShortLinkStore,
    private receiptPdf: RenderReceiptPdf,
    private commsLog: LogPaperworkMessage,
    private logos: LoadBusinessLogo = new LoadBusinessLogo(),
  ) {}

  async run(
    userId: string,
    invoiceId: string,
    payment: ReceiptPayment,
  ): Promise<ReceiptResult> {
    // REQ-224: the feed line names the client as the bill shows them.
    let customerName: string | undefined;
    // REQ-556 (demo-loop cycle 4, M7): what this receipt actually reached.
    let receiptEmailed = false;
    let receiptTexted = false;
    const invoice = await this.invoices.getOwned(invoiceId, userId).catch(
      (err) => {
        console.error("[send-payment-receipt] invoice not found:", err);
        return undefined;
      },
    );
    if (!invoice) return { emailed: false, texted: false };

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
      const onBill = customerOnDocument(invoice, customer);
      customerName = (onBill?.name ?? onBill?.businessName)?.trim() ||
        undefined;
      const businessName = biz?.businessName?.trim() ||
        biz?.legalName?.trim() || contractor?.name?.trim();
      // REQ-715 (demo-loop cycle 5, m31): the receipt — email, text and its
      // PDF — speaks the customer's own language, else the business's send
      // default, else en.
      const lang: Lang = resolveCommsLanguage({
        customerLanguage: customer?.language,
        identityCommsLanguage: biz?.commsLanguage,
        sendLanguages: biz?.commsLanguages, // REQ-925
      });
      // REQ-1071 (q2-60): what is still due after this payment. Callers run
      // ComputeInvoiceBalance first, so the loaded invoice's paidCents
      // already counts this payment — the same figure /i shows.
      const totalCents = invoice.amount ?? 0;
      // REQ-1110 (q3-34): the PDF states the same three figures as the email.
      const balanceCents = invoice.status === "paid"
        ? 0
        : balanceDue(invoice, invoice.paidCents ?? 0);
      const pdfBytes = await this.receiptPdf.run({
        invoice: invoice,
        customer,
        contractor,
        ...(businessName ? { businessName } : {}),
        // REQ-1110 (q3-34): the payment received, not the invoice total
        amount: payment.amount,
        totalCents,
        balanceCents,
        method: payment.method,
        ...(payment.reference ? { reference: payment.reference } : {}),
        confirmedAt: payment.receivedAt,
        lang,
        // REQ-628: the business's logo heads the receipt
        logo: await this.logos.run(userId),
      });

      // A shortlink back to the public invoice page, opened in the receipt's
      // language — minted once: the text links it, and (REQ-1071, q2-60) the
      // email's "Pay the balance" button does too.
      let invoiceUrl = "";
      try {
        const link = await this.shortlinks.findOrCreate(
          userId,
          "invoice",
          invoice.id,
        );
        const appUrl = Deno.env.get("APP_URL") ?? SITE_ORIGIN;
        // REQ-715 (REQ-342 parity): opens the invoice in the receipt's language
        invoiceUrl = withSendLang(`${appUrl}/s/${link.code}`, lang);
      } catch { /* fall through to no-url receipt */ }

      if (customer?.email) {
        // REQ-204: "Receipt for INV-5000" — the receipt names the bill by number
        const subject = renderReceiptSubject(invoice, lang);
        const htmlBody = renderReceiptHtml({
          invoice: invoice,
          customer,
          contractor,
          businessName,
          intent: payment,
          amount: payment.amount,
          lang,
          // REQ-1071 (q2-60): the balance still due and a link to pay it
          totalCents,
          balanceCents,
          ...(invoiceUrl ? { payUrl: invoiceUrl } : {}),
          // REQ-628: headed by the business's own logo, or its name as a wordmark
          logoHtml: emailLogoHtml(emailLogo({
            appUrl: Deno.env.get("APP_URL") ?? SITE_ORIGIN,
            kind: "invoice",
            id: invoice.id,
            biz,
            ...(businessName ? { fallbackName: businessName } : {}),
          })),
        });
        const mailed = await this.email.send({
          to: customer.email,
          subject,
          htmlBody,
          // REQ-628: under the business's name, never DocuMonster
          from: businessFrom({ alias: biz?.emailAlias, name: businessName }),
          ...(contractor?.email ? { cc: [contractor.email] } : {}),
          // REQ-1017 / REQ-175: a reply to the receipt lands in this
          // customer's Messages thread, like a reply to the invoice email.
          ...(invoice.customerId
            ? {
              replyTo: replyAddress(
                await this.replyTokens.forCustomer(userId, invoice.customerId),
                inboundDomain(),
              ),
            }
            : {}),
          attachments: [{
            name: t(lang, "confirmPayment.email.attachmentName", {
              id: docRef(invoice).replace(/^#/, ""),
            }),
            content: pdfBytes,
            contentType: "application/pdf",
          }],
        });
        receiptEmailed = mailed.ok;
        // REQ-784 (demo-loop dv1, d12): the receipt is a customer message —
        // the outbox lists it, sent or not, with the email as sent.
        await this.commsLog.outbox({
          userId,
          channel: "email",
          kind: "receipt",
          language: lang,
          ok: mailed.ok,
          ...(mailed.ok ? {} : { reason: mailed.reason }),
          customerId: invoice.customerId,
          customerName,
          to: customer.email,
          docId: invoice.id,
          docRef: docRef(invoice),
          subject,
          body: htmlBody,
        });
        // UX-30: the promised receipt must be auditable in the comms trail,
        // like every other outbound paperwork dispatch.
        await this.commsLog.run({
          userId,
          customerId: invoice.customerId,
          channel: "email",
          content: t(lang, "confirmPayment.email.body", {
            amount: fmtUSD(payment.amount),
            ref: "",
          }),
          subject,
          htmlBody,
          toAddress: customer.email,
          paperworkId: invoice.id,
          paperworkType: "invoice",
        });
      }
      // REQ-523 (demo m16): only a number that can take a text gets the
      // receipt text — a missing, invalid or fictional one is skipped.
      const smsTo = customerSmsTarget(customer?.phoneNumber);
      if (!smsTo.ok && smsTo.failureCode !== "missing") {
        // REQ-784: a phone on file that can't take the text — "not texted" and why
        await this.commsLog.outbox({
          userId,
          channel: "text",
          kind: "receipt",
          language: lang,
          ok: false,
          reasonCode: smsTo.failureCode,
          customerId: invoice.customerId,
          customerName,
          to: "e164" in smsTo ? smsTo.e164 : customer?.phoneNumber ?? "",
          docId: invoice.id,
          docRef: docRef(invoice),
        });
      }
      if (smsTo.ok) {
        // The SMS receipt is a single short line: the shortlink minted above.
        const shortUrl = invoiceUrl;
        // REQ-204: greet the customer as snapshotted on the bill
        const shownCustomer = customerOnDocument(invoice, customer);
        const customerFirst =
          (shownCustomer?.name ?? shownCustomer?.businessName)?.trim().split(
            /\s+/,
          )[0];
        // UX-26: the receipt sender token goes through the shared identity
        // helper — the seeded placeholder ("Nuevo"/"New") never leaks out.
        const senderFirst = outboundSenderFirstName(contractor?.name);
        const lead = customerFirst
          ? t(lang, "confirmPayment.sms.lead", { name: customerFirst })
          : "";
        const tail = senderFirst
          ? t(lang, "confirmPayment.sms.tail", { name: senderFirst })
          : "";
        // REQ-204: the text names the bill — "… Receipt: <url> (INV-5000)"
        const body = `${
          t(lang, "confirmPayment.sms.body", {
            lead,
            amount: fmtUSD(payment.amount),
            url: shortUrl,
            tail,
          })
        } (${docRef(invoice)})`;
        // REQ-523: the same guarded dispatch as every other customer text.
        const res = await dispatchCustomerSms(this.sms, {
          to: smsTo.e164,
          body,
          uiLang: lang,
        });
        // REQ-784: the receipt text, in the outbox, sent or not and why
        await this.commsLog.outbox({
          userId,
          channel: "text",
          kind: "receipt",
          language: lang,
          ok: res.ok,
          ...(res.ok
            ? {}
            : { reasonCode: res.failureCode, reason: res.reason }),
          customerId: invoice.customerId,
          customerName,
          to: res.to,
          docId: invoice.id,
          docRef: docRef(invoice),
          body,
        });
        // UX-30: log the receipt SMS to the comms trail — REQ-523: only a
        // text the provider accepted, never a refused or rejected one.
        if (res.ok) {
          receiptTexted = true;
          await this.commsLog.run({
            userId,
            customerId: invoice.customerId,
            channel: "text",
            content: body,
            toAddress: res.to,
            paperworkId: invoice.id,
            paperworkType: "invoice",
          });
        } else {
          console.warn(
            `[send-payment-receipt] receipt text to ${res.to} not sent: ${
              res.detail ?? res.reason
            }`,
          );
        }
      }
    } catch (err) {
      console.error("[send-payment-receipt] receipt dispatch failed:", err);
    }

    // REQ-556 (demo-loop cycle 4, M7): record where the receipt went, so the
    // paid card and /i never say "sent" / "in your inbox" when it went
    // nowhere. On a paid invoice MarkInvoicePaid recorded its PAID-invoice
    // email: an email either one delivered wins, then a delivered text, else
    // "none". On a bill with a balance left (REQ-963) this receipt is the
    // only thing that went out.
    try {
      const current = await this.invoices.getOwned(invoice.id, userId);
      const keptEmail = current.status === "paid" &&
        current.receiptSentVia === "email";
      // REQ-941 (q1-7): a delivered PAID-invoice email without the PDF
      // ("paid_email") still beats "none".
      const keptPaidEmail = current.status === "paid" &&
        current.receiptSentVia === "paid_email";
      const via = receiptEmailed || keptEmail
        ? "email"
        : receiptTexted
        ? "text"
        : keptPaidEmail
        ? "paid_email"
        : "none";
      if (current.receiptSentVia !== via) {
        await this.invoices.update(invoice.id, userId, {
          receiptSentVia: via,
        });
      }
    } catch (err) {
      console.error(
        "[send-payment-receipt] could not record the receipt delivery:",
        err,
      );
    }

    return {
      emailed: receiptEmailed,
      texted: receiptTexted,
      ...(customerName ? { customerName } : {}),
    };
  }
}
