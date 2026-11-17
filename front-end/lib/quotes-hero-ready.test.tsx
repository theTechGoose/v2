/**
 * REQ-760 (demo-loop cycle 5v2, demo issue m14): after REQ-698 the verifier
 * still read "Nothing sent yet — 1 draft ready to send." on /quotes for
 * Q-002 Bob Smith, a draft the assistant had only drafted. The /quotes hero
 * now says "ready to send" only for drafts the server marks readyToSend;
 * the rest are "in progress". Renders the real QuotesHero.
 */
import { assert } from "@std/assert";
import { renderToString } from "preact-render-to-string";
import { QuotesHero } from "../components/QuotesSections.tsx";
import { quotesHeroNumbers } from "./headline-counts.ts";

const text = (html: string) =>
  html.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ");

function hero(
  quotes: Array<{ stage: string; value: number; readyToSend?: boolean }>,
  lang: "en" | "es",
) {
  const n = quotesHeroNumbers(quotes);
  return text(renderToString(
    <QuotesHero
      lang={lang}
      totalCount={quotes.length}
      openCount={n.outCount}
      openTotal={n.outTotal}
      staleCount={n.staleCount}
      clientCount={n.outClients}
      draftCount={n.draftCount}
      draftTotal={n.draftTotal}
      decidedCount={n.decidedCount}
      undeliveredCount={n.undeliveredCount}
      undeliveredTotal={n.undeliveredTotal}
      readyCount={n.readyCount}
    />,
  ));
}

const BOB = { stage: "draft", value: 240000, readyToSend: false };

Deno.test("REQ-760 (cycle 5v2, m14): the verifier's Q-002 — a drafted-only draft is 'in progress', never 'ready to send' (en)", () => {
  const t = hero([BOB], "en");
  assert(!/ready to send/.test(t), t);
  assert(/Nothing sent yet — 1 draft in progress/.test(t), t);
});

Deno.test("REQ-760 (cycle 5v2, m14): the same in Spanish", () => {
  const t = hero([BOB], "es");
  assert(!/listo para enviar/.test(t), t);
  assert(/Nada enviado todavía — 1 borrador en curso/.test(t), t);
});

Deno.test("REQ-760 (cycle 5v2, m14): a draft the server marks ready still reads 'ready to send'; only the ready ones are counted", () => {
  assert(
    /Nothing sent yet — 1 draft ready to send/.test(
      hero([BOB, { stage: "draft", value: 145000, readyToSend: true }], "en"),
    ),
  );
  assert(
    /Nothing sent yet — 1 draft ready to send/.test(
      hero([{ stage: "draft", value: 145000, readyToSend: true }], "en"),
    ),
  );
});

Deno.test("REQ-760 (cycle 5v2, m14): quotesHeroNumbers.readyCount counts drafts the server marked ready (absent flag = an older server = ready)", () => {
  const n = quotesHeroNumbers([
    BOB,
    { stage: "draft", value: 1, readyToSend: true },
    { stage: "draft", value: 1 },
    { stage: "undelivered", value: 1, readyToSend: true },
    { stage: "sent", value: 1 },
  ]);
  assert(n.readyCount === 2, String(n.readyCount));
});
