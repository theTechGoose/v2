import { Injectable } from "#danet/core";
import { LoadBusinessLogo } from "@paperwork/domain/coordinators/load-business-logo/mod.ts";
import { InvoiceStore } from "@paperwork/domain/data/invoice-store/mod.ts";
import { PaymentStore } from "@paperwork/domain/data/payment-store/mod.ts";
import { CustomerStore } from "@crm/domain/data/customer-store/mod.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { BusinessIdentityStore } from "@profile/domain/data/business-identity-store/mod.ts";
import { EmailService } from "@communication/domain/data/email-service/mod.ts";
import { SmsService } from "@users/domain/data/sms/mod.ts";
import { ShortLinkStore } from "@paperwork/domain/data/shortlink-store/mod.ts";
import { RenderReceiptPdf } from "@paperwork/domain/coordinators/render-receipt-pdf/mod.ts";
import { MarkInvoicePaid } from "@paperwork/domain/coordinators/mark-invoice-paid/mod.ts";
import { ComputeInvoiceBalance } from "@paperwork/domain/coordinators/compute-invoice-balance/mod.ts";
import { SendPaymentReceipt } from "@paperwork/domain/coordinators/send-payment-receipt/mod.ts"; // REQ-963
import { LogPaperworkMessage } from "@communication/domain/coordinators/log-paperwork-message/mod.ts";
import { EventBus } from "@core/business/events/mod.ts";
import type { PaymentMethod } from "@paperwork/dto/invoice.ts";
import type { PaymentMethod as PaymentStorageMethod } from "@paperwork/dto/payment.ts";
// REQ-963: the receipt's words moved beside SendPaymentReceipt; re-exported.
export {
  renderReceiptHtml,
  renderReceiptSubject,
} from "@paperwork/domain/business/payment-receipt/mod.ts";

/**
 * ConfirmPayment — contractor-side "I got it" coordinator.
 *
 * Wires up the closing half of the manual-payment loop:
 *   1. Take the customer's existing `paymentIntent` on the invoice.
 *   2. Mint a real `Payment` row (the canonical record-of-funds-received).
 *   3. Flip the invoice to `paid`, stamp `paidAt`, clear the intent.
 *   4-5. Send the receipt — SendPaymentReceipt (REQ-963): PDF, email to the
 *      customer + CC contractor, SMS with a short-link to the public invoice
 *      page, outbox + comms trail, receiptSentVia. REQ-1116: a claim that
 *      closes the bill sends no receipt EMAIL — the PAID invoice email
 *      (MarkInvoicePaid, with the receipt PDF) is the customer's one email.
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
    private markPaid: MarkInvoicePaid,
    private balance: ComputeInvoiceBalance,
    private logos: LoadBusinessLogo = new LoadBusinessLogo(),
  ) {
    // REQ-963: built from this coordinator's own collaborators, so a test
    // that swaps the email / SMS / PDF / log on them swaps the receipt's too.
    this.receipt = new SendPaymentReceipt(
      invoices,
      customers,
      users,
      identity,
      email,
      sms,
      shortlinks,
      receiptPdf,
      commsLog,
      logos,
    );
  }

  private receipt: SendPaymentReceipt;

  async run(
    userId: string,
    invoiceId: string,
    /** REQ-930: the reference the owner typed in the "Mark as paid" modal.
     *  When given it replaces the customer's claimed one (trimmed; empty =
     *  no reference). Omitted (voice, card) keeps the claim's. */
    opts: { reference?: string } = {},
  ): Promise<{ ok: boolean; reason?: string; paymentId?: string }> {
    const invoice = await this.invoices.getOwned(invoiceId, userId);
    if (invoice.status === "paid") {
      return { ok: true, reason: "already_paid" };
    }
    const claim = invoice.paymentIntent;
    if (!claim) {
      return { ok: false, reason: "no_payment_intent" };
    }
    const intent = withOwnerReference(claim, opts.reference);

    // 1. Mint the Payment row.
    const payment = await this.payments.create(userId, {
      invoiceId: invoice.id,
      amount: intent.amount,
      method: mapMethod(intent.method),
      receivedAt: new Date().toISOString(),
      ...(intent.reference ? { reference: intent.reference } : {}),
    });

    // 2. REQ-202: one bill, one balance. The ledger decides whether this
    // payment closes the invoice (status paid; the balance coordinator sends
    // the invoice stamped PAID, REQ-020) or leaves a balance (a partial
    // payment: the invoice reopens for the rest). The claim is consumed
    // either way.
    // REQ-1116 (LOOP-007 q3-40): a claim that closes the bill gets ONE
    // customer email — the PAID invoice, carrying the receipt PDF (REQ-941;
    // MarkInvoicePaid records receiptSentVia "email") — exactly like a
    // closing payment recorded by hand (PaymentController.create).
    const ledger = await this.balance.run(invoice.id, userId);
    const paidAt = new Date().toISOString();
    await this.invoices.update(invoice.id, userId, { paymentIntent: null });

    // 3. REQ-963: the receipt — PDF, email cc'd to the contractor, text,
    // outbox + comms trail, receiptSentVia — the same one the Record payment
    // dialog sends for a part payment (SendPaymentReceipt). Best-effort.
    // REQ-1116: when the claim closed the bill its email is NOT sent — the
    // PAID invoice email above already carries the receipt PDF; the text
    // still goes.
    const { customerName } = await this.receipt.run(userId, invoice.id, {
      amount: intent.amount,
      method: intent.method,
      ...(intent.reference ? { reference: intent.reference } : {}),
      receivedAt: paidAt,
    }, { email: ledger.status !== "paid" });

    // 4. Emit event for activity feed + dashboard counters.
    try {
      await this.bus.emit({
        userId,
        entityType: "invoice",
        entityId: invoice.id,
        action: "paid",
        data: {
          // REQ-224 (demo M36): integer cents, named as such — the notifier
          // formats the money per viewer. Never the bare number as `amount`.
          amountCents: intent.amount,
          method: intent.method,
          ...(customerName ? { customerName } : {}),
          ...(intent.reference ? { reference: intent.reference } : {}),
        },
      });
    } catch (err) {
      console.error("[confirm-payment] event emit failed:", err);
    }

    return { ok: true, paymentId: payment.id };
  }
}

/** REQ-930: the claim with the owner's entered reference in place of the
 *  customer's — trimmed, and dropped when empty. `undefined` keeps it. */
export function withOwnerReference<T extends { reference?: string }>(
  claim: T,
  reference: string | undefined,
): T {
  if (reference === undefined) return claim;
  const { reference: _claimed, ...rest } = claim;
  const ref = reference.trim();
  return (ref ? { ...rest, reference: ref } : rest) as T;
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
