/**
 * REQ-1121 (LOOP-007 cycle 3, issue q3-44; amends REQ-1054 + REQ-933): an
 * unpaid invoice email says "View & pay invoice" / "Ver y pagar factura" only
 * when the customer can pay online.
 *
 * QA5's invoice email from an account with no online pay way (no card, no
 * Venmo / Cash App / PayPal / Zelle, no custom link) had a "Ver y pagar
 * factura →" button, while /i read "Contacta a tu contratista para coordinar
 * el pago." SendPaperworkEmail already hands the renderers the "Ways to pay"
 * block (payWaysEmailHtml), which is "" exactly when hasOnlinePayWay is false
 * (REQ-630). With no online way the button must not promise payment; with
 * Venmo it keeps "View & pay invoice". Both the rich (quote-linked) and the
 * basic (standalone) renderers.
 */
import { assert } from "#std/assert";
import type { Quote } from "@paperwork/dto/quote.ts";
import type { Invoice } from "@paperwork/dto/invoice.ts";
import type { User } from "@users/dto/user.ts";
import type { BusinessIdentity } from "@users/dto/business-identity.ts";
import { t } from "@core/i18n/mod.ts";
import { payWaysEmailHtml } from "@paperwork/domain/business/pay-ways/mod.ts";
import { hasOnlinePayWay } from "#payments/pay-links.ts";
import { renderInvoiceBasicHtml, renderInvoiceHtml } from "./mod.ts";

const carl = {
  id: "u-carl",
  name: "Carl",
  phoneNumber: "+15125550000",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
} as User;
const VENMO = { venmo: { enabled: true, handle: "@northside" } };
const bizOf = (lang: "en" | "es", apm?: unknown) =>
  ({
    userId: "u-carl",
    businessName: "Jensen Electric LLC",
    commsLanguage: lang,
    ...(apm ? { acceptedPaymentMethods: apm } : {}),
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
const unpaid = (withQuote: boolean) =>
  ({
    id: "i-1",
    userId: "u-carl",
    number: "INV-001",
    ...(withQuote ? { quoteId: "q-1" } : {}),
    status: "sent",
    amount: 248975,
    dueDate: "2026-12-04",
    issuedDate: "2026-11-04",
    billTo: { name: "Pat Doe" },
    createdAt: "2026-11-04T12:00:00Z",
    updatedAt: "2026-11-04T12:00:00Z",
  }) as unknown as Invoice;

/** the Ways-to-pay block exactly as SendPaperworkEmail builds it (no Stripe/Square) */
const waysFor = (lang: "en" | "es", apm: unknown) =>
  payWaysEmailHtml(apm, {
    card: false,
    lang,
    payUrl: `https://documonster.com/i/i-1?lang=${lang}`,
    amountCents: 248975,
    note: "INV-001",
  });

/** the "View & pay" CTA in a message, raw or HTML-escaped */
function payCtaIn(html: string, lang: "en" | "es"): string | undefined {
  const cta = t(lang, "paperworkEmail.invoice.cta");
  return [cta, cta.replace(/&/g, "&amp;")].find((s) => html.includes(s));
}

const render = {
  basic: (lang: "en" | "es", apm: unknown) =>
    renderInvoiceBasicHtml(unpaid(false), undefined, carl, bizOf(lang, apm), lang, false, waysFor(lang, apm)),
  "quote-linked": (lang: "en" | "es", apm: unknown) =>
    renderInvoiceHtml(unpaid(true), undefined, carl, bizOf(lang, apm), quote, false, [], waysFor(lang, apm)),
};

for (const lang of ["en", "es"] as const) {
  for (const [kind, fn] of Object.entries(render)) {
    Deno.test(`REQ-1121 (LOOP-007 q3-44, ${lang}): ${kind} unpaid invoice email from an account with no online pay way has no "${t(lang, "paperworkEmail.invoice.cta")}" button`, () => {
      assert(!hasOnlinePayWay(undefined, { card: false }), "precondition: no online pay way");
      const html = fn(lang, undefined);
      const leak = payCtaIn(html, lang);
      assert(
        leak === undefined,
        `/i says "contact your contractor", yet the ${kind} ${lang} invoice email's button reads "${leak}"`,
      );
    });

    Deno.test(`REQ-1121 (LOOP-007 q3-44, ${lang}): ${kind} unpaid invoice email from a Venmo account keeps "${t(lang, "paperworkEmail.invoice.cta")}"`, () => {
      assert(hasOnlinePayWay(VENMO, { card: false }), "precondition: Venmo is online");
      const html = fn(lang, VENMO);
      assert(payCtaIn(html, lang), `the ${kind} ${lang} invoice email with Venmo lost its pay CTA`);
    });
  }
}
