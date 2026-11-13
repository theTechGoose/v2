/**
 * REQ-778 (demo-loop cycle dv1, issue d8 "Free plan: five quotes a month,
 * enforced and stated"): Raphael — "The free plan limit is five quotes."
 * REQ-766 refuses the sixth on the API (402 quote_limit) and in the chat.
 * What was missing: the New quote path (/quotes → /assistant → the wizard's
 * POST /quotes) showed "POST /quotes failed: 402", and /quotes said nothing.
 * Now the 402 reads as the limit message, and /quotes says it above New quote.
 */
import { assert, assertEquals } from "@std/assert";
import { renderToString } from "preact-render-to-string";
import { ApiError } from "./api.ts";
import { quoteLimitFromError, quoteLimitMessage } from "./quote-limit.ts";
import { QuotesHero } from "../components/QuotesSections.tsx";

const text = (html: string) =>
  html.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ");

const REFUSED = { ok: false, reason: "quote_limit", limit: 5, used: 5 };

Deno.test("REQ-778 dv1 d8: a 402 quote_limit from POST /quotes is read as the limit; other errors are not", () => {
  assertEquals(
    quoteLimitFromError(new ApiError(402, REFUSED, "POST /quotes failed: 402")),
    { limit: 5, used: 5 },
  );
  assertEquals(quoteLimitFromError(new ApiError(500, REFUSED)), null);
  assertEquals(quoteLimitFromError(new ApiError(402, { ok: false })), null);
  assertEquals(quoteLimitFromError(new Error("network")), null);
  assertEquals(quoteLimitFromError(undefined), null);
});

Deno.test("REQ-778 dv1 d8: the limit message names five quotes, Monster Free and how to upgrade (en)", () => {
  const m = quoteLimitMessage("en", 5);
  assert(/5 quotes for this month on Monster Free/.test(m), m);
  assert(/upgrade in Settings → Billing/.test(m), m);
  assert(/start again on the 1st/.test(m), m);
});

Deno.test("REQ-778 dv1 d8: the limit message in Spanish", () => {
  const m = quoteLimitMessage("es", 5);
  assert(/5 cotizaciones de este mes en Monster Free/.test(m), m);
  assert(/Configuración → Facturación/.test(m), m);
  assert(/día 1/.test(m), m);
});

function hero(lang: "en" | "es", quoteLimit?: { limit: number }) {
  return renderToString(
    <QuotesHero
      lang={lang}
      totalCount={5}
      openCount={0}
      openTotal={0}
      staleCount={0}
      clientCount={0}
      draftCount={5}
      draftTotal={150000}
      readyCount={5}
      quoteLimit={quoteLimit}
    />,
  );
}

Deno.test("REQ-778 dv1 d8: /quotes at the cap says the five quotes are used and links to the plan (en + es)", () => {
  const en = hero("en", { limit: 5 });
  assert(/data-cy="quote-limit-note"/.test(en), en);
  assert(/5 quotes for this month on Monster Free/.test(text(en)), text(en));
  assert(/href="\/settings\?tab=billing"/.test(en), en);
  const es = text(hero("es", { limit: 5 }));
  assert(/5 cotizaciones de este mes en Monster Free/.test(es), es);
});

Deno.test("REQ-778 dv1 d8: under the cap /quotes shows no limit note", () => {
  assert(!/quote-limit-note/.test(hero("en")));
});

Deno.test("REQ-778 dv1 d8: the /quotes seed reads GET /quotes/allowance, and the seeded page shows the note on its first render", async () => {
  const { loadQuotesSeed } = await import("./quotes-ssr.ts");
  const { default: QuotesPage } = await import("../islands/QuotesPage.tsx");
  const paths: string[] = [];
  const get = <T,>(path: string) => {
    paths.push(path);
    const data = path === "/quotes/allowance"
      ? REFUSED
      : path === "/quotes"
      ? []
      : null;
    return Promise.resolve({ ok: data !== null, status: 200, data: data as T });
  };
  const seed = await loadQuotesSeed("sess-778", get);
  assert(seed);
  assert(paths.includes("/quotes/allowance"), paths.join(","));
  assertEquals(seed.quoteLimit, { limit: 5, used: 5 });
  const html = renderToString(<QuotesPage seed={seed} />);
  assert(
    /data-cy="quote-limit-note"/.test(html),
    "the seeded page shows the note",
  );
  const under = await loadQuotesSeed(
    "s",
    <T,>(path: string) =>
      Promise.resolve({
        ok: true,
        status: 200,
        data: (path === "/quotes/allowance" ? { ok: true } : []) as T,
      }),
  );
  assertEquals(under?.quoteLimit, null);
});
