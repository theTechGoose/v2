/**
 * REQ-956 (LOOP-007 q1, q1-31) — over HTTP: the owner sends a quote, the
 * customer opens the public link once (GET /quotes/:id/public, no session,
 * no ?refresh=1 → sent flips to viewed), and GET /analytics/dashboard must
 * still count it as pending (quotes.sent, awaitingResponse, quotedValueCents).
 */
import "#reflect-metadata";
import { assertEquals } from "#std/assert";
import { Module } from "#danet/core";
import { bootstrapServer } from "#mrg-keystone/danet";
import { AnalyticsModule } from "@analytics/mod-root.ts";
import { OtpStore } from "@users/domain/data/otp-store/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";

@Module({ imports: [AnalyticsModule] })
class TestApp {}

const PORT = 39000 + Math.floor(Math.random() * 20000);
const BASE = `http://localhost:${PORT}`;

async function drain(res: Response) {
  await res.body?.cancel();
}

async function login(phone = "+15125559560"): Promise<string> {
  await drain(
    await fetch(`${BASE}/auth/send-otp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ phoneNumber: phone }),
    }),
  );
  const stored = await new OtpStore().get(phone);
  const v = await fetch(`${BASE}/auth/verify-otp`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ phoneNumber: phone, code: stored!.code }),
  }).then((r) => r.json());
  return v.sessionId;
}

Deno.test("REQ-956 (LOOP-007 q1-31) GET /analytics/dashboard still counts a sent quote as pending after the customer opens its public link (sent → viewed)", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  try {
    const sid = await login();
    const auth = { "content-type": "application/json", "x-session-id": sid };
    const q = await fetch(`${BASE}/quotes`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        summary: "Q-002 V2",
        lineItems: [],
        estimatedTotal: 3_800_00,
      }),
    }).then((r) => r.json());
    await drain(
      await fetch(`${BASE}/quotes/${q.id}`, {
        method: "PUT",
        headers: auth,
        body: JSON.stringify({
          status: "sent",
          sentAt: new Date().toISOString(),
        }),
      }),
    );

    const before = await fetch(`${BASE}/analytics/dashboard`, {
      headers: { "x-session-id": sid },
    }).then((r) => r.json());
    assertEquals(before.quotes.sent, 1, "pending once sent");

    // the customer opens the link: no session, not a poll
    const pub = await fetch(`${BASE}/quotes/${q.id}/public`);
    assertEquals(pub.status, 200);
    await drain(pub);
    const owned = await fetch(`${BASE}/quotes/${q.id}`, {
      headers: { "x-session-id": sid },
    }).then((r) => r.json());
    assertEquals(owned.status, "viewed", "the first open flips sent → viewed");

    const stats = await fetch(`${BASE}/analytics/dashboard`, {
      headers: { "x-session-id": sid },
    }).then((r) => r.json());
    assertEquals(stats.quotes.sent, 1, "QUOTES PENDING after the open");
    assertEquals(stats.awaitingResponse, 1, "awaitingResponse after the open");
    assertEquals(stats.quotedValueCents, 3_800_00, "pending value after the open");
  } finally {
    await server.stop();
    await resetKv();
  }
});
