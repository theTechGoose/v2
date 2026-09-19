import { Injectable } from "#danet/core";
import { SendPaperworkEmail } from "@paperwork/domain/coordinators/send-paperwork-email/mod.ts";

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
 */
@Injectable()
export class MarkInvoicePaid {
  constructor(private emailer: SendPaperworkEmail) {}

  async run(userId: string, invoiceId: string): Promise<void> {
    try {
      await this.emailer.run(userId, {
        kind: "invoice",
        resourceId: invoiceId,
        variant: "paid",
      });
    } catch (err) {
      console.error(
        `[mark-invoice-paid] paid-invoice email failed for ${invoiceId}:`,
        err,
      );
    }
  }
}
