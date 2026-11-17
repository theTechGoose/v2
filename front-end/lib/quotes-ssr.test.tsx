/**
 * REQ-471 — demo-loop cycle 3, issue p8-pair2-d: "/quotes blank for 1–2 s on
 * load". The route server-rendered <QuotesPage /> with no data, so the first
 * HTML was a pale skeleton until the island hydrated and fetched /quotes.
 *
 * - loadQuotesSeed() reads GET /quotes (+ win-rate, insight) on the SSR side
 *   with the caller's session, and returns null when the list can't be read
 *   (the island then falls back to its client fetch).
 * - QuotesPage seeded with that data renders the quote cards on its FIRST
 *   render — no skeleton — so the server HTML already shows them.
 */
import { assert, assertEquals } from "@std/assert";
import { renderToString } from "preact-render-to-string";
import QuotesPage from "../islands/QuotesPage.tsx";
import { loadQuotesSeed, type QuotesSeed } from "./quotes-ssr.ts";
import type { QuoteCard } from "../clients/quotes.ts";

const src = (p: string) => Deno.readTextFileSync(new URL(p, import.meta.url));

function card(over: Partial<QuoteCard> = {}): QuoteCard {
  return {
    id: "q-471",
    userId: "u-471",
    customerId: "c-471",
    customerName: "Opal Card",
    summary: "Fence repair — Opal Card",
    jobName: "Fence repair",
    estimatedTotal: 50000,
    status: "sent",
    number: "Q-001",
    version: 1,
    createdAt: "2026-11-12T10:00:00.000Z",
    updatedAt: "2026-11-12T10:00:00.000Z",
    stage: "sent",
    daysIn: 0,
    opens: 0,
    lastOpenAt: null,
    sentDays: 0,
    decidedDays: null,
    ...over,
  };
}

type Call = { path: string; sessionId: string | undefined };

function fakeGet(
  answers: Record<string, { ok: boolean; status: number; data?: unknown }>,
  calls: Call[],
) {
  return <T,>(path: string, sessionId: string | undefined) => {
    calls.push({ path, sessionId });
    const key = Object.keys(answers).find((k) => path.startsWith(k));
    const a = key ? answers[key] : { ok: false, status: 404 };
    return Promise.resolve(
      a as { ok: boolean; status: number; data?: T },
    );
  };
}

Deno.test("REQ-471 (p8-pair2-d) loadQuotesSeed reads /quotes, win-rate and insight with the caller's session", async () => {
  const calls: Call[] = [];
  const seed = await loadQuotesSeed(
    "sess-471",
    fakeGet({
      "/quotes": { ok: true, status: 200, data: [card()] },
      "/analytics/quotes/win-rate": {
        ok: true,
        status: 200,
        data: { windowDays: 90, decided: 0, won: 0, lost: 0, winRate: null },
      },
      "/analytics/quotes/insight": {
        ok: true,
        status: 200,
        data: { text: "1 quote out", kind: "open_count" },
      },
    }, calls),
  );
  assert(seed, "a seed came back");
  assertEquals(seed.cards.map((c) => c.id), ["q-471"]);
  assertEquals(seed.winRate?.windowDays, 90);
  assertEquals(seed.insight?.kind, "open_count");
  assert(
    calls.every((c) => c.sessionId === "sess-471"),
    "every read carries the session",
  );
  assert(
    calls.some((c) => c.path === "/analytics/quotes/win-rate?days=90"),
    "win-rate is read over the same 90-day window the island uses",
  );
});

Deno.test("REQ-471 (p8-pair2-d) loadQuotesSeed: no session or an unreadable list → null (the island fetches); a failed side read → null field", async () => {
  assertEquals(await loadQuotesSeed(undefined, fakeGet({}, [])), null);
  assertEquals(
    await loadQuotesSeed(
      "s",
      fakeGet({ "/quotes": { ok: false, status: 500 } }, []),
    ),
    null,
  );
  const thrown = await loadQuotesSeed(
    "s",
    () => Promise.reject(new Error("backend down")),
  );
  assertEquals(thrown, null);
  const partial = await loadQuotesSeed(
    "s",
    fakeGet({ "/quotes": { ok: true, status: 200, data: [card()] } }, []),
  );
  assert(partial);
  assertEquals(partial.winRate, null);
  assertEquals(partial.insight, null);
});

Deno.test("REQ-471 (p8-pair2-d) QuotesPage seeded with the list renders the quote card on its first render — no skeleton", () => {
  const seed: QuotesSeed = {
    cards: [card()],
    winRate: null,
    insight: null,
  };
  const html = renderToString(<QuotesPage seed={seed} />);
  assert(html.includes('class="qcard'), "a quote card is in the first HTML");
  assert(html.includes("Fence repair"), "the card names the job");
  assert(!html.includes("skel"), "no shimmer skeleton");
});

Deno.test("REQ-471 (p8-pair2-d) QuotesPage without a seed still starts on the skeleton (client fetch fallback)", () => {
  const html = renderToString(<QuotesPage />);
  assert(!html.includes('class="qcard'), "no card without data");
});

Deno.test("REQ-471 (p8-pair2-d) the /quotes route loads the seed server-side and hands it to the island", () => {
  const route = src("../routes/quotes/index.tsx");
  assert(route.includes("loadQuotesSeed("), "the route calls loadQuotesSeed");
  assert(
    /<QuotesPage\s+seed=\{seed\}/.test(route),
    "the route passes seed={seed} to QuotesPage",
  );
});
