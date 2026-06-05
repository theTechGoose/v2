/**
 * SINGLE SOURCE OF TRUTH for splitting a contract total into payment
 * milestones (deposit / progress / balance), in INTEGER CENTS.
 *
 * Imported by every surface that has to agree on the money:
 *   - the contractor's agreement preview  (front-end/islands/AsstChat.tsx)
 *   - the public contract the customer signs (front-end/components/contract-doc.tsx)
 *   - the contract PDF        (backend .../render-contract-pdf)
 *   - the generated invoices  (backend .../send-signed-confirmation)
 *
 * These used to each compute the split independently and had drifted apart
 * (the preview billed a 25% deposit while the contract/PDF/invoice used 20%;
 * custom terms showed no schedule yet still invoiced a 30% deposit). Routing
 * them all through this one function keeps the preview, the signed document,
 * and the actual bill identical.
 *
 * Kept dependency-free so the Deno backend can import it across the workspace
 * (aliased as `#payment-split` in backend/deno.json). Display labels and
 * localization stay with each consumer — only the MONEY lives here.
 */

export type MilestoneRole =
  | "deposit"
  | "midpoint"
  | "milestone"
  | "completion"
  | "full";

export interface PaymentSplitPart {
  role: MilestoneRole;
  /** Percent of the total this milestone represents (0–100). */
  pct: number;
  /** Amount in INTEGER CENTS. The parts always sum to exactly `totalCents`. */
  amountCents: number;
}

/**
 * Resolve a payment-terms label (wizard option text like "50 / 50",
 * "30 / 30 / 40", "Net 15 — full", "Deposit + balance", or free-text) into
 * one part per milestone. Returns `[]` only for a non-positive total.
 *
 * Rounding: each part rounds to whole cents; the LAST part absorbs the
 * remainder so the sum equals `totalCents` exactly.
 */
export function computePaymentSplit(
  termValue: string | null | undefined,
  totalCents: number,
): PaymentSplitPart[] {
  const v = (termValue ?? "").trim().toLowerCase();
  if (!v || !Number.isFinite(totalCents) || totalCents <= 0) return [];

  // 1. Explicit percentage split: "30 / 30 / 40", "50/50", "25, 25, 50".
  const numbers = v
    .split(/[\/,]+/)
    .map((s) => parseFloat(s.trim()))
    .filter((n) => Number.isFinite(n));
  if (numbers.length >= 2 && Math.abs(numbers.reduce((a, b) => a + b, 0) - 100) <= 1) {
    const parts: PaymentSplitPart[] = numbers.map((pct, i) => ({
      role: roleForIndex(i, numbers.length),
      pct,
      amountCents: Math.round((totalCents * pct) / 100),
    }));
    const drift = totalCents - parts.reduce((s, p) => s + p.amountCents, 0);
    if (drift !== 0) parts[parts.length - 1].amountCents += drift;
    return parts;
  }

  // 2. "Net X" — a single payment due X days after completion.
  if (/net\s*\d+/.test(v)) {
    return [{ role: "full", pct: 100, amountCents: totalCents }];
  }

  // 3. "Deposit + balance" — 20% upfront, the rest on completion.
  if (v.includes("deposit") && v.includes("balance")) {
    const deposit = Math.round(totalCents * 0.20);
    return [
      { role: "deposit", pct: 20, amountCents: deposit },
      { role: "completion", pct: 80, amountCents: totalCents - deposit },
    ];
  }

  // 4. "Upon completion" / unrecognized custom terms — bill the full amount
  //    ONCE. (Previously the invoice generator invented a 30% deposit here
  //    that no document ever showed.) A single payment is the only safe read
  //    when we can't parse the split.
  return [{ role: "full", pct: 100, amountCents: totalCents }];
}

function roleForIndex(i: number, len: number): MilestoneRole {
  if (i === 0) return "deposit";
  if (i === len - 1) return "completion";
  if (len === 3 && i === 1) return "midpoint";
  return "milestone";
}
