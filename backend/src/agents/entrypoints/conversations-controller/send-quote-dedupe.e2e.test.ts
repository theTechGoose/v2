/**
 * REQ-399 (demo-loop cycle 2, M16 + M17) — over HTTP on the booted app, the
 * two halves of the send dialog's Send that the server owns:
 *
 *   M16: two POST /agents/conversations/:id/send-quote with the same
 *        requestId (a double-click, a retried request) deliver ONE email and
 *        leave ONE "emailed to" divider in the thread.
 *   M17: PUT /customers/:id with "bob at gmail" is refused with the
 *        dictionary key `customer.invalidEmail` in body.message — the key
 *        the dialog maps to translated copy (never the transport line).
 */
import "#reflect-metadata";
import { assertEquals } from "#std/assert";
import { Module } from "#danet/core";
import { bootstrapServer } from "#mrg-keystone/danet";
import { AgentsModule } from "@agents/mod-root.ts";
import { AnalyticsModule } from "@analytics/mod-root.ts";
import { CrmModule } from "@crm/mod-root.ts";
import { PaperworkModule } from "@paperwork/mod-root.ts";
import { UsersModule } from "@users/mod-root.ts";
import { OtpStore } from "@users/domain/data/otp-store/mod.ts";
import { AgentConversationStore } from "@agents/domain/data/agent-conversation-store/mod.ts";
import { getKv, resetKv } from "@core/data/kv/mod.ts";

@Module({
  imports: [
    UsersModule,
    CrmModule,
    PaperworkModule,
    AnalyticsModule,
    AgentsModule,
  ],
})
class TestApp {}

const PORT = 9399;
const BASE = `http://localhost:${PORT}`;

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

async function login(phone = "+15125553399"): Promise<string> {
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
  return v.sessionId;
}

Deno.test("REQ-399 e2e: a double Send with one requestId emails once; an invalid email is refused by key", async () => {
  await withServer(async () => {
    const sid = await login();
    const auth = { "content-type": "application/json", "x-session-id": sid };
    const post = (path: string, body: unknown) =>
      fetch(`${BASE}${path}`, {
        method: "POST",
        headers: auth,
        body: JSON.stringify(body),
      }).then((r) => r.json());

    const customer = await post("/customers", { name: "Bob Gray" });
    const quote = await post("/quotes", {
      summary: "Deck stain",
      lineItems: [],
      estimatedTotal: 42_000,
      customerId: customer.id,
    });
    const kv = await getKv();
    const userKey = ["user", quote.userId];
    const user = (await kv.get<Record<string, unknown>>(userKey)).value!;
    await kv.set(userKey, { ...user, name: "Test Contractor" });
    const conv = await post("/agents/conversations", {});
    await new AgentConversationStore().update(conv.id, {
      quoteId: quote.id,
      customerId: customer.id,
    });

    // M17: the dialog's typed "bob at gmail" — refused by dictionary key.
    const bad = await fetch(`${BASE}/customers/${customer.id}`, {
      method: "PUT",
      headers: auth,
      body: JSON.stringify({ email: "bob at gmail" }),
    });
    assertEquals(bad.status, 400);
    assertEquals((await bad.json()).message, "customer.invalidEmail");

    const ok = await fetch(`${BASE}/customers/${customer.id}`, {
      method: "PUT",
      headers: auth,
      body: JSON.stringify({ email: "bob@example.com" }),
    });
    await ok.body?.cancel();

    // M16: the double-click — two POSTs, one requestId, in flight together.
    const send = {
      quoteId: quote.id,
      channel: "email",
      requestId: "dbl-click-1",
    };
    const [r1, r2] = await Promise.all([
      post(`/agents/conversations/${conv.id}/send-quote`, send),
      post(`/agents/conversations/${conv.id}/send-quote`, send),
    ]);
    const dividers = [...r1.newMessages, ...r2.newMessages];
    assertEquals(dividers.length, 1, "one 'emailed to' card, not two");
    assertEquals(dividers[0].payload.emailedTo, "bob@example.com");

    const detail = await fetch(`${BASE}/agents/conversations/${conv.id}`, {
      headers: { "x-session-id": sid },
    }).then((r) => r.json());
    const inThread = (detail.messages as { kind: string }[]).filter((m) =>
      m.kind === "phase_divider"
    );
    assertEquals(inThread.length, 1, "the thread holds one send divider");
  });
});
