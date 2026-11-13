import "#reflect-metadata";
import { assertEquals } from "#std/assert";
import { Module } from "#danet/core";
import { bootstrapServer } from "#mrg-keystone/danet";
import { AnalyticsModule } from "@analytics/mod-root.ts";
import { OtpStore } from "@users/domain/data/otp-store/mod.ts";
import { SessionStore } from "@users/domain/data/session-store/mod.ts";
import { CustomerStore } from "@crm/domain/data/customer-store/mod.ts";
import { QuoteStore } from "@paperwork/domain/data/quote-store/mod.ts";
import { InvoiceStore } from "@paperwork/domain/data/invoice-store/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";
import { AgentConversationStore } from "@agents/domain/data/agent-conversation-store/mod.ts";
import { TERMS_WIZARD_V1 } from "@agents/domain/business/terms-wizard-spec/mod.ts";

@Module({ imports: [AnalyticsModule] })
class TestApp {}

const PORT = 9090;

async function drain(res: Response) { await res.body?.cancel(); }

async function login(port: number, phone = "+15125551234"): Promise<string> {
  await drain(await fetch(`http://localhost:${port}/auth/send-otp`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ phoneNumber: phone }),
  }));
  const stored = await new OtpStore().get(phone);
  const v = await fetch(`http://localhost:${port}/auth/verify-otp`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ phoneNumber: phone, code: stored!.code }),
  }).then((r) => r.json());
  return v.sessionId;
}

Deno.test("analytics e2e: GET /analytics/dashboard returns zero-state for fresh user", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  try {
    const sid = await login(PORT);
    const stats = await fetch(`http://localhost:${PORT}/analytics/dashboard`, {
      headers: { "x-session-id": sid },
    }).then((r) => r.json());
    assertEquals(stats.customers, 0);
    assertEquals(stats.quotes.sent, 0);
    assertEquals(stats.invoices.overdue, 0);
    assertEquals(stats.revenue.sparkline12mo.length, 12);
  } finally {
    await server.stop();
    await resetKv();
  }
});

Deno.test("analytics e2e: GET /analytics/dashboard rolls up after creating quotes + invoices", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  try {
    const sid = await login(PORT);
    const auth = { "content-type": "application/json", "x-session-id": sid };

    await drain(await fetch(`http://localhost:${PORT}/customers`, {
      method: "POST", headers: auth, body: JSON.stringify({ name: "Acme" }),
    }));
    // Audit1 #3 — money fields are INTEGER CENTS (`_00` marks dollar intent).
    // REQ-003 (NW-10): a quote is BORN a draft — status on the create body is
    // ignored. Flip each one the way the send coordinators do (status + sentAt).
    for (const seed of [
      { summary: "x", lineItems: [], estimatedTotal: 1_000_00 },
      { summary: "y", lineItems: [], estimatedTotal: 2_500_00 },
    ]) {
      const q = await fetch(`http://localhost:${PORT}/quotes`, {
        method: "POST", headers: auth, body: JSON.stringify(seed),
      }).then((r) => r.json());
      await drain(await fetch(`http://localhost:${PORT}/quotes/${q.id}`, {
        method: "PUT", headers: auth,
        body: JSON.stringify({ status: "sent", sentAt: new Date().toISOString() }),
      }));
    }

    const stats = await fetch(`http://localhost:${PORT}/analytics/dashboard`, {
      headers: { "x-session-id": sid },
    }).then((r) => r.json());
    assertEquals(stats.customers, 1);
    assertEquals(stats.quotes.sent, 2);
    assertEquals(stats.awaitingResponse, 2);
    assertEquals(stats.quotedValueCents, 1_000_00 + 2_500_00);   // identity sum of cents
  } finally {
    await server.stop();
    await resetKv();
  }
});

Deno.test("analytics e2e: A's stats and B's stats are isolated", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  try {
    const sidA = await login(PORT, "+15125551234");
    const sidB = await login(PORT, "+15125559999");
    await drain(await fetch(`http://localhost:${PORT}/customers`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-session-id": sidA },
      body: JSON.stringify({ name: "A's customer" }),
    }));
    const a = await fetch(`http://localhost:${PORT}/analytics/dashboard`, { headers: { "x-session-id": sidA } }).then((r) => r.json());
    const b = await fetch(`http://localhost:${PORT}/analytics/dashboard`, { headers: { "x-session-id": sidB } }).then((r) => r.json());
    assertEquals(a.customers, 1);
    assertEquals(b.customers, 0);
  } finally {
    await server.stop();
    await resetKv();
  }
});

