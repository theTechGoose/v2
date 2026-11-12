/**
 * REQ-698 (demo-loop cycle 5, demo issue m14) — "Dashboard and Quotes counts
 * disagree with the real state".
 *
 * Pair 10 saw "QUOTES PENDING 0 … 1 draft is ready to send" while the draft
 * was still mid-wizard: `stats.quotes.draft` counted EVERY draft. Pair 1 saw
 * "AVG. PAID JOB $725" for a $1,450 job with only its deposit paid:
 * `paidJobsYtd` counted a job as paid as soon as ANY installment was.
 */
import { assertEquals } from "#std/assert";
import { ComputeDashboardStats } from "./mod.ts";
import { CustomerStore } from "@crm/domain/data/customer-store/mod.ts";
import { QuoteStore } from "@paperwork/domain/data/quote-store/mod.ts";
import { InvoiceStore } from "@paperwork/domain/data/invoice-store/mod.ts";
import { PaymentStore } from "@paperwork/domain/data/payment-store/mod.ts";
import { AgentConversationStore } from "@agents/domain/data/agent-conversation-store/mod.ts";
import { TERMS_WIZARD_V1 } from "@agents/domain/business/terms-wizard-spec/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";

const U = "u-698";
const NOW = new Date(Date.UTC(2026, 10, 12, 19, 0));

function fresh() {
  const customers = new CustomerStore();
  const quotes = new QuoteStore();
  const invoices = new InvoiceStore();
  const payments = new PaymentStore();
  const conversations = new AgentConversationStore();
  return {
    customers,
    quotes,
    invoices,
    payments,
    conversations,
    flow: new ComputeDashboardStats(
      customers,
      quotes,
      invoices,
      payments,
      conversations,
    ),
  };
}

/** a draft quote in an assistant thread whose terms wizard stands at `step` */
async function threadDraft(
  s: ReturnType<typeof fresh>,
  step: number,
) {
  const q = await s.quotes.create(U, {
    summary: "Paint the deck",
    lineItems: [],
    estimatedTotal: 1_450_00,
    status: "draft",
  });
  await s.quotes.update(q.id, U, { lockedAt: NOW.toISOString() } as never);
  const conv = await s.conversations.create({
    userId: U,
    quoteId: q.id,
    currentPhase: "terms",
  });
  await s.conversations.putWizardState(conv.id, {
    specId: TERMS_WIZARD_V1.id,
    activeStepIdx: step,
    answers: [],
  });
  return q;
}

Deno.test("REQ-698 (cycle 5, m14) a draft still mid-wizard is not 'ready to send': quotes.readyToSend counts only drafts whose wizard finished", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  try {
    const s = fresh();
    await threadDraft(s, 2); // pair 10: mid-steps
    let stats = await s.flow.run(U, NOW);
    assertEquals(stats.quotes.draft, 1);
    assertEquals(stats.quotes.readyToSend, 0);

    await threadDraft(s, TERMS_WIZARD_V1.steps.length); // wizard done
    stats = await s.flow.run(U, NOW);
    assertEquals(stats.quotes.draft, 2);
    assertEquals(stats.quotes.readyToSend, 1);
  } finally {
    await resetKv();
  }
});

Deno.test("REQ-698 (cycle 5, m14) a $1,450 job with only its $725 deposit paid is not a paid job: the avg-paid-job divisor and sum cover completed jobs only", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  try {
    const s = fresh();
    const paidAt = new Date(Date.UTC(2026, 10, 12, 18, 0)).toISOString();
    // pair 1: deposit paid, balance scheduled
    await s.invoices.create(U, {
      quoteId: "q-deck",
      amount: 725_00,
      dueDate: "2026-11-19",
      status: "paid",
      paidAt,
    } as never);
    await s.invoices.create(U, {
      quoteId: "q-deck",
      amount: 725_00,
      dueDate: "2026-12-19",
      status: "scheduled",
    } as never);
    let stats = await s.flow.run(U, NOW);
    assertEquals(stats.revenue.ytdCents, 725_00);
    assertEquals(stats.revenue.paidJobsYtd, 0);
    assertEquals(stats.revenue.paidJobsYtdCents, 0);

    // a second job, both installments paid → one completed $2,000 job
    for (const amount of [1_000_00, 1_000_00]) {
      await s.invoices.create(U, {
        quoteId: "q-fence",
        amount,
        dueDate: "2026-11-01",
        status: "paid",
        paidAt,
      } as never);
    }
    stats = await s.flow.run(U, NOW);
    assertEquals(stats.revenue.paidJobsYtd, 1);
    assertEquals(stats.revenue.paidJobsYtdCents, 2_000_00);
  } finally {
    await resetKv();
  }
});
