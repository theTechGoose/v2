/**
 * REQ-1054 (LOOP-007 cycle 2, q2-37) — the signed /q said "Pay now $2,520.00"
 * and "Next: pay the $2,520.00 due →" while /i, for a business with no online
 * way to pay, says "contact your contractor". quote-doc.tsx rendered both
 * whenever payNowTarget() found an open invoice, never asking whether any pay
 * way exists.
 *
 * Contract: the public quote payload carries `payOnline: boolean` (computed by
 * the backend from the business's accepted methods + Stripe/Square, the same
 * inputs /i uses). With `payOnline: false` the signed /q still links the open
 * invoice but never says "Pay now" / "pay the … due"; with `payOnline: true`
 * (or a business that takes Venmo) it does.
 */
import { assert } from "@std/assert";
import { DOMParser } from "@b-fuze/deno-dom";
import { renderToString } from "preact-render-to-string";
import { QuoteDoc, type QuotePublic } from "../components/quote-doc.tsx";

function signedQuote(over: Record<string, unknown> = {}): QuotePublic {
  return {
    id: "q-1054",
    number: "Q-001",
    version: 1,
    state: "accepted",
    status: "accepted",
    acceptedAt: "2026-11-19T15:00:00.000Z",
    acceptedName: "Dana Whitfield",
    customer: { name: "Dana Whitfield", email: "dana@example.com" },
    contractor: { name: "Nora North", businessName: "Northside Builders" },
    summary: "Kitchen remodel",
    estimatedTotal: 252000,
    lineItems: [{
      description: "Kitchen remodel",
      quantity: 1,
      unit: "job",
      price: 252000,
    }],
    invoices: [{
      id: "inv-1054",
      number: "INV-001",
      url: "/i/inv-1054",
      status: "sent",
      amountCents: 252000,
      paidCents: 0,
      balanceCents: 252000,
    }],
    ...over,
  } as unknown as QuotePublic;
}

function render(quote: QuotePublic, lang: "en" | "es" = "en") {
  const html = renderToString(<QuoteDoc quote={quote} lang={lang} />);
  return new DOMParser().parseFromString(
    `<html><body>${html}</body></html>`,
    "text/html",
  )!;
}

const txt = (el: { textContent: string } | null) =>
  (el?.textContent ?? "").replace(/\s+/g, " ").trim();

Deno.test("REQ-1054 (LOOP-007 q2-37): payOnline=false — the signed /q's invoice button does not say 'Pay now'", () => {
  const doc = render(signedQuote({ payOnline: false }));
  const btn = doc.querySelector("[data-cy='quote-pay-now']");
  assert(btn, "the signed /q still links the open invoice");
  assert(
    !/pay now/i.test(txt(btn)),
    `no online way to pay (/i says "contact your contractor"), yet the button reads: "${
      txt(btn)
    }"`,
  );
});

Deno.test("REQ-1054 (LOOP-007 q2-37): payOnline=false — the signed banner does not say 'Next: pay'", () => {
  const doc = render(signedQuote({ payOnline: false }));
  const link = doc.querySelector("[data-cy='quote-signed-banner-pay']");
  assert(link, "the banner still links the open invoice");
  assert(
    !/\bpay\b/i.test(txt(link)),
    `no online way to pay, yet the banner reads: "${txt(link)}"`,
  );
});

Deno.test("REQ-1054 (LOOP-007 q2-37): payOnline=false in Spanish — no 'Pagar ahora' / 'pagar'", () => {
  const doc = render(signedQuote({ payOnline: false }), "es");
  const btn = txt(doc.querySelector("[data-cy='quote-pay-now']"));
  const banner = txt(doc.querySelector("[data-cy='quote-signed-banner-pay']"));
  assert(!/pagar ahora/i.test(btn), `botón: "${btn}"`);
  assert(!/\bpag(ar|a)\b/i.test(banner), `banner: "${banner}"`);
});

Deno.test("REQ-1054 (LOOP-007 q2-37): payOnline=true — the signed /q keeps 'Pay now $2,520.00' and 'Next: pay'", () => {
  const doc = render(signedQuote({ payOnline: true }));
  const btn = txt(doc.querySelector("[data-cy='quote-pay-now']"));
  assert(/pay now/i.test(btn) && btn.includes("$2,520.00"), btn);
  const banner = txt(doc.querySelector("[data-cy='quote-signed-banner-pay']"));
  assert(/\bpay\b/i.test(banner), banner);
});
