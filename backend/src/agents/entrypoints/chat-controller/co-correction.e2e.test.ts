/**
 * REQ-661 (demo-loop cycle 5, M15) — on the booted app, over HTTP: with the
 * Hendersons' Q-001 sent, "heated floor for the hendersons is $1,200 not
 * 150. add it as a change order please" puts a line named "Heated floor" at
 * $1,200 on Q-001's next version — never the sentence as the line's name —
 * and the reply says a change order applies after signing.
 * (The stub LLM only echoes, so this runs on the coordinator's own reading.)
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
import { resetKv } from "@core/data/kv/mod.ts";

@Module({ imports: [AgentsModule] })
class TestApp {}

const PORT = 39661;
const BASE = `http://localhost:${PORT}`;
const DEMO =
  "heated floor for the hendersons is $1,200 not 150. add it as a change order please";

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
  phone = "+15125557661",
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
    state: "TX",
    postal: "78701",
  });
  return { sid: v.sessionId, userId: v.userId };
}

/** Every quote the account owns (the list route lives outside AgentsModule). */
async function quoteIds(userId: string): Promise<string[]> {
  return (await new QuoteStore().listByUser(userId)).map((q) => q.id);
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

Deno.test("REQ-661 M15 e2e: the demo's correction on the Hendersons' sent Q-001 adds 'Heated floor' $1,200 to Version 2 and says why it is not a change order yet", async () => {
  await withServer(async () => {
    const me = await signIn();
    const call = api(me.sid);
    const hendersons = await call<{ id: string }>("POST", "/customers", {
      name: "Hendersons",
    });
    const quote = await call<{ id: string }>("POST", "/quotes", {
      summary: "Master Bath & Kitchen",
      jobName: "Master Bath & Kitchen",
      customerId: hendersons.id,
      lineItems: [{
        description: "Master bath remodel",
        quantity: 1,
        unit: "ea",
        price: 1_875_000,
      }],
      estimatedTotal: 1_875_000,
    });
    await call("PUT", `/quotes/${quote.id}`, { status: "sent" });

    const turn = await call<
      { newMessages: { role: string; kind: string; content: string }[] }
    >("POST", "/agents/chat", { content: DEMO });

    assertEquals(await quoteIds(me.userId), [quote.id], "still one quote");
    const stored = await call<{
      estimatedTotal: number;
      pendingRevision?: {
        lineItems: { description: string; price: number }[];
        estimatedTotal: number;
      };
    }>("GET", `/quotes/${quote.id}`);
    assertEquals(
      stored.estimatedTotal,
      1_875_000,
      "the sent version is untouched",
    );
    assertEquals(
      stored.pendingRevision?.lineItems.map((l) => [l.description, l.price]),
      [["Master bath remodel", 1_875_000], ["Heated floor", 120_000]],
    );
    assertEquals(stored.pendingRevision?.estimatedTotal, 1_995_000);
    const reply = turn.newMessages.at(-1)!.content;
    assert(!/not 150/i.test(reply), reply);
    assert(reply.includes("A change order applies after signing"), reply);
    assert(reply.includes("Version 2"), reply);
  });
});
