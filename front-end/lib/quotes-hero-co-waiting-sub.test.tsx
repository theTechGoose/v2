/**
 * REQ-1106 (LOOP-007 cycle 3, q3-32) — after Jose declined Q-002, nothing
 * was out and the rest were signed, so the /quotes hero was "settled". REQ-481
 * swapped only its h1 for the waiting change order, so it read:
 *   "CO-002 is waiting on Maria Lopez."
 *   "Every quote you have sent is decided. Start the next one when you are ready."
 * The line under a waiting change order must not be the "nothing is waiting"
 * subline. Renders the real QuotesHero and reads the text a person sees.
 */
import { assert } from "@std/assert";
import { renderToString } from "preact-render-to-string";
import { QuotesHero } from "../components/QuotesSections.tsx";
import en from "../../lang/en.json" with { type: "json" };
import es from "../../lang/es.json" with { type: "json" };

const text = (html: string) =>
  html.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&#39;/g, "'")
    .replace(/\s+/g, " ").trim();

/** Settled: two quotes, both decided (one signed, one declined), none out. */
function settledHero(
  lang: "en" | "es",
  pendingChangeOrders: Array<{ number: string; client: string }>,
) {
  return text(renderToString(
    <QuotesHero
      lang={lang}
      totalCount={2}
      openCount={0}
      openTotal={0}
      staleCount={0}
      clientCount={0}
      decidedCount={2}
      pendingChangeOrders={pendingChangeOrders}
    />,
  ));
}

const SETTLED_SUB = {
  en: (en as Record<string, string>)["quotesHero.settledSub"],
  es: (es as Record<string, string>)["quotesHero.settledSub"],
};

for (const lang of ["en", "es"] as const) {
  Deno.test(`REQ-1106 (q3-32): settled hero with a waiting change order does not say every quote is decided under it (${lang})`, () => {
    const t = settledHero(lang, [{ number: "CO-002", client: "Maria Lopez" }]);
    const title = lang === "en"
      ? "CO-002 is waiting on Maria Lopez."
      : "CO-002 está esperando a Maria Lopez.";
    assert(t.includes(title), `the h1 names the waiting change order: ${t}`);
    assert(
      !t.includes(SETTLED_SUB[lang]),
      `the subline under "${title}" must not be settledSub "${
        SETTLED_SUB[lang]
      }" — hero: ${t}`,
    );
  });

  Deno.test(`REQ-1106 (q3-32): settled hero with no change order keeps settledTitle + settledSub (${lang})`, () => {
    const t = settledHero(lang, []);
    assert(t.includes(SETTLED_SUB[lang]), t);
  });
}
