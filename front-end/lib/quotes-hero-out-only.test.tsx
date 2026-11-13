/**
 * REQ-404 — demo-loop cycle 2, issue m13: "$29,500 en trabajo en manos de los
 * clientes" over two unsent drafts. Renders the real QuotesHero and the
 * dashboard's QuotesAwaiting and reads the text a person sees.
 */
import { assert, assertEquals } from "@std/assert";
import { renderToString } from "preact-render-to-string";
import { QuotesHero } from "../components/QuotesSections.tsx";
import { QuotesAwaiting } from "../components/DashSections.tsx";
import { quotesHeroNumbers } from "./headline-counts.ts";

const text = (html: string) =>
  html.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ");

function hero(
  quotes: Array<{ stage: string; value: number; client?: string }>,
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
    />,
  ));
}

const DEMO = [
  { stage: "draft", value: 1800000, client: "Ana" },
  { stage: "undelivered", value: 1150000, client: "—" },
];

Deno.test("REQ-404: two unsent drafts never read as money 'with clients' (es, the demo's words)", () => {
  const t = hero(DEMO, "es");
  assert(!/en manos de los clientes/.test(t), t);
  assert(/Nada enviado todavía/.test(t), t);
  assert(/2 borradores listos para enviar/.test(t), t);
  assert(/\$29,500/.test(t), t);
});

Deno.test("REQ-404: en drafts-only headline", () => {
  const t = hero(DEMO, "en");
  assert(!/with clients/.test(t), t);
  assert(/Nothing sent yet/.test(t), t);
  assert(/2 drafts ready to send/.test(t), t);
});

Deno.test("REQ-404: sent + draft — the headline money is the sent quote's; the draft is a separate note", () => {
  const t = hero([
    { stage: "sent", value: 500000, client: "Ana" },
    { stage: "draft", value: 900000, client: "Bo" },
  ], "en");
  assert(/\$5,000 of work sitting with clients/.test(t), t);
  assert(/1 open quote across 1 client/.test(t), t);
  assert(/\$9,000 drafting/.test(t), t);
  assert(!/\$14,000/.test(t), t);
});

Deno.test("REQ-404: dashboard 'No quotes out yet' names the ready drafts", () => {
  const en = text(renderToString(
    <QuotesAwaiting quotes={[]} lang="en" draftCount={1} />,
  ));
  assert(/No quotes out yet/.test(en), en);
  assert(/1 draft is ready to send/.test(en), en);
  const es = text(renderToString(
    <QuotesAwaiting quotes={[]} lang="es" draftCount={2} />,
  ));
  assert(/2 borradores listos para enviar/.test(es), es);
  const none = text(renderToString(<QuotesAwaiting quotes={[]} lang="en" />));
  assertEquals(/draft/i.test(none.replace(/Draft one/, "")), false, none);
});
