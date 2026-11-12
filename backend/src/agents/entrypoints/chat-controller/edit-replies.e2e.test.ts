/**
 * REQ-585 (demo-loop cycle 4, M4 + M30) — on the booted app, over HTTP.
 *
 *   1. Pair 7's start-date card: "we start monday nov 23 … is 50% normal in
 *      texas?" — the chat model's update_terms (stood in by the stub) answers
 *      the wizard's start step over the real path: the conversation reloads on
 *      the duration question with "Start: Nov 23", the quote's terms carry the
 *      date, and the reply keeps the model's answer about the deposit.
 *   2. Pair 6's Spanish draft: create_quote + update_job_details in one turn
 *      — the quote carries the Spanish job details and no "Todavía no pude…"
 *      line comes back.
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
import { CustomerStore } from "@crm/domain/data/customer-store/mod.ts";
import { AgentConversationStore } from "@agents/domain/data/agent-conversation-store/mod.ts";
import { StubLLMClient } from "@agents/domain/business/llm/implementations/stub/mod.ts";
import type {
  LLMAction,
  LLMRequest,
  LLMResponse,
} from "@agents/domain/business/llm/base/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";

@Module({ imports: [AgentsModule] })
class TestApp {}

const PORT = 9585;
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

async function signIn(
  phone = "+15125550585",
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
    name: "Priya Nair",
    email: "priya@test.dev",
    language: "en",
  });
  await new BusinessIdentityStore().upsert(v.userId, {
    businessName: "Nair Kitchen & Bath",
    acceptedPaymentMethods: { check: { enabled: true } },
  });
  await new BusinessAddressStore().upsert(v.userId, {
    city: "Austin",
    state: "TX",
    postal: "78704",
  });
  return { sid: v.sessionId, userId: v.userId };
}

async function call<T = Record<string, unknown>>(
  sid: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { "content-type": "application/json", "x-session-id": sid },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  assert(
    res.ok,
    `${method} ${path} → ${res.status}: ${await res.clone().text()}`,
  );
  return await res.json() as T;
}

function stubWith(res: LLMResponse): LLMRequest[] {
  const seen: LLMRequest[] = [];
  StubLLMClient.prototype.respond = function (
    req: LLMRequest,
  ): Promise<LLMResponse> {
    seen.push(req);
    return Promise.resolve(res);
  };
  return seen;
}

Deno.test("REQ-585 M4 e2e: on the start-date card, 'we start monday nov 23 … is 50% normal in texas?' sets the start (the thread reloads on the duration question), keeps the deposit answer and never answers an old request", async () => {
  const original = StubLLMClient.prototype.respond;
  await withServer(async () => {
    const me = await signIn();
    const customer = await new CustomerStore().create(me.userId, {
      name: "Carol Henderson",
    });
    const quote = await new QuoteStore().create(me.userId, {
      summary: "Henderson Kitchen Gut",
      jobName: "Henderson Kitchen Gut",
      description: "Full kitchen gut, 12×14\nQuartz countertops",
      lineItems: [{
        description: "Detailed kitchen gut and remodel",
        quantity: 1,
        unit: "ea",
        price: 3_800_000,
      }],
      estimatedTotal: 3_800_000,
      status: "draft",
      customerId: customer.id,
    });
    const conv = await new AgentConversationStore().create({
      userId: me.userId,
      quoteId: quote.id,
      customerId: customer.id,
    });
    await call(
      me.sid,
      "POST",
      `/agents/conversations/${conv.id}/transition-to-terms`,
    );
    await call(me.sid, "POST", "/agents/wizard/answer", {
      conversationId: conv.id,
      stepId: "customer",
      optionId: "use_active",
    });

    const terms: LLMAction = {
      type: "update_terms",
      payload: { startDate: "monday nov 23", paymentTerms: "50_50" },
    };
    const seen = stubWith({
      text: "Yes — a 50% deposit is common for kitchen remodels in Texas.",
      action: terms,
      actions: [terms],
    });
    const res = await call<{ newMessages: Msg[] }>(
      me.sid,
      "POST",
      "/agents/chat",
      {
        conversationId: conv.id,
        content:
          "we start monday nov 23. and I want a 50% deposit upfront, rest when done. is 50% normal in texas?",
        kind: "text",
        step: { id: "wizard", wizardStepId: "start_date" },
      },
    );
    assertEquals(seen.length, 1, "one chat-model turn");
    assert(seen[0].tools?.includes("update_terms"));
    const reply = res.newMessages[res.newMessages.length - 1];
    assertEquals(reply.role, "assistant");
    assertStringIncludes(reply.content, "Set the start date to Nov 23");
    assertStringIncludes(
      reply.content,
      "a 50% deposit is common for kitchen remodels in Texas.",
    );
    assert(!reply.content.includes("couldn't find a line"), reply.content);

    // A reload shows the start answered and the duration question open.
    const snap = await call<{
      messages: Msg[];
      wizard?: { state: { activeStepIdx: number } };
    }>(me.sid, "GET", `/agents/conversations/${conv.id}`);
    assertEquals(snap.wizard?.state.activeStepIdx, 2);
    assert(
      snap.messages.some((m) =>
        m.kind === "text" && m.content.startsWith("Start: Nov 23") &&
        m.payload?.wizardStepId === "start_date"
      ),
      JSON.stringify(snap.messages.map((m) => m.content)),
    );
    const open = snap.messages.filter((m) => m.kind === "wizard").pop();
    assertEquals(open?.payload?.stepId, "wraps");
    const stored = await call<{ terms?: { stepId: string; value: string }[] }>(
      me.sid,
      "GET",
      `/quotes/${quote.id}`,
    );
    assertStringIncludes(
      stored.terms?.find((t) => t.stepId === "start_date")?.value ?? "",
      "-11-23",
    );
  }).finally(() => {
    StubLLMClient.prototype.respond = original;
  });
});

Deno.test("REQ-585 M4 e2e: pair 6's Spanish draft — create_quote + update_job_details in one turn — carries the Spanish job details and says nothing failed", async () => {
  const original = StubLLMClient.prototype.respond;
  await withServer(async () => {
    const me = await signIn("+15125550586");
    const conv = await call<{ id: string }>(
      me.sid,
      "POST",
      "/agents/conversations",
      {},
    );
    const create: LLMAction = {
      type: "create_quote",
      payload: {
        summary: "Reparación de grifo y puertas — Carmen Ruiz",
        lineItems: [
          { description: "Reparación de fuga del grifo", amountCents: 22_500 },
          { description: "Colgar 2 puertas interiores", amountCents: 22_500 },
        ],
      },
    };
    const details: LLMAction = {
      type: "update_job_details",
      payload: {
        descriptionByLang: {
          es:
            "Reparar fuga del grifo de la cocina\nColgar 2 puertas interiores",
        },
      },
    };
    stubWith({ text: "", action: create, actions: [create, details] });
    const res = await call<{ newMessages: Msg[] }>(
      me.sid,
      "POST",
      "/agents/chat",
      {
        conversationId: conv.id,
        content:
          "Quote para Carmen Ruiz: fix leaky faucet en la cocina y colgar 2 puertas interiores, $450 todo incluido. Ella habla español.",
        kind: "text",
      },
    );
    const card = res.newMessages.find((m) => m.kind === "action_card");
    assert(card, JSON.stringify(res.newMessages));
    for (const m of res.newMessages.filter((m) => m.role === "assistant")) {
      assert(!m.content.includes("Todavía no pude"), m.content);
    }
    const stored = await call<{ descriptionByLang?: Record<string, string> }>(
      me.sid,
      "GET",
      `/quotes/${card!.payload?.quoteId}`,
    );
    assertStringIncludes(
      stored.descriptionByLang?.es ?? "",
      "Colgar 2 puertas interiores",
    );
  }).finally(() => {
    StubLLMClient.prototype.respond = original;
  });
});
