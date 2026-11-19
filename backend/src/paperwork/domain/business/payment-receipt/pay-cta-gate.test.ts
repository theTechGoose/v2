/**
 * REQ-1121 (LOOP-007 cycle 3, issue q3-44; amends REQ-1054 + REQ-1071): the
 * part-payment receipt promises "Pay the balance →" / "Pagar saldo →" only
 * when the customer can actually pay online.
 *
 * QA5's receipt (a check part payment on an account with no online pay way)
 * read "Pagar saldo →", while the /i page the button opens said "Contacta a tu
 * contratista para coordinar el pago." REQ-1054's hasOnlinePayWay is the one
 * rule; renderReceiptHtml takes it as `payOnline`. With `payOnline: false` the
 * balance line and a link to the invoice stay, but the button never says
 * "pay"; with `payOnline: true` it keeps "Pay the balance →".
 */
import { assert, assertStringIncludes } from "#std/assert";
import type { Lang } from "@core/i18n/mod.ts";
import { t } from "@core/i18n/mod.ts";
import { renderReceiptHtml } from "./mod.ts";

const PAY_URL = "https://documonster.com/s/abc123?lang=es";
type ReceiptOpts = Parameters<typeof renderReceiptHtml>[0];

/** $500 of a $1,190.75 invoice by check — $690.75 still due */
function receipt(lang: Lang, payOnline: boolean): string {
  const opts = {
    invoice: { id: "inv-1", number: "INV-001", status: "sent", billTo: { name: "Pat Doe" } },
    businessName: "Ortega Painting",
    intent: { method: "check" as const },
    amount: 50000,
    lang,
    totalCents: 119075,
    balanceCents: 69075,
    payUrl: PAY_URL,
    // REQ-1121: passed through a variable so this compiles before the field exists
    payOnline,
  };
  return renderReceiptHtml(opts as ReceiptOpts);
}

/** the receipt's button text, tags stripped */
function buttonText(html: string): string {
  const m = html.match(/<a[^>]*data-receipt-pay[^>]*>([\s\S]*?)<\/a>/);
  return m ? m[1].replace(/<[^>]+>/g, "").trim() : "";
}

const PAY_WORDS: Record<Lang, RegExp> = { en: /\bpay\b/i, es: /\bpagar\b/i } as Record<Lang, RegExp>;

for (const lang of ["en", "es"] as const) {
  Deno.test(`REQ-1121 (LOOP-007 q3-44, ${lang}): no online pay way — the part-payment receipt has no "${t(lang, "confirmPayment.email.payCta")}" button`, () => {
    const html = receipt(lang, false);
    assertStringIncludes(html, "$690.75", "the balance line stays");
    const payCta = t(lang, "confirmPayment.email.payCta");
    assert(
      !html.includes(payCta),
      `/i says "contact your contractor", yet the receipt still says "${payCta}" (button: "${buttonText(html)}")`,
    );
    const btn = buttonText(html);
    assert(!PAY_WORDS[lang].test(btn), `the receipt's button still asks to pay: "${btn}"`);
  });

  Deno.test(`REQ-1121 (LOOP-007 q3-44, ${lang}): with an online pay way the part-payment receipt keeps "${t(lang, "confirmPayment.email.payCta")}"`, () => {
    const html = receipt(lang, true);
    assertStringIncludes(html, t(lang, "confirmPayment.email.payCta"));
    assertStringIncludes(html, `href="${PAY_URL}"`);
  });
}
