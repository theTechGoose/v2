import { assertEquals } from "#std/assert";
import { ComputeDashboardStats } from "./mod.ts";
import { ListActiveJobs } from "@analytics/domain/coordinators/list-active-jobs/mod.ts";
import { BuildCustomerCards } from "@analytics/domain/coordinators/build-customer-cards/mod.ts";
import { SendSignedConfirmation } from "@paperwork/domain/coordinators/send-signed-confirmation/mod.ts";
import { CustomerStore } from "@crm/domain/data/customer-store/mod.ts";
import { QuoteStore } from "@paperwork/domain/data/quote-store/mod.ts";
import { InvoiceStore } from "@paperwork/domain/data/invoice-store/mod.ts";
import { PaymentStore } from "@paperwork/domain/data/payment-store/mod.ts";
import { ViewStore } from "@paperwork/domain/data/view-store/mod.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { BusinessIdentityStore } from "@profile/domain/data/business-identity-store/mod.ts";
import { EmailService } from "@communication/domain/data/email-service/mod.ts";
import { SmsService } from "@users/domain/data/sms/mod.ts";
import { RenderQuotePdf } from "@paperwork/domain/coordinators/render-quote-pdf/mod.ts";
import { LogPaperworkMessage } from "@communication/domain/coordinators/log-paperwork-message/mod.ts";
import { ConversationStore as CommConversationStore } from "@communication/domain/data/conversation-store/mod.ts";
import { MessageStore as CommMessageStore } from "@communication/domain/data/message-store/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";

/**
 * REQ-397 (demo-loop cycle 2, M14): after a customer signs a 50/50 quote the
 * dashboard said "OUTSTANDING $0 · 0 invoices", "Current $0.02" and the job
 * card "No due date" — while INV-001 ($9,600) was Sent. Drive the REAL accept
 * billing (SendSignedConfirmation) and read every roll-up that shows it.
 */
Deno.test("REQ-397 (M14) accept 50/50 → dashboard outstanding = the deposit in cents, 1 invoice; job's next due = INV-001's due; client card owes it", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  Deno.env.delete("POSTMARK_API_KEY");
  await resetKv();
  try {
    const customers = new CustomerStore();
    const quotes = new QuoteStore();
    const invoices = new InvoiceStore();
    const payments = new PaymentStore();
    const email = new EmailService();
    email.send = () => Promise.resolve({ ok: true, reason: "test_capture" });
    const accept = new SendSignedConfirmation(
      quotes,
      invoices,
      customers,
      new UserStore(),
      new BusinessIdentityStore(),
      new RenderQuotePdf(),
      email,
      new SmsService(),
      new LogPaperworkMessage(
        new CommConversationStore(),
        new CommMessageStore(),
      ),
    );

    const cust = await customers.create("u-1", { name: "Dana Whitfield" });
    const quote = await quotes.create("u-1", {
      summary: "Kitchen remodel",
      lineItems: [],
      customerId: cust.id,
      estimatedTotal: 19_200_00,
      status: "accepted",
      acceptedAt: new Date().toISOString(),
      terms: [{
        stepId: "payment_terms",
        label: "Payment terms",
        value: "50/50",
      }],
    });
    await accept.run(quote.id);

    const rows = (await invoices.listByUser("u-1"))
      .sort((a, b) => (a.installmentIndex ?? 0) - (b.installmentIndex ?? 0));
    assertEquals(rows.map((r) => [r.status, r.amount]), [
      ["sent", 9_600_00],
      ["scheduled", 9_600_00],
    ]);
    const inv001 = rows[0];

    const now = new Date();
    const stats = await new ComputeDashboardStats(
      customers,
      quotes,
      invoices,
      payments,
    )
      .run("u-1", now);
    assertEquals(
      stats.invoices.pending,
      1,
      "one invoice is out with the customer",
    );
    assertEquals(stats.invoices.overdue, 0);
    assertEquals(stats.invoices.agingBuckets, {
      current: 9_600_00,
      aging1_14d: 0,
      overdue15_30d: 0,
      overdue30plus: 0,
    });

    const jobs = await new ListActiveJobs(customers, quotes, invoices).run(
      "u-1",
      now,
    );
    assertEquals(jobs.length, 1);
    assertEquals(jobs[0].nextDueDate, inv001.dueDate);
    assertEquals(jobs[0].status, "on_track");

    const cards = await new BuildCustomerCards(
      customers,
      quotes,
      invoices,
      new ViewStore(),
    )
      .run("u-1", now);
    const card = cards.find((c) => c.id === cust.id)!;
    assertEquals(card.balanceCents, 9_600_00);
    assertEquals(card.balanceSubParts?.kind, "dueIn");
  } finally {
    await resetKv();
  }
});

