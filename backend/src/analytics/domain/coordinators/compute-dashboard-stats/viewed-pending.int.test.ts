/**
 * REQ-956 (LOOP-007 q1, q1-31) — "Dashboard says no quotes are pending while
 * /quotes shows one out for response".
 *
 * The customer's first open of /q flips a quote sent → viewed. /quotes keeps
 * counting it as "awaiting" (classifyQuoteForPipeline), but the dashboard's
 * quotes.sent / quotedValueCents counted status === "sent" only, so the
 * QUOTES PENDING tile read 0 and its sub-line "—".
 */
import { assertEquals } from "#std/assert";
import { ComputeDashboardStats } from "./mod.ts";
import { CustomerStore } from "@crm/domain/data/customer-store/mod.ts";
import { QuoteStore } from "@paperwork/domain/data/quote-store/mod.ts";
import { InvoiceStore } from "@paperwork/domain/data/invoice-store/mod.ts";
import { PaymentStore } from "@paperwork/domain/data/payment-store/mod.ts";
import { AgentConversationStore } from "@agents/domain/data/agent-conversation-store/mod.ts";
import { classifyQuoteForPipeline } from "#quote-flow/pipeline-stats.ts";
import { resetKv } from "@core/data/kv/mod.ts";

const U = "u-956";
const NOW = new Date(Date.UTC(2026, 10, 18, 1, 37));

Deno.test("REQ-956 (LOOP-007 q1-31) a quote the customer has opened (status 'viewed') is still pending: quotes.sent and quotedValueCents count it, as /quotes does", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  try {
    const quotes = new QuoteStore();
    const flow = new ComputeDashboardStats(
      new CustomerStore(),
      quotes,
      new InvoiceStore(),
      new PaymentStore(),
      new AgentConversationStore(),
    );
    const q = await quotes.create(U, {
      summary: "Q-002 V2",
      lineItems: [],
      estimatedTotal: 3_800_00,
      status: "draft",
    });
    const sentAt = NOW.toISOString();
    await quotes.update(q.id, U, { status: "sent", sentAt } as never);

    let stats = await flow.run(U, NOW);
    assertEquals(stats.quotes.sent, 1, "sent: pending before the open");
    assertEquals(stats.quotedValueCents, 3_800_00);

    // the public controller's first open (public-controller getQuotePublic)
    const viewed = await quotes.update(q.id, U, { status: "viewed" } as never);
    assertEquals(
      classifyQuoteForPipeline(viewed as never),
      "awaiting",
      "/quotes counts it as out for response",
    );

    stats = await flow.run(U, NOW);
    assertEquals(stats.quotes.sent, 1, "viewed: still pending on the dashboard");
    assertEquals(stats.quotedValueCents, 3_800_00, "viewed: its value is still pending");
  } finally {
    await resetKv();
  }
});
