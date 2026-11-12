/**
 * REQ-462 (demo-loop cycle 3, M26) — on the booted app, over HTTP: a change
 * order made on the invoices page's endpoint (POST /invoices/:id/change-orders)
 * is edited from the assistant by its number with the demo's own sentence,
 * and withdrawn with "withdraw CO-001". (The stub LLM only echoes, so these
 * turns run on the coordinator's own reading of the sentence.)
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
import { resetKv } from "@core/data/kv/mod.ts";

@Module({ imports: [AgentsModule] })
class TestApp {}

const PORT = 9462;
const BASE = `http://localhost:${PORT}`;
const DEMO =
  'Change of plan on CO-001: make it $1,000 and the description should just say "Upgrade to frameless glass shower door".';

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
async function signIn(phone = "+15125557462"): Promise<{ sid: string }> {
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
    name: "Aisha Bello",
    email: "aisha@test.dev",
    language: "en",
  });
  await new BusinessIdentityStore().upsert(v.userId, {
    businessName: "Bello Remodeling",
    acceptedPaymentMethods: { venmo: { enabled: true, handle: "@bello" } },
  });
  await new BusinessAddressStore().upsert(v.userId, {
    state: "TX",
    postal: "78701",
  });
  return { sid: v.sessionId };
}

function api(sid: string) {
  const headers = { "content-type": "application/json", "x-session-id": sid };
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

interface Co {
  id: string;
  number: string;
  version?: number;
  status: string;
  description: string;
  deltaAmountCents: number;
}

/** Karen's sent Q-001, its invoice INV-001, and CO-001 (+$1,200) on it —
 *  made through the same endpoint the invoices page's form posts to. */
async function seed(call: ReturnType<typeof api>) {
  const karen = await call<{ id: string }>("POST", "/customers", {
    name: "Karen Mills",
  });
  const quote = await call<{ id: string }>("POST", "/quotes", {
    summary: "Bathroom Remodel — Karen Mills",
    jobName: "Bathroom Remodel",
    customerId: karen.id,
    lineItems: [{
      description: "Bathroom remodel",
      quantity: 1,
      unit: "job",
      price: 705_000,
    }],
    estimatedTotal: 705_000,
  });
  await call("PUT", `/quotes/${quote.id}`, { status: "sent" });
  const inv = await call<{ id: string }>("POST", "/invoices", {
    quoteId: quote.id,
    status: "sent",
  });
  const co = await call<Co>("POST", `/invoices/${inv.id}/change-orders`, {
    description: "Frameless glass shower door upgrade",
    deltaAmountCents: 120_000,
  });
  assertEquals(co.number, "CO-001");
  return { inv, co };
}

Deno.test("REQ-462 M26 e2e: the demo's sentence edits CO-001 — Version 2, pending, $1,000.00 and the new wording — and 'withdraw CO-001' deletes it", async () => {
  await withServer(async () => {
    const me = await signIn();
    const call = api(me.sid);
    const { inv, co } = await seed(call);

    const turn = await call<
      { newMessages: { role: string; content: string }[] }
    >("POST", "/agents/chat", { content: DEMO });

    const listed = await call<Co[]>("GET", `/invoices/${inv.id}/change-orders`);
    assertEquals(listed.length, 1, "no CO-002");
    assertEquals(
      {
        id: listed[0].id,
        version: listed[0].version,
        status: listed[0].status,
        description: listed[0].description,
        delta: listed[0].deltaAmountCents,
      },
      {
        id: co.id,
        version: 2,
        status: "pending",
        description: "Upgrade to frameless glass shower door",
        delta: 100_000,
      },
      `CO-001 was not edited — the reply was: ${
        turn.newMessages.at(-1)?.content
      }`,
    );
    assertStringIncludes(turn.newMessages.at(-1)!.content, "CO-001");

    await call("POST", "/agents/chat", { content: "withdraw CO-001" });
    assertEquals(
      await call<Co[]>("GET", `/invoices/${inv.id}/change-orders`),
      [],
      "CO-001 is withdrawn",
    );
  });
});
