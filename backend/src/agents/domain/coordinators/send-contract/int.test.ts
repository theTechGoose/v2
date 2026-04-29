import { assert, assertEquals, assertRejects } from "#std/assert";
import { SendContract } from "./mod.ts";
import { AgentConversationStore } from "@agents/domain/data/agent-conversation-store/mod.ts";
import { AgentMessageStore } from "@agents/domain/data/agent-message-store/mod.ts";
import { ContractStore } from "@paperwork/domain/data/contract-store/mod.ts";
import { QuoteStore } from "@paperwork/domain/data/quote-store/mod.ts";
import { InvoiceStore } from "@paperwork/domain/data/invoice-store/mod.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { CustomerStore } from "@crm/domain/data/customer-store/mod.ts";
import { SendPaperworkEmail } from "@paperwork/domain/coordinators/send-paperwork-email/mod.ts";
import { EmailService, type SendEmailInput } from "@communication/domain/data/email-service/mod.ts";
import { EventBus, type DomainEvent } from "@core/business/events/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";

function fresh() {
  const conversations = new AgentConversationStore();
  const messages = new AgentMessageStore();
  const contracts = new ContractStore();
  const quotes = new QuoteStore();
  const invoices = new InvoiceStore();
  const customers = new CustomerStore();
  const bus = new EventBus();
  const email = new EmailService();
  const sentEmails: SendEmailInput[] = [];
  email.send = async (input: SendEmailInput) => {
    sentEmails.push(input);
    return { ok: true, reason: "test_capture" };
  };
  const emailer = new SendPaperworkEmail(quotes, contracts, invoices, customers, new UserStore(), email);
  const flow = new SendContract(conversations, messages, contracts, quotes, bus, emailer);
  return { conversations, messages, contracts, quotes, customers, bus, sentEmails, flow };
}

async function makeReadyConversation(userId = "u-1") {
  const ctx = fresh();
  const customer = await ctx.customers.create(userId, { name: "Tom & Linda K.", email: "tom@example.com" });
  // sentAt set so the SendContract quote-backfill path stays a no-op
  // for these tests (the backfill is exercised by its own dedicated test).
  const quote = await ctx.quotes.create(userId, {
    summary: "Roof", lineItems: [], estimatedTotal: 12_500,
    status: "sent", sentAt: new Date().toISOString(), customerId: customer.id,
  });
  const contract = await ctx.contracts.create(userId, { quoteId: quote.id, customerId: customer.id, status: "draft", totalAmount: 12_500 });
  const created = await ctx.conversations.create({ userId, quoteId: quote.id, customerId: customer.id });
  const conv = await ctx.conversations.update(created.id, { contractId: contract.id });
  return { ...ctx, conv, contract, customer, quote };
}

Deno.test("send-contract: flips contract.status to 'sent' on first call", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const ctx = await makeReadyConversation();

  const r = await ctx.flow.run({ userId: "u-1", conversationId: ctx.conv.id, contractId: ctx.contract.id });

  const reloaded = await ctx.contracts.getOwned(ctx.contract.id, "u-1");
  assertEquals(reloaded.status, "sent");
  assertEquals(r.conversation.id, ctx.conv.id);
  assert(r.newMessages.length > 0, "should append at least one message confirming the send");
  await resetKv();
});

Deno.test("send-contract: dispatches paperwork email to the bound customer", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const ctx = await makeReadyConversation();

  await ctx.flow.run({ userId: "u-1", conversationId: ctx.conv.id, contractId: ctx.contract.id });

  assertEquals(ctx.sentEmails.length, 1);
  assertEquals(ctx.sentEmails[0].to, "tom@example.com");
  assert(/contract/i.test(ctx.sentEmails[0].subject), "email subject should mention contract");
  await resetKv();
});

Deno.test("send-contract: emits 'sent' DomainEvent on the bus", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const ctx = await makeReadyConversation();
  const seen: DomainEvent[] = [];
  ctx.bus.subscribe((e) => { seen.push(e); });

  await ctx.flow.run({ userId: "u-1", conversationId: ctx.conv.id, contractId: ctx.contract.id });

  const ev = seen.find((e) => e.entityType === "contract" && e.action === "sent");
  assert(ev, "expected a contract:sent DomainEvent");
  assertEquals(ev!.entityId, ctx.contract.id);
  await resetKv();
});