Deno.test("analytics e2e: GET /analytics/dashboard without session is rejected", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  try {
    const res = await fetch(`http://localhost:${PORT}/analytics/dashboard`);
    const ok = res.ok;
    await drain(res);
    assertEquals(ok, false);
  } finally {
    await server.stop();
    await resetKv();
  }
});

// REQ-397 (demo-loop cycle 2, M14): over the wire, the two reads the
// dashboard renders — a signed 50/50 job billed the way accept bills it
// (INV-001 "sent", INV-002 "scheduled") is $9,600 outstanding across ONE
// invoice, and the job card's next due date is INV-001's.
Deno.test("REQ-397 analytics e2e: GET /analytics/dashboard + GET /jobs show a sent deposit as outstanding cents and the job's next due date", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  try {
    const sid = await login(PORT);
    const userId = (await new SessionStore().get(sid))!.userId;
    const cust = await new CustomerStore().create(userId, { name: "Dana Whitfield" });
    const q = await new QuoteStore().create(userId, {
      summary: "Kitchen remodel",
      lineItems: [],
      customerId: cust.id,
      estimatedTotal: 19_200_00,
      status: "accepted",
      acceptedAt: new Date().toISOString(),
    });
    const inv = new InvoiceStore();
    const due = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
    const later = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
    await inv.create(userId, {
      quoteId: q.id, customerId: cust.id, amount: 9_600_00, dueDate: due,
      installmentIndex: 1, installmentTotal: 2, status: "sent",
    });
    await inv.create(userId, {
      quoteId: q.id, customerId: cust.id, amount: 9_600_00, dueDate: later,
      installmentIndex: 2, installmentTotal: 2, status: "scheduled", scheduledFor: later,
    });

    const stats = await fetch(`http://localhost:${PORT}/analytics/dashboard`, {
      headers: { "x-session-id": sid },
    }).then((r) => r.json());
    assertEquals(stats.invoices.pending, 1);
    assertEquals(stats.invoices.agingBuckets.current, 9_600_00);

    const jobs = await fetch(`http://localhost:${PORT}/jobs`, {
      headers: { "x-session-id": sid },
    }).then((r) => r.json());
    assertEquals(jobs.length, 1);
    assertEquals(jobs[0].nextDueDate, due);
  } finally {
    await server.stop();
    await resetKv();
  }
});

// REQ-698 (demo-loop cycle 5, m14): over HTTP, through the real module wiring
// (AnalyticsModule reaches the assistant threads): a draft mid-wizard is not
// "ready to send", and a deposit-only job is no paid job for the average.
Deno.test("REQ-698 (cycle 5, m14) analytics e2e: GET /analytics/dashboard counts only finished-wizard drafts as readyToSend and only completed jobs as paid", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const port = 20_000 + Math.floor(Math.random() * 20_000);
  const server = await bootstrapServer(TestApp, { port, swagger: false });
  await server.listen();
  try {
    const sid = await login(port, "+15125550698");
    const userId = (await new SessionStore().get(sid))!.userId;
    const quotes = new QuoteStore();
    const conversations = new AgentConversationStore();
    for (const step of [2, TERMS_WIZARD_V1.steps.length]) {
      const q = await quotes.create(userId, {
        summary: "Paint the deck",
        lineItems: [],
        estimatedTotal: 1_450_00,
      });
      const conv = await conversations.create({
        userId,
        quoteId: q.id,
        currentPhase: "terms",
      });
      await conversations.putWizardState(conv.id, {
        specId: TERMS_WIZARD_V1.id,
        activeStepIdx: step,
        answers: [],
      });
    }
    const invoices = new InvoiceStore();
    await invoices.create(userId, {
      quoteId: "q-deck",
      amount: 725_00,
      dueDate: "2026-12-01",
      status: "paid",
      paidAt: new Date().toISOString(),
    } as never);
    await invoices.create(userId, {
      quoteId: "q-deck",
      amount: 725_00,
      dueDate: "2026-12-31",
      status: "scheduled",
    } as never);

    const stats = await fetch(`http://localhost:${port}/analytics/dashboard`, {
      headers: { "x-session-id": sid },
    }).then((r) => r.json());
    assertEquals(stats.quotes.draft, 2);
    assertEquals(stats.quotes.readyToSend, 1);
    assertEquals(stats.revenue.ytdCents, 725_00);
    assertEquals(stats.revenue.paidJobsYtd, 0);
    assertEquals(stats.revenue.paidJobsYtdCents, 0);
  } finally {
    await server.stop();
    await resetKv();
  }
});
