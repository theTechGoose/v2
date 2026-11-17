/**
 * REQ-783 — demo-loop cycle dv1, issue d4. Raphael: "Yes, default terms."
 * The customer's agreement (/q, QuoteDoc) keeps the 7-day cancellation
 * notice by default, and states the notice the owner set in the quote
 * review when they changed or removed it — one row, never the default
 * beside an edit. Renders the real QuoteDoc, en + es.
 */
import { assert, assertEquals } from "@std/assert";
import { DOMParser } from "@b-fuze/deno-dom";
import { renderToString } from "preact-render-to-string";
import { QuoteDoc, type QuotePublic } from "../components/quote-doc.tsx";

const WIZARD_TERMS = [
  { stepId: "start_date", label: "Start date", value: "Right away" },
  { stepId: "wraps", label: "Time to complete", value: "1 week" },
  { stepId: "payment_terms", label: "Payment terms", value: "50/50" },
  { stepId: "warranty", label: "Warranty", value: "1 year" },
];
const cancel = (value: string) => ({
  stepId: "cancellation",
  label: "Cancellation",
  value,
});

function quote(terms: QuotePublic["terms"]): QuotePublic {
  return {
    id: "q-783",
    number: "Q-783",
    version: 1,
    state: "sent",
    status: "sent",
    publishedAt: "2026-11-13T15:00:00.000Z",
    customer: { name: "Ana Diaz", email: "ana@example.com" },
    contractor: { name: "Bob Builder", businessName: "Bob's Tile" },
    summary: "Bathroom floor",
    estimatedTotal: 240000,
    lineItems: [{
      description: "Porcelain tile",
      quantity: 1,
      unit: "job",
      price: 240000,
    }],
    terms,
  } as QuotePublic;
}

/** The term grid's rows as [label, value] and clause 10's text. */
function read(q: QuotePublic, lang: "en" | "es") {
  const html = renderToString(<QuoteDoc quote={q} lang={lang} />);
  const doc = new DOMParser().parseFromString(
    `<html><body>${html}</body></html>`,
    "text/html",
  )!;
  const grid = doc.querySelector(".ctr__terms-grid");
  assert(grid, "the term grid renders");
  const rows = [...grid.children].map((c) =>
    [...c.children].map((x) => x.textContent.replace(/\s+/g, " ").trim())
  );
  const clauses = [...doc.querySelectorAll("[data-cy='terms-details'] li")]
    .map((li) => li.textContent.replace(/\s+/g, " ").trim());
  return { rows, clause10: clauses[9] ?? "" };
}

const cancelRows = (rows: string[][]) =>
  rows.filter(([k]) => /^(cancellation|cancelación)$/i.test(k));

Deno.test("REQ-783 d4: a quote that kept the default states 'Cancellation: 7 days' notice' once (en + es)", () => {
  const en = read(quote(WIZARD_TERMS), "en");
  assertEquals(cancelRows(en.rows), [["Cancellation", "7 days' notice"]]);
  assert(/7 days' written notice/.test(en.clause10), en.clause10);
  const es = read(quote(WIZARD_TERMS), "es");
  assertEquals(cancelRows(es.rows), [["Cancelación", "Aviso de 7 días"]]);
});

Deno.test("REQ-783 d4: the owner changed it to 14 days in the review → the agreement says 14 days, once, and never 7", () => {
  const en = read(quote([...WIZARD_TERMS, cancel("14 days' notice")]), "en");
  assertEquals(cancelRows(en.rows), [["Cancellation", "14 days' notice"]]);
  assert(/14 days' written notice/.test(en.clause10), en.clause10);
  assert(!/7 days/.test(en.clause10), en.clause10);
  // the owner previewed in Spanish: the picked option was stored in Spanish
  const es = read(quote([...WIZARD_TERMS, cancel("Aviso de 14 días")]), "es");
  assertEquals(cancelRows(es.rows), [["Cancelación", "Aviso de 14 días"]]);
  assert(/aviso por escrito de 14 días/.test(es.clause10), es.clause10);
});

Deno.test("REQ-783 d4: the owner removed the notice → 'No notice period', and clause 10 names no 7 days", () => {
  const en = read(quote([...WIZARD_TERMS, cancel("No notice period")]), "en");
  assertEquals(cancelRows(en.rows), [["Cancellation", "No notice period"]]);
  assert(!/7 days/.test(en.clause10), en.clause10);
});
