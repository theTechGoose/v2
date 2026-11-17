/**
 * REQ-803 — the Square checkouts a customer started on an invoice: the payment link Square made
 * on the business's token for the invoice's balance at that version, and the order behind it.
 * A pending one is read back (GET /v2/orders/{id}) when the customer returns and whenever the
 * public invoice loads, until it is paid (recorded) or the invoice is settled. User-owned:
 * every record carries the business's userId. Keyed by invoice, then link.
 */
import { Injectable } from "#danet/core";
import { getKv } from "@core/data/kv/mod.ts";

const PREFIX = "square_checkout";

export interface SquareCheckout {
  userId: string;
  invoiceId: string;
  /** the invoice's version when the checkout was made */
  version: number;
  /** INTEGER CENTS — the balance the link charges */
  amountCents: number;
  paymentLinkId: string;
  orderId: string;
  url: string;
  /** the address Square sends the customer back to */
  redirectUrl: string;
  status: "pending" | "paid" | "closed";
  /** the Square payment id, once paid (the Payment's reference) */
  paymentId?: string;
  createdAt: string;
  /** the last time the order was read back */
  checkedAt?: string;
}

@Injectable()
export class SquareCheckoutStore {
  async put(c: SquareCheckout): Promise<SquareCheckout> {
    const kv = await getKv();
    await kv.set([PREFIX, c.invoiceId, c.paymentLinkId], c);
    return c;
  }

  async listByInvoice(invoiceId: string): Promise<SquareCheckout[]> {
    const kv = await getKv();
    const out: SquareCheckout[] = [];
    for await (
      const e of kv.list<SquareCheckout>({ prefix: [PREFIX, invoiceId] })
    ) {
      out.push(e.value);
    }
    return out.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }
}
