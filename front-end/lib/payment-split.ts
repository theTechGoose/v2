/**
 * SINGLE SOURCE OF TRUTH for splitting an agreement total into payment
 * milestones (deposit / progress / balance), in INTEGER CENTS.
 *
 * Imported by every surface that has to agree on the money:
 *   - the contractor's agreement preview  (front-end/islands/AsstChat.tsx)
 *   - the public agreement the customer signs (front-end/components/quote-doc.tsx)
 *   - the agreement PDF       (backend .../render-quote-pdf)
 *   - the generated invoices  (backend .../send-signed-confirmation)
 *
 * These used to each compute the split independently and had drifted apart
 * (the preview billed a 25% deposit while the agreement/PDF/invoice used 20%;
 * custom terms showed no schedule yet still invoiced a 30% deposit). Routing
 * them all through this one function keeps the preview, the signed document,
 * and the actual bill identical.
 *
 * Kept dependency-free so the Deno backend can import it across the workspace
 * (aliased as `#payment-split` in backend/deno.json). Display labels and
 * localization stay with each consumer — only the MONEY lives here.
 */
import { parseRecurringTerm } from "../../shared/quote-flow/recurring-billing.ts";

import { parseDepositTerm } from "../../shared/quote-flow/deposit-term.ts"; // REQ-678

export type MilestoneRole =
  | "deposit"
  | "midpoint"
  | "milestone"
  | "completion"
  | "full";

/** REQ-491 (demo m60): the share a plain "Deposit + balance" bills upfront.
 *  The wizard option's sub-line names it, so it is never a silent number.
 *  REQ-678: the wizard now asks the amount (shared/quote-flow/deposit-term). */
export const DEPOSIT_BALANCE_PCT = 20;

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

  // 0. REQ-699 (demo-loop cycle 5, M20): a recurring term ("Every 2 weeks ·
  //    $1,098/2 wks") is no split — its "1,098/2" read as 98 / 2. Its periods
  //    are billed by the Field subscription the signature makes; as a split
  //    it is the one full amount.
  if (parseRecurringTerm(termValue)) {
    return [{ role: "full", pct: 100, amountCents: totalCents }];
  }

  // REQ-678: an amount-carrying deposit term is read before the ratio parse,
  // so "$1,050,050" can never be mistaken for a "50, 50" split.
  const picked = parseDepositTerm(v);

  // 1. Explicit percentage split: "30 / 30 / 40", "50/50", "25, 25, 50".
  const numbers = picked ? [] : v
    .split(/[\/,]+/)
    .map((s) => parseFloat(s.trim()))
    .filter((n) => Number.isFinite(n));
  if (
    numbers.length >= 2 &&
    Math.abs(numbers.reduce((a, b) => a + b, 0) - 100) <= 1
  ) {
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

  // 3. "Deposit + balance" — the picked deposit upfront, the rest on
  //    completion. REQ-678 (c3-m60): the wizard stores the amount the
  //    contractor picked — "Deposit 30% + balance" or "Deposit $500 +
  //    balance"; a plain "Deposit + balance" (older quotes) is
  //    DEPOSIT_BALANCE_PCT.
  if (v.includes("deposit") && v.includes("balance")) {
    let deposit: number;
    let pct: number;
    if (picked && "cents" in picked) {
      deposit = Math.min(picked.cents, totalCents);
      pct = (deposit / totalCents) * 100;
    } else {
      pct = picked?.pct ?? DEPOSIT_BALANCE_PCT;
      deposit = Math.round((totalCents * pct) / 100);
    }
    // A dollar deposit that covers the whole job is one upfront payment.
    if (deposit >= totalCents) {
      return [{ role: "deposit", pct: 100, amountCents: totalCents }];
    }
    return [
      { role: "deposit", pct, amountCents: deposit },
      {
        role: "completion",
        pct: 100 - pct,
        amountCents: totalCents - deposit,
      },
    ];
  }

  // 4. "Upon completion" / unrecognized custom terms — bill the full amount
  //    ONCE. (Previously the invoice generator invented a 30% deposit here
  //    that no document ever showed.) A single payment is the only safe read
  //    when we can't parse the split.
  return [{ role: "full", pct: 100, amountCents: totalCents }];
}

/**
 * REQ-491 (demo-loop cycle 3, m60): the i18n vars for the "Deposit + balance"
 * option's sub-line — `{pct}` always, and `{deposit}` / `{balance}` (whole
 * dollars, the split computePaymentSplit bills) only for a positive total,
 * so the contractor sees "20% upfront, rest when done · $90 / $360" before
 * picking it. The wizard emitter (backend localizeOptions) and the
 * assistant's fallback picker both read it.
 */
export function depositBalanceSubVars(
  totalCents: number | null | undefined,
): { pct: number; deposit?: string; balance?: string } {
  const parts = typeof totalCents === "number"
    ? computePaymentSplit("Deposit + balance", totalCents)
    : [];
  if (parts.length !== 2) return { pct: DEPOSIT_BALANCE_PCT };
  const usd = (c: number) => `$${Math.round(c / 100).toLocaleString("en-US")}`;
  return {
    pct: DEPOSIT_BALANCE_PCT,
    deposit: usd(parts[0].amountCents),
    balance: usd(parts[1].amountCents),
  };
}

function roleForIndex(i: number, len: number): MilestoneRole {
  if (i === 0) return "deposit";
  if (i === len - 1) return "completion";
  if (len === 3 && i === 1) return "midpoint";
  return "milestone";
}
