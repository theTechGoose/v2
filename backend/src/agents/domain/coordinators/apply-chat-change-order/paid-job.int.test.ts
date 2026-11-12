/**
 * REQ-655 (demo-loop cycle 5, M12) — a change order asked in chat for a job
 * whose invoices are ALL paid bills the extra work on a new invoice linked to
 * the job, instead of telling the owner to "create its invoice first".
 *
 * Fleet-1 (pair 2): Q-001 "Corte de césped" was signed, INV-001 was sent and
 * paid, and the owner asked for a change order. ApplyChatChangeOrder looked
 * only for an OPEN invoice (paid = locked), found none, and answered
 *   "Q-001 Corte de césped ya está firmada y no se puede editar. Crea primero
 *    su factura y vuelve a pedírmelo…"
 * — an invoice that already existed. Nothing could bill the extra work.
 */
import { assert, assertEquals, assertStringIncludes } from "#std/assert";
import { ApplyChatChangeOrder } from "./mod.ts";
import { QuoteStore } from "@paperwork/domain/data/quote-store/mod.ts";
import { InvoiceStore } from "@paperwork/domain/data/invoice-store/mod.ts";
import { ChangeOrderStore } from "@paperwork/domain/data/change-order-store/mod.ts";
import { CustomerStore } from "@crm/domain/data/customer-store/mod.ts";
import type { SendChangeOrderAlert } from "@paperwork/domain/coordinators/send-change-order-alert/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";

async function fresh() {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const quotes = new QuoteStore();
  const invoices = new InvoiceStore();
  const changeOrders = new ChangeOrderStore();
  const customers = new CustomerStore();
  const alerted: string[] = [];
  const alert = {
    run: (id: string) => {
      alerted.push(id);
      return Promise.resolve({ ok: true });
    },
  } as unknown as SendChangeOrderAlert;
  const flow = new ApplyChatChangeOrder(
    quotes,
    invoices,
    changeOrders,
    customers,
    alert,
  );
  return { quotes, invoices, changeOrders, customers, alerted, flow };
}

/** Pair 2's state: Q-001 "Corte de césped" ($80) signed; INV-001 paid. */
async function seedPaidJob(
  f: Awaited<ReturnType<typeof fresh>>,
  opts: { invoiced?: "paid" | "none" } = {},
) {
  const ana = await f.customers.create("u-1", { name: "Ana Torres" });
  const now = new Date().toISOString();
  const draft = await f.quotes.create("u-1", {
    summary: "Corte de césped — Ana Torres",
    jobName: "Corte de césped",
    customerId: ana.id,
    lineItems: [{
      description: "Corte de césped",
      quantity: 1,
      unit: "job",
      price: 8_000,
    }],
    estimatedTotal: 8_000,
  });
  const quote = await f.quotes.update(draft.id, "u-1", {
    status: "accepted",
    sentAt: now,
    acceptedAt: now,
  });
  let inv1: { id: string; number?: string } | undefined;
  if (opts.invoiced !== "none") {
    inv1 = await f.invoices.create("u-1", {
      quoteId: quote.id,
      customerId: ana.id,
      amount: 8_000,
      status: "paid",
      paidAt: now,
    } as never);
  }
  return { ana, quote, inv1 };
}

Deno.test("REQ-655 M12: a change order on a job whose every invoice is paid bills the extra work on a NEW draft invoice linked to the job — never 'create its invoice first'", async () => {
  const f = await fresh();
  const { ana, quote, inv1 } = await seedPaidJob(f);
  assertEquals(inv1?.number, "INV-001");

  const res = await f.flow.run({
    userId: "u-1",
    lang: "es",
    customerName: "Ana Torres",
    description: "Recorte de setos",
    deltaAmountCents: 4_500,
  });

  assert(
    !res.text.includes("Crea primero su factura"),
    `the demo's dead end came back: ${res.text}`,
  );
  const all = (await f.invoices.listByUser("u-1"))
    .filter((i) => i.quoteId === quote.id);
  assertEquals(all.length, 2, `no new invoice — the reply was: ${res.text}`);
  const added = all.find((i) => i.id !== inv1!.id)!;
  assertEquals(
    {
      number: added.number,
      status: added.status,
      amount: added.amount,
      customerId: added.customerId,
      quoteId: added.quoteId,
      lines: (added.lineItems ?? []).map((l) => [l.description, l.price]),
    },
    {
      number: "INV-002",
      status: "draft",
      amount: 4_500,
      customerId: ana.id,
      quoteId: quote.id,
      lines: [["Recorte de setos", 4_500]],
    },
  );
  assertEquals(res.outcome, {
    kind: "new_invoice",
    quoteId: quote.id,
    quoteNumber: "Q-001",
    invoiceId: added.id,
    invoiceNumber: "INV-002",
  });
  // the reply names the paid invoice and the new one, in the owner's language
  assertStringIncludes(res.text, "INV-001");
  assertStringIncludes(res.text, "INV-002");
  assertStringIncludes(res.text, "$45.00");
  // the paid invoice and the signed quote are untouched; no change order
  assertEquals((await f.invoices.getOwned(inv1!.id, "u-1")).amount, 8_000);
  assertEquals((await f.changeOrders.listByUser("u-1")).length, 0);
  assertEquals(f.alerted, [], "a draft is not sent to anyone");
  const q = await f.quotes.getOwned(quote.id, "u-1");
  assertEquals(q.estimatedTotal, 8_000);
  assertEquals(q.pendingRevision, undefined);
});

Deno.test("REQ-655 M12: a CREDIT on a fully paid job writes nothing and says the invoices are paid — never 'create its invoice first'", async () => {
  const f = await fresh();
  const { quote } = await seedPaidJob(f);

  const res = await f.flow.run({
    userId: "u-1",
    lang: "en",
    customerName: "Ana Torres",
    description: "Skip the edging",
    deltaAmountCents: -1_000,
  });

  assert(
    !res.text.includes("Create its invoice first"),
    `the demo's dead end came back: ${res.text}`,
  );
  assertStringIncludes(res.text, "INV-001");
  assertEquals(res.outcome, {
    kind: "all_paid",
    quoteId: quote.id,
    quoteNumber: "Q-001",
  });
  assertEquals(
    (await f.invoices.listByUser("u-1")).length,
    1,
    "no invoice for a credit",
  );
  assertEquals((await f.changeOrders.listByUser("u-1")).length, 0);
});

Deno.test("REQ-655 M12: a signed job with NO invoice at all still says to invoice it first (needs_invoice is kept for that case only)", async () => {
  const f = await fresh();
  const { quote } = await seedPaidJob(f, { invoiced: "none" });

  const res = await f.flow.run({
    userId: "u-1",
    lang: "en",
    customerName: "Ana Torres",
    description: "Hedge trim",
    deltaAmountCents: 4_500,
  });

  assertEquals(res.outcome, {
    kind: "needs_invoice",
    quoteId: quote.id,
    quoteNumber: "Q-001",
  });
  assertEquals((await f.invoices.listByUser("u-1")).length, 0);
});
