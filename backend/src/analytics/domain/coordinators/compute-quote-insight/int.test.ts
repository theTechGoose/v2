import { assert, assertEquals } from "#std/assert";
import { ComputeQuoteInsight } from "./mod.ts";
import { QuoteStore } from "@paperwork/domain/data/quote-store/mod.ts";
import { ViewStore } from "@paperwork/domain/data/view-store/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";

function fresh() {
  const quotes = new QuoteStore();
  const views  = new ViewStore();
  return { quotes, views, flow: new ComputeQuoteInsight(quotes, views) };
}

async function withKv<T>(fn: () => Promise<T>): Promise<T> {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  try { return await fn(); } finally { await resetKv(); }
}

Deno.test("insight: returns static_fallback when decided count < 10", async () => {
  await withKv(async () => {
    const { quotes, flow } = fresh();
    // Seed 5 decisions — under the 10-quote threshold
    for (let i = 0; i < 5; i++) {
      const q = await quotes.create("u-1", { summary: `q${i}`, lineItems: [] });
      await quotes.update(q.id, "u-1", { acceptedAt: new Date().toISOString() });
    }
    const r = await flow.run("u-1");
    assertEquals(r.kind, "static_fallback");
    assert(r.text.length > 0);
  });
});

Deno.test("insight: returns open_count observation when decided count >= 10 and data supports it", async () => {
  await withKv(async () => {
    const { quotes, views, flow } = fresh();
    // 10 accepted quotes, each with 2 view events
    for (let i = 0; i < 10; i++) {
      const q = await quotes.create("u-1", { summary: `q${i}`, lineItems: [] });
      const acceptedAt = new Date().toISOString();
      await views.create({ paperworkType: "quote", paperworkId: q.id, viewedAt: new Date(Date.now() - 2000).toISOString() });
      await views.create({ paperworkType: "quote", paperworkId: q.id, viewedAt: new Date(Date.now() - 1000).toISOString() });
      await quotes.update(q.id, "u-1", { acceptedAt });
    }
    const r = await flow.run("u-1");
    assertEquals(r.kind, "open_count");
    assert(r.text.length > 0);
    assert(r.text.includes("opened"));
  });
});
