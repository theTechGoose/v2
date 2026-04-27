import "#reflect-metadata";
import { assertEquals } from "#std/assert";
import { Module } from "#danet/core";
import { bootstrapServer } from "#mrg-keystone/danet";
import { CoreModule } from "@core/mod-root.ts";
import { OtpStore } from "@users/domain/data/otp-store/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";

@Module({ imports: [CoreModule] })
class TestApp {}

const PORT = 9092;

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

Deno.test("search e2e: GET /search?q= returns [] for empty query", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  try {
    const sid = await login(PORT);
    const res = await fetch(`http://localhost:${PORT}/search?q=`, {
      headers: { "x-session-id": sid },
    }).then((r) => r.json());
    assertEquals(res.results, []);
  } finally {
    await server.stop();
    await resetKv();
  }
});

Deno.test("search e2e: GET /search?q=acme matches a customer name (case-insensitive)", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  try {
    const sid = await login(PORT);
    const auth = { "content-type": "application/json", "x-session-id": sid };

    await drain(await fetch(`http://localhost:${PORT}/customers`, {
      method: "POST", headers: auth, body: JSON.stringify({ name: "Acme Roofing", email: "ops@acme.test" }),
    }));
    await drain(await fetch(`http://localhost:${PORT}/customers`, {
      method: "POST", headers: auth, body: JSON.stringify({ name: "Beta Plumbing" }),
    }));

    const res = await fetch(`http://localhost:${PORT}/search?q=ACME`, {
      headers: { "x-session-id": sid },
    }).then((r) => r.json());
    assertEquals(res.results.length, 1);
    assertEquals(res.results[0].type, "customer");
    assertEquals(res.results[0].label, "Acme Roofing");
  } finally {
    await server.stop();
    await resetKv();
  }
});

Deno.test("search e2e: GET /search?q=&type=quote narrows to one entity type", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  try {
    const sid = await login(PORT);
    const auth = { "content-type": "application/json", "x-session-id": sid };

    await drain(await fetch(`http://localhost:${PORT}/customers`, {
      method: "POST", headers: auth, body: JSON.stringify({ name: "Roofing pros" }),
    }));
    await drain(await fetch(`http://localhost:${PORT}/quotes`, {
      method: "POST", headers: auth, body: JSON.stringify({
        summary: "Roofing job", lineItems: [], status: "sent",
      }),
    }));

    const all = await fetch(`http://localhost:${PORT}/search?q=roofing`, {
      headers: { "x-session-id": sid },
    }).then((r) => r.json());
    const onlyQuote = await fetch(`http://localhost:${PORT}/search?q=roofing&type=quote`, {
      headers: { "x-session-id": sid },
    }).then((r) => r.json());

    assertEquals(all.results.length, 2);
    assertEquals(onlyQuote.results.length, 1);
    assertEquals(onlyQuote.results[0].type, "quote");
  } finally {
    await server.stop();
    await resetKv();
  }
});

Deno.test("search e2e: A's data and B's data are isolated", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  try {
    const sidA = await login(PORT, "+15125551234");
    const sidB = await login(PORT, "+15125559999");
    await drain(await fetch(`http://localhost:${PORT}/customers`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-session-id": sidA },
      body: JSON.stringify({ name: "Acme A" }),
    }));

    const a = await fetch(`http://localhost:${PORT}/search?q=Acme`, { headers: { "x-session-id": sidA } }).then((r) => r.json());
    const b = await fetch(`http://localhost:${PORT}/search?q=Acme`, { headers: { "x-session-id": sidB } }).then((r) => r.json());
    assertEquals(a.results.length, 1);
    assertEquals(b.results.length, 0);
  } finally {
    await server.stop();
    await resetKv();
  }
});

Deno.test("search e2e: GET /search?q= without session is rejected", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  try {
    const res = await fetch(`http://localhost:${PORT}/search?q=acme`);
    const ok = res.ok;
    await drain(res);
    assertEquals(ok, false);
  } finally {
    await server.stop();
    await resetKv();
  }
});

Deno.test("search e2e: invalid type filter is silently ignored", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  try {
    const sid = await login(PORT);
    const auth = { "content-type": "application/json", "x-session-id": sid };
    await drain(await fetch(`http://localhost:${PORT}/customers`, {
      method: "POST", headers: auth, body: JSON.stringify({ name: "Acme" }),
    }));
    const res = await fetch(`http://localhost:${PORT}/search?q=acme&type=bogus`, {
      headers: { "x-session-id": sid },
    }).then((r) => r.json());
    assertEquals(res.results.length, 1);
    assertEquals(res.results[0].type, "customer");
  } finally {
    await server.stop();
    await resetKv();
  }
});
