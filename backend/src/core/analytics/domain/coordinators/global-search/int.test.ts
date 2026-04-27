import { assertEquals } from "#std/assert";
import { GlobalSearch } from "./mod.ts";
import { CustomerStore } from "@crm/domain/data/customer-store/mod.ts";
import { QuoteStore } from "@paperwork/domain/data/quote-store/mod.ts";
import { ContractStore } from "@paperwork/domain/data/contract-store/mod.ts";
import { InvoiceStore } from "@paperwork/domain/data/invoice-store/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";

function fresh() {
  const customers = new CustomerStore();
  const quotes    = new QuoteStore();
  const contracts = new ContractStore();
  const invoices  = new InvoiceStore();
  return { customers, quotes, contracts, invoices, flow: new GlobalSearch(customers, quotes, contracts, invoices) };
}

Deno.test("global-search integration: empty query returns []", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const { flow } = fresh();
  assertEquals(await flow.run("u-1", { q: "" }),    []);
  assertEquals(await flow.run("u-1", { q: "  " }),  []);
  await resetKv();
});

Deno.test("global-search integration: substring match across customer fields (case-insensitive)", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const { customers, flow } = fresh();
  await customers.create("u-1", { name: "Acme Roofing", email: "ops@acme.test", phoneNumber: "555-1234" });
  await customers.create("u-1", { name: "Beta Plumbing" });

  const byName  = await flow.run("u-1", { q: "ACME" });
  const byEmail = await flow.run("u-1", { q: "ops@" });
  const byPhone = await flow.run("u-1", { q: "1234" });

  assertEquals(byName.length, 1);  assertEquals(byName[0].label,  "Acme Roofing");
  assertEquals(byEmail.length, 1); assertEquals(byEmail[0].label, "Acme Roofing");
  assertEquals(byPhone.length, 1); assertEquals(byPhone[0].label, "Acme Roofing");

  await resetKv();
});

Deno.test("global-search integration: type filter narrows the search to a single entity", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const { customers, quotes, flow } = fresh();
  await customers.create("u-1", { name: "Roofing pros" });
  await quotes.create("u-1",    { summary: "Roofing job",   lineItems: [], status: "sent" });

  const all       = await flow.run("u-1", { q: "roofing" });
  const onlyQuote = await flow.run("u-1", { q: "roofing", type: "quote" });
  assertEquals(all.length, 2);
  assertEquals(onlyQuote.length, 1);
  assertEquals(onlyQuote[0].type, "quote");
  await resetKv();
});

Deno.test("global-search integration: per-user scoping — A's data never appears for B", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const { customers, flow } = fresh();
  await customers.create("u-1", { name: "Acme Roofing" });
  await customers.create("u-2", { name: "Acme Roofing" });

  const aHits = await flow.run("u-1", { q: "Acme" });
  const bHits = await flow.run("u-2", { q: "Acme" });
  assertEquals(aHits.length, 1);
  assertEquals(bHits.length, 1);
  assertEquals(aHits[0].id !== bHits[0].id, true);
  await resetKv();
});

Deno.test("global-search integration: limit caps results per type", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const { customers, flow } = fresh();
  for (let i = 0; i < 25; i++) await customers.create("u-1", { name: `Acme ${i}` });
  const out = await flow.run("u-1", { q: "Acme", limit: 5 });
  assertEquals(out.length, 5);
  await resetKv();
});

Deno.test("global-search integration: matches quote summary + invoice contract id", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const { quotes, invoices, flow } = fresh();
  const q = await quotes.create("u-1", { summary: "Garage epoxy floor", lineItems: [] });
  const i = await invoices.create("u-1", { contractId: q.id, dueDate: "2026-05-01", status: "pending" });
  const out = await flow.run("u-1", { q: "garage" });
  // Quote matches "garage", invoice does not (matches by contractId/id only).
  assertEquals(out.find((r) => r.type === "quote")?.id, q.id);
  assertEquals(out.find((r) => r.type === "invoice"), undefined);
  // But searching by the invoice's own id finds it:
  const byInvoiceId = await flow.run("u-1", { q: i.id.slice(0, 8) });
  assertEquals(byInvoiceId.find((r) => r.type === "invoice")?.id, i.id);
  await resetKv();
});
