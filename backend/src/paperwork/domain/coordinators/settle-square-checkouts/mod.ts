/**
 * REQ-803 — no webhook (like Stripe, REQ-213): a Square checkout the customer started on an
 * invoice is settled by READING its order back on the business's own token — when the customer
 * returns from Square (`?square=return`, forced) and whenever the public invoice loads while a
 * checkout is pending (at most once per CHECK_EVERY_MS per checkout, so the page's own polling
 * does not hammer Square). A paid order is recorded through RecordCardPayment — the SAME path a
 * Stripe charge takes: method card, the Square payment id as the reference, idempotent on it
 * (the same payment never records twice), the balance, the PAID stamp, the receipt. An unpaid
 * order records nothing and stays pending. A Square error never breaks the invoice page.
 */
import { Injectable } from "#danet/core";
import { squareOrderPayment } from "#payments/square.ts";
import { ConnectSquare } from "@users/domain/coordinators/connect-square/mod.ts";
import { SquareGateway } from "@core/data/square-gateway/mod.ts";
import {
  type SquareCheckout,
  SquareCheckoutStore,
} from "@paperwork/domain/data/square-checkout-store/mod.ts";
import { RecordCardPayment } from "@paperwork/domain/coordinators/record-card-payment/mod.ts";

/** how often a page load may re-read a pending checkout's order (a return always does) */
export const CHECK_EVERY_MS = 10_000;

@Injectable()
export class SettleSquareCheckouts {
  constructor(
    private checkouts: SquareCheckoutStore,
    private square: ConnectSquare,
    private gateway: SquareGateway,
    private cardPayment: RecordCardPayment,
  ) {}

  /** Read back the invoice's pending checkouts; returns how many payments were recorded. */
  async run(
    invoice: { id: string; userId: string; status?: string },
    opts: { force?: boolean; now?: Date } = {},
  ): Promise<number> {
    const now = opts.now ?? new Date();
    const pending = (await this.checkouts.listByInvoice(invoice.id).catch(
      () => [] as SquareCheckout[],
    )).filter((c) => c.status === "pending" && c.userId === invoice.userId);
    if (!pending.length) return 0;
    const due = pending.filter((c) =>
      opts.force || !c.checkedAt ||
      now.getTime() - Date.parse(c.checkedAt) >= CHECK_EVERY_MS
    );
    if (!due.length) return 0;
    const conn = await this.square.tokenFor(invoice.userId).catch(() => null);
    if (!conn) return 0;
    let recorded = 0;
    for (const c of due) {
      try {
        const order = await this.gateway.retrieveOrder(
          conn.token,
          conn.environment,
          c.orderId,
        );
        const pay = squareOrderPayment(order);
        if (pay.paid) {
          const rec = await this.cardPayment.run(c.userId, c.invoiceId, {
            id: pay.paymentId,
            amount: pay.amountCents || c.amountCents,
          });
          if (rec.recorded) recorded++;
          await this.checkouts.put({
            ...c,
            status: "paid",
            paymentId: pay.paymentId,
            checkedAt: now.toISOString(),
          });
        } else if (pay.reason === "canceled") {
          await this.checkouts.put({
            ...c,
            status: "closed",
            checkedAt: now.toISOString(),
          });
        } else {
          await this.checkouts.put({ ...c, checkedAt: now.toISOString() });
        }
      } catch (e) {
        console.error(
          `[square] reading order ${c.orderId} for invoice ${c.invoiceId} failed:`,
          e instanceof Error ? e.message : e,
        );
        await this.checkouts.put({ ...c, checkedAt: now.toISOString() })
          .catch(() => {});
      }
    }
    return recorded;
  }
}
