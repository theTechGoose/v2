/**
 * REQ-198/200/201/204 — the paperwork stores number every document, refuse
 * duplicates on a retried create, file every published version, and
 * snapshot the customer so later CRM edits never rewrite an issued document.
 */
import { assertEquals, assertNotEquals } from "#std/assert";
import { getKv, resetKv } from "@core/data/kv/mod.ts";
import { QuoteStore } from "@paperwork/domain/data/quote-store/mod.ts";
import { InvoiceStore } from "@paperwork/domain/data/invoice-store/mod.ts";
import { ChangeOrderStore } from "@paperwork/domain/data/change-order-store/mod.ts";
import { CustomerStore } from "@crm/domain/data/customer-store/mod.ts";

async function fresh() {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
}

Deno.test("REQ-198: quotes, invoices, change orders and customers are numbered per account", async () => {
  await fresh();
  try {
    const quotes = new QuoteStore();
    const invoices = new InvoiceStore();
    const customers = new CustomerStore();
    const cos = new ChangeOrderStore();
    const c = await customers.create("u1", { name: "Ann" });
    const q1 = await quotes.create("u1", {
      summary: "Roof",
      lineItems: [],
      customerId: c.id,
    });
    const q2 = await quotes.create("u1", { summary: "Deck", lineItems: [] });
    const i1 = await invoices.create("u1", { amount: 100, customerId: c.id });
    const co = await cos.create("u1", i1.id, {
      description: "more",
      deltaAmountCents: 500,
    });
    const other = await invoices.create("u2", { amount: 5 });
    assertEquals([
      c.number,
      q1.number,
      q2.number,
      i1.number,
      co.number,
      other.number,
    ], [
      "C-001",
      "Q-001",
      "Q-002",
      "INV-001",
      "CO-001",
      "INV-001",
    ]);
    assertEquals([q1.version, i1.version, co.version], [1, 1, 1]);
    assertEquals(q1.seq, 1);
    assertEquals(q2.seq, 2);
  } finally {
    await resetKv();
  }
});

Deno.test("REQ-200: the same requestId creates one document — a retry gets the first one back, no second number", async () => {
  await fresh();
  try {
    const invoices = new InvoiceStore();
    const [a, b] = await Promise.all([
      invoices.create("u1", { amount: 100 }, { requestId: "r-1" }),
      invoices.create("u1", { amount: 100 }, { requestId: "r-1" }),
    ]);
    assertEquals(a.id, b.id);
    assertEquals(a.number, "INV-001");
    const again = await invoices.create("u1", { amount: 999 }, {
      requestId: "r-1",
    });
    assertEquals(again.id, a.id);
    assertEquals(again.amount, 100);
    assertEquals((await invoices.listByUser("u1")).length, 1);
    // a different account with the same requestId is its own document
    const c = await invoices.create("u2", { amount: 1 }, { requestId: "r-1" });
    assertNotEquals(c.id, a.id);
  } finally {
    await resetKv();
  }
});

Deno.test("REQ-201: publishing a revision keeps the number, advances the version, files the version it replaced", async () => {
  await fresh();
  try {
    const invoices = new InvoiceStore();
    const inv = await invoices.create("u1", {
      amount: 1000,
      status: "sent",
      jobName: "Roof",
    });
    const pending = await invoices.setPending(inv.id, "u1", { amount: 1200 });
    assertEquals(
      pending.amount,
      1000,
      "the live record does not change while the edit is pending",
    );
    assertEquals(pending.pendingRevision, { amount: 1200 });
    const v2 = await invoices.publishRevision(inv.id, "u1", { amount: 1200 }, {
      userId: "u1",
      name: "Rafa",
    });
    assertEquals(v2.number, "INV-001");
    assertEquals(v2.version, 2);
    assertEquals(v2.amount, 1200);
    assertEquals(v2.pendingRevision, undefined);
    assertEquals(v2.publishedBy, { userId: "u1", name: "Rafa" });
    const versions = await invoices.listVersions(inv.id, "u1");
    assertEquals(versions.map((v) => v.version), [1]);
    assertEquals((versions[0].content as { amount: number }).amount, 1000);
    assertEquals(typeof versions[0].supersededAt, "string");
    const v3 = await invoices.publishRevision(inv.id, "u1", {
      jobName: "Roof + gutters",
    }, { userId: "u1" });
    assertEquals(v3.version, 3);
    assertEquals(
      (await invoices.listVersions(inv.id, "u1")).map((v) => v.version),
      [1, 2],
    );
  } finally {
    await resetKv();
  }
});

Deno.test("REQ-204: a document snapshots its customer at creation and at every publish; editing the customer later leaves it alone", async () => {
  await fresh();
  try {
    const customers = new CustomerStore();
    const quotes = new QuoteStore();
    const c = await customers.create("u1", {
      name: "Ann Lee",
      email: "ann@x.com",
      address: "1 Main St",
    });
    const q = await quotes.create("u1", {
      summary: "Roof",
      lineItems: [],
      customerId: c.id,
    });
    assertEquals(q.customerSnapshot?.name, "Ann Lee");
    assertEquals(q.customerSnapshot?.address, "1 Main St");
    await customers.update(c.id, "u1", {
      name: "Ann Lee-Smith",
      address: "9 Oak Ave",
    });
    const after = await quotes.get(q.id);
    assertEquals(after.customerSnapshot?.name, "Ann Lee");
    // a publish re-reads the customer on file (the contractor chose to revise)
    const v2 = await quotes.publishRevision(
      q.id,
      "u1",
      { summary: "Roof v2" },
      { userId: "u1" },
    );
    assertEquals(v2.customerSnapshot?.name, "Ann Lee-Smith");
    assertEquals(v2.customerSnapshot?.address, "9 Oak Ave");
  } finally {
    await resetKv();
  }
});

Deno.test("REQ-200: a conditional update applies once — the second caller sees the predicate fail", async () => {
  await fresh();
  try {
    const quotes = new QuoteStore();
    const q = await quotes.create("u1", {
      summary: "Roof",
      lineItems: [],
      status: "sent",
    });
    const results = await Promise.all(
      Array.from(
        { length: 5 },
        (_, i) =>
          quotes.updateIf(q.id, (cur) => cur.status !== "accepted", {
            status: "accepted",
            acceptedName: `signer-${i}`,
          }),
      ),
    );
    const applied = results.filter((r) => r !== null);
    assertEquals(applied.length, 1);
    const final = await quotes.get(q.id);
    assertEquals(final.acceptedName, applied[0]!.acceptedName);
  } finally {
    await resetKv();
  }
});

Deno.test("REQ-202: change orders have a per-account index, list by quote, and are never expired", async () => {
  await fresh();
  try {
    const invoices = new InvoiceStore();
    const cos = new ChangeOrderStore();
    const inv = await invoices.create("u1", { amount: 100, quoteId: "q-1" });
    const co = await cos.create("u1", inv.id, {
      description: "x",
      deltaAmountCents: 10,
      quoteId: "q-1",
    });
    assertEquals((await cos.listByUser("u1")).map((c) => c.id), [co.id]);
    assertEquals((await cos.listByQuote("u1", "q-1")).map((c) => c.id), [
      co.id,
    ]);
    assertEquals((await cos.listByUser("u2")).length, 0);
    const kv = await getKv();
    const raw = await kv.get(["change_order", co.id]);
    assertEquals(raw.value !== null, true);
  } finally {
    await resetKv();
  }
});
