import "#reflect-metadata";
import { assert, assertEquals } from "#std/assert";
import { Module } from "#danet/core";
import { bootstrapServer } from "#mrg-keystone/danet";
import { PaperworkModule } from "@paperwork/mod-root.ts";
import { UsersModule } from "@users/mod-root.ts";
import { OtpStore } from "@users/domain/data/otp-store/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";

@Module({ imports: [UsersModule, PaperworkModule] })
class TestApp {}

const PORT = 9091;

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

Deno.test("public e2e: GET /quotes/:id/public works WITHOUT a session", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  try {
    const sid = await login(PORT);
    const created = await fetch(`http://localhost:${PORT}/quotes`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-session-id": sid },
      body: JSON.stringify({ summary: "Job", lineItems: [{ description: "x", quantity: 1, unit: "ea", price: 100 }] }),
    }).then((r) => r.json());

    // Hit /public WITHOUT a session — should still resolve.
    const pub = await fetch(`http://localhost:${PORT}/quotes/${created.id}/public`).then((r) => r.json());
    assertEquals(pub.id, created.id);
    assertEquals(pub.summary, "Job");
    assertEquals(pub.lineItems.length, 1);
    assert(!("userId" in pub), "userId must NOT leak to /public");
  } finally {
    await server.stop();
    await resetKv();
  }
});

Deno.test("public e2e: POST /quotes/:id/accept (no session) flips status to accepted", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  try {
    const sid = await login(PORT);
    const q = await fetch(`http://localhost:${PORT}/quotes`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-session-id": sid },
      body: JSON.stringify({ summary: "Job", lineItems: [], status: "sent" }),
    }).then((r) => r.json());

    const out = await fetch(`http://localhost:${PORT}/quotes/${q.id}/accept`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Tom K.", signature: "data:image/png;base64,..." }),
    }).then((r) => r.json());
    assertEquals(out.ok, true);

    const refetched = await fetch(`http://localhost:${PORT}/quotes/${q.id}/public`).then((r) => r.json());
    assertEquals(refetched.status, "accepted");
  } finally {
    await server.stop();
    await resetKv();
  }
});

Deno.test("public e2e: GET /contracts/:id/public works WITHOUT a session, redacts userId", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  try {
    const sid = await login(PORT);
    const c = await fetch(`http://localhost:${PORT}/contracts`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-session-id": sid },
      body: JSON.stringify({ quoteId: "q-1", totalAmount: 5_000 }),
    }).then((r) => r.json());

    const pub = await fetch(`http://localhost:${PORT}/contracts/${c.id}/public`).then((r) => r.json());
    assertEquals(pub.id, c.id);
    assertEquals(pub.totalAmount, 5_000);
    assert(!("userId" in pub), "userId must NOT leak to /public");
  } finally {
    await server.stop();
    await resetKv();
  }
});

Deno.test("public e2e: POST /contracts/:id/sign requires signature + name and flips status", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  try {
    const sid = await login(PORT);
    const c = await fetch(`http://localhost:${PORT}/contracts`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-session-id": sid },
      body: JSON.stringify({ quoteId: "q-1" }),
    }).then((r) => r.json());

    const out = await fetch(`http://localhost:${PORT}/contracts/${c.id}/sign`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ signature: "sig", name: "Tom K.", tin: "123-45-6789" }),
    }).then((r) => r.json());
    assertEquals(out.ok, true);

    const refetched = await fetch(`http://localhost:${PORT}/contracts/${c.id}/public`).then((r) => r.json());
    assertEquals(refetched.status, "signed");
    assertEquals(typeof refetched.signedAt, "string");
  } finally {
    await server.stop();
    await resetKv();
  }
});

Deno.test("public e2e: sign without name + signature is rejected (validation)", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  try {
    const sid = await login(PORT);
    const c = await fetch(`http://localhost:${PORT}/contracts`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-session-id": sid },
      body: JSON.stringify({ quoteId: "q-1" }),
    }).then((r) => r.json());

    const res = await fetch(`http://localhost:${PORT}/contracts/${c.id}/sign`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    const ok = res.ok;
    await drain(res);
    assertEquals(ok, false);
  } finally {
    await server.stop();
    await resetKv();
  }
});

Deno.test("public e2e: GET /invoices/:id/public works WITHOUT a session, redacts userId", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  try {
    const sid = await login(PORT);
    const i = await fetch(`http://localhost:${PORT}/invoices`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-session-id": sid },
      body: JSON.stringify({ contractId: "c-1", dueDate: "2026-05-01", amount: 1_000 }),
    }).then((r) => r.json());

    const pub = await fetch(`http://localhost:${PORT}/invoices/${i.id}/public`).then((r) => r.json());
    assertEquals(pub.id, i.id);
    assertEquals(pub.amount, 1_000);
    assert(!("userId" in pub), "userId must NOT leak to /public");
  } finally {
    await server.stop();
    await resetKv();
  }
});

Deno.test("public e2e: GET /contracts/by-quote/:quoteId/public looks up contract by quote", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  try {
    const sid = await login(PORT);
    const auth = { "content-type": "application/json", "x-session-id": sid };
    const q = await fetch(`http://localhost:${PORT}/quotes`, {
      method: "POST", headers: auth, body: JSON.stringify({ summary: "x", lineItems: [] }),
    }).then((r) => r.json());
    const c = await fetch(`http://localhost:${PORT}/contracts`, {
      method: "POST", headers: auth, body: JSON.stringify({ quoteId: q.id }),
    }).then((r) => r.json());

    const out = await fetch(`http://localhost:${PORT}/contracts/by-quote/${q.id}/public`).then((r) => r.json());
    assertEquals(out.contractId, c.id);
  } finally {
    await server.stop();
    await resetKv();
  }
});

Deno.test("public e2e: by-quote lookup returns null when no contract exists", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  try {
    const sid = await login(PORT);
    const q = await fetch(`http://localhost:${PORT}/quotes`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-session-id": sid },
      body: JSON.stringify({ summary: "x", lineItems: [] }),
    }).then((r) => r.json());

    const out = await fetch(`http://localhost:${PORT}/contracts/by-quote/${q.id}/public`).then((r) => r.json());
    assertEquals(out.contractId, null);
  } finally {
    await server.stop();
    await resetKv();
  }
});
