import { assertEquals } from "#std/assert";
import { ListActiveJobs } from "./mod.ts";
import { CustomerStore } from "@crm/domain/data/customer-store/mod.ts";
import { QuoteStore } from "@paperwork/domain/data/quote-store/mod.ts";
import { ContractStore } from "@paperwork/domain/data/contract-store/mod.ts";
import { InvoiceStore } from "@paperwork/domain/data/invoice-store/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";

const NOW = new Date(Date.UTC(2026, 3, 15));    // Apr 15, 2026

function fresh() {
  const customers = new CustomerStore();
  const quotes    = new QuoteStore();
  const contracts = new ContractStore();
  const invoices  = new InvoiceStore();
  return { customers, quotes, contracts, invoices, flow: new ListActiveJobs(customers, quotes, contracts, invoices) };
}

Deno.test("list-active-jobs integration: quote without a contract is 'awaiting signature'", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const { customers, quotes, flow } = fresh();
  const cust = await customers.create("u-1", { name: "Acme" });
  await quotes.create("u-1", { summary: "Re-roof", lineItems: [], status: "sent", customerId: cust.id, estimatedTotal: 4_800 });
  const jobs = await flow.run("u-1", NOW);
  assertEquals(jobs.length, 1);
  assertEquals(jobs[0].status, "awaiting");
  assertEquals(jobs[0].customer.name, "Acme");
  assertEquals(jobs[0].pctPaid, 0);
  await resetKv();
});

Deno.test("list-active-jobs integration: signed contract + paid + pending invoices = 'on_track' with pctPaid", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const { customers, quotes, contracts, invoices, flow } = fresh();
  const cust = await customers.create("u-1", { name: "Maple Grove Apartments" });
  const q    = await quotes.create("u-1", { summary: "Re-roof bldg C", lineItems: [], status: "accepted", customerId: cust.id, estimatedTotal: 4_800 });
  const c    = await contracts.create("u-1", { quoteId: q.id, status: "signed", totalAmount: 4_800 });
  await invoices.create("u-1", { contractId: c.id, dueDate: "2026-04-20", status: "paid",    amount: 2_400, paidAt: "2026-04-10T00:00:00Z" });
  await invoices.create("u-1", { contractId: c.id, dueDate: "2026-05-20", status: "pending", amount: 2_400 });

  const jobs = await flow.run("u-1", NOW);
  assertEquals(jobs.length, 1);
  assertEquals(jobs[0].status, "on_track");
  assertEquals(jobs[0].totalCents, 480_000);
  assertEquals(jobs[0].paidCents,  240_000);
  assertEquals(jobs[0].pctPaid, 50);
  assertEquals(jobs[0].nextDueDate, "2026-05-20");
  await resetKv();
});

Deno.test("list-active-jobs integration: an overdue invoice flips status to 'overdue'", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const { customers, quotes, contracts, invoices, flow } = fresh();
  const cust = await customers.create("u-1", { name: "Hilltop Diner" });
  const q    = await quotes.create("u-1", { summary: "Patio re-tile", lineItems: [], status: "accepted", customerId: cust.id, estimatedTotal: 3_400 });
  const c    = await contracts.create("u-1", { quoteId: q.id, status: "signed", totalAmount: 3_400 });
  await invoices.create("u-1", { contractId: c.id, dueDate: "2026-03-01", status: "pending", amount: 1_160 });

  const jobs = await flow.run("u-1", NOW);
  assertEquals(jobs[0].status, "overdue");
  await resetKv();
});

Deno.test("list-active-jobs integration: all invoices paid + signed → 'complete'", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const { customers, quotes, contracts, invoices, flow } = fresh();
  const cust = await customers.create("u-1", { name: "Sarah Chen" });
  const q    = await quotes.create("u-1", { summary: "Bath remodel", lineItems: [], status: "accepted", customerId: cust.id, estimatedTotal: 8_200 });
  const c    = await contracts.create("u-1", { quoteId: q.id, status: "signed", totalAmount: 8_200 });
  await invoices.create("u-1", { contractId: c.id, dueDate: "2026-04-01", status: "paid", amount: 8_200, paidAt: "2026-03-28T00:00:00Z" });

  const jobs = await flow.run("u-1", NOW);
  assertEquals(jobs[0].status, "complete");
  assertEquals(jobs[0].pctPaid, 100);
  await resetKv();
});

Deno.test("list-active-jobs integration: per-user isolation", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const { customers, quotes, flow } = fresh();
  const c1 = await customers.create("u-1", { name: "A" });
  await quotes.create("u-1", { summary: "x", lineItems: [], status: "sent", customerId: c1.id });
  const c2 = await customers.create("u-2", { name: "B" });
  await quotes.create("u-2", { summary: "y", lineItems: [], status: "sent", customerId: c2.id });

  assertEquals((await flow.run("u-1", NOW)).length, 1);
  assertEquals((await flow.run("u-2", NOW)).length, 1);
  assertEquals((await flow.run("u-1", NOW))[0].customer.name, "A");
  await resetKv();
});

Deno.test("list-active-jobs integration: quote without a customer is dropped (can't render the row)", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const { quotes, flow } = fresh();
  await quotes.create("u-1", { summary: "orphan", lineItems: [], status: "sent" });    // no customerId
  assertEquals((await flow.run("u-1", NOW)).length, 0);
  await resetKv();
});

Deno.test("list-active-jobs integration: draft + cancelled quotes are skipped", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const { customers, quotes, flow } = fresh();
  const cust = await customers.create("u-1", { name: "X" });
  await quotes.create("u-1", { summary: "draft",     lineItems: [], status: "draft",     customerId: cust.id });
  await quotes.create("u-1", { summary: "cancelled", lineItems: [], status: "cancelled", customerId: cust.id });
  await quotes.create("u-1", { summary: "sent",      lineItems: [], status: "sent",      customerId: cust.id });
  assertEquals((await flow.run("u-1", NOW)).length, 1);
  await resetKv();
});
