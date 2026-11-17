/**
 * REQ-551 (demo-loop cycle 4, issue B2) — how much may be recorded against an
 * invoice in one payment. One rule for the "Payment received" form and for
 * POST /payments:
 *
 *  - up to the balance still owed → fine
 *  - above the balance → an overpayment: the contractor confirms it ("record
 *    anyway?"), the API wants `override: true` (REQ-202 then flags it)
 *  - above 10x the invoice → refused outright; that is a typo, not a payment.
 *    The limit is 10x the invoice TOTAL, not the balance, so a $1 balance
 *    left on a $1,000 job never makes a $20 payment unrecordable.
 *
 * All amounts are INTEGER CENTS.
 */
export const OVERPAYMENT_HARD_MULTIPLE = 10;

export type OverpaymentCheck =
  | { kind: "ok"; balanceCents: number }
  | { kind: "over"; balanceCents: number; overCents: number }
  | { kind: "refuse"; balanceCents: number; limitCents: number };

export function overpaymentCheck(
  { paymentCents, amountCents, paidCents }: {
    paymentCents: number;
    amountCents: number | null | undefined;
    paidCents: number | null | undefined;
  },
): OverpaymentCheck {
  const amount = Math.max(0, Math.round(amountCents ?? 0));
  const paid = Math.max(0, Math.round(paidCents ?? 0));
  const balanceCents = Math.max(0, amount - paid);
  const limitCents = amount * OVERPAYMENT_HARD_MULTIPLE;
  if (paymentCents > limitCents) {
    return { kind: "refuse", balanceCents, limitCents };
  }
  if (paymentCents > balanceCents) {
    return {
      kind: "over",
      balanceCents,
      overCents: paymentCents - balanceCents,
    };
  }
  return { kind: "ok", balanceCents };
}
