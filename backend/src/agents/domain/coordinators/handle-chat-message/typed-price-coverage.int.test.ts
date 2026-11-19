/**
 * REQ-1023 (LOOP-007 cycle 2, q2-3) — the chat's first draft keeps every
 * priced item the contractor typed.
 *
 * Q-002 (fleet-r66a3e3fc-1 stdout:29/36): "…mano de obra 4200 materiales
 * 1350. 50% de anticipo. y tambien arreglar la cerca de madera 18 pies
 * lineales $900" was drafted at $5,100 (labor + fence) and saved; the $1,350
 * materials only appeared after the owner wrote "falta el material de 1350".
 *
 * The stub LLM replays the model's $5,100 create_quote (and repeats it when
 * re-asked); the coordinator is real.
 */
import { assert, assertEquals, assertStringIncludes } from "#std/assert";
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

/** The tester's message #4, as the RCA reconstructed it. */
const Q2_3_MSG =
  "cotizacion para jorge ramirez tel 843 555 2290, 905 calle del sol san antonio tx 78207. pintar la casa por fuera, 2 manos, color beige. mano de obra 4200 materiales 1350. 50% de anticipo. y tambien arreglar la cerca de madera 18 pies lineales $900";

/** The model's $5,100 draft: labor + fence, no materials. */
const DRAFT_5100: Line[] = [
  {
    description:
      "Pintar la casa por fuera, 2 manos, color beige (mano de obra)",
    amountCents: 420_000,
  },
  {
    description: "Arreglar la cerca de madera (18 pies lineales)",
    amountCents: 90_000,
  },
];

const draftCall = (lineItems: Line[]): LLMResponse => ({
  text: "",
  action: {
    type: "create_quote",
    payload: {
      summary: "Pintura exterior y cerca — Jorge Ramirez",
      lineItems,
    },
  },
});

/** Answer every model call with `answer` and keep every request sent. */
function always(llm: StubLLMClient, answer: LLMResponse): LLMRequest[] {
  const seen: LLMRequest[] = [];
  llm.setHandler((req) => {
    seen.push(req);
    return answer;
  });
  return seen;
}

const cardOf = (msgs: AgentMessage[]) =>
  msgs.find((m) => m.kind === "action_card");
const storedTotal = (
  q: { lineItems: { price: number; quantity?: number }[] },
) => q.lineItems.reduce((s, l) => s + l.price * (l.quantity ?? 1), 0);

Deno.test("REQ-1023 q2-3: the Q-002 Spanish message answered with the model's $5,100 create_quote (no materials) is saved at $6,450 with the typed $1,350 materiales line, after one re-ask naming materiales", async () => {
  const ctx = await fresh();
  const conv = await ctx.conversations.create({ userId: "u-1" });
  const seen = always(ctx.llm, draftCall(DRAFT_5100));
  const result = await ctx.flow.run({
    userId: "u-1",
    conversationId: conv.id,
    content: Q2_3_MSG,
  });

  const quoteId = result.conversation.quoteId;
  assert(quoteId, "a draft quote is bound to the conversation");
  const stored = await ctx.quotes.getOwned(quoteId, "u-1");
  const prices = stored.lineItems.map((l) => l.price * (l.quantity ?? 1));
  assert(prices.includes(135_000), `a $1,350 materials line — got ${prices}`);
  assertEquals(storedTotal(stored), 645_000);
  assertEquals(stored.estimatedTotal, 645_000);
  const mat = stored.lineItems.find((l) =>
    l.price * (l.quantity ?? 1) === 135_000
  )!;
  assert(/materia/i.test(mat.description), mat.description);

  // the model was re-asked, and the re-ask named the missing materials
  assert(seen.length >= 2, `the model is re-asked — ${seen.length} call(s)`);
  const notes = seen.slice(1).map((r) =>
    r.messages[r.messages.length - 1].content
  ).join("\n");
  assertStringIncludes(notes.toLowerCase(), "materiales");
  assertStringIncludes(notes, "1,350");

  // the card shows the saved total
  const card = cardOf(result.newMessages)!;
  assertEquals((card.payload as { totalCents: number }).totalCents, 645_000);
  await resetKv();
});

Deno.test("REQ-1023 q2-3: a create_quote that already bills labor, materiales and the fence ($6,450) is saved as the model wrote it", async () => {
  const ctx = await fresh();
  const conv = await ctx.conversations.create({ userId: "u-1" });
  const full: Line[] = [
    ...DRAFT_5100,
    { description: "Materiales", amountCents: 135_000 },
  ];
  always(ctx.llm, draftCall(full));
  const result = await ctx.flow.run({
    userId: "u-1",
    conversationId: conv.id,
    content: Q2_3_MSG,
  });
  const stored = await ctx.quotes.getOwned(result.conversation.quoteId!, "u-1");
  assertEquals(
    stored.lineItems.map((l) => l.price * (l.quantity ?? 1)),
    [420_000, 90_000, 135_000],
  );
  assertEquals(storedTotal(stored), 645_000);
  await resetKv();
});
