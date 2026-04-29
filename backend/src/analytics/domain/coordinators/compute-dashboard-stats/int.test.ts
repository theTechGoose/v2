import { assertEquals } from "#std/assert";
import { ComputeDashboardStats } from "./mod.ts";
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
  return { customers, quotes, contracts, invoices, flow: new ComputeDashboardStats(customers, quotes, contracts, invoices) };
}

Deno.test("compute-dashboard-stats integration: empty user → all zeros + 12-bucket sparkline", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const { flow } = fresh();
  const stats = await flow.run("u-1", NOW);
  assertEquals(stats.customers, 0);
  assertEquals(stats.quotes, { total: 0, draft: 0, sent: 0, accepted: 0 });
  assertEquals(stats.invoices.overdue, 0);
  assertEquals(stats.quotedValueCents, 0);
  assertEquals(stats.revenue.sparkline12mo.length, 12);
  assertEquals(stats.revenue.ytdCents, 0);
  await resetKv();
});

Deno.test("compute-dashboard-stats integration: counts roll up status filters per-user", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const { customers, quotes, contracts, invoices, flow } = fresh();
  await customers.create("u-1", { name: "Acme" });
  await customers.create("u-1", { name: "Beta" });
  await quotes.create("u-1", { summary: "a", lineItems: [], status: "sent",     estimatedTotal: 1_000 });
  await quotes.create("u-1", { summary: "b", lineItems: [], status: "sent",     estimatedTotal: 2_500 });
  await quotes.create("u-1", { summary: "c", lineItems: [], status: "draft" });
  await contracts.create("u-1", { quoteId: "x", status: "signed" });
  await invoices.create("u-1", { contractId: "y", dueDate: "2026-04-30", status: "pending", amount: 100 });
  await invoices.create("u-1", { contractId: "y", dueDate: "2026-03-01", status: "pending", amount: 50 });   // overdue (date < today)
  await invoices.create("u-1", { contractId: "y", dueDate: "2026-04-01", status: "paid", amount: 1_240, paidAt: "2026-03-15T00:00:00Z" });

  // Cross-user noise that MUST NOT contaminate u-1's stats.
  await quotes.create("u-2", { summary: "noise", lineItems: [], status: "sent", estimatedTotal: 99_999 });

  const stats = await flow.run("u-1", NOW);
  assertEquals(stats.customers, 2);
  assertEquals(stats.quotes, { total: 3, draft: 1, sent: 2, accepted: 0 });
  assertEquals(stats.contracts, { total: 1, draft: 0, signed: 1 });
  assertEquals(stats.invoices.total, 3);
  assertEquals(stats.invoices.pending, 2);
  assertEquals(stats.invoices.paid, 1);
  assertEquals(stats.invoices.overdue, 1);                   // dueDate 2026-03-01 < today
  assertEquals(stats.quotedValueCents, (1_000 + 2_500) * 100);
  assertEquals(stats.awaitingResponse, 2);
  assertEquals(stats.revenue.lastMonthCents, 124_000);       // March: $1,240 = 124,000 cents

  await resetKv();
});

Deno.test("compute-dashboard-stats integration: revenue sparkline only counts paid invoices in last 12 months", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const { invoices, flow } = fresh();
  await invoices.create("u-1", { contractId: "x", dueDate: "2026-03-01", status: "paid", amount: 100, paidAt: "2026-03-10T00:00:00Z" });
  await invoices.create("u-1", { contractId: "x", dueDate: "2026-04-01", status: "paid", amount: 200, paidAt: "2026-04-12T00:00:00Z" });
  await invoices.create("u-1", { contractId: "x", dueDate: "2026-05-01", status: "pending", amount: 999 });    // unpaid → ignored
  await invoices.create("u-1", { contractId: "x", dueDate: "2024-04-01", status: "paid", amount: 500, paidAt: "2024-04-10T00:00:00Z" });    // >12mo → ignored

  const stats = await flow.run("u-1", NOW);
  assertEquals(stats.revenue.sparkline12mo.length, 12);
  assertEquals(stats.revenue.sparkline12mo[10], 10_000);     // March: $100
  assertEquals(stats.revenue.sparkline12mo[11], 20_000);     // April: $200
  assertEquals(stats.revenue.ytdCents, 30_000);              // YTD = both 2026 entries
  await resetKv();
});

Deno.test("compute-dashboard-stats integration: month-over-month percentage from sparkline", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const { invoices, flow } = fresh();
  // Feb: 1000, Mar: 1240 → +24%
  await invoices.create("u-1", { contractId: "x", dueDate: "2026-02-01", status: "paid", amount: 1_000, paidAt: "2026-02-10T00:00:00Z" });
  await invoices.create("u-1", { contractId: "x", dueDate: "2026-03-01", status: "paid", amount: 1_240, paidAt: "2026-03-10T00:00:00Z" });
  const stats = await flow.run("u-1", NOW);
  assertEquals(stats.revenue.monthOverMonthPct, 24);
  await resetKv();
});
