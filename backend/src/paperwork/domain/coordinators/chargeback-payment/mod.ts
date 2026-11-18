/**
 * REQ-926 — charge a payment back (and undo it).
 *
 * The payment is KEPT, stamped `reversedAt` (+ reason, + fee); the store's
 * money reads skip it, so ComputeInvoiceBalance reopens the same invoice on
 * its own number and link. A fee > 0 joins that invoice as its own line
 * (business/chargeback) — on the live invoice, and on a pending revision
 * too so publishing it keeps the fee. Silent toward the customer.
 */
import { Injectable } from "#danet/core";
import { PaymentStore } from "@paperwork/domain/data/payment-store/mod.ts";
import { InvoiceStore } from "@paperwork/domain/data/invoice-store/mod.ts";
import { ComputeInvoiceBalance } from "@paperwork/domain/coordinators/compute-invoice-balance/mod.ts";
import {
  type FeeInvoice,
  withChargebackFee,
  withoutChargebackFee,
} from "@paperwork/domain/business/chargeback/mod.ts";
import type { Payment } from "@paperwork/dto/payment.ts";
import type { UpdateInvoiceDto } from "@paperwork/dto/invoice.ts";

export type ChargebackOutcome =
  | { ok: true; payment: Payment }
  | { ok: false; reason: "already_reversed" | "not_reversed" };

@Injectable()
export class ChargebackPayment {
  constructor(
    private payments: PaymentStore,
    private invoices: InvoiceStore,
    private balances: ComputeInvoiceBalance,
  ) {}

  async charge(
    id: string,
    userId: string,
    opts: { feeCents: number; reason?: string },
  ): Promise<ChargebackOutcome> {
    const p = await this.payments.getOwned(id, userId);
    if (p.reversedAt) return { ok: false, reason: "already_reversed" };
    const payment = await this.payments.setReversal(id, userId, opts);
    if (opts.feeCents > 0) {
      await this.applyFee(
        p.invoiceId,
        userId,
        (inv) => withChargebackFee(inv, id, opts.feeCents),
      );
    }
    await this.balances.run(p.invoiceId, userId);
    return { ok: true, payment };
  }

  async undo(id: string, userId: string): Promise<ChargebackOutcome> {
    const p = await this.payments.getOwned(id, userId);
    if (!p.reversedAt) return { ok: false, reason: "not_reversed" };
    await this.applyFee(
      p.invoiceId,
      userId,
      (inv) => withoutChargebackFee(inv, id),
    );
    const payment = await this.payments.setReversal(id, userId, null);
    await this.balances.run(p.invoiceId, userId);
    return { ok: true, payment };
  }

  private async applyFee(
    invoiceId: string,
    userId: string,
    change: (inv: FeeInvoice) => ReturnType<typeof withoutChargebackFee>,
  ): Promise<void> {
    const inv = await this.invoices.getOwned(invoiceId, userId);
    const live = change(inv as unknown as FeeInvoice);
    if (live) {
      await this.invoices.update(
        invoiceId,
        userId,
        live as unknown as UpdateInvoiceDto,
      );
    }
    const pending = inv.pendingRevision as Record<string, unknown> | undefined;
    if (pending && Object.keys(pending).length > 0) {
      const next = change({ ...inv, ...pending } as unknown as FeeInvoice);
      if (next) {
        await this.invoices.setPending(
          invoiceId,
          userId,
          next as unknown as Record<string, unknown>,
        );
      }
    }
  }
}
