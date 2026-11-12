import { assert, assertEquals, assertGreater } from "#std/assert";
import { BuildCustomerCards } from "./mod.ts";
import { t } from "@core/i18n/mod.ts";
import { balanceSubLabel } from "#quote-flow/balance-sub.ts";
import type { CustomerCard } from "@crm/dto/customer.ts";
import { CustomerStore } from "@crm/domain/data/customer-store/mod.ts";
import { QuoteStore } from "@paperwork/domain/data/quote-store/mod.ts";
import { InvoiceStore } from "@paperwork/domain/data/invoice-store/mod.ts";
import { ViewStore } from "@paperwork/domain/data/view-store/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";

const MS_PER_DAY = 86_400_000;

function fresh() {
  const customers = new CustomerStore();
  const quotes = new QuoteStore();
  const invoices = new InvoiceStore();
  const views = new ViewStore();
  return {
    customers,
    quotes,
    invoices,
    views,
    flow: new BuildCustomerCards(customers, quotes, invoices, views),
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

const NOW_FIXED = new Date(Date.UTC(2026, 3, 28, 12, 0, 0));
const isoOffset = (offsetDays: number) =>
  new Date(NOW_FIXED.getTime() - offsetDays * MS_PER_DAY).toISOString();

Deno.test("status: owes wins when balance > 0 (overrides active)", async () => {
  await withKv(async () => {
    const { customers, quotes, invoices, flow } = fresh();
    const c = await customers.create("u-1", { name: "Acme" });
    const q = await quotes.create("u-1", {
      customerId: c.id,
      summary: "x",
      lineItems: [],
      status: "accepted",
    });
    await quotes.update(q.id, "u-1", { acceptedAt: isoOffset(2) });
    await invoices.create("u-1", {
      quoteId: "k",
      customerId: c.id,
      dueDate: "2026-03-01",
      status: "pending",
      amount: 100,
    });
    const [card] = await flow.run("u-1", NOW_FIXED);
    assertEquals(card.status, "owes");
  });
});

Deno.test("status: active when accepted quote exists with no terminal invoice", async () => {
  await withKv(async () => {
    const { customers, quotes, flow } = fresh();
    const c = await customers.create("u-1", { name: "Acme" });
    const q = await quotes.create("u-1", {
      customerId: c.id,
      summary: "x",
      lineItems: [],
      status: "accepted",
    });
    await quotes.update(q.id, "u-1", { acceptedAt: isoOffset(1) });
    const [card] = await flow.run("u-1", NOW_FIXED);
    assertEquals(card.status, "active");
  });
});

Deno.test("status: lead when only draft/sent quotes", async () => {
  await withKv(async () => {
    const { customers, quotes, flow } = fresh();
    const c = await customers.create("u-1", { name: "Acme" });
    await quotes.create("u-1", {
      customerId: c.id,
      summary: "x",
      lineItems: [],
      status: "draft",
    });
    await quotes.create("u-1", {
      customerId: c.id,
      summary: "y",
      lineItems: [],
      status: "sent",
    });
    const [card] = await flow.run("u-1", NOW_FIXED);
    assertEquals(card.status, "lead");
  });
});

Deno.test("status: regular when 12mo revenue > 0 and no active job", async () => {
  await withKv(async () => {
    const { customers, invoices, flow } = fresh();
    const c = await customers.create("u-1", { name: "Acme" });
    await invoices.create("u-1", {
      quoteId: "k",
      customerId: c.id,
      dueDate: "2026-03-15",
      status: "paid",
      amount: 500,
      paidAt: isoOffset(40),
    });
    const [card] = await flow.run("u-1", NOW_FIXED);
    assertEquals(card.status, "regular");
  });
});

Deno.test("REQ-271 status: a customer just added, with no quote and no invoice, is new — not regular", async () => {
  await withKv(async () => {
    const { customers, flow } = fresh();
    const c = await customers.create("u-1", { name: "Ana Pérez" });
    const [card] = await flow.run("u-1", new Date(new Date(c.createdAt).getTime() + 60_000));
    assertEquals(card.status, "new");
  });
});

Deno.test("status: cold when daysSinceContact > 60 and not owes", async () => {
  await withKv(async () => {
    const { customers, flow } = fresh();
    const c = await customers.create("u-1", { name: "Acme" });
    const FAR_FUTURE = new Date(
      new Date(c.createdAt).getTime() + 90 * MS_PER_DAY,
    );
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
      (await flow.run("u-1", new Date(tCreated + offsetDays * MS_PER_DAY)))[0]
        .temp;
    const tempNew = await tempAt(0);
    const tempOld = await tempAt(20);
    assertGreater(tempNew, tempOld);
  });
});

Deno.test("temp: vip bumps score by 15", async () => {
  await withKv(async () => {
    const { customers, flow } = fresh();
    const cPlain = await customers.create("u-1", { name: "Plain" });
    const cVip = await customers.create("u-2", { name: "VIP", vip: true });
    // Run 30 days after each customer's createdAt so the base score isn't pinned at 100.
    const plainCard = (await flow.run(
      "u-1",
      new Date(new Date(cPlain.createdAt).getTime() + 30 * MS_PER_DAY),
    ))[0];
    const vipCard = (await flow.run(
      "u-2",
      new Date(new Date(cVip.createdAt).getTime() + 30 * MS_PER_DAY),
    ))[0];
    assertEquals(vipCard.temp - plainCard.temp, 15);
  });
});

Deno.test("temp: clamped to [0,100]", async () => {
  await withKv(async () => {
    const { customers, flow } = fresh();
    const c = await customers.create("u-1", { name: "Stale" });
    const VERY_LATE = new Date(
      new Date(c.createdAt).getTime() + 1000 * MS_PER_DAY,
    );
    const card = (await flow.run("u-1", VERY_LATE))[0];
    assert(card.temp >= 0 && card.temp <= 100);
  });
});

Deno.test("balanceCents: positive when invoices owed (deposits offset)", async () => {
  await withKv(async () => {
    const { customers, invoices, flow } = fresh();
    const c = await customers.create("u-1", { name: "Acme" });
    // Audit1 #3 — invoice.amount is INTEGER CENTS now.
    await invoices.create("u-1", {
      quoteId: "k",
      customerId: c.id,
      dueDate: "2026-04-30",
      status: "pending",
      amount: 200_00,
    });
    await invoices.create("u-1", {
      quoteId: "k",
      customerId: c.id,
      dueDate: "2026-04-15",
      status: "deposit",
      amount: 50_00,
    });
    const [card] = await flow.run("u-1", NOW_FIXED);
    assertEquals(card.balanceCents, 200_00 - 50_00);
  });
});

Deno.test("balanceCents: negative on credit", async () => {
  await withKv(async () => {
    const { customers, invoices, flow } = fresh();
    const c = await customers.create("u-1", { name: "Acme" });
    await invoices.create("u-1", {
      quoteId: "k",
      customerId: c.id,
      dueDate: "2026-04-15",
      status: "credit",
      amount: 100,
    });
    const [card] = await flow.run("u-1", NOW_FIXED);
    assert(card.balanceCents < 0);
  });
});

Deno.test("revenue12moCents: excludes invoices outside window", async () => {
  await withKv(async () => {
    const { customers, invoices, flow } = fresh();
    const c = await customers.create("u-1", { name: "Acme" });
    // INTEGER CENTS.
    await invoices.create("u-1", {
      quoteId: "k",
      customerId: c.id,
      dueDate: "2025-03-01",
      status: "paid",
      amount: 500_00,
      paidAt: isoOffset(400),
    });
    await invoices.create("u-1", {
      quoteId: "k",
      customerId: c.id,
      dueDate: "2026-04-01",
      status: "paid",
      amount: 200_00,
      paidAt: isoOffset(20),
    });
    const [card] = await flow.run("u-1", NOW_FIXED);
    assertEquals(card.revenue12moCents, 200_00);
  });
});

Deno.test("lastWhen: takes max across quote/invoice/view events", async () => {
  await withKv(async () => {
    const { customers, quotes, views, flow } = fresh();
    const c = await customers.create("u-1", { name: "Acme" });
    const q = await quotes.create("u-1", {
      customerId: c.id,
      summary: "x",
      lineItems: [],
    });
    // Now make a view event in the future relative to c.createdAt
    const tCreated = new Date(c.createdAt).getTime();
    const VIEW_AT = new Date(tCreated + 5 * MS_PER_DAY).toISOString();
    await views.create({
      paperworkType: "quote",
      paperworkId: q.id,
      viewedAt: VIEW_AT,
    });
    const FUTURE = new Date(tCreated + 8 * MS_PER_DAY); // 3d after view
    const [card] = await flow.run("u-1", FUTURE);
    // The view at +5d is the latest signal; daysSinceContact = 3
    assertEquals(card.daysSinceContact, 3);
  });
});

Deno.test("daysSinceContact: rounds down (36h → 1)", async () => {
  await withKv(async () => {
    const { customers, flow } = fresh();
    const c = await customers.create("u-1", { name: "Acme" });
    const T_PLUS_36H = new Date(
      new Date(c.createdAt).getTime() + 36 * 3600 * 1000,
    );
    const [card] = await flow.run("u-1", T_PLUS_36H);
    assertEquals(card.daysSinceContact, 1);
  });
});

// REQ-016 — NW-14 side-find: invoices live in
// scheduled|draft|sent|viewed|claimed|paid|void, but the balance only counted
// "pending", so a customer with a SENT invoice showed $0 owed on /clients.
for (const status of ["pending", "sent", "viewed", "claimed"]) {
  Deno.test(`REQ-016 balanceCents: a ${status} invoice is owed`, async () => {
    await withKv(async () => {
      const { customers, invoices, flow } = fresh();
      const c = await customers.create("u-1", { name: "Acme" });
      await invoices.create("u-1", {
        quoteId: "k",
        customerId: c.id,
        dueDate: "2026-04-30",
        status,
        amount: 500_00,
      });
      const [card] = await flow.run("u-1", NOW_FIXED);
      assertEquals(card.balanceCents, 500_00);
      assertEquals(card.status, "owes");
    });
  });
}

for (const status of ["paid", "void", "scheduled", "draft"]) {
  Deno.test(`REQ-016 balanceCents: a ${status} invoice is not owed`, async () => {
    await withKv(async () => {
      const { customers, invoices, flow } = fresh();
      const c = await customers.create("u-1", { name: "Acme" });
      await invoices.create("u-1", {
        quoteId: "k",
        customerId: c.id,
        dueDate: "2026-04-30",
        status,
        amount: 500_00,
      });
      const [card] = await flow.run("u-1", NOW_FIXED);
      assertEquals(card.balanceCents, 0);
    });
  });
}

// REQ-204 — the /clients balance line names the invoice by its number, not an id slice.
Deno.test("REQ-204 balanceSub: an overdue invoice reads 'INV-5000 · overdue' (its document number, no id slice)", async () => {
  await withKv(async () => {
    const { customers, invoices, flow } = fresh();
    const c = await customers.create("u-1", { name: "Acme" });
    const inv = await invoices.create("u-1", {
      quoteId: "k",
      customerId: c.id,
      dueDate: "2026-04-01",
      status: "pending",
      amount: 500_00,
    });
    assertEquals(inv.number, "INV-001");
    const [card] = await flow.run("u-1", NOW_FIXED);
    assertEquals(card.balanceSub, "INV-001 · overdue");
    assert(!card.balanceSub.includes(inv.id.slice(0, 8)), "no id slice");
  });
});

// REQ-350 (demo-loop cycle 1, m9): the balance sub-line is localized — a
// Spanish account read "$600 pendiente · owes." because the backend returned
// English literals into the es story template. Reconciled with REQ-367 on
// demo-fixes: the card carries the line as data (balanceSubParts) and the
// reader words it in its live language with the shared balanceSubLabel.
Deno.test("REQ-350 balanceSub in Spanish: an overdue invoice reads 'INV-001 · vencida'", async () => {
  await withKv(async () => {
    const { customers, invoices, flow } = fresh();
    const c = await customers.create("u-1", { name: "Acme" });
    await invoices.create("u-1", {
      quoteId: "k",
      customerId: c.id,
      dueDate: "2026-04-01",
      status: "pending",
      amount: 500_00,
    });
    const [cardRaw] = await flow.run("u-1", NOW_FIXED);
    const card = { ...cardRaw, balanceSub: say(cardRaw, "es") };
    assertEquals(card.balanceSub, "INV-001 · vencida");
  });
});

Deno.test("REQ-350 balanceSub in Spanish: an owed balance with no pending invoice never says 'owes'", async () => {
  await withKv(async () => {
    const { customers, invoices, flow } = fresh();
    const c = await customers.create("u-1", { name: "Acme" });
    await invoices.create("u-1", {
      quoteId: "k",
      customerId: c.id,
      dueDate: "2026-04-01",
      status: "sent",
      amount: 600_00,
    });
    const [esRaw] = await flow.run("u-1", NOW_FIXED);
    const es = { ...esRaw, balanceSub: say(esRaw, "es") };
    assertEquals(es.balanceCents, 600_00);
    assertEquals(es.balanceSub, "esperando el pago");
    const [enRaw] = await flow.run("u-1", NOW_FIXED);
    const en = { ...enRaw, balanceSub: say(enRaw, "en") };
    assertEquals(en.balanceSub, "awaiting payment");
  });
});

Deno.test("REQ-350 balanceSub: 'due in 1 day' is singular in both languages", async () => {
  await withKv(async () => {
    const { customers, invoices, flow } = fresh();
    const c = await customers.create("u-1", { name: "Acme" });
    const due = new Date(NOW_FIXED.getTime() + 86_400_000).toISOString()
      .slice(0, 10);
    await invoices.create("u-1", {
      quoteId: "k",
      customerId: c.id,
      dueDate: due,
      status: "pending",
      amount: 100_00,
    });
    const [esRaw] = await flow.run("u-1", NOW_FIXED);
    const es = { ...esRaw, balanceSub: say(esRaw, "es") };
    const [enRaw] = await flow.run("u-1", NOW_FIXED);
    const en = { ...enRaw, balanceSub: say(enRaw, "en") };
    assert(/^INV-001 · vence (en 1 día|hoy)$/.test(es.balanceSub), es.balanceSub);
    assert(/^INV-001 · due (in 1 day|today)$/.test(en.balanceSub), en.balanceSub);
  });
});

Deno.test("REQ-350 balanceSub in Spanish: a credit reads '$500 a favor', not 'on file'", async () => {
  await withKv(async () => {
    const { customers, invoices, flow } = fresh();
    const c = await customers.create("u-1", { name: "Acme" });
    await invoices.create("u-1", {
      quoteId: "k",
      customerId: c.id,
      dueDate: "2026-04-01",
      status: "credit",
      amount: 500_00,
    });
    const [cardRaw] = await flow.run("u-1", NOW_FIXED);
    const card = { ...cardRaw, balanceSub: say(cardRaw, "es") };
    assertEquals(card.balanceCents, -500_00);
    assertEquals(card.balanceSub, "$500 a favor");
  });
});

/** REQ-350 + REQ-367: the card's balance line worded in `lang` from its parts. */
function say(card: CustomerCard, lang: "en" | "es"): string {
  assert(card.balanceSubParts, "the card carries the balance line as data");
  return balanceSubLabel(card.balanceSubParts, lang, t);
}

Deno.test("REQ-367 + REQ-350 the card's balance line does not depend on the viewer's language: parts + an English base", async () => {
  await withKv(async () => {
    const { customers, invoices, flow } = fresh();
    const c = await customers.create("u-1", { name: "Acme" });
    await invoices.create("u-1", {
      quoteId: "k",
      customerId: c.id,
      dueDate: "2026-04-01",
      status: "pending",
      amount: 500_00,
    });
    const [card] = await flow.run("u-1", NOW_FIXED);
    assertEquals(card.balanceSubParts, { kind: "overdue", ref: "INV-001" });
    assertEquals(card.balanceSub, "INV-001 · overdue");
  });
});
