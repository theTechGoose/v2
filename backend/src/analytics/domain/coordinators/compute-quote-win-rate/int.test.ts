import { assertEquals } from "#std/assert";
import { ComputeQuoteWinRate } from "./mod.ts";
import { QuoteStore } from "@paperwork/domain/data/quote-store/mod.ts";
import { ContractStore } from "@paperwork/domain/data/contract-store/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";

const MS_PER_DAY = 86_400_000;
const NOW = new Date(Date.UTC(2026, 3, 28));
const minus = (days: number) => new Date(NOW.getTime() - days * MS_PER_DAY).toISOString();

function fresh() {
  const quotes    = new QuoteStore();
  const contracts = new ContractStore();
  return { quotes, contracts, flow: new ComputeQuoteWinRate(quotes, contracts) };
}

async function withKv<T>(fn: () => Promise<T>): Promise<T> {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  try { return await fn(); } finally { await resetKv(); }
}

Deno.test("windowDays: excludes decisions outside the window", async () => {
  await withKv(async () => {
    const { quotes, flow } = fresh();
    const q = await quotes.create("u-1", { summary: "x", lineItems: [] });
    await quotes.update(q.id, "u-1", { acceptedAt: minus(100) });
    const r = await flow.run("u-1", 90, NOW);
    assertEquals(r.decided, 0);
  });
});

Deno.test("winRate: null when decided === 0", async () => {
  await withKv(async () => {
    const { flow } = fresh();
    const r = await flow.run("u-1", 90, NOW);
    assertEquals(r.winRate, null);
    assertEquals(r.decided, 0);
  });
});

Deno.test("winRate: 50% on 1 won + 1 lost", async () => {
  await withKv(async () => {
    const { quotes, flow } = fresh();
    const q1 = await quotes.create("u-1", { summary: "won", lineItems: [] });
    await quotes.update(q1.id, "u-1", { acceptedAt: minus(5) });
    const q2 = await quotes.create("u-1", { summary: "lost", lineItems: [] });
    await quotes.update(q2.id, "u-1", { lostAt: minus(3) });
    const r = await flow.run("u-1", 90, NOW);
    assertEquals(r.won, 1);
    assertEquals(r.lost, 1);
    assertEquals(r.winRate, 50);
  });
});
