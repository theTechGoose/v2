/**
 * REQ-688 (demo-loop cycle 5, issue m65) — "Price disappears from the quote
 * checklist", on the booted app over HTTP. The price card's Continue creates
 * the quote and moves the thread into the terms wizard
 * (POST /agents/conversations/:id/transition-to-terms); the thread read back
 * (GET /agents/conversations/:id) now carries the "Price: $1,850.00" pick
 * line the checklist draws, and a later price edit shows the new price.
 */
import "#reflect-metadata";
import { assert, assertEquals } from "#std/assert";
import { Module } from "#danet/core";
import { bootstrapServer } from "#mrg-keystone/danet";
import { AgentsModule } from "@agents/mod-root.ts";
import { OtpStore } from "@users/domain/data/otp-store/mod.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { QuoteStore } from "@paperwork/domain/data/quote-store/mod.ts";
import { AgentConversationStore } from "@agents/domain/data/agent-conversation-store/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";

@Module({ imports: [AgentsModule] })
class TestApp {}

const PORT = 9688;
const BASE = `http://localhost:${PORT}`;

interface Msg {
  role: string;
  kind: string;
  content: string;
  payload?: Record<string, unknown>;
}

async function signIn(phone = "+15125550688") {
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
  await new UserStore().update(v.userId, { name: "Sam Ortiz", language: "en" });
  return { sid: v.sessionId as string, userId: v.userId as string };
}

async function call<T>(sid: string, method: string, path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { "content-type": "application/json", "x-session-id": sid },
  });
  assert(
    res.ok,
    `${method} ${path} → ${res.status}: ${await res.clone().text()}`,
  );
  return await res.json() as T;
}

const priceLines = (ms: Msg[]) =>
  ms.filter((m) =>
    m.role === "user" && m.kind === "text" &&
    m.payload?.wizardStepId === "price"
  );

Deno.test("REQ-688 m65 e2e: after the price card's Continue the thread's checklist carries 'Price: $1,850.00', and a price edit updates it", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  try {
    const me = await signIn();
    const quote = await new QuoteStore().create(me.userId, {
      summary: "Fence repair",
      jobName: "Fence repair",
      lineItems: [{
        description: "Fence repair",
        quantity: 1,
        unit: "ea",
        price: 185_000,
      }],
      estimatedTotal: 185_000,
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

    const snap = await call<{ messages: Msg[] }>(
      me.sid,
      "GET",
      `/agents/conversations/${conv.id}`,
    );
    const lines = priceLines(snap.messages);
    assertEquals(
      lines.map((m) => m.content),
      ["Price: $1,850.00"],
      JSON.stringify(snap.messages.map((m) => m.content)),
    );

    await new QuoteStore().update(quote.id, me.userId, {
      estimatedTotal: 240_000,
    });
    const again = await call<{ messages: Msg[] }>(
      me.sid,
      "GET",
      `/agents/conversations/${conv.id}`,
    );
    assertEquals(priceLines(again.messages).map((m) => m.content), [
      "Price: $2,400.00",
    ]);
  } finally {
    await server.stop();
    await resetKv();
  }
});
