import { assert, assertEquals, assertRejects } from "#std/assert";
import { SendInvoice } from "./mod.ts";
import { AgentConversationStore } from "@agents/domain/data/agent-conversation-store/mod.ts";
import { AgentMessageStore } from "@agents/domain/data/agent-message-store/mod.ts";
import { ContractStore } from "@paperwork/domain/data/contract-store/mod.ts";
import { InvoiceStore } from "@paperwork/domain/data/invoice-store/mod.ts";
import { QuoteStore } from "@paperwork/domain/data/quote-store/mod.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { CustomerStore } from "@crm/domain/data/customer-store/mod.ts";
import { SendPaperworkEmail } from "@paperwork/domain/coordinators/send-paperwork-email/mod.ts";
import { EmailService } from "@communication/domain/data/email-service/mod.ts";
import { EventBus } from "@core/business/events/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";

function fresh() {
  const conversations = new AgentConversationStore();
  const messages = new AgentMessageStore();
  const contracts = new ContractStore();
  const invoices = new InvoiceStore();
  const quotes = new QuoteStore();
  const customers = new CustomerStore();
  const email = new EmailService();
  const bus = new EventBus();
  const emailer = new SendPaperworkEmail(quotes, contracts, invoices, customers, new UserStore(), email);
  return {
    conversations, messages, contracts, invoices, customers, bus, emailer,
    flow: new SendInvoice(conversations, messages, contracts, invoices, bus, emailer),
  };
}

async function withKv<T>(fn: () => Promise<T>): Promise<T> {
  Deno.env.set("KV_PATH", ":memory:");
  Deno.env.delete("POSTMARK_API_KEY");
  await resetKv();
  try { return await fn(); } finally { await resetKv(); }
}

Deno.test("send-invoice: creates invoice from contract, flips→sent, appends action_card, binds conv.invoiceId", async () => {
  await withKv(async () => {
    const s = fresh();
    const contract = await s.contracts.create("u-1", { quoteId: "q-1", totalAmount: 1200, status: "accepted" });
    const conv = await s.conversations.update(
      (await s.conversations.create({ userId: "u-1", currentPhase: "terms" })).id,
      { contractId: contract.id },
    );
    const r = await s.flow.run({ userId: "u-1", conversationId: conv.id });
    assertEquals(r.newMessages.length, 1);
    assertEquals(r.newMessages[0].kind, "action_card");
    assert(r.conversation.invoiceId);
    const inv = await s.invoices.get(r.conversation.invoiceId!);
    assertEquals(inv.status, "sent");
    assertEquals(inv.amount, 1200);
    assertEquals(inv.contractId, contract.id);
  });
});

Deno.test("send-invoice: re-Send retries email but state-flip + bus emit + invoiceId stay idempotent", async () => {
  await withKv(async () => {
    const s = fresh();
    // deno-lint-ignore no-explicit-any
    const events: any[] = [];
    s.bus.subscribe((e) => { if (e.entityType === "invoice") events.push(e); });
    const contract = await s.contracts.create("u-1", { quoteId: "q-1", totalAmount: 500, status: "accepted" });
    const conv = await s.conversations.update(
      (await s.conversations.create({ userId: "u-1", currentPhase: "terms" })).id,
      { contractId: contract.id },
    );
    const a = await s.flow.run({ userId: "u-1", conversationId: conv.id });
    const b = await s.flow.run({ userId: "u-1", conversationId: conv.id });
    assertEquals(a.conversation.invoiceId, b.conversation.invoiceId);
    // State flip + bus emit fire once. Email dispatch retries every
    // click — a previously-failed delivery (POSTMARK_FROM unset,
    // network blip) shouldn't leave the invoice "sent" without ever
    // reaching the customer.
    assertEquals(events.filter((e) => e.action === "sent").length, 1);
  });
});

Deno.test("send-invoice: forbidden when conversation has no contract bound", async () => {
  await withKv(async () => {
    const s = fresh();
    const conv = await s.conversations.create({ userId: "u-1", currentPhase: "quote" });
    await assertRejects(
      () => s.flow.run({ userId: "u-1", conversationId: conv.id }),
      Error,
      "no bound contract",
    );
  });
});

Deno.test("send-invoice: forbidden across users", async () => {
  await withKv(async () => {
    const s = fresh();
    const contract = await s.contracts.create("u-A", { quoteId: "q-1", totalAmount: 100, status: "accepted" });
    const conv = await s.conversations.update(
      (await s.conversations.create({ userId: "u-B", currentPhase: "terms" })).id,
      { contractId: contract.id },
    );
    await assertRejects(
      () => s.flow.run({ userId: "u-B", conversationId: conv.id }),
    );
  });
});

Deno.test("send-invoice: emits 'invoice:sent' on the bus", async () => {
  await withKv(async () => {
    const s = fresh();
    // deno-lint-ignore no-explicit-any
    const events: any[] = [];
    s.bus.subscribe((e) => { events.push(e); });
    const contract = await s.contracts.create("u-1", { quoteId: "q-1", totalAmount: 999, status: "accepted" });
    const conv = await s.conversations.update(
      (await s.conversations.create({ userId: "u-1", currentPhase: "terms" })).id,
      { contractId: contract.id },
    );
    await s.flow.run({ userId: "u-1", conversationId: conv.id });
    const sent = events.find((e) => e.entityType === "invoice" && e.action === "sent");
    assert(sent);
  });
});
