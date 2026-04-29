import { Injectable } from "#danet/core";
import { InvoiceStore } from "@paperwork/domain/data/invoice-store/mod.ts";
import { PaymentStore } from "@paperwork/domain/data/payment-store/mod.ts";
import { balanceDue } from "@paperwork/domain/business/invoice-balance/mod.ts";

export interface InvoiceBalanceResult {
  invoiceId: string;
  amount: number;
  paidTotal: number;
  balance: number;
  status: string;
}

/**
 * ComputeInvoiceBalance — single source of truth for an invoice's paid state.
 *
 * Sums all payments tied to the invoice and projects the lifecycle:
 *   - balance > 0 → status "pending", paidAt cleared
 *   - balance ≤ 0 → status "paid", paidAt = latest payment receivedAt
 *
 * Trigger after every payment create/update/delete so the invoice DTO stays
 * consistent with the payment ledger.
 */
@Injectable()
export class ComputeInvoiceBalance {
  constructor(
    private invoices: InvoiceStore,
    private payments: PaymentStore,
  ) {}

  async run(invoiceId: string, userId: string): Promise<InvoiceBalanceResult> {
    const invoice = await this.invoices.getOwned(invoiceId, userId);
    const payments = await this.payments.listByInvoice(invoiceId, userId);
    const paidTotal = payments.reduce((sum, p) => sum + (p.amount ?? 0), 0);
    const amount = invoice.amount ?? 0;
    const balance = balanceDue(invoice, paidTotal);
    const closed = balance <= 0 && amount > 0;
    const desiredStatus = closed ? "paid" : "pending";
    const desiredPaidAt = closed ? latestReceivedAt(payments) : undefined;

    const statusChanged = invoice.status !== desiredStatus;
    const paidAtChanged = (invoice.paidAt ?? undefined) !== desiredPaidAt;
    if (statusChanged || paidAtChanged) {
      await this.invoices.update(invoiceId, userId, {
        status: desiredStatus,
        paidAt: desiredPaidAt,
      });
    }

    return { invoiceId, amount, paidTotal, balance, status: desiredStatus };
  }
}

function latestReceivedAt(payments: { receivedAt: string }[]): string | undefined {
  if (payments.length === 0) return undefined;
  return payments.map((p) => p.receivedAt).sort().at(-1);
}
