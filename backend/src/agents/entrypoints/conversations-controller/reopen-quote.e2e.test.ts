import "#reflect-metadata";
import { assert, assertEquals } from "#std/assert";
import { Module } from "#danet/core";
import { bootstrapServer } from "#mrg-keystone/danet";
import { AgentsModule } from "@agents/mod-root.ts";
import { OtpStore } from "@users/domain/data/otp-store/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";

// REQ-334 (demo-loop cycle 1, M25): the locked quote card's "Re-open" is a
// real endpoint, not a chat message — over HTTP on the booted app.

@Module({ imports: [AgentsModule] })
class TestApp {}

const PORT = 9073;

async function drain(res: Response) {
  await res.body?.cancel();
}

async function withServer(fn: (port: number) => Promise<void>) {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  try {
    await fn(PORT);
  } finally {
    await server.stop();
    await resetKv();
  }
}

async function login(port: number, phone = "+15125551234"): Promise<string> {
  await drain(
    await fetch(`http://localhost:${port}/auth/send-otp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ phoneNumber: phone }),
    }),
  );
  const stored = await new OtpStore().get(phone);
  const v = await fetch(`http://localhost:${port}/auth/verify-otp`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ phoneNumber: phone, code: stored!.code }),
  }).then((r) => r.json());
  return v.sessionId;
}

Deno.test("REQ-334 M25 e2e: POST /:id/reopen-quote after lock + continue puts the chat back on the draft card and clears lockedAt", async () => {
  await withServer(async (port) => {
    const sid = await login(port);
    const h = { "content-type": "application/json", "x-session-id": sid };
    const base = `http://localhost:${port}`;
    const quote = await fetch(`${base}/quotes`, {
      method: "POST",
      headers: h,
      body: JSON.stringify({
        summary: "Roof",
        lineItems: [{
          description: "x",
          quantity: 1,
          unit: "ea",
          price: 10000,
        }],
        estimatedTotal: 10000,
      }),
    }).then((r) => r.json());
    const conv = await fetch(`${base}/agents/conversations`, {
      method: "POST",
      headers: h,
      body: "{}",
    }).then((r) => r.json());

    await drain(
      await fetch(`${base}/agents/conversations/${conv.id}/lock-quote`, {
        method: "POST",
        headers: h,
        body: JSON.stringify({ quoteId: quote.id }),
      }),
    );
    await drain(
      await fetch(
        `${base}/agents/conversations/${conv.id}/transition-to-terms`,
        {
          method: "POST",
          headers: h,
        },
      ),
    );
    const mid = await fetch(`${base}/agents/conversations/${conv.id}`, {
      headers: h,
    }).then((r) => r.json());
    assertEquals(mid.conversation.currentPhase, "terms");

    const res = await fetch(
      `${base}/agents/conversations/${conv.id}/reopen-quote`,
      {
        method: "POST",
        headers: h,
        body: JSON.stringify({ quoteId: quote.id }),
      },
    );
    assertEquals(res.status, 200);
    const result = await res.json();
    assertEquals(result.conversation.currentPhase, "quote");
    assertEquals(result.conversation.quoteStatus, "draft");
    assert(
      Array.isArray(result.removedMessageIds) &&
        result.removedMessageIds.length >= 2,
    );

    const after = await fetch(`${base}/quotes/${quote.id}`, { headers: h })
      .then((r) => r.json());
    assertEquals(after.status, "draft");
    assertEquals(after.lockedAt, undefined);

    const detail = await fetch(`${base}/agents/conversations/${conv.id}`, {
      headers: h,
    }).then((r) => r.json());
    assertEquals(detail.conversation.currentPhase, "quote");
    const cards =
      (detail.messages as { kind: string; payload?: { status?: string } }[])
        .filter((m) => m.kind === "action_card");
    assertEquals(cards.map((c) => c.payload?.status), ["draft"]);
    assertEquals(
      (detail.messages as { kind: string }[]).some((m) =>
        m.kind === "wizard" || m.kind === "continue_cta"
      ),
      false,
    );
  });
});
