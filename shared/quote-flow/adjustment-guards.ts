/**
 * Invoice-adjustment integrity guards (problems.md P-41).
 *
 * - An invoice carrying an UNCONFIRMED payment claim must never be adjusted
 *   silently: the caller gets an explicit warning to acknowledge (the claim's
 *   amount was made against the old total).
 * - A change order the customer already APPROVED is immutable — no Edit,
 *   no Delete. Pending (and declined-for-revision) orders stay editable.
 */

export interface PaymentClaim {
  status?: string;
  confirmedAt?: string | null;
  amount?: number;
  claimedAt?: string;
  [key: string]: unknown;
}

export interface AdjustDecision {
  allowed: boolean;
  requiresWarning?: boolean;
  reason?: string;
}

/** Claim states that are settled — no longer awaiting confirmation. */
const SETTLED_CLAIM_STATUSES = new Set([
  "confirmed",
  "rejected",
  "declined",
  "canceled",
  "cancelled",
  "withdrawn",
]);

function isUnconfirmed(claim: PaymentClaim): boolean {
  if (claim.confirmedAt) return false;
  return !SETTLED_CLAIM_STATUSES.has(claim.status ?? "");
}

/**
 * May this invoice be adjusted (discount / change order) right now?
 * A pending (unconfirmed) payment claim demands an explicit warning
 * acknowledgement — never a silent `{ allowed: true }`.
 */
export function canAdjustInvoice(input: {
  claims?: PaymentClaim[];
  paymentIntent?: PaymentClaim | null;
}): AdjustDecision {
  const claims = [...(input.claims ?? [])];
  if (input.paymentIntent) claims.push(input.paymentIntent);

  const pending = claims.some(isUnconfirmed);
  if (pending) {
    return {
      allowed: true,
      requiresWarning: true,
      reason: "unconfirmed-payment-claim",
    };
  }
  return { allowed: true };
}

/** A change order is mutable only while it is not yet approved. */
export function isChangeOrderMutable(co: { status?: string }): boolean {
  return co.status !== "approved";
}
