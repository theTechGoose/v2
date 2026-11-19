/**
 * REQ-1105 (LOOP-007 cycle 3, q3-29; cites REQ-258 / REQ-265 / REQ-672) —
 * "Two 'Suggested' badges on the payment step": the job message said
 * "30% deposit", and both "30/30/40" and "Deposit + balance" were tagged
 * Suggested.
 *
 * The 30/30/40 tag came from the backend: the model's create_quote
 * `paymentTerms` is stored verbatim as conv.termsPrefill.payment_terms
 * (handle-chat-message ~3914) and becomes the payment step's
 * `suggestedOptionId` (terms-prefill suggestedOptionId). The tool
 * description has no rule for a non-50% "N% deposit", so the model picks
 * '30_30_40'. The deterministic parse of the same words
 * (shared extractPaymentTerms, REQ-936) says a deposit then the balance —
 * 'deposit_bal'. What is stored must agree with what the contractor typed.
 */
import { assertEquals } from "#std/assert";
import { HandleChatMessage } from "./mod.ts";
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
import { suggestedOptionId } from "@agents/domain/business/terms-prefill/mod.ts";
import { TERMS_WIZARD_V1 } from "@agents/domain/business/terms-wizard-spec/mod.ts";

async function seedOnboarded(userId: string) {
  const kv = await getKv();
  const now = new Date().toISOString();
  await kv.set(["user", userId], {
    id: userId,
    phoneNumber: "+15125550129",
    name: "Test Contractor",
    email: "me@test.dev",
    language: "en",
    createdAt: now,
    updatedAt: now,
  });
  await new BusinessIdentityStore().upsert(userId, {
    businessName: "Test LLC",
    acceptedPaymentMethods: { venmo: { enabled: true, handle: "@test" } },
  });
  await new BusinessAddressStore().upsert(userId, {
    state: "TX",
    postal: "78701",
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
  const flow = new HandleChatMessage(
    conversations,
    messages,
    quotes,
    new FileStore(),
    users,
    identity,
    new BusinessAddressStore(),
    new EventBus(),
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
  );
  return { conversations, llm, flow };
}

const PAYMENT_STEP = TERMS_WIZARD_V1.steps.find((s) =>
  s.id === "payment_terms"
)!;

/** The QA tester's Q-001 message (demo-loop r0c106d7f fleet-1 stdout:35). */
const QA_MESSAGE =
  "new quote for maria lopez, 1408 Elm St Austin TX 78702. exterior $4,850, fence $1,275.50. option 2: also pressure wash driveway $325. 30% deposit";

async function sendWithModelTerms(content: string, modelTerms: string) {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const { conversations, llm, flow } = fresh();
  await seedOnboarded("u-1");
  // The same tool call on every model turn (a re-ask for left-out items
  // included), as the model kept answering in the QA run.
  llm.setHandler(() => ({
    text: "Drafting a quote.",
    action: {
      type: "create_quote",
      payload: {
        summary: "Exterior paint and fence",
        lineItems: [
          { description: "Exterior paint", amountCents: 485_000 },
          { description: "Fence", amountCents: 127_550 },
        ],
        paymentTerms: modelTerms,
      },
    },
  }));
  const conv = await conversations.create({ userId: "u-1" });
  await flow.run({ userId: "u-1", conversationId: conv.id, content });
  const stored = (await conversations.get(conv.id)).termsPrefill;
  await resetKv();
  return stored;
}

Deno.test("REQ-1105 (LOOP-007 q3, q3-29) handle-chat-message integration: '30% deposit' with the model's paymentTerms '30_30_40' stores 'deposit_bal' — the payment step suggests Deposit + balance, not 30/30/40", async () => {
  const stored = await sendWithModelTerms(QA_MESSAGE, "30_30_40");
  assertEquals(
    stored?.payment_terms,
    "deposit_bal",
    `the message said "30% deposit" (a deposit then the balance), but the stored payment prefill is ${
      JSON.stringify(stored)
    }`,
  );
  // What transition-to-terms / handle-wizard-answer put on the payment
  // step's payload as suggestedOptionId (REQ-258).
  assertEquals(
    suggestedOptionId(stored, PAYMENT_STEP),
    "deposit_bal",
    "the payment step's suggestedOptionId",
  );
});

Deno.test("REQ-1105 (LOOP-007 q3, q3-29) handle-chat-message integration: a stated three-payment '30/30/40' keeps the model's '30_30_40'", async () => {
  const stored = await sendWithModelTerms(
    "exterior paint $4,850, fence $1,275.50, 30/30/40",
    "30_30_40",
  );
  assertEquals(stored?.payment_terms, "30_30_40");
});
