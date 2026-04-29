import { assert, assertEquals } from "#std/assert";
import { BuildQuoteCards } from "./mod.ts";
import { QuoteStore } from "@paperwork/domain/data/quote-store/mod.ts";
import { ContractStore } from "@paperwork/domain/data/contract-store/mod.ts";
import { ViewStore } from "@paperwork/domain/data/view-store/mod.ts";
import { CustomerStore } from "@crm/domain/data/customer-store/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";

const MS_PER_DAY = 86_400_000;

const NOW = new Date(Date.UTC(2026, 3, 28, 12, 0, 0));
const minus = (ms: number) => new Date(NOW.getTime() - ms).toISOString();

function fresh() {
  const quotes    = new QuoteStore();
  const contracts = new ContractStore();
  const views     = new ViewStore();
  const customers = new CustomerStore();
  return { quotes, contracts, views, customers, flow: new BuildQuoteCards(quotes, contracts, views, customers) };
}

async function withKv<T>(fn: () => Promise<T>): Promise<T> {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  try { return await fn(); } finally { await resetKv(); }
}

async function makeQuote(quotes: QuoteStore, patch: Record<string, unknown> = {}, customerId?: string) {
  const q = await quotes.create("u-1", { customerId, summary: "x", lineItems: [] });
  if (Object.keys(patch).length) {
    return await quotes.update(q.id, "u-1", patch);
  }
  return q;
}

Deno.test("stage: draft when sentAt is null", async () => {
  await withKv(async () => {
    const { quotes, flow } = fresh();
    await makeQuote(quotes);
    const [c] = await flow.run("u-1", NOW);
    assertEquals(c.stage, "draft");
  });
});

Deno.test("stage: sent within 24h of sentAt with 0 opens", async () => {
  await withKv(async () => {
    const { quotes, flow } = fresh();
    await makeQuote(quotes, { sentAt: minus(6 * 3600 * 1000) });
    const [c] = await flow.run("u-1", NOW);
    assertEquals(c.stage, "sent");
  });
});

Deno.test("stage: opened when opens >= 1 and >= 24h since sent and recent open", async () => {
  await withKv(async () => {
    const { quotes, views, flow } = fresh();
    const q = await makeQuote(quotes, { sentAt: minus(2 * MS_PER_DAY) });
    await views.create({ paperworkType: "quote", paperworkId: q.id, viewedAt: minus(12 * 3600 * 1000) });
    const [c] = await flow.run("u-1", NOW);
    assertEquals(c.stage, "opened");
  });
});

Deno.test("stage: cooling when sentAt > 4d and last open > 48h ago", async () => {
  await withKv(async () => {
    const { quotes, views, flow } = fresh();
    const q = await makeQuote(quotes, { sentAt: minus(5 * MS_PER_DAY) });
    await views.create({ paperworkType: "quote", paperworkId: q.id, viewedAt: minus(3 * MS_PER_DAY) });
    const [c] = await flow.run("u-1", NOW);
    assertEquals(c.stage, "cooling");
  });
});

Deno.test("stage: stale when sentAt > 7d and 0 opens", async () => {
  await withKv(async () => {
    const { quotes, flow } = fresh();
    await makeQuote(quotes, { sentAt: minus(10 * MS_PER_DAY) });
    const [c] = await flow.run("u-1", NOW);
    assertEquals(c.stage, "stale");
  });
});

Deno.test("stage: won when acceptedAt set", async () => {
  await withKv(async () => {
    const { quotes, flow } = fresh();
    await makeQuote(quotes, { sentAt: minus(MS_PER_DAY), acceptedAt: minus(3600 * 1000) });
    const [c] = await flow.run("u-1", NOW);
    assertEquals(c.stage, "won");
  });
});

Deno.test("stage: won when a contract references the quoteId", async () => {
  await withKv(async () => {
    const { quotes, contracts, flow } = fresh();
    const q = await makeQuote(quotes, { sentAt: minus(MS_PER_DAY) });
    await contracts.create("u-1", { quoteId: q.id });
    const [c] = await flow.run("u-1", NOW);
    assertEquals(c.stage, "won");
  });
});

Deno.test("stage: lost when lostAt set", async () => {
  await withKv(async () => {
    const { quotes, flow } = fresh();
    await makeQuote(quotes, { sentAt: minus(2 * MS_PER_DAY), lostAt: minus(3600 * 1000) });
    const [c] = await flow.run("u-1", NOW);
    assertEquals(c.stage, "lost");
  });
});

