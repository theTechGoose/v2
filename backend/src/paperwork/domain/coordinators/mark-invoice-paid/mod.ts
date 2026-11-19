import { Injectable } from "#danet/core";
import { SendPaperworkEmail } from "@paperwork/domain/coordinators/send-paperwork-email/mod.ts";
import { InvoiceStore } from "@paperwork/domain/data/invoice-store/mod.ts";
import { PaymentStore } from "@paperwork/domain/data/payment-store/mod.ts";
import { CustomerStore } from "@crm/domain/data/customer-store/mod.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { BusinessIdentityStore } from "@profile/domain/data/business-identity-store/mod.ts";
import { RenderReceiptPdf } from "@paperwork/domain/coordinators/render-receipt-pdf/mod.ts";
import { LoadBusinessLogo } from "@paperwork/domain/coordinators/load-business-logo/mod.ts";
import type { EmailAttachment } from "@communication/domain/data/email-service/mod.ts";
import type { PaymentMethod } from "@paperwork/dto/invoice.ts";
import { docRef } from "@paperwork/domain/business/doc-render/mod.ts";
import { t } from "@core/i18n/mod.ts";
import { resolveCommsLanguage } from "#quote-flow/comms-language.ts";

export interface MarkInvoicePaidOptions {
  /** REQ-941: attach the customer's PDF receipt to the paid email (default
   *  true). ConfirmPayment passes false — its own receipt email carries the
   *  PDF, so the customer never gets two. */
  receiptPdf?: boolean;
}

/**
 * MarkInvoicePaid — REQ-020 (NW-29): "When an invoice is paid it must also
 * be emailed to the Unicorn with 'Paid' on it so everyone is on the same
 * page."
 *
 * The ONE place the paid-invoice email is dispatched from, so every path
 * that flips an invoice to paid behaves the same:
 *   - ComputeInvoiceBalance (a recorded payment closes the balance —
 *     POST/PUT/DELETE /payments, the REQ-018 "Payment received" button);
 *   - ConfirmPayment (the contractor confirms a customer claim — which keeps
 *     its receipt on top).
 *
 * Best-effort: a mail failure never breaks the payment. The dispatch is
 * logged in the customer's comms trail by SendPaperworkEmail itself.
 *
 * REQ-556 (demo-loop cycle 4, M7): the result is recorded on the invoice —
 * `receiptSentVia` "none" when the email was not delivered (no address,
 * refused, thrown) — so /invoices and /i never say a receipt went out that
 * did not. ConfirmPayment upgrades it when its own receipt email or text
 * gets through.
 *
 * REQ-941 (LOOP-007 q1-7): /i reads "email" as "A PDF receipt is in your
 * inbox", so the paid email now carries that PDF receipt (RenderReceiptPdf,
 * in the language the email resolves to), and "email" is recorded only when
 * it did. A delivered paid email without the PDF (the render failed, or
 * ConfirmPayment's own receipt carries it) records "paid_email".
 */
@Injectable()
export class MarkInvoicePaid {
  constructor(
    private emailer: SendPaperworkEmail,
    private invoices: InvoiceStore,
    private payments: PaymentStore = new PaymentStore(),
    private customers: CustomerStore = new CustomerStore(),
    private users: UserStore = new UserStore(),
    private identity: BusinessIdentityStore = new BusinessIdentityStore(),
    private receiptPdf: RenderReceiptPdf = new RenderReceiptPdf(),
    private logos: LoadBusinessLogo = new LoadBusinessLogo(),
  ) {}

  async run(
    userId: string,
    invoiceId: string,
    opts: MarkInvoicePaidOptions = {},
  ): Promise<void> {
    const attachments = opts.receiptPdf === false
      ? undefined
      : await this.receiptAttachment(userId, invoiceId);
    let delivered = false;
    try {
      const sent = await this.emailer.run(userId, {
        kind: "invoice",
        resourceId: invoiceId,
        variant: "paid",
        ...(attachments ? { attachments } : {}),
      });
      delivered = sent.ok;
      if (!sent.ok) {
        console.warn(
          `[mark-invoice-paid] paid-invoice email not sent for ${invoiceId}: ${sent.reason}`,
        );
      }
    } catch (err) {
      console.error(
        `[mark-invoice-paid] paid-invoice email failed for ${invoiceId}:`,
        err,
      );
    }
    try {
      await this.invoices.update(invoiceId, userId, {
        receiptSentVia: !delivered
          ? "none"
          : attachments
          ? "email"
          : "paid_email",
      });
    } catch (err) {
      console.error(
        `[mark-invoice-paid] could not record the receipt delivery for ${invoiceId}:`,
        err,
      );
    }
  }

  /** REQ-941: the receipt PDF for the paid invoice — the same render
   *  ConfirmPayment attaches, in the customer's resolved language, for the
   *  payment that closed it. Undefined when it cannot be rendered. */
  private async receiptAttachment(
    userId: string,
    invoiceId: string,
  ): Promise<EmailAttachment[] | undefined> {
    try {
      const invoice = await this.invoices.getOwned(invoiceId, userId);
      const [customer, contractor, biz, payments, logo] = await Promise.all([
        invoice.customerId
          ? this.customers.getOwned(invoice.customerId, userId).catch(() =>
            undefined
          )
          : Promise.resolve(undefined),
        this.users.get(userId).catch(() => undefined),
        this.identity.get(userId).catch(() => null),
        this.payments.listByInvoice(invoiceId, userId).catch(() => []),
        this.logos.run(userId),
      ]);
      // the payment that closed the bill: the latest received
      const last = [...payments].sort((a, b) =>
        (a.receivedAt ?? "").localeCompare(b.receivedAt ?? "")
      ).at(-1);
      const businessName = biz?.businessName?.trim() ||
        biz?.legalName?.trim() || contractor?.name?.trim();
      // the same resolution SendPaperworkEmail gives the email it rides with
      const lang = resolveCommsLanguage({
        customerLanguage: customer?.language,
        identityCommsLanguage: biz?.commsLanguage,
        sendLanguages: biz?.commsLanguages,
      });
      const content = await this.receiptPdf.run({
        invoice,
        customer,
        contractor,
        ...(businessName ? { businessName } : {}),
        method: (last?.method ?? "other") as PaymentMethod,
        ...(last?.reference ? { reference: last.reference } : {}),
        confirmedAt: invoice.paidAt ?? last?.receivedAt ??
          new Date().toISOString(),
        lang,
        ...(logo ? { logo } : {}),
      });
      return [{
        name: t(lang, "confirmPayment.email.attachmentName", {
          id: docRef(invoice).replace(/^#/, ""),
        }),
        content,
        contentType: "application/pdf",
      }];
    } catch (err) {
      console.error(
        `[mark-invoice-paid] receipt PDF not rendered for ${invoiceId}:`,
        err,
      );
      return undefined;
    }
  }
}
