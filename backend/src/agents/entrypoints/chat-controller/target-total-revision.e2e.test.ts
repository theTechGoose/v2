/**
 * REQ-1027 (LOOP-007 cycle 2, q2-4) — on the booted app, over HTTP: in the
 * Q-002 chat "jorge dijo que es mucho. haz una version 2 de Q-002 sin la
 * cerca, solo la pintura, total 5,550", with the model scripted to send what
 * the tester's turn sent (revise_quote Pintura exterior → 555000, remove
 * cerca). The pending Version 2 read back from GET /quotes/:id must be the
 * $5,550 he typed (or nothing is written and he is asked) — never $6,900.
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

const PORT = 19027;
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
  phone = "+15125551027",
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
    language: "es",
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

const Q24_TEXT =
  "jorge dijo que es mucho. haz una version 2 de Q-002 sin la cerca, solo la pintura, total 5,550";

Deno.test("REQ-1027 q2-4 e2e: 'sin la cerca, solo la pintura, total 5,550' in the sent Q-002's chat — pendingRevision.estimatedTotal is 555000 (or nothing written + an ask), never 690000", async () => {
  const original = StubLLMClient.prototype.respond;
  await withServer(async () => {
    const me = await signIn();
    const jorge = await new CustomerStore().create(me.userId, {
      name: "Jorge Ramírez",
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
      summary: "Pintura exterior y cerca — Jorge Ramírez",
      jobName: "Pintura exterior y cerca",
      customerId: jorge.id,
      lineItems: [
        {
          description: "Pintura exterior",
          quantity: 1,
          unit: "job",
          price: 420_000,
        },
        {
          description: "Reparación de cerca (tablas y postes)",
          quantity: 1,
          unit: "job",
          price: 90_000,
        },
        {
          description: "Materiales para pintura",
          quantity: 1,
          unit: "job",
          price: 135_000,
        },
      ],
      estimatedTotal: 645_000,
    });
    assertEquals(quote.number, "Q-002");
    await call(me.sid, "PUT", `/quotes/${quote.id}`, { status: "sent" });
    const conv = await new AgentConversationStore().create({
      userId: me.userId,
      quoteId: quote.id,
      customerId: jorge.id,
    });

    const revise: LLMAction = {
      type: "revise_quote",
      payload: {
        quoteNumber: "Q-002",
        lines: [{ match: "Pintura exterior", amountCents: 555_000 }],
        remove: ["cerca"],
      },
    };
    stubWith({ text: "", action: revise, actions: [revise] });
    const res = await call<{ newMessages: Msg[] }>(
      me.sid,
      "POST",
      "/agents/chat",
      { conversationId: conv.id, content: Q24_TEXT, kind: "text" },
    );
    const reply = res.newMessages
      .filter((m) => m.role === "assistant" && m.kind === "text")
      .map((m) => m.content).join("\n");
    assert(!reply.includes("6,900"), reply);

    const stored = await call<{
      estimatedTotal: number;
      pendingRevision?: {
        estimatedTotal?: number;
        lineItems?: { description: string; price: number }[];
      };
    }>(me.sid, "GET", `/quotes/${quote.id}`);
    if (stored.pendingRevision) {
      assertEquals(
        stored.pendingRevision.estimatedTotal,
        555_000,
        `Version 2 must be the $5,550 he typed — reply: ${reply}`,
      );
      assertEquals(
        stored.pendingRevision.lineItems?.find((l) =>
          /materiales/i.test(l.description)
        )?.price,
        135_000,
      );
    } else {
      assertStringIncludes(reply, "5,550");
      assertEquals(stored.estimatedTotal, 645_000);
    }
  }).finally(() => {
    StubLLMClient.prototype.respond = original;
  });
});
