/**
 * REQ-926 — a chargeback's fee on the reopened invoice. Pure.
 *
 * The fee is its own line, flagged with the payment it came from
 * (`chargebackFor`), untaxed: subtotal (when the invoice keeps one) and
 * amount rise by the fee, tax stays as it was. An amount-only invoice first
 * gets its amount as one line, so the bill still itemizes what it charges.
 */

export const CHARGEBACK_FEE_LABEL = {
  en: "Chargeback fee",
  es: "Cargo por contracargo",
} as const;

export interface FeeLine {
  description: string;
  quantity: number;
  unit: string;
  price: number;
  chargebackFor?: string;
  [k: string]: unknown;
}

export interface FeeInvoice {
  lineItems?: FeeLine[];
  subtotalCents?: number;
  taxCents?: number;
  amount?: number;
  lang?: string;
  jobName?: string;
  description?: string;
}

export interface FeePatch {
  lineItems: FeeLine[];
  amount: number;
  subtotalCents?: number;
}

export function withChargebackFee(
  inv: FeeInvoice,
  paymentId: string,
  feeCents: number,
): FeePatch {
  const amount = inv.amount ?? 0;
  const base: FeeLine[] = inv.lineItems?.length ? [...inv.lineItems] : [{
    description: inv.jobName?.trim() || inv.description?.trim() || "Services",
    quantity: 1,
    unit: "ea",
    price: typeof inv.subtotalCents === "number" ? inv.subtotalCents : amount,
  }];
  const label = inv.lang === "es"
    ? CHARGEBACK_FEE_LABEL.es
    : CHARGEBACK_FEE_LABEL.en;
  return {
    lineItems: [...base, {
      description: label,
      quantity: 1,
      unit: "ea",
      price: feeCents,
      chargebackFor: paymentId,
    }],
    amount: amount + feeCents,
    ...(typeof inv.subtotalCents === "number"
      ? { subtotalCents: inv.subtotalCents + feeCents }
      : {}),
  };
}

/** Undo: that payment's fee line off again; null when it has none. */
export function withoutChargebackFee(
  inv: FeeInvoice,
  paymentId: string,
): FeePatch | null {
  const lines = inv.lineItems ?? [];
  const fee = lines.find((l) => l.chargebackFor === paymentId);
  if (!fee) return null;
  const cents = Math.round((fee.price ?? 0) * (fee.quantity ?? 1));
  return {
    lineItems: lines.filter((l) => l !== fee),
    amount: (inv.amount ?? 0) - cents,
    ...(typeof inv.subtotalCents === "number"
      ? { subtotalCents: inv.subtotalCents - cents }
      : {}),
  };
}

/** a whole number of cents, 0 or more; undefined → 0 */
export function parseFeeCents(v: unknown): number | null {
  if (v === undefined || v === null || v === "") return 0;
  return typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : null;
}
