/**
 * REQ-928 — "when an invoice is paid, it should show the method of payment
 * and when it was paid in all views. print electronic or other."
 *
 * The invoice carries `paidMethods` (the distinct methods of its payments,
 * oldest first — written by ComputeInvoiceBalance next to `paidAt`). Every
 * view prints it through here, so one invoice reads the same everywhere:
 *   "Paid Nov 11, 2026 · Electronic (Venmo)"
 *   "Pagada el 11 de noviembre de 2026 · Otro (Cheque)"
 *
 * Electronic = money that moved through a network: card (Stripe / Square /
 * a recorded card), ACH, Venmo, Zelle, Cash App, PayPal. Everything else —
 * cash, check, "other", unknown — is Other.
 *
 * Pure: the caller passes its dictionary lookup.
 */
import { formatLongDate } from "../quote-flow/format-helpers.ts";

export type Translate = (
  key: string,
  vars?: Record<string, string | number>,
) => string;

export type PaidKind = "electronic" | "other";

const ELECTRONIC = new Set([
  "card",
  "ach",
  "venmo",
  "zelle",
  "cashapp",
  "paypal",
]);

/** i18n key of a stored payment method's name (the catalogue's spelling). */
const METHOD_KEY: Record<string, string> = {
  card: "paymentMethod.card",
  ach: "paymentMethod.ach",
  venmo: "paymentMethod.venmo",
  zelle: "paymentMethod.zelle",
  cashapp: "paymentMethod.cashApp",
  paypal: "paymentMethod.paypal",
  cash: "paymentMethod.cash",
  check: "paymentMethod.check",
};

export function paidKind(method: string | undefined | null): PaidKind {
  return method && ELECTRONIC.has(method) ? "electronic" : "other";
}

/** "Electronic (Venmo)" · "Other (Check)" · "Other" · joined with " + " when
 *  the payments used more than one method; "" when none is recorded. */
export function paidHow(
  t: Translate,
  methods: readonly string[] | undefined | null,
): string {
  const uniq = [...new Set((methods ?? []).filter(Boolean))];
  return uniq.map((m) => {
    const kind = t(`paidHow.${paidKind(m)}`);
    const key = METHOD_KEY[m];
    return key ? t("paidHow.withMethod", { kind, method: t(key) }) : kind;
  }).join(" + ");
}

/** "Paid Nov 11, 2026 · Electronic (Venmo)"; either half drops out when it is
 *  not known (a pre-REQ-928 paid invoice has no recorded method). */
export function paidLine(
  t: Translate,
  lang: "en" | "es",
  { paidAt, paidMethods }: {
    paidAt?: string | null;
    paidMethods?: readonly string[] | null;
  },
  /** REQ-944: the business's zone — the paid instant prints as its day there */
  tz?: string,
): string {
  const date = formatLongDate(paidAt ?? undefined, lang, tz);
  const how = paidHow(t, paidMethods);
  const head = date ? t("paidHow.paidOn", { date }) : t("paidHow.paid");
  return how ? `${head} · ${how}` : head;
}

/** The distinct methods of an invoice's payments, oldest payment first. */
export function paidMethodsOf(
  payments: readonly { method?: string; receivedAt?: string }[],
): string[] {
  const sorted = [...payments].sort((a, b) =>
    (a.receivedAt ?? "").localeCompare(b.receivedAt ?? "")
  );
  return [...new Set(sorted.map((p) => p.method ?? "other"))];
}
