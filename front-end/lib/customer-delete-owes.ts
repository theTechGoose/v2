/**
 * REQ-1138 (LOOP-007 q3, q3-69) — deleting a customer who still owes money.
 *
 * DELETE /customers/:id answers 409 `{code:"customer_owes", owedCents, invoices}` while the customer
 * has an open receivable (REQ-397 rule) unless `?force=1`. The delete question then names the
 * balance ("Lucía still owes $820.67 on INV-001 …") and its confirm is "Delete anyway", which sends
 * force=1. The customer page already holds her invoice rows (balanceCents > 0 only while open, the
 * same rule), so it can ask with the balance up front; the board and the sheet learn it from the 409.
 */
import { fmtMoneyTotal } from "./format.ts";

export interface DeleteOwes {
  owedCents: number;
  /** the invoice numbers carrying it */
  invoices: string[];
}

/** what she owes, from the workspace's invoice rows; null when nothing is open */
export function owesFromInvoices(
  rows: ReadonlyArray<{ number: string; balanceCents: number }>,
): DeleteOwes | null {
  const open = rows.filter((r) => r.balanceCents > 0);
  const owedCents = open.reduce((s, r) => s + r.balanceCents, 0);
  return owedCents > 0
    ? { owedCents, invoices: open.map((r) => r.number) }
    : null;
}

/** the 409 customer_owes answer (an ApiError carrying the body), else null */
export function owesFromError(err: unknown): DeleteOwes | null {
  const e = err as { status?: number; body?: unknown } | null;
  if (!e || e.status !== 409) return null;
  const b = e.body as
    | { code?: string; owedCents?: unknown; invoices?: unknown }
    | null;
  if (!b || b.code !== "customer_owes") return null;
  const owedCents = Number(b.owedCents);
  if (!Number.isFinite(owedCents) || owedCents <= 0) return null;
  const invoices = Array.isArray(b.invoices)
    ? b.invoices.filter((n): n is string => typeof n === "string")
    : [];
  return { owedCents, invoices };
}

/** the placeholders of `clientsBoard.panel.deleteAskOwes` — the amount on REQ-961's cents rule */
export function owesAskVars(
  name: string,
  owes: DeleteOwes,
): { name: string; amount: string; invoices: string } {
  return {
    name,
    amount: fmtMoneyTotal(owes.owedCents),
    invoices: owes.invoices.join(", "),
  };
}
