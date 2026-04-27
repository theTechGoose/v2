import "#reflect-metadata";
import { assertEquals } from "#std/assert";
import { Module } from "#danet/core";
import { bootstrapServer } from "#mrg-keystone/danet";
import { PaperworkModule } from "@paperwork/mod-root.ts";
import { UsersModule } from "@users/mod-root.ts";
import { OtpStore } from "@users/domain/data/otp-store/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";

@Module({ imports: [UsersModule, PaperworkModule] })
class TestApp {}

const PORT = 9020;

async function drain(res: Response) { await res.body?.cancel(); }

async function login(port: number, phone = "+15125551234"): Promise<string> {
  await drain(await fetch(`http://localhost:${port}/auth/send-otp`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ phoneNumber: phone }),
  }));
  const stored = await new OtpStore().get(phone);
  const v = await fetch(`http://localhost:${port}/auth/verify-otp`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ phoneNumber: phone, code: stored!.code }),
  }).then((r) => r.json());
  return v.sessionId;
}

Deno.test("view e2e: post views (anonymous) and get summary", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  try {
    // Quote creation requires auth (the contractor creates quotes)…
    const sid = await login(PORT);
    const quote = await fetch(`http://localhost:${PORT}/quotes`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-session-id": sid },
      body: JSON.stringify({ summary: "Replace water heater", lineItems: [] }),
    }).then((r) => r.json());

    // …but views are anonymous (customers post them when they open the public quote page).
    await drain(await fetch(`http://localhost:${PORT}/views`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        paperworkType: "quote",
        paperworkId: quote.id,
        viewedAt: "2026-04-26T10:00:00Z",
        viewerEmail: "ops@acme.test",
      }),
    }));

    await drain(await fetch(`http://localhost:${PORT}/views`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        paperworkType: "quote",
        paperworkId: quote.id,
        viewedAt: "2026-04-26T13:00:00Z",
        viewerEmail: "ops@acme.test",
      }),
    }));

    const summary = await fetch(
      `http://localhost:${PORT}/views/summary/quote/${quote.id}`,
    ).then((r) => r.json());

    assertEquals(summary.stats.total, 2);
    assertEquals(summary.stats.uniqueViewers, 1);
    assertEquals(summary.stats.firstViewedAt, "2026-04-26T10:00:00Z");
    assertEquals(summary.stats.lastViewedAt, "2026-04-26T13:00:00Z");
  } finally {
    await server.stop();
    await resetKv();
  }
});
