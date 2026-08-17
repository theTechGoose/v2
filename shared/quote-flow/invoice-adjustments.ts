/**
 * Invoice adjustments (raw-plan p6 + p18): a DISCOUNT or a CHANGE ORDER.
 * A change order gets its own approval page (/co/<id>) and never applies
 * until the customer approves it. All operations are immutable — new
 * objects, never edits (project convention).
 *
 * Vocabulary matches the shipped DTOs: invoice money is `amount` (integer
 * cents), discounts are `discountCents` (clamped at zero), change orders are
 * { description, deltaAmountCents }.
 */

export interface InvoiceLike {
  id: string;
  amount: number;
  lineItems?: unknown[];
  [key: string]: unknown;
}

export interface ChangeOrder {
  id: string;
  invoiceId: string;
  description: string;
  deltaAmountCents: number;
  status: "pending" | "approved" | "declined";
  approvalPath: string;
}

export function applyDiscount(
  invoice: InvoiceLike,
  { discountCents, reason }: { discountCents: number; reason?: string },
): InvoiceLike & { discountCents: number; discountReason?: string } {
  if (!Number.isInteger(discountCents) || discountCents <= 0) {
    throw new Error("discountCents must be a positive integer");
  }
  return {
    ...invoice,
    lineItems: invoice.lineItems ? [...invoice.lineItems] : invoice.lineItems,
    amount: Math.max(0, invoice.amount - discountCents),
    discountCents,
    ...(reason !== undefined ? { discountReason: reason } : {}),
  };
}

export function createChangeOrder(
  invoice: InvoiceLike,
  { description, deltaAmountCents }: { description: string; deltaAmountCents: number },
): ChangeOrder {
  const id = crypto.randomUUID();
  return {
    id,
    invoiceId: invoice.id,
    description,
    deltaAmountCents,
    status: "pending",
    approvalPath: `/co/${id}`,
  };
}

export function applyChangeOrder(invoice: InvoiceLike, co: ChangeOrder): InvoiceLike {
  if (co.status !== "approved") {
    throw new Error(`change order ${co.id} is ${co.status}, not approved`);
  }
  return { ...invoice, amount: invoice.amount + co.deltaAmountCents };
}
