/**
 * REQ-692 — Raphael: "fix every issue the demo found, loop until there are
 * none." Demo-loop cycle 5 (run r37f88707), issues p18-6a (signature labels
 * wrong: "CARMEN NÚÑEZ SIGNATURE", "SIGN HERE" after signing, two spellings
 * of the signer on one card) and c3-p8-pair5-e (the contractor's cursive
 * signature appears with no word on where it came from).
 *
 * Renders the real QuoteDoc signature section, signed and unsigned, en + es.
 */
import { assert, assertEquals } from "@std/assert";
import { DOMParser } from "@b-fuze/deno-dom";
import { renderToString } from "preact-render-to-string";
import { QuoteDoc, type QuotePublic } from "../components/quote-doc.tsx";

function quote(over: Partial<QuotePublic> = {}): QuotePublic {
  return {
    id: "q-692",
    number: "Q-692",
    version: 1,
    state: "sent",
    status: "sent",
    publishedAt: "2026-11-10T15:00:00.000Z",
    customer: { name: "Carmen Núñez", email: "carmen@example.com" },
    contractor: { name: "Bob Builder", businessName: "Bob's Plumbing" },
    summary: "Kitchen remodel",
    estimatedTotal: 480000,
    lineItems: [{
      description: "Kitchen remodel",
      quantity: 1,
      unit: "job",
      price: 480000,
    }],
    ...over,
  } as QuotePublic;
}

const signed = (over: Partial<QuotePublic> = {}) =>
  quote({
    state: "accepted",
    status: "accepted",
    acceptedAt: "2026-11-12T15:00:00.000Z",
    acceptedName: "Carmen Nunez",
    ...over,
  });

function section(q: QuotePublic, lang: "en" | "es") {
  const html = renderToString(<QuoteDoc quote={q} lang={lang} />);
  const doc = new DOMParser().parseFromString(
    `<html><body>${html}</body></html>`,
    "text/html",
  )!;
  const sec = doc.querySelector("[data-cy='quote-signature-section']");
  assert(sec, "a data-cy='quote-signature-section' renders");
  const text = (sel: string) =>
    (sec.querySelector(sel)?.textContent ?? "").replace(/\s+/g, " ").trim();
  return { sec, text, all: sec.textContent.replace(/\s+/g, " ").trim() };
}

Deno.test("REQ-692 (p18-6a): signed → the section is 'Signatures', no 'Sign here', no sign-below line (en)", () => {
  const { all } = section(signed(), "en");
  assert(all.includes("Signatures"), all);
  assert(!/Sign here/i.test(all), `no 'Sign here' once signed: ${all}`);
  assert(!/By signing below/i.test(all), `no sign-below line: ${all}`);
});

Deno.test("REQ-692 (p18-6a): signed → 'Firmas', no 'Firma aquí' (es)", () => {
  const { all } = section(signed(), "es");
  assert(all.includes("Firmas"), all);
  assert(!/Firma aquí/i.test(all), all);
  assert(!/Al firmar abajo/i.test(all), all);
});

Deno.test("REQ-692 (p18-6a): the signed card's label is the signer's typed name, possessive, and one spelling on the card", () => {
  const { text } = section(signed(), "en");
  const card = text("[data-cy='quote-customer-signature']");
  assert(card.includes("Carmen Nunez's signature"), card);
  assert(!card.includes("Núñez"), `one spelling on the card: ${card}`);
  assert(card.includes("By: Carmen Nunez"), card);
  const es = section(signed(), "es").text(
    "[data-cy='quote-customer-signature']",
  );
  assert(es.includes("Firma de Carmen Nunez"), es);
});

Deno.test("REQ-692 (p18-6a): unsigned keeps 'Sign here' and the agreement line", () => {
  const { all } = section(quote(), "en");
  assert(all.includes("Sign here"), all);
  assert(!all.includes("Signatures"), all);
  assert(/By signing below, Carmen Núñez agrees/.test(all), all);
});

Deno.test("REQ-692 (c3-p8-pair5-e): the contractor column says it was signed by sending, on the sent date (en + es)", () => {
  for (const q of [quote(), signed()]) {
    const en = section(q, "en").text("[data-cy='quote-contractor-sent-note']");
    assertEquals(en, "Signed by sending this agreement on November 10, 2026");
  }
  const es = section(signed(), "es").text(
    "[data-cy='quote-contractor-sent-note']",
  );
  assert(/^Firmado al enviar este acuerdo el .*2026$/.test(es), es);
});

Deno.test("REQ-692 (c3-p8-pair5-e): a quote that cannot be signed yet (never sent) carries no 'signed by sending' line", () => {
  const { sec } = section(
    quote({ publishedAt: undefined, signRefusal: "not_sent" } as Partial<
      QuotePublic
    >),
    "en",
  );
  assertEquals(
    sec.querySelector("[data-cy='quote-contractor-sent-note']"),
    null,
  );
});
