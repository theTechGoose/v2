/**
 * REQ-763 (demo-loop cycle 5v2, M7) — Raphael: "fix every issue the demo
 * found, loop until there are none."
 *
 * The verifier re-ran M7 on the merged demo-fixes: "install LVP no wait
 * porcelain tile 12x24…" typed in the CHAT gave Q-001 "LVP and porcelain tile
 * install" with an LVP line ($1,800) AND a porcelain line ($1,800) = $3,600,
 * and the Thanksgiving deadline was not shown. REQ-653's pre-pass ran only in
 * GenerateJobOptions; the chat model got the raw words, and the REQ-439
 * typed-items yardstick (also raw) re-asked for the "missing" LVP line.
 */
import { assert, assertEquals, assertStringIncludes } from "#std/assert";
import { HandleChatMessage } from "./mod.ts";
import { readDeadline } from "@agents/domain/business/terms-edit/mod.ts";
import { formatTermDate } from "#quote-flow/format-helpers.ts";
import { AgentConversationStore } from "@agents/domain/data/agent-conversation-store/mod.ts";
import { AgentMessageStore } from "@agents/domain/data/agent-message-store/mod.ts";
import { StubLLMClient } from "@agents/domain/business/llm/implementations/stub/mod.ts";
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
import { HandleWizardAnswer } from "@agents/domain/coordinators/handle-wizard-answer/mod.ts";

async function seedOnboarded(userId: string) {
  const kv = await getKv();
  const now = new Date().toISOString();
  await kv.set(["user", userId], {
    id: userId,
    phoneNumber: "+15125550106",
    name: "Priya Nair",
    email: "priya@test.dev",
    language: "en",
    createdAt: now,
    updatedAt: now,
  });
  await new BusinessIdentityStore().upsert(userId, {
    businessName: "Nair Kitchen & Bath",
    acceptedPaymentMethods: { check: { enabled: true } },
  });
  await new BusinessAddressStore().upsert(userId, {
    city: "Austin",
    state: "TX",
    postal: "78704",
  });
}

function fresh() {
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
  const bus = new EventBus();
  const wizard = new HandleWizardAnswer(
    conversations,
    messages,
    quotes,
    customers,
    users,
    bus,
  );
  const flow = new HandleChatMessage(
    conversations,
    messages,
    quotes,
    new FileStore(),
    users,
    identity,
    new BusinessAddressStore(),
    bus,
    new SendPaperworkEmail(
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
    ),
    llm,
    new ApplyChatChangeOrder(
      quotes,
      invoices,
      new ChangeOrderStore(),
      customers,
      {
        run: () => Promise.resolve({ ok: true }),
      } as unknown as SendChangeOrderAlert,
    ),
    new ReviseQuote(quotes, customers),
    undefined,
    customers,
    undefined,
    undefined, // REQ-583's ChatBilling
    wizard,
  );
  return { conversations, messages, llm, quotes, customers, wizard, flow };
}

type Ctx = ReturnType<typeof fresh>;

const textReplies = (
  msgs: { role: string; kind: string; content: string }[],
) => msgs.filter((m) => m.role === "assistant" && m.kind === "text");

const VERIFIER =
  "install LVP no wait porcelain tile 12x24 in the master bath, 200 sqft, $1,800, for Mark Henderson, client wants it done before thanksgiving";

/** A model that drafts what it reads: an LVP line whenever a user turn it
 *  was sent names LVP (the first ask, or the REQ-439 "missing items" re-ask). */
function faithfulModel(ctx: Ctx, seen: string[]) {
  ctx.llm.setHandler((req) => {
    const userTurns = req.messages
      .filter((m) => m.role === "user" && typeof m.content === "string")
      .map((m) => m.content as string);
    seen.push(...userTurns);
    const lvp = userTurns.some((t) => /\bLVP\b/.test(t));
    const lineItems = [
      ...(lvp
        ? [{ description: "LVP installation (200 sqft)", amountCents: 180_000 }]
        : []),
      {
        description: "Porcelain tile installation (200 sqft, 12x24)",
        amountCents: 180_000,
      },
    ];
    return {
      text: "",
      action: {
        type: "create_quote",
        payload: {
          summary: lvp
            ? "LVP and porcelain tile install — Mark Henderson"
            : "Porcelain tile install — Mark Henderson",
          lineItems,
        },
      },
    } as never;
  });
}

Deno.test("REQ-763 M7 (cycle 5v2): 'install LVP no wait porcelain tile 12x24…' in the chat drafts porcelain only — the model never reads the corrected-away LVP", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const ctx = fresh();
  await seedOnboarded("u-1");
  const seen: string[] = [];
  faithfulModel(ctx, seen);
  const conv = await ctx.conversations.create({ userId: "u-1" });
  const res = await ctx.flow.run({
    userId: "u-1",
    conversationId: conv.id,
    content: VERIFIER,
  });
  assert(
    !seen.some((t) => /\bLVP\b/.test(t)),
    `the model was sent the corrected-away LVP: ${JSON.stringify(seen)}`,
  );
  const card = res.newMessages.find((m) => m.kind === "action_card");
  assert(card, "a quote card");
  const quoteId = (card!.payload as { quoteId: string }).quoteId;
  const q = await ctx.quotes.getOwned(quoteId, "u-1");
  assertEquals(
    q.lineItems.map((l) => l.description),
    ["Porcelain tile installation (200 sqft, 12x24)"],
  );
  assertEquals(q.estimatedTotal, 180_000);
  // the contractor's own words stay in the transcript as typed
  const stored = res.newMessages.find((m) => m.role === "user");
  assertEquals(stored?.content, VERIFIER);
  await resetKv();
});

Deno.test("REQ-763 M7 (cycle 5v2): the deadline typed with a new draft ('done before thanksgiving') is shown in the reply", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const ctx = fresh();
  await seedOnboarded("u-1");
  faithfulModel(ctx, []);
  const conv = await ctx.conversations.create({ userId: "u-1" });
  const res = await ctx.flow.run({
    userId: "u-1",
    conversationId: conv.id,
    content: VERIFIER,
  });
  const reply = textReplies(res.newMessages).map((m) => m.content).join(" ");
  assertStringIncludes(reply.toLowerCase(), "deadline");
  // the day it names (this year's Thanksgiving, or next year's once gone)
  const day = readDeadline(VERIFIER)!;
  assertStringIncludes(reply, formatTermDate(day.iso, "en"));
  await resetKv();
});
