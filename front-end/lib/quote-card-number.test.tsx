/**
 * REQ-313 — Raphael: "fix every issue the demo found, loop until there are
 * none." Demo-loop cycle 1, issues m48 ("Quote number missing from the
 * /quotes card") and p15-11 ("'0aperturas' missing space").
 *
 * The pipeline card showed only a positional 01/02 numeral and never the
 * quote's own number (Q-001), and its back face put the opens count and the
 * unit in adjacent nodes with no whitespace between them, so the DOM text
 * (copy/paste, screen readers, page-text probes) read "0aperturas".
 *
 * Renders the real island server-side and checks the HTML.
 */
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { DOMParser } from "@b-fuze/deno-dom";
import { renderToString } from "preact-render-to-string";
import QuoteCard from "../islands/QuoteCard.tsx";
import type { Quote } from "./quotes-seed.ts";

function quote(over: Partial<Quote> = {}): Quote {
  return {
    id: "q-1",
    title: "Fence repair",
    client: "Ana Torres",
    initials: "AT",
    stage: "sent",
    value: 120000,
    daysIn: 1,
    opens: 0,
    sentDays: 1,
    band: ["#FFB3B3", "#FF6B6B"],
    shadow: "rgba(255,107,107,0.35)",
    ...over,
  };
}

function render(q: Quote, lang: "en" | "es") {
  const html = renderToString(<QuoteCard q={q} idx={0} lang={lang} />);
  const doc = new DOMParser().parseFromString(html, "text/html");
  return { html, doc };
}

Deno.test("REQ-313 (m48) the card's mood strip shows the quote's number", () => {
  const { doc } = render(quote({ number: "Q-001", version: 2 }), "en");
  const chip = doc.querySelector(".qcard__number");
  assert(chip, "a .qcard__number chip in the mood strip");
  assertEquals(chip.textContent.trim(), "Q-001");
});

Deno.test("REQ-313 (m48) the back's eyebrow reads 'Q-001 · Version 2'", () => {
  const en = render(quote({ number: "Q-001", version: 2 }), "en");
  assertStringIncludes(
    en.doc.querySelector(".qcard__back-eyebrow")!.textContent,
    "Q-001 · Version 2",
  );
  const es = render(quote({ number: "Q-001", version: 2 }), "es");
  assertStringIncludes(
    es.doc.querySelector(".qcard__back-eyebrow")!.textContent,
    "Q-001 · Versión 2",
  );
});

Deno.test("REQ-313 (m48) an unnumbered quote (the sample) shows no number and no 'undefined'", () => {
  const { html, doc } = render(quote({ isSample: true }), "en");
  assertEquals(doc.querySelector(".qcard__number"), null);
  assert(!html.includes("undefined"), "no 'undefined' leaks into the HTML");
  assertEquals(
    doc.querySelector(".qcard__back-eyebrow")!.textContent.trim(),
    "The open story",
  );
});

Deno.test("REQ-313 (p15-11) the back's opens line reads '0 aperturas' / '0 opens' as DOM text", () => {
  const es = render(quote({ opens: 0 }), "es");
  assertEquals(
    es.doc.querySelector(".qcard__back-big")!.textContent.replace(/\s+/g, " ")
      .trim(),
    "0 aperturas · Ana",
  );
  const en = render(quote({ opens: 1 }), "en");
  assertEquals(
    en.doc.querySelector(".qcard__back-big")!.textContent.replace(/\s+/g, " ")
      .trim(),
    "1 open · Ana",
  );
});
