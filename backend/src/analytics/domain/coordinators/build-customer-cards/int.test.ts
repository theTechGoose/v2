import { assert, assertEquals, assertGreater } from "#std/assert";
import { BuildCustomerCards } from "./mod.ts";
import { CustomerStore } from "@crm/domain/data/customer-store/mod.ts";
import { QuoteStore } from "@paperwork/domain/data/quote-store/mod.ts";
import { InvoiceStore } from "@paperwork/domain/data/invoice-store/mod.ts";
import { ViewStore } from "@paperwork/domain/data/view-store/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";

const MS_PER_DAY = 86_400_000;

function fresh() {
  const customers = new CustomerStore();
  const quotes    = new QuoteStore();
  const invoices  = new InvoiceStore();
  const views     = new ViewStore();
  return { customers, quotes, invoices, views, flow: new BuildCustomerCards(customers, quotes, invoices, views) };
}

async function withKv<T>(fn: () => Promise<T>): Promise<T> {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  try { return await fn(); } finally { await resetKv(); }
}

const NOW_FIXED = new Date(Date.UTC(2026, 3, 28, 12, 0, 0));
const isoOffset = (offsetDays: number) => new Date(NOW_FIXED.getTime() - offsetDays * MS_PER_DAY).toISOString();

Deno.test("status: owes wins when balance > 0 (overrides active)", async () => {
  await withKv(async () => {
    const { customers, quotes, invoices, flow } = fresh();
    const c = await customers.create("u-1", { name: "Acme" });
    const q = await quotes.create("u-1", { customerId: c.id, summary: "x", lineItems: [], status: "accepted" });
    await quotes.update(q.id, "u-1", { acceptedAt: isoOffset(2) });
    await invoices.create("u-1", { contractId: "k", customerId: c.id, dueDate: "2026-03-01", status: "pending", amount: 100 });
    const [card] = await flow.run("u-1", NOW_FIXED);
    assertEquals(card.status, "owes");
  });
});

Deno.test("status: active when accepted quote exists with no terminal invoice", async () => {
  await withKv(async () => {
    const { customers, quotes, flow } = fresh();
    const c = await customers.create("u-1", { name: "Acme" });
    const q = await quotes.create("u-1", { customerId: c.id, summary: "x", lineItems: [], status: "accepted" });
    await quotes.update(q.id, "u-1", { acceptedAt: isoOffset(1) });
    const [card] = await flow.run("u-1", NOW_FIXED);
    assertEquals(card.status, "active");
  });
});

Deno.test("status: lead when only draft/sent quotes", async () => {
  await withKv(async () => {
    const { customers, quotes, flow } = fresh();
    const c = await customers.create("u-1", { name: "Acme" });
    await quotes.create("u-1", { customerId: c.id, summary: "x", lineItems: [], status: "draft" });
    await quotes.create("u-1", { customerId: c.id, summary: "y", lineItems: [], status: "sent" });
    const [card] = await flow.run("u-1", NOW_FIXED);
    assertEquals(card.status, "lead");
  });
});

Deno.test("status: regular when 12mo revenue > 0 and no active job", async () => {
  await withKv(async () => {
    const { customers, invoices, flow } = fresh();
    const c = await customers.create("u-1", { name: "Acme" });
    await invoices.create("u-1", {
      contractId: "k", customerId: c.id, dueDate: "2026-03-15",
      status: "paid", amount: 500, paidAt: isoOffset(40),
    });
    const [card] = await flow.run("u-1", NOW_FIXED);
    assertEquals(card.status, "regular");
  });
});

Deno.test("status: cold when daysSinceContact > 60 and not owes", async () => {
  await withKv(async () => {
    const { customers, flow } = fresh();
    const c = await customers.create("u-1", { name: "Acme" });
    const FAR_FUTURE = new Date(new Date(c.createdAt).getTime() + 90 * MS_PER_DAY);
    const [card] = await flow.run("u-1", FAR_FUTURE);
    assertEquals(card.status, "cold");
  });
});

Deno.test("temp: monotonic in daysSinceContact (newer customer has higher temp)", async () => {
  await withKv(async () => {
    const { customers, flow } = fresh();
    const c = await customers.create("u-1", { name: "Solo" });
    const tCreated = new Date(c.createdAt).getTime();
    const tempAt = async (offsetDays: number) =>
      (await flow.run("u-1", new Date(tCreated + offsetDays * MS_PER_DAY)))[0].temp;
    const tempNew = await tempAt(0);
    const tempOld = await tempAt(20);
    assertGreater(tempNew, tempOld);
  });
});

