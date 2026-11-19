/**
 * REQ-1140 (LOOP-007 q3, q3-71) — a signed job leaves the customer's Jobs tab at 0.
 *
 * Everywhere else a job starts when a quote is signed (pipeline-stats: "only a signature creates
 * a job"; REQ-562 countJobs feeds the card's activeJobs → the /customers chip "Active 1" and the
 * card line "1 signed job in flight"). The customer page's Jobs tab (REQ-924) counted and listed
 * only work orders, so the same customer read "Jobs 0 … No work orders yet".
 *
 * The workspace projection must carry the signed jobs — one row per won quote, by the SAME
 * countJobs rule, so its active rows always equal the card's activeJobs.
 */
import { assertEquals, assertExists } from "#std/assert";
import { resetKv } from "@core/data/kv/mod.ts";
import { CustomerStore } from "@crm/domain/data/customer-store/mod.ts";
import { InvoiceStore } from "@paperwork/domain/data/invoice-store/mod.ts";
import { QuoteStore } from "@paperwork/domain/data/quote-store/mod.ts";
import { PaymentStore } from "@paperwork/domain/data/payment-store/mod.ts";
import { WorkOrderStore } from "@paperwork/domain/data/work-order-store/mod.ts";
import { ViewStore } from "@paperwork/domain/data/view-store/mod.ts";
import {
  ChecklistStore,
  CrewStore,
  FieldTaskStore,
  FieldWorkerStore,
  RegionStore,
  SubscriptionStore,
  TaskTypeStore,
} from "@field/domain/data/field-stores/mod.ts";
import { FieldViews } from "@field/domain/coordinators/field-views/mod.ts";
import { BuildCustomerCards } from "@analytics/domain/coordinators/build-customer-cards/mod.ts";
import { countJobs } from "@analytics/domain/business/signed-jobs/mod.ts";
import { BuildCustomerWorkspace } from "./mod.ts";

const TODAY = "2026-11-19";

function workspace() {
  const customers = new CustomerStore();
  const quotes = new QuoteStore();
  const invoices = new InvoiceStore();
  const subs = new SubscriptionStore();
  const views = new FieldViews(
    customers,
    new TaskTypeStore(),
    new FieldWorkerStore(),
    new RegionStore(),
    subs,
    invoices,
    new ChecklistStore(),
    new CrewStore(),
  );
  const cards = new BuildCustomerCards(customers, quotes, invoices, new ViewStore());
  return {
    customers,
    quotes,
    invoices,
    flow: new BuildCustomerWorkspace(
      customers,
      cards,
      invoices,
      quotes,
      new PaymentStore(),
      new WorkOrderStore(),
      subs,
      new FieldTaskStore(),
      views,
    ),
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

type Job = { id: string; number: string; active: boolean; url: string };

/** a customer with one signed quote billed by one unpaid invoice — the QA tester's state */
async function signedJobUnpaid(w: ReturnType<typeof workspace>, uid: string) {
  const c = await w.customers.create(uid, { name: "Lucia Herrera" });
  const q = await w.quotes.create(uid, {
    customerId: c.id,
    summary: "Kitchen backsplash",
    jobName: "Kitchen backsplash",
    lineItems: [],
    estimatedTotal: 240_000,
    status: "accepted",
  } as never);
  await w.quotes.update(q.id, uid, { acceptedAt: `${TODAY}T15:00:00.000Z` } as never);
  const inv = await w.invoices.create(uid, {
    quoteId: q.id,
    customerId: c.id,
    dueDate: "2026-12-01",
    status: "sent",
    amount: 240_000,
  } as never);
  return { c, q, inv };
}

Deno.test("REQ-1140 (LOOP-007 q3, q3-71) BuildCustomerWorkspace — a signed quote with an unpaid invoice is ONE active job on the workspace, the same count as the card's activeJobs", async () => {
  await withKv(async () => {
    const w = workspace();
    const uid = "u-q3-71";
    const { c, q } = await signedJobUnpaid(w, uid);

    const ws = await w.flow.run(uid, c.id, TODAY);
    assertEquals(ws.customer.activeJobs, 1, "the board's card counts one signed job in flight (REQ-562)");
    assertEquals(ws.workOrders.length, 0, "signing creates no work order (REQ-210)");

    const jobs = (ws as unknown as { jobs?: Job[] }).jobs;
    assertExists(jobs, "the workspace carries the customer's signed jobs (got no `jobs` field — the Jobs tab can only count work orders)");
    assertEquals(jobs.length, 1, "one signed quote → one job");
    assertEquals(jobs[0].id, q.id, "the job is the signed quote");
    assertEquals(jobs[0].number, ws.quotes[0].number, "the job row names the quote's number (Q-001)");
    assertEquals(jobs[0].active, true, "an unpaid invoice keeps the job in flight");
    assertEquals(jobs[0].url, `/quotes?open=${q.id}`, "the row opens the signed quote");
    assertEquals(
      jobs.filter((j) => j.active).length,
      ws.customer.activeJobs,
      "the workspace's active jobs equal the card's activeJobs — one rule, no drift",
    );
  });
});

Deno.test("REQ-1140 (LOOP-007 q3, q3-71) BuildCustomerWorkspace — once every invoice of the signed job is paid the job stays listed but is completed, as countJobs says", async () => {
  await withKv(async () => {
    const w = workspace();
    const uid = "u-q3-71b";
    const { c, q, inv } = await signedJobUnpaid(w, uid);
    await w.invoices.update(inv.id, uid, { status: "paid", paidAt: `${TODAY}T16:00:00.000Z` } as never);

    const ws = await w.flow.run(uid, c.id, TODAY);
    const allQuotes = await w.quotes.listByUser(uid);
    const allInvoices = await w.invoices.listByUser(uid);
    const rule = countJobs(allQuotes.filter((x) => x.customerId === c.id), allInvoices.filter((i) => i.customerId === c.id));
    assertEquals(rule, { active: 0, completed: 1 }, "countJobs: the signed job is complete");

    const jobs = (ws as unknown as { jobs?: Job[] }).jobs;
    assertExists(jobs, "the workspace carries the customer's signed jobs (got no `jobs` field)");
    assertEquals(jobs.map((j) => [j.id, j.active]), [[q.id, false]], "the paid-off job is listed, completed");
    assertEquals(jobs.filter((j) => j.active).length, ws.customer.activeJobs);
  });
});
