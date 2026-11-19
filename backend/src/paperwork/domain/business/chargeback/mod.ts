/**
 * REQ-926 — a chargeback's fee on the reopened invoice. Pure.
 *
 * The fee is its own line, flagged with the payment it came from
 * (`chargebackFor`), untaxed: subtotal (when the invoice keeps one) and
 * amount rise by the fee, tax stays as it was. An amount-only invoice first
 * gets its amount as one line, so the bill still itemizes what it charges.
 *
 * REQ-1124 (q3-52, AMENDMENT of REQ-926): that made-up base line is tagged
 * as the chargeback's own (`chargebackBase`), and with no job name or
 * description it reads an honest "Invoice amount" in the invoice's language
 * (never a made-up English "Services" that then headed /i, REQ-984). Undo of
 * the last fee takes it off too, so the invoice is amount-only again.
 */

export const CHARGEBACK_FEE_LABEL = {
  en: "Chargeback fee",
  es: "Cargo por contracargo",
} as const;

/** REQ-1124: the base line an amount-only invoice gets, when it has no name */
export const CHARGEBACK_BASE_LABEL = {
  en: "Invoice amount",
  es: "Importe de la factura",
} as const;

export interface FeeLine {
  description: string;
  quantity: number;
  unit: string;
  price: number;
  chargebackFor?: string;
  /** REQ-1124: the amount-only invoice's base line a chargeback made up */
  chargebackBase?: string;
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
  const es = inv.lang === "es";
  const base: FeeLine[] = inv.lineItems?.length
    ? [...inv.lineItems]
    : [baseLine(inv, paymentId, es, amount)];
  const label = es ? CHARGEBACK_FEE_LABEL.es : CHARGEBACK_FEE_LABEL.en;
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

/** REQ-1124: an amount-only invoice's amount as one line, tagged. */
function baseLine(
  inv: FeeInvoice,
  paymentId: string,
  es: boolean,
  amount: number,
): FeeLine {
  const named = inv.jobName?.trim() || inv.description?.trim();
  return {
    // named → what was typed; else "Invoice amount" in the invoice's language,
    // with both texts so /i?lang= shows its own (REQ-710 base-slot rule)
    ...(named ? { description: named } : {
      description: es ? CHARGEBACK_BASE_LABEL.es : CHARGEBACK_BASE_LABEL.en,
      ...(inv.lang ? { descriptionByLang: { ...CHARGEBACK_BASE_LABEL } } : {}),
    }),
    quantity: 1,
    unit: "ea",
    price: typeof inv.subtotalCents === "number" ? inv.subtotalCents : amount,
    chargebackBase: paymentId,
  };
}

/**
 * Undo: that payment's fee line off again; null when it has none. When no
 * other chargeback fee is left, the base line a chargeback made up
 * (`chargebackBase`, REQ-1124) comes off too — the invoice is amount-only.
 */
export function withoutChargebackFee(
  inv: FeeInvoice,
  paymentId: string,
): FeePatch | null {
  const lines = inv.lineItems ?? [];
  const fee = lines.find((l) => l.chargebackFor === paymentId);
  if (!fee) return null;
  const cents = Math.round((fee.price ?? 0) * (fee.quantity ?? 1));
  const rest = lines.filter((l) => l !== fee);
  const feesLeft = rest.some((l) => l.chargebackFor !== undefined);
  return {
    lineItems: feesLeft
      ? rest
      : rest.filter((l) => l.chargebackBase === undefined),
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
