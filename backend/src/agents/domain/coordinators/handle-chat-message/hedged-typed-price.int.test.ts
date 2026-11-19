/**
 * REQ-1097 (LOOP-007 cycle 3, q3-22) — a hedged typed price is never billed
 * twice through the chat.
 *
 * Q-003 (r0c106d7f fleet-1 stdout:51): "…materials around 600 labor 1400.
 * also she asked about the gutters - clean them 175…" was drafted by the
 * model as deck $2,000 (600 + 1,400) + gutters $175. REQ-1023's guard could
 * not read "materials around 600", reported labor $1,400 missed, re-asked,
 * and the model's answer (the same lines + "Labor for deck refinishing
 * $1,400") was saved at $3,575.
 *
 * The stub LLM answers every call with the $2,175 create_quote, except the
 * REQ-1023 typed-price re-ask ("… is a billed line …"), which it answers
 * with the double-billed lines the real model gave. The coordinator is real.
 */
import { assert, assertEquals } from "#std/assert";
import { HandleChatMessage } from "./mod.ts";
import { AgentConversationStore } from "@agents/domain/data/agent-conversation-store/mod.ts";
import { AgentMessageStore } from "@agents/domain/data/agent-message-store/mod.ts";
import { StubLLMClient } from "@agents/domain/business/llm/implementations/stub/mod.ts";
import type {
  LLMRequest,
  LLMResponse,
} from "@agents/domain/business/llm/base/mod.ts";
import { QuoteStore } from "@paperwork/domain/data/quote-store/mod.ts";
import { InvoiceStore } from "@paperwork/domain/data/invoice-store/mod.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { BusinessIdentityStore } from "@profile/domain/data/business-identity-store/mod.ts";
import { CustomerStore } from "@crm/domain/data/customer-store/mod.ts";
import { FileStore } from "@files/domain/data/file-store/mod.ts";
import { BusinessAddressStore } from "@profile/domain/data/business-address-store/mod.ts";
import { SendPaperworkEmail } from "@paperwork/domain/coordinators/send-paperwork-email/mod.ts";
import { EmailService } from "@communication/domain/data/email-service/mod.ts";
import { LogPaperworkMessage } from "@communication/domain/coordinators/log-paperwork-message/mod.ts";
import { ConversationStore as CommConversationStore } from "@communication/domain/data/conversation-store/mod.ts";
import { MessageStore as CommMessageStore } from "@communication/domain/data/message-store/mod.ts";
import { EventBus } from "@core/business/events/mod.ts";
import { getKv, resetKv } from "@core/data/kv/mod.ts";
import { ChangeOrderStore } from "@paperwork/domain/data/change-order-store/mod.ts";
import type { SendChangeOrderAlert } from "@paperwork/domain/coordinators/send-change-order-alert/mod.ts";
import { ApplyChatChangeOrder } from "@agents/domain/coordinators/apply-chat-change-order/mod.ts";
import { ReviseQuote } from "@agents/domain/coordinators/revise-quote/mod.ts";
import type { AgentMessage } from "@agents/dto/message.ts";

async function seedOnboarded(userId: string) {
  const kv = await getKv();
  const now = new Date().toISOString();
  await kv.set(["user", userId], {
    id: userId,
    phoneNumber: "+15125550106",
    name: "Jorge Castillo",
    email: "jorge@test.dev",
    language: "es",
    createdAt: now,
    updatedAt: now,
  });
  await new BusinessIdentityStore().upsert(userId, {
    businessName: "Castillo Painting",
    acceptedPaymentMethods: { check: { enabled: true } },
  });
  await new BusinessAddressStore().upsert(userId, {
    city: "Austin",
    state: "TX",
    postal: "78704",
  });
}

