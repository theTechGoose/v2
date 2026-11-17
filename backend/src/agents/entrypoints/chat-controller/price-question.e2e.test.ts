/**
 * REQ-444 (demo-loop cycle 3, M21) — on the booted app, over HTTP.
 *
 *   1. A question typed on Pick a price reaches the chat model (the stub LLM
 *      echoes it back as "(stub) …") — it is no longer answered by the
 *      re-price template ("Re-priced with your note — …" / "I couldn't
 *      re-price it…"), and the tiers on screen stay.
 *   2. On Ready to send, a message that needs two changes — the job details
 *      AND a $450 permit line — gets both: the model's two tool calls (what
 *      OpenAILLMClient now returns, standed in by the stub) are applied over
 *      the real HTTP path, and the reply names the new total.
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
import { AgentConversationStore } from "@agents/domain/data/agent-conversation-store/mod.ts";
import { StubLLMClient } from "@agents/domain/business/llm/implementations/stub/mod.ts";
import type {
  LLMRequest,
  LLMResponse,
} from "@agents/domain/business/llm/base/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";

@Module({ imports: [AgentsModule] })
class TestApp {}

const PORT = 9444;
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
  phone = "+15125550444",
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
  assert(res.ok, `${method} ${path} → ${res.status}`);
  return await res.json() as T;
}

const DEMO_QUESTION =
  "does this include the quartz slab material or just labor?? ¿y el precio incluye el permiso de plomería? add permit if not";

Deno.test("REQ-444 M21 e2e: a question typed on Pick a price is answered by the chat model — not the re-price template; the tiers on screen stay", async () => {
  await withServer(async () => {
    const me = await signIn();
    const res = await call<{ newMessages: Msg[] }>(
      me.sid,
      "POST",
      "/agents/chat",
      {
        content: DEMO_QUESTION,
        kind: "text",
        step: {
          id: "price",
          job: "Kitchen gut: demo, IKEA cabinets they buy, quartz 48 sqft",
          scope: "Demo existing kitchen\nInstall quartz countertop, 48 sq ft",
          tiers: true,
          options: [
            { label: "Competitive", priceCents: 1_700_000 },
            { label: "Market", priceCents: 2_000_000 },
            { label: "Premium", priceCents: 2_400_000 },
          ],
          basis: "labor_materials_as_noted",
        },
      },
    );
    assertEquals(res.newMessages.length, 2);
    const [user, reply] = res.newMessages;
    assertEquals(user.payload?.step, "price");
    assertEquals(reply.payload?.step, "price", "the step shows the answer");
    assert(
      reply.content.startsWith(`(stub) ${DEMO_QUESTION}`),
      `the chat model answered: ${reply.content}`,
    );
    assert(!reply.content.includes("Re-priced"), reply.content);
    assert(!reply.content.includes("couldn't re-price"), reply.content);
    assertEquals(reply.payload?.priceSuggestions, undefined, "tiers stay");
    assertEquals(reply.payload?.scope, undefined, "details stay");
    assertEquals((await new QuoteStore().listByUser(me.userId)).length, 0);
  });
});

Deno.test("REQ-444 M21 e2e: on Ready to send, the job-details fix and the $450 permit in one message both land — two tool calls, one reply with the new total", async () => {
  const original = StubLLMClient.prototype.respond;
  await withServer(async () => {
    const me = await signIn();
    const quote = await new QuoteStore().create(me.userId, {
      summary: "Kitchen Renovation & Cleanup",
      jobName: "Kitchen Renovation & Cleanup",
      description: "Demo existing kitchen\nInstall quartz countertop",
      descriptionByLang: {
        en: "Demo existing kitchen\nInstall quartz countertop",
        es: "Demoler la cocina existente",
      },
      lineItems: [{
        description: "Kitchen Renovation & Cleanup",
        quantity: 1,
        unit: "ea",
        price: 2_000_000,
      }],
      estimatedTotal: 2_000_000,
      status: "draft",
    });
    const conv = await new AgentConversationStore().create({
      userId: me.userId,
      quoteId: quote.id,
    });
    await call(
      me.sid,
      "POST",
      `/agents/conversations/${conv.id}/transition-to-terms`,
    );

    const seen: LLMRequest[] = [];
    StubLLMClient.prototype.respond = function (
      req: LLMRequest,
    ): Promise<LLMResponse> {
      seen.push(req);
      const details = {
        type: "update_job_details" as const,
        payload: {
          descriptionByLang: {
            en:
              "Demo existing kitchen\nInstall quartz countertop\nPlumbing permit",
            es:
              "Demoler la cocina existente\nInstalar encimera de cuarzo\nPermiso de plomería",
          },
        },
      };
      const permit = {
        type: "change_order" as const,
        payload: { description: "Plumbing permit", deltaAmountCents: 45_000 },
      };
      return Promise.resolve({
        text: "",
        action: details,
        actions: [details, permit],
      });
    };

    const res = await call<{ newMessages: Msg[] }>(
      me.sid,
      "POST",
      "/agents/chat",
      {
        conversationId: conv.id,
        content:
          "fix the Spanish (the quartz line is missing) and add a plumbing permit line $450",
        kind: "text",
        step: { id: "review" },
      },
    );
    assertEquals(seen.length, 1, "one chat-model turn");
    const replies = res.newMessages.filter((m) => m.role === "assistant");
    assertEquals(replies.length, 1);
    const reply = replies[0];
    assert(
      !reply.content.includes(
        "Done — the job details on the quote are updated.",
      ),
      reply.content,
    );
    assertStringIncludes(reply.content, "Updated the job details");
    assertStringIncludes(reply.content, "Plumbing permit ($450.00)");
    assertStringIncludes(reply.content, "$20,450.00");
    assertEquals(reply.payload?.quoteUpdated, quote.id);

    const stored = await call<{
      estimatedTotal: number;
      lineItems: { description: string; price: number }[];
      descriptionByLang?: Record<string, string>;
    }>(me.sid, "GET", `/quotes/${quote.id}`);
    assertEquals(stored.estimatedTotal, 2_045_000);
    assert(
      stored.lineItems.some((l) =>
        l.description === "Plumbing permit" && l.price === 45_000
      ),
      JSON.stringify(stored.lineItems),
    );
    assertStringIncludes(
      stored.descriptionByLang?.es ?? "",
      "Permiso de plomería",
    );
  }).finally(() => {
    StubLLMClient.prototype.respond = original;
  });
});
