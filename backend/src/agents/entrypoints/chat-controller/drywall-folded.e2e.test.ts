/**
 * REQ-1095 (LOOP-007 cycle 3, q3-19 + q3-20) — on the booted app, over HTTP:
 * in the sent Q-002's chat (Pintura interior $2,300 + Reparación de drywall
 * en la cocina $380, titled "Pintura interior y drywall"), "add hallway
 * painting $450 to Q-002", with the model scripted as the tester's turn went:
 * revise_quote {remove drywall, newTotalDollars 2680 (the current total)} +
 * change_order {Pintura del pasillo $450}. GET /quotes/:id must show a
 * pending Version 2 of $2,750 with Pintura at $2,300 — not $3,130 — titled
 * without "drywall", and the reply carries one publish tip.
 */
import "#reflect-metadata";
import { assert, assertEquals } from "#std/assert";
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

const PORT = 19095;
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
  phone = "+15125551095",
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

const USER_TEXT = "add hallway painting $450 to Q-002";

Deno.test("REQ-1095 q3-19/q3-20 e2e: 'add hallway painting $450 to Q-002' — pendingRevision.estimatedTotal is 275000 (never 313000), Pintura stays 230000, the V2 title drops drywall, one publish tip", async () => {
  const original = StubLLMClient.prototype.respond;
  await withServer(async () => {
    const me = await signIn();
    const jose = await new CustomerStore().create(me.userId, {
      name: "Jose Ramirez",
    });
    const store = new QuoteStore();
    await store.create(me.userId, {
      summary: "Otro trabajo",
      lineItems: [{
        description: "Limpieza",
        quantity: 1,
        unit: "job",
        price: 10_000,
      }],
      estimatedTotal: 10_000,
    });
    const quote = await store.create(me.userId, {
      summary: "Pintura interior y reparación de drywall — Jose Ramirez",
      jobName: "Pintura interior y drywall",
      customerId: jose.id,
      lineItems: [
        {
          description: "Pintura interior",
          quantity: 1,
          unit: "trabajo",
          price: 230_000,
        },
        {
          description: "Reparación de drywall en la cocina",
          quantity: 1,
          unit: "trabajo",
          price: 38_000,
        },
      ],
      estimatedTotal: 268_000,
    });
    assertEquals(quote.number, "Q-002");
    await call(me.sid, "PUT", `/quotes/${quote.id}`, { status: "sent" });
    const conv = await new AgentConversationStore().create({
      userId: me.userId,
      quoteId: quote.id,
      customerId: jose.id,
    });

    const revise: LLMAction = {
      type: "revise_quote",
      payload: {
        quoteNumber: "Q-002",
        lines: [],
        remove: ["Reparación de drywall en la cocina"],
        targetTotalCents: 268_000,
      },
    };
    const hallway: LLMAction = {
      type: "change_order",
      payload: { description: "Pintura del pasillo", deltaAmountCents: 45_000 },
    };
    stubWith({ text: "", action: revise, actions: [revise, hallway] });
    const res = await call<{ newMessages: Msg[] }>(
      me.sid,
      "POST",
      "/agents/chat",
      { conversationId: conv.id, content: USER_TEXT, kind: "text" },
    );
    const reply = res.newMessages
      .filter((m) => m.role === "assistant" && m.kind === "text")
      .map((m) => m.content).join("\n");

    const stored = await call<{
      jobName?: string;
      pendingRevision?: {
        estimatedTotal?: number;
        jobName?: string;
        lineItems?: { description: string; price: number }[];
      };
    }>(me.sid, "GET", `/quotes/${quote.id}`);
    const pending = stored.pendingRevision;
    assertEquals(
      pending?.lineItems?.find((l) => l.description === "Pintura interior")
        ?.price,
      230_000,
      `Pintura interior must stay $2,300 — reply: ${reply}`,
    );
    assertEquals(
      pending?.estimatedTotal,
      275_000,
      `Version 2 must be $2,750 — reply: ${reply}`,
    );
    const v2Title = pending && "jobName" in pending
      ? pending.jobName
      : stored.jobName;
    assert(
      !/drywall/i.test(v2Title ?? ""),
      `Version 2 is still titled ${JSON.stringify(v2Title)}`,
    );
    assertEquals(
      (reply.match(/open the quote and tap/gi) ?? []).length,
      1,
      `one publish tip — reply: ${reply}`,
    );
  }).finally(() => {
    StubLLMClient.prototype.respond = original;
  });
});
