/**
 * REQ-629 — the "How to pay" lines a printed invoice carries: the methods the
 * business switched on in Settings, with their handles, in the website's
 * order. Bank routing / account numbers are never printed — only the
 * business's own direct-deposit instructions. Pure.
 */
import { type Lang, t } from "@core/i18n/mod.ts";
import type { AcceptedPaymentMethods } from "@users/dto/business-identity.ts";
import { projectPayMethods } from "#payments/pay-links.ts"; // REQ-805

export interface PayOptionLine {
  label: string;
  value: string;
}

export function payOptionLines(
  m: AcceptedPaymentMethods | undefined,
  lang: Lang,
): PayOptionLine[] {
  if (!m) return [];
  const out: PayOptionLine[] = [];
  const add = (key: string, value: string | undefined) => {
    const v = value?.trim();
    if (v) out.push({ label: t(lang, `paymentMethod.${key}`), value: v });
  };
  if (m.check?.enabled) {
    add(
      "check",
      m.check.mailTo?.trim()
        ? t(lang, "printPdf.pay.mailTo", { address: m.check.mailTo.trim() })
        : t(lang, "printPdf.pay.checkAccepted"),
    );
  }
  if (m.venmo?.enabled) add("venmo", m.venmo.handle);
  if (m.zelle?.enabled) add("zelle", m.zelle.handle);
  if (m.cashapp?.enabled) add("cashApp", m.cashapp.cashtag);
  if (m.paypal?.enabled) add("paypal", m.paypal.handle);
  if (m.cash?.enabled) add("cash", t(lang, "printPdf.pay.cashAccepted"));
  if (m.ach?.enabled) add("ach", m.ach.instructions);
  if (m.card?.enabled) add("card", m.card.instructions);
  if (m.other?.enabled) add("other", m.other.instructions);
  // REQ-805: the business's own payment links ("Xpress Pay"), by name, with
  // the link — the same enabled, https-only rows the website offers
  for (const l of projectPayMethods(m)) {
    if (l.method === "link" && l.name && l.url) {
      out.push({ label: l.name, value: l.url });
    }
  }
  return out;
}
