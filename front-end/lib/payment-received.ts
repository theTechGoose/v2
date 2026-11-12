/**
 * REQ-322 (demo-loop cycle 1, m36) — the "Payment received" decision, pure.
 *
 * The form used to validate only the method and the amount, then build
 * `new Date(`${date}T12:00:00`).toISOString()` inside its try: with the
 * date cleared that threw a RangeError before any request left the browser,
 * and the blanket catch showed the generic "Couldn't record the payment."
 * Here the checks run in order — method, amount, date — each with its own
 * reason, and the instant is only built once the date is a real YYYY-MM-DD.
 */
import type { PaymentMethod } from "../clients/payments.ts";
import { ApiError } from "./api.ts";
import { fmtMoneyExact } from "./format.ts";
import { type Lang, tFor } from "./i18n.ts";
import {
  OVERPAYMENT_HARD_MULTIPLE,
  overpaymentCheck,
} from "../../shared/documents/overpayment.ts";

export type PaymentReceivedInput = {
  method: PaymentMethod | null;
  /** the amount field as typed, in dollars */
  dollars: string;
  /** the date field as typed, YYYY-MM-DD */
  date: string;
  /** REQ-551: the invoice total, INTEGER CENTS — with it the amount is
   *  checked against what is still owed. */
  amountCents?: number;
  /** REQ-551: what has already been received on the invoice, INTEGER CENTS. */
  paidCents?: number;
  /** REQ-551: the contractor said "record anyway" to the overpayment. */
  confirmedOver?: boolean;
};

export type PaymentReceivedResult =
  | {
    ok: false;
    errKey: string;
    vars?: Record<string, string | number>;
    /** REQ-551: set when the only problem is an amount above the balance —
     *  the form asks "record anyway?" instead of refusing. */
    confirmOver?: { overCents: number; balanceCents: number };
  }
  | {
    ok: true;
    method: PaymentMethod;
    /** INTEGER CENTS */
    cents: number;
    /** noon local on the picked day, so the date never shifts across a
     *  timezone boundary when the backend stores it as an instant */
    receivedAt: string;
    /** REQ-551: true when the contractor confirmed an overpayment; the
     *  request then carries `override: true`. */
    override?: true;
  };

/** REQ-551: "This is $35.00 more than the $65.00 owed. Record it anyway?" */
function confirmOverResult(
  overCents: number,
  balanceCents: number,
): PaymentReceivedResult {
  return {
    ok: false,
    errKey: "invoicesPage.pay.confirmOver",
    vars: {
      over: fmtMoneyExact(overCents),
      owed: fmtMoneyExact(balanceCents),
    },
    confirmOver: { overCents, balanceCents },
  };
}

/** REQ-551: "That's more than 10 times the $X invoice. Check the amount." */
function tooMuchResult(amountCents: number): PaymentReceivedResult {
  return {
    ok: false,
    errKey: "invoicesPage.pay.errTooMuch",
    vars: { n: OVERPAYMENT_HARD_MULTIPLE, total: fmtMoneyExact(amountCents) },
  };
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

export function validatePaymentReceived(
  { method, dollars, date, amountCents, paidCents, confirmedOver }:
    PaymentReceivedInput,
): PaymentReceivedResult {
  if (!method) return { ok: false, errKey: "invoicesPage.pay.errMethod" };
  const cents = Math.round(Number(dollars) * 100);
  if (dollars.trim() === "" || !Number.isFinite(cents) || cents <= 0) {
    return { ok: false, errKey: "invoicesPage.pay.errAmount" };
  }
  if (!ISO_DAY.test(date)) {
    return { ok: false, errKey: "invoicesPage.pay.errDate" };
  }
  const at = new Date(`${date}T12:00:00`);
  if (Number.isNaN(at.getTime())) {
    return { ok: false, errKey: "invoicesPage.pay.errDate" };
  }
  // REQ-551 (demo-loop cycle 4, B2): the same rule POST /payments applies —
  // above the balance asks first, above 10x the invoice is refused.
  let override: true | undefined;
  if (typeof amountCents === "number") {
    const check = overpaymentCheck({
      paymentCents: cents,
      amountCents,
      paidCents,
    });
    if (check.kind === "refuse") return tooMuchResult(amountCents);
    if (check.kind === "over") {
      if (!confirmedOver) {
        return confirmOverResult(check.overCents, check.balanceCents);
      }
      override = true;
    }
  }
  return {
    ok: true,
    method,
    cents,
    receivedAt: at.toISOString(),
    ...(override ? { override } : {}),
  };
}

/** REQ-551: the server's overpayment answer as the form's own words — a 409
 *  `overpayment` is the "record anyway?" question, a 422
 *  `overpayment_limit` the 10x refusal. Null for any other error. */
export function overpaymentFromError(
  e: unknown,
): PaymentReceivedResult | null {
  if (!(e instanceof ApiError) || !e.body || typeof e.body !== "object") {
    return null;
  }
  const b = e.body as Record<string, unknown>;
  const num = (v: unknown) => typeof v === "number" ? v : 0;
  if (b.error === "overpayment") {
    return confirmOverResult(num(b.overCents), num(b.balanceCents));
  }
  if (b.error === "overpayment_limit") return tooMuchResult(num(b.amountCents));
  return null;
}

/** The server's reason when it gave one ({ error } or { message }), else the
 *  generic line. */
export function paymentErrorText(lang: Lang, e: unknown): string {
  const over = overpaymentFromError(e);
  if (over && !over.ok) return tFor(lang, over.errKey, over.vars);
  if (e instanceof ApiError && e.body && typeof e.body === "object") {
    const b = e.body as { error?: unknown; message?: unknown };
    if (typeof b.error === "string" && b.error.trim()) return b.error;
    if (typeof b.message === "string" && b.message.trim()) return b.message;
  }
  return tFor(lang, "invoicesPage.pay.errSave");
}

/** "Payment of $65.00 recorded" — the success flash on /invoices. */
export function paymentRecordedText(lang: Lang, cents: number): string {
  return tFor(lang, "invoicesPage.pay.recorded", {
    amount: fmtMoneyExact(cents),
  });
}
