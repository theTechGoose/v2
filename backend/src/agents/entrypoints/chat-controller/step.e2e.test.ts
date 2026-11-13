/**
 * REQ-392 (demo-loop cycle 2, M7) — on the booted app, over HTTP, with the
 * stub LLM: POST /agents/chat carries the step the compact "Tell the
 * assistant…" box was typed on, and the server honours it. On Pick a price the
 * turn goes to the pricing engine (the stub has no pricing model, so it can't
 * re-price: the reply says so, carries no generic tiers to replace the ones on
 * screen) and returns the price the contractor named — where the same text
 * without the step is an ordinary chat turn the stub echoes.
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

const PORT = 9392;
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

async function signIn(phone = "+15125557392"): Promise<string> {
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
    businessName: "Nair Remodeling",
    acceptedPaymentMethods: { venmo: { enabled: true, handle: "@nair" } },
  });
  await new BusinessAddressStore().upsert(v.userId, {
    state: "TX",
    postal: "78701",
  });
  return v.sessionId;
}

async function chat(
  sid: string,
  body: Record<string, unknown>,
): Promise<{ conversation: { id: string }; newMessages: Msg[] }> {
  const res = await fetch(`${BASE}/agents/chat`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-session-id": sid },
    body: JSON.stringify(body),
  });
  assert(res.ok, `POST /agents/chat → ${res.status}`);
  return await res.json();
}

const FIX =
  "No that's wrong, it's the WHOLE gut job incl. heated floor, vanity, glass, drain move — more like $28k";

Deno.test("REQ-392 M7 e2e: a correction typed on Pick a price goes to the pricing engine and comes back with the named price for the box (no generic tiers when it can't re-price)", async () => {
  await withServer(async () => {
    const sid = await signIn();
    const res = await chat(sid, {
      content: FIX,
      kind: "text",
      step: {
        id: "price",
        job: "Master bath remodel, tub out, curbless shower, 12x24 tile",
        scope: "Remove the tub\nBuild a curbless shower\nTile 12x24",
        tiers: true,
      },
    });
    assertEquals(res.newMessages.length, 2);
    const [user, reply] = res.newMessages;
    assertEquals(user.payload?.step, "price");
    assertEquals(reply.payload?.step, "price");
    // The stub can't price: the engine's generic tiers stay off the reply.
    assertEquals(reply.payload?.priceSuggestions, undefined);
    assertStringIncludes(reply.content, "couldn't re-price");
    assertEquals(reply.payload?.statedPriceCents, 2_800_000);
    assertStringIncludes(reply.content, "$28,000 in the price box");
    assert(!reply.content.startsWith("(stub)"), "not a chat-model echo");
  });
});

Deno.test("REQ-392 M7 e2e: the same words with no step (or a step the server does not know) are an ordinary chat turn", async () => {
  await withServer(async () => {
    const sid = await signIn();
    const plain = await chat(sid, { content: FIX, kind: "text" });
    assert(plain.newMessages[1].content.startsWith("(stub)"));
    const junk = await chat(sid, {
      conversationId: plain.conversation.id,
      content: FIX,
      kind: "text",
      step: { id: "lock_quote" },
    });
    assert(junk.newMessages[1].content.startsWith("(stub)"));
    assertEquals(junk.newMessages[0].payload?.step, undefined);
  });
});

Deno.test("REQ-658 M17+m51 e2e: the demo's breakdown ask on Pick a price is answered (not re-priced) and its stated $18,000 goes in the box", async () => {
  await withServer(async () => {
    const sid = await signIn("+15125557658");
    const res = await chat(sid, {
      content:
        "how did you get 17,500? 85/hr + cost+15%, break down labor vs materials... make it around 18k",
      kind: "text",
      step: {
        id: "price",
        job: "Kitchen remodel, quartz top, new cabinets",
        scope: "Demo kitchen\nInstall cabinets\nInstall quartz top",
        tiers: true,
      },
    });
    const reply = res.newMessages[1];
    assertEquals(reply.payload?.step, "price");
    assert(!reply.content.includes("couldn't re-price"), reply.content);
    assert(!reply.content.includes("Re-priced"), reply.content);
    assertEquals(reply.payload?.statedPriceCents, 1_800_000);
    assertEquals(reply.payload?.priceSuggestions, undefined);
  });
});
