/**
 * REQ-1084 (LOOP-007 cycle 3, q3-18) — on the booted app, over HTTP: in the
 * sent Q-002's chat the owner asks for one new Version that ADDS a line and
 * REMOVES another. ES "Jose quiere agregar pintar el pasillo por $450 y
 * quitar el drywall. hazme una nueva versión", EN "add a new line: hallway
 * painting $450. and remove the drywall line. make it version 2". The model
 * is scripted to send what the tester's turn sent (revise_quote with the new
 * line in lines[] + remove drywall) and, separately, the new `add` field.
 * The reply must never be "… so I changed nothing" / "… así que no cambié
 * nada", and GET /quotes/:id must hold a pending Version 2 of $2,300 + $450 =
 * $2,750 with no drywall line.
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

const PORT = 19084;
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
  phone = "+15125551084",
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

const ES_TEXT =
  "Jose quiere agregar pintar el pasillo por $450 y quitar el drywall. hazme una nueva versión";
const EN_TEXT =
  "add a new line: hallway painting $450. and remove the drywall line. make it version 2";

async function addAndRemoveOnSentQ002(
  content: string,
  lang: "es" | "en",
  payload: Record<string, unknown>,
) {
  const original = StubLLMClient.prototype.respond;
  await withServer(async () => {
    const me = await signIn();
    await new UserStore().update(me.userId, { language: lang });
    const jose = await new CustomerStore().create(me.userId, { name: "Jose" });
    const store = new QuoteStore();
    await store.create(me.userId, {
      summary: "Otro trabajo",
      lineItems: [{ description: "Limpieza", quantity: 1, unit: "job", price: 10_000 }],
      estimatedTotal: 10_000,
    });
    const quote = await store.create(me.userId, {
      summary: "Pintura interior y drywall — Jose",
      jobName: "Pintura interior y drywall",
      customerId: jose.id,
      lineItems: [
        {
          description: "Pintura interior (3 cuartos y sala, paredes y techos)",
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

    const revise = { type: "revise_quote", payload } as unknown as LLMAction;
    stubWith({ text: "", action: revise, actions: [revise] });
    const res = await call<{ newMessages: Msg[] }>(
      me.sid,
      "POST",
      "/agents/chat",
      { conversationId: conv.id, content, kind: "text" },
    );
    const reply = res.newMessages
      .filter((m) => m.role === "assistant")
      .map((m) => m.content).join("\n");
    assert(
      !/changed nothing|no cambié nada/i.test(reply),
      `the assistant refused the add + remove: ${reply}`,
    );

    const stored = await call<{
      estimatedTotal: number;
      version?: number;
      pendingRevision?: {
        estimatedTotal?: number;
        lineItems?: { description: string; price: number; quantity?: number }[];
      };
    }>(me.sid, "GET", `/quotes/${quote.id}`);
    assert(stored.pendingRevision, `no pending Version 2 — reply: ${reply}`);
    const lines = stored.pendingRevision.lineItems ?? [];
    assertEquals(lines.length, 2, JSON.stringify(lines));
    assert(
      !lines.some((l) => /drywall/i.test(l.description)),
      `drywall is still on Version 2: ${JSON.stringify(lines)}`,
    );
    assertEquals(
      lines.find((l) => /3 cuartos/.test(l.description))?.price,
      230_000,
      "the painting line keeps $2,300",
    );
    const added = lines.find((l) => !/3 cuartos/.test(l.description));
    assertEquals((added?.price ?? 0) * (added?.quantity ?? 1), 45_000);
    assertEquals(stored.pendingRevision.estimatedTotal, 275_000, "Version 2 is $2,750");
    assertEquals(stored.estimatedTotal, 268_000, "Version 1 stays $2,680");
    assertStringIncludes(reply, "2,750");
  }).finally(() => {
    StubLLMClient.prototype.respond = original;
  });
}

const TESTER_PAYLOAD = {
  quoteNumber: "Q-002",
  lines: [{ match: "Pintura interior (pasillo)", amountCents: 45_000 }],
  remove: ["drywall"],
};

Deno.test("REQ-1084 q3-18 e2e (ES): 'agregar pintar el pasillo por $450 y quitar el drywall. hazme una nueva versión' with the tester's revise_quote payload → pending Version 2 $2,750, never 'no cambié nada'", async () => {
  await addAndRemoveOnSentQ002(ES_TEXT, "es", TESTER_PAYLOAD);
});

Deno.test("REQ-1084 q3-18 e2e (EN): 'add a new line: hallway painting $450. and remove the drywall line. make it version 2' with the tester's revise_quote payload → pending Version 2 $2,750, never 'I changed nothing'", async () => {
  await addAndRemoveOnSentQ002(EN_TEXT, "en", TESTER_PAYLOAD);
});

Deno.test("REQ-1084 q3-18 e2e (add field): revise_quote { add: [Pintura del pasillo $450], remove: [drywall] } through the chat → pending Version 2 $2,750", async () => {
  await addAndRemoveOnSentQ002(ES_TEXT, "es", {
    quoteNumber: "Q-002",
    lines: [],
    remove: ["drywall"],
    add: [{ description: "Pintura del pasillo", amountCents: 45_000 }],
  });
});
