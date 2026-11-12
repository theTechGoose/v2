/**
 * REQ-492 — demo-loop cycle 3, issue M29: the signed quote's hand-off links
 * (Pay now, the signed banner's next step, Related documents → /i and /co)
 * carry the language the quote is painted in, so /i and /co — whose default
 * is the contractor's commsLanguage — open in the reader's language.
 * Renders the real QuoteDoc (the component PublicQuoteView mounts).
 */
import { assert, assertEquals } from "@std/assert";
import { DOMParser } from "@b-fuze/deno-dom";
import { renderToString } from "preact-render-to-string";
import { QuoteDoc, type QuotePublic } from "../components/quote-doc.tsx";

function signedQuote(): QuotePublic {
  return {
    id: "q-492",
    number: "Q-009",
    version: 1,
    state: "accepted",
    status: "accepted",
    acceptedAt: "2026-11-12T15:00:00.000Z",
    acceptedName: "Ana Pérez",
    customer: { name: "Ana Pérez", email: "ana@example.com" },
    contractor: {
      name: "Bob Builder",
      businessName: "Bob's Plumbing",
      commsLanguage: "es",
    },
    summary: "Bathroom remodel",
    estimatedTotal: 45000,
    lineItems: [{
      description: "Bathroom remodel",
      quantity: 1,
      unit: "job",
      price: 45000,
    }],
    invoices: [{
      id: "inv-492",
      number: "INV-001",
      url: "/i/inv-492",
      status: "sent",
      amountCents: 45000,
      paidCents: 0,
      balanceCents: 45000,
    }],
    changeOrders: [{
      id: "co-492",
      number: "CO-001",
      url: "/co/co-492",
      status: "approved",
      deltaAmountCents: 5000,
    }],
  } as unknown as QuotePublic;
}

function hrefs(lang: "en" | "es") {
  const html = renderToString(<QuoteDoc quote={signedQuote()} lang={lang} />);
  const doc = new DOMParser().parseFromString(
    `<html><body>${html}</body></html>`,
    "text/html",
  )!;
  const href = (sel: string) => doc.querySelector(sel)?.getAttribute("href");
  return {
    payNow: href("a[data-cy='quote-pay-now']"),
    banner: href("a[data-cy='quote-signed-banner-pay']"),
    invoiceRow: href("a[data-cy='related-doc-invoice']"),
    coRow: href("a[data-cy='related-doc-change-order']"),
  };
}

for (const lang of ["en", "es"] as const) {
  Deno.test(`REQ-492 (M29): a signed quote painted in ${lang} hands off to /i and /co with ?lang=${lang}`, () => {
    const h = hrefs(lang);
    assertEquals(h.payNow, `/i/inv-492?lang=${lang}`, "Pay now");
    assertEquals(
      h.banner,
      `/i/inv-492?lang=${lang}`,
      "signed banner next step",
    );
    assertEquals(
      h.invoiceRow,
      `/i/inv-492?lang=${lang}`,
      "related invoice row",
    );
    assert(h.coRow, "the change order row renders");
    assertEquals(
      h.coRow,
      `/co/co-492?lang=${lang}`,
      "related change order row",
    );
  });
}
