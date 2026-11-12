/**
 * REQ-560 — Raphael: "fix every issue the demo found, loop until there are
 * none." Demo-loop cycle 4, issue p4-p2b: after the customer signs in person
 * on the contractor's device, the signed page told the person holding it to
 * check "your email". The rendered QuoteDoc now says the quote was signed in
 * person and where the customer's copy goes.
 */
import { assert, assertEquals } from "@std/assert";
import { DOMParser } from "@b-fuze/deno-dom";
import { renderToString } from "preact-render-to-string";
import { QuoteDoc, type QuotePublic } from "../components/quote-doc.tsx";

function signedQuote(over: Partial<QuotePublic> = {}): QuotePublic {
  return {
    id: "q-560",
    number: "Q-560",
    version: 1,
    state: "sent",
    status: "accepted",
    acceptedAt: "2026-11-12T15:00:00.000Z",
    acceptedName: "Ana Pérez",
    customer: { name: "Ana Pérez", email: "ana@example.com" },
    confirmChannel: "email",
    contractor: { name: "Bob Builder", businessName: "Bob's Plumbing" },
    summary: "Bathroom remodel",
    estimatedTotal: 480000,
    lineItems: [{
      description: "Bathroom remodel",
      quantity: 1,
      unit: "job",
      price: 480000,
    }],
    ...over,
  } as QuotePublic;
}

function text(q: QuotePublic, search: string, lang: "en" | "es" = "en") {
  const html = renderToString(
    <QuoteDoc quote={q} lang={lang} search={search} />,
  );
  return new DOMParser().parseFromString(
    `<html><body>${html}</body></html>`,
    "text/html",
  )!.body.textContent;
}

Deno.test("REQ-560 (cycle 4, p4-p2b): signed in person on the business's device — no 'check your email', names the customer's copy", () => {
  const t = text(
    signedQuote({ internal: true }),
    "?as=customer&confirm=1",
  );
  assert(!/checking your email/i.test(t), "no 'check your email' note");
  assert(
    t.includes("Signed in person — Ana Pérez gets a copy at ana@example.com"),
    "in-person note with name + email",
  );
});

Deno.test("REQ-560 (cycle 4, p4-p2b): in person, text channel, in Spanish", () => {
  const t = text(
    signedQuote({
      internal: true,
      confirmChannel: "text",
      customer: { name: "Ana Pérez", phoneNumber: "+15125550100" },
    }),
    "?lang=es&as=customer&confirm=1",
    "es",
  );
  assert(!/tu correo/i.test(t));
  assert(
    t.includes(
      "Firmado en persona — Ana Pérez recibirá una copia por mensaje de texto",
    ),
  );
});

Deno.test("REQ-560 (cycle 4, p4-p2b): the customer's own device keeps 'check your email'", () => {
  const t = text(signedQuote(), "");
  assert(/checking your email/i.test(t));
  assertEquals(t.includes("Signed in person"), false);
});