Deno.test("send-contract: re-Send re-fires email but state-flip + bus emit stay idempotent", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const ctx = await makeReadyConversation();
  const events: DomainEvent[] = [];
  ctx.bus.subscribe((e) => { if (e.entityType === "contract" && e.action === "sent") events.push(e); });

  await ctx.flow.run({ userId: "u-1", conversationId: ctx.conv.id, contractId: ctx.contract.id });
  assertEquals(ctx.sentEmails.length, 1);
  assertEquals(events.length, 1);

  // Second click: previous attempt may have failed delivery (e.g., POSTMARK_FROM
  // missing on first try); the user clicks Send again expecting a retry.
  // Email re-fires; status flip + bus emit do NOT double — those are
  // one-time state changes.
  await ctx.flow.run({ userId: "u-1", conversationId: ctx.conv.id, contractId: ctx.contract.id });
  assertEquals(ctx.sentEmails.length, 2, "email retries on every Send click");
  assertEquals(events.length, 1, "contract:sent bus event fires once");
  const reloaded = await ctx.contracts.getOwned(ctx.contract.id, "u-1");
  assertEquals(reloaded.status, "sent");
  await resetKv();
});

Deno.test("send-contract: forbidden across users", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const ctx = await makeReadyConversation();

  await assertRejects(
    () => ctx.flow.run({ userId: "u-OTHER", conversationId: ctx.conv.id, contractId: ctx.contract.id }),
    Error,
    "forbidden",
  );
  // Status untouched.
  const reloaded = await ctx.contracts.getOwned(ctx.contract.id, "u-1");
  assertEquals(reloaded.status, "draft");
  await resetKv();
});

Deno.test("send-contract: backfills the quote email when LockQuote couldn't deliver (no quote.sentAt)", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  Deno.env.delete("POSTMARK_API_KEY");
  await resetKv();
  const ctx = fresh();
  // Setup mirrors the real bug: customer is bound to conv via the wizard,
  // but the quote was locked BEFORE the customer existed — so quote.customerId
  // is missing and quote.sentAt was never stamped.
  const customer = await ctx.customers.create("u-1", { name: "Late Customer", email: "late@example.com" });
  const quote = await ctx.quotes.create("u-1", {
    summary: "Roof", lineItems: [], estimatedTotal: 12_500, status: "sent",
    // intentionally NO sentAt and NO customerId
  });
  const contract = await ctx.contracts.create("u-1", {
    quoteId: quote.id, customerId: customer.id, status: "draft", totalAmount: 12_500,
  });
  const created = await ctx.conversations.create({ userId: "u-1", quoteId: quote.id, customerId: customer.id });
  const conv = await ctx.conversations.update(created.id, { contractId: contract.id });

  await ctx.flow.run({ userId: "u-1", conversationId: conv.id, contractId: contract.id });

  // Should have sent BOTH the contract and the previously-undelivered quote.
  assertEquals(ctx.sentEmails.length, 2, "contract + backfilled quote");
  const subjects = ctx.sentEmails.map((e) => e.subject);
  assert(subjects.some((s) => /\bRoof\b|\bquote\b/i.test(s)), "quote email dispatched");
  assert(subjects.some((s) => /contract/i.test(s)), "contract email dispatched");
  // Quote.customerId must be backfilled from conv.customerId so the
  // emailer had a recipient to resolve.
  const reloadedQuote = await ctx.quotes.getOwned(quote.id, "u-1");
  assertEquals(reloadedQuote.customerId, customer.id);
  await resetKv();
});

Deno.test("send-contract: rejects a contract id that doesn't match conv.contractId", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const ctx = await makeReadyConversation();
  // A second contract owned by the same user, but NOT bound to this conversation.
  const stray = await ctx.contracts.create("u-1", { quoteId: ctx.quote.id, customerId: ctx.customer.id, status: "draft" });

  await assertRejects(
    () => ctx.flow.run({ userId: "u-1", conversationId: ctx.conv.id, contractId: stray.id }),
    Error,
  );
  const reloaded = await ctx.contracts.getOwned(stray.id, "u-1");
  assertEquals(reloaded.status, "draft");
  await resetKv();
});
