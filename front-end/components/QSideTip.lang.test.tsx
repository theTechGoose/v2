/**
 * REQ-1107 (LOOP-007 cycle 3, q3-31 + q3-104) — "Spanish /quotes 'Consejo del
 * monstruo' tip text is in English". The tip's heading takes the PAGE language
 * (`tFor(lang, "quotesTip.title")`), but its body was the backend's finished
 * sentence, built in the ACCOUNT's language. An English-account owner on
 * /quotes?lang=es (or pm_lang=es) got a Spanish heading over the English
 * "Most quotes are accepted within the first 48 hours…".
 *
 * The tip must speak the page language for both lines, whatever language the
 * backend payload happened to be built in.
 */
import { assert, assertEquals } from "@std/assert";
import { DOMParser } from "@b-fuze/deno-dom";
import { renderToString } from "preact-render-to-string";
import { QSideTip } from "./QuotesSections.tsx";

const read = (rel: string) =>
  JSON.parse(Deno.readTextFileSync(new URL(rel, import.meta.url))) as Record<
    string,
    string
  >;
const en = read("../../lang/en.json");
const es = read("../../lang/es.json");

/** Exactly what GET /analytics/quotes/insight answers an EN account with < 10 decided quotes. */
const enAccountFallback = {
  text: en["quotesInsight.staticFallback"],
  kind: "static_fallback" as const,
};

function tip(html: string) {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html")!;
  const card = doc.querySelector(".qside__card");
  assert(card, "QSideTip renders a .qside__card");
  return {
    title: card.querySelector(".qside__title")?.textContent?.trim() ?? "",
    body: card.querySelector("p")?.textContent?.trim() ?? "",
  };
}

Deno.test("REQ-1107 (LOOP-007 q3, q3-31): QSideTip on a Spanish page shows the static-fallback insight in Spanish, even when the backend built it in English", () => {
  // deno-lint-ignore no-explicit-any
  const Tip = QSideTip as any;
  const { title, body } = tip(renderToString(<Tip {...enAccountFallback} lang="es" />));
  assertEquals(title, es["quotesTip.title"], "heading is Spanish (Consejo del monstruo)");
  assert(
    !/within the first 48 hours/.test(body),
    `the tip body leaks the English fallback on a Spanish page: "${body}"`,
  );
  assertEquals(body, es["quotesInsight.staticFallback"], "body is the Spanish 48-hour sentence");
});

Deno.test("REQ-1107 (LOOP-007 q3, q3-31): QSideTip on an English page shows the static-fallback insight in English", () => {
  // deno-lint-ignore no-explicit-any
  const Tip = QSideTip as any;
  const { title, body } = tip(renderToString(<Tip {...enAccountFallback} lang="en" />));
  assertEquals(title, en["quotesTip.title"]);
  assertEquals(body, en["quotesInsight.staticFallback"]);
});