Deno.test("temp: vip bumps score by 15", async () => {
  await withKv(async () => {
    const { customers, flow } = fresh();
    const cPlain = await customers.create("u-1", { name: "Plain" });
    const cVip   = await customers.create("u-2", { name: "VIP", vip: true });
    // Run 30 days after each customer's createdAt so the base score isn't pinned at 100.
    const plainCard = (await flow.run("u-1", new Date(new Date(cPlain.createdAt).getTime() + 30 * MS_PER_DAY)))[0];
    const vipCard   = (await flow.run("u-2", new Date(new Date(cVip.createdAt).getTime()   + 30 * MS_PER_DAY)))[0];
    assertEquals(vipCard.temp - plainCard.temp, 15);
  });
});

Deno.test("temp: clamped to [0,100]", async () => {
  await withKv(async () => {
    const { customers, flow } = fresh();
    const c = await customers.create("u-1", { name: "Stale" });
    const VERY_LATE = new Date(new Date(c.createdAt).getTime() + 1000 * MS_PER_DAY);
    const card = (await flow.run("u-1", VERY_LATE))[0];
    assert(card.temp >= 0 && card.temp <= 100);
  });
});

Deno.test("balanceCents: positive when invoices owed (deposits offset)", async () => {
  await withKv(async () => {
    const { customers, invoices, flow } = fresh();
    const c = await customers.create("u-1", { name: "Acme" });
    // Audit1 #3 — invoice.amount is INTEGER CENTS now.
    await invoices.create("u-1", { contractId: "k", customerId: c.id, dueDate: "2026-04-30", status: "pending", amount: 200_00 });
    await invoices.create("u-1", { contractId: "k", customerId: c.id, dueDate: "2026-04-15", status: "deposit", amount: 50_00 });
    const [card] = await flow.run("u-1", NOW_FIXED);
    assertEquals(card.balanceCents, 200_00 - 50_00);
  });
});

Deno.test("balanceCents: negative on credit", async () => {
  await withKv(async () => {
    const { customers, invoices, flow } = fresh();
    const c = await customers.create("u-1", { name: "Acme" });
    await invoices.create("u-1", { contractId: "k", customerId: c.id, dueDate: "2026-04-15", status: "credit", amount: 100 });
    const [card] = await flow.run("u-1", NOW_FIXED);
    assert(card.balanceCents < 0);
  });
});

Deno.test("revenue12moCents: excludes invoices outside window", async () => {
  await withKv(async () => {
    const { customers, invoices, flow } = fresh();
    const c = await customers.create("u-1", { name: "Acme" });
    // INTEGER CENTS.
    await invoices.create("u-1", { contractId: "k", customerId: c.id, dueDate: "2025-03-01", status: "paid", amount: 500_00, paidAt: isoOffset(400) });
    await invoices.create("u-1", { contractId: "k", customerId: c.id, dueDate: "2026-04-01", status: "paid", amount: 200_00, paidAt: isoOffset(20) });
    const [card] = await flow.run("u-1", NOW_FIXED);
    assertEquals(card.revenue12moCents, 200_00);
  });
});

Deno.test("lastWhen: takes max across quote/invoice/view events", async () => {
  await withKv(async () => {
    const { customers, quotes, views, flow } = fresh();
    const c = await customers.create("u-1", { name: "Acme" });
    const q = await quotes.create("u-1", { customerId: c.id, summary: "x", lineItems: [] });
    // Now make a view event in the future relative to c.createdAt
    const tCreated = new Date(c.createdAt).getTime();
    const VIEW_AT = new Date(tCreated + 5 * MS_PER_DAY).toISOString();
    await views.create({ paperworkType: "quote", paperworkId: q.id, viewedAt: VIEW_AT });
    const FUTURE = new Date(tCreated + 8 * MS_PER_DAY);   // 3d after view
    const [card] = await flow.run("u-1", FUTURE);
    // The view at +5d is the latest signal; daysSinceContact = 3
    assertEquals(card.daysSinceContact, 3);
  });
});

Deno.test("daysSinceContact: rounds down (36h → 1)", async () => {
  await withKv(async () => {
    const { customers, flow } = fresh();
    const c = await customers.create("u-1", { name: "Acme" });
    const T_PLUS_36H = new Date(new Date(c.createdAt).getTime() + 36 * 3600 * 1000);
    const [card] = await flow.run("u-1", T_PLUS_36H);
    assertEquals(card.daysSinceContact, 1);
  });
});