async function fresh() {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  await seedOnboarded("u-1");
  const conversations = new AgentConversationStore();
  const messages = new AgentMessageStore();
  const llm = new StubLLMClient();
  const quotes = new QuoteStore();
  const invoices = new InvoiceStore();
  const customers = new CustomerStore();
  const users = new UserStore();
  const identity = new BusinessIdentityStore();
  const email = new EmailService();
  email.send = () => Promise.resolve({ ok: true, reason: "test_capture" });
  const emailer = new SendPaperworkEmail(
    quotes,
    invoices,
    customers,
    users,
    identity,
    email,
    new LogPaperworkMessage(
      new CommConversationStore(),
      new CommMessageStore(),
    ),
  );
  const alert = {
    run: () => Promise.resolve({ ok: true }),
  } as unknown as SendChangeOrderAlert;
  const flow = new HandleChatMessage(
    conversations,
    messages,
    quotes,
    new FileStore(),
    users,
    identity,
    new BusinessAddressStore(),
    new EventBus(),
    emailer,
    llm,
    new ApplyChatChangeOrder(
      quotes,
      invoices,
      new ChangeOrderStore(),
      customers,
      alert,
    ),
    new ReviseQuote(quotes, customers),
    undefined,
    customers,
  );
  return { conversations, messages, llm, quotes, flow };
}

type Line = { description: string; amountCents: number };

/** The tester's exact message. */
const Q3_22_MSG =
  "ok so maria lopez again, she also wants the back deck done. its about 14x20, sand it down, replace like 6 boards maybe 8, then 2 coats of semi transparent stain. materials around 600 labor 1400. also she asked about the gutters - clean them 175. give her a good/better: good = deck only, better = deck + gutters";

const DRAFT: Line[] = [
  {
    description:
      "Deck refinishing (sand down, replace 6-8 boards, 2 coats of semi-transparent stain)",
    amountCents: 200_000,
  },
  { description: "Gutter cleaning", amountCents: 17_500 },
];
const REASKED: Line[] = [
  ...DRAFT,
  { description: "Labor for deck refinishing", amountCents: 140_000 },
];

/** REQ-1023's typed-price re-ask (stated-price `missedPricesNote`). */
const TYPED_PRICE_NOTE = /The contractor typed .* billed line/;

const draftCall = (lineItems: Line[]): LLMResponse => ({
  text: "",
  action: {
    type: "create_quote",
    payload: { summary: "Deck refinishing — Maria Lopez", lineItems },
  },
});

const cardOf = (msgs: AgentMessage[]) =>
  msgs.find((m) => m.kind === "action_card");

Deno.test("REQ-1097 q3-22: 'materials around 600 labor 1400' answered with deck $2,000 + gutters $175 is saved at $2,175 — no re-ask, no separate $1,400 labor line", async () => {
  const ctx = await fresh();
  const conv = await ctx.conversations.create({ userId: "u-1" });
  const seen: LLMRequest[] = [];
  ctx.llm.setHandler((req) => {
    seen.push(req);
    const last = req.messages[req.messages.length - 1]?.content ?? "";
    return draftCall(TYPED_PRICE_NOTE.test(last) ? REASKED : DRAFT);
  });
  const result = await ctx.flow.run({
    userId: "u-1",
    conversationId: conv.id,
    content: Q3_22_MSG,
  });

  const quoteId = result.conversation.quoteId;
  assert(quoteId, "a draft quote is bound to the conversation");
  const stored = await ctx.quotes.getOwned(quoteId, "u-1");
  const lines = stored.lineItems.map((l) =>
    `${l.description} ${l.price * (l.quantity ?? 1)}`
  );
  const reasks = seen.slice(1).map((r) =>
    r.messages[r.messages.length - 1].content
  );
  assertEquals(
    reasks.filter((n) => TYPED_PRICE_NOTE.test(n)),
    [],
    "the model is never re-asked to add labor as its own line",
  );
  assert(
    !stored.lineItems.some((l) => /^labou?r/i.test(l.description)),
    `no separate labor line — got ${JSON.stringify(lines)}`,
  );
  assertEquals(stored.estimatedTotal, 217_500, JSON.stringify(lines));
  const card = cardOf(result.newMessages)!;
  assertEquals((card.payload as { totalCents: number }).totalCents, 217_500);
  await resetKv();
});
