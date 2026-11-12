/**
 * REQ-368 (demo-loop cycle 1, M30 + M32) — on the booted app, over HTTP, with
 * the stub LLM (which only echoes): these turns run on the server's own
 * pricing and billing paths, the ones that now answer before any chat model.
 *
 *   M30 (pair 10): "how much do i charge for panel swap 200a" → three priced
 *   tiers and a draft quote, not a refusal.
 *   M32 (pair 1): a 50/50 quote, sent, signed on the public page (which bills
 *   the deposit) → "John signed! Please send him the deposit invoice for
 *   $1,600" names that invoice; the stale "Business / Person" CTA it used to
 *   end in now answers with the bill instead of "All terms answered.".
 */
import "#reflect-metadata";
import { assert, assertEquals, assertStringIncludes } from "#std/assert";
import { Module } from "#danet/core";
import { bootstrapServer } from "#mrg-keystone/danet";
import { AgentsModule } from "@agents/mod-root.ts";
import { OtpStore } from "@users/domain/data/otp-store/mod.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { BusinessIdentityStore } from "@profile/domain/data/business-identity-store/mod.ts";
import { BusinessAddressStore } from "@profile/domain/data/business-address-store/mod.ts";
import { QuoteStore } from "@paperwork/domain/data/quote-store/mod.ts";
import { InvoiceStore } from "@paperwork/domain/data/invoice-store/mod.ts";
import { AgentConversationStore } from "@agents/domain/data/agent-conversation-store/mod.ts";
import { wizardSpecFor } from "@agents/domain/business/terms-wizard-spec/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";

@Module({ imports: [AgentsModule] })
class TestApp {}

const PORT = 9368;
const BASE = `http://localhost:${PORT}`;

interface Msg {
  role: string;
  kind: string;
  content: string;
  payload?: Record<string, unknown>;
}

async function withServer(fn: () => Promise<void>) {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  try {
    await fn();
  } finally {
    await server.stop();
    await resetKv();
  }
}

/** Signed in AND past the assistant's onboarding questions. */
async function signIn(
  phone = "+15125557368",
): Promise<{ sid: string; userId: string }> {
  await (await fetch(`${BASE}/auth/send-otp`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ phoneNumber: phone }),
  })).body?.cancel();
  const stored = await new OtpStore().get(phone);
  const v = await fetch(`${BASE}/auth/verify-otp`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ phoneNumber: phone, code: stored!.code }),
  }).then((r) => r.json());
  await new UserStore().update(v.userId, {
    name: "Pat Painter",
    email: "pat@test.dev",
    language: "en",
  });
  await new BusinessIdentityStore().upsert(v.userId, {
    businessName: "Pat LLC",
    acceptedPaymentMethods: { venmo: { enabled: true, handle: "@pat" } },
  });
  await new BusinessAddressStore().upsert(v.userId, {
    city: "Austin",
    state: "TX",
    postal: "78701",
  });
  return { sid: v.sessionId, userId: v.userId };
}

function api(sid?: string) {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (sid) headers["x-session-id"] = sid;
  return async <T = Record<string, unknown>>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> => {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    assert(res.ok, `${method} ${path} → ${res.status}`);
    return await res.json() as T;
  };
}

const texts = (msgs: Msg[]) =>
  msgs.filter((m) => m.role === "assistant" && m.kind === "text")
    .map((m) => m.content).join("\n");

