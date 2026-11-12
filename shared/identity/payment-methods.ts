/**
 * REQ-620 (demo-loop cycle 4, p4-p6b) — the one catalogue of payment methods
 * a contractor can accept. The onboarding wizard's payment step and Settings'
 * Payments card both render it, so a method has the same id, the same place
 * in the list and the same label (`paymentMethod.*`) everywhere. Both write
 * `identity.acceptedPaymentMethods[id]` (backend/src/paperwork/dto/payment.ts).
 */

export type PaymentMethodId =
  | "venmo"
  | "cashapp"
  | "zelle"
  | "paypal"
  | "check"
  | "ach"
  | "card"
  | "cash";

/** The backend field that stores a method's handle. */
export type PaymentHandleField =
  | "handle"
  | "cashtag"
  | "mailTo"
  | "instructions";

export interface PaymentMethodDef {
  id: PaymentMethodId;
  /** i18n key of the method's name. */
  labelKey: `paymentMethod.${string}`;
  /** Where the handle lives; null → no handle (cash). */
  handleField: PaymentHandleField | null;
  /** i18n key of the handle input's placeholder ("" when no handle). */
  placeholderKey: string;
  /** Money-routing handles (Venmo/Zelle/…) are required once the method is
   *  on — a typo sends funds to the wrong place. A check's mailing address and
   *  the ACH / card notes are optional (the invoice already carries the
   *  contractor's address and contact). */
  optional: boolean;
}

/** Display order is the array order. */
export const PAYMENT_METHOD_CATALOG: readonly PaymentMethodDef[] = [
  {
    id: "venmo",
    labelKey: "paymentMethod.venmo",
    handleField: "handle",
    placeholderKey: "settings.pay.venmoPh",
    optional: false,
  },
  {
    id: "cashapp",
    labelKey: "paymentMethod.cashApp",
    handleField: "cashtag",
    placeholderKey: "settings.pay.cashappPh",
    optional: false,
  },
  {
    id: "zelle",
    labelKey: "paymentMethod.zelle",
    handleField: "handle",
    placeholderKey: "settings.pay.zellePh",
    optional: false,
  },
  {
    id: "paypal",
    labelKey: "paymentMethod.paypal",
    handleField: "handle",
    placeholderKey: "settings.pay.paypalPh",
    optional: false,
  },
  {
    id: "check",
    labelKey: "paymentMethod.check",
    handleField: "mailTo",
    placeholderKey: "settings.pay.checkPh",
    optional: true,
  },
  {
    id: "ach",
    labelKey: "paymentMethod.ach",
    handleField: "instructions",
    placeholderKey: "settings.pay.achPh",
    optional: true,
  },
  {
    id: "card",
    labelKey: "paymentMethod.card",
    handleField: "instructions",
    placeholderKey: "settings.pay.cardPh",
    optional: true,
  },
  {
    id: "cash",
    labelKey: "paymentMethod.cash",
    handleField: null,
    placeholderKey: "",
    optional: true,
  },
];

export function paymentMethodIds(): PaymentMethodId[] {
  return PAYMENT_METHOD_CATALOG.map((m) => m.id);
}
