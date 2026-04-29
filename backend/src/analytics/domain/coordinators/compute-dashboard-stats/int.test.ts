import { assertEquals } from "#std/assert";
import { ComputeDashboardStats } from "./mod.ts";
import { CustomerStore } from "@crm/domain/data/customer-store/mod.ts";
import { QuoteStore } from "@paperwork/domain/data/quote-store/mod.ts";
import { ContractStore } from "@paperwork/domain/data/contract-store/mod.ts";
import { InvoiceStore } from "@paperwork/domain/data/invoice-store/mod.ts";
import { PaymentStore } from "@paperwork/domain/data/payment-store/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";

const NOW = new Date(Date.UTC(2026, 3, 15));    // Apr 15, 2026

function fresh() {
  const customers = new CustomerStore();
  const quotes    = new QuoteStore();
  const contracts = new ContractStore();
  const invoices  = new InvoiceStore();
  const payments  = new PaymentStore();
  return {
    customers, quotes, contracts, invoices, payments,
    flow: new ComputeDashboardStats(customers, quotes, contracts, invoices, payments),
  };
}

Deno.test("compute-dashboard-stats integration: empty user → all zeros + 12-bucket sparkline", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const { flow } = fresh();
  const stats = await flow.run("u-1", NOW);
  assertEquals(stats.customers, 0);
  assertEquals(stats.quotes, { total: 0, draft: 0, sent: 0, accepted: 0 });
  assertEquals(stats.invoices.overdue, 0);
  assertEquals(stats.invoices.agingBuckets, { current: 0, aging1_14d: 0, overdue15_30d: 0, overdue30plus: 0 });
  assertEquals(stats.quotedValueCents, 0);
  assertEquals(stats.revenue.sparkline12mo.length, 12);
  assertEquals(stats.revenue.ytdCents, 0);
  assertEquals(stats.payments.receivedYtdCents, 0);
  assertEquals(stats.payments.topPayors, []);
  assertEquals(stats.payments.methodMixCents.cash, 0);
  await resetKv();
});

Deno.test("compute-dashboard-stats integration: payment stats roll up YTD, methodMix, topPayors", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const { customers, invoices, payments, flow } = fresh();
  const acme = await customers.create("u-1", { name: "Acme" });
  const beta = await customers.create("u-1", { name: "Beta" });
  const invA = await invoices.create("u-1", {
    contractId: "c-1", dueDate: "2026-05-01", amount: 200, customerId: acme.id, status: "pending",
  });
  const invB = await invoices.create("u-1", {
    contractId: "c-2", dueDate: "2026-05-01", amount: 50, customerId: beta.id, status: "pending",
  });
  await payments.create("u-1", {
    invoiceId: invA.id, amount: 150, method: "cash", receivedAt: "2026-02-10T00:00:00.000Z",
  });
  await payments.create("u-1", {
    invoiceId: invA.id, amount: 50, method: "card", receivedAt: "2026-03-01T00:00:00.000Z",
  });
  await payments.create("u-1", {
    invoiceId: invB.id, amount: 50, method: "check", receivedAt: "2026-04-05T00:00:00.000Z",
  });
  // Prior-year payment must NOT contribute to YTD.
  await payments.create("u-1", {
    invoiceId: invA.id, amount: 10, method: "cash", receivedAt: "2025-12-15T00:00:00.000Z",
  });

  const stats = await flow.run("u-1", NOW);
  assertEquals(stats.payments.receivedYtdCents, 25_000);
  assertEquals(stats.payments.methodMixCents.cash, 16_000);
  assertEquals(stats.payments.methodMixCents.card, 5_000);
  assertEquals(stats.payments.methodMixCents.check, 5_000);
  assertEquals(stats.payments.topPayors.length, 2);
  assertEquals(stats.payments.topPayors[0].customerId, acme.id);
  assertEquals(stats.payments.topPayors[0].totalCents, 21_000);
  assertEquals(stats.payments.topPayors[1].customerId, beta.id);
  assertEquals(stats.payments.topPayors[1].totalCents, 5_000);
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

Deno.test("compute-dashboard-stats integration: aging buckets group pending invoices", async () => {
  // NOW is Apr 15, 2026.
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const { invoices, flow } = fresh();
  await invoices.create("u-1", { contractId: "c", dueDate: "2026-05-15", status: "pending" });   // 30d future → current
  await invoices.create("u-1", { contractId: "c", dueDate: "2026-04-10", status: "pending" });   //  5d overdue → aging1_14d
  await invoices.create("u-1", { contractId: "c", dueDate: "2026-03-25", status: "pending" });   // 21d overdue → overdue15_30d
  await invoices.create("u-1", { contractId: "c", dueDate: "2026-01-01", status: "pending" });   // 104d overdue → overdue30plus
  await invoices.create("u-1", { contractId: "c", dueDate: "2026-03-01", status: "paid", paidAt: "2026-03-15T00:00:00Z" }); // ignored

  const stats = await flow.run("u-1", NOW);
  assertEquals(stats.invoices.agingBuckets, { current: 1, aging1_14d: 1, overdue15_30d: 1, overdue30plus: 1 });
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
