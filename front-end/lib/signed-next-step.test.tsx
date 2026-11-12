/**
 * REQ-311 — demo-loop cycle 1, issue m19: after signing, the page jumped to
 * the top (a blind location.reload()) with no thank-you and no next step.
 *
 * - QuoteDoc rendered in its accepted state carries a banner ABOVE the
 *   article: "Thanks, {name} — signed on {date}." + "Next: pay the $X
 *   deposit →" linking the invoice the signature billed (REQ-251 target).
 * - PublicSignQuote hands a successful accept to its parent (onSigned) and
 *   no longer reloads; PublicQuoteView refetches and swaps the document in
 *   place (the browser proof is e2e/signed-next-step).
 */
import { assert, assertEquals } from "@std/assert";
import { DOMParser } from "@b-fuze/deno-dom";
import { renderToString } from "preact-render-to-string";
import { QuoteDoc, type QuotePublic } from "../components/quote-doc.tsx";

const src = (p: string) => Deno.readTextFileSync(new URL(p, import.meta.url));

function signedQuote(over: Partial<QuotePublic> = {}): QuotePublic {
  return {
    id: "q-311",
    number: "Q-007",
    version: 1,
    state: "accepted",
    status: "accepted",
    acceptedAt: "2026-11-12T15:00:00.000Z",
    acceptedName: "Ana Pérez",
    customer: { name: "Ana Pérez", email: "ana@example.com" },
    contractor: { name: "Bob Builder", businessName: "Bob's Plumbing" },
    summary: "Bathroom remodel",
    estimatedTotal: 480000,
    lineItems: [{
      description: "Bathroom remodel",
      quantity: 1,
      unit: "job",
      price: 480000,
    }],
    invoices: [{
      id: "inv-311",
      number: "INV-001",
      url: "/i/inv-311",
      status: "sent",
      amountCents: 480000,
      paidCents: 0,
      balanceCents: 480000,
    }],
    ...over,
  } as QuotePublic;
}

function render(quote: QuotePublic, lang: "en" | "es") {
  const html = renderToString(<QuoteDoc quote={quote} lang={lang} />);
  const doc = new DOMParser().parseFromString(
    `<html><body>${html}</body></html>`,
    "text/html",
  )!;
  return { html, doc };
}

Deno.test("REQ-311: the signed document opens with a thank-you banner above the article naming the signer, the date and the deposit to pay (en)", () => {
  const { doc } = render(signedQuote(), "en");
  const banner = doc.querySelector("[data-cy='quote-signed-banner']");
  assert(banner, "a data-cy='quote-signed-banner' element renders");
  const text = banner.textContent.replace(/\s+/g, " ").trim();
  assert(
    text.includes("Thanks, Ana Pérez"),
    `banner thanks the signer: ${text}`,
  );
  assert(
    /signed on .*2026/i.test(text),
    `banner carries the signed date: ${text}`,
  );
  assert(
    text.includes("$4,800.00"),
    `banner names the deposit amount: ${text}`,
  );
  const link = banner.querySelector("a[data-cy='quote-signed-banner-pay']");
  assert(link, "the banner's next step is a link");
  // REQ-492: the hand-off carries the page language
  assertEquals(link.getAttribute("href"), "/i/inv-311?lang=en");
  // ABOVE the article: the banner precedes the document card in source order
  const article = doc.querySelector("article.ctr")!;
  const order = banner.compareDocumentPosition(article);
  assert(
    (order & 4) === 4, // DOCUMENT_POSITION_FOLLOWING
    "the banner comes before the article",
  );
});

Deno.test("REQ-311: the banner speaks Spanish too", () => {
  const { doc } = render(signedQuote(), "es");
  const text = doc.querySelector("[data-cy='quote-signed-banner']")!
    .textContent.replace(/\s+/g, " ").trim();
  assert(text.includes("Gracias, Ana Pérez"), text);
  assert(/firmado el/i.test(text), text);
  assert(text.includes("$4,800.00"), text);
});

Deno.test("REQ-311: without an open invoice the banner still thanks and says the contractor will be in touch", () => {
  const { doc } = render(signedQuote({ invoices: [] }), "en");
  const banner = doc.querySelector("[data-cy='quote-signed-banner']");
  assert(banner, "banner renders without an invoice");
  const text = banner.textContent.replace(/\s+/g, " ").trim();
  assert(text.includes("Thanks, Ana Pérez"), text);
  assert(/in touch/i.test(text), `no-invoice next step: ${text}`);
  assertEquals(
    banner.querySelector("a[data-cy='quote-signed-banner-pay']"),
    null,
  );
});

Deno.test("REQ-311: an unsigned document shows no banner", () => {
  const { doc } = render(
    signedQuote({
      state: "sent",
      status: "sent",
      acceptedAt: undefined,
      acceptedName: undefined,
      invoices: [],
    }),
    "en",
  );
  assertEquals(doc.querySelector("[data-cy='quote-signed-banner']"), null);
});

Deno.test("REQ-311: the island hands a successful accept to its parent and never reloads for it", () => {
  const s = src("../islands/PublicSignQuote.tsx");
  const ok = s.slice(s.indexOf('setStatus("ok")'));
  const tail = ok.slice(0, ok.indexOf("} catch"));
  assert(!/reloadSoon\(/.test(tail), "the ok path must not reloadSoon()");
  assert(/onSigned/.test(tail), "the ok path calls onSigned");
  assert(
    /onSigned\?\?:|onSigned\?:/.test(s),
    "onSigned is a prop of the island",
  );
});

Deno.test("REQ-311: PublicQuoteView swaps the signed document in place (refetch on onSigned)", () => {
  const view = src("../islands/PublicQuoteView.tsx");
  assert(
    /onSigned=\{/.test(view),
    "PublicQuoteView passes onSigned to QuoteDoc",
  );
  const doc = src("../components/quote-doc.tsx");
  assert(
    /onSigned=\{onSigned\}/.test(doc),
    "QuoteDoc forwards onSigned to the sign island",
  );
  // the keys exist in both dictionaries
  for (const lang of ["en", "es"]) {
    const dict = JSON.parse(src(`../../lang/${lang}.json`));
    for (
      const k of [
        "quoteDoc.signedBanner.thanks",
        "quoteDoc.signedBanner.next",
        "quoteDoc.signedBanner.nextNoInvoice",
      ]
    ) {
      assert(
        typeof dict[k] === "string" && dict[k].length > 0,
        `${lang}: ${k}`,
      );
    }
    assert(dict["quoteDoc.signedBanner.thanks"].includes("{name}"));
    assert(dict["quoteDoc.signedBanner.thanks"].includes("{date}"));
    assert(dict["quoteDoc.signedBanner.next"].includes("{amount}"));
  }
});
