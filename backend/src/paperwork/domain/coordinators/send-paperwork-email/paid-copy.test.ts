/**
 * REQ-933 — LOOP-007 cycle 1, issue q1-6 ("'Paid' invoice email still asks
 * the customer to pay"). REQ-020 emails the invoice stamped PAID; its
 * preheader, intro and button must not carry the invoice-due copy ("due
 * <date>", "pay whenever you're ready", "View & pay invoice") in EN or ES.
 */
import { assert } from "#std/assert";
import type { Quote } from "@paperwork/dto/quote.ts";
import type { Invoice } from "@paperwork/dto/invoice.ts";
import type { User } from "@users/dto/user.ts";
import type { BusinessIdentity } from "@users/dto/business-identity.ts";
import { renderInvoiceBasicHtml, renderInvoiceHtml } from "./mod.ts";

const carl = {
  id: "u-carl",
  name: "Carl",
  phoneNumber: "+15125550000",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
} as User;
const bizOf = (lang: "en" | "es") =>
  ({
    userId: "u-carl",
    businessName: "Jensen Electric LLC",
    commsLanguage: lang,
  }) as BusinessIdentity;
const quote = {
  id: "q-1",
  userId: "u-carl",
  number: "Q-001",
  version: 1,
  status: "accepted",
  customerSnapshot: { name: "Pat Doe" },
  summary: "Panel upgrade",
  lineItems: [{ description: "Panel upgrade", quantity: 1, price: 248975 }],
  estimatedTotal: 248975,
  createdAt: "2026-09-20T12:00:00Z",
  updatedAt: "2026-09-20T12:00:00Z",
} as unknown as Quote;
const paidInvoice = (withQuote: boolean) =>
  ({
    id: "i-1",
    userId: "u-carl",
    number: "INV-001",
    ...(withQuote ? { quoteId: "q-1" } : {}),
    status: "paid",
    amount: 248975,
    dueDate: "2026-12-04",
    issuedDate: "2026-11-04",
    paidAt: "2026-11-18T12:00:00.000Z",
    billTo: { name: "Pat Doe" },
    createdAt: "2026-11-04T12:00:00Z",
    updatedAt: "2026-11-18T12:00:00Z",
  }) as unknown as Invoice;

/** the hidden preheader — the hidden span at the top of the email */
function preheaderOf(html: string): string {
  const m = html.match(/<span[^>]*display:\s*none[^>]*>([\s\S]*?)<\/span>/i);
  return m ? m[1] : "";
}

const DUE_COPY = {
  en: ["pay whenever", "View &amp; pay", "View & pay"],
  es: ["pagar cuando quieras", "Ver y pagar"],
};
const DUE_DATE = { en: /\bdue\b/i, es: /\bvence\b/i };

/** every due-copy leak in one message, so the red shows all of them */
function dueCopyLeaks(html: string, lang: "en" | "es"): string[] {
  const leaks = DUE_COPY[lang].filter((s) => html.includes(s)).map((s) => `body has "${s}"`);
  const pre = preheaderOf(html);
  if (DUE_DATE[lang].test(pre)) leaks.push(`preheader says due: "${pre.trim()}"`);
  return leaks;
}

for (const lang of ["en", "es"] as const) {
  Deno.test(`REQ-933 (q1-6) standalone paid invoice email (${lang}) has no due copy: no pay CTA, no 'pay whenever', no due date in the preheader`, () => {
    const html = renderInvoiceBasicHtml(paidInvoice(false), undefined, carl, bizOf(lang), lang, true);
    const leaks = dueCopyLeaks(html, lang);
    assert(leaks.length === 0, `paid ${lang} standalone email still asks to pay: ${leaks.join(" | ")}`);
  });

  Deno.test(`REQ-933 (q1-6) quote-linked paid invoice email (${lang}) has no due copy: no pay CTA, no 'pay whenever', no due date in the preheader`, () => {
    const html = renderInvoiceHtml(paidInvoice(true), undefined, carl, bizOf(lang), quote, true);
    const leaks = dueCopyLeaks(html, lang);
    assert(leaks.length === 0, `paid ${lang} quote-linked email still asks to pay: ${leaks.join(" | ")}`);
  });
}

Deno.test("REQ-933 (q1-6) control: the unpaid invoice email still asks to pay (EN)", () => {
  const html = renderInvoiceBasicHtml(
    { ...paidInvoice(false), status: "sent", paidAt: undefined } as Invoice,
    undefined,
    carl,
    bizOf("en"),
    "en",
    false,
  );
  assert(html.includes("pay whenever"), "unpaid intro asks to pay");
});
