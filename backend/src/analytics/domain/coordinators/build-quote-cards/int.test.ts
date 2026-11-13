import { assert, assertEquals } from "#std/assert";
import { BuildQuoteCards } from "./mod.ts";
import { QuoteStore } from "@paperwork/domain/data/quote-store/mod.ts";
import { ViewStore } from "@paperwork/domain/data/view-store/mod.ts";
import { CustomerStore } from "@crm/domain/data/customer-store/mod.ts";
import { ChangeOrderStore } from "@paperwork/domain/data/change-order-store/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";

const MS_PER_DAY = 86_400_000;

const NOW = new Date(Date.UTC(2026, 3, 28, 12, 0, 0));
const minus = (ms: number) => new Date(NOW.getTime() - ms).toISOString();

function fresh() {
  const quotes = new QuoteStore();
  const views = new ViewStore();
  const customers = new CustomerStore();
  return {
    quotes,
    views,
    customers,
    flow: new BuildQuoteCards(quotes, views, customers),
  };
}

async function withKv<T>(fn: () => Promise<T>): Promise<T> {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  try {
    return await fn();
  } finally {
    await resetKv();
  }
}

async function makeQuote(
  quotes: QuoteStore,
  patch: Record<string, unknown> = {},
  customerId?: string,
) {
  const q = await quotes.create("u-1", {
    customerId,
    summary: "x",
    lineItems: [],
  });
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
    await views.create({
      paperworkType: "quote",
      paperworkId: q.id,
      viewedAt: minus(12 * 3600 * 1000),
    });
    const [c] = await flow.run("u-1", NOW);
    assertEquals(c.stage, "opened");
  });
});

Deno.test("stage: cooling when sentAt > 4d and last open > 48h ago", async () => {
  await withKv(async () => {
    const { quotes, views, flow } = fresh();
    const q = await makeQuote(quotes, { sentAt: minus(5 * MS_PER_DAY) });
    await views.create({
      paperworkType: "quote",
      paperworkId: q.id,
      viewedAt: minus(3 * MS_PER_DAY),
    });
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
    await makeQuote(quotes, {
      sentAt: minus(MS_PER_DAY),
      acceptedAt: minus(3600 * 1000),
    });
    const [c] = await flow.run("u-1", NOW);
    assertEquals(c.stage, "won");
  });
});

Deno.test("stage: won on status 'accepted' even without an acceptedAt stamp", async () => {
  await withKv(async () => {
    const { quotes, flow } = fresh();
    await makeQuote(quotes, { sentAt: minus(MS_PER_DAY), status: "accepted" });
    const [c] = await flow.run("u-1", NOW);
    assertEquals(c.stage, "won");
  });
});

Deno.test("stage: an UNSIGNED agreement leaves a sent quote awaiting (problems.md P-14)", async () => {
  await withKv(async () => {
    const { quotes, flow } = fresh();
    // The quote IS the agreement now: drafted terms on the quote are not a
    // signature — only acceptance (the one ceremony) wins.
    await makeQuote(quotes, {
      sentAt: minus(MS_PER_DAY),
      terms: [{
        stepId: "payment_terms",
        label: "Payment terms",
        value: "50 / 50",
      }],
    });
    const [c] = await flow.run("u-1", NOW);
    assertEquals(c.stage, "sent");
  });
});

Deno.test("stage: lost when lostAt set", async () => {
  await withKv(async () => {
    const { quotes, flow } = fresh();
    await makeQuote(quotes, {
      sentAt: minus(2 * MS_PER_DAY),
      lostAt: minus(3600 * 1000),
    });
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
    const q = await makeQuote(quotes, {
      sentAt: minus(2 * MS_PER_DAY),
      acceptedAt: minus(3600 * 1000),
    });
    await views.create({
      paperworkType: "quote",
      paperworkId: q.id,
      viewedAt: minus(12 * 3600 * 1000),
    });
    const [c] = await flow.run("u-1", NOW);
    assertEquals(c.stage, "won");
  });
});

Deno.test("opens: dedupes within a 1-hour bucket", async () => {
  await withKv(async () => {
    const { quotes, views, flow } = fresh();
    const q = await makeQuote(quotes, { sentAt: minus(2 * MS_PER_DAY) });
    const T = NOW.getTime() - 12 * 3600 * 1000;
    await views.create({
      paperworkType: "quote",
      paperworkId: q.id,
      viewedAt: new Date(T).toISOString(),
    });
    await views.create({
      paperworkType: "quote",
      paperworkId: q.id,
      viewedAt: new Date(T + 30 * 60 * 1000).toISOString(),
    });
    await views.create({
      paperworkType: "quote",
      paperworkId: q.id,
      viewedAt: new Date(T + 45 * 60 * 1000).toISOString(),
    });
    const [c] = await flow.run("u-1", NOW);
    assertEquals(c.opens, 1);
  });
});