Deno.test("REQ-368 M30 e2e: 'how much do i charge for panel swap 200a' answers with three priced tiers and a draft quote — not a refusal", async () => {
  await withServer(async () => {
    const me = await signIn();
    const call = api(me.sid);

    const res = await call<
      { conversation: { id: string; quoteId?: string }; newMessages: Msg[] }
    >(
      "POST",
      "/agents/chat",
      { content: "how much do i charge for panel swap 200a" },
    );

    const text = texts(res.newMessages);
    assert(!text.startsWith("(stub)"), `the chat model answered: ${text}`);
    assertStringIncludes(text, "panel swap 200a");
    assertStringIncludes(text, "Competitive: $");
    assertStringIncludes(text, "Market: $");
    assertStringIncludes(text, "Premium: $");

    const card = res.newMessages.find((m) => m.kind === "action_card");
    assert(card, "no draft quote card");
    assertEquals(card!.payload?.status, "draft");
    const quotes = await new QuoteStore().listByUser(me.userId);
    assertEquals(quotes.length, 1);
    assertEquals(quotes[0].status, "draft");
    assertEquals(quotes[0].estimatedTotal, card!.payload?.totalCents);
    assertEquals(res.conversation.quoteId, quotes[0].id);
  });
});

Deno.test("REQ-368 M32 e2e: pair 1 — after John signs (deposit billed on signing), 'send him the deposit invoice' names that invoice, and the stale Person CTA answers with the bill", async () => {
  await withServer(async () => {
    const me = await signIn();
    const call = api(me.sid);
    const john = await call<{ id: string }>("POST", "/customers", {
      name: "John Miller",
      email: "john@example.com",
    });
    const quote = await call<{ id: string }>("POST", "/quotes", {
      customerId: john.id,
      summary: "Repaint 3 Bedrooms and Hallway",
      jobName: "Repaint",
      lineItems: [{
        description: "Repaint 3 bedrooms and hallway",
        quantity: 1,
        unit: "ea",
        price: 320_000,
      }],
      estimatedTotal: 320_000,
      terms: [{
        stepId: "payment_terms",
        label: "Payment terms",
        value: "50 / 50",
      }],
      status: "sent",
    });
    // The assistant conversation the quote was built in: terms wizard done.
    const convs = new AgentConversationStore();
    const conv = await convs.create({
      userId: me.userId,
      quoteId: quote.id,
      currentPhase: "terms",
    });
    const spec = wizardSpecFor("quote");
    await convs.putWizardState(conv.id, {
      specId: spec.id,
      activeStepIdx: spec.steps.length,
      answers: [],
    });

    // John signs on the public page — signing bills the deposit.
    const accepted = await api()<{ ok: boolean }>(
      "POST",
      `/quotes/${quote.id}/accept`,
      {
        signature: "John Miller",
        name: "John Miller",
      },
    );
    assertEquals(accepted.ok, true);
    const billed = (await new InvoiceStore().listByUser(me.userId))
      .filter((i) => i.quoteId === quote.id);
    const deposit = billed.find((i) => i.installmentIndex === 1)!;
    assertEquals(deposit.amount, 160_000);

    const res = await call<
      { conversation: { invoiceId?: string }; newMessages: Msg[] }
    >(
      "POST",
      "/agents/chat",
      {
        conversationId: conv.id,
        content: "John signed! Please send him the deposit invoice for $1,600",
      },
    );
    const text = texts(res.newMessages);
    assertStringIncludes(text, deposit.number!);
    assertStringIncludes(text, "$1,600");
    const card = res.newMessages.find((m) => m.kind === "action_card");
    assertEquals(card?.payload?.actionType, "invoice");
    assertEquals(card?.payload?.invoiceId, deposit.id);
    assertEquals(
      res.newMessages.filter((m) =>
        m.kind === "continue_cta" && m.payload?.toPhase === "terms"
      ).length,
      0,
    );
    // nothing billed twice
    assertEquals(
      (await new InvoiceStore().listByUser(me.userId)).filter((i) =>
        i.quoteId === quote.id
      ).length,
      billed.length,
    );

    // The stale "Is this for a business or a person?" → Person click.
    const t = await call<{ newMessages: Msg[] }>(
      "POST",
      `/agents/conversations/${conv.id}/transition-to-terms`,
    );
    const all = t.newMessages.map((m) => m.content).join("\n");
    assert(!all.includes("All terms answered."), all);
    assertStringIncludes(all, deposit.number!);
  });
});
