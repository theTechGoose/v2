/**
 * Milestone reconciliation (UX-36) — signing the contract after the job was
 * already invoiced (and possibly paid) must never re-bill the customer. The
 * milestone plan is right; billing it twice is the bug: the sign coordinator
 * bills only the unbilled remainder computed here.
 *
 * All amounts are INTEGER CENTS. Pure logic, no side effects.
 */

export interface ExistingInvoiceLike {
  amount?: number;
  status?: string;
}

/** Statuses whose amount is NOT committed against the agreement. */
const FREED_STATUSES = new Set(["void", "canceled"]);

/**
 * Cents already committed against the agreement. Every invoice that is not
 * void/canceled counts (paid, claimed, sent, viewed, scheduled, draft — a
 * draft will be sent, so it blocks re-billing too).
 */
export function billedTotalCents(
  existing: readonly ExistingInvoiceLike[],
): number {
  let total = 0;
  for (const inv of existing) {
    if (FREED_STATUSES.has(inv.status ?? "")) continue;
    total += Math.round(inv.amount ?? 0);
  }
  return total;
}

/**
 * The amounts that may STILL be invoiced, in plan order:
 *   - nothing billed → the plan unchanged;
 *   - fully billed (billed ≥ total) → [] — NO new invoices;
 *   - partially billed → milestones consumed FROM THE FRONT; milestones
 *     reduced to 0 are dropped.
 * Invariant: sum(result) === max(0, agreementTotalCents - billedTotalCents).
 */
export function reconcileMilestones(
  plannedCents: readonly number[],
  agreementTotalCents: number,
  existing: readonly ExistingInvoiceLike[],
): number[] {
  let billed = billedTotalCents(existing);
  const remainder = Math.max(0, agreementTotalCents - billed);
  if (remainder === 0) return [];

  const out: number[] = [];
  for (const planned of plannedCents) {
    const consumed = Math.min(billed, planned);
    billed -= consumed;
    const left = planned - consumed;
    if (left > 0) out.push(left);
  }
  return out;
}
