/**
 * REQ-213 — a succeeded Stripe charge becomes a payment the same way the contractor's "I got
 * it" does: the intent is written on the invoice as a card claim (the PaymentIntent id as its
 * reference) and ConfirmPayment mints the Payment row, settles the balance (the PAID stamp,
 * REQ-202), clears the claim and sends the receipt. Idempotent on the intent id: the same
 * charge recorded twice (the charge reply and the 3-D Secure completion, a retry) is one row.
 */
import { Injectable } from "#danet/core";
import { InvoiceStore } from "@paperwork/domain/data/invoice-store/mod.ts";
import { PaymentStore } from "@paperwork/domain/data/payment-store/mod.ts";
import { ConfirmPayment } from "@paperwork/domain/coordinators/confirm-payment/mod.ts";
import { invoiceBalance } from "#documents/versions.ts";

export interface CardCharge {
  /** the Stripe PaymentIntent id — the payment's reference */
  id: string;
  /** INTEGER CENTS */
  amount: number;
  payerName?: string;
}

@Injectable()
export class RecordCardPayment {
  constructor(
    private invoices: InvoiceStore,
    private payments: PaymentStore,
    private confirm: ConfirmPayment,
  ) {}

  async run(
    userId: string,
    invoiceId: string,
    charge: CardCharge,
  ): Promise<{ recorded: boolean; paymentId?: string; balanceCents: number }> {
    const rows = await this.payments.listByInvoice(invoiceId, userId).catch(
      () => [],
    );
    const existing = rows.find((p) => p.reference === charge.id);
    if (existing) {
      return {
        recorded: false,
        paymentId: existing.id,
        balanceCents: await this.balanceOf(invoiceId, userId),
      };
    }
    const invoice = await this.invoices.getOwned(invoiceId, userId);
    if (invoice.status === "paid") {
      return { recorded: false, balanceCents: 0 };
    }
    await this.invoices.update(invoiceId, userId, {
      paymentIntent: {
        method: "card",
        amount: Math.round(charge.amount),
        reference: charge.id,
        claimedAt: new Date().toISOString(),
        ...(charge.payerName?.trim()
          ? { claimedBy: charge.payerName.trim() }
          : {}),
      },
    });
    const r = await this.confirm.run(userId, invoiceId);
    return {
      recorded: r.ok && !r.reason,
      ...(r.paymentId ? { paymentId: r.paymentId } : {}),
      balanceCents: await this.balanceOf(invoiceId, userId),
    };
  }

  private async balanceOf(invoiceId: string, userId: string): Promise<number> {
    const invoice = await this.invoices.getOwned(invoiceId, userId);
    const paid = typeof invoice.paidCents === "number"
      ? invoice.paidCents
      : (await this.payments.listByInvoice(invoiceId, userId).catch(() => []))
        .reduce((s, p) => s + (p.amount ?? 0), 0);
    return invoiceBalance(invoice.amount, paid).balanceCents;
  }
}
