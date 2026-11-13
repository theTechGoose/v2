/**
 * REQ-760 (demo-loop cycle 5v2, demo issue m14) — "Dashboard and Quotes
 * counts disagree with the real state", re-verified NOT FIXED after REQ-698.
 *
 * The verifier's /quotes headline read "Nothing sent yet — 1 draft ready to
 * send." for Q-002 Bob Smith, a draft the assistant had only drafted (thread
 * status "Quote drafted · review", never locked, no terms). REQ-698 taught
 * the DASHBOARD the thread status, but GET /quotes (BuildQuoteCards) carried
 * no readiness at all, so the /quotes hero called every draft ready.
 */
import { assertEquals } from "#std/assert";
import { BuildQuoteCards } from "./mod.ts";
import { ComputeDashboardStats } from "@analytics/domain/coordinators/compute-dashboard-stats/mod.ts";
import { QuoteStore } from "@paperwork/domain/data/quote-store/mod.ts";
import { ViewStore } from "@paperwork/domain/data/view-store/mod.ts";
import { CustomerStore } from "@crm/domain/data/customer-store/mod.ts";
import { ChangeOrderStore } from "@paperwork/domain/data/change-order-store/mod.ts";
import { InvoiceStore } from "@paperwork/domain/data/invoice-store/mod.ts";
import { PaymentStore } from "@paperwork/domain/data/payment-store/mod.ts";
import { AgentConversationStore } from "@agents/domain/data/agent-conversation-store/mod.ts";
import { TERMS_WIZARD_V1 } from "@agents/domain/business/terms-wizard-spec/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";

const U = "u-760";
const NOW = new Date(Date.UTC(2026, 10, 12, 21, 0));

Deno.test("REQ-760 (cycle 5v2, m14) GET /quotes cards say which drafts are ready to send — a drafted-only assistant quote is not, a finished-wizard one is, and the dashboard counts the same ones", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  try {
    const quotes = new QuoteStore();
    const customers = new CustomerStore();
    const conversations = new AgentConversationStore();

    // Q-002 Bob Smith: the assistant drafted it, nothing locked, no terms.
    const bob = await quotes.create(U, {
      summary: "Bathroom tile — Bob Smith",
      lineItems: [],
      estimatedTotal: 2_400_00,
      status: "draft",
    });
    await conversations.create({
      userId: U,
      quoteId: bob.id,
      currentPhase: "quote",
    });

    // a draft whose terms wizard finished — the one that IS ready to send.
    const ready = await quotes.create(U, {
      summary: "Paint the deck",
      lineItems: [],
      estimatedTotal: 1_450_00,
      status: "draft",
    });
    await quotes.update(ready.id, U, { lockedAt: NOW.toISOString() } as never);
    const conv = await conversations.create({
      userId: U,
      quoteId: ready.id,
      currentPhase: "terms",
    });
    await conversations.putWizardState(conv.id, {
      specId: TERMS_WIZARD_V1.id,
      activeStepIdx: TERMS_WIZARD_V1.steps.length,
      answers: [],
    });

    const cards = await new BuildQuoteCards(
      quotes,
      new ViewStore(),
      customers,
      new ChangeOrderStore(),
      conversations,
    ).run(U, NOW);
    const byId = new Map(cards.map((c) => [c.id, c]));
    assertEquals(byId.get(bob.id)?.stage, "draft");
    assertEquals(byId.get(bob.id)?.readyToSend, false);
    assertEquals(byId.get(ready.id)?.readyToSend, true);

    const stats = await new ComputeDashboardStats(
      customers,
      quotes,
      new InvoiceStore(),
      new PaymentStore(),
      conversations,
    ).run(U, NOW);
    assertEquals(
      stats.quotes.readyToSend,
      cards.filter((c) => c.readyToSend).length,
    );
  } finally {
    await resetKv();
  }
});
