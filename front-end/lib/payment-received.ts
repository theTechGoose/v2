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

export type PaymentReceivedInput = {
  method: PaymentMethod | null;
  /** the amount field as typed, in dollars */
  dollars: string;
  /** the date field as typed, YYYY-MM-DD */
  date: string;
};

export type PaymentReceivedResult =
  | { ok: false; errKey: string }
  | {
    ok: true;
    method: PaymentMethod;
    /** INTEGER CENTS */
    cents: number;
    /** noon local on the picked day, so the date never shifts across a
     *  timezone boundary when the backend stores it as an instant */
    receivedAt: string;
  };

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

export function validatePaymentReceived(
  { method, dollars, date }: PaymentReceivedInput,
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
  return { ok: true, method, cents, receivedAt: at.toISOString() };
}

/** The server's reason when it gave one ({ error } or { message }), else the
 *  generic line. */
export function paymentErrorText(lang: Lang, e: unknown): string {
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