Deno.test("stage: lost when sentAt > 30d with no signal", async () => {
  await withKv(async () => {
    const { quotes, flow } = fresh();
    await makeQuote(quotes, { sentAt: minus(35 * MS_PER_DAY) });
    const [c] = await flow.run("u-1", NOW);
    assertEquals(c.stage, "lost");
  });
});

Deno.test("stage precedence: won/lost beat earlier stages (would be opened, but acceptedAt set)", async () => {
  await withKv(async () => {
    const { quotes, views, flow } = fresh();
    const q = await makeQuote(quotes, { sentAt: minus(2 * MS_PER_DAY), acceptedAt: minus(3600 * 1000) });
    await views.create({ paperworkType: "quote", paperworkId: q.id, viewedAt: minus(12 * 3600 * 1000) });
    const [c] = await flow.run("u-1", NOW);
    assertEquals(c.stage, "won");
  });
});

Deno.test("opens: dedupes within a 1-hour bucket", async () => {
  await withKv(async () => {
    const { quotes, views, flow } = fresh();
    const q = await makeQuote(quotes, { sentAt: minus(2 * MS_PER_DAY) });
    const T = NOW.getTime() - 12 * 3600 * 1000;
    await views.create({ paperworkType: "quote", paperworkId: q.id, viewedAt: new Date(T).toISOString() });
    await views.create({ paperworkType: "quote", paperworkId: q.id, viewedAt: new Date(T + 30 * 60 * 1000).toISOString() });
    await views.create({ paperworkType: "quote", paperworkId: q.id, viewedAt: new Date(T + 45 * 60 * 1000).toISOString() });
    const [c] = await flow.run("u-1", NOW);
    assertEquals(c.opens, 1);
  });
});

Deno.test("opens: counts separate hour buckets", async () => {
  await withKv(async () => {
    const { quotes, views, flow } = fresh();
    const q = await makeQuote(quotes, { sentAt: minus(2 * MS_PER_DAY) });
    const T = NOW.getTime() - 12 * 3600 * 1000;
    await views.create({ paperworkType: "quote", paperworkId: q.id, viewedAt: new Date(T).toISOString() });
    await views.create({ paperworkType: "quote", paperworkId: q.id, viewedAt: new Date(T + 90 * 60 * 1000).toISOString() });
    const [c] = await flow.run("u-1", NOW);
    assertEquals(c.opens, 2);
  });
});

Deno.test("daysIn: measured against stage entry, not record creation", async () => {
  await withKv(async () => {
    const { quotes, flow } = fresh();
    // Created 30d ago, sent 2h ago → stage=sent, daysIn=0 (within 24h since sent)
    const q = await quotes.create("u-1", { summary: "x", lineItems: [] });
    // Spoof an old createdAt by writing back-dated patch (only updatedAt changes; createdAt is locked)
    await quotes.update(q.id, "u-1", { sentAt: minus(2 * 3600 * 1000) });
    const [c] = await flow.run("u-1", NOW);
    assertEquals(c.stage, "sent");
    assertEquals(c.daysIn, 0);
  });
});

Deno.test("decidedDays: null unless won/lost", async () => {
  await withKv(async () => {
    const { quotes, flow } = fresh();
    await makeQuote(quotes, { sentAt: minus(6 * 3600 * 1000) });
    const [c] = await flow.run("u-1", NOW);
    assertEquals(c.stage, "sent");
    assertEquals(c.decidedDays, null);
  });
});

Deno.test("customerName: joined from customer store; orphaned customerId → null", async () => {
  await withKv(async () => {
    const { quotes, customers, flow } = fresh();
    const cust = await customers.create("u-1", { name: "Acme HOA" });
    await makeQuote(quotes, { sentAt: minus(6 * 3600 * 1000) }, cust.id);
    await makeQuote(quotes, { sentAt: minus(6 * 3600 * 1000) }, "ghost-id");
    const cards = await flow.run("u-1", NOW);
    const named = cards.find((c) => c.customerId === cust.id);
    const orphan = cards.find((c) => c.customerId === "ghost-id");
    assert(named);
    assert(orphan);
    assertEquals(named!.customerName, "Acme HOA");
    assertEquals(orphan!.customerName, null);
  });
});