Deno.test("opens: counts separate hour buckets", async () => {
  await withKv(async () => {
    const { quotes, views, flow } = fresh();
    const q = await makeQuote(quotes, { sentAt: minus(2 * MS_PER_DAY) });
    const T = NOW.getTime() - 12 * 3600 * 1000;
    await views.create({
      paperworkType: "quote",
      paperworkId: q.id,
      viewedAt: new Date(T).toISOString(),
    });
    await views.create({
      paperworkType: "quote",
      paperworkId: q.id,
      viewedAt: new Date(T + 90 * 60 * 1000).toISOString(),
    });
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

// REQ-236 (demo M8): an undelivered quote is never "sent" / "Just sent" /
// "Out for response" — its stage is "undelivered".
Deno.test("REQ-236: stage undelivered when the last send reached nobody (status sent, 0 opens, <24h)", async () => {
  await withKv(async () => {
    const { quotes, flow } = fresh();
    await makeQuote(quotes, {
      status: "sent",
      sentAt: minus(3_600_000),
      lastDelivery: {
        at: minus(3_600_000),
        channel: "sms",
        smsFailureReason: "Twilio 21211: Invalid 'To' Phone Number",
      },
    });
    const [c] = await flow.run("u-1", NOW);
    assertEquals(c.stage, "undelivered");
  });
});

Deno.test("REQ-236: stage undelivered on a draft whose send failed", async () => {
  await withKv(async () => {
    const { quotes, flow } = fresh();
    await makeQuote(quotes, {
      lastDelivery: {
        at: minus(60_000),
        channel: "email",
        emailFailureReason: "no recipient",
      },
    });
    const [c] = await flow.run("u-1", NOW);
    assertEquals(c.stage, "undelivered");
  });
});

Deno.test("REQ-236: a quote once delivered stays sent even if a later resend failed", async () => {
  await withKv(async () => {
    const { quotes, flow } = fresh();
    await makeQuote(quotes, {
      status: "sent",
      sentAt: minus(3_600_000),
      deliveredAt: minus(3_600_000),
      lastDelivery: {
        at: minus(60_000),
        channel: "sms",
        smsFailureReason: "carrier down",
      },
    });
    const [c] = await flow.run("u-1", NOW);
    assertEquals(c.stage, "sent");
  });
});

Deno.test("REQ-236: acceptance beats a stale delivery failure", async () => {
  await withKv(async () => {
    const { quotes, flow } = fresh();
    await makeQuote(quotes, {
      status: "accepted",
      acceptedAt: minus(60_000),
      lastDelivery: {
        at: minus(3_600_000),
        channel: "email",
        emailFailureReason: "no recipient",
      },
    });
    const [c] = await flow.run("u-1", NOW);
    assertEquals(c.stage, "won");
  });
});

// REQ-481 (demo-loop cycle 3, M28 + m10): the /quotes card carries the
// approved change orders (its value is the agreement, not the bare quote) and
// the numbers of the change orders still waiting on the customer.
Deno.test("REQ-481 card: approvedChangeOrdersCents + pendingChangeOrders from the quote's change orders", async () => {
  await withKv(async () => {
    const quotes = new QuoteStore();
    const views = new ViewStore();
    const customers = new CustomerStore();
    const cos = new ChangeOrderStore();
    const flow = new BuildQuoteCards(quotes, views, customers, cos);
    const q = await makeQuote(quotes, {
      status: "accepted",
      acceptedAt: minus(MS_PER_DAY),
      sentAt: minus(2 * MS_PER_DAY),
      estimatedTotal: 705000,
    });
    const other = await makeQuote(quotes, { estimatedTotal: 1000 });
    const approved = await cos.create("u-1", "inv-1", {
      quoteId: q.id,
      description: "Extra coat",
      deltaAmountCents: 120000,
    });
    await cos.setStatus(approved.id, "approved");
    const declined = await cos.create("u-1", "inv-1", {
      quoteId: q.id,
      description: "Skip trim",
      deltaAmountCents: -5000,
    });
    await cos.setStatus(declined.id, "declined");
    const pending = await cos.create("u-1", "inv-1", {
      quoteId: q.id,
      description: "Add closet",
      deltaAmountCents: 30000,
    });
    const cards = await flow.run("u-1", NOW);
    const card = cards.find((c) => c.id === q.id)!;
    assertEquals(card.approvedChangeOrdersCents, 120000);
    assertEquals(card.pendingChangeOrders, [pending.number]);
    const bare = cards.find((c) => c.id === other.id)!;
    assertEquals(bare.approvedChangeOrdersCents, 0);
    assertEquals(bare.pendingChangeOrders, []);
  });
});
