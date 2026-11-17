import { Injectable } from "#danet/core";
import { SendPaperworkEmail } from "@paperwork/domain/coordinators/send-paperwork-email/mod.ts";
import { InvoiceStore } from "@paperwork/domain/data/invoice-store/mod.ts";

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
 * `receiptSentVia` "email" when the email was delivered, "none" when it was
 * not (no address, refused, thrown) — so /invoices and /i never say a receipt
 * went out that did not. ConfirmPayment upgrades it when its own receipt
 * email or text gets through.
 */
@Injectable()
export class MarkInvoicePaid {
  constructor(
    private emailer: SendPaperworkEmail,
    private invoices: InvoiceStore,
  ) {}

  async run(userId: string, invoiceId: string): Promise<void> {
    let delivered = false;
    try {
      const sent = await this.emailer.run(userId, {
        kind: "invoice",
        resourceId: invoiceId,
        variant: "paid",
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
        receiptSentVia: delivered ? "email" : "none",
      });
    } catch (err) {
      console.error(
        `[mark-invoice-paid] could not record the receipt delivery for ${invoiceId}:`,
        err,
      );
    }
  }
}