Deno.test("REQ-397 (M14) an overdue sent invoice is overdue on the dashboard, the job and the client card", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  try {
    const customers = new CustomerStore();
    const quotes = new QuoteStore();
    const invoices = new InvoiceStore();
    const payments = new PaymentStore();
    const NOW = new Date(Date.UTC(2026, 3, 15));
    const cust = await customers.create("u-1", { name: "Late Payer" });
    const q = await quotes.create("u-1", {
      summary: "Fence",
      lineItems: [],
      customerId: cust.id,
      estimatedTotal: 1_000_00,
      status: "accepted",
      acceptedAt: "2026-03-01T00:00:00Z",
    });
    await invoices.create("u-1", {
      quoteId: q.id,
      customerId: cust.id,
      amount: 1_000_00,
      dueDate: "2026-04-10",
      status: "viewed",
    });

    const stats = await new ComputeDashboardStats(
      customers,
      quotes,
      invoices,
      payments,
    )
      .run("u-1", NOW);
    assertEquals(stats.invoices.pending, 1);
    assertEquals(stats.invoices.overdue, 1);
    assertEquals(stats.invoices.agingBuckets.aging1_14d, 1_000_00);

    const jobs = await new ListActiveJobs(customers, quotes, invoices).run(
      "u-1",
      NOW,
    );
    assertEquals(jobs[0].status, "overdue");
    assertEquals(jobs[0].nextDueDate, "2026-04-10");

    const cards = await new BuildCustomerCards(
      customers,
      quotes,
      invoices,
      new ViewStore(),
    )
      .run("u-1", NOW);
    assertEquals(cards[0].balanceSubParts?.kind, "overdue");
    assertEquals(cards[0].jobsSub, "overdue");
  } finally {
    await resetKv();
  }
});

/**
 * REQ-562 (demo-loop cycle 4, M38 + m21): Linda signs a 50/50 quote and pays
 * the deposit the same day. The dashboard said ACTIVE JOBS 1 while /clients
 * said "0 signed jobs", her card read "Regular", and "Avg. paid job" divided
 * by paid invoices. Drive the REAL accept billing, pay INV-001, read them all.
 */
Deno.test("REQ-562 (cycle 4, M38/m21) 50/50 signed, deposit paid, balance scheduled → the card's activeJobs is 1 like the dashboard's jobs, status active; avg paid job counts 1 paid job", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  Deno.env.delete("POSTMARK_API_KEY");
  await resetKv();
  try {
    const customers = new CustomerStore();
    const quotes = new QuoteStore();
    const invoices = new InvoiceStore();
    const payments = new PaymentStore();
    const email = new EmailService();
    email.send = () => Promise.resolve({ ok: true, reason: "test_capture" });
    const accept = new SendSignedConfirmation(
      quotes,
      invoices,
      customers,
      new UserStore(),
      new BusinessIdentityStore(),
      new RenderQuotePdf(),
      email,
      new SmsService(),
      new LogPaperworkMessage(
        new CommConversationStore(),
        new CommMessageStore(),
      ),
    );
    const cust = await customers.create("u-1", { name: "Linda Park" });
    const quote = await quotes.create("u-1", {
      summary: "Deck",
      lineItems: [],
      customerId: cust.id,
      estimatedTotal: 2_850_00,
      status: "accepted",
      acceptedAt: new Date().toISOString(),
      terms: [{
        stepId: "payment_terms",
        label: "Payment terms",
        value: "50/50",
      }],
    });
    await accept.run(quote.id);
    const rows = (await invoices.listByUser("u-1"))
      .sort((a, b) => (a.installmentIndex ?? 0) - (b.installmentIndex ?? 0));
    const now = new Date();
    await invoices.update(rows[0].id, "u-1", {
      status: "paid",
      paidAt: now.toISOString(),
    });
    assertEquals(
      (await invoices.listByUser("u-1")).map((r) => r.status).sort(),
      ["paid", "scheduled"],
    );

    const jobs = await new ListActiveJobs(customers, quotes, invoices).run(
      "u-1",
      now,
    );
    const inFlight = jobs.filter((j) => j.status !== "complete").length;
    assertEquals(inFlight, 1, "the dashboard's job is not complete");

    const [card] = await new BuildCustomerCards(
      customers,
      quotes,
      invoices,
      new ViewStore(),
    ).run("u-1", now);
    assertEquals(
      card.activeJobs,
      inFlight,
      "/clients agrees with the dashboard: 1 signed job in flight",
    );
    assertEquals(
      card.status,
      "active",
      "a first job in progress is active, not regular",
    );
    assertEquals(card.jobsSub, "active");

    const stats = await new ComputeDashboardStats(
      customers,
      quotes,
      invoices,
      payments,
    ).run("u-1", now);
    assertEquals(
      stats.revenue.paidJobsYtd,
      1,
      "one job has been paid on, not one per installment",
    );
  } finally {
    await resetKv();
  }
});

Deno.test("REQ-562 (cycle 4, m21) both 50/50 installments paid → avg paid job is the whole job: paidJobsYtd 1 over 2 paid invoices", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  try {
    const customers = new CustomerStore();
    const quotes = new QuoteStore();
    const invoices = new InvoiceStore();
    const payments = new PaymentStore();
    const now = new Date();
    const cust = await customers.create("u-1", { name: "Linda Park" });
    const q = await quotes.create("u-1", {
      summary: "Deck",
      lineItems: [],
      customerId: cust.id,
      estimatedTotal: 2_850_00,
      status: "accepted",
      acceptedAt: now.toISOString(),
    });
    for (const i of [0, 1]) {
      await invoices.create("u-1", {
        quoteId: q.id,
        customerId: cust.id,
        amount: 1_425_00,
        dueDate: now.toISOString().slice(0, 10),
        status: "paid",
        paidAt: now.toISOString(),
        installmentIndex: i,
      });
    }
    const stats = await new ComputeDashboardStats(
      customers,
      quotes,
      invoices,
      payments,
    ).run("u-1", now);
    assertEquals(stats.invoices.paid, 2);
    assertEquals(stats.revenue.paidJobsYtd, 1);
    assertEquals(stats.revenue.ytdCents / stats.revenue.paidJobsYtd, 2_850_00);
  } finally {
    await resetKv();
  }
});
