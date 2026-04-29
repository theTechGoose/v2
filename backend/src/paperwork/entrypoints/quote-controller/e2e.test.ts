import "#reflect-metadata";
import { assertEquals } from "#std/assert";
import { Module } from "#danet/core";
import { bootstrapServer } from "#mrg-keystone/danet";
import { PaperworkModule } from "@paperwork/mod-root.ts";
import { CrmModule } from "@crm/mod-root.ts";
import { AnalyticsModule } from "@analytics/mod-root.ts";
import { UsersModule } from "@users/mod-root.ts";
import { OtpStore } from "@users/domain/data/otp-store/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";

// `GET /quotes` (the enriched, stage-derived list) lives in AnalyticsModule's
// QuotesController. Import it alongside Paperwork so the route is registered
// for these legacy round-trip tests.
@Module({ imports: [UsersModule, CrmModule, PaperworkModule, AnalyticsModule] })
class TestApp {}

const PORT = 9012;

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

Deno.test("quote e2e: POST /quotes then list contains it", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  try {
    const sid = await login(PORT);
    const created = await fetch(`http://localhost:${PORT}/quotes`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-session-id": sid },
      body: JSON.stringify({ summary: "Job", lineItems: [] }),
    }).then((r) => r.json());

    const list = await fetch(`http://localhost:${PORT}/quotes`, {
      headers: { "x-session-id": sid },
    }).then((r) => r.json());
    assertEquals(list.some((q: { id: string }) => q.id === created.id), true);
  } finally {
    await server.stop();
    await resetKv();
  }
});

Deno.test("quote e2e: GET /quotes?status=sent filters", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  try {
    const sid = await login(PORT);
    const auth = { "content-type": "application/json", "x-session-id": sid };
    await drain(await fetch(`http://localhost:${PORT}/quotes`, {
      method: "POST", headers: auth, body: JSON.stringify({ summary: "A", lineItems: [], status: "draft" }),
    }));
    const b = await fetch(`http://localhost:${PORT}/quotes`, {
      method: "POST", headers: auth, body: JSON.stringify({ summary: "B", lineItems: [], status: "sent" }),
    }).then((r) => r.json());
    // Stamp sentAt so the derivation lands B in stage="sent" — the new
    // ?status= param filters on the derived stage now.
    await drain(await fetch(`http://localhost:${PORT}/quotes/${b.id}`, {
      method: "PUT", headers: auth, body: JSON.stringify({ sentAt: new Date().toISOString() }),
    }));
    const sent = await fetch(`http://localhost:${PORT}/quotes?status=sent`, {
      headers: { "x-session-id": sid },
    }).then((r) => r.json());
    assertEquals(sent.length, 1);
    assertEquals(sent[0].stage, "sent");
  } finally {
    await server.stop();
    await resetKv();
  }
});

Deno.test("quote e2e: cross-user GET /:id is forbidden", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  try {
    const sidA = await login(PORT, "+15125551234");
    const sidB = await login(PORT, "+15125559999");
    const q = await fetch(`http://localhost:${PORT}/quotes`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-session-id": sidA },
      body: JSON.stringify({ summary: "A's", lineItems: [] }),
    }).then((r) => r.json());

    const res = await fetch(`http://localhost:${PORT}/quotes/${q.id}`, {
      headers: { "x-session-id": sidB },
    });
    const ok = res.ok;
    await drain(res);
    assertEquals(ok, false);
  } finally {
    await server.stop();
    await resetKv();
  }
});

Deno.test("quote e2e: no session is rejected", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  try {
    const res = await fetch(`http://localhost:${PORT}/quotes`);
    const ok = res.ok;
    await drain(res);
    assertEquals(ok, false);
  } finally {
    await server.stop();
    await resetKv();
  }
});
